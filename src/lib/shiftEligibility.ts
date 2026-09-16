import { supabase } from "@/integrations/supabase/client";
import { toMinutes } from "@/lib/shiftAssignment";

export type EligibilityIssue = {
  code: string;
  label: string;
  detail: string;
  /** Soft blockers can be overridden by staff with a written reason. Hard ones never can. */
  overridable?: boolean;
};

export type EligibilityResult = {
  /** No hard blockers: the caregiver may take this shift. */
  eligible: boolean;
  /** Eligible and no soft blockers: can be assigned without a manager override. */
  autoApprovable: boolean;
  blockers: EligibilityIssue[];
  /** Soft blockers — staff may override them with a reason. */
  overridable: EligibilityIssue[];
  flags: EligibilityIssue[];
  weeklyHours: number;
  projectedWeeklyHours: number;
};

export type EligibilityRules = {
  maxWeeklyHours: number;
  travelBufferMinutes: number;
  lateTradeHours: number;
};

export const DEFAULT_RULES: EligibilityRules = {
  maxWeeklyHours: 40,
  travelBufferMinutes: 30,
  lateTradeHours: 24,
};

export async function loadEligibilityRules(agencyId?: string | null): Promise<EligibilityRules> {
  if (!agencyId) return DEFAULT_RULES;
  const { data } = await supabase
    .from("agency")
    .select("max_weekly_hours, travel_buffer_minutes, late_trade_hours")
    .eq("id", agencyId)
    .maybeSingle();
  if (!data) return DEFAULT_RULES;
  return {
    maxWeeklyHours: (data as any).max_weekly_hours ?? DEFAULT_RULES.maxWeeklyHours,
    travelBufferMinutes: (data as any).travel_buffer_minutes ?? DEFAULT_RULES.travelBufferMinutes,
    lateTradeHours: (data as any).late_trade_hours ?? DEFAULT_RULES.lateTradeHours,
  };
}

/** Monday-based week bounds for a yyyy-mm-dd date. */
export function weekBounds(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export type EligibilityInput = {
  caregiverId: string;
  shift: {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    duration_hours?: number | null;
    care_type_code: string;
    required_skills?: string[] | null;
    client_id?: string | null;
    status?: string | null;
  };
  rules?: EligibilityRules;
};

const hhmm = (t: string) => (t || "").slice(0, 5);

type ServerIssue = { code: string; label: string; detail: string };

/**
 * Single source of truth for "can this caregiver take this shift?".
 * The database function `check_assignment_eligibility` is authoritative — the
 * same rules the assignment RPC enforces on write. The local implementation
 * below is only a fallback preview when the RPC is unreachable.
 */
export type RawEligibilityResult = {
  hard: ServerIssue[];
  soft: ServerIssue[];
  advisory: ServerIssue[];
  weekly_hours: number;
  projected_weekly_hours: number;
};

/** Shared mapper from the RPC's raw shape to EligibilityResult -- used by every
 * single-candidate and bulk path (including the caregiver-board bulk RPCs) so the
 * mapping logic exists exactly once. */
export function mapServerResult(r: RawEligibilityResult): EligibilityResult {
  const hard = (r.hard || []).map((i) => ({ ...i, overridable: false }));
  const soft = (r.soft || []).map((i) => ({ ...i, overridable: true }));
  return {
    eligible: hard.length === 0,
    autoApprovable: hard.length === 0 && soft.length === 0,
    blockers: [...hard, ...soft],
    overridable: soft,
    flags: (r.advisory || []).map((i) => ({ ...i, overridable: true })),
    weeklyHours: Number(r.weekly_hours ?? 0),
    projectedWeeklyHours: Number(r.projected_weekly_hours ?? 0),
  };
}

export async function evaluateEligibility(input: EligibilityInput): Promise<EligibilityResult> {
  const { data, error } = await supabase.rpc("check_assignment_eligibility" as never, {
    _shift_id: input.shift.id,
    _caregiver_id: input.caregiverId,
  } as never);

  if (error || !data) return evaluateEligibilityLocal(input);
  return mapServerResult(data as unknown as RawEligibilityResult);
}

/**
 * Bulk eligibility for a roster against one shift -- used by Manual Assign (to
 * partition the picker into eligible/blocked) and Smart Assign/Auto-fill (to
 * exclude hard-blocked candidates before ranking). One RPC round-trip instead of
 * one per caregiver; reuses the same server-side rules, no duplicated logic.
 * Returns an empty map (never throws) if the RPC is unreachable -- callers should
 * treat that as "unknown, don't filter" rather than "everyone blocked."
 */
export async function evaluateEligibilityBulk(
  shiftId: string,
  caregiverIds: string[]
): Promise<Map<string, EligibilityResult>> {
  const map = new Map<string, EligibilityResult>();
  if (caregiverIds.length === 0) return map;
  const { data, error } = await supabase.rpc("check_assignment_eligibility_bulk" as never, {
    _shift_id: shiftId,
    _caregiver_ids: caregiverIds,
  } as never);
  if (error || !data) return map;
  for (const row of data as unknown as { caregiver_id: string; result: RawEligibilityResult }[]) {
    map.set(row.caregiver_id, mapServerResult(row.result));
  }
  return map;
}

/** Client-side preview of the same rules; used only as an offline fallback. */
export async function evaluateEligibilityLocal(input: EligibilityInput): Promise<EligibilityResult> {
  const rules = input.rules ?? DEFAULT_RULES;
  const { caregiverId, shift } = input;
  const blockers: EligibilityIssue[] = [];
  const flags: EligibilityIssue[] = [];

  const start = toMinutes(hhmm(shift.start_time));
  const end = toMinutes(hhmm(shift.end_time));
  const shiftHours = shift.duration_hours ?? Math.max(0, (end - start) / 60);
  const { start: weekStart, end: weekEnd } = weekBounds(shift.shift_date);

  const [caregiverRes, skillsRes, certsRes, weekRes, sameDayRes, timeOffRes, availRes, serviceRes, clientRes, perfRes] =
    await Promise.all([
      supabase
        .from("caregivers")
        .select("id, is_active, employment_type, hourly_rate, reliability_score, service_zipcodes, agency_id")
        .eq("id", caregiverId)
        .maybeSingle(),
      supabase.from("caregiver_skills").select("care_type_code").eq("caregiver_id", caregiverId),
      supabase.from("caregiver_certifications").select("certification_name, expiry_date").eq("caregiver_id", caregiverId),
      supabase
        .from("shift_assignments")
        .select("shift_id, shifts!inner ( id, duration_hours, shift_date )")
        .eq("caregiver_id", caregiverId)
        .neq("status", "cancelled" as never)
        .gte("shifts.shift_date", weekStart)
        .lte("shifts.shift_date", weekEnd),
      supabase
        .from("shift_assignments")
        .select("shift_id, shifts!inner ( id, start_time, end_time, shift_date )")
        .eq("caregiver_id", caregiverId)
        .neq("status", "cancelled" as never)
        .eq("shifts.shift_date", shift.shift_date),

      supabase
        .from("time_off_requests")
        .select("id")
        .eq("caregiver_id", caregiverId)
        .eq("status", "approved" as never)
        .lte("start_date", shift.shift_date)
        .gte("end_date", shift.shift_date),
      supabase
        .from("caregiver_availability")
        .select("day_of_week, start_time, end_time, is_available")
        .eq("caregiver_id", caregiverId),
      supabase
        .from("care_types")
        .select("code, name, requires_trade_approval")
        .eq("code", shift.care_type_code)
        .maybeSingle(),
      shift.client_id
        ? supabase.from("clients").select("id, zip_code, preferred_caregiver_id").eq("id", shift.client_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      supabase
        .from("caregiver_performance" as never)
        .select("completion_rate, lifetime_no_shows")
        .eq("caregiver_id", caregiverId)
        .maybeSingle(),
    ]);

  const caregiver: any = caregiverRes.data;
  const service: any = serviceRes.data;
  const client: any = clientRes?.data;
  const perf: any = perfRes?.data;

  // --- Hard rules -----------------------------------------------------
  if (!caregiver || caregiver.is_active === false) {
    blockers.push({ code: "inactive", label: "Inactive caregiver", detail: "This caregiver is not active." });
  }

  const skillCodes = new Set((skillsRes.data || []).map((s: any) => s.care_type_code));
  const required = [shift.care_type_code, ...((shift.required_skills as string[]) || [])].filter(Boolean);
  const missing = required.filter((code) => !skillCodes.has(code));
  if (missing.length > 0) {
    blockers.push({
      code: "skill",
      label: "Missing care service skill",
      detail: `Not qualified for ${missing.join(", ")}.`,
    });
  }

  const expired = (certsRes.data || []).filter(
    (c: any) => c.expiry_date && c.expiry_date < shift.shift_date
  );
  if (expired.length > 0) {
    blockers.push({
      code: "certification",
      label: "Expired certification",
      detail: `${expired.map((c: any) => c.certification_name).join(", ")} expired before this shift date.`,
    });
  }

  const buffer = rules.travelBufferMinutes;
  (sameDayRes.data || []).map((row: any) => row.shifts).filter((other: any) => other && other.id !== shift.id).forEach((other: any) => {
    const os = toMinutes(hhmm(other.start_time));
    const oe = toMinutes(hhmm(other.end_time));
    if (start < oe && os < end) {
      blockers.push({
        code: "double_booked",
        label: "Double booked",
        detail: `Overlaps a shift ${hhmm(other.start_time)}–${hhmm(other.end_time)} on this day.`,
      });
    } else if (start < oe + buffer && os < end + buffer) {
      flags.push({
        code: "travel_buffer",
        label: "Tight turnaround",
        detail: `Less than ${buffer} minutes between this and a shift at ${hhmm(other.start_time)}.`,
      });
    }
  });

  const weeklyHours = (weekRes.data || [])
    .map((row: any) => row.shifts)
    .filter((s: any) => s && s.id !== shift.id)
    .reduce((sum: number, s: any) => sum + Number(s.duration_hours || 0), 0);

  const projectedWeeklyHours = Math.round((weeklyHours + Number(shiftHours)) * 100) / 100;
  if (projectedWeeklyHours > rules.maxWeeklyHours) {
    blockers.push({
      code: "weekly_hours",
      label: "Over weekly hours cap",
      detail: `Would reach ${projectedWeeklyHours}h this week (cap ${rules.maxWeeklyHours}h).`,
    });
  } else if (projectedWeeklyHours > rules.maxWeeklyHours - 8) {
    flags.push({
      code: "overtime_risk",
      label: "Approaching overtime",
      detail: `Would reach ${projectedWeeklyHours}h of ${rules.maxWeeklyHours}h this week.`,
    });
  }

  if ((timeOffRes.data || []).length > 0) {
    blockers.push({
      code: "time_off",
      label: "Approved time off",
      detail: "Caregiver has approved time off covering this date.",
    });
  }

  const { data: exception } = await supabase
    .from("caregiver_availability_exceptions")
    .select("is_available, start_time, end_time, reason")
    .eq("caregiver_id", caregiverId)
    .eq("exception_date", shift.shift_date)
    .maybeSingle();

  const avail = availRes.data || [];
  if (exception) {
    const exc: any = exception;
    if (exc.is_available === false) {
      blockers.push({
        code: "availability_exception",
        label: "Unavailable on this date",
        detail: exc.reason || "Caregiver marked this date as unavailable.",
      });
    } else if (
      !(toMinutes(hhmm(exc.start_time)) <= start && toMinutes(hhmm(exc.end_time)) >= end)
    ) {
      blockers.push({
        code: "availability_exception",
        label: "Outside availability for this date",
        detail: `On this date the caregiver is only available ${hhmm(exc.start_time)}–${hhmm(exc.end_time)}.`,
      });
    }
  } else if (avail.length > 0) {
    const dow = new Date(`${shift.shift_date}T00:00:00`).getDay();
    const windows = avail.filter((a: any) => a.day_of_week === dow && a.is_available !== false);
    const covered = windows.some(
      (w: any) => toMinutes(hhmm(w.start_time)) <= start && toMinutes(hhmm(w.end_time)) >= end
    );
    if (!covered) {
      blockers.push({
        code: "availability",
        label: "Outside declared availability",
        detail: "This shift falls outside the caregiver's availability for that weekday.",
      });
    }
  }


  if (client?.zip_code && Array.isArray(caregiver?.service_zipcodes) && caregiver.service_zipcodes.length > 0) {
    if (!caregiver.service_zipcodes.includes(client.zip_code)) {
      flags.push({
        code: "service_area",
        label: "Outside service area",
        detail: `Client ZIP ${client.zip_code} is not in this caregiver's service ZIP list.`,
      });
    }
  }

  // --- Soft rules (manager review) ------------------------------------
  if (service?.requires_trade_approval) {
    flags.push({
      code: "specialized_service",
      label: "Specialised care service",
      detail: `${service.name} always requires manager approval before a trade.`,
    });
  }

  if (client?.preferred_caregiver_id && client.preferred_caregiver_id !== caregiverId) {
    flags.push({
      code: "preferred_caregiver",
      label: "Client has a preferred caregiver",
      detail: "Continuity of care: the client requested a specific caregiver for this shift.",
    });
  }

  const startsAt = new Date(`${shift.shift_date}T${hhmm(shift.start_time)}:00`);
  const hoursUntil = (startsAt.getTime() - Date.now()) / 3_600_000;
  if (hoursUntil < rules.lateTradeHours && hoursUntil > 0) {
    flags.push({
      code: "late_trade",
      label: "Late trade",
      detail: `Shift starts in under ${rules.lateTradeHours} hours.`,
    });
  }
  if (shift.status === "in_progress") {
    flags.push({ code: "in_progress", label: "Shift in progress", detail: "This shift has already started." });
  }

  if (caregiver?.reliability_score != null && caregiver.reliability_score < 70) {
    flags.push({
      code: "reliability",
      label: "Low reliability score",
      detail: `Reliability score is ${caregiver.reliability_score}.`,
    });
  }
  if (perf?.lifetime_no_shows >= 2) {
    flags.push({
      code: "no_shows",
      label: "Recent no-shows",
      detail: `${perf.lifetime_no_shows} recorded no-shows.`,
    });
  }
  if (perf?.completion_rate != null && Number(perf.completion_rate) < 85) {
    flags.push({
      code: "completion_rate",
      label: "Low completion rate",
      detail: `Completion rate is ${perf.completion_rate}%.`,
    });
  }

  return {
    eligible: blockers.length === 0,
    autoApprovable: blockers.length === 0 && flags.length === 0,
    blockers,
    overridable: [],
    flags,
    weeklyHours: Math.round(weeklyHours * 100) / 100,
    projectedWeeklyHours,
  };
}
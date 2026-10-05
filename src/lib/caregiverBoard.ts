import { supabase } from "@/integrations/supabase/client";
import { mapServerResult, type EligibilityResult, type RawEligibilityResult } from "@/lib/shiftEligibility";

/**
 * Trade Shifts section data -- shifts colleagues have dropped for trade, in the caller's
 * own office. Never overlaps with the Open Shifts section: get_caregiver_trade_shifts()
 * only reaches into shift_trades (joined to shifts for display fields), and Open Shifts
 * queries `shifts` directly. See docs/scheduling-caregiver-board-plan.md (rev 2).
 */
export interface CaregiverTradeShift {
  trade_id: string;
  shift_id: string;
  client_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  care_type_code: string;
  order_title: string | null;
  original_caregiver_first_name: string;
  original_caregiver_last_name: string;
  reason: string | null;
}

export async function fetchCaregiverTradeShifts(): Promise<CaregiverTradeShift[]> {
  const { data, error } = await supabase.rpc("get_caregiver_trade_shifts" as never);
  if (error || !data) return [];
  return data as unknown as CaregiverTradeShift[];
}

/**
 * Ids of the open shifts the caller can see (RLS: their own office, Phase 1B) from `today` on — the
 * same rows as Available Shifts' Open Shifts section, ids only. `today` comes from the DB clock.
 */
export async function fetchCaregiverOpenShiftIds(today: string): Promise<string[]> {
  const { data, error } = await supabase.from("shifts").select("id").eq("status", "open").gte("shift_date", today);
  if (error || !data) return [];
  return data.map((s) => s.id);
}

/**
 * "One caregiver (the caller) against many shifts" -- the transpose of Phase 1B's
 * evaluateEligibilityBulk (many caregivers against one shift). Shared by both the Trade
 * Shifts and Open Shifts sections; call once with the combined shift ids from both.
 * Returns an empty map (never throws) if unreachable -- treat as "unknown," never as
 * "everyone blocked."
 */
export async function fetchCaregiverShiftsEligibility(
  shiftIds: string[]
): Promise<Map<string, EligibilityResult>> {
  const map = new Map<string, EligibilityResult>();
  if (shiftIds.length === 0) return map;
  const { data, error } = await supabase.rpc("check_caregiver_shifts_eligibility" as never, {
    _shift_ids: shiftIds,
  } as never);
  if (error || !data) return map;
  for (const row of data as unknown as { shift_id: string; result: RawEligibilityResult }[]) {
    map.set(row.shift_id, mapServerResult(row.result));
  }
  return map;
}

export interface MyTradeRequest {
  id: string;
  shift_id: string | null;
  status: string;
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
  new_caregiver: { first_name: string; last_name: string } | null;
  shifts: { shift_date: string; start_time: string; end_time: string; order_title: string | null } | null;
}

interface MyTradeRequestRow {
  id: string;
  shift_id: string | null;
  status: string;
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
  new_caregiver_first_name: string | null;
  new_caregiver_last_initial: string | null;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  order_title: string | null;
}

/** The caregiver's own outgoing drop requests, any status -- read-only status display.
 * Served by get_my_trade_requests() (M-SEC-3): after M-SEC-1 a caregiver can no longer read
 * another caregiver's row, so the old new_caregiver embed would resolve to null. The RPC scopes
 * to the caller (auth.uid()) itself and returns the taker's first name + last initial only once
 * the trade is accepted. `caregiverId` is kept for the existing call site; the RPC doesn't need it. */
export async function fetchMyTradeRequests(caregiverId: string): Promise<MyTradeRequest[]> {
  const { data, error } = await supabase.rpc("get_my_trade_requests" as never);
  if (error || !data) return [];
  return (data as unknown as MyTradeRequestRow[]).map((r) => ({
    id: r.id,
    shift_id: r.shift_id,
    status: r.status,
    reason: r.reason,
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    new_caregiver: r.new_caregiver_first_name
      ? { first_name: r.new_caregiver_first_name, last_name: r.new_caregiver_last_initial ? `${r.new_caregiver_last_initial}.` : "" }
      : null,
    shifts: r.shift_date
      ? { shift_date: r.shift_date, start_time: r.start_time ?? "", end_time: r.end_time ?? "", order_title: r.order_title }
      : null,
  }));
}

/**
 * Self pick-up of a trade-board shift, via the dedicated caregiver_pickup_trade_shift()
 * RPC -- NOT assign_caregiver_to_shift(), which requires is_agency_staff() and has never
 * actually worked for a real caregiver account (a pre-existing bug this redesign's own
 * test caught; see docs/known-issues.md). The RPC does its own eligibility check, hard/
 * soft handling, office scoping, and the shift_assignments/shift_trades writes
 * server-side -- this is a thin wrapper, not a second copy of that logic.
 */
export async function pickUpTradeShift(
  tradeId: string
): Promise<{ status: "picked_up" | "sent_for_approval" }> {
  const { data, error } = await supabase.rpc("caregiver_pickup_trade_shift" as never, {
    _trade_id: tradeId,
  } as never);
  if (error) throw new Error(error.message.replace(/^Pick-up refused:\s*/i, ""));
  return data as unknown as { status: "picked_up" | "sent_for_approval" };
}

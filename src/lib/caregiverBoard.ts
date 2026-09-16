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

/** The caregiver's own outgoing drop requests, any status -- read-only status display.
 * No new backend needed: shift_trades' existing agency-scoped RLS already permits reading
 * the caller's own rows; filtering to original_caregiver_id = mine keeps this safely
 * self-scoped regardless of that policy's agency-wide (not office-scoped) looseness. */
export async function fetchMyTradeRequests(caregiverId: string): Promise<MyTradeRequest[]> {
  const { data, error } = await supabase
    .from("shift_trades")
    .select(
      `id, shift_id, status, reason, created_at, resolved_at,
       new_caregiver:new_caregiver_id ( first_name, last_name ),
       shifts:shift_id ( shift_date, start_time, end_time, order_title )`
    )
    .eq("original_caregiver_id", caregiverId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as unknown as MyTradeRequest[];
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

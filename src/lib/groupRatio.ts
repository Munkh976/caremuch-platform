/**
 * Group sessions (Ripple S12, Oct 6): up to 1:3 is allowed (the server's group_full rule is unchanged); above 1:2 is
 * ADVISORY only — "Above Ripple's preferred ratio (1:2)". Computed here from the session's shifts and their active
 * assignments (check_assignment_eligibility is not changed); it never blocks, whatever the compliance switch says.
 */
import { supabase } from "@/integrations/supabase/client";
import type { EligibilityIssue } from "./shiftEligibility";

export const PREFERRED_CLIENTS = 2;
export const GROUP_RATIO_CODE = "group_ratio_preferred";
export const GROUP_RATIO_LABEL = "Above Ripple's preferred ratio (1:2)";
export interface GroupShiftRow { shift_id: string; client_id: string; caregiver_ids: string[] }

/** Distinct clients this caregiver has in the session (active assignments), plus an extra client being assigned. */
export function groupClients(rows: GroupShiftRow[], caregiverId: string, extra?: { shiftId: string; clientId: string | null }): number {
  const set = new Set(rows.filter((r) => r.caregiver_ids.includes(caregiverId) && r.shift_id !== extra?.shiftId).map((r) => r.client_id));
  if (extra?.clientId) set.add(extra.clientId);
  return set.size;
}
export function groupRatioIssue(clients: number): EligibilityIssue | null {
  return clients > PREFERRED_CLIENTS ? { code: GROUP_RATIO_CODE, label: GROUP_RATIO_LABEL, overridable: true,
    detail: `This caregiver would have ${clients} clients in this group session (1:${clients}). Up to 1:3 is allowed; Ripple prefers 1:2.` } : null;
}

export async function fetchGroupShifts(groupSessionId: string): Promise<GroupShiftRow[]> {
  const { data, error } = await supabase.from("shifts").select("id, client_id, shift_assignments(caregiver_id, status)").eq("group_session_id", groupSessionId);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string; client_id: string; shift_assignments: { caregiver_id: string; status: string }[] | null }[]).map((s) => ({
    shift_id: s.id, client_id: s.client_id, caregiver_ids: (s.shift_assignments ?? []).filter((a) => a.status !== "cancelled").map((a) => a.caregiver_id) }));
}

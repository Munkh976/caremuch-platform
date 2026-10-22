/**
 * Visit actions (owner, Oct 22, B): Unassign / Cancel visit / Client no-show — the wording, reasons and who may use them.
 * The server (unassign_visit, cancel_visit, record_client_no_show, preview_visit_action) decides every rule; this file
 * only labels and shapes the requests.
 */
import type { AppRole } from "@/lib/roleHome";

export type VisitAction = "unassign" | "cancel" | "no_show";
export const VISIT_ACTION_ROLES: readonly AppRole[] = ["agency_admin", "manager", "scheduler"];
export const canUseVisitActions = (roles: readonly AppRole[] | null | undefined) => !!roles && roles.some((r) => VISIT_ACTION_ROLES.includes(r));

export const ACTION_TEXT: Record<VisitAction, { label: string; title: string; explain: string; confirm: string; done: string }> = {
  unassign: { label: "Unassign caregiver", title: "Unassign the caregiver",
    explain: "The caregiver is taken off. The visit goes back to Unassigned: caregivers can pick it up, or you can assign it or use Auto-assign.",
    confirm: "Unassign", done: "Caregiver unassigned" },
  cancel: { label: "Cancel visit", title: "Cancel the visit",
    explain: "The visit is cancelled: it is never billed and doesn't go back to Unassigned. Its units and hours are released.",
    confirm: "Cancel visit", done: "Visit cancelled" },
  no_show: { label: "Client no-show", title: "Record a client no-show",
    explain: "The client wasn't there. The visit is not billed and is listed with the no-shows on Weekly Billing. It doesn't count against the caregiver.",
    confirm: "Record no-show", done: "No-show recorded" },
};

export const REASONS = [
  { value: "caregiver_unavailable", label: "Caregiver sick / unavailable" },
  { value: "schedule_change", label: "Schedule change" },
  { value: "client_request", label: "Client request" },
  { value: "other", label: "Other" },
] as const;
export type ReasonCode = (typeof REASONS)[number]["value"];

export interface PreviewVisit { shift_id: string; shift_date: string; start_time: string; blocker: string | null }
export interface Preview { visits: PreviewVisit[]; late_cancel: boolean }

/** What the form needs before it can be sent (the server checks the same). */
export function formProblem(a: VisitAction, f: { reason: ReasonCode | ""; text: string; requestedBy: "client" | "agency" | "" }): string | null {
  if (a !== "no_show" && !f.reason) return "Choose a reason";
  if ((a === "no_show" || f.reason === "other") && f.text.trim().length < 3) return "Describe the reason";
  if (a === "cancel" && !f.requestedBy) return "Say who asked for the cancellation";
  if (f.text.length > 500) return "The reason is at most 500 characters";
  return null;
}

/** The RPC and its arguments for one action. */
export function actionRequest(a: VisitAction, shiftId: string, f: { reason: ReasonCode | ""; text: string; requestedBy: "client" | "agency" | ""; following: boolean; wholeGroup: boolean }) {
  const text = f.text.trim() || null;
  if (a === "unassign") return { fn: "unassign_visit", args: { _shift_id: shiftId, _reason_code: f.reason, _reason_text: text, _following: f.following, _whole_group: f.wholeGroup } };
  if (a === "cancel") return { fn: "cancel_visit", args: { _shift_id: shiftId, _requested_by: f.requestedBy, _reason_code: f.reason, _reason_text: text, _following: f.following, _whole_group: f.wholeGroup } };
  return { fn: "record_client_no_show", args: { _shift_id: shiftId, _reason_text: text, _whole_group: f.wholeGroup } };
}

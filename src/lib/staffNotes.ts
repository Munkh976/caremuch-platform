/**
 * Staff progress-note review (Ripple S8): shapes of list_notes_for_review / get_progress_note_for_staff,
 * labels, filters and how an answer is shown (screen and print). Times are rendered in the office's
 * time zone with the caregiver-note helpers; nothing is stored on the device.
 */
import type { Answer, NoteMeasure } from "./caregiverNotes";

export type QueueStatus = "submitted" | "returned" | "reviewed" | "billed" | "draft" | "not_started";
export interface QueueRow {
  note_id: string | null; shift_id: string; client_id: string; client_first_name: string | null; client_last_initial: string | null;
  caregiver_id: string; caregiver_name: string | null; service_type: "cls" | "respite"; service_date: string;
  scheduled_start: string; scheduled_end: string; arrived_late: boolean | null; units_scheduled: number | null; units_to_bill: number | null;
  status: QueueStatus; overdue: boolean; due_at: string; submitted_at: string | null; reviewed_at: string | null;
  returned_count: number; in_batch: boolean; group_session: boolean;
}
export interface Queue { as_of: string; today: string; timezone: string; billing_week_start: number; rows: QueueRow[] }

export type StatusFilter = "submitted" | "returned" | "reviewed" | "overdue" | "all";
export const STATUS_FILTERS: [StatusFilter, string][] = [["submitted", "Submitted"], ["returned", "Returned"], ["reviewed", "Reviewed"], ["overdue", "Overdue"], ["all", "All"]];
export const QUEUE_STATUS_LABEL: Record<QueueStatus, string> = {
  submitted: "Submitted", returned: "Returned", reviewed: "Reviewed", billed: "Billed", draft: "Draft", not_started: "Not started",
};
export function matchesStatus(r: QueueRow, f: StatusFilter): boolean {
  if (f === "all") return true;
  if (f === "overdue") return r.overdue;
  if (f === "reviewed") return r.status === "reviewed" || r.status === "billed";
  return r.status === f;
}

/** Monday-or-office-day week containing `date` (ISO weekday 1..7 = office billing_week_start). */
export function weekOf(date: string, weekStart: number): { start: string; end: string } {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const iso = ((t.getUTCDay() + 6) % 7) + 1;
  const back = (iso - weekStart + 7) % 7;
  const s = new Date(t.getTime() - back * 864e5), e = new Date(s.getTime() + 6 * 864e5);
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}
export const inWeek = (date: string, week: { start: string; end: string } | null) => !week || (date >= week.start && date <= week.end);
/** Oldest visit first; not-started visits keep their place by visit time. */
export const sortQueue = (rows: QueueRow[]) => [...rows].sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start) || a.shift_id.localeCompare(b.shift_id));

// ---------- get_progress_note_for_staff ----------
export interface StaffEntry {
  entry_id: string; goal_seq: number; goal_text: string | null; objective_letter: string | null; objective_text: string | null; service_type: string | null;
  staff_instructions: string | null; notes_text: string | null; answers: Record<string, Answer> | null; questions_as_asked: boolean; measures: NoteMeasure[];
}
export interface StaffHistory { event: string; at: string; by: string | null; resubmission: boolean | null; billable: boolean | null; reason: string | null }
export interface StaffNote {
  note: {
    id: string; shift_id: string; client_id: string; status: "draft" | "submitted" | "returned" | "reviewed" | "billed"; note_kind: "cls" | "respite"; service_type: string;
    service_date: string; scheduled_start: string; scheduled_end: string; client_arrived_at: string | null; actual_end: string | null;
    location: string | null; staff_client_ratio: string | null; arrived_late: boolean; units_scheduled: number | null; units_to_bill: number;
    billable: boolean | null; non_billable_reason: string | null; narrative_text: string | null; staff_signature_name: string | null; staff_signed_at: string | null;
    late_submitted: boolean; due_at: string; overdue: boolean; returned_reason: string | null; returned_at: string | null; returned_count: number;
    reviewed_at: string | null; reviewed_by_name: string | null; in_batch: boolean; biller_name: string | null; billed_at: string | null;
    template_name: string | null; template_version: number | null;
  };
  client: { first_name: string | null; last_initial: string | null; case_number: string | null };
  caregiver_name: string | null;
  office: { id: string; name: string; timezone: string };
  group_session: { id: string; staff_client_ratio: string | null } | null;
  authorization: { id: string; auth_number: string; preview: boolean } | null;
  entries: StaffEntry[];
  history: StaffHistory[];
}
export const RETURN_MIN = 10;
/** Owner decision (Oct 5): the 10-character minimum is enforced here only; the server requires non-empty. */
export const returnReasonOk = (s: string) => s.trim().length >= RETURN_MIN && s.trim().length <= 1000;
export const HISTORY_LABEL: Record<string, string> = {
  progress_note_created: "Started", progress_note_submitted: "Submitted", progress_note_returned: "Returned", progress_note_reviewed: "Reviewed",
};
export const historyLabel = (h: StaffHistory) => h.event === "progress_note_submitted" && h.resubmission ? "Resubmitted" : HISTORY_LABEL[h.event] ?? h.event;

/** One answer as plain text (screen and print). */
export function answerText(m: NoteMeasure, a: Answer | undefined | null): string {
  if (m.kind === "staff_note") return "";
  if (!a) return "—";
  if ("value" in a) return a.value || "—";
  if ("count" in a) return String(a.count);
  if ("steps" in a) return a.steps.length ? a.steps.map((i) => `${i + 1}. ${(m.options ?? [])[i] ?? "step"}`).join("; ") : "none";
  if ("trials" in a) return a.trials.map((t, i) => `${i + 1}: ${t.value ?? "—"}${t.text ? ` (${t.text})` : ""}`).join("; ");
  return "—";
}
/** Entries grouped by goal, in IPOS order. */
export function byGoal(entries: StaffEntry[]): { goal: string | null; seq: number; items: StaffEntry[] }[] {
  const out: { goal: string | null; seq: number; items: StaffEntry[] }[] = [];
  for (const e of entries) { const last = out[out.length - 1]; if (last && last.seq === e.goal_seq) last.items.push(e); else out.push({ goal: e.goal_text, seq: e.goal_seq, items: [e] }); }
  return out;
}

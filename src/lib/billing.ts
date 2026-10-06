/**
 * Weekly Billing (Ripple S9): shapes of get_billing_week, exclusion reasons, week navigation and the CSV for
 * the claim (units only, no dollars). The CSV is built on demand in memory and handed to the browser as a
 * download; nothing is stored. Its file name never carries a client name.
 */
import { clientShort, fmtDay, SERVICE_LABEL } from "./caregiverNotes";

export interface BillNote { note_id: string; service_date: string; scheduled_start: string; caregiver_name: string | null; units_scheduled: number; units_billed: number; arrived_late: boolean; approved: boolean }
export interface BillLine {
  client_id: string; client_first_name: string | null; client_last_initial: string | null; case_number: string | null;
  authorization: { id: string; auth_number: string; service_type: string; service_code: string | null; effective_date: string; expiration_date: string;
    units_authorized: number; units_left: number; period_type: string | null; units_per_period: number | null; period_left: number | null };
  units_scheduled: number; units_billed: number; units_lost_late: number; notes: BillNote[];
}
export type ExclusionReason = "no_note" | "not_submitted" | "overdue" | "returned" | "not_reviewed" | "no_authorization_fits" | "non_billable"
  | "in_another_batch" | "not_in_bill_yet" | "reviewed_after_approval" | "reviewed_after_billing";
export interface Exclusion { note_id: string | null; shift_id: string; client_id: string; client_first_name: string | null; client_last_initial: string | null;
  caregiver_name: string | null; service_type: string; service_date: string; scheduled_start: string; status: string; reason: ExclusionReason }
export interface BillingWeek {
  office: { id: string; name: string; code: string | null; timezone: string; billing_week_start: number };
  today: string; current_week_start: string; last_complete_week_start: string; week_start: string; week_end: string; complete: boolean;
  batch: { id: string; status: "open" | "approved" | "billed"; approved_at: string | null; approved_by_name: string | null; billed_at: string | null; billed_by_name: string | null } | null;
  lines: BillLine[]; totals: { notes: number; units_scheduled: number; units_billed: number; units_lost_late: number; approved: number };
  excluded: Exclusion[]; pending_review: number;
}

export const REASON_LABEL: Record<ExclusionReason, string> = {
  no_note: "Visit with no note",
  not_submitted: "Not submitted yet",
  overdue: "Not submitted — overdue",
  returned: "Returned — waiting for the caregiver",
  not_reviewed: "Submitted — not reviewed yet",
  no_authorization_fits: "Submitted — no authorization fits (dates, units or cap)",
  non_billable: "Reviewed as not billable",
  in_another_batch: "In another week's bill",
  not_in_bill_yet: "Reviewed — build the week to add it",
  reviewed_after_approval: "Reviewed after the week was approved",
  reviewed_after_billing: "Reviewed after billing",
};
/** Where an exclusion is fixed: the S8 note detail, or the S8 queue's Overdue view for a visit with no note. */
export const fixLink = (x: Exclusion) => x.note_id ? `/progress-notes/${x.note_id}` : "/progress-notes?status=overdue";

/** Why "Approve week" is not available yet (empty = it is). Approving freezes the week's bill (the live
 *  build refuses to rebuild an approved batch), so every reviewed note must be in it and none may wait for review. */
export function approveBlockers(w: BillingWeek): string[] {
  const out: string[] = [];
  if (!w.batch) out.push("Build the week first.");
  else if (w.batch.status !== "open") return [];
  if (w.batch && w.lines.length === 0) out.push("The bill has no reviewed notes.");
  if (w.pending_review > 0) out.push(`${w.pending_review} note${w.pending_review === 1 ? " is" : "s are"} submitted but not reviewed yet.`);
  const notIn = w.excluded.filter((x) => x.reason === "not_in_bill_yet").length;
  if (notIn > 0) out.push(`${notIn} reviewed note${notIn === 1 ? " is" : "s are"} not in the bill yet: build the week again.`);
  return out;
}

export const addDays = (date: string, n: number) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
export const weekLabel = (w: { week_start: string; week_end: string }) => `${fmtDay(w.week_start)} – ${fmtDay(w.week_end)}`;
export const capText = (a: BillLine["authorization"]) => a.units_per_period == null || !a.period_type ? "—"
  : `${a.units_per_period} / ${a.period_type.replace("per_", "")} · ${a.period_left ?? "—"} left`;

/** Clients with their lines, in table order, plus per-client totals. */
export function byClient(lines: BillLine[]) {
  const out: { client_id: string; name: string; case_number: string | null; lines: BillLine[]; totals: { s: number; b: number; l: number } }[] = [];
  for (const l of lines) {
    let c = out.find((x) => x.client_id === l.client_id);
    if (!c) { c = { client_id: l.client_id, name: clientShort(l.client_first_name, l.client_last_initial), case_number: l.case_number, lines: [], totals: { s: 0, b: 0, l: 0 } }; out.push(c); }
    c.lines.push(l); c.totals.s += Number(l.units_scheduled); c.totals.b += Number(l.units_billed); c.totals.l += Number(l.units_lost_late);
  }
  return out;
}

const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** The claim CSV: one row per client x authorization, a total row; units only. */
export function billingCsv(w: BillingWeek): string {
  const head = ["Week start", "Week end", "Office", "Client", "Case number", "Authorization #", "Service", "Service code", "Notes", "Units scheduled", "Units billed", "Units lost to late arrival"];
  const rows = w.lines.map((l) => [w.week_start, w.week_end, w.office.name, clientShort(l.client_first_name, l.client_last_initial), l.case_number ?? "",
    l.authorization.auth_number, SERVICE_LABEL[l.authorization.service_type] ?? l.authorization.service_type, l.authorization.service_code ?? "",
    l.notes.length, l.units_scheduled, l.units_billed, l.units_lost_late]);
  const t = w.totals;
  rows.push([w.week_start, w.week_end, w.office.name, "TOTAL", "", "", "", "", t.notes, t.units_scheduled, t.units_billed, t.units_lost_late]);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
/** ripple-billing-<office-code>-<week-start>.csv (no client names). */
export const csvFileName = (w: BillingWeek) => `ripple-billing-${(w.office.code || "office").toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${w.week_start}.csv`;

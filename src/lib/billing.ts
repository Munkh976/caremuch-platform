/**
 * Weekly Billing (Ripple S9 / S9b): shapes of get_billing_week (the main bill plus supplementary bills of a week),
 * exclusion reasons, week navigation and the CSV for the claim (units only, no dollars). The CSV is built on demand
 * in memory and handed to the browser as a download; nothing is stored. Its file name never carries a client name.
 */
import { clientShort, fmtDay, SERVICE_LABEL } from "./caregiverNotes";

export interface BillNote { note_id: string; service_date: string; scheduled_start: string; caregiver_name: string | null; units_scheduled: number; units_billed: number; arrived_late: boolean; left_early?: boolean; approved: boolean }
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
/** One bill of the week: the main bill (supplement 0) or a supplementary bill (1, 2, ...; S9b). */
export interface BillBatch {
  id: string; supplement: number; status: "open" | "approved" | "billed";
  approved_at: string | null; approved_by_name: string | null; billed_at: string | null; billed_by_name: string | null;
  lines: BillLine[]; totals: { notes: number; units_scheduled: number; units_billed: number; units_lost_late: number; approved: number };
}
/** What "Build" does now (server): build, rebuild (open), reopen (approved), supplement (billed + notes waiting), none. */
export type NextAction = "build" | "rebuild" | "reopen" | "supplement" | "none";
export interface BillingWeek {
  office: { id: string; name: string; code: string | null; timezone: string; billing_week_start: number };
  today: string; current_week_start: string; last_complete_week_start: string; week_start: string; week_end: string; complete: boolean;
  next_action: NextAction; waiting_for_supplement: number; batches: BillBatch[];
  excluded: Exclusion[]; pending_review: number;
}

export const batchName = (b: BillBatch) => (b.supplement === 0 ? "Main bill" : `Supplement ${b.supplement}`);
/** The week's newest bill (the one "Build" works on). */
export const newestBatch = (w: BillingWeek) => w.batches.reduce<BillBatch | null>((a, b) => (!a || b.supplement > a.supplement ? b : a), null);

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
  reviewed_after_approval: "Reviewed after approval: build the week again to reopen it",
  reviewed_after_billing: "Reviewed after billing: build a supplement",
};
/** Where an exclusion is fixed: the S8 note detail, or the S8 queue's Overdue view for a visit with no note. */
export const fixLink = (x: Exclusion) => x.note_id ? `/progress-notes/${x.note_id}` : "/progress-notes?status=overdue";

/** Why "Approve" is not available yet for this (open) bill (empty = it is): every reviewed note of the week must be
 *  in it and none may wait for review (a note reviewed later reopens the bill or needs a supplement). */
export function approveBlockers(w: BillingWeek, b: BillBatch | null): string[] {
  const out: string[] = [];
  if (!b) out.push("Build the week first.");
  else if (b.status !== "open") return [];
  if (b && b.lines.length === 0) out.push("The bill has no reviewed notes.");
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
/** The claim CSV of one bill (main or supplement): one row per client x authorization, a total row; units only. */
export function billingCsv(w: BillingWeek, b: BillBatch): string {
  const head = ["Week start", "Week end", "Office", "Bill", "Client", "Case number", "Authorization #", "Service", "Service code", "Notes", "Units scheduled", "Units billed", "Units not billed (late / early)"];
  const bill = b.supplement === 0 ? "main" : `supplement ${b.supplement}`;
  const rows = b.lines.map((l) => [w.week_start, w.week_end, w.office.name, bill, clientShort(l.client_first_name, l.client_last_initial), l.case_number ?? "",
    l.authorization.auth_number, SERVICE_LABEL[l.authorization.service_type] ?? l.authorization.service_type, l.authorization.service_code ?? "",
    l.notes.length, l.units_scheduled, l.units_billed, l.units_lost_late]);
  const t = b.totals;
  rows.push([w.week_start, w.week_end, w.office.name, bill, "TOTAL", "", "", "", "", t.notes, t.units_scheduled, t.units_billed, t.units_lost_late]);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
/** ripple-billing-<office-code>-<week-start>[-s<n>].csv (no client names). */
export const csvFileName = (w: BillingWeek, b: BillBatch) =>
  `ripple-billing-${(w.office.code || "office").toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${w.week_start}${b.supplement > 0 ? `-s${b.supplement}` : ""}.csv`;

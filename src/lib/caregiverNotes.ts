/**
 * Caregiver progress note (Ripple S7): shapes returned by the caregiver-safe RPCs, office-time-zone
 * helpers (every time is shown and entered in the shift office's zone, never the phone's), and the
 * answer rules that mirror the server's draft / submit validation (cp_validate_answer).
 * Nothing here stores anything: the note lives in component memory only (no local/session storage).
 */

// ---------- get_caregiver_clock ----------
export interface CaregiverClock { now: string; today: string; timezone: string; week_start: string; week_end: string; first_name: string | null }

// ---------- list_my_notes_due ----------
export type NoteStatus = "not_started" | "draft" | "returned" | "submitted" | "reviewed";
export interface NoteDueItem {
  shift_id: string; shift_date: string; start_time: string; end_time: string;
  scheduled_start: string; scheduled_end: string; service_type: "cls" | "respite";
  client_first_name: string | null; client_last_initial: string | null;
  note_status: NoteStatus; due_at: string; overdue: boolean; returned_reason: string | null;
}
export const OPEN_STATUSES: NoteStatus[] = ["not_started", "draft", "returned"];
export const isOpen = (s: NoteStatus) => OPEN_STATUSES.includes(s);
export const STATUS_LABEL: Record<NoteStatus, string> = {
  not_started: "Not started", draft: "Draft", returned: "Returned", submitted: "Submitted", reviewed: "Reviewed",
};
export const SERVICE_LABEL: Record<string, string> = { cls: "CLS", respite: "Respite" };
export const clientShort = (first: string | null, initial: string | null) =>
  [first ?? "", initial ? `${initial}.` : ""].filter(Boolean).join(" ") || "Client";

/** To-do first (returned, then overdue, then by due time), then history (newest first). */
export function sortNotes(items: NoteDueItem[]): { todo: NoteDueItem[]; history: NoteDueItem[] } {
  const rank = (i: NoteDueItem) => (i.note_status === "returned" ? 0 : i.overdue ? 1 : 2);
  const todo = items.filter((i) => isOpen(i.note_status))
    .sort((a, b) => rank(a) - rank(b) || a.due_at.localeCompare(b.due_at));
  const history = items.filter((i) => !isOpen(i.note_status)).sort((a, b) => b.scheduled_start.localeCompare(a.scheduled_start));
  return { todo, history };
}

// ---------- get_progress_note_for_caregiver ----------
export type MeasureKind = "yes_no_na" | "prompt_level" | "graded_steps" | "tally" | "trials" | "short_answer" | "narrative" | "staff_note";
export interface NoteMeasure { measure_id: string; kind: MeasureKind; prompt_text: string | null; options: string[] | null; trial_count: number | null }
export interface NoteEntry {
  entry_id: string; goal_text: string | null; objective_letter: string | null; objective_text: string | null;
  staff_instructions: string | null; notes_text: string | null; answers: Record<string, Answer> | null; measures: NoteMeasure[];
}
export interface CaregiverNote {
  note: {
    id: string; status: "draft" | "returned" | "submitted" | "reviewed" | "billed"; note_kind: "cls" | "respite"; service_date: string;
    scheduled_start: string; scheduled_end: string; client_arrived_at: string | null; actual_end: string | null;
    staff_client_ratio: string | null; location: string | null; narrative_text: string | null;
    staff_signature_name: string | null; staff_signed_at: string | null; returned_reason: string | null;
    late_submitted: boolean; arrived_late: boolean; due_at: string; client_first_name: string | null; client_last_initial: string | null;
  };
  entries: NoteEntry[];
}
export const isEditable = (s: CaregiverNote["note"]["status"]) => s === "draft" || s === "returned";

// ---------- answers ----------
export type TrialAnswer = { value?: "Yes" | "No" | "N/A"; text?: string };
export type Answer =
  | { value: string }                 // yes_no_na, prompt_level, short_answer, narrative
  | { steps: number[] }               // graded_steps
  | { count: number }                 // tally
  | { trials: TrialAnswer[] };        // trials

/**
 * The value the server should get for one measure while drafting, or undefined to leave it unanswered.
 * Mirrors cp_validate_answer(_, _, false): a partial trials list or an unknown prompt level would be
 * refused, so they are left out until complete. Tally and graded steps always have a value (0 / none).
 */
export function draftAnswer(m: NoteMeasure, a: Answer | undefined): Answer | undefined {
  switch (m.kind) {
    case "staff_note": return undefined;
    case "tally": return { count: a && "count" in a ? Math.max(0, Math.min(1000, Math.round(a.count))) : 0 };
    case "graded_steps": return { steps: a && "steps" in a ? [...new Set(a.steps)].sort((x, y) => x - y) : [] };
    case "trials": {
      if (!a || !("trials" in a)) return undefined;
      const n = m.trial_count ?? 0;
      const t = a.trials.slice(0, n);
      if (t.length !== n || t.some((x) => !x?.value)) return undefined;
      return { trials: t.map((x) => (x.text && x.text.trim() ? { value: x.value!, text: x.text.slice(0, 500) } : { value: x.value! })) };
    }
    case "prompt_level": return a && "value" in a && (m.options ?? []).includes(a.value) ? { value: a.value } : undefined;
    case "yes_no_na": return a && "value" in a && ["Yes", "No", "N/A"].includes(a.value) ? { value: a.value } : undefined;
    case "short_answer": case "narrative": return a && "value" in a && a.value !== "" ? { value: a.value } : undefined;
  }
}
/** Entry data for save_progress_note_draft: only answered measures (keys = measure ids). */
export function entryData(measures: NoteMeasure[], answers: Record<string, Answer>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const m of measures) { const v = draftAnswer(m, answers[m.measure_id]); if (v !== undefined) out[m.measure_id] = v; }
  return out;
}
/** Measures still unanswered for submit (server: "Every question must be answered"). */
export function missingAnswers(measures: NoteMeasure[], answers: Record<string, Answer>): NoteMeasure[] {
  return measures.filter((m) => {
    if (m.kind === "staff_note") return false;
    const v = draftAnswer(m, answers[m.measure_id]);
    if (v === undefined) return true;
    return (m.kind === "short_answer" || m.kind === "narrative") && "value" in v && v.value.trim() === "";
  });
}

// ---------- office time zone ----------
const parts = (d: Date, tz: string) => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
};
/** Offset (ms) of `tz` from UTC at instant `d`. */
const tzOffset = (d: Date, tz: string) => { const p = parts(d, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000; };
/** Wall clock date + "HH:MM" in `tz` -> the UTC instant (ISO). */
export function zonedToIso(date: string, hhmm: string, tz: string): string {
  const [y, mo, d] = date.split("-").map(Number); const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffset(new Date(guess), tz);
  t = guess - tzOffset(new Date(t), tz);                     // second pass settles DST edges
  return new Date(t).toISOString();
}
/** Instant -> "HH:MM" (24 h, for time inputs) in `tz`. */
export function isoToHhmm(iso: string, tz: string): string { const p = parts(new Date(iso), tz); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; }
/** Instant -> "YYYY-MM-DD" in `tz`. */
export function isoToDate(iso: string, tz: string): string { const p = parts(new Date(iso), tz); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; }
/** Display, e.g. "1:00 PM" or "Mon, Oct 6, 1:00 PM", in `tz`. */
export function fmtTime(iso: string, tz: string, withDate = false): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}) }).format(new Date(iso));
}
export function fmtDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}
/**
 * A time typed for this shift -> instant. The candidate is on the service date; arrival may be up to 60
 * minutes before the start, so anything earlier than that belongs to the next day (overnight shifts);
 * the same for the end against the start.
 */
export function shiftTimeToIso(serviceDate: string, hhmm: string, tz: string, scheduledStart: string, earliestBeforeStartMin: number): string {
  const iso = zonedToIso(serviceDate, hhmm, tz);
  if (Date.parse(iso) < Date.parse(scheduledStart) - earliestBeforeStartMin * 60000) {
    const [y, m, d] = serviceDate.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    return zonedToIso(next, hhmm, tz);
  }
  return iso;
}

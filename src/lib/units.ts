/**
 * Units to bill (Ripple S12, Oct 6): only the shift's scheduled 15-minute blocks (start, start+15, ...) that lie
 * completely inside [client arrival, client end time], compared at minute precision. An arrival at or before the
 * start counts as the start, an end at or after the scheduled end as the end; never more than the units scheduled.
 * The server (cp_derive_progress_note_units) stores the units; this mirrors it for the caregiver's live preview and
 * gives the reason shown next to stored units ("late arrival", "left early").
 */
const MIN = 60_000, BLOCK = 15 * MIN;
const toMin = (iso: string) => Math.floor(Date.parse(iso) / MIN) * MIN;

export interface UnitsPreview { units: number; scheduled: number; late: boolean; early: boolean }

export function unitsToBill(p: { scheduledStart: string; scheduledEnd: string; unitsScheduled?: number | null; arrival?: string | null; end?: string | null;
  /** S18: the office rule the server will count with (get_progress_note_for_caregiver note.units_rule); default full blocks */
  rule?: { rule: UnitsRule; grace_minutes?: number | null } | null }): UnitsPreview {
  const s = Date.parse(p.scheduledStart), e = Date.parse(p.scheduledEnd);
  const scheduled = p.unitsScheduled ?? Math.max(0, Math.floor((e - s) / BLOCK));
  const from = Math.max(p.arrival ? toMin(p.arrival) : s, s), to = Math.min(p.end ? toMin(p.end) : e, e);
  const units = p.rule && p.rule.rule !== "full_blocks"
    ? Math.min(unitsUnderRule({ scheduledStart: p.scheduledStart, scheduledEnd: p.scheduledEnd, arrival: p.arrival, end: p.end, rule: p.rule.rule, grace: p.rule.grace_minutes ?? 0 }), scheduled)
    : Math.min(Math.max(Math.floor((to - s) / BLOCK) - Math.ceil((from - s) / BLOCK), 0), scheduled);
  return { units, scheduled, late: !!p.arrival && toMin(p.arrival) > s, early: !!p.end && toMin(p.end) < e };
}

/** S18: how the shortfall is counted under the office rule (shown after the reason). */
export function unitsRuleNote(rule?: { rule: UnitsRule; grace_minutes?: number | null } | null): string {
  if (rule?.rule === "nearest") return "minutes served are rounded to the nearest 15";
  if (rule?.rule === "grace") return `only full 15-minute blocks are billed; up to ${rule.grace_minutes ?? 0} minutes late or early counts as on time`;
  return "only full 15-minute blocks are billed";
}

/** "late arrival", "left early", or both (empty when nothing explains a shortfall). */
export function notBilledReason(late: boolean, early: boolean, joiner = " and "): string {
  return [late ? "late arrival" : "", early ? "left early" : ""].filter(Boolean).join(joiner);
}

/** Left before the scheduled end, at minute precision (for stored notes). */
export const leftEarly = (actualEnd: string | null | undefined, scheduledEnd: string) => !!actualEnd && toMin(actualEnd) < Date.parse(scheduledEnd);

/** S18: the office units rules (virtual_office.units_rule); the defaults (full blocks, no grace) are the S12 rule above. */
export type UnitsRule = "full_blocks" | "nearest" | "grace";
export const UNITS_RULES: { value: UnitsRule; label: string; hint: string }[] = [
  { value: "full_blocks", label: "Full 15-minute blocks", hint: "Only the scheduled 15-minute blocks the client was there for the whole of (today's rule)." },
  { value: "grace", label: "Full blocks with a grace period", hint: "Arriving up to N minutes late or leaving up to N minutes early counts as on time." },
  { value: "nearest", label: "Nearest 15 minutes", hint: "Minutes served inside the scheduled time, divided by 15, rounded to the nearest unit." },
];

/** Mirrors cp_units_for (S18) for the settings card's examples; capped at the units scheduled. */
export function unitsUnderRule(p: { scheduledStart: string; scheduledEnd: string; arrival?: string | null; end?: string | null; rule: UnitsRule; grace?: number }): number {
  const s = Date.parse(p.scheduledStart), e = Date.parse(p.scheduledEnd);
  const scheduled = Math.max(0, Math.floor((e - s) / BLOCK));
  let from = Math.max(p.arrival ? toMin(p.arrival) : s, s), to = Math.min(p.end ? toMin(p.end) : e, e);
  if (p.rule === "grace") {
    const g = (p.grace ?? 0) * MIN;
    if (from - s <= g) from = s;
    if (e - to <= g) to = e;
  }
  const units = p.rule === "nearest" ? Math.max(Math.floor((to - from) / BLOCK + 0.5), 0) : Math.max(Math.floor((to - s) / BLOCK) - Math.ceil((from - s) / BLOCK), 0);
  return Math.min(units, scheduled);
}

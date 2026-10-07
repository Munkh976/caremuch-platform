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

export function unitsToBill(p: { scheduledStart: string; scheduledEnd: string; unitsScheduled?: number | null; arrival?: string | null; end?: string | null }): UnitsPreview {
  const s = Date.parse(p.scheduledStart), e = Date.parse(p.scheduledEnd);
  const scheduled = p.unitsScheduled ?? Math.max(0, Math.floor((e - s) / BLOCK));
  const from = Math.max(p.arrival ? toMin(p.arrival) : s, s), to = Math.min(p.end ? toMin(p.end) : e, e);
  const units = Math.min(Math.max(Math.floor((to - s) / BLOCK) - Math.ceil((from - s) / BLOCK), 0), scheduled);
  return { units, scheduled, late: !!p.arrival && toMin(p.arrival) > s, early: !!p.end && toMin(p.end) < e };
}

/** "late arrival", "left early", or both (empty when nothing explains a shortfall). */
export function notBilledReason(late: boolean, early: boolean, joiner = " and "): string {
  return [late ? "late arrival" : "", early ? "left early" : ""].filter(Boolean).join(joiner);
}

/** Left before the scheduled end, at minute precision (for stored notes). */
export const leftEarly = (actualEnd: string | null | undefined, scheduledEnd: string) => !!actualEnd && toMin(actualEnd) < Date.parse(scheduledEnd);

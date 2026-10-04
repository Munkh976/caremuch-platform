import { parseISO } from "date-fns";

/**
 * Parses a Postgres `date`-only string ("YYYY-MM-DD") as LOCAL midnight.
 *
 * `new Date("YYYY-MM-DD")` parses as UTC midnight per the ECMAScript spec, which
 * `.toLocaleDateString()`/day-bucket comparisons then render as the PREVIOUS calendar day
 * anywhere west of UTC (all of the US). `parseISO` treats a date-only string as local
 * midnight instead, which is the fix documented in docs/known-issues.md's "Systemic
 * date-only-string parsing bug" entry. Use this everywhere a `shift_date` column is turned
 * into a `Date` — never `new Date(shift.shift_date)`.
 */
export function parseShiftDate(dateOnlyString: string): Date {
  return parseISO(dateOnlyString);
}

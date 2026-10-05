import { differenceInCalendarDays, parseISO } from "date-fns";

/**
 * Parse a Postgres `date` value ("YYYY-MM-DD") as LOCAL midnight. `new Date("YYYY-MM-DD")` parses as
 * UTC midnight and shows the previous day west of UTC (known-issues: "Systemic date-only-string
 * parsing bug"); `parseISO` treats a date-only string as local. Use this for every date-only column.
 */
export function parseDateOnly(value: string): Date {
  return parseISO(value);
}

/** Whole calendar days from `today` to the date-only `value` (negative = in the past). */
export function daysUntil(value: string, today: Date = new Date()): number {
  return differenceInCalendarDays(parseDateOnly(value), today);
}

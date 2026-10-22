import { format } from "date-fns";
import { parseDateOnly } from "@/lib/dateOnly";

/**
 * S17 owner decisions 1a + 1d, the same rule as the database trigger (cp_guard_shift_dates): a recurring series stops at
 * the active IPOS's expiration date and, for CLS / respite, at the latest end date of the client's authorizations of that
 * service type; the skipped visits are reported with the reason. The trigger stays the backstop for every writer.
 */
export interface ShiftLimits {
  rules: boolean;
  ipos?: { version: number; expiration_date: string | null } | null;
  services?: { care_type_code: string; service_type: string; authorized_until: string | null }[];
}
export interface Skipped { reason: string; count: number; first: string }
const d = (s: string) => format(parseDateOnly(s), "MMM d, yyyy");
const svcLabel = (s: string) => (s === "cls" ? "CLS" : "respite");

export function splitByLimits<T extends { shift_date: string; care_type_code: string }>(rows: T[], limits: ShiftLimits | null | undefined): { keep: T[]; skipped: Skipped[] } {
  if (!limits || !limits.rules) return { keep: rows, skipped: [] };
  const keep: T[] = []; const by = new Map<string, Skipped>();
  const skip = (reason: string, date: string) => { const s = by.get(reason) ?? { reason, count: 0, first: date }; s.count++; if (date < s.first) s.first = date; by.set(reason, s); };
  const exp = limits.ipos?.expiration_date ?? null;
  for (const r of rows) {
    if (exp && r.shift_date > exp) { skip(`after IPOS v${limits.ipos!.version} expires (${d(exp)})`, r.shift_date); continue; }
    const svc = limits.services?.find((s) => s.care_type_code === r.care_type_code);
    if (svc?.authorized_until && r.shift_date > svc.authorized_until) { skip(`no ${svcLabel(svc.service_type)} authorization after ${d(svc.authorized_until)}`, r.shift_date); continue; }
    keep.push(r);
  }
  return { keep, skipped: [...by.values()] };
}

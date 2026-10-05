import { daysUntil } from "@/lib/dateOnly";

export type ExpiryBand = "overdue" | "red" | "yellow" | "ok" | "none";

/** Q16 (fixed thresholds): ★ overdue (before today), red ≤ 30 days, yellow ≤ 60 days, otherwise ok. */
export function expiryBand(expiry: string | null | undefined, today: Date = new Date()): ExpiryBand {
  if (!expiry) return "none";
  const d = daysUntil(expiry, today);
  if (d < 0) return "overdue";
  if (d <= 30) return "red";
  if (d <= 60) return "yellow";
  return "ok";
}

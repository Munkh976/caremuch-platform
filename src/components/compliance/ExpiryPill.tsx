import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { daysUntil, parseDateOnly } from "@/lib/dateOnly";
import { expiryBand, type ExpiryBand } from "./expiry";

const STYLE: Record<ExpiryBand, string> = {
  overdue: "border-transparent bg-destructive text-destructive-foreground",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
  yellow: "border-warning/40 bg-warning/15 text-foreground",
  ok: "border-success/40 bg-success/10 text-foreground",
  none: "text-muted-foreground",
};

function describe(expiry: string, today: Date): string {
  const d = daysUntil(expiry, today);
  if (d < 0) return `★ Overdue ${-d} day${d === -1 ? "" : "s"}`;
  if (d === 0) return "Expires today";
  if (d <= 60) return `Expires in ${d} day${d === 1 ? "" : "s"}`;
  return `Valid to ${format(parseDateOnly(expiry), "MMM d, yyyy")}`;
}

/** Expiry status of a date-only value (credential, authorization, plan). */
export function ExpiryPill({ expiry, today, className }: { expiry: string | null | undefined; today?: Date; className?: string }) {
  const now = today ?? new Date();
  const band = expiryBand(expiry, now);
  return (
    <Badge
      variant="outline"
      className={cn("whitespace-nowrap font-medium", STYLE[band], className)}
      title={expiry ? format(parseDateOnly(expiry), "MMM d, yyyy") : undefined}
      data-band={band}
    >
      {expiry ? describe(expiry, now) : "No expiry date"}
    </Badge>
  );
}

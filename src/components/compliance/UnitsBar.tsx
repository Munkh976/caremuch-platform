import { cn } from "@/lib/utils";

export interface UnitsPeriodCap {
  /** "day" | "week" | "month" | "quarter" (the authorization's period). */
  period: string;
  cap: number;
  /** Units charged + pending in the current period. */
  usedInPeriod: number;
}

export interface UnitsBarProps {
  authorized: number;
  /** Units charged to the authorization (reviewed/billed notes + the opening balance). */
  used: number;
  /** Units of scheduled and not-yet-charged work (projected). */
  pending?: number;
  /** Minutes per unit, for the hours figure (default 15). */
  unitMinutes?: number;
  periodCap?: UnitsPeriodCap | null;
  className?: string;
}

const hours = (units: number, unitMinutes: number) => {
  const h = (units * unitMinutes) / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(2)} h`;
};

/** Authorized / used / pending / left, in units and hours. Units only: never dollars. */
export function UnitsBar({ authorized, used, pending = 0, unitMinutes = 15, periodCap, className }: UnitsBarProps) {
  const left = authorized - used - pending;
  const total = Math.max(authorized, used + pending, 1);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  const periodLeft = periodCap ? periodCap.cap - periodCap.usedInPeriod : null;
  return (
    <div className={cn("w-full min-w-0 space-y-1", className)}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${used} used, ${pending} pending, ${Math.max(left, 0)} left of ${authorized} units`}
      >
        <div className="h-full bg-primary" style={{ width: pct(used) }} />
        <div className="h-full bg-primary/40" style={{ width: pct(pending) }} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>
          {used} used{pending > 0 ? ` · ${pending} pending` : ""} of {authorized}
        </span>
        <span className={cn("font-medium", left < 0 ? "text-destructive" : "text-foreground")}>
          {left < 0 ? `Over by ${-left} units` : `${left} units left (${hours(left, unitMinutes)})`}
        </span>
      </div>
      {periodCap && periodLeft !== null && (
        <div className={cn("text-xs", periodLeft <= 0 ? "text-destructive" : "text-muted-foreground")}>
          {Math.max(periodLeft, 0)} left this {periodCap.period} (cap {periodCap.cap})
        </div>
      )}
    </div>
  );
}

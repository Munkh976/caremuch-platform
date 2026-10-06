import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { EligibilityResult } from "@/lib/shiftEligibility";
import { complianceLines, isComplianceCode, type ComplianceLine } from "@/lib/eligibilityCompliance";

/**
 * Ripple context (S10): pass `ripple` for an office using the care-plan module; its care-plan checks
 * are then grouped as "Care-plan checks" with a Fix → link each (advisory while enforcement is off,
 * Blocked once it is on, as the server reports them). Without it the report is exactly as before.
 */
export type EligibilityContext = { ripple: boolean; caregiverId?: string | null; clientId?: string | null };

export function ComplianceLines({ lines }: { lines: ComplianceLine[] }) {
  if (lines.length === 0) return null;
  const blocked = lines.some((l) => l.blocked);
  const advisory = lines.some((l) => !l.blocked);
  return (
    <div className="space-y-1" data-testid="elig-compliance" data-mode={blocked ? "blocked" : "advisory"}>
      <p className={`text-xs font-medium ${blocked ? "text-destructive" : "text-warning"}`}>
        Care-plan checks{advisory ? " — Advisory lines don't block: enforcement is off for this office" : ""}
      </p>
      {lines.map((l, i) => (
        <div key={`${l.issue.code}-${i}`} data-testid={`elig-line-${l.issue.code}`} data-blocked={l.blocked ? "true" : "false"}
          className={`rounded border p-2 ${l.blocked ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5"}`}>
          <div className={`flex flex-wrap items-center gap-2 text-xs font-medium ${l.blocked ? "text-destructive" : "text-warning"}`}>
            {l.blocked
              ? <Badge variant="destructive" className="text-[10px]">Blocked</Badge>
              : <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">Advisory</Badge>}
            {l.label}
            {l.fix && (
              <a href={l.fix.href} target="_blank" rel="noopener noreferrer" data-testid={`elig-fix-${l.issue.code}`}
                className="ml-auto text-primary underline-offset-2 hover:underline">
                Fix → {l.fix.text}
              </a>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{l.issue.detail}</p>
        </div>
      ))}
    </div>
  );
}

export function EligibilityReport({ result, context }: { result: EligibilityResult; context?: EligibilityContext }) {
  const ripple = !!context?.ripple;
  const lines = ripple ? complianceLines(result, { caregiverId: context?.caregiverId, clientId: context?.clientId }) : [];
  const blockers = ripple ? result.blockers.filter((b) => b.overridable || !isComplianceCode(b.code)) : result.blockers;
  const flags = ripple ? result.flags.filter((f) => !isComplianceCode(f.code)) : result.flags;
  const advisoryOnly = lines.length > 0 && lines.every((l) => !l.blocked);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        {result.autoApprovable && !advisoryOnly ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="font-medium text-success">All checks passed — no manager approval needed</span>
          </>
        ) : result.autoApprovable ? (
          <>
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="font-medium text-warning">Allowed — care-plan checks are advisory</span>
          </>
        ) : result.eligible ? (
          <>
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="font-medium text-warning">Allowed, but needs manager approval</span>
          </>
        ) : (
          <>
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <span className="font-medium text-destructive">Blocked</span>
          </>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        Week hours: {result.weeklyHours}h → <span className="font-medium">{result.projectedWeeklyHours}h</span>
      </div>

      <ComplianceLines lines={lines} />

      {blockers.length > 0 && (
        <div className="space-y-1">
          {blockers.map((b, i) => (
            <div key={`${b.code}-${i}`} className="rounded border border-destructive/30 bg-destructive/5 p-2">
              <div className="flex items-center gap-2 text-xs font-medium text-destructive">
                <Badge variant="destructive" className="text-[10px]">Blocked</Badge>
                {b.label}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{b.detail}</p>
            </div>
          ))}
        </div>
      )}

      {flags.length > 0 && (
        <div className="space-y-1">
          {flags.map((f, i) => (
            <div key={`${f.code}-${i}`} className="rounded border border-warning/30 bg-warning/5 p-2">
              <div className="flex items-center gap-2 text-xs font-medium text-warning">
                <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">Review</Badge>
                {f.label}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{f.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

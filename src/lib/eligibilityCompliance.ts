/**
 * Ripple care-plan checks in an eligibility result (S10). check_assignment_eligibility reports them
 * as advisory while the office's compliance enforcement is off and as hard blockers once it is on;
 * the text always comes from the server. This file only groups them, names group_full by its ratio
 * and says where each one is fixed. Kind-Care-only offices never get these lines (display only;
 * the RPCs remain the enforcement).
 */
import type { EligibilityIssue, EligibilityResult } from "./shiftEligibility";

export const COMPLIANCE_CODES = [
  "credential_missing", "certification_expired", "certification_unverified", "training_missing",
  "authorization_missing", "authorization_expired", "units_short", "units_short_period", "group_full",
] as const;
const CODES = new Set<string>(COMPLIANCE_CODES);
export const isComplianceCode = (code: string) => CODES.has(code);

export interface ComplianceLine { issue: EligibilityIssue; blocked: boolean; label: string; fix: { href: string; text: string } | null }

/** "Group is full (1:3)": the ratio comes from the server text ("already has N of M clients"). */
export function complianceLabel(i: EligibilityIssue): string {
  if (i.code !== "group_full") return i.label;
  const m = /of (\d+) clients?/.exec(i.detail ?? "");
  return `Group is full (1:${m ? m[1] : 3})`;
}

/** Where a check is fixed: the caregiver's Credentials tab, the client's training page, or the client's IPOS / Authorizations. */
export function fixLinkFor(code: string, ctx: { caregiverId?: string | null; clientId?: string | null }) {
  if ((code === "credential_missing" || code === "certification_expired" || code === "certification_unverified") && ctx.caregiverId)
    return { href: `/caregivers?caregiver=${ctx.caregiverId}&tab=credentials`, text: "Credentials" };
  if (code === "training_missing" && ctx.clientId) return { href: `/training/${ctx.clientId}`, text: "Training" };
  if ((code.startsWith("authorization_") || code.startsWith("units_short")) && ctx.clientId)
    return { href: `/care-plans/${ctx.clientId}?tab=ipos`, text: "IPOS / Authorizations" };
  return null;
}

/** The care-plan lines of a result: blocked (hard, enforcement on) first, then advisory (enforcement off). */
export function complianceLines(r: EligibilityResult, ctx: { caregiverId?: string | null; clientId?: string | null; extra?: EligibilityIssue[] }): ComplianceLine[] {
  const hard = r.blockers.filter((b) => !b.overridable && isComplianceCode(b.code));
  const adv = r.flags.filter((f) => isComplianceCode(f.code)).concat(ctx.extra ?? []);   // extra: UI-computed advisories (S12 group ratio)
  return [...hard.map((issue) => ({ issue, blocked: true })), ...adv.map((issue) => ({ issue, blocked: false }))]
    .map((l) => ({ ...l, label: complianceLabel(l.issue), fix: fixLinkFor(l.issue.code, ctx) }));
}

/** Caregiver view (R6): the server already collapses client-side checks into one generic 'not_bookable'; show it once. */
export function dedupeIssues(list: EligibilityIssue[]): EligibilityIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => { const k = `${i.code}|${i.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

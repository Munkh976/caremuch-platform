import type { EligibilityResult } from "@/lib/shiftEligibility";

/** Care-plan advisory codes the enforcement switch would turn into blocks (same list as the database gate cp_gate_issues). */
export const GATE_ADVISORY = ["credential_missing", "training_missing", "authorization_missing", "authorization_expired", "units_short", "units_short_period"];

/**
 * The Auto-assign gate (owner 4a) on one eligibility result: passes only with no hard issue, no soft issue and none of
 * the care-plan advisories above. The client-onboarded part is checked by the server (callers may not see it).
 */
export const passesAutoAssignGate = (r: EligibilityResult | null | undefined) =>
  !!r && r.eligible && r.overridable.length === 0 && !r.flags.some((f) => GATE_ADVISORY.includes(f.code) || f.code === CAREGIVER_SAFE_GATE_CODE);
/** The caregiver-safe eligibility (cp_caregiver_safe_eligibility, Phase C R6) folds the care-plan codes into this one. */
export const CAREGIVER_SAFE_GATE_CODE = "not_bookable";

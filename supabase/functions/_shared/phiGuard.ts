// Phase 3 Tranche 3C: deterministic, no-LLM PHI/PII guard. Fail-closed on every
// non-SAFE state -- per the 3D provider decision, this guard is the ENTIRE
// legal/compliance barrier on this path (phiAllowed stays false; no BAA underneath
// it), not defense-in-depth alongside one. A SAFE result means only "passed these
// deterministic structured controls" -- it is never evidence that content is
// actually PHI-free, and must never be represented as such.
//
// Layer 1 (this file): bounded, provably-linear-time structured-identifier regexes,
// language-agnostic by construction. Verified against adversarial input in the real
// Deno Edge Runtime via a throwaway timing-probe function (not assumed safe from
// pattern inspection alone) -- see the Tranche 3C build notes.
//
// MRN/care-record-identifier pattern: DROPPED, not deferred. Resolved at build time
// per the Tranche 3C plan's explicit rule (§7.5): keep only if a concrete, tightly
// bounded CareMuch identifier format exists; a repo-wide grep for
// MRN/medical_record/record_number/case_number/client_number
// (2026-09-05) found zero matches outside the planning doc itself -- no such format
// exists anywhere in this codebase. An unbounded generic digit-run rule is explicitly
// prohibited (it would catch ZIP codes, policy numbers, years, phone numbers), so
// this pattern does not exist here at all rather than being built unbounded.
//
// Credit-card pattern: DROPPED. No CareMuch-specific threat rationale was
// established for it during plan review -- home-care agency knowledge content has no
// payment-card handling context that would make this a realistic accidental-PHI
// vector, unlike SSN/phone/email/DOB.
//
// Layer 3 (name/context heuristic): EXCLUDED entirely, not built as an optional
// future layer. Name/term dictionary matching is unreliable in both languages
// equally and could never clear content, only delay it with false confidence --
// the ingestion-side answer to this gap is human attestation (see
// PHI_ATTESTATION_STRING below), not a machine heuristic.

/**
 * Required, exact-match attestation string for document ingestion. Server-enforced:
 * validated in ingest-knowledge-document BEFORE any Storage access, with no default
 * and no partial/fuzzy match accepted. This is Layer 2 -- it exists because Layer 1's
 * structured patterns cannot detect name/context PHI (a client's name mentioned in
 * prose, a family member referenced by relationship), and no reliable machine
 * detector for that exists under the fixed no-LLM constraint.
 */
export const PHI_ATTESTATION_STRING =
  "I confirm this document contains no client, patient, family, or elderly-identifying information.";

/**
 * Hard backstop against pathological input, independent of pattern safety. Even a
 * provably linear-time pattern set takes proportionally longer on proportionally
 * larger input; this caps worst-case guard latency without relying on JS's lack of
 * regex preemption (Deno has no cheap in-process timeout for synchronous RegExp
 * execution -- true preemption would require a Worker + terminate(), which is not
 * justified unless the timing probe ever finds a pattern that isn't safe).
 */
export const MAX_GUARD_INPUT_LENGTH = 500_000;

export type PhiGuardState = "SAFE" | "PHI_DETECTED" | "ERROR" | "UNPROCESSABLE";

export interface PhiGuardResult {
  state: PhiGuardState;
  /** Diagnostic only -- names a pattern CLASS (e.g. "ssn"), never matched content. */
  reason?: string;
}

interface PatternSpec {
  name: string;
  regex: RegExp;
}

// Two independent properties are both required for linear worst-case time, and this
// file's history is the empirical proof of each, not just an inspection claim:
//
// 1. No unbounded quantifier (`+`/`*`) may be followed by a literal/class that can be
//    ABSENT from the input. `X+Y` against input that is all X-class characters with
//    no Y forces the engine to try every possible length of the X+ match at every
//    start position -- O(n) backtrack attempts x O(n) start positions = O(n^2). This
//    is the general shape, and it is NOT about "optional groups" -- the first
//    redesign of the email pattern here removed an optional-group ambiguity and was
//    STILL O(n^2) (measured ~2.6-5.8s against 50-100K-char pure-filler adversarial
//    input in a local V8 run) purely because of its unbounded `[A-Za-z0-9._%+-]+`/
//    `[A-Za-z0-9-]+` classes. The fix is bounding every such quantifier with an
//    explicit, standards-justified maximum (RFC 5321 local-part max 64 octets, DNS
//    label max 63 octets) so backtracking cost per start position is a small
//    constant, not O(n) -- re-verified at ~20ms worst case against the same inputs.
// 2. No two ADJACENT independently-optional constructs may both apply to the same
//    input region -- `(?:A)?(?:B)?` creates 4 parse attempts per start position, and
//    that combinatorial count multiplies with every additional adjacent `?`/`??`
//    group. This was the original phone pattern's bug (optional country-code, optional
//    parens, optional separators, all adjacent) -- measured ~4.7-4.9s against
//    60K-char adversarial input; fixed by using only fixed-width `{n}` groups plus a
//    single backreference (no independently-optional pieces), re-verified at <1ms.
//
// Both failure modes were reproduced and fixed in this same review, not assumed from
// pattern inspection -- verified via a throwaway adversarial-input timing probe run
// first locally (V8/Node) for fast iteration, then in the real Deno Edge Runtime
// (the actual execution environment) before this file was wired into production
// code paths.
// NO pattern below uses \b (word-boundary) anchors at its edges, deliberately.
// \b only fires at a transition between a \w character and a non-\w one -- it does
// NOT fire between two \w characters, so "policy123-45-6789The" (a real shape:
// PDF/DOCX text extraction routinely drops whitespace at line-wraps, hyphenation,
// and page-footer boundaries) would silently fail to match an SSN pattern anchored
// with \b, because 'y' and '1' are both \w, and so are '9' and 'T'. This was caught
// empirically, not anticipated: a chunk-boundary-straddling test fixture built
// during Tranche 3C testing happened to glue its embedded SSN directly to
// surrounding words with no separator, and the \b-anchored pattern missed it
// entirely (ingestion_status came back 'ready', not 'failed'). Dropping the
// boundary anchors trades a small increase in false-positive surface (a pattern
// could now match as a substring of a longer, unrelated digit/character run) for
// closing a false-negative class that is realistic for extracted document text.
// EXPLICIT COST, not just an ingestion-side one: this widening applies identically
// to the query-path guard in search-knowledge -- no \b means a higher rate of
// legitimate anonymous questions getting refused (indistinguishably from "not
// grounded," per design) because some incidental digit/character run inside them
// now resembles a structured pattern. This is accepted as the fail-closed direction
// (a wrongly-refused question costs one retry; a missed PHI-shaped identifier does
// not get a retry), not an overlooked side effect -- the correct tradeoff for a
// fail-closed guard, where a false positive costs staff one blocked upload with a
// diagnostic reason to review and resubmit (ingestion) or one refused question with
// no explanation (query), while a false
// negative silently ships an identifier through. (See the guard's own top-of-file
// comment: "uncertain" must route to block, never pass-with-a-warning.)
const PATTERNS: PatternSpec[] = [
  // Formatted SSN only (xxx-xx-xxxx). Known false-negative: an unformatted 9-digit
  // SSN will not match -- accepted per the plan's own honesty requirement ("catches
  // obvious identifiers," not "proven PHI-free"); an unformatted rule would collide
  // with too many other 9-digit numbers (phone extensions, account numbers) to be a
  // bounded pattern. No optional groups -- single deterministic parse.
  { name: "ssn", regex: /\d{3}-\d{2}-\d{4}/ },
  // US-style phone: NNN-NNN-NNNN, NNN.NNN.NNNN, or NNN NNN NNNN with the SAME
  // separator throughout (backreference), or (NNN) NNN-NNNN. Deliberately narrower
  // than a general-purpose phone matcher (no bare country code, no mixed separators,
  // no bare-digit run) -- each alternative is fully specified with no adjacent
  // independently-optional pieces, which is what keeps it linear. Known
  // false-negative: "+1 555 123 4567" or "555-123.4567" (mixed separators) will not
  // match -- accepted for the same reason as SSN above.
  { name: "phone", regex: /\d{3}([-. ])\d{3}\1\d{4}|\(\d{3}\)[ ]?\d{3}-\d{4}/ },
  // Email address. Two safety properties, both required (see the file header):
  // domain-label class excludes "." so "label.TLD" has only one possible split, AND
  // every quantifier is bounded to a standards-justified maximum (local part <= 64
  // octets per RFC 5321; domain label <= 63 octets per DNS; TLD <= 24, generously
  // above any real-world TLD) instead of unbounded `+`. Known limitations, both
  // accepted: matches on the FIRST label+TLD-shaped substring (so
  // "user@sub.example.com" is still caught, via "sub.example" -- this is a detector,
  // not a validator); a local part longer than 64 chars will not match (a
  // pathological input, not a realistic address).
  { name: "email", regex: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}\.[A-Za-z]{2,24}/ },
  // Numeric date (MM/DD/YYYY or MM-DD-YYYY), a plausible DOB representation. Bounded
  // alternations for each component, not a generic date-shaped catch-all -- does not
  // match every date in running text (e.g. "March 3, 2026" prose form), a deliberate
  // scope limit consistent with "constrained, not every date" from the pattern
  // review. Already empirically verified fast (no redesign needed) -- see the timing
  // probe results.
  { name: "dob", regex: /(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}/ },
];

/**
 * Layer 1: deterministic structured-PII detection over a single combined text blob.
 * Fails closed -- any thrown error or oversized input returns a non-SAFE state
 * rather than silently passing.
 */
export function detectStructuredPhi(combinedText: unknown): PhiGuardResult {
  if (typeof combinedText !== "string") {
    return { state: "ERROR", reason: "guard input was not a string" };
  }
  if (combinedText.length > MAX_GUARD_INPUT_LENGTH) {
    return { state: "UNPROCESSABLE", reason: `input exceeds guard length cap (${MAX_GUARD_INPUT_LENGTH} chars)` };
  }
  try {
    for (const { name, regex } of PATTERNS) {
      if (regex.test(combinedText)) {
        return { state: "PHI_DETECTED", reason: `matched structured pattern: ${name}` };
      }
    }
    return { state: "SAFE" };
  } catch {
    return { state: "ERROR", reason: "guard pattern evaluation threw" };
  }
}

/** Layer 2: server-side attestation check. Exact match only, no normalization. */
export function isValidAttestation(value: unknown): boolean {
  return typeof value === "string" && value === PHI_ATTESTATION_STRING;
}

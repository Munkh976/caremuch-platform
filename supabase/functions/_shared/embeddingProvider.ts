// EmbeddingProvider seam: callers say "embed this text (or these texts)" and never see
// model strings, endpoints, api-versions, or provider-specific request shapes. That's
// what makes swapping OpenAI-direct -> Azure later a config change (EMBEDDING_PROVIDER),
// not a code change -- the two providers differ in exactly those details, and this
// interface exists to hide all of them from every caller.
//
// Built fresh for Phase 2 -- callLLM.ts (deleted, see Tranche A) was a Lovable-Gateway-
// specific shim, not a generalizable base for this.

export interface EmbedResult {
  /** One vector per input, same order as the input array. */
  embeddings: number[][];
  /** The model the PROVIDER reported back, not the one requested -- provenance from
   *  reality, same as the smoke test read result.model rather than assuming the
   *  requested EMBEDDING_MODEL round-tripped unchanged. */
  model: string;
  /** embeddings[0].length, reported from the actual response. Never asserted against a
   *  hardcoded expectation -- see docs/phase-2-embedding-provider.md for why. */
  dimension: number;
}

export interface EmbeddingProvider {
  /** Short identifier for logging/error messages, e.g. "openai". */
  readonly name: string;
  /** Whether this provider is BAA-covered / safe to carry person-identifiable content.
   *  Must default to false in code if the underlying env var is absent, empty, or
   *  anything other than the literal string "true" -- never true-by-omission. */
  readonly phiAllowed: boolean;
  /** Embed one string or a batch. Always returns embeddings as an array, even for a
   *  single input, so callers don't need two code paths. Callers are responsible for
   *  keeping any batch within the provider's per-request input/token limits -- this
   *  method takes an already-safe batch, it does not chunk on your behalf. */
  embed(input: string | string[]): Promise<EmbedResult>;
}

export class EmbeddingProviderError extends Error {
  constructor(public status: number, public body: string) {
    super(`Embedding provider error: ${status}`);
  }
}

export class PhiSafetyError extends Error {}

/** Declares, at the call site, whether the content about to be embedded could carry
 *  person-identifiable data. This is a structural declaration, not content sniffing --
 *  matching how the rest of this codebase enforces boundaries with explicit parameters
 *  rather than inferring intent (see match-caregiver's structured-fields-only design). */
export interface PhiContext {
  requiresPhi: boolean;
  /** Short description of the call site, surfaced in the thrown error if this trips. */
  description: string;
}

/**
 * MUST be called (not just defined) in every code path that could route
 * person-identifiable content through an EmbeddingProvider. Throws if the call site
 * declares it might carry PHI (`requiresPhi: true`) but the selected provider isn't
 * BAA-covered (`phiAllowed: false`).
 *
 * In Phase 2, every real caller passes `requiresPhi: false` -- agency-knowledge RAG is
 * PHI-free by construction (no client_id path, see the Phase 2 readiness assessment's
 * Step 3) -- so this should never trip today. It stays wired in so it becomes load-
 * bearing the instant a later phase attempts to route person-data through a
 * non-BAA-covered provider, per CLAUDE.md's HIPAA/PHI boundary hard gate.
 */
export function assertPhiSafe(provider: EmbeddingProvider, context: PhiContext): void {
  if (context.requiresPhi && !provider.phiAllowed) {
    throw new PhiSafetyError(
      `Refusing to embed: call site "${context.description}" declared requiresPhi=true, ` +
      `but provider "${provider.name}" is not PHI-capable (phiAllowed=false). ` +
      `A PHI-capable provider (e.g. Azure with a signed BAA) is required for this call site.`
    );
  }
}

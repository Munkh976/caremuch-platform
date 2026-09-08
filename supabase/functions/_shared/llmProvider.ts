// LLMProvider seam: direct structural mirror of EmbeddingProvider (embeddingProvider.ts).
// Callers say "complete this chat" and never see model strings, endpoints, or
// provider-specific request shapes -- swapping providers later is a config change
// (LLM_PROVIDER), not a code change, same reasoning as the embedding seam.
//
// Built for Phase 3 Gate 3 (public-corpus LLM answerability). Confirmed before writing
// this: no LLMProvider existed anywhere in this codebase (grepped supabase/functions/
// _shared/) -- this is new, not an extension of anything.

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmCompleteResult {
  /** The composed response text. */
  content: string;
  /** The model the PROVIDER reported back, not the one requested -- same provenance
   *  discipline as EmbedResult.model. */
  model: string;
}

export interface LlmCompleteInput {
  /** System/instruction content -- kept separate from the conversation so callers
   *  can't accidentally let user input masquerade as an instruction. */
  system: string;
  messages: LlmMessage[];
}

export interface LLMProvider {
  /** Short identifier for logging/error messages, e.g. "openai". */
  readonly name: string;
  /** Whether this provider is BAA-covered / safe to carry person-identifiable content.
   *  Must default to false in code if the underlying env var is absent, empty, or
   *  anything other than the literal string "true" -- never true-by-omission. Same
   *  discipline as EmbeddingProvider.phiAllowed. */
  readonly phiAllowed: boolean;
  complete(input: LlmCompleteInput): Promise<LlmCompleteResult>;
}

export class LlmProviderError extends Error {
  constructor(public status: number, public body: string) {
    super(`LLM provider error: ${status}`);
  }
}

export class LlmPhiSafetyError extends Error {}

export interface LlmPhiContext {
  requiresPhi: boolean;
  description: string;
}

/**
 * MUST be called (not just defined) in every code path that could route
 * person-identifiable content through an LLMProvider. Same contract as
 * embeddingProvider.ts's assertPhiSafe -- kept as a distinct function (not a shared
 * import) because assertPhiSafe's parameter type is EmbeddingProvider specifically,
 * and LLMProvider does not structurally satisfy that interface (no embed() method).
 * Duplicating this ~5-line check is smaller and safer than widening a shared,
 * already-deployed file's public type signature for a one-file-away caller.
 *
 * In this phase every real caller passes requiresPhi: false -- Gate 3 only ever sees
 * PUBLIC, PHI-free retrieved chunks (see the hardcoded _surfaces: ['public'] retrieval
 * call in search-knowledge, unchanged from Tranche 3A). This should never trip today;
 * it stays wired in so it becomes load-bearing if a later phase (caregiver-corpus Gate
 * 3, explicitly out of scope here) ever attempts to route person-data through a
 * non-BAA-covered provider, per CLAUDE.md's HIPAA/PHI boundary hard gate.
 */
export function assertLlmPhiSafe(provider: LLMProvider, context: LlmPhiContext): void {
  if (context.requiresPhi && !provider.phiAllowed) {
    throw new LlmPhiSafetyError(
      `Refusing to complete: call site "${context.description}" declared requiresPhi=true, ` +
      `but provider "${provider.name}" is not PHI-capable (phiAllowed=false). ` +
      `A PHI-capable provider (e.g. Azure with a signed BAA, or OpenAI-BAA+ZDR) is required for this call site.`
    );
  }
}

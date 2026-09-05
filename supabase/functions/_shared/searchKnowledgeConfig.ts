/**
 * Server-side RELEVANCE floor (Gate 2) for the semantic (cosine) knowledge Q&A path --
 * NOT an answerability gate. Per the CareMuch Phase 2 RAG Architecture Decision:
 * retrieval is governed by three separate gates (1: authorization, 2: relevance/this
 * value, 3: LLM answerability -- not yet built). This threshold's only job is "is this
 * topically in the neighborhood," not "does this actually answer the question."
 *
 * Derived from the 38-question eval (docs/phase2-rag-eval-analysis.md,
 * docs/phase2-rag-eval-results.json): answerable correct-doc scores range 0.4355-0.7282;
 * off-topic/misleading top scores range 0.2147-0.5122. These distributions OVERLAP
 * (0.4355-0.5122) -- no threshold value cleanly separates them. 0.40 rejects the
 * clearest off-topic cases (direct-deposit 0.2147, background-check 0.2560, mileage
 * 0.3160) while admitting every real answer with margin -- it does NOT and CANNOT
 * reject the hardest misleading cases (0.43-0.51), which score above every real answer's
 * floor. Closing that gap requires Gate 3 (LLM answerability), which does not exist yet
 * -- see known-issues.md. This is NOT a miscalibration to keep chasing with a different
 * number; the eval proves no number closes it.
 *
 * PROOF-OF-CONCEPT CAVEAT: derived entirely against the private caregiver-policy seed
 * corpus, not the public agent's real corpus (see docs/phase2-rag-eval-analysis.md §8
 * and known-issues.md) -- re-derive with rag-eval-harness once real public content
 * exists.
 *
 * IMPORTANT: this is a COSINE SIMILARITY value (roughly 0-1, higher = more similar), an
 * entirely different scale than knowledgeQaConfig.ts's KNOWLEDGE_CONFIDENCE_THRESHOLD
 * (an FTS ts_rank score, typically 0.01-0.05) -- do not compare the two numbers or carry
 * the FTS value over, they are not the same unit.
 */
export const SEMANTIC_MATCH_THRESHOLD = 0.40;

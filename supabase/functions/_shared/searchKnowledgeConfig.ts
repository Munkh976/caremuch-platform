/**
 * Server-side confidence threshold for the semantic (cosine) knowledge Q&A path.
 *
 * PROVISIONAL, NOT eval-tuned. This is Phase 2 Tranche C part 3c ("make semantic
 * retrieval work end-to-end") -- the formal 30-50 question eval that derives a real
 * threshold is the NEXT sub-tranche, per CLAUDE.md's "RAG confidence" rule (0.75 was
 * always "an initial hypothesis," and the FTS path's own 0.04 only reached its current
 * value after a real probe plus live evidence, not a first guess treated as final).
 *
 * IMPORTANT: this is a COSINE SIMILARITY value (roughly 0-1, higher = more similar), an
 * entirely different scale than knowledgeQaConfig.ts's KNOWLEDGE_CONFIDENCE_THRESHOLD
 * (an FTS ts_rank score, typically 0.01-0.05) -- do not compare the two numbers or carry
 * the FTS value over, they are not the same unit.
 *
 * Deliberately low for this wiring-only sub-tranche so real similarity scores are
 * visible during live testing rather than silently refusing everything.
 */
export const SEMANTIC_MATCH_THRESHOLD = 0.3;

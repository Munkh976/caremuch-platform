/**
 * Confidence threshold for the knowledge Q&A surface's soft refuse gate.
 *
 * Provisional value from the Path A retrieval probe (docs/phase-1-fts-results.md,
 * 11 queries against 8 seeded documents): genuine answerable hits scored 0.040-0.076,
 * near-miss noise scored 0.010-0.015, in both English and Spanish. 0.03 sits at the
 * top of the recommended 0.025-0.03 range, biasing toward refusing over guessing.
 *
 * NOT yet validated against the full 30-50 question eval -- expect this to change.
 * When it is, consider moving enforcement into search_agency_knowledge() itself
 * (a _min_rank parameter, pairing naturally with its existing _agency_id parameter)
 * rather than here, so it's enforced once for every caller instead of per-component.
 */
export const KNOWLEDGE_CONFIDENCE_THRESHOLD = 0.03;

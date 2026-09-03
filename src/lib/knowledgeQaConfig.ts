/**
 * Confidence threshold for the knowledge Q&A surface's soft refuse gate.
 *
 * Raised from 0.03 to 0.04 on 2026-09-03 after live testing found a false positive:
 * "How do I set up direct deposit?" returned a Medication Reminder chunk at a
 * confident score, because the English stemmer collapses "directly" -> "direct",
 * the same stem as the "direct" in "direct deposit" -- a stemming collision, not a
 * miscalibration. 0.04 is the lowest genuine-hit rank confirmed in the original
 * probe (docs/phase-1-fts-results.md), so this is the maximum safe increase: it
 * cannot regress any already-validated answer. Whether it's sufficient to also
 * exclude the direct-deposit false positive depends on that chunk's actual rank,
 * not yet confirmed against the live database -- see phase-1-fts-results.md's
 * "Live evidence" section. If that chunk's rank is >= 0.04, no threshold value can
 * fix this cleanly (proven, not just predicted) -- it needs Phase 2 embeddings.
 *
 * NOT yet validated against the full 30-50 question eval -- expect this to change
 * again. When it is, consider moving enforcement into search_agency_knowledge()
 * itself (a _min_rank parameter, pairing naturally with its existing _agency_id
 * parameter) rather than here, so it's enforced once for every caller instead of
 * per-component.
 */
export const KNOWLEDGE_CONFIDENCE_THRESHOLD = 0.04;

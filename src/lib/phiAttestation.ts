/**
 * Phase 3 Tranche 3C: the exact attestation string ingest-knowledge-document
 * requires (server-enforced, checked before any Storage access -- this constant is
 * a UI convenience for prefilling the request body, not the enforcement itself).
 *
 * Must stay byte-identical to PHI_ATTESTATION_STRING in
 * supabase/functions/_shared/phiGuard.ts. Duplicated rather than imported because
 * that module lives in the Supabase Functions (Deno) source tree, outside this
 * app's Vite/TypeScript project -- the same frontend/backend config-duplication
 * precedent already used for KNOWLEDGE_CONFIDENCE_THRESHOLD (src/lib/knowledgeQaConfig.ts)
 * vs. SEMANTIC_MATCH_THRESHOLD (supabase/functions/_shared/searchKnowledgeConfig.ts).
 */
export const PHI_ATTESTATION_STRING =
  "I confirm this document contains no client, patient, family, or elderly-identifying information.";

-- Phase 2 Tranche C: enable the pgvector extension. Confirmed in the Phase 2 readiness
-- pass that only pgcrypto was previously installed (grepped every migration for
-- CREATE EXTENSION/vector -- zero hits) -- this is genuinely new. Extension only; the
-- knowledge_chunks.embedding column and its index are added in the next migration.
-- Installed into the `extensions` schema, matching this project's existing pgcrypto
-- convention (20251110220912), not `public` -- avoids polluting the public schema and
-- keeps the same explicit-schema-qualification pattern already used for extensions.crypt().
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

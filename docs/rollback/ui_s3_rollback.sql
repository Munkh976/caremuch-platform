-- REFERENCE ONLY: not a migration. Proven on PGlite (tests/ripple/pglite/rollback-ui-s2s3.cjs).
-- Ripple UI S3 rollback: drops the two read functions the migration added. No data to undo.
BEGIN;
DROP FUNCTION IF EXISTS public.get_caregiver_compliance(uuid);
DROP FUNCTION IF EXISTS public.list_credential_expirations(uuid, integer);
-- On DEV only (migration history), same transaction:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261013120100';
COMMIT;

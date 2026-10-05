-- REFERENCE ONLY: not a migration. Proven on PGlite (tests/ripple/pglite/rollback-ui-s2s3.cjs).
-- Ripple UI S2 rollback: drops the four functions the migration added. Measure types created through
-- them stay (they are ordinary rows; delete them separately if wanted, only while unused).
BEGIN;
DROP FUNCTION IF EXISTS public.delete_measure_type(uuid);
DROP FUNCTION IF EXISTS public.set_measure_type_active(uuid, boolean);
DROP FUNCTION IF EXISTS public.upsert_measure_type(uuid, public.measure_kind, text, jsonb);
DROP FUNCTION IF EXISTS public.cp_require_agency_measure_type(uuid);
DROP FUNCTION IF EXISTS public.list_templates_with_usage(uuid);
-- On DEV only (migration history), same transaction:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261013120000';
COMMIT;

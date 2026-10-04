-- REFERENCE ONLY: not a migration, never run by the Supabase CLI. Proven on PGlite (exact post-Phase-C
-- catalog restore: tests/ripple/pglite/rollback-d.cjs).
-- Phase D rollback (one transaction): D2 adds only read functions (no tables, columns, data or events).
BEGIN;
DROP FUNCTION IF EXISTS public.list_clients_onboarding(uuid);
DROP FUNCTION IF EXISTS public.get_client_onboarding_status(uuid);
DROP FUNCTION IF EXISTS public.cp_client_onboarding(uuid);
-- On DEV only (migration history), same transaction:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20261010120000');
COMMIT;

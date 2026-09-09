-- Drops the temporary seed helper added in
-- 20260909013000_add_ops_seed_shift_assignments_helper.sql, once the agency
-- 56fbfe38 operational demo data rebuild's historical shift_assignments
-- backfill has been run and verified. Not a standing capability.
DROP FUNCTION IF EXISTS public.ops_seed_insert_shift_assignments(jsonb);

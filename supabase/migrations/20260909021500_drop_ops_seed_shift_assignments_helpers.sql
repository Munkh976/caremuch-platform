-- Drops the temporary seed helper re-added in
-- 20260909020500_add_ops_seed_shift_assignments_helper2.sql, once the small,
-- fully-complete rebuild of agency 56fbfe38's operational data has been run
-- and verified. Not a standing capability.
DROP FUNCTION IF EXISTS public.ops_seed_insert_shift_assignments(jsonb);
DROP FUNCTION IF EXISTS public.ops_seed_delete_shift_assignments(uuid[]);

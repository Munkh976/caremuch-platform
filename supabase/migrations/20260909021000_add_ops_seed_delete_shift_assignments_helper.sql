-- Temporary, service-role-only companion to ops_seed_insert_shift_assignments
-- (see 20260909020500). protect_completed_assignment() (20260821063931) blocks
-- deleting 'completed' shift_assignments unless is_demo=true AND the session
-- sets caremuch.purge_ctx='1' -- the exact same escape hatch purge_demo_data()
-- itself uses. purge_demo_data() cannot be reused directly here: it is
-- unscoped and would also delete virtual_office/knowledge_documents rows
-- WHERE is_demo (destroying the live Ripple Effects office and its 12 [DEMO]
-- knowledge docs). This narrow, id-scoped helper deletes only the specific
-- demo shift_assignments the rebuild's delete phase names, nothing else.
-- Dropped by the same follow-up migration as its insert-side counterpart.
CREATE OR REPLACE FUNCTION public.ops_seed_delete_shift_assignments(_ids uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  PERFORM set_config('caremuch.purge_ctx', '1', true);
  DELETE FROM public.shift_assignments WHERE id = ANY(_ids) AND is_demo = true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('caremuch.purge_ctx', '', true);
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ops_seed_delete_shift_assignments(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_seed_delete_shift_assignments(uuid[]) TO service_role;

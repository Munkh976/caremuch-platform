-- TEMPORARY, service-role-only helper for the agency 56fbfe38 operational demo
-- data rebuild. shift_assignments is protected by protect_assignment_columns()
-- (see 20260821045535), which blocks direct INSERTs unless the session sets
-- caremuch.assignment_ctx = '1' -- the same escape hatch assign_caregiver_to_shift()
-- and the prior demo seed (20260828011738_seed_agency_56fbfe38_demo_data.sql,
-- lines 160-168) use for exactly this bulk historical-backfill scenario, which
-- has no equivalent live RPC (assign_caregiver_to_shift() only ever creates
-- 'scheduled' assignments and refuses shifts already 'completed').
--
-- This function is intentionally temporary: it is used ONCE by the rebuild's
-- insert phase and then DROPPED by a follow-up migration
-- (20260909013500_drop_ops_seed_shift_assignments_helper.sql). It must not
-- remain as a standing bypass of the assignment-integrity trigger.
CREATE OR REPLACE FUNCTION public.ops_seed_insert_shift_assignments(_rows jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  PERFORM set_config('caremuch.assignment_ctx', '1', true);

  INSERT INTO public.shift_assignments
    (shift_id, caregiver_id, status, assignment_method, clock_in_time, clock_out_time, actual_hours_worked, is_demo)
  SELECT
    (r->>'shift_id')::uuid,
    (r->>'caregiver_id')::uuid,
    (r->>'status')::assignment_status,
    (r->>'assignment_method')::assignment_method,
    NULLIF(r->>'clock_in_time','')::timestamptz,
    NULLIF(r->>'clock_out_time','')::timestamptz,
    NULLIF(r->>'actual_hours_worked','')::numeric,
    true
  FROM jsonb_array_elements(_rows) r;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('caremuch.assignment_ctx', '', true);

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.ops_seed_insert_shift_assignments(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_seed_insert_shift_assignments(jsonb) TO service_role;

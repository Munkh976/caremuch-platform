-- Re-adds the temporary, service-role-only seed helper (see the now-dropped
-- 20260909013000/20260909013500 pair for the original approval and rationale)
-- for the smaller, fully-complete rebuild of agency 56fbfe38's operational
-- data. Same lifecycle: used once by this rebuild's insert phase for the
-- handful of historical ('completed') shift_assignments, then dropped by a
-- follow-up migration. Not a standing bypass of the assignment-integrity
-- trigger (protect_assignment_columns).
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

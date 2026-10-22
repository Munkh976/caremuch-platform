-- Rollback of 20261030110000_hotfix_caller_checks.sql: the two eligibility functions back to DEV's bodies before the push
-- (byte-identical), the two new functions dropped, log_event's EXECUTE for PUBLIC / anon / authenticated restored.
CREATE OR REPLACE FUNCTION public.check_assignment_eligibility(_shift_id uuid, _caregiver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Phase C: the engine body lives in cp_eligibility_core (internal); NULL ctx = compute the
  -- client-level context for this one check.
  RETURN public.cp_eligibility_core(_shift_id, _caregiver_id, NULL);
END;
$function$;
CREATE OR REPLACE FUNCTION public.check_assignment_eligibility_bulk(_shift_id uuid, _caregiver_ids uuid[])
 RETURNS TABLE(caregiver_id uuid, result jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ctx jsonb;
BEGIN
  -- Phase C: the client-level checks (plan/training version, projected units) are computed ONCE
  -- for the shift and shared by every caregiver; the per-caregiver rules stay in the core.
  v_ctx := public.cp_shift_client_context(_shift_id);
  RETURN QUERY
  SELECT cid, public.cp_eligibility_core(_shift_id, cid, v_ctx)
  FROM unnest(_caregiver_ids) AS cid;
END;
$function$;
REVOKE ALL ON FUNCTION public.check_assignment_eligibility(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_assignment_eligibility(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.check_assignment_eligibility_bulk(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_assignment_eligibility_bulk(uuid, uuid[]) TO authenticated;
DROP FUNCTION public.match_caregiver_scope(uuid);
DROP FUNCTION public.cp_eligibility_caller_ok(uuid, uuid[]);
GRANT EXECUTE ON FUNCTION public.log_event(uuid, text, text, uuid, text, uuid, jsonb, uuid, boolean) TO PUBLIC, anon, authenticated;

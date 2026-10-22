-- SECURITY HOTFIX (owner decision Oct 21 night, item 1): caller checks found missing in the auto-assign investigation.
--
-- 1. check_assignment_eligibility / check_assignment_eligibility_bulk (approved change; NB1 proof): any authenticated
--    user could evaluate any shift and caregiver of any agency (credential names, plan / authorization state). Now the
--    caller must be EITHER staff of the shift's agency in scope of its office (system_admin, agency_admin, manager,
--    scheduler, hr_staff: the roles that open Schedule / Shift Trades / the client Scheduling tab; the same agency +
--    office rule as assign_caregiver_to_shift and the shifts RLS policy) OR a caregiver checking ONLY themselves (the
--    pickup paths call these functions as the caregiver: caregiver_pick_up_shift, caregiver_pickup_trade_shift,
--    check_caregiver_shifts_eligibility). Otherwise the generic refusal (42501). The engine (cp_eligibility_core) and
--    every result for an allowed caller are unchanged.
-- 2. match_caregiver_scope(_shift_id) (new): the match-caregiver Edge Function calls it AS THE USER before any
--    service-role read: manager / scheduler / agency_admin in scope of the shift's office (owner's role list).
-- 3. log_event: was SECURITY DEFINER and executable by PUBLIC / anon / authenticated, so anyone could write an audit row
--    into any agency with any actor. Its only callers are the SECURITY DEFINER event triggers (tg_event_*), which run as
--    the owner; EXECUTE is revoked from PUBLIC, anon and authenticated (service_role keeps it). Body unchanged.
-- Unchanged: cp_eligibility_core, assign_caregiver_to_shift, every pickup / trade function.

CREATE FUNCTION public.cp_eligibility_caller_ok(_shift_id uuid, _caregiver_ids uuid[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT cp_staff_in_scope(s.agency_id, s.virtual_office_id, '{system_admin,agency_admin,manager,scheduler,hr_staff}'::public.app_role[])
        OR (has_role(auth.uid(), 'caregiver'::public.app_role)
            AND cardinality(_caregiver_ids) >= 1
            AND NOT EXISTS (SELECT 1 FROM unnest(_caregiver_ids) cid
                             WHERE cid IS NULL OR NOT EXISTS (SELECT 1 FROM public.caregivers g WHERE g.id = cid AND g.user_id = auth.uid() AND g.agency_id = s.agency_id)))
      FROM public.shifts s WHERE s.id = _shift_id), false)
$$;
REVOKE ALL ON FUNCTION public.cp_eligibility_caller_ok(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_assignment_eligibility(_shift_id uuid, _caregiver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- hotfix: staff in scope of the shift's office, or a caregiver checking themselves
  IF NOT public.cp_eligibility_caller_ok(_shift_id, ARRAY[_caregiver_id]) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  -- Phase C: the engine body lives in cp_eligibility_core (internal); NULL ctx = compute the
  -- client-level context for this one check.
  RETURN public.cp_eligibility_core(_shift_id, _caregiver_id, NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.check_assignment_eligibility(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_assignment_eligibility(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_assignment_eligibility_bulk(_shift_id uuid, _caregiver_ids uuid[])
 RETURNS TABLE(caregiver_id uuid, result jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ctx jsonb;
BEGIN
  -- hotfix: staff in scope of the shift's office, or a caregiver checking only themselves
  IF NOT public.cp_eligibility_caller_ok(_shift_id, COALESCE(_caregiver_ids, ARRAY[]::uuid[]))
     AND NOT (cardinality(COALESCE(_caregiver_ids, ARRAY[]::uuid[])) = 0
              AND public.cp_staff_in_scope((SELECT agency_id FROM public.shifts WHERE id = _shift_id), (SELECT virtual_office_id FROM public.shifts WHERE id = _shift_id),
                                           '{system_admin,agency_admin,manager,scheduler,hr_staff}'::public.app_role[])) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  -- Phase C: the client-level checks (plan/training version, projected units) are computed ONCE
  -- for the shift and shared by every caregiver; the per-caregiver rules stay in the core.
  v_ctx := public.cp_shift_client_context(_shift_id);
  RETURN QUERY
  SELECT cid, public.cp_eligibility_core(_shift_id, cid, v_ctx)
  FROM unnest(_caregiver_ids) AS cid;
END;
$function$;
REVOKE ALL ON FUNCTION public.check_assignment_eligibility_bulk(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_assignment_eligibility_bulk(uuid, uuid[]) TO authenticated;

CREATE FUNCTION public.match_caregiver_scope(_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO s FROM public.shifts WHERE id = _shift_id;
  PERFORM cp_require_scope(s.agency_id, s.virtual_office_id, '{manager,scheduler,agency_admin}'::public.app_role[]);
  RETURN jsonb_build_object('shift_id', s.id, 'agency_id', s.agency_id, 'virtual_office_id', s.virtual_office_id);
END $$;
REVOKE ALL ON FUNCTION public.match_caregiver_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_caregiver_scope(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.log_event(uuid, text, text, uuid, text, uuid, jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated;

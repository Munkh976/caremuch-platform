-- Known-issues follow-ups a / c (owner, Oct 22 evening): a caregiver-safe "can I pick this up" flag per visit, so the
-- caregiver's Available Shifts (open visits and the Trade Board) in care-plan offices lists only visits the caregiver
-- passes the pickup gate for — including the client-onboarded part, which the caregiver-safe eligibility doesn't carry.
-- Returns only (shift_id, pickable): no client, plan or authorization detail. Outside care-plan offices every visit is
-- pickable = true (today's lists unchanged). Additive: no existing function changes (NB1 untouched).
CREATE FUNCTION public.caregiver_pickable_shifts(_shift_ids uuid[])
RETURNS TABLE (shift_id uuid, pickable boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cg uuid; v_agency uuid;
BEGIN
  SELECT id, agency_id INTO v_cg, v_agency FROM public.caregivers WHERE user_id = auth.uid() LIMIT 1;
  IF v_cg IS NULL THEN RETURN; END IF;   -- not a caregiver: empty set (as check_caregiver_shifts_eligibility)
  RETURN QUERY
  SELECT s.id, CASE WHEN COALESCE(o.care_plan_module_enabled, false)
                    THEN public.cp_pickup_gate(s.id, public.check_assignment_eligibility(s.id, v_cg)) IS NULL
                    ELSE true END
    FROM public.shifts s LEFT JOIN public.virtual_office o ON o.id = s.virtual_office_id
   WHERE s.id = ANY(COALESCE(_shift_ids, '{}')) AND s.agency_id = v_agency;
END $$;
REVOKE ALL ON FUNCTION public.caregiver_pickable_shifts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caregiver_pickable_shifts(uuid[]) TO authenticated;

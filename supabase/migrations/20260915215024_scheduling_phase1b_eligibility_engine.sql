-- Smart Scheduling Phase 1B: wire the existing eligibility engine into the surfaces
-- that skip it, add Rule B (office scope), fix rule severities, close the
-- NULL-office write path for shifts/client_orders/time_off_requests.
-- See docs/scheduling-phase1b-plan.md for the full design and rationale.
--
-- Footgun check (known-issues.md): check_assignment_eligibility's argument list
-- (_shift_id uuid, _caregiver_id uuid) is UNCHANGED below -- only the body changes,
-- so CREATE OR REPLACE genuinely replaces the same function object in place and
-- keeps its existing grants (confirmed live before this migration: postgres/
-- authenticated/service_role all hold EXECUTE). No DROP FUNCTION, no re-GRANT
-- needed for this piece. It is LANGUAGE plpgsql, so the separate LANGUAGE-sql
-- validate-at-CREATE-time footgun doesn't apply either. The three trigger
-- functions below (set_time_off_agency_id extended, and two new ones) are all
-- 0-argument trigger functions -- there is categorically no signature-change risk
-- for those, widening or not.

-- =============================================================================
-- 1. check_assignment_eligibility: Rule B (NEW, hard), Rule H (soft -> hard),
--    Rule J (advisory -> soft, existing zip-list check only -- real distance
--    deferred to Phase 2 per your decision, noted in known-issues.md).
--    Everything else in the function is byte-for-byte unchanged from the live
--    body read this session.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_assignment_eligibility(_shift_id uuid, _caregiver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record; cg record; cl record; svc record; r record;
  hard jsonb := '[]'::jsonb; soft jsonb := '[]'::jsonb; adv jsonb := '[]'::jsonb;
  v_cap numeric := 40; v_buffer int := 30; v_late int := 24;
  v_week_start date; v_week_end date;
  v_weekly numeric := 0; v_projected numeric; v_hours numeric;
  v_missing text[]; v_expired text[]; v_unverified text[];
  v_avail_rows int; v_covered boolean; v_dow int;
  v_hours_until numeric; v_exc record;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'hard',
      jsonb_build_array(jsonb_build_object('code','shift_missing','label','Shift not found','detail','This shift no longer exists.')),
      'soft','[]'::jsonb,'advisory','[]'::jsonb,'weekly_hours',0,'projected_weekly_hours',0);
  END IF;

  SELECT * INTO cg FROM public.caregivers WHERE id = _caregiver_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'hard',
      jsonb_build_array(jsonb_build_object('code','caregiver_missing','label','Caregiver not found','detail','This caregiver no longer exists.')),
      'soft','[]'::jsonb,'advisory','[]'::jsonb,'weekly_hours',0,'projected_weekly_hours',0);
  END IF;

  SELECT COALESCE(max_weekly_hours,40), COALESCE(travel_buffer_minutes,30), COALESCE(late_trade_hours,24)
    INTO v_cap, v_buffer, v_late
  FROM public.agency WHERE id = s.agency_id;
  v_cap := COALESCE(v_cap,40); v_buffer := COALESCE(v_buffer,30); v_late := COALESCE(v_late,24);

  v_hours := COALESCE(s.duration_hours, EXTRACT(EPOCH FROM (s.end_time - s.start_time))/3600.0);

  IF cg.agency_id IS DISTINCT FROM s.agency_id THEN
    hard := hard || jsonb_build_object('code','tenancy','label','Different agency','detail','Caregiver belongs to another agency.');
  END IF;

  -- NEW: Rule B, mirrors Rule A exactly. NULL IS DISTINCT FROM NULL = false, so two
  -- not-yet-backfilled-office rows don't false-positive-block each other; any real
  -- mismatch (including one-sided NULL) does.
  IF cg.virtual_office_id IS DISTINCT FROM s.virtual_office_id THEN
    hard := hard || jsonb_build_object('code','office_scope','label','Different office','detail','Caregiver belongs to a different office.');
  END IF;

  IF cg.is_active IS FALSE THEN
    hard := hard || jsonb_build_object('code','inactive','label','Inactive caregiver','detail','This caregiver is not active.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shift_assignments a
    WHERE a.shift_id = _shift_id AND a.status IN ('in_progress','completed')
      AND a.caregiver_id <> _caregiver_id
  ) THEN
    hard := hard || jsonb_build_object('code','shift_taken','label','Shift already worked','detail','Another caregiver has already started or completed this shift.');
  END IF;

  IF s.status IN ('completed','cancelled') THEN
    hard := hard || jsonb_build_object('code','shift_state','label','Shift not open','detail','Shift is '||s.status||'.');
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT code FROM unnest(
      ARRAY[s.care_type_code]::text[] || COALESCE(s.required_skills, ARRAY[]::text[])
    ) AS code
    WHERE code IS NOT NULL AND code <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.caregiver_skills k
        WHERE k.caregiver_id = _caregiver_id AND k.care_type_code = code
      )
  ) INTO v_missing;
  IF array_length(v_missing,1) > 0 THEN
    hard := hard || jsonb_build_object('code','skill','label','Missing care service skill',
      'detail','Not qualified for '||array_to_string(v_missing,', ')||'.');
  END IF;

  SELECT ARRAY(SELECT certification_name FROM public.caregiver_certifications
               WHERE caregiver_id=_caregiver_id AND expiry_date IS NOT NULL AND expiry_date < s.shift_date)
    INTO v_expired;
  IF array_length(v_expired,1) > 0 THEN
    hard := hard || jsonb_build_object('code','certification_expired','label','Expired certification',
      'detail',array_to_string(v_expired,', ')||' expired before this shift date.');
  END IF;
  SELECT ARRAY(SELECT certification_name FROM public.caregiver_certifications
               WHERE caregiver_id=_caregiver_id AND is_verified IS NOT TRUE)
    INTO v_unverified;
  IF array_length(v_unverified,1) > 0 THEN
    hard := hard || jsonb_build_object('code','certification_unverified','label','Unverified certification',
      'detail',array_to_string(v_unverified,', ')||' has not been verified.');
  END IF;

  FOR r IN
    SELECT o.id, o.start_time, o.end_time
    FROM public.shift_assignments a
    JOIN public.shifts o ON o.id = a.shift_id
    WHERE a.caregiver_id = _caregiver_id AND a.status <> 'cancelled'
      AND o.shift_date = s.shift_date AND o.id <> s.id
  LOOP
    IF s.start_time < r.end_time AND r.start_time < s.end_time THEN
      hard := hard || jsonb_build_object('code','double_booked','label','Double booked',
        'detail','Overlaps a shift '||to_char(r.start_time,'HH24:MI')||'-'||to_char(r.end_time,'HH24:MI')||' on this day.');
    ELSIF s.start_time < r.end_time + make_interval(mins => v_buffer)
      AND r.start_time < s.end_time + make_interval(mins => v_buffer) THEN
      adv := adv || jsonb_build_object('code','travel_buffer','label','Tight turnaround',
        'detail','Less than '||v_buffer||' minutes between this and a shift at '||to_char(r.start_time,'HH24:MI')||'.');
    END IF;
  END LOOP;

  v_week_start := (date_trunc('week', s.shift_date::timestamp))::date;
  v_week_end := v_week_start + 6;
  SELECT COALESCE(SUM(o.duration_hours),0) INTO v_weekly
  FROM public.shift_assignments a
  JOIN public.shifts o ON o.id = a.shift_id
  WHERE a.caregiver_id = _caregiver_id AND a.status <> 'cancelled'
    AND o.shift_date BETWEEN v_week_start AND v_week_end AND o.id <> s.id;
  v_projected := round((v_weekly + v_hours)::numeric, 2);

  IF v_projected > v_cap THEN
    soft := soft || jsonb_build_object('code','weekly_hours','label','Over weekly hours cap',
      'detail','Would reach '||v_projected||'h this week (cap '||v_cap||'h).');
  ELSIF v_projected > v_cap - 8 THEN
    adv := adv || jsonb_build_object('code','overtime_risk','label','Approaching overtime',
      'detail','Would reach '||v_projected||'h of '||v_cap||'h this week.');
  END IF;

  -- CHANGED: Rule H moves from soft to hard (was: soft := soft || ...).
  IF EXISTS (SELECT 1 FROM public.time_off_requests t
             WHERE t.caregiver_id=_caregiver_id AND t.status='approved'
               AND s.shift_date BETWEEN t.start_date AND t.end_date) THEN
    hard := hard || jsonb_build_object('code','time_off','label','Approved time off',
      'detail','Caregiver has approved time off covering this date.');
  END IF;

  -- date-specific exception overrides the weekly rule for that date
  SELECT * INTO v_exc FROM public.caregiver_availability_exceptions
   WHERE caregiver_id=_caregiver_id AND exception_date = s.shift_date;

  IF FOUND THEN
    IF v_exc.is_available IS FALSE THEN
      soft := soft || jsonb_build_object('code','availability_exception','label','Unavailable on this date',
        'detail', COALESCE(NULLIF(v_exc.reason,''),'Caregiver marked this date as unavailable.'));
    ELSIF NOT (v_exc.start_time <= s.start_time AND v_exc.end_time >= s.end_time) THEN
      soft := soft || jsonb_build_object('code','availability_exception','label','Outside availability for this date',
        'detail','On this date the caregiver is only available '||to_char(v_exc.start_time,'HH24:MI')||'-'||to_char(v_exc.end_time,'HH24:MI')||'.');
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_avail_rows FROM public.caregiver_availability WHERE caregiver_id=_caregiver_id;
    IF v_avail_rows > 0 THEN
      v_dow := EXTRACT(DOW FROM s.shift_date)::int;
      SELECT EXISTS (
        SELECT 1 FROM public.caregiver_availability av
        WHERE av.caregiver_id=_caregiver_id AND av.day_of_week=v_dow AND av.is_available IS NOT FALSE
          AND av.start_time <= s.start_time AND av.end_time >= s.end_time
      ) INTO v_covered;
      IF NOT v_covered THEN
        soft := soft || jsonb_build_object('code','availability','label','Outside declared availability',
          'detail','This shift falls outside the caregiver''s availability for that weekday.');
      END IF;
    END IF;
  END IF;

  SELECT * INTO cl FROM public.clients WHERE id = s.client_id;
  -- CHANGED: Rule J moves from advisory to soft (was: adv := adv || ...). Existing
  -- zip-list check only -- real distance/mileage deferred to Phase 2 (see
  -- known-issues.md).
  IF cl.zip_code IS NOT NULL AND cg.service_zipcodes IS NOT NULL AND array_length(cg.service_zipcodes,1) > 0
     AND NOT (cl.zip_code = ANY(cg.service_zipcodes)) THEN
    soft := soft || jsonb_build_object('code','service_area','label','Outside service area',
      'detail','Client ZIP '||cl.zip_code||' is not in this caregiver''s service ZIP list.');
  END IF;
  IF cl.preferred_caregiver_id IS NOT NULL AND cl.preferred_caregiver_id <> _caregiver_id THEN
    adv := adv || jsonb_build_object('code','preferred_caregiver','label','Client has a preferred caregiver',
      'detail','Continuity of care: the client requested a specific caregiver.');
  END IF;

  SELECT * INTO svc FROM public.care_types WHERE code = s.care_type_code;
  IF svc.requires_trade_approval THEN
    adv := adv || jsonb_build_object('code','specialized_service','label','Specialised care service',
      'detail',COALESCE(svc.name,s.care_type_code)||' requires manager approval before a trade.');
  END IF;

  v_hours_until := EXTRACT(EPOCH FROM ((s.shift_date + s.start_time) - now()))/3600.0;
  IF v_hours_until > 0 AND v_hours_until < v_late THEN
    adv := adv || jsonb_build_object('code','late_trade','label','Late assignment',
      'detail','Shift starts in under '||v_late||' hours.');
  END IF;
  IF s.status = 'in_progress' THEN
    adv := adv || jsonb_build_object('code','in_progress','label','Shift in progress','detail','This shift has already started.');
  END IF;
  IF cg.reliability_score IS NOT NULL AND cg.reliability_score < 70 THEN
    adv := adv || jsonb_build_object('code','reliability','label','Low reliability score',
      'detail','Reliability score is '||cg.reliability_score||'.');
  END IF;

  RETURN jsonb_build_object(
    'eligible', jsonb_array_length(hard) = 0,
    'auto_approvable', jsonb_array_length(hard) = 0 AND jsonb_array_length(soft) = 0,
    'hard', hard, 'soft', soft, 'advisory', adv,
    'weekly_hours', round(v_weekly::numeric,2), 'projected_weekly_hours', v_projected);
END;
$function$;

-- =============================================================================
-- 2. New bulk-eligibility RPC (additive, brand new function -- no prior overload,
--    no grants to preserve, no footgun exposure). Calls the single-candidate
--    function per id -- zero duplicated rule logic.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_assignment_eligibility_bulk(_shift_id uuid, _caregiver_ids uuid[])
RETURNS TABLE(caregiver_id uuid, result jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT cid, public.check_assignment_eligibility(_shift_id, cid)
  FROM unnest(_caregiver_ids) AS cid;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_assignment_eligibility_bulk TO authenticated;

-- =============================================================================
-- 3. NULL-office write path: extend the existing time_off trigger function
--    (0-argument trigger function -- no signature-change risk), add two new
--    analogous triggers for shifts/client_orders. Trigger-based, closes the gap
--    for every future write path, not just OrderWizardDialog.tsx.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_time_off_agency_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.agency_id IS NULL THEN
    SELECT agency_id INTO NEW.agency_id FROM public.caregivers WHERE id = NEW.caregiver_id;
  END IF;
  IF NEW.virtual_office_id IS NULL THEN
    SELECT virtual_office_id INTO NEW.virtual_office_id FROM public.caregivers WHERE id = NEW.caregiver_id;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.set_shift_virtual_office_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.virtual_office_id IS NULL THEN
    SELECT virtual_office_id INTO NEW.virtual_office_id FROM public.clients WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_set_shift_virtual_office_id ON public.shifts;
CREATE TRIGGER trg_set_shift_virtual_office_id
BEFORE INSERT ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.set_shift_virtual_office_id();

CREATE OR REPLACE FUNCTION public.set_client_order_virtual_office_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.virtual_office_id IS NULL THEN
    SELECT virtual_office_id INTO NEW.virtual_office_id FROM public.clients WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_set_client_order_virtual_office_id ON public.client_orders;
CREATE TRIGGER trg_set_client_order_virtual_office_id
BEFORE INSERT ON public.client_orders
FOR EACH ROW EXECUTE FUNCTION public.set_client_order_virtual_office_id();

-- =============================================================================
-- 4. AvailableShifts minimal unblock: one additive SELECT policy. Every existing
--    shifts policy (staff management, own-assigned-shift, own-client-shift) is
--    untouched -- this only widens visibility, cannot narrow anything.
-- =============================================================================
CREATE POLICY "Caregivers view open shifts in their office"
ON public.shifts FOR SELECT TO authenticated
USING (
  status IN ('open', 'unassigned')
  AND EXISTS (
    SELECT 1 FROM public.caregivers c
    WHERE c.user_id = auth.uid()
      AND c.agency_id = shifts.agency_id
      AND c.virtual_office_id = shifts.virtual_office_id
  )
);

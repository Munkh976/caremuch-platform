-- REFERENCE ONLY: not a migration, never run by the Supabase CLI. Proven on PGlite (exact post-B2 catalog
-- restore, function bodies included).
-- Phase C rollback (one transaction), C-03 first. The seven changed scheduling functions are restored
-- VERBATIM from their live definitions captured 2026-10-04 (create_progress_note_for_shift from
-- B2-01); guard_virtual_office_flags and cp_derive_authorization_units from Phase A,
-- create_service_authorization from B1-05 (its 14-argument signature + grants), and
-- review_progress_note from B2-01. Data notes:
--   * authorizations with an opening balance are re-derived (old formula) before the column goes;
--   * shifts lose group_session_id (group links are dropped with group_sessions);
--   * events of the 2 Phase C types must go before the 42-value CHECK returns. ON ANY NON-DEV
--     PROJECT THEY ARE ARCHIVED FIRST, NEVER JUST DELETED (copy out + count check, same transaction).
BEGIN;
DELETE FROM public.events WHERE event_type IN ('group_session_created', 'shift_group_session_set');

-- C-03
CREATE OR REPLACE FUNCTION public.review_progress_note(_note_id uuid, _billable boolean, _non_billable_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n record; a record; v_left numeric;
BEGIN
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided FOR UPDATE;
  PERFORM cp_require_scope(n.agency_id, n.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF n.status <> 'submitted' THEN RAISE EXCEPTION 'Only a submitted note can be reviewed' USING ERRCODE = '22023'; END IF;
  IF _billable IS NULL THEN RAISE EXCEPTION 'Say whether the visit is billable' USING ERRCODE = '22023'; END IF;

  IF NOT _billable THEN
    IF COALESCE(btrim(_non_billable_reason), '') = '' OR length(_non_billable_reason) > 1000 THEN
      RAISE EXCEPTION 'A non-billable review needs a reason (at most 1000 characters)' USING ERRCODE = '22023';
    END IF;
    UPDATE public.progress_notes SET billable = false, non_billable_reason = btrim(_non_billable_reason), authorization_id = NULL,
           status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = n.id;
    PERFORM cp_audit(n.agency_id, n.virtual_office_id, 'progress_note_reviewed', 'progress_note', n.id,
      jsonb_build_object('note_id', n.id, 'billable', false, 'units_used', 0));
    RETURN jsonb_build_object('billable', false, 'units_used', 0);
  END IF;
  IF _non_billable_reason IS NOT NULL THEN RAISE EXCEPTION 'A billable review has no non-billable reason' USING ERRCODE = '22023'; END IF;

  -- lock every authorization of this client + service in a fixed order (no deadlocks between
  -- reviewers); the next statement then reads the committed units after any concurrent review
  PERFORM 1 FROM public.service_authorizations
   WHERE client_id = n.client_id AND service_type = n.service_type ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM public.service_authorizations
   WHERE client_id = n.client_id AND service_type = n.service_type
     AND effective_date <= n.service_date AND expiration_date >= n.service_date
     AND units_available >= n.units_used
   ORDER BY expiration_date, created_at, id
   LIMIT 1;
  IF a.id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.service_authorizations WHERE client_id = n.client_id AND service_type = n.service_type) THEN
      RAISE EXCEPTION 'Not billable yet: the client has no authorization for this service' USING ERRCODE = '22023';
    ELSIF NOT EXISTS (SELECT 1 FROM public.service_authorizations WHERE client_id = n.client_id AND service_type = n.service_type
                        AND effective_date <= n.service_date AND expiration_date >= n.service_date) THEN
      RAISE EXCEPTION 'Not billable yet: the service date is outside every authorization''s dates' USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'Not billable yet: not enough authorized units remain (% needed)', n.units_used USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.progress_notes SET billable = true, non_billable_reason = NULL, authorization_id = a.id,
         status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = n.id;
  SELECT units_available INTO v_left FROM public.service_authorizations WHERE id = a.id;
  IF v_left < 0 THEN RAISE EXCEPTION 'Not billable yet: not enough authorized units remain' USING ERRCODE = '22023'; END IF;
  PERFORM cp_audit(n.agency_id, n.virtual_office_id, 'progress_note_reviewed', 'progress_note', n.id,
    jsonb_build_object('note_id', n.id, 'billable', true, 'authorization_id', a.id, 'units_used', n.units_used));
  RETURN jsonb_build_object('billable', true, 'authorization_id', a.id, 'units_used', n.units_used, 'units_left', v_left);
END $$;

DROP FUNCTION IF EXISTS public.create_service_authorization(uuid, text, text, numeric, date, date, integer, text, text, text,
  public.auth_period_type, numeric, text, jsonb, numeric);
CREATE FUNCTION public.create_service_authorization(
  _client_id uuid, _service_type text, _auth_number text, _units_authorized numeric,
  _effective_date date, _expiration_date date,
  _unit_minutes integer DEFAULT 15, _service_code text DEFAULT NULL, _modifier text DEFAULT NULL,
  _service_description text DEFAULT NULL, _period_type public.auth_period_type DEFAULT NULL,
  _units_per_period numeric DEFAULT NULL, _authorizing_agent_notes text DEFAULT NULL,
  _field_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record; v_num text := btrim(_auth_number); v_ver uuid; v_snap jsonb; v_id uuid;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO c FROM public.clients WHERE id = _client_id;
  PERFORM cp_require_scope(c.agency_id, c.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF c.virtual_office_id IS NULL THEN
    RAISE EXCEPTION 'The client has no office, so no service type can be authorized' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.office_service_types s WHERE s.virtual_office_id = c.virtual_office_id
                   AND s.service_type = _service_type AND s.is_active) THEN
    RAISE EXCEPTION 'This office does not provide that service type' USING ERRCODE = '22023';
  END IF;
  IF v_num IS NULL OR v_num !~ '^[[:graph:]][[:print:]]{0,63}$' THEN
    RAISE EXCEPTION 'The authorization number must be 1-64 printable characters' USING ERRCODE = '22023';
  END IF;
  IF _units_authorized IS NULL OR _units_authorized <= 0 OR _units_authorized > 100000 THEN
    RAISE EXCEPTION 'Units authorized must be greater than 0' USING ERRCODE = '22023';
  END IF;
  IF _effective_date IS NULL OR _expiration_date IS NULL OR _expiration_date < _effective_date THEN
    RAISE EXCEPTION 'Valid effective and expiration dates are required' USING ERRCODE = '22023';
  END IF;
  IF _unit_minutes IS NULL OR _unit_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'Unit minutes must be between 1 and 1440' USING ERRCODE = '22023';
  END IF;
  IF _units_per_period IS NOT NULL AND _units_per_period <= 0 THEN
    RAISE EXCEPTION 'Units per period must be greater than 0' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(_service_code, '')) > 32 OR length(COALESCE(_modifier, '')) > 32
     OR length(COALESCE(_service_description, '')) > 2000 OR length(COALESCE(_authorizing_agent_notes, '')) > 4000 THEN
    RAISE EXCEPTION 'A text field is too long' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(c.agency_id::text || ':' || upper(v_num), 0));
  IF EXISTS (SELECT 1 FROM public.service_authorizations WHERE agency_id = c.agency_id AND upper(auth_number) = upper(v_num)) THEN
    RAISE EXCEPTION 'This authorization number already exists in your agency' USING ERRCODE = '23505';
  END IF;

  v_ver := cp_resolve_template(c.agency_id, c.virtual_office_id, 'authorization', NULL);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;
  PERFORM cp_validate_field_values(v_snap, COALESCE(_field_values, '{}'::jsonb));

  INSERT INTO public.service_authorizations (agency_id, virtual_office_id, client_id, auth_number, service_code, modifier,
    service_type, service_description, units_authorized, period_type, units_per_period, unit_minutes,
    effective_date, expiration_date, source_adapter, authorizing_agent_notes,
    template_id, template_version, field_snapshot, field_values)
  VALUES (c.agency_id, c.virtual_office_id, c.id, v_num, NULLIF(btrim(_service_code), ''), NULLIF(btrim(_modifier), ''),
    _service_type, _service_description, _units_authorized, _period_type, _units_per_period, _unit_minutes,
    _effective_date, _expiration_date, 'manual', _authorizing_agent_notes,
    (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap, COALESCE(_field_values, '{}'::jsonb))
  RETURNING id INTO v_id;

  PERFORM cp_audit(c.agency_id, c.virtual_office_id, 'authorization_created', 'service_authorization', v_id,
    jsonb_build_object('authorization_id', v_id, 'units_authorized', _units_authorized));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_service_authorization(uuid, text, text, numeric, date, date, integer, text, text, text,
  public.auth_period_type, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_service_authorization(uuid, text, text, numeric, date, date, integer, text, text, text,
  public.auth_period_type, numeric, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cp_derive_authorization_units()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.units_available := NEW.units_authorized - COALESCE((
    SELECT SUM(n.units_used) FROM public.progress_notes n
    WHERE n.authorization_id = NEW.id AND n.billable AND NOT n.voided), 0);
  RETURN NEW;
END $$;
UPDATE public.service_authorizations SET units_authorized = units_authorized WHERE units_used_before_caremuch <> 0;   -- re-derive (old formula)
ALTER TABLE public.service_authorizations DROP CONSTRAINT IF EXISTS service_authorizations_units_before_chk,
  DROP COLUMN IF EXISTS units_used_before_caremuch;

-- C-02: restore the seven functions exactly as they were (identical signatures: ACLs unchanged)
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

CREATE OR REPLACE FUNCTION public.check_assignment_eligibility_bulk(_shift_id uuid, _caregiver_ids uuid[])
 RETURNS TABLE(caregiver_id uuid, result jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT cid, public.check_assignment_eligibility(_shift_id, cid)
  FROM unnest(_caregiver_ids) AS cid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_caregiver_to_shift(_shift_id uuid, _caregiver_id uuid, _method assignment_method DEFAULT 'manual'::assignment_method, _notes text DEFAULT NULL::text, _override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS E'\r
DECLARE\r
  elig jsonb; s record; existing record; v_id uuid; v_override boolean := false;\r
BEGIN\r
  IF NOT public.is_agency_staff(auth.uid()) THEN\r
    RAISE EXCEPTION ''Only agency staff can assign shifts'' USING ERRCODE=''42501'';\r
  END IF;\r
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;\r
  IF NOT FOUND THEN RAISE EXCEPTION ''Shift not found'' USING ERRCODE=''P0002''; END IF;\r
  IF s.agency_id IS DISTINCT FROM public.current_agency_id() THEN\r
    RAISE EXCEPTION ''Shift belongs to another agency'' USING ERRCODE=''42501'';\r
  END IF;\r
\r
  elig := public.check_assignment_eligibility(_shift_id, _caregiver_id);\r
\r
  IF jsonb_array_length(elig->''hard'') > 0 THEN\r
    RAISE EXCEPTION ''Assignment refused: %'', (\r
      SELECT string_agg(x->>''detail'', '' '') FROM jsonb_array_elements(elig->''hard'') x\r
    ) USING ERRCODE=''23514'';\r
  END IF;\r
\r
  IF jsonb_array_length(elig->''soft'') > 0 THEN\r
    IF _override_reason IS NULL OR btrim(_override_reason) = '''' THEN\r
      RAISE EXCEPTION ''Override reason required: %'', (\r
        SELECT string_agg(x->>''detail'', '' '') FROM jsonb_array_elements(elig->''soft'') x\r
      ) USING ERRCODE=''23514'';\r
    END IF;\r
    v_override := true;\r
  END IF;\r
\r
  PERFORM set_config(''caremuch.assignment_ctx'',''1'',true);\r
\r
  SELECT * INTO existing FROM public.shift_assignments\r
   WHERE shift_id=_shift_id AND status NOT IN (''completed'',''cancelled'') LIMIT 1;\r
\r
  IF FOUND THEN\r
    UPDATE public.shift_assignments\r
       SET caregiver_id=_caregiver_id, status=''scheduled'', assignment_method=_method,\r
           notes=COALESCE(_notes,notes), assigned_at=now(),\r
           override_reason=CASE WHEN v_override THEN btrim(_override_reason) ELSE NULL END,\r
           override_by=CASE WHEN v_override THEN auth.uid() ELSE NULL END,\r
           override_at=CASE WHEN v_override THEN now() ELSE NULL END\r
     WHERE id=existing.id\r
     RETURNING id INTO v_id;\r
  ELSE\r
    INSERT INTO public.shift_assignments(shift_id, caregiver_id, status, assignment_method, notes,\r
      override_reason, override_by, override_at)\r
    VALUES (_shift_id,_caregiver_id,''scheduled'',_method,_notes,\r
      CASE WHEN v_override THEN btrim(_override_reason) END,\r
      CASE WHEN v_override THEN auth.uid() END,\r
      CASE WHEN v_override THEN now() END)\r
    RETURNING id INTO v_id;\r
  END IF;\r
\r
  PERFORM set_config(''caremuch.assignment_ctx'','''',true);\r
  RETURN jsonb_build_object(''assignment_id'', v_id, ''overridden'', v_override, ''eligibility'', elig);\r
END;\r
';
-- (assign_caregiver_to_shift: its stored body contains CR characters on DEV; restored byte-for-byte, md5(prosrc) 8771fa25cc11ac4af78ee374c5b2506b)

CREATE OR REPLACE FUNCTION public.check_caregiver_shifts_eligibility(_shift_ids uuid[])
 RETURNS TABLE(shift_id uuid, result jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cg uuid;
BEGIN
  SELECT id INTO v_cg FROM public.caregivers WHERE user_id = auth.uid() LIMIT 1;
  IF v_cg IS NULL THEN
    RETURN; -- caller isn't a caregiver -- empty set, not an error
  END IF;

  RETURN QUERY
  SELECT sid, public.check_assignment_eligibility(sid, v_cg)
  FROM unnest(_shift_ids) AS sid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.caregiver_pick_up_shift(_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cg uuid; elig jsonb; s record; v_id uuid;
BEGIN
  SELECT id INTO v_cg FROM public.caregivers WHERE user_id = auth.uid() LIMIT 1;
  IF v_cg IS NULL THEN RAISE EXCEPTION 'No caregiver profile for this user' USING ERRCODE='42501'; END IF;

  SELECT * INTO s FROM public.shifts WHERE id=_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found' USING ERRCODE='P0002'; END IF;
  IF s.status NOT IN ('open','unassigned') THEN
    RAISE EXCEPTION 'Shift is not open for pick-up' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_assignments a WHERE a.shift_id=_shift_id AND a.status<>'cancelled') THEN
    RAISE EXCEPTION 'Shift is already assigned' USING ERRCODE='23514';
  END IF;

  elig := public.check_assignment_eligibility(_shift_id, v_cg);
  -- CHANGED: was `jsonb_array_length(elig->'hard') > 0 OR jsonb_array_length(elig->'soft') > 0`.
  -- Self-pickup now blocks on hard issues only -- soft issues (availability, service-area
  -- over the zip list) are self-consented by the caregiver's own act of picking it up.
  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Pick-up refused: %', (
      SELECT string_agg(x->>'detail',' ') FROM jsonb_array_elements(elig->'hard') x
    ) USING ERRCODE='23514';
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','1',true);
  INSERT INTO public.shift_assignments(shift_id, caregiver_id, status, assignment_method)
  VALUES (_shift_id, v_cg, 'scheduled', 'picked_up') RETURNING id INTO v_id;
  PERFORM set_config('caremuch.assignment_ctx','',true);

  RETURN jsonb_build_object('assignment_id', v_id, 'eligibility', elig);
END;
$function$;

CREATE OR REPLACE FUNCTION public.caregiver_pickup_trade_shift(_trade_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cg record;
  t record;
  s record;
  elig jsonb;
  existing record;
  v_id uuid;
  v_claimed uuid;
BEGIN
  SELECT cg.id, cg.agency_id, cg.virtual_office_id
    INTO v_cg
  FROM public.caregivers cg
  WHERE cg.user_id = auth.uid();
  IF v_cg.id IS NULL THEN
    RAISE EXCEPTION 'No caregiver profile for this user' USING ERRCODE='42501';
  END IF;

  SELECT * INTO t FROM public.shift_trades WHERE id = _trade_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found' USING ERRCODE='P0002'; END IF;
  IF t.status <> 'pending' OR t.requires_manager_approval THEN
    RAISE EXCEPTION 'This trade is no longer available' USING ERRCODE='23514';
  END IF;
  IF t.original_caregiver_id = v_cg.id THEN
    RAISE EXCEPTION 'You cannot pick up your own dropped shift' USING ERRCODE='23514';
  END IF;

  SELECT * INTO s FROM public.shifts WHERE id = t.shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found' USING ERRCODE='P0002'; END IF;
  -- Office scope: shift_trades itself has no virtual_office_id column and its own RLS is
  -- agency-wide only (see docs/known-issues.md) -- this function enforces the same
  -- office boundary get_caregiver_trade_shifts() already applies at read time, so a
  -- caregiver can't pick up a trade this function's own read path wouldn't have shown them.
  IF s.agency_id IS DISTINCT FROM v_cg.agency_id OR s.virtual_office_id IS DISTINCT FROM v_cg.virtual_office_id THEN
    RAISE EXCEPTION 'This trade is not available to you' USING ERRCODE='42501';
  END IF;

  elig := public.check_assignment_eligibility(t.shift_id, v_cg.id);

  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Pick-up refused: %', (
      SELECT string_agg(x->>'detail',' ') FROM jsonb_array_elements(elig->'hard') x
    ) USING ERRCODE='23514';
  END IF;

  -- Soft-only: escalate to a manager, exactly like the existing staff-facing
  -- completeTrade() flow -- this is unchanged trade-path behavior, just reachable from a
  -- caregiver-safe entry point now. Claim the row atomically (WHERE status='pending') so
  -- two caregivers racing the same trade can't both succeed.
  IF jsonb_array_length(elig->'soft') > 0 THEN
    UPDATE public.shift_trades
       SET new_caregiver_id = v_cg.id,
           requires_manager_approval = true,
           approval_reasons = ARRAY(
             SELECT x->>'label' FROM jsonb_array_elements(elig->'hard' || elig->'soft') x
           ),
           eligibility_snapshot = elig,
           updated_at = now()
     WHERE id = _trade_id AND status = 'pending'
    RETURNING id INTO v_claimed;
    IF v_claimed IS NULL THEN
      RAISE EXCEPTION 'This trade is no longer available' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('status', 'sent_for_approval', 'eligibility', elig);
  END IF;

  -- Clean: claim the trade FIRST (atomic, race-safe), only then touch shift_assignments --
  -- avoids a losing concurrent caller reassigning the shift after another caller already won.
  UPDATE public.shift_trades
     SET new_caregiver_id = v_cg.id,
         status = 'accepted',
         auto_approved = true,
         requires_manager_approval = false,
         eligibility_snapshot = elig,
         decided_by = auth.uid(),
         resolved_at = now(),
         updated_at = now()
   WHERE id = _trade_id AND status = 'pending'
  RETURNING id INTO v_claimed;
  IF v_claimed IS NULL THEN
    RAISE EXCEPTION 'This trade is no longer available' USING ERRCODE='23514';
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','1',true);

  -- The shift is currently assigned to the ORIGINAL caregiver (trades don't touch
  -- shifts.status) -- reassign the existing row, mirroring assign_caregiver_to_shift()'s
  -- own existing-vs-insert branch exactly, rather than inserting a second row.
  SELECT * INTO existing FROM public.shift_assignments
   WHERE shift_id = t.shift_id AND status NOT IN ('completed','cancelled') LIMIT 1;

  IF FOUND THEN
    UPDATE public.shift_assignments
       SET caregiver_id = v_cg.id, status = 'scheduled', assignment_method = 'traded', assigned_at = now()
     WHERE id = existing.id
     RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.shift_assignments (shift_id, caregiver_id, status, assignment_method)
    VALUES (t.shift_id, v_cg.id, 'scheduled', 'traded')
    RETURNING id INTO v_id;
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','',true);

  RETURN jsonb_build_object('status', 'picked_up', 'assignment_id', v_id, 'eligibility', elig);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_progress_note_for_shift(_shift_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record; v_tz text; v_start timestamptz; v_end timestamptz; v_svc text; v_kind public.progress_note_kind;
  v_plan record; v_existing uuid; v_ver uuid; v_snap jsonb; v_id uuid; v_mgr boolean; v_cg boolean;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id FOR UPDATE;               -- serializes creators
  v_mgr := s.id IS NOT NULL AND cp_staff_in_scope(s.agency_id, s.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  v_cg := s.id IS NOT NULL AND cp_is_assigned_caregiver(s.caregiver_id);
  IF NOT (v_mgr OR v_cg) THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;

  SELECT id INTO v_existing FROM public.progress_notes WHERE shift_id = s.id AND NOT voided;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;                             -- idempotent, no event

  IF s.virtual_office_id IS NULL THEN RAISE EXCEPTION 'This shift has no office' USING ERRCODE = '22023'; END IF;
  IF s.caregiver_id IS NULL THEN RAISE EXCEPTION 'This shift has no assigned caregiver' USING ERRCODE = '22023'; END IF;
  IF s.status = 'cancelled' THEN RAISE EXCEPTION 'This shift is cancelled' USING ERRCODE = '22023'; END IF;
  SELECT timezone INTO v_tz FROM public.virtual_office WHERE id = s.virtual_office_id;
  v_start := (s.shift_date + s.start_time) AT TIME ZONE v_tz;
  v_end := (s.shift_date + s.end_time) AT TIME ZONE v_tz;
  IF v_end <= v_start THEN v_end := v_end + interval '1 day'; END IF;
  IF v_cg AND NOT v_mgr AND now() < v_start THEN
    RAISE EXCEPTION 'The note opens when the shift starts' USING ERRCODE = '22023';
  END IF;

  SELECT service_type INTO v_svc FROM public.office_service_types
   WHERE virtual_office_id = s.virtual_office_id AND care_type_code = s.care_type_code AND is_active;
  IF v_svc IS NULL THEN RAISE EXCEPTION 'This office has no service mapping for the shift''s care type' USING ERRCODE = '22023'; END IF;
  IF v_svc NOT IN ('cls', 'respite') THEN RAISE EXCEPTION 'Progress notes are kept for CLS and respite services only' USING ERRCODE = '22023'; END IF;
  v_kind := v_svc::public.progress_note_kind;

  SELECT * INTO v_plan FROM public.care_plans
   WHERE client_id = s.client_id AND status = 'active'
     AND (effective_date IS NULL OR effective_date <= s.shift_date) AND (expiration_date IS NULL OR expiration_date >= s.shift_date);
  IF v_kind = 'cls' AND v_plan.id IS NULL THEN
    RAISE EXCEPTION 'The client has no active plan on this date' USING ERRCODE = '22023';
  END IF;

  v_ver := cp_resolve_template(s.agency_id, s.virtual_office_id, 'progress_note', NULL);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;

  INSERT INTO public.progress_notes (agency_id, virtual_office_id, client_id, caregiver_id, shift_id, care_plan_id,
    training_version, note_kind, service_type, service_date, scheduled_start, scheduled_end, units_scheduled,
    due_at, template_id, template_version, field_snapshot)
  VALUES (s.agency_id, s.virtual_office_id, s.client_id, s.caregiver_id, s.id, v_plan.id, v_plan.training_version,
    v_kind, v_svc, s.shift_date, v_start, v_end, floor(extract(epoch FROM (v_end - v_start)) / 60 / 15),
    ((s.shift_date + 2)::timestamp AT TIME ZONE v_tz), (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap)
  RETURNING id INTO v_id;

  IF v_kind = 'cls' THEN       -- one entry per this_agency objective of this service; none for CM/others
    INSERT INTO public.progress_note_entries (progress_note_id, objective_id)
    SELECT v_id, o.id FROM public.care_plan_objectives o JOIN public.care_plan_goals g ON g.id = o.goal_id
     WHERE g.care_plan_id = v_plan.id AND o.responsible_party = 'this_agency' AND o.service_type = v_svc
     ORDER BY g.seq, o.seq;
  END IF;
  PERFORM cp_audit(s.agency_id, s.virtual_office_id, 'progress_note_created', 'progress_note', v_id,
    jsonb_build_object('note_id', v_id, 'shift_id', s.id, 'entries', (SELECT count(*) FROM public.progress_note_entries WHERE progress_note_id = v_id)));
  RETURN v_id;
END $$;

DROP FUNCTION IF EXISTS public.list_caregivers_needing_retraining(uuid);
DROP FUNCTION IF EXISTS public.cp_eligibility_core(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.cp_lock_client_authorizations(uuid);
DROP FUNCTION IF EXISTS public.cp_shift_client_context(uuid);
DROP FUNCTION IF EXISTS public.cp_caregiver_safe_eligibility(jsonb);
DROP FUNCTION IF EXISTS public.cp_safe_issue_list(jsonb);
DROP FUNCTION IF EXISTS public.cp_projected_units(uuid, text, date, integer, uuid);
DROP FUNCTION IF EXISTS public.cp_shift_units(date, time, time, text);
DROP FUNCTION IF EXISTS public.cp_period_left(uuid, public.auth_period_type, numeric, smallint, date, uuid[], date[], numeric[]);
DROP FUNCTION IF EXISTS public.cp_period_window(public.auth_period_type, date, smallint);

-- C-01
DROP FUNCTION IF EXISTS public.set_shift_group_session(uuid, uuid);
DROP FUNCTION IF EXISTS public.create_group_session(uuid, date, time, time, text, smallint);
DROP TRIGGER IF EXISTS trg_cp_guard_shift_group_session ON public.shifts;
DROP FUNCTION IF EXISTS public.cp_guard_shift_group_session();
ALTER TABLE public.shifts DROP COLUMN IF EXISTS group_session_id;
DROP TABLE IF EXISTS public.group_sessions;
CREATE OR REPLACE FUNCTION public.guard_virtual_office_flags()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL
     OR has_role(_uid, 'system_admin'::app_role)
     OR has_role(_uid, 'agency_admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.compliance_enforcement_enabled OR NEW.care_plan_module_enabled OR NEW.billing_week_start <> 1 THEN
      RAISE EXCEPTION 'Only an agency admin can set the care-plan module, compliance enforcement or billing week'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.compliance_enforcement_enabled IS DISTINCT FROM OLD.compliance_enforcement_enabled
     OR NEW.care_plan_module_enabled IS DISTINCT FROM OLD.care_plan_module_enabled
     OR NEW.billing_week_start IS DISTINCT FROM OLD.billing_week_start THEN
    RAISE EXCEPTION 'Only an agency admin can change the care-plan module, compliance enforcement or billing week setting'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE public.virtual_office DROP COLUMN IF EXISTS group_session_max_clients, DROP COLUMN IF EXISTS care_plan_module_enabled_at;
ALTER TABLE public.events
  DROP CONSTRAINT events_event_type_check,
  ADD CONSTRAINT events_event_type_check CHECK (event_type = ANY (ARRAY[
  'caregiver_application_received', 'caregiver_approved', 'caregiver_rejected',
  'care_request_received', 'care_request_converted_to_client',
  'shift_created', 'shift_assigned', 'shift_filled', 'shift_completed', 'shift_cancelled', 'shift_no_show',
  'caregiver_pickup', 'assignment_released', 'rating_added',
  'time_entry_submitted', 'time_entry_approved', 'earnings_computed',
  'account_link_issued',
  'care_plan_module_enabled', 'template_draft_saved', 'template_published', 'instance_template_upgraded',
  'care_plan_created', 'care_plan_renewed', 'care_plan_updated', 'training_version_bumped',
  'objective_measures_set', 'authorization_created', 'client_document_saved',
  'credential_entered', 'credential_overridden', 'inservice_signed', 'training_recorded',
  'training_record_overridden',
  'progress_note_created', 'progress_note_submitted', 'progress_note_returned', 'progress_note_reviewed',
  'progress_note_voided', 'billing_batch_built', 'billing_batch_approved', 'billing_batch_billed'
]::text[]));

-- On DEV only (migration history), same transaction:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20261009120000','20261009120100','20261009120200');
COMMIT;

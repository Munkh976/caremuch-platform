-- Post-demo 1b (owner-approved, Oct 21): add caregivers to an EXISTING training session (ISK 33.01_01F) of the current
-- plan version. One new function; nothing else changes (record_training_form, the tables, policies and triggers are
-- untouched).
--
-- add_training_attendees(_training_form_id, _records): SECURITY DEFINER; the same roles and scope as
-- record_training_form (hr_staff / manager / agency_admin of the plan's office, and of each caregiver's office).
-- _records: [{caregiver_id, signed_date?, training_method?, primary_clinician_name?}], 1–100, each caregiver once.
-- The new attendees get the session's date of training and trainer (its earliest attendee's date, and its trainer).
-- Refused (22023): the session's plan isn't the client's active plan or the session isn't at the plan's current
-- training_version (superseded); a caregiver already in the session; an unknown property; a signature date in the
-- future. Other offices / agencies: generic 'Not found or not allowed' (42501).
-- Audit: the existing event type 'training_recorded' (ids and counts only; 'added': true), so the events CHECK is
-- unchanged. REVOKE ALL FROM PUBLIC, anon; GRANT authenticated (rule 14).

CREATE FUNCTION public.add_training_attendees(_training_form_id uuid, _records jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; p record; x jsonb; g record; v_date date; v_trainer text; v_n int;
BEGIN
  SELECT * INTO t FROM public.plan_training_forms WHERE id = _training_form_id;
  SELECT * INTO p FROM public.care_plans WHERE id = t.care_plan_id FOR SHARE;   -- blocks a concurrent training_version bump
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
  IF p.status <> 'active' OR t.training_version <> p.training_version THEN
    RAISE EXCEPTION 'This session is for an earlier plan version; record a new session for the current version' USING ERRCODE = '22023';
  END IF;
  IF _records IS NULL OR jsonb_typeof(_records) <> 'array' OR jsonb_array_length(_records) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'records must list 1-100 caregivers' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT e ->> 'caregiver_id') FROM jsonb_array_elements(_records) e) <> jsonb_array_length(_records) THEN
    RAISE EXCEPTION 'Each caregiver can appear once' USING ERRCODE = '22023';
  END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(_records) e LOOP
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(x) k WHERE k <> ALL (ARRAY['caregiver_id','signed_date','training_method','primary_clinician_name'])) THEN
      RAISE EXCEPTION 'Unknown training record property' USING ERRCODE = '22023';
    END IF;
    SELECT id, agency_id, virtual_office_id INTO g FROM public.caregivers WHERE id = (x ->> 'caregiver_id')::uuid;
    IF g.agency_id IS DISTINCT FROM p.agency_id THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
    PERFORM cp_require_scope(g.agency_id, g.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
    IF EXISTS (SELECT 1 FROM public.plan_training_records WHERE training_form_id = t.id AND caregiver_id = g.id) THEN
      RAISE EXCEPTION 'A caregiver is already in this session' USING ERRCODE = '22023';
    END IF;
    IF (x ->> 'signed_date')::date > current_date + 1 OR length(COALESCE(x ->> 'primary_clinician_name', '')) > 200 THEN
      RAISE EXCEPTION 'A signature date can''t be in the future; names at most 200 characters' USING ERRCODE = '22023';
    END IF;
    IF x ->> 'training_method' IS NOT NULL AND x ->> 'training_method' <> ALL (ARRAY['pcp_meeting', 'outside_pcp']) THEN
      RAISE EXCEPTION 'Invalid training method' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- the session's date of training and trainer
  SELECT min(training_date), (array_agg(trainer_name ORDER BY created_at) FILTER (WHERE trainer_name IS NOT NULL))[1]
    INTO v_date, v_trainer FROM public.plan_training_records WHERE training_form_id = t.id;
  INSERT INTO public.plan_training_records (training_form_id, agency_id, virtual_office_id, caregiver_id, client_id,
    care_plan_id, training_version, training_date, training_method, primary_clinician_name, trainer_name, signed_date)
  SELECT t.id, t.agency_id, t.virtual_office_id, (e ->> 'caregiver_id')::uuid, t.client_id, t.care_plan_id, t.training_version,
         COALESCE(v_date, (t.created_at AT TIME ZONE 'UTC')::date), (e ->> 'training_method')::public.training_method,
         NULLIF(btrim(e ->> 'primary_clinician_name'), ''), v_trainer, (e ->> 'signed_date')::date
  FROM jsonb_array_elements(_records) e;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM cp_audit(t.agency_id, t.virtual_office_id, 'training_recorded', 'plan_training_form', t.id,
    jsonb_build_object('training_form_id', t.id, 'care_plan_id', t.care_plan_id, 'training_version', t.training_version, 'records', v_n, 'added', true));
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.add_training_attendees(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_training_attendees(uuid, jsonb) TO authenticated;

-- Phase B2-01 — progress notes: create_progress_note_for_shift, get_progress_note_for_caregiver,
-- save_progress_note_draft, submit_progress_note, return_progress_note, review_progress_note,
-- void_progress_note, list_overdue_notes.
-- Ripple care-plan module. Schema plan §5, §6, §2.1; arch §11.3, §12; owner decisions R1, R5, Q5,
-- Q9, Q10. DRAFT FOR REVIEW. Not pushed.
--
-- Roles: manager / agency_admin (clinical tier) for create, return, review, void, overdue list;
-- the shift's ASSIGNED caregiver (shifts.caregiver_id, kept in sync with shift_assignments) for
-- create (from the shift's start), read, draft and submit. Scheduler, hr_staff, system_admin,
-- clients and anon: nothing. Every scope failure raises the generic 'Not found or not allowed'.
-- Time: scheduled_start/end are built from the shift IN THE SHIFT OFFICE'S TIME ZONE
-- ((shift_date + start_time) AT TIME ZONE virtual_office.timezone; end +1 day when not after
-- start). The day-after deadline due_at = local midnight starting service_date + 2. Every "now"
-- is the database clock.
-- Authorization: chosen at REVIEW (FIFO), not at creation, so authorization_id becomes nullable;
-- a CHECK requires it on every billable reviewed/billed note. Draft notes consume no units.
-- Q10: no reviewer edit path exists: reviewers return a note; only the assigned caregiver edits,
-- and only while it is draft or returned.
-- Audited (fail closed, ids/counts/flags only): progress_note_created, progress_note_submitted,
-- progress_note_returned, progress_note_reviewed, progress_note_voided. Draft saves are not
-- audited (autosave; they change no authority column) — decision recorded in the B2 report.

-- =============================================================================================
-- 1. Schema additions
-- =============================================================================================
ALTER TABLE public.progress_notes
  ALTER COLUMN authorization_id DROP NOT NULL,
  ADD COLUMN service_type text,
  ADD COLUMN due_at timestamptz,
  ADD COLUMN late_submitted boolean NOT NULL DEFAULT false,
  ADD COLUMN returned_count integer NOT NULL DEFAULT 0,
  ADD COLUMN non_billable_reason text,
  ADD COLUMN batch_approved_at timestamptz,
  ADD COLUMN batch_approved_by uuid,
  ADD CONSTRAINT progress_notes_billable_needs_authorization_chk
    CHECK (status NOT IN ('reviewed', 'billed') OR NOT billable OR authorization_id IS NOT NULL),
  ADD CONSTRAINT progress_notes_non_billable_reason_chk
    CHECK (billable OR status NOT IN ('reviewed', 'billed') OR non_billable_reason IS NOT NULL);
CREATE INDEX progress_notes_due_idx ON public.progress_notes (virtual_office_id, due_at) WHERE status IN ('draft', 'returned') AND NOT voided;

-- Billed notes (and their entries) are immutable for every API caller; only the service role
-- (auth.uid() IS NULL: maintenance, fixtures) may touch them.
CREATE FUNCTION public.cp_guard_billed_note()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'billed' AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'A billed note cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.cp_guard_billed_note() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_cp_guard_billed_note BEFORE UPDATE OR DELETE ON public.progress_notes
FOR EACH ROW EXECUTE FUNCTION public.cp_guard_billed_note();

CREATE FUNCTION public.cp_guard_billed_note_entry()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _nid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.progress_note_id ELSE NEW.progress_note_id END;
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.progress_notes WHERE id = _nid AND status = 'billed') THEN
    RAISE EXCEPTION 'A billed note cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.cp_guard_billed_note_entry() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_cp_guard_billed_note_entry BEFORE INSERT OR UPDATE OR DELETE ON public.progress_note_entries
FOR EACH ROW EXECUTE FUNCTION public.cp_guard_billed_note_entry();

-- =============================================================================================
-- 2. Internal helpers
-- =============================================================================================
-- Is the caller the caregiver assigned to this note/shift?
CREATE FUNCTION public.cp_is_assigned_caregiver(_caregiver_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(_caregiver_id IS NOT NULL AND has_role(auth.uid(), 'caregiver'::public.app_role)
    AND EXISTS (SELECT 1 FROM public.caregivers g WHERE g.id = _caregiver_id AND g.user_id = auth.uid()), false)
$$;
REVOKE ALL ON FUNCTION public.cp_is_assigned_caregiver(uuid) FROM PUBLIC, anon, authenticated;

-- Live measures of one objective, in the shape the note stores in measures_snapshot.
CREATE FUNCTION public.cp_objective_measures(_objective_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('measure_id', m.id, 'kind', t.kind, 'prompt_text', m.prompt_text,
           'options', COALESCE(m.options, t.default_options), 'trial_count', m.trial_count, 'seq', m.seq)
         ORDER BY m.seq, m.id), '[]'::jsonb)
  FROM public.objective_measures m JOIN public.measure_types t ON t.id = m.measure_type_id
  WHERE m.objective_id = _objective_id AND m.is_active
$$;
REVOKE ALL ON FUNCTION public.cp_objective_measures(uuid) FROM PUBLIC, anon, authenticated;

-- One answer against one measure. _final = submit (an answer is required for every non-display
-- measure). Shapes: yes_no_na {value: Yes|No|N/A}; prompt_level {value: one of the options};
-- graded_steps {steps: [distinct option indexes]}; tally {count: 0-1000}; trials {trials: [{value:
-- Yes|No|N/A, text?}] x trial_count}; short_answer {value <= 500}; narrative {value <= 5000};
-- staff_note: display only, no answer allowed.
CREATE FUNCTION public.cp_validate_answer(_m jsonb, _a jsonb, _final boolean)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE k text := _m ->> 'kind'; opts jsonb := COALESCE(_m -> 'options', '[]'::jsonb); n int; x jsonb;
BEGIN
  IF k = 'staff_note' THEN
    IF _a IS NOT NULL THEN RAISE EXCEPTION 'A staff note is display-only' USING ERRCODE = '22023'; END IF;
    RETURN;
  END IF;
  IF _a IS NULL OR jsonb_typeof(_a) = 'null' THEN
    IF _final THEN RAISE EXCEPTION 'Every question must be answered before submitting' USING ERRCODE = '22023'; END IF;
    RETURN;
  END IF;
  IF jsonb_typeof(_a) <> 'object' THEN RAISE EXCEPTION 'An answer must be an object' USING ERRCODE = '22023'; END IF;
  IF k = 'yes_no_na' THEN
    IF (_a - 'value') <> '{}'::jsonb OR NOT (_a ->> 'value' = ANY (ARRAY['Yes', 'No', 'N/A'])) THEN
      RAISE EXCEPTION 'Answer Yes, No or N/A' USING ERRCODE = '22023'; END IF;
  ELSIF k = 'prompt_level' THEN
    IF (_a - 'value') <> '{}'::jsonb OR jsonb_typeof(_a -> 'value') <> 'string' OR NOT opts ? (_a ->> 'value') THEN
      RAISE EXCEPTION 'Choose one of the prompt levels' USING ERRCODE = '22023'; END IF;
  ELSIF k = 'graded_steps' THEN
    IF (_a - 'steps') <> '{}'::jsonb OR jsonb_typeof(_a -> 'steps') <> 'array' THEN
      RAISE EXCEPTION 'Steps must be a list' USING ERRCODE = '22023'; END IF;
    n := jsonb_array_length(opts);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(_a -> 'steps') s WHERE jsonb_typeof(s) <> 'number' OR (s #>> '{}')::numeric <> floor((s #>> '{}')::numeric)
               OR (s #>> '{}')::int < 0 OR (s #>> '{}')::int >= GREATEST(n, 1))
       OR (SELECT count(*) FROM jsonb_array_elements(_a -> 'steps')) <> (SELECT count(DISTINCT s) FROM jsonb_array_elements(_a -> 'steps') s) THEN
      RAISE EXCEPTION 'Steps must be distinct step numbers of this measure' USING ERRCODE = '22023'; END IF;
  ELSIF k = 'tally' THEN
    IF (_a - 'count') <> '{}'::jsonb OR jsonb_typeof(_a -> 'count') <> 'number' OR (_a ->> 'count')::numeric NOT BETWEEN 0 AND 1000
       OR (_a ->> 'count')::numeric <> floor((_a ->> 'count')::numeric) THEN
      RAISE EXCEPTION 'A tally is a whole number from 0 to 1000' USING ERRCODE = '22023'; END IF;
  ELSIF k = 'trials' THEN
    IF (_a - 'trials') <> '{}'::jsonb OR jsonb_typeof(_a -> 'trials') <> 'array'
       OR jsonb_array_length(_a -> 'trials') <> COALESCE((_m ->> 'trial_count')::int, -1) THEN
      RAISE EXCEPTION 'Answer every trial (% of them)', _m ->> 'trial_count' USING ERRCODE = '22023'; END IF;
    FOR x IN SELECT t FROM jsonb_array_elements(_a -> 'trials') t LOOP
      IF jsonb_typeof(x) <> 'object' OR (x - 'value' - 'text') <> '{}'::jsonb OR NOT (x ->> 'value' = ANY (ARRAY['Yes', 'No', 'N/A']))
         OR (x ? 'text' AND jsonb_typeof(x -> 'text') NOT IN ('string', 'null')) OR length(COALESCE(x ->> 'text', '')) > 500 THEN
        RAISE EXCEPTION 'Each trial is Yes, No or N/A with an optional short text' USING ERRCODE = '22023'; END IF;
    END LOOP;
  ELSIF k IN ('short_answer', 'narrative') THEN
    IF (_a - 'value') <> '{}'::jsonb OR jsonb_typeof(_a -> 'value') <> 'string'
       OR length(_a ->> 'value') > (CASE k WHEN 'short_answer' THEN 500 ELSE 5000 END)
       OR (_final AND btrim(_a ->> 'value') = '') THEN
      RAISE EXCEPTION 'Text answer missing or too long' USING ERRCODE = '22023'; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown measure kind' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cp_validate_answer(jsonb, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- One entry's data against its measure list: no unknown keys, every answer valid.
CREATE FUNCTION public.cp_validate_entry_data(_measures jsonb, _data jsonb, _final boolean)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE k text; m jsonb;
BEGIN
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' THEN RAISE EXCEPTION 'data must be an object' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(_data) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_measures) x WHERE x ->> 'measure_id' = k) THEN
      RAISE EXCEPTION 'An answer refers to a question that is not on this note' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR m IN SELECT x FROM jsonb_array_elements(_measures) x LOOP
    PERFORM cp_validate_answer(m, _data -> (m ->> 'measure_id'), _final);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.cp_validate_entry_data(jsonb, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 3. create_progress_note_for_shift — idempotent, one note per shift
-- =============================================================================================
CREATE FUNCTION public.create_progress_note_for_shift(_shift_id uuid)
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
REVOKE ALL ON FUNCTION public.create_progress_note_for_shift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_progress_note_for_shift(uuid) TO authenticated;

-- =============================================================================================
-- 4. get_progress_note_for_caregiver — the assigned caregiver's view (R5: minimum necessary)
-- =============================================================================================
-- Exactly these keys:
--   note:    id, status, note_kind, service_date, scheduled_start, scheduled_end, client_arrived_at,
--            actual_end, staff_client_ratio, location, narrative_text, staff_signature_name,
--            staff_signed_at, returned_reason, late_submitted, arrived_late, due_at,
--            client_first_name, client_last_initial
--   entries: entry_id, goal_text, objective_letter, objective_text, staff_instructions, notes_text,
--            answers, measures[ measure_id, kind, prompt_text, options, trial_count ]
-- Never: needs, diagnoses, MichiCANS, other objectives, other clients, units, authorization, pay.
CREATE FUNCTION public.get_progress_note_for_caregiver(_note_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n record; c record;
BEGIN
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided;
  IF n.id IS NULL OR NOT cp_is_assigned_caregiver(n.caregiver_id) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT first_name, left(last_name, 1) AS li INTO c FROM public.clients WHERE id = n.client_id;
  RETURN jsonb_build_object(
    'note', jsonb_build_object('id', n.id, 'status', n.status, 'note_kind', n.note_kind, 'service_date', n.service_date,
      'scheduled_start', n.scheduled_start, 'scheduled_end', n.scheduled_end, 'client_arrived_at', n.client_arrived_at,
      'actual_end', n.actual_end, 'staff_client_ratio', n.staff_client_ratio, 'location', n.location,
      'narrative_text', n.narrative_text, 'staff_signature_name', n.staff_signature_name, 'staff_signed_at', n.staff_signed_at,
      'returned_reason', n.returned_reason, 'late_submitted', n.late_submitted, 'arrived_late', n.arrived_late,
      'due_at', n.due_at, 'client_first_name', c.first_name, 'client_last_initial', c.li),
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object('entry_id', e.id, 'goal_text', g.goal_text,
        'objective_letter', o.letter, 'objective_text', o.objective_text, 'staff_instructions', o.staff_instructions,
        'notes_text', e.notes_text, 'answers', e.data,
        'measures', (SELECT COALESCE(jsonb_agg(jsonb_build_object('measure_id', x ->> 'measure_id', 'kind', x ->> 'kind',
                        'prompt_text', x ->> 'prompt_text', 'options', x -> 'options', 'trial_count', x -> 'trial_count')), '[]'::jsonb)
                     FROM jsonb_array_elements(COALESCE(e.measures_snapshot, cp_objective_measures(o.id))) x))
        ORDER BY g.seq, o.seq)
      FROM public.progress_note_entries e
      JOIN public.care_plan_objectives o ON o.id = e.objective_id
      JOIN public.care_plan_goals g ON g.id = o.goal_id
      WHERE e.progress_note_id = n.id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_progress_note_for_caregiver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_progress_note_for_caregiver(uuid) TO authenticated;

-- =============================================================================================
-- 5. save_progress_note_draft — assigned caregiver, draft or returned only
-- =============================================================================================
-- _header keys (all optional): client_arrived_at, actual_end, staff_client_ratio, location.
-- client_arrived_at must lie in [scheduled_start - 60 min, scheduled_end]; actual_end in
-- [scheduled_start, scheduled_end + 120 min]. _entries: [{entry_id, notes_text?, data?}] (data
-- replaces that entry's answers; partial answers allowed while drafting).
CREATE FUNCTION public.save_progress_note_draft(_note_id uuid, _header jsonb DEFAULT '{}'::jsonb,
                                                _entries jsonb DEFAULT '[]'::jsonb, _narrative_text text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n record; h jsonb := COALESCE(_header, '{}'::jsonb); e jsonb; ent record; v_arr timestamptz; v_end timestamptz;
BEGIN
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided FOR UPDATE;
  IF n.id IS NULL OR NOT cp_is_assigned_caregiver(n.caregiver_id) THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
  IF n.status NOT IN ('draft', 'returned') THEN RAISE EXCEPTION 'This note can no longer be edited' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(h) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(h) k WHERE k <> ALL (ARRAY['client_arrived_at','actual_end','staff_client_ratio','location'])) THEN
    RAISE EXCEPTION 'Unknown header field' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_arr := CASE WHEN h ? 'client_arrived_at' THEN (h ->> 'client_arrived_at')::timestamptz ELSE n.client_arrived_at END;
    v_end := CASE WHEN h ? 'actual_end' THEN (h ->> 'actual_end')::timestamptz ELSE n.actual_end END;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Times must be full timestamps with a time zone' USING ERRCODE = '22023'; END;
  IF v_arr IS NOT NULL AND (v_arr < n.scheduled_start - interval '60 minutes' OR v_arr > n.scheduled_end) THEN
    RAISE EXCEPTION 'The client''s arrival time must fall within the shift (up to 60 minutes early)' USING ERRCODE = '22023';
  END IF;
  IF v_end IS NOT NULL AND (v_end < n.scheduled_start OR v_end > n.scheduled_end + interval '120 minutes') THEN
    RAISE EXCEPTION 'The end time must fall within the shift (up to 2 hours late)' USING ERRCODE = '22023';
  END IF;
  IF h ? 'staff_client_ratio' AND h ->> 'staff_client_ratio' IS NOT NULL AND h ->> 'staff_client_ratio' !~ '^[0-9]{1,2}:[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Staff:client ratio looks like 1:3' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(h ->> 'location', '')) > 200 THEN RAISE EXCEPTION 'Location is at most 200 characters' USING ERRCODE = '22023'; END IF;
  IF _narrative_text IS NOT NULL AND (n.note_kind <> 'respite' OR length(_narrative_text) > 10000) THEN
    RAISE EXCEPTION 'Only a respite note has a session narrative (at most 10000 characters)' USING ERRCODE = '22023';
  END IF;
  IF _entries IS NULL OR jsonb_typeof(_entries) <> 'array' OR jsonb_array_length(_entries) > 100 THEN
    RAISE EXCEPTION 'entries must be a list' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(_entries) x LOOP
    IF jsonb_typeof(e) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k <> ALL (ARRAY['entry_id','notes_text','data'])) THEN
      RAISE EXCEPTION 'Unknown entry property' USING ERRCODE = '22023';
    END IF;
    SELECT pe.id, pe.objective_id INTO ent FROM public.progress_note_entries pe WHERE pe.id = (e ->> 'entry_id')::uuid AND pe.progress_note_id = n.id;
    IF ent.id IS NULL THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
    IF length(COALESCE(e ->> 'notes_text', '')) > 5000 THEN RAISE EXCEPTION 'Notes are at most 5000 characters' USING ERRCODE = '22023'; END IF;
    IF e ? 'data' THEN PERFORM cp_validate_entry_data(cp_objective_measures(ent.objective_id), e -> 'data', false); END IF;
    UPDATE public.progress_note_entries SET
      notes_text = CASE WHEN e ? 'notes_text' THEN e ->> 'notes_text' ELSE notes_text END,
      data = CASE WHEN e ? 'data' THEN e -> 'data' ELSE data END
    WHERE id = ent.id;
  END LOOP;
  UPDATE public.progress_notes SET
    client_arrived_at = v_arr, actual_end = v_end,
    actual_minutes = CASE WHEN v_arr IS NOT NULL AND v_end IS NOT NULL AND v_end > v_arr THEN (extract(epoch FROM (v_end - v_arr)) / 60)::int ELSE actual_minutes END,
    staff_client_ratio = CASE WHEN h ? 'staff_client_ratio' THEN h ->> 'staff_client_ratio' ELSE staff_client_ratio END,
    location = CASE WHEN h ? 'location' THEN NULLIF(btrim(h ->> 'location'), '') ELSE location END,
    narrative_text = COALESCE(_narrative_text, narrative_text)
  WHERE id = n.id;
END $$;
REVOKE ALL ON FUNCTION public.save_progress_note_draft(uuid, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_progress_note_draft(uuid, jsonb, jsonb, text) TO authenticated;

-- =============================================================================================
-- 6. submit_progress_note — assigned caregiver, typed signature
-- =============================================================================================
CREATE FUNCTION public.submit_progress_note(_note_id uuid, _typed_signature text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n record; e record; v_m jsonb; v_late boolean;
BEGIN
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided FOR UPDATE;
  IF n.id IS NULL OR NOT cp_is_assigned_caregiver(n.caregiver_id) THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
  IF n.status NOT IN ('draft', 'returned') THEN RAISE EXCEPTION 'This note was already submitted' USING ERRCODE = '22023'; END IF;
  IF now() < n.scheduled_start THEN RAISE EXCEPTION 'A note can be submitted once the shift has started' USING ERRCODE = '22023'; END IF;
  IF COALESCE(btrim(_typed_signature), '') = '' OR length(_typed_signature) > 200 THEN
    RAISE EXCEPTION 'Type your full name to sign (at most 200 characters)' USING ERRCODE = '22023';
  END IF;
  IF n.client_arrived_at IS NULL THEN RAISE EXCEPTION 'Record the client''s arrival time first' USING ERRCODE = '22023'; END IF;
  IF n.note_kind = 'respite' AND COALESCE(btrim(n.narrative_text), '') = '' THEN
    RAISE EXCEPTION 'A respite note needs the session narrative' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT id, objective_id, data FROM public.progress_note_entries WHERE progress_note_id = n.id LOOP
    v_m := cp_objective_measures(e.objective_id);
    PERFORM cp_validate_entry_data(v_m, e.data, true);
    UPDATE public.progress_note_entries SET measures_snapshot = v_m WHERE id = e.id;      -- questions as asked
  END LOOP;
  v_late := now() >= n.due_at;          -- same boundary as list_overdue_notes (due_at <= now)
  UPDATE public.progress_notes SET status = 'submitted', staff_signature_name = btrim(_typed_signature),
         staff_signed_at = now(), completed_on = now(), late_submitted = v_late
   WHERE id = n.id;
  PERFORM cp_audit(n.agency_id, n.virtual_office_id, 'progress_note_submitted', 'progress_note', n.id,
    jsonb_build_object('note_id', n.id, 'late_submitted', v_late, 'resubmission', n.status = 'returned'));
  RETURN jsonb_build_object('status', 'submitted', 'late_submitted', v_late);
END $$;
REVOKE ALL ON FUNCTION public.submit_progress_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_progress_note(uuid, text) TO authenticated;

-- =============================================================================================
-- 7. return_progress_note — manager / agency_admin; submitted -> returned (Q10)
-- =============================================================================================
CREATE FUNCTION public.return_progress_note(_note_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n record;
BEGIN
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided FOR UPDATE;
  PERFORM cp_require_scope(n.agency_id, n.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF n.status <> 'submitted' THEN RAISE EXCEPTION 'Only a submitted note can be returned' USING ERRCODE = '22023'; END IF;
  IF COALESCE(btrim(_reason), '') = '' OR length(_reason) > 1000 THEN
    RAISE EXCEPTION 'A reason is required (at most 1000 characters)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.progress_notes SET status = 'returned', returned_reason = btrim(_reason), returned_by = auth.uid(),
         returned_at = now(), returned_count = returned_count + 1
   WHERE id = n.id;
  PERFORM cp_audit(n.agency_id, n.virtual_office_id, 'progress_note_returned', 'progress_note', n.id,
    jsonb_build_object('note_id', n.id, 'returned_count', n.returned_count + 1));
END $$;
REVOKE ALL ON FUNCTION public.return_progress_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_progress_note(uuid, text) TO authenticated;

-- =============================================================================================
-- 8. review_progress_note — manager / agency_admin; submitted -> reviewed, FIFO authorization
-- =============================================================================================
-- Billable: the authorization of the same client and service type, valid on the service date, with
-- units_available >= this note's units_used, earliest expiration first; candidate rows locked
-- FOR UPDATE (a concurrent review waits and then re-checks the units). None fits -> refused with
-- the reason, note stays submitted. Non-billable: reason required, 0 units, no authorization.
CREATE FUNCTION public.review_progress_note(_note_id uuid, _billable boolean, _non_billable_reason text DEFAULT NULL)
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
REVOKE ALL ON FUNCTION public.review_progress_note(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_progress_note(uuid, boolean, text) TO authenticated;

-- =============================================================================================
-- 9. void_progress_note — manager / agency_admin; never once billed; units restored by trigger
-- =============================================================================================
CREATE FUNCTION public.void_progress_note(_note_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n record;
BEGIN
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided FOR UPDATE;
  PERFORM cp_require_scope(n.agency_id, n.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF n.status = 'billed' THEN RAISE EXCEPTION 'A billed note cannot be voided' USING ERRCODE = '22023'; END IF;
  IF COALESCE(btrim(_reason), '') = '' OR length(_reason) > 1000 THEN
    RAISE EXCEPTION 'A reason is required (at most 1000 characters)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.progress_notes SET voided = true, voided_at = now(), voided_by = auth.uid(), void_reason = btrim(_reason),
         billing_batch_id = NULL, batch_approved_at = NULL, batch_approved_by = NULL
   WHERE id = n.id;
  PERFORM cp_audit(n.agency_id, n.virtual_office_id, 'progress_note_voided', 'progress_note', n.id,
    jsonb_build_object('note_id', n.id, 'units_restored', CASE WHEN n.billable AND n.authorization_id IS NOT NULL THEN n.units_used ELSE 0 END));
END $$;
REVOKE ALL ON FUNCTION public.void_progress_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_progress_note(uuid, text) TO authenticated;

-- =============================================================================================
-- 10. list_overdue_notes — computed status for the dashboard (R9; no notifications sent)
-- =============================================================================================
-- Draft or returned, not voided, past the day-after deadline (due_at, office time zone) at
-- _as_of (default: the database's now()). _as_of exists so the boundary can be checked; it only
-- changes which rows are listed, never data.
CREATE FUNCTION public.list_overdue_notes(_office_id uuid, _as_of timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; v_at timestamptz := COALESCE(_as_of, now());
BEGIN
  SELECT id, agency_id INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin}'::public.app_role[]);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('note_id', n.id, 'caregiver_id', n.caregiver_id, 'client_id', n.client_id,
            'service_date', n.service_date, 'status', n.status, 'due_at', n.due_at) ORDER BY n.due_at, n.id)
    FROM public.progress_notes n
    WHERE n.virtual_office_id = o.id AND n.status IN ('draft', 'returned') AND NOT n.voided AND n.due_at <= v_at), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_overdue_notes(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_overdue_notes(uuid, timestamptz) TO authenticated;

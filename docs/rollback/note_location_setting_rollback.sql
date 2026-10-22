-- Rollback of 20261031130000_note_location_setting.sql: restores create_progress_note_for_shift and
-- get_progress_note_for_caregiver byte-identical to DEV before the push (bodies of 20261029120100 / 20261008120000), drops
-- set_office_note_location, restores the events CHECK of 20261030130000 and drops the two office columns (the offices'
-- Location settings are lost; notes keep the location they have). Stops while office_note_location_changed events exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE event_type = 'office_note_location_changed') THEN
    RAISE EXCEPTION 'note location events exist; delete them first';
  END IF;
END $$;
DROP FUNCTION public.set_office_note_location(uuid, text, text);

CREATE OR REPLACE FUNCTION public.create_progress_note_for_shift(_shift_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- D3 follow-up: the shell for this note's service first (office, then agency-wide; Q15 order kept)
  v_ver := cp_resolve_note_template(s.agency_id, s.virtual_office_id, v_svc);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;

  INSERT INTO public.progress_notes (agency_id, virtual_office_id, client_id, caregiver_id, shift_id, care_plan_id,
    training_version, note_kind, service_type, service_date, scheduled_start, scheduled_end, units_scheduled,
    due_at, template_id, template_version, field_snapshot)
  VALUES (s.agency_id, s.virtual_office_id, s.client_id, s.caregiver_id, s.id, v_plan.id, v_plan.training_version,
    v_kind, v_svc, s.shift_date, v_start, v_end, cp_shift_units(s.shift_date, s.start_time, s.end_time, v_tz),
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
END $function$;

CREATE OR REPLACE FUNCTION public.get_progress_note_for_caregiver(_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

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
  'progress_note_voided', 'billing_batch_built', 'billing_batch_approved', 'billing_batch_billed',
  'group_session_created', 'shift_group_session_set',
  -- UI round 3: W1 measure library, W2 authorization corrections
  'measure_type_upserted', 'measure_type_activated', 'measure_type_deactivated', 'measure_type_deleted',
  'authorization_corrected', 'authorization_voided',
  -- UI S10: the audited compliance enforcement switch
  'compliance_enforcement_changed',
  -- demo UX Part 2: undo a note review
  'progress_note_review_undone',
  -- S4b: attachments
  'attachment_added', 'attachment_removed', 'attachment_viewed',
  -- S17: IPOS versions
  'care_plan_activated', 'care_plan_revised',
  -- auto-assign: one event per committed run; office match weights changed
  'auto_assign_run', 'office_match_weights_changed'
]::text[]));

ALTER TABLE public.virtual_office DROP COLUMN note_location_mode, DROP COLUMN note_location_default;

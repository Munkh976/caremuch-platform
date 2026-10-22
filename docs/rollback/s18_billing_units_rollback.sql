-- Rollback of 20261031140000_s18_billing_units.sql: restores cp_derive_progress_note_units, get_progress_note_for_staff
-- and list_notes_for_review byte-identical to DEV before the push, drops the four new functions, restores the events
-- CHECK of 20261031130000 and drops the new columns. Stops while S18 events exist or a note has an adjustment (its units
-- would otherwise silently stay adjusted without a trace).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE event_type IN ('office_units_rule_changed', 'progress_note_units_adjusted')) THEN
    RAISE EXCEPTION 'S18 events exist; delete them first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.progress_notes WHERE units_adjusted IS NOT NULL) THEN
    RAISE EXCEPTION 'adjusted notes exist; clear the adjustments first';
  END IF;
END $$;
DROP FUNCTION public.set_office_units_rule(uuid, text, int, int);
DROP FUNCTION public.get_billing_week_days(uuid, date);
DROP FUNCTION public.adjust_note_units(uuid, int, text);

CREATE OR REPLACE FUNCTION public.cp_derive_progress_note_units()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_from timestamptz; v_to timestamptz; v_blocks numeric;
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IN ('draft', 'returned') THEN
    -- the caregiver's note (incl. the submit transition): an end time is required to submit
    IF TG_OP = 'UPDATE' AND NEW.status = 'submitted' AND NEW.actual_end IS NULL THEN
      RAISE EXCEPTION 'Enter the client''s end time before submitting the note' USING ERRCODE = '22023';
    END IF;
    NEW.arrived_late := COALESCE(date_trunc('minute', NEW.client_arrived_at) > NEW.scheduled_start, false);
    -- S12 (Ripple, Oct 6): bill only the shift's scheduled 15-minute blocks (start, start+15, ...) that lie completely
    -- inside [arrival, end], minute precision; arrival at/before the start counts as the start, end at/after the
    -- scheduled end as the end; never more than units_scheduled. No grace period, no other rule.
    v_from := GREATEST(COALESCE(date_trunc('minute', NEW.client_arrived_at), NEW.scheduled_start), NEW.scheduled_start);
    v_to := LEAST(COALESCE(date_trunc('minute', NEW.actual_end), NEW.scheduled_end), NEW.scheduled_end);
    v_blocks := CASE WHEN NEW.scheduled_start IS NULL OR NEW.scheduled_end IS NULL
      THEN GREATEST(NEW.units_scheduled - CASE WHEN NEW.arrived_late THEN 1 ELSE 0 END, 0)   -- no scheduled times: the earlier rule
      ELSE GREATEST(floor(extract(epoch FROM (v_to - NEW.scheduled_start)) / 900)
                  - ceil(extract(epoch FROM (v_from - NEW.scheduled_start)) / 900), 0) END;
    NEW.units_used := CASE WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0 ELSE LEAST(v_blocks, NEW.units_scheduled) END;
  ELSE
    -- submitted / reviewed / billed: the units and the flag stay as submitted (no backfill)
    NEW.arrived_late := OLD.arrived_late;
    NEW.units_used := CASE
      WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0
      WHEN OLD.billable AND OLD.units_scheduled IS NOT NULL THEN OLD.units_used
      ELSE GREATEST(NEW.units_scheduled - CASE WHEN NEW.arrived_late THEN 1 ELSE 0 END, 0)
    END;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.get_progress_note_for_staff(_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n record; c record; g record; vo record; a record; s record; v_preview boolean := false; v_tpl text;
BEGIN
  SELECT NULL::uuid AS id, NULL::text AS auth_number INTO a;     -- no authorization yet (draft / returned): never unassigned
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided;
  PERFORM cp_require_scope(n.agency_id, n.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  SELECT first_name, left(last_name, 1) li, case_number INTO c FROM public.clients WHERE id = n.client_id;
  SELECT btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) nm INTO g FROM public.caregivers WHERE id = n.caregiver_id;
  SELECT id, name, COALESCE(timezone, 'America/New_York') tz, billing_week_start INTO vo FROM public.virtual_office WHERE id = n.virtual_office_id;
  SELECT gs.id, gs.staff_client_ratio INTO s FROM public.shifts sh JOIN public.group_sessions gs ON gs.id = sh.group_session_id WHERE sh.id = n.shift_id;
  SELECT name INTO v_tpl FROM public.form_templates WHERE id = n.template_id;
  IF n.authorization_id IS NOT NULL THEN
    SELECT id, auth_number INTO a FROM public.service_authorizations WHERE id = n.authorization_id;
  ELSIF n.status = 'submitted' THEN
    -- the authorization review_progress_note would choose (same filters and FIFO order); a preview only
    SELECT sa.id, sa.auth_number INTO a FROM public.service_authorizations sa
     WHERE sa.client_id = n.client_id AND sa.service_type = n.service_type AND sa.voided_at IS NULL
       AND sa.effective_date <= n.service_date AND sa.expiration_date >= n.service_date
       AND sa.units_available >= n.units_used
       AND COALESCE(cp_period_left(sa.id, sa.period_type, sa.units_per_period, vo.billing_week_start, n.service_date, '{}', '{}', '{}'), n.units_used) >= n.units_used
     ORDER BY sa.expiration_date, sa.created_at, sa.id LIMIT 1;
    v_preview := a.id IS NOT NULL;
  END IF;
  RETURN jsonb_build_object(
    'note', jsonb_build_object('id', n.id, 'shift_id', n.shift_id, 'client_id', n.client_id, 'status', n.status, 'note_kind', n.note_kind,
      'service_type', n.service_type, 'service_date', n.service_date, 'scheduled_start', n.scheduled_start, 'scheduled_end', n.scheduled_end,
      'client_arrived_at', n.client_arrived_at, 'actual_end', n.actual_end, 'location', n.location, 'staff_client_ratio', n.staff_client_ratio,
      'arrived_late', n.arrived_late, 'units_scheduled', n.units_scheduled, 'units_to_bill', CASE WHEN n.billable IS FALSE THEN 0 ELSE n.units_used END,
      'billable', n.billable, 'non_billable_reason', n.non_billable_reason, 'narrative_text', n.narrative_text,
      'staff_signature_name', n.staff_signature_name, 'staff_signed_at', n.staff_signed_at, 'late_submitted', n.late_submitted,
      'due_at', n.due_at, 'overdue', n.status IN ('draft', 'returned') AND n.due_at <= now(),
      'returned_reason', n.returned_reason, 'returned_at', n.returned_at, 'returned_count', n.returned_count,
      'reviewed_at', n.reviewed_at, 'reviewed_by_name', (SELECT full_name FROM public.profiles WHERE id = n.reviewed_by),
      'in_batch', n.billing_batch_id IS NOT NULL, 'biller_name', n.biller_name, 'billed_at', n.billed_at,
      'template_name', v_tpl, 'template_version', n.template_version),
    'client', jsonb_build_object('first_name', c.first_name, 'last_initial', c.li, 'case_number', c.case_number),
    'caregiver_name', g.nm,
    'office', jsonb_build_object('id', vo.id, 'name', vo.name, 'timezone', vo.tz),
    'group_session', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id', s.id, 'staff_client_ratio', s.staff_client_ratio) END,
    'authorization', CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', a.id, 'auth_number', a.auth_number, 'preview', v_preview) END,
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object('entry_id', e.id, 'goal_seq', gl.seq, 'goal_text', gl.goal_text,
        'objective_letter', ob.letter, 'objective_text', ob.objective_text, 'service_type', ob.service_type,
        'staff_instructions', ob.staff_instructions, 'notes_text', e.notes_text, 'answers', e.data,
        'questions_as_asked', e.measures_snapshot IS NOT NULL,
        'measures', COALESCE(e.measures_snapshot, cp_objective_measures(ob.id)))
        ORDER BY gl.seq, ob.seq)
      FROM public.progress_note_entries e
      JOIN public.care_plan_objectives ob ON ob.id = e.objective_id
      JOIN public.care_plan_goals gl ON gl.id = ob.goal_id
      WHERE e.progress_note_id = n.id), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('event', ev.event_type, 'at', ev.occurred_at,
        'by', pr.full_name,
        'resubmission', (ev.payload ->> 'resubmission')::boolean, 'billable', (ev.payload ->> 'billable')::boolean,
        'reason', CASE WHEN ev.event_type = 'progress_note_returned' AND (ev.payload ->> 'returned_count')::int = n.returned_count THEN n.returned_reason END)
        ORDER BY ev.occurred_at, ev.id)
      FROM public.events ev LEFT JOIN public.profiles pr ON pr.id = ev.actor_id
      WHERE ev.subject_type = 'progress_note' AND ev.subject_id = n.id
        AND ev.event_type IN ('progress_note_created', 'progress_note_submitted', 'progress_note_returned', 'progress_note_reviewed',
                              'progress_note_review_undone')), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.list_notes_for_review(_office_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o record;
BEGIN
  SELECT id, agency_id, COALESCE(timezone, 'America/New_York') tz, billing_week_start INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin}'::public.app_role[]);
  RETURN jsonb_build_object('as_of', now(), 'today', (now() AT TIME ZONE o.tz)::date, 'timezone', o.tz, 'billing_week_start', o.billing_week_start,
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'note_id', q.note_id, 'shift_id', q.shift_id, 'client_id', q.client_id, 'client_first_name', cl.first_name,
        'client_last_initial', left(cl.last_name, 1), 'caregiver_id', q.caregiver_id,
        'caregiver_name', btrim(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')),
        'service_type', q.service_type, 'service_date', q.service_date, 'scheduled_start', q.scheduled_start, 'scheduled_end', q.scheduled_end,
        'arrived_late', q.arrived_late, 'units_scheduled', q.units_scheduled, 'units_to_bill', q.units_used, 'status', q.status,
        'overdue', q.overdue, 'due_at', q.due_at, 'submitted_at', q.submitted_at, 'reviewed_at', q.reviewed_at,
        'returned_count', q.returned_count, 'in_batch', q.in_batch, 'group_session', q.group_session)
        ORDER BY q.scheduled_start, q.shift_id)
      FROM cp_office_note_queue(o.id) q
      LEFT JOIN public.clients cl ON cl.id = q.client_id
      LEFT JOIN public.caregivers g ON g.id = q.caregiver_id), '[]'::jsonb));
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
  'auto_assign_run', 'office_match_weights_changed',
  -- note Location office setting
  'office_note_location_changed'
]::text[]));

DROP FUNCTION public.cp_units_for(timestamptz, timestamptz, timestamptz, timestamptz, int, text, int);

ALTER TABLE public.progress_notes
  DROP COLUMN units_rule, DROP COLUMN units_minutes, DROP COLUMN units_grace_minutes, DROP COLUMN units_calculated,
  DROP COLUMN units_adjusted, DROP COLUMN units_adjust_reason, DROP COLUMN units_adjusted_by, DROP COLUMN units_adjusted_at;
ALTER TABLE public.virtual_office DROP COLUMN units_rule, DROP COLUMN units_minutes, DROP COLUMN units_grace_minutes;

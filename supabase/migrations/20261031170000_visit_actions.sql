-- Unassign / Cancel visit / Client no-show (owner, Oct 22, B; decisions 1-3) + the pickup gate for care-plan offices.
-- Additive: shift outcome columns; cp_visit_targets / cp_visit_action_blocker / cp_visit_outbox / cp_visit_action_prepare /
-- cp_pickup_gate (internal); preview_visit_action, unassign_visit, cancel_visit, record_client_no_show, list_client_no_shows
-- (manager / scheduler / agency admin in office scope; the no-show list: manager / agency admin). Each action writes its own
-- event (shift_unassigned, shift_cancelled, client_no_show; ids and codes only, no reason text) and, for unassign / cancel,
-- an Outbox row for the caregiver with the date and time only. The assignment functions, eligibility and
-- release_shift_assignments are unchanged (NB1).
-- Existing functions changed (approved, decision 3): caregiver_pick_up_shift and caregiver_pickup_trade_shift call
-- cp_pickup_gate after their hard-issue check; it returns NULL outside care-plan offices, so those behave as today.
-- events CHECK: the 63 values of 20261031160000 + shift_unassigned, client_no_show.

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
  'office_note_location_changed',
  -- S18: office units rule, reviewer adjustment
  'office_units_rule_changed', 'progress_note_units_adjusted',
  -- visit location office setting
  'office_visit_location_changed',
  -- visit actions: unassign, client no-show (cancel uses shift_cancelled)
  'shift_unassigned', 'client_no_show'
]::text[]));

-- 1. Visit outcome columns (additive; NULL on every existing visit)
ALTER TABLE public.shifts
  ADD COLUMN visit_outcome text CONSTRAINT shifts_visit_outcome_check CHECK (visit_outcome IN ('cancelled', 'client_no_show')),
  ADD COLUMN cancel_reason_code text CONSTRAINT shifts_cancel_reason_code_check
    CHECK (cancel_reason_code IN ('caregiver_unavailable', 'schedule_change', 'client_request', 'other')),
  ADD COLUMN cancel_reason_text text CONSTRAINT shifts_cancel_reason_text_len CHECK (length(cancel_reason_text) <= 500),
  ADD COLUMN cancel_requested_by text CONSTRAINT shifts_cancel_requested_by_check CHECK (cancel_requested_by IN ('client', 'agency')),
  ADD COLUMN cancelled_by uuid,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN late_cancel boolean;

-- 2. The visits one action applies to: this visit; with _following the rest of its series from this date (same order
--    line, else same client / service / weekday / times / office); with _whole_group every visit of its group session.
--    Not both. Cancelled and completed visits are never included.
CREATE FUNCTION public.cp_visit_targets(_shift_id uuid, _following boolean, _whole_group boolean)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; v uuid[];
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  IF s.id IS NULL THEN RETURN '{}'; END IF;
  IF COALESCE(_following, false) AND COALESCE(_whole_group, false) THEN
    RAISE EXCEPTION 'Choose either the following visits or the whole group, not both' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_whole_group, false) THEN
    IF s.group_session_id IS NULL THEN RAISE EXCEPTION 'This visit is not part of a group session' USING ERRCODE = '22023'; END IF;
    SELECT array_agg(x.id ORDER BY x.shift_date, x.start_time, x.id) INTO v FROM public.shifts x
     WHERE x.group_session_id = s.group_session_id AND x.status::text NOT IN ('cancelled', 'completed');
  ELSIF COALESCE(_following, false) THEN
    SELECT array_agg(x.id ORDER BY x.shift_date, x.start_time, x.id) INTO v FROM public.shifts x
     WHERE x.virtual_office_id IS NOT DISTINCT FROM s.virtual_office_id AND x.client_id = s.client_id
       AND x.shift_date >= s.shift_date AND x.status::text NOT IN ('cancelled', 'completed')
       AND (x.id = s.id OR CASE WHEN s.order_service_id IS NOT NULL THEN x.order_service_id = s.order_service_id
            ELSE x.order_service_id IS NULL AND x.care_type_code = s.care_type_code AND x.start_time = s.start_time AND x.end_time = s.end_time
                 AND extract(isodow FROM x.shift_date) = extract(isodow FROM s.shift_date) AND x.group_session_id IS NULL END);
  ELSE
    v := ARRAY[s.id];
  END IF;
  RETURN COALESCE(v, '{}');
END $$;
REVOKE ALL ON FUNCTION public.cp_visit_targets(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- Why one visit can't take an action now (NULL = it can). _action: unassign | cancel | no_show.
--   unassign / cancel: before the visit's start (office time); no_show: from the start until the end of the day after the
--   visit (the notes' due time). Any submitted / reviewed / billed note refuses; a draft (or returned) note refuses with a
--   message (the manager decides: void it in Notes to Review first).
CREATE FUNCTION public.cp_visit_action_blocker(_shift_id uuid, _action text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; v_tz text; v_start timestamptz; v_due timestamptz; v_note text;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  IF s.id IS NULL THEN RETURN 'Visit not found'; END IF;
  IF s.status::text IN ('cancelled', 'completed') THEN RETURN 'This visit is already ' || s.status::text; END IF;
  SELECT COALESCE(timezone, 'America/New_York') INTO v_tz FROM public.virtual_office WHERE id = s.virtual_office_id;
  v_start := (s.shift_date + s.start_time) AT TIME ZONE COALESCE(v_tz, 'America/New_York');
  v_due := ((s.shift_date + 2)::timestamp AT TIME ZONE COALESCE(v_tz, 'America/New_York'));
  IF _action IN ('unassign', 'cancel') AND now() >= v_start THEN
    RETURN to_char(s.shift_date, 'Dy Mon DD') || ': the visit has started';
  END IF;
  IF _action = 'no_show' AND now() < v_start THEN
    RETURN to_char(s.shift_date, 'Dy Mon DD') || ': a no-show can be recorded from the visit''s start time';
  END IF;
  IF _action = 'no_show' AND now() >= v_due THEN
    RETURN to_char(s.shift_date, 'Dy Mon DD') || ': too late to record a no-show (after the end of the next day)';
  END IF;
  IF _action = 'unassign' AND NOT EXISTS (SELECT 1 FROM public.shift_assignments a WHERE a.shift_id = s.id AND a.status NOT IN ('completed', 'cancelled')) THEN
    RETURN to_char(s.shift_date, 'Dy Mon DD') || ': no caregiver to unassign';
  END IF;
  SELECT status::text INTO v_note FROM public.progress_notes WHERE shift_id = s.id AND NOT voided LIMIT 1;
  IF v_note IN ('submitted', 'reviewed', 'billed') THEN
    RETURN to_char(s.shift_date, 'Dy Mon DD') || ': its progress note is already ' || v_note;
  END IF;
  IF v_note IN ('draft', 'returned') THEN
    RETURN to_char(s.shift_date, 'Dy Mon DD') || ': the caregiver has started its progress note (void the draft in Notes to Review first, or keep the visit)';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cp_visit_action_blocker(uuid, text) FROM PUBLIC, anon, authenticated;

-- An Outbox row for the caregiver (date and time only; full delivery later, S19).
CREATE FUNCTION public.cp_visit_outbox(_shift_id uuid, _caregiver_id uuid, _kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; g record; v_when text;
BEGIN
  SELECT shift_date, start_time, agency_id INTO s FROM public.shifts WHERE id = _shift_id;
  SELECT email, btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) nm INTO g FROM public.caregivers WHERE id = _caregiver_id;
  IF g.email IS NULL OR btrim(g.email) = '' THEN RETURN; END IF;
  v_when := to_char(s.shift_date, 'FMDay, FMMonth FMDD') || ' at ' || to_char(s.start_time, 'FMHH12:MI AM');
  INSERT INTO public.pending_notifications (agency_id, recipient_email, recipient_name, kind, subject, body, payload)
  VALUES (s.agency_id, g.email, g.nm, _kind,
    CASE _kind WHEN 'visit_unassigned' THEN 'You have been taken off a visit' ELSE 'A visit was cancelled' END,
    CASE _kind WHEN 'visit_unassigned' THEN 'The office took you off your visit on ' || v_when || '. It is no longer on your schedule.'
               ELSE 'Your visit on ' || v_when || ' was cancelled. It is no longer on your schedule.' END,
    jsonb_build_object('shift_id', _shift_id));
END $$;
REVOKE ALL ON FUNCTION public.cp_visit_outbox(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Shared front part: scope (manager / scheduler / agency admin of the visit's office), reason, targets, blockers.
CREATE FUNCTION public.cp_visit_action_prepare(_shift_id uuid, _action text, _reason_code text, _reason_text text,
  _following boolean, _whole_group boolean)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; v uuid[]; v_b text; v_x uuid; v_cg uuid;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO s FROM public.shifts WHERE id = _shift_id;
  PERFORM cp_require_scope(s.agency_id, s.virtual_office_id, '{manager,scheduler,agency_admin}'::public.app_role[]);
  IF _action <> 'no_show' AND (_reason_code IS NULL OR _reason_code NOT IN ('caregiver_unavailable', 'schedule_change', 'client_request', 'other')) THEN
    RAISE EXCEPTION 'Choose a reason' USING ERRCODE = '22023';
  END IF;
  IF (_reason_code = 'other' OR _action = 'no_show') AND length(btrim(COALESCE(_reason_text, ''))) < 3 THEN
    RAISE EXCEPTION 'Describe the reason' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(_reason_text, '')) > 500 THEN RAISE EXCEPTION 'The reason is at most 500 characters' USING ERRCODE = '22023'; END IF;
  IF _action = 'no_show' AND COALESCE(_following, false) THEN
    RAISE EXCEPTION 'A no-show is recorded for one visit (or its whole group)' USING ERRCODE = '22023';
  END IF;
  v := cp_visit_targets(_shift_id, _following, _whole_group);
  IF _action = 'unassign' AND COALESCE(_following, false) THEN   -- the same caregiver's visits of the series
    SELECT caregiver_id INTO v_cg FROM public.shift_assignments WHERE shift_id = _shift_id AND status NOT IN ('completed', 'cancelled') LIMIT 1;
    SELECT array_agg(t ORDER BY o) INTO v FROM unnest(v) WITH ORDINALITY u(t, o)
     WHERE t = _shift_id OR EXISTS (SELECT 1 FROM public.shift_assignments a WHERE a.shift_id = t AND a.caregiver_id = v_cg AND a.status NOT IN ('completed', 'cancelled'));
  END IF;
  FOREACH v_x IN ARRAY COALESCE(v, '{}') LOOP
    -- every visit must be in the caller's scope (a whole group can span offices)
    PERFORM cp_require_scope(x.agency_id, x.virtual_office_id, '{manager,scheduler,agency_admin}'::public.app_role[]) FROM public.shifts x WHERE x.id = v_x;
    v_b := cp_visit_action_blocker(v_x, _action);
    IF v_b IS NOT NULL THEN RAISE EXCEPTION 'Not possible: %', v_b USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF COALESCE(array_length(v, 1), 0) = 0 THEN RAISE EXCEPTION 'No visit to change' USING ERRCODE = '22023'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.cp_visit_action_prepare(uuid, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- 3. Preview for the dialog: which visits the action would change, and why it can't (no writes).
CREATE FUNCTION public.preview_visit_action(_shift_id uuid, _action text, _following boolean DEFAULT false, _whole_group boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; v uuid[];
BEGIN
  SELECT id, agency_id, virtual_office_id INTO s FROM public.shifts WHERE id = _shift_id;
  PERFORM cp_require_scope(s.agency_id, s.virtual_office_id, '{manager,scheduler,agency_admin}'::public.app_role[]);
  IF _action IS NULL OR _action NOT IN ('unassign', 'cancel', 'no_show') THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023'; END IF;
  v := cp_visit_targets(_shift_id, _following, _whole_group);
  RETURN jsonb_build_object('visits', COALESCE((SELECT jsonb_agg(jsonb_build_object('shift_id', x.id, 'shift_date', x.shift_date, 'start_time', x.start_time,
      'blocker', cp_visit_action_blocker(x.id, _action)) ORDER BY x.shift_date, x.start_time, x.id)
    FROM public.shifts x WHERE x.id = ANY(v)), '[]'::jsonb),
    'late_cancel', _action = 'cancel' AND EXISTS (SELECT 1 FROM public.shifts x JOIN public.virtual_office o ON o.id = x.virtual_office_id
      WHERE x.id = _shift_id AND (x.shift_date + x.start_time) AT TIME ZONE COALESCE(o.timezone, 'America/New_York') < now() + interval '24 hours'));
END $$;
REVOKE ALL ON FUNCTION public.preview_visit_action(uuid, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_visit_action(uuid, text, boolean, boolean) TO authenticated;

-- 4. Unassign: the caregiver is taken off; the visit goes back to Unassigned (open: pickup, manual or Auto-assign).
CREATE FUNCTION public.unassign_visit(_shift_id uuid, _reason_code text, _reason_text text DEFAULT NULL,
  _following boolean DEFAULT false, _whole_group boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid[]; v_x uuid; a record; s record; v_scope text;
BEGIN
  v := cp_visit_action_prepare(_shift_id, 'unassign', _reason_code, _reason_text, _following, _whole_group);
  v_scope := CASE WHEN _following THEN 'following' WHEN _whole_group THEN 'group' ELSE 'this' END;
  FOREACH v_x IN ARRAY v LOOP
    SELECT agency_id, virtual_office_id INTO s FROM public.shifts WHERE id = v_x FOR UPDATE;
    PERFORM set_config('caremuch.assignment_ctx', '1', true);
    FOR a IN SELECT id, caregiver_id FROM public.shift_assignments WHERE shift_id = v_x AND status NOT IN ('completed', 'cancelled') LOOP
      UPDATE public.shift_assignments SET status = 'cancelled', notes = COALESCE(NULLIF(btrim(COALESCE(_reason_text, '')), ''), notes) WHERE id = a.id;
      PERFORM cp_audit(s.agency_id, s.virtual_office_id, 'shift_unassigned', 'shift', v_x,
        jsonb_build_object('shift_id', v_x, 'caregiver_id', a.caregiver_id, 'reason_code', _reason_code, 'scope', v_scope, 'visits', array_length(v, 1)));
      PERFORM cp_visit_outbox(v_x, a.caregiver_id, 'visit_unassigned');
    END LOOP;
    -- back to Unassigned whatever its status was (as release_shift_assignments)
    UPDATE public.shifts SET status = 'open' WHERE id = v_x AND status::text NOT IN ('open', 'completed', 'cancelled')
       AND NOT EXISTS (SELECT 1 FROM public.shift_assignments x WHERE x.shift_id = v_x AND x.status <> 'cancelled');
    PERFORM set_config('caremuch.assignment_ctx', '', true);
  END LOOP;
  RETURN jsonb_build_object('visits', array_length(v, 1), 'shift_ids', to_jsonb(v));
END $$;
REVOKE ALL ON FUNCTION public.unassign_visit(uuid, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unassign_visit(uuid, text, text, boolean, boolean) TO authenticated;

-- 5. Cancel visit: status cancelled, never billable, not in Unassigned; the assignment is cancelled (units, caps and
--    hours released); who requested it, the reason and a late-cancel flag (< 24 h before the start) are kept.
CREATE FUNCTION public.cancel_visit(_shift_id uuid, _requested_by text, _reason_code text, _reason_text text DEFAULT NULL,
  _following boolean DEFAULT false, _whole_group boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid[]; v_x uuid; a record; s record; v_scope text; v_late boolean; v_tz text;
BEGIN
  IF _requested_by IS NULL OR _requested_by NOT IN ('client', 'agency') THEN
    RAISE EXCEPTION 'Say who asked for the cancellation (client or agency)' USING ERRCODE = '22023';
  END IF;
  v := cp_visit_action_prepare(_shift_id, 'cancel', _reason_code, _reason_text, _following, _whole_group);
  v_scope := CASE WHEN _following THEN 'following' WHEN _whole_group THEN 'group' ELSE 'this' END;
  FOREACH v_x IN ARRAY v LOOP
    SELECT x.agency_id, x.virtual_office_id, x.shift_date, x.start_time INTO s FROM public.shifts x WHERE x.id = v_x FOR UPDATE;
    SELECT COALESCE(timezone, 'America/New_York') INTO v_tz FROM public.virtual_office WHERE id = s.virtual_office_id;
    v_late := (s.shift_date + s.start_time) AT TIME ZONE COALESCE(v_tz, 'America/New_York') < now() + interval '24 hours';
    PERFORM set_config('caremuch.assignment_ctx', '1', true);   -- this function writes its own event (not the trigger's)
    UPDATE public.shifts SET status = 'cancelled', visit_outcome = 'cancelled', cancel_reason_code = _reason_code,
           cancel_reason_text = NULLIF(btrim(COALESCE(_reason_text, '')), ''), cancel_requested_by = _requested_by,
           cancelled_by = auth.uid(), cancelled_at = now(), late_cancel = v_late
     WHERE id = v_x;
    FOR a IN SELECT id, caregiver_id FROM public.shift_assignments WHERE shift_id = v_x AND status NOT IN ('completed', 'cancelled') LOOP
      UPDATE public.shift_assignments SET status = 'cancelled' WHERE id = a.id;
      PERFORM cp_visit_outbox(v_x, a.caregiver_id, 'visit_cancelled');
    END LOOP;
    PERFORM set_config('caremuch.assignment_ctx', '', true);
    PERFORM cp_audit(s.agency_id, s.virtual_office_id, 'shift_cancelled', 'shift', v_x,
      jsonb_build_object('shift_id', v_x, 'reason_code', _reason_code, 'requested_by', _requested_by, 'late_cancel', v_late,
        'scope', v_scope, 'visits', array_length(v, 1)));
  END LOOP;
  RETURN jsonb_build_object('visits', array_length(v, 1), 'shift_ids', to_jsonb(v));
END $$;
REVOKE ALL ON FUNCTION public.cancel_visit(uuid, text, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_visit(uuid, text, text, text, boolean, boolean) TO authenticated;

-- 6. Client no-show: status cancelled with outcome client_no_show (not the assignment's no_show, so it doesn't count
--    against the caregiver); never billable; listed separately on Weekly Billing. From the start until the end of the
--    next day; this visit or its whole group.
CREATE FUNCTION public.record_client_no_show(_shift_id uuid, _reason_text text, _whole_group boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid[]; v_x uuid; s record; v_cg uuid;
BEGIN
  v := cp_visit_action_prepare(_shift_id, 'no_show', NULL, _reason_text, false, _whole_group);
  FOREACH v_x IN ARRAY v LOOP
    SELECT agency_id, virtual_office_id INTO s FROM public.shifts WHERE id = v_x FOR UPDATE;
    SELECT caregiver_id INTO v_cg FROM public.shift_assignments WHERE shift_id = v_x AND status NOT IN ('completed', 'cancelled') LIMIT 1;
    PERFORM set_config('caremuch.assignment_ctx', '1', true);
    UPDATE public.shifts SET status = 'cancelled', visit_outcome = 'client_no_show', cancel_reason_code = NULL,
           cancel_reason_text = btrim(_reason_text), cancel_requested_by = NULL, cancelled_by = auth.uid(), cancelled_at = now(), late_cancel = NULL
     WHERE id = v_x;
    UPDATE public.shift_assignments SET status = 'cancelled' WHERE shift_id = v_x AND status NOT IN ('completed', 'cancelled');
    PERFORM set_config('caremuch.assignment_ctx', '', true);
    PERFORM cp_audit(s.agency_id, s.virtual_office_id, 'client_no_show', 'shift', v_x,
      jsonb_build_object('shift_id', v_x, 'caregiver_id', v_cg, 'scope', CASE WHEN _whole_group THEN 'group' ELSE 'this' END, 'visits', array_length(v, 1)));
  END LOOP;
  RETURN jsonb_build_object('visits', array_length(v, 1), 'shift_ids', to_jsonb(v));
END $$;
REVOKE ALL ON FUNCTION public.record_client_no_show(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_client_no_show(uuid, text, boolean) TO authenticated;

-- 7. Weekly Billing's own no-show list (manager / agency admin, as the billing week).
CREATE FUNCTION public.list_client_no_shows(_office_id uuid, _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  SELECT id, agency_id INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin}'::public.app_role[]);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('shift_id', s.id, 'shift_date', s.shift_date, 'start_time', s.start_time, 'end_time', s.end_time,
      'client_first_name', cl.first_name, 'client_last_initial', left(cl.last_name, 1), 'care_type_code', s.care_type_code,
      'caregiver_name', (SELECT btrim(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')) FROM public.shift_assignments a
                          JOIN public.caregivers g ON g.id = a.caregiver_id WHERE a.shift_id = s.id ORDER BY a.assigned_at DESC NULLS LAST LIMIT 1),
      'recorded_at', s.cancelled_at, 'recorded_by_name', (SELECT full_name FROM public.profiles WHERE id = s.cancelled_by))
      ORDER BY s.shift_date, s.start_time, s.id)
    FROM public.shifts s JOIN public.clients cl ON cl.id = s.client_id
   WHERE s.virtual_office_id = o.id AND s.visit_outcome = 'client_no_show' AND s.shift_date BETWEEN _from AND _to), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_client_no_shows(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_client_no_shows(uuid, date, date) TO authenticated;

-- 8. Pickup gate for care-plan offices (owner decision 3): a caregiver who fails the Auto-assign gate (4a: hard, soft,
--    care-plan checks, client onboarded) can't pick up there. Other offices: NULL (today's rule).
CREATE FUNCTION public.cp_pickup_gate(_shift_id uuid, _result jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  SELECT x.client_id, x.virtual_office_id, COALESCE(o.care_plan_module_enabled, false) m INTO s
    FROM public.shifts x LEFT JOIN public.virtual_office o ON o.id = x.virtual_office_id WHERE x.id = _shift_id;
  IF NOT COALESCE(s.m, false) THEN RETURN NULL; END IF;
  IF jsonb_array_length(cp_gate_issues(_result)) > 0 OR cp_client_gate(s.client_id, s.virtual_office_id) IS NOT NULL THEN
    RETURN 'Pick-up refused: this office lets caregivers pick up only visits they meet every requirement for (training, credentials, authorization, availability). Ask the office to assign it.';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cp_pickup_gate(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 9. (existing; same signature, grants kept) self pickup: + the care-plan office gate
CREATE OR REPLACE FUNCTION public.caregiver_pick_up_shift(_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE v_cg uuid; elig jsonb; s record; v_id uuid; v_raw jsonb; v_gate text;
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

  -- Phase C: serialize assignments drawing on this client's authorizations (id order, as review)
  PERFORM public.cp_lock_client_authorizations(s.client_id);
  -- Phase C (R6): the caregiver only ever sees caregiver-safe text (error message and response)
  v_raw := public.check_assignment_eligibility(_shift_id, v_cg);
  elig := public.cp_caregiver_safe_eligibility(v_raw);
  -- CHANGED: was `jsonb_array_length(elig->'hard') > 0 OR jsonb_array_length(elig->'soft') > 0`.
  -- Self-pickup now blocks on hard issues only -- soft issues (availability, service-area
  -- over the zip list) are self-consented by the caregiver's own act of picking it up.
  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Pick-up refused: %', (
      SELECT string_agg(x->>'detail',' ') FROM jsonb_array_elements(elig->'hard') x
    ) USING ERRCODE='23514';
  END IF;
  -- owner, Oct 22 (decision 3): care-plan offices only let caregivers who pass the Auto-assign gate pick up
  v_gate := public.cp_pickup_gate(_shift_id, v_raw);
  IF v_gate IS NOT NULL THEN RAISE EXCEPTION '%', v_gate USING ERRCODE='23514'; END IF;

  PERFORM set_config('caremuch.assignment_ctx','1',true);
  INSERT INTO public.shift_assignments(shift_id, caregiver_id, status, assignment_method)
  VALUES (_shift_id, v_cg, 'scheduled', 'picked_up') RETURNING id INTO v_id;
  PERFORM set_config('caremuch.assignment_ctx','',true);

  RETURN jsonb_build_object('assignment_id', v_id, 'eligibility', elig);
END;
$fn$;

-- 10. (existing; same signature, grants kept) trade pickup: + the care-plan office gate
CREATE OR REPLACE FUNCTION public.caregiver_pickup_trade_shift(_trade_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_cg record;
  t record;
  s record;
  elig jsonb;
  existing record;
  v_id uuid;
  v_claimed uuid;
  v_safe jsonb;   -- Phase C (R6)
  v_gate text;
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

  -- Phase C: serialize assignments drawing on this client's authorizations (id order, as review)
  PERFORM public.cp_lock_client_authorizations(s.client_id);
  elig := public.check_assignment_eligibility(t.shift_id, v_cg.id);
  -- Phase C (R6): the full result is kept for the manager (eligibility_snapshot, approval_reasons);
  -- the caregiver only sees the caregiver-safe copy.
  v_safe := public.cp_caregiver_safe_eligibility(elig);

  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Pick-up refused: %', (
      SELECT string_agg(x->>'detail',' ') FROM jsonb_array_elements(v_safe->'hard') x
    ) USING ERRCODE='23514';
  END IF;

  -- owner, Oct 22 (decision 3): care-plan offices only let caregivers who pass the Auto-assign gate pick up a trade
  v_gate := public.cp_pickup_gate(t.shift_id, elig);
  IF v_gate IS NOT NULL THEN RAISE EXCEPTION '%', v_gate USING ERRCODE='23514'; END IF;

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
    RETURN jsonb_build_object('status', 'sent_for_approval', 'eligibility', v_safe);
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

  RETURN jsonb_build_object('status', 'picked_up', 'assignment_id', v_id, 'eligibility', v_safe);
END;
$fn$;

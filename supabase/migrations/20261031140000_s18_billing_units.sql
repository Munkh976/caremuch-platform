-- S18 billing flexibility (owner, Oct 22: "S18 as approved (smallint units_adjusted, store the rule used per note; units
-- card on the Compliance tab)"; design docs/design/s18-billing-flexibility.md).
-- 1. Office units rule: virtual_office.units_rule (full_blocks | nearest | grace), units_minutes, units_grace_minutes.
--    Defaults = the S12 rule exactly (full 15-minute blocks, no grace), so every office bills as today. The setter accepts
--    15-minute units only for now: units_scheduled, authorizations and the eligibility projection count 15-minute units
--    (cp_shift_units, unchanged), so another unit length waits for an owner decision.
-- 2. cp_units_for: the rules as one pure function; the units trigger calls it with the office settings and stores the
--    rule used on the note (units_rule / units_minutes / units_grace_minutes) and the calculated units (units_calculated).
--    No backfill: existing notes keep their units; their rule columns stay NULL (= the rule of their time).
-- 3. Reviewer adjustment: progress_notes.units_adjusted smallint (+ reason, by, at); adjust_note_units (manager /
--    agency admin in scope, submitted notes only, 0..units_scheduled, reason >= 10 characters, NULL clears; audited
--    progress_note_units_adjusted with before / after / calculated, no reason text). units_used = the adjustment, so
--    review (FIFO, caps), units_available, batches and undo work unchanged.
-- 4. get_billing_week_days: the week's bill by client x authorization x day of service (new; get_billing_week unchanged).
-- 5. set_office_units_rule: agency admin of the office, audited office_units_rule_changed.
-- Existing functions changed (approved): cp_derive_progress_note_units, get_progress_note_for_staff, list_notes_for_review.
-- events CHECK: the 60 values of 20261031130000 + office_units_rule_changed, progress_note_units_adjusted.

ALTER TABLE public.virtual_office
  ADD COLUMN units_rule text NOT NULL DEFAULT 'full_blocks'
    CONSTRAINT virtual_office_units_rule_check CHECK (units_rule IN ('full_blocks', 'nearest', 'grace')),
  ADD COLUMN units_minutes smallint NOT NULL DEFAULT 15
    CONSTRAINT virtual_office_units_minutes_check CHECK (units_minutes BETWEEN 1 AND 60),
  ADD COLUMN units_grace_minutes smallint NOT NULL DEFAULT 0
    CONSTRAINT virtual_office_units_grace_check CHECK (units_grace_minutes BETWEEN 0 AND 14);

ALTER TABLE public.progress_notes
  ADD COLUMN units_rule text CONSTRAINT progress_notes_units_rule_check CHECK (units_rule IN ('full_blocks', 'nearest', 'grace')),
  ADD COLUMN units_minutes smallint,
  ADD COLUMN units_grace_minutes smallint,
  ADD COLUMN units_calculated numeric,
  ADD COLUMN units_adjusted smallint CONSTRAINT progress_notes_units_adjusted_check CHECK (units_adjusted >= 0),
  ADD COLUMN units_adjust_reason text,
  ADD COLUMN units_adjusted_by uuid,
  ADD COLUMN units_adjusted_at timestamptz;

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
  'office_units_rule_changed', 'progress_note_units_adjusted'
]::text[]));

-- 2. The units of one visit under a rule (pure). Scheduled blocks of _minutes from the scheduled start; minute precision.
--    full_blocks: the blocks completely inside [arrival, end] (arrival before the start = the start, end after the end =
--      the end): the S12 rule exactly when _minutes = 15.
--    grace: an arrival up to _grace minutes late counts as the start, an end up to _grace minutes early as the end; then
--      full blocks.
--    nearest: the minutes served inside the scheduled window / _minutes, rounded half up.
--    The caller caps at units_scheduled.
CREATE FUNCTION public.cp_units_for(_sched_start timestamptz, _sched_end timestamptz, _arrived timestamptz, _ended timestamptz,
  _minutes int, _rule text, _grace int)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v_a timestamptz; v_e timestamptz; v_blk numeric := _minutes * 60;
BEGIN
  v_a := GREATEST(COALESCE(date_trunc('minute', _arrived), _sched_start), _sched_start);
  v_e := LEAST(COALESCE(date_trunc('minute', _ended), _sched_end), _sched_end);
  IF _rule = 'grace' THEN
    IF v_a - _sched_start <= make_interval(mins => _grace) THEN v_a := _sched_start; END IF;
    IF _sched_end - v_e <= make_interval(mins => _grace) THEN v_e := _sched_end; END IF;
  END IF;
  IF _rule = 'nearest' THEN
    RETURN GREATEST(floor(extract(epoch FROM (v_e - v_a)) / v_blk + 0.5), 0);
  END IF;
  RETURN GREATEST(floor(extract(epoch FROM (v_e - _sched_start)) / v_blk) - ceil(extract(epoch FROM (v_a - _sched_start)) / v_blk), 0);
END $$;
REVOKE ALL ON FUNCTION public.cp_units_for(timestamptz, timestamptz, timestamptz, timestamptz, int, text, int) FROM PUBLIC, anon, authenticated;

-- 3. A reviewer adjusts the units to bill of a submitted note (NULL clears the adjustment).
CREATE FUNCTION public.adjust_note_units(_note_id uuid, _units int, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agency uuid; v_office uuid; v_status text; v_billable boolean; v_sched numeric; v_before numeric; v_adj smallint; v_new numeric; v_calc numeric;
BEGIN
  SELECT agency_id, virtual_office_id, status::text, billable, units_scheduled, units_used, units_adjusted
    INTO v_agency, v_office, v_status, v_billable, v_sched, v_before, v_adj
    FROM public.progress_notes WHERE id = _note_id AND NOT voided FOR UPDATE;
  PERFORM cp_require_scope(v_agency, v_office, '{manager,agency_admin}'::public.app_role[]);
  IF v_status <> 'submitted' THEN RAISE EXCEPTION 'Units can be adjusted only on a submitted note (before review)' USING ERRCODE = '22023'; END IF;
  IF v_billable IS FALSE OR v_sched IS NULL THEN RAISE EXCEPTION 'This note bills no units' USING ERRCODE = '22023'; END IF;
  IF _units IS NOT NULL THEN
    IF _units < 0 OR _units > v_sched THEN
      RAISE EXCEPTION 'Units to bill must be between 0 and % (the units scheduled)', v_sched USING ERRCODE = '22023';
    END IF;
    IF length(btrim(COALESCE(_reason, ''))) < 10 THEN RAISE EXCEPTION 'Give a reason (at least 10 characters)' USING ERRCODE = '22023'; END IF;
  ELSIF v_adj IS NULL THEN
    RAISE EXCEPTION 'This note has no adjustment to clear' USING ERRCODE = '22023';
  END IF;
  UPDATE public.progress_notes
     SET units_adjusted = _units,
         units_adjust_reason = CASE WHEN _units IS NULL THEN NULL ELSE btrim(_reason) END,
         units_adjusted_by = CASE WHEN _units IS NULL THEN NULL ELSE auth.uid() END,
         units_adjusted_at = CASE WHEN _units IS NULL THEN NULL ELSE now() END
   WHERE id = _note_id
  RETURNING units_used, units_calculated INTO v_new, v_calc;
  PERFORM cp_audit(v_agency, v_office, 'progress_note_units_adjusted', 'progress_note', _note_id,
    jsonb_build_object('note_id', _note_id, 'before', v_before, 'after', v_new, 'calculated', v_calc, 'cleared', _units IS NULL));
  RETURN jsonb_build_object('units_to_bill', v_new, 'units_calculated', v_calc, 'units_adjusted', _units);
END $$;
REVOKE ALL ON FUNCTION public.adjust_note_units(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_note_units(uuid, int, text) TO authenticated;

-- 4. The week's bill by day of service: one line per client x authorization x service date, per batch (as get_billing_week).
CREATE FUNCTION public.get_billing_week_days(_office_id uuid, _week_start date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; v_today date; v_cur date; v_ws date; v_we date;
BEGIN
  SELECT id, agency_id, name, COALESCE(timezone, 'America/New_York') tz, billing_week_start wks
    INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin}'::public.app_role[]);
  v_today := (now() AT TIME ZONE o.tz)::date;
  v_cur := v_today - ((extract(isodow FROM v_today)::int - o.wks + 7) % 7);
  v_ws := COALESCE(_week_start, v_cur - 7);
  IF extract(isodow FROM v_ws)::int <> o.wks THEN
    RAISE EXCEPTION 'The billing week for this office starts on ISO day %', o.wks USING ERRCODE = '22023';
  END IF;
  v_we := v_ws + 6;
  RETURN jsonb_build_object('office_id', o.id, 'week_start', v_ws, 'week_end', v_we,
    'batches', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', bb.id, 'supplement', bb.supplement,
        'status', CASE bb.status WHEN 'reviewed' THEN 'approved' ELSE bb.status::text END,
        'lines', COALESCE((SELECT jsonb_agg(l.j ORDER BY l.csort, l.d, l.asort) FROM (
            SELECT lower(COALESCE(cl.first_name, '') || ' ' || COALESCE(cl.last_name, '')) csort, n.service_date d,
              COALESCE(sa.expiration_date::text, '') || sa.id::text asort,
              jsonb_build_object('client_id', cl.id, 'client_first_name', cl.first_name, 'client_last_initial', left(cl.last_name, 1),
                'case_number', cl.case_number, 'service_date', n.service_date,
                'authorization', jsonb_build_object('id', sa.id, 'auth_number', sa.auth_number, 'service_type', sa.service_type, 'service_code', sa.service_code),
                'units_scheduled', COALESCE(sum(n.units_scheduled), 0), 'units_billed', COALESCE(sum(n.units_used), 0),
                'late', bool_or(n.arrived_late), 'left_early', bool_or(COALESCE(date_trunc('minute', n.actual_end) < n.scheduled_end, false)),
                'adjusted', bool_or(n.units_adjusted IS NOT NULL),
                'notes', jsonb_agg(jsonb_build_object('note_id', n.id, 'scheduled_start', n.scheduled_start,
                  'caregiver_name', btrim(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')),
                  'units_scheduled', n.units_scheduled, 'units_billed', n.units_used, 'adjusted', n.units_adjusted IS NOT NULL)
                  ORDER BY n.scheduled_start, n.id)) j
              FROM public.progress_notes n
              JOIN public.clients cl ON cl.id = n.client_id
              JOIN public.service_authorizations sa ON sa.id = n.authorization_id
              LEFT JOIN public.caregivers g ON g.id = n.caregiver_id
             WHERE n.billing_batch_id = bb.id
             GROUP BY cl.id, sa.id, n.service_date) l), '[]'::jsonb),
        'totals', (SELECT jsonb_build_object('notes', count(*), 'units_scheduled', COALESCE(sum(n.units_scheduled), 0),
            'units_billed', COALESCE(sum(n.units_used), 0)) FROM public.progress_notes n WHERE n.billing_batch_id = bb.id))
        ORDER BY bb.supplement)
      FROM public.billing_batches bb
     WHERE bb.virtual_office_id = o.id AND bb.week_start = v_ws), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_billing_week_days(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_billing_week_days(uuid, date) TO authenticated;

-- 5. The office units rule (agency admin, audited). 15-minute units only for now (see the header).
CREATE FUNCTION public.set_office_units_rule(_office_id uuid, _rule text, _grace_minutes int DEFAULT 0, _minutes int DEFAULT 15)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agency uuid; v_rule text; v_min smallint; v_grace smallint;
BEGIN
  SELECT agency_id, units_rule, units_minutes, units_grace_minutes INTO v_agency, v_rule, v_min, v_grace
    FROM public.virtual_office WHERE id = _office_id FOR UPDATE;
  PERFORM cp_require_scope(v_agency, _office_id, '{agency_admin}'::public.app_role[]);
  IF _rule IS NULL OR _rule NOT IN ('full_blocks', 'nearest', 'grace') THEN
    RAISE EXCEPTION 'The units rule is full_blocks, nearest or grace' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_minutes, 0) <> 15 THEN
    RAISE EXCEPTION 'Units are 15 minutes (scheduled units and authorizations count 15-minute units)' USING ERRCODE = '22023';
  END IF;
  IF _rule = 'grace' AND (_grace_minutes IS NULL OR _grace_minutes NOT BETWEEN 1 AND 14) THEN
    RAISE EXCEPTION 'The grace period is 1 to 14 minutes' USING ERRCODE = '22023';
  END IF;
  UPDATE public.virtual_office SET units_rule = _rule, units_minutes = _minutes,
         units_grace_minutes = CASE WHEN _rule = 'grace' THEN _grace_minutes ELSE 0 END
   WHERE id = _office_id;
  PERFORM cp_audit(v_agency, _office_id, 'office_units_rule_changed', 'virtual_office', _office_id,
    jsonb_build_object('office_id', _office_id,
      'before', jsonb_build_object('rule', v_rule, 'minutes', v_min, 'grace_minutes', v_grace),
      'after', jsonb_build_object('rule', _rule, 'minutes', _minutes, 'grace_minutes', CASE WHEN _rule = 'grace' THEN _grace_minutes ELSE 0 END)));
  RETURN jsonb_build_object('rule', _rule, 'minutes', _minutes, 'grace_minutes', CASE WHEN _rule = 'grace' THEN _grace_minutes ELSE 0 END);
END $$;
REVOKE ALL ON FUNCTION public.set_office_units_rule(uuid, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_office_units_rule(uuid, text, int, int) TO authenticated;

-- 6. (existing; same signature, grants kept) the units trigger: the office rule, stored on the note; the adjustment
CREATE OR REPLACE FUNCTION public.cp_derive_progress_note_units()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
DECLARE v_blocks numeric; v_rule text; v_min smallint; v_grace smallint;
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IN ('draft', 'returned') THEN
    -- the caregiver's note (incl. the submit transition): an end time is required to submit
    IF TG_OP = 'UPDATE' AND NEW.status = 'submitted' AND NEW.actual_end IS NULL THEN
      RAISE EXCEPTION 'Enter the client''s end time before submitting the note' USING ERRCODE = '22023';
    END IF;
    NEW.arrived_late := COALESCE(date_trunc('minute', NEW.client_arrived_at) > NEW.scheduled_start, false);
    -- S18: the office's units rule (defaults = the S12 rule exactly: full 15-minute blocks, no grace), stored on the note
    SELECT units_rule, units_minutes, units_grace_minutes INTO v_rule, v_min, v_grace FROM public.virtual_office WHERE id = NEW.virtual_office_id;
    NEW.units_rule := COALESCE(v_rule, 'full_blocks'); NEW.units_minutes := COALESCE(v_min, 15); NEW.units_grace_minutes := COALESCE(v_grace, 0);
    v_blocks := CASE WHEN NEW.scheduled_start IS NULL OR NEW.scheduled_end IS NULL
      THEN GREATEST(NEW.units_scheduled - CASE WHEN NEW.arrived_late THEN 1 ELSE 0 END, 0)   -- no scheduled times: the earlier rule
      ELSE cp_units_for(NEW.scheduled_start, NEW.scheduled_end, NEW.client_arrived_at, NEW.actual_end,
                        NEW.units_minutes, NEW.units_rule, NEW.units_grace_minutes) END;
    NEW.units_calculated := CASE WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0 ELSE LEAST(v_blocks, NEW.units_scheduled) END;
    -- a reviewer's adjustment (adjust_note_units) wins over the calculation
    NEW.units_used := CASE WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0
                           ELSE LEAST(COALESCE(NEW.units_adjusted, NEW.units_calculated), NEW.units_scheduled) END;
  ELSE
    -- submitted / reviewed / billed: the units and the flag stay as submitted (no backfill), and so does the rule used
    NEW.arrived_late := OLD.arrived_late;
    NEW.units_rule := OLD.units_rule; NEW.units_minutes := OLD.units_minutes; NEW.units_grace_minutes := OLD.units_grace_minutes;
    NEW.units_calculated := COALESCE(OLD.units_calculated,
      CASE WHEN NEW.units_adjusted IS DISTINCT FROM OLD.units_adjusted THEN OLD.units_used END);   -- a note from before S18: its units at the first adjustment
    IF NEW.units_adjusted IS DISTINCT FROM OLD.units_adjusted THEN
      -- S18: a reviewer adjusts (or clears) the units of a submitted note (adjust_note_units)
      NEW.units_used := CASE WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0
                             ELSE LEAST(COALESCE(NEW.units_adjusted, NEW.units_calculated), NEW.units_scheduled) END;
    ELSE
    NEW.units_used := CASE
      WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0
      WHEN OLD.billable AND OLD.units_scheduled IS NOT NULL THEN OLD.units_used
      ELSE GREATEST(NEW.units_scheduled - CASE WHEN NEW.arrived_late THEN 1 ELSE 0 END, 0)
    END;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

-- 7. (existing reader; grants kept) calculated / adjusted units, the rule used, the adjustment in the history
CREATE OR REPLACE FUNCTION public.get_progress_note_for_staff(_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
      'units_calculated', n.units_calculated, 'units_adjusted', n.units_adjusted, 'units_adjust_reason', n.units_adjust_reason,
      'units_adjusted_at', n.units_adjusted_at, 'units_adjusted_by_name', (SELECT full_name FROM public.profiles WHERE id = n.units_adjusted_by),
      'units_rule', n.units_rule, 'units_minutes', n.units_minutes, 'units_grace_minutes', n.units_grace_minutes,
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
        'reason', CASE WHEN ev.event_type = 'progress_note_returned' AND (ev.payload ->> 'returned_count')::int = n.returned_count THEN n.returned_reason END,
        'units_before', ev.payload -> 'before', 'units_after', ev.payload -> 'after')
        ORDER BY ev.occurred_at, ev.id)
      FROM public.events ev LEFT JOIN public.profiles pr ON pr.id = ev.actor_id
      WHERE ev.subject_type = 'progress_note' AND ev.subject_id = n.id
        AND ev.event_type IN ('progress_note_created', 'progress_note_submitted', 'progress_note_returned', 'progress_note_reviewed',
                              'progress_note_review_undone', 'progress_note_units_adjusted')), '[]'::jsonb));
END $fn$;

-- 8. (existing reader; grants kept) the queue marks adjusted notes
CREATE OR REPLACE FUNCTION public.list_notes_for_review(_office_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
        'units_adjusted', (SELECT pn.units_adjusted IS NOT NULL FROM public.progress_notes pn WHERE pn.id = q.note_id),
        'overdue', q.overdue, 'due_at', q.due_at, 'submitted_at', q.submitted_at, 'reviewed_at', q.reviewed_at,
        'returned_count', q.returned_count, 'in_batch', q.in_batch, 'group_session', q.group_session)
        ORDER BY q.scheduled_start, q.shift_id)
      FROM cp_office_note_queue(o.id) q
      LEFT JOIN public.clients cl ON cl.id = q.client_id
      LEFT JOIN public.caregivers g ON g.id = q.caregiver_id), '[]'::jsonb));
END $fn$;

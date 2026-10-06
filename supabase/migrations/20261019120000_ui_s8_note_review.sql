-- Ripple UI S8 — staff note review + print: three staff reads and a menu entry. ADDITIVE ONLY.
-- Unchanged: review_progress_note, return_progress_note (Submitted only; owner decision Oct 5: a Reviewed
-- note is never returned), void_progress_note, every scheduling function, every policy and CHECK.
-- Review is per note only (owner, Q12 decided Oct 5): approve_clean_rows is not used by any screen.
--
--   list_notes_for_review(_office_id)  clinical tier (manager, agency_admin) in the office's scope.
--       { as_of, today, timezone, billing_week_start, rows[] } for an office with the module on:
--       submitted, returned, reviewed and billed notes (reviewed / billed for 90 days), draft notes past
--       their deadline, and started visits with NO note yet past the deadline (overdue, not started:
--       assigned, not cancelled, CLS / respite, on or after go-live). Overdue = not submitted by the end
--       of the day after the visit (due_at, office time zone) on the DB clock. Rows carry ids, the
--       client's first name + last initial, the caregiver's name, service, times, late flag, units
--       scheduled / to bill, status, flags. Nothing clinical.
--   get_progress_note_for_staff(_note_id)  clinical tier, note's office scope; voided notes are not
--       found. The full note for review and print: header, group session (ratio), units, the
--       authorization it draws from (the reviewed one, or for a submitted note the one review would
--       pick: FIFO preview, same rule as review_progress_note), CLS entries in IPOS order with the
--       questions as asked (measures_snapshot; live measures only for a note never submitted),
--       respite narrative, signature, history from the audit events (who / when; the latest return
--       reason, which is the only one the note keeps), the shell it was built from, the case number.
--   get_notes_review_counts()  per module office in the caller's clinical scope: to_review (submitted)
--       and overdue. Empty for anyone else (it feeds the menu badge and the dashboard panel).
-- All: SECURITY DEFINER, search_path fixed, generic 'Not found or not allowed', REVOKE ALL FROM
-- PUBLIC, anon; GRANT EXECUTE TO authenticated (rule 14). The menu entry is data in
-- 20261019120100_ripple_ui_menu_seeds_s8.sql.

-- Shared row source for the queue and the counts (internal; no API role).
CREATE FUNCTION public.cp_office_note_queue(_office_id uuid)
RETURNS TABLE (note_id uuid, shift_id uuid, client_id uuid, caregiver_id uuid, service_type text, service_date date,
               scheduled_start timestamptz, scheduled_end timestamptz, arrived_late boolean, units_scheduled numeric,
               units_used numeric, status text, overdue boolean, due_at timestamptz, submitted_at timestamptz,
               reviewed_at timestamptz, returned_count int, in_batch boolean, group_session boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH o AS (SELECT id, agency_id, timezone, care_plan_module_enabled_at golive FROM public.virtual_office
             WHERE id = _office_id AND care_plan_module_enabled)
  SELECT n.id, n.shift_id, n.client_id, n.caregiver_id, n.service_type, n.service_date, n.scheduled_start, n.scheduled_end,
         n.arrived_late, n.units_scheduled, CASE WHEN n.billable IS FALSE THEN 0 ELSE n.units_used END,
         n.status::text, n.status IN ('draft', 'returned') AND n.due_at <= now(), n.due_at, n.staff_signed_at,
         n.reviewed_at, n.returned_count, n.billing_batch_id IS NOT NULL, s.group_session_id IS NOT NULL
    FROM public.progress_notes n JOIN o ON o.id = n.virtual_office_id
    LEFT JOIN public.shifts s ON s.id = n.shift_id
   WHERE NOT n.voided
     AND (n.status IN ('submitted', 'returned')
          OR (n.status = 'draft' AND n.due_at <= now())
          OR (n.status IN ('reviewed', 'billed') AND n.service_date >= (now() AT TIME ZONE o.timezone)::date - 90))
  UNION ALL
  SELECT NULL, s.id, s.client_id, s.caregiver_id, ost.service_type, s.shift_date,
         (s.shift_date + s.start_time) AT TIME ZONE o.timezone,
         CASE WHEN s.end_time > s.start_time THEN (s.shift_date + s.end_time) AT TIME ZONE o.timezone
              ELSE ((s.shift_date + 1) + s.end_time) AT TIME ZONE o.timezone END,
         false, NULL, NULL, 'not_started', true, ((s.shift_date + 2)::timestamp AT TIME ZONE o.timezone), NULL, NULL, 0, false,
         s.group_session_id IS NOT NULL
    FROM public.shifts s JOIN o ON o.id = s.virtual_office_id
    JOIN public.office_service_types ost ON ost.virtual_office_id = s.virtual_office_id AND ost.care_type_code = s.care_type_code
         AND ost.is_active AND ost.service_type IN ('cls', 'respite')
   WHERE s.caregiver_id IS NOT NULL AND s.status IS DISTINCT FROM 'cancelled'
     AND o.golive IS NOT NULL AND s.shift_date >= (o.golive AT TIME ZONE o.timezone)::date
     AND ((s.shift_date + 2)::timestamp AT TIME ZONE o.timezone) <= now()
     AND NOT EXISTS (SELECT 1 FROM public.progress_notes x WHERE x.shift_id = s.id AND NOT x.voided)
$$;
REVOKE ALL ON FUNCTION public.cp_office_note_queue(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.list_notes_for_review(_office_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.list_notes_for_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_notes_for_review(uuid) TO authenticated;

CREATE FUNCTION public.get_notes_review_counts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('office_id', vo.id,
           'to_review', (SELECT count(*) FROM cp_office_note_queue(vo.id) q WHERE q.status = 'submitted'),
           'overdue', (SELECT count(*) FROM cp_office_note_queue(vo.id) q WHERE q.overdue)) ORDER BY vo.name), '[]'::jsonb)
    FROM public.virtual_office vo
   WHERE vo.care_plan_module_enabled AND cp_staff_in_scope(vo.agency_id, vo.id, '{manager,agency_admin}'::public.app_role[])
$$;
REVOKE ALL ON FUNCTION public.get_notes_review_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_notes_review_counts() TO authenticated;

CREATE FUNCTION public.get_progress_note_for_staff(_note_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n record; c record; g record; vo record; a record; s record; v_preview boolean := false; v_tpl text;
BEGIN
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
        AND ev.event_type IN ('progress_note_created', 'progress_note_submitted', 'progress_note_returned', 'progress_note_reviewed')), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_progress_note_for_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_progress_note_for_staff(uuid) TO authenticated;

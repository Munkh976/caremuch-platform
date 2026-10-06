-- Rollback of 20261019120200_ui_s8_note_detail_fix.sql: restores get_progress_note_for_staff exactly as
-- 20261019120000_ui_s8_note_review.sql created it (same signature, grants kept).
BEGIN;
CREATE OR REPLACE FUNCTION public.get_progress_note_for_staff(_note_id uuid)
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
COMMIT;

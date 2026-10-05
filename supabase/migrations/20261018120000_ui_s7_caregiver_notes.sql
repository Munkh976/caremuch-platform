-- Ripple UI S7 — caregiver progress note: two caregiver-safe reads. ADDITIVE ONLY (new functions; the
-- note RPCs from B2/D and every scheduling function are unchanged).
--
--   get_caregiver_clock()  the caller's caregiver day from the DATABASE clock (the phone's clock is never
--       used): now, today and the week (start per the office's billing_week_start, ISO 1 = Monday) in the
--       caregiver's office time zone, plus the caregiver's first name. Caller = an active caregivers row
--       with user_id = auth.uid() in the caller's agency (the same test as the RequireCaregiverRecord route
--       guard). No other data.
--   list_my_notes_due()  the caller's own progress-note work: shifts assigned to the caller
--       (shifts.caregiver_id, kept in sync with shift_assignments), not cancelled, in an office with the
--       care-plan module on, on or after that office's go-live date (care_plan_module_enabled_at in the
--       office time zone), mapped to CLS or respite, already started (the note opens at the shift start).
--       Open work (no note yet, draft, returned) is listed at any age; submitted / reviewed notes for 60
--       days (read-only history). Per shift, exactly: shift_id, shift_date, start_time, end_time,
--       scheduled_start, scheduled_end, service_type, client_first_name, client_last_initial, note_status
--       (not_started | draft | returned | submitted | reviewed; billed shows as reviewed), due_at (the
--       note's, or the same day-after deadline create_progress_note_for_shift would set), overdue, and
--       returned_reason (only while returned). No other client data. A shift whose note belongs to another
--       caregiver (reassigned after the note was started) is left out. Requires the caregiver role as well
--       (the note RPCs do: cp_is_assigned_caregiver).
-- Both: SECURITY DEFINER, search_path fixed, generic 'Not found or not allowed' refusal,
-- REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated (rule 14).

CREATE FUNCTION public.get_caregiver_clock()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; v_today date; v_start date;
BEGIN
  SELECT cg.id, cg.first_name, COALESCE(vo.timezone, 'America/New_York') tz, COALESCE(vo.billing_week_start, 1) wks INTO g
    FROM public.caregivers cg
    JOIN public.profiles pr ON pr.id = auth.uid() AND pr.agency_id = cg.agency_id
    LEFT JOIN public.virtual_office vo ON vo.id = cg.virtual_office_id
   WHERE cg.user_id = auth.uid() AND cg.is_active IS NOT FALSE
   ORDER BY cg.id LIMIT 1;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
  v_today := (now() AT TIME ZONE g.tz)::date;
  v_start := v_today - ((extract(isodow FROM v_today)::int - g.wks + 7) % 7);
  RETURN jsonb_build_object('now', now(), 'today', v_today, 'timezone', g.tz,
    'week_start', v_start, 'week_end', v_start + 6, 'first_name', g.first_name);
END $$;
REVOKE ALL ON FUNCTION public.get_caregiver_clock() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_caregiver_clock() TO authenticated;

CREATE FUNCTION public.list_my_notes_due()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agency uuid; v_now timestamptz := now();
BEGIN
  SELECT agency_id INTO v_agency FROM public.profiles WHERE id = auth.uid();
  IF v_agency IS NULL OR NOT has_role(auth.uid(), 'caregiver'::public.app_role)
     OR NOT EXISTS (SELECT 1 FROM public.caregivers WHERE user_id = auth.uid() AND agency_id = v_agency AND is_active IS NOT FALSE) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'shift_id', x.shift_id, 'shift_date', x.shift_date, 'start_time', x.start_time, 'end_time', x.end_time,
      'scheduled_start', x.v_start, 'scheduled_end', x.v_end, 'service_type', x.service_type,
      'client_first_name', x.first_name, 'client_last_initial', x.last_initial,
      'note_status', x.note_status, 'due_at', x.due_at,
      'overdue', x.note_status IN ('not_started', 'draft', 'returned') AND x.due_at <= v_now,
      'returned_reason', CASE WHEN x.note_status = 'returned' THEN x.returned_reason END)
      ORDER BY x.v_start DESC, x.shift_id)
    FROM (
      SELECT s.id shift_id, s.shift_date, s.start_time, s.end_time, t.v_start, t.v_end, ost.service_type,
             cl.first_name, left(cl.last_name, 1) last_initial,
             CASE WHEN n.id IS NULL THEN 'not_started' WHEN n.status::text = 'billed' THEN 'reviewed' ELSE n.status::text END note_status,
             COALESCE(n.due_at, ((s.shift_date + 2)::timestamp AT TIME ZONE vo.timezone)) due_at, n.returned_reason
        FROM public.shifts s
        JOIN public.caregivers g ON g.id = s.caregiver_id AND g.user_id = auth.uid() AND g.agency_id = v_agency
        JOIN public.virtual_office vo ON vo.id = s.virtual_office_id
             AND vo.care_plan_module_enabled AND vo.care_plan_module_enabled_at IS NOT NULL
        JOIN public.office_service_types ost ON ost.virtual_office_id = s.virtual_office_id AND ost.care_type_code = s.care_type_code
             AND ost.is_active AND ost.service_type IN ('cls', 'respite')
        JOIN public.clients cl ON cl.id = s.client_id
        LEFT JOIN public.progress_notes n ON n.shift_id = s.id AND NOT n.voided
        CROSS JOIN LATERAL (SELECT (s.shift_date + s.start_time) AT TIME ZONE vo.timezone AS v_start,
               CASE WHEN s.end_time > s.start_time THEN (s.shift_date + s.end_time) AT TIME ZONE vo.timezone
                    ELSE ((s.shift_date + 1) + s.end_time) AT TIME ZONE vo.timezone END AS v_end) t
       WHERE s.status IS DISTINCT FROM 'cancelled'
         AND s.shift_date >= (vo.care_plan_module_enabled_at AT TIME ZONE vo.timezone)::date
         AND t.v_start <= v_now
         AND (n.id IS NULL OR n.caregiver_id = s.caregiver_id)
         AND (n.id IS NULL OR n.status IN ('draft', 'returned') OR s.shift_date >= (v_now AT TIME ZONE vo.timezone)::date - 60)
    ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_my_notes_due() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_notes_due() TO authenticated;

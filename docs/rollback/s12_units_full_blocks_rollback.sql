-- Rollback of 20261025120000_s12_units_full_blocks.sql (Ripple S12): restores the three bodies byte-identical to DEV
-- before S12 (cp_derive_progress_note_units from 20261020120000, get_billing_week from 20261022120000,
-- get_billing_batch from 20261008120100). Notes written while S12 was live keep their stored units.

CREATE OR REPLACE FUNCTION public.cp_derive_progress_note_units()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IN ('draft', 'returned') THEN
    NEW.arrived_late := COALESCE(date_trunc('minute', NEW.client_arrived_at) > NEW.scheduled_start, false);
  ELSE
    NEW.arrived_late := OLD.arrived_late;          -- submitted / reviewed / billed: as submitted (no backfill)
  END IF;
  NEW.units_used := CASE
    WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0
    ELSE GREATEST(NEW.units_scheduled - CASE WHEN NEW.arrived_late THEN 1 ELSE 0 END, 0)
  END;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.get_billing_week(_office_id uuid, _week_start date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; nb record; v_today date; v_cur date; v_last date; v_ws date; v_we date; v_waiting int;
BEGIN
  SELECT id, agency_id, name, code, COALESCE(timezone, 'America/New_York') tz, billing_week_start wks, care_plan_module_enabled_at golive
    INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin}'::public.app_role[]);
  v_today := (now() AT TIME ZONE o.tz)::date;
  v_cur := v_today - ((extract(isodow FROM v_today)::int - o.wks + 7) % 7);
  v_last := v_cur - 7;
  v_ws := COALESCE(_week_start, v_last);
  IF extract(isodow FROM v_ws)::int <> o.wks THEN
    RAISE EXCEPTION 'The billing week for this office starts on ISO day %', o.wks USING ERRCODE = '22023';
  END IF;
  v_we := v_ws + 6;
  SELECT id, status, supplement INTO nb FROM public.billing_batches WHERE virtual_office_id = o.id AND week_start = v_ws ORDER BY supplement DESC LIMIT 1;
  SELECT count(*) INTO v_waiting FROM public.progress_notes
   WHERE virtual_office_id = o.id AND service_date BETWEEN v_ws AND v_we AND status = 'reviewed' AND billable AND NOT voided AND billing_batch_id IS NULL;
  RETURN jsonb_build_object(
    'office', jsonb_build_object('id', o.id, 'name', o.name, 'code', o.code, 'timezone', o.tz, 'billing_week_start', o.wks),
    'today', v_today, 'current_week_start', v_cur, 'last_complete_week_start', v_last,
    'week_start', v_ws, 'week_end', v_we, 'complete', v_we < v_today,
    -- what "Build" does now: build (no batch), rebuild (newest open), reopen (newest approved),
    -- supplement (newest billed and reviewed notes wait outside every batch), none (all billed, nothing waits)
    'next_action', CASE WHEN nb.id IS NULL THEN 'build' WHEN nb.status = 'open' THEN 'rebuild' WHEN nb.status = 'reviewed' THEN 'reopen'
                        WHEN v_waiting > 0 THEN 'supplement' ELSE 'none' END,
    'waiting_for_supplement', CASE WHEN nb.status = 'billed' THEN v_waiting ELSE 0 END,
    'batches', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', bb.id, 'supplement', bb.supplement,
        'status', CASE bb.status WHEN 'reviewed' THEN 'approved' ELSE bb.status::text END,
        'approved_at', bb.reviewed_at, 'approved_by_name', r.full_name, 'billed_at', bb.billed_at, 'billed_by_name', p.full_name,
        'lines', COALESCE((SELECT jsonb_agg(l.j ORDER BY l.csort, l.asort) FROM (
            SELECT lower(COALESCE(cl.first_name, '') || ' ' || COALESCE(cl.last_name, '')) csort, COALESCE(sa.expiration_date::text, '') || sa.id::text asort,
              jsonb_build_object('client_id', cl.id, 'client_first_name', cl.first_name, 'client_last_initial', left(cl.last_name, 1), 'case_number', cl.case_number,
                'authorization', jsonb_build_object('id', sa.id, 'auth_number', sa.auth_number, 'service_type', sa.service_type, 'service_code', sa.service_code,
                  'effective_date', sa.effective_date, 'expiration_date', sa.expiration_date, 'units_authorized', sa.units_authorized, 'units_left', sa.units_available,
                  'period_type', sa.period_type, 'units_per_period', sa.units_per_period,
                  'period_left', cp_period_left(sa.id, sa.period_type, sa.units_per_period, o.wks, v_we, '{}', '{}', '{}')),
                'units_scheduled', COALESCE(sum(n.units_scheduled), 0), 'units_billed', COALESCE(sum(n.units_used), 0),
                'units_lost_late', COALESCE(sum(n.units_scheduled - n.units_used) FILTER (WHERE n.arrived_late), 0),
                'notes', jsonb_agg(jsonb_build_object('note_id', n.id, 'service_date', n.service_date, 'scheduled_start', n.scheduled_start,
                  'caregiver_name', btrim(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')), 'units_scheduled', n.units_scheduled,
                  'units_billed', n.units_used, 'arrived_late', n.arrived_late, 'approved', n.batch_approved_at IS NOT NULL) ORDER BY n.scheduled_start, n.id)) j
              FROM public.progress_notes n
              JOIN public.clients cl ON cl.id = n.client_id
              JOIN public.service_authorizations sa ON sa.id = n.authorization_id
              LEFT JOIN public.caregivers g ON g.id = n.caregiver_id
             WHERE n.billing_batch_id = bb.id
             GROUP BY cl.id, sa.id) l), '[]'::jsonb),
        'totals', (SELECT jsonb_build_object('notes', count(*), 'units_scheduled', COALESCE(sum(n.units_scheduled), 0), 'units_billed', COALESCE(sum(n.units_used), 0),
            'units_lost_late', COALESCE(sum(n.units_scheduled - n.units_used) FILTER (WHERE n.arrived_late), 0), 'approved', count(n.batch_approved_at))
          FROM public.progress_notes n WHERE n.billing_batch_id = bb.id))
        ORDER BY bb.supplement)
      FROM public.billing_batches bb LEFT JOIN public.profiles r ON r.id = bb.reviewed_by LEFT JOIN public.profiles p ON p.id = bb.billed_by
     WHERE bb.virtual_office_id = o.id AND bb.week_start = v_ws), '[]'::jsonb),
    'excluded', COALESCE((SELECT jsonb_agg(x.j ORDER BY x.st, x.k) FROM (
        SELECT n.scheduled_start st, n.id::text k, jsonb_build_object('note_id', n.id, 'shift_id', n.shift_id, 'client_id', n.client_id,
          'client_first_name', cl.first_name, 'client_last_initial', left(cl.last_name, 1),
          'caregiver_name', btrim(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')), 'service_type', n.service_type,
          'service_date', n.service_date, 'scheduled_start', n.scheduled_start, 'status', n.status,
          'reason', CASE
            WHEN n.status = 'draft' THEN CASE WHEN n.due_at <= now() THEN 'overdue' ELSE 'not_submitted' END
            WHEN n.status = 'returned' THEN 'returned'
            WHEN n.status = 'submitted' THEN CASE WHEN EXISTS (
                SELECT 1 FROM public.service_authorizations sa
                 WHERE sa.client_id = n.client_id AND sa.service_type = n.service_type AND sa.voided_at IS NULL
                   AND sa.effective_date <= n.service_date AND sa.expiration_date >= n.service_date AND sa.units_available >= n.units_used
                   AND COALESCE(cp_period_left(sa.id, sa.period_type, sa.units_per_period, o.wks, n.service_date, '{}', '{}', '{}'), n.units_used) >= n.units_used)
              THEN 'not_reviewed' ELSE 'no_authorization_fits' END
            WHEN n.billable IS FALSE THEN 'non_billable'
            WHEN n.billing_batch_id IS NOT NULL THEN 'in_another_batch'
            WHEN nb.status = 'billed' THEN 'reviewed_after_billing'
            WHEN nb.status = 'reviewed' THEN 'reviewed_after_approval'
            ELSE 'not_in_bill_yet' END) j
          FROM public.progress_notes n
          JOIN public.clients cl ON cl.id = n.client_id
          LEFT JOIN public.caregivers g ON g.id = n.caregiver_id
         WHERE n.virtual_office_id = o.id AND n.service_date BETWEEN v_ws AND v_we AND NOT n.voided
           AND NOT EXISTS (SELECT 1 FROM public.billing_batches bb WHERE bb.id = n.billing_batch_id AND bb.virtual_office_id = o.id AND bb.week_start = v_ws)
        UNION ALL
        SELECT (s.shift_date + s.start_time) AT TIME ZONE o.tz, s.id::text, jsonb_build_object('note_id', NULL, 'shift_id', s.id, 'client_id', s.client_id,
          'client_first_name', cl.first_name, 'client_last_initial', left(cl.last_name, 1),
          'caregiver_name', btrim(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')), 'service_type', ost.service_type,
          'service_date', s.shift_date, 'scheduled_start', (s.shift_date + s.start_time) AT TIME ZONE o.tz, 'status', 'not_started', 'reason', 'no_note')
          FROM public.shifts s
          JOIN public.clients cl ON cl.id = s.client_id
          JOIN public.office_service_types ost ON ost.virtual_office_id = s.virtual_office_id AND ost.care_type_code = s.care_type_code
               AND ost.is_active AND ost.service_type IN ('cls', 'respite')
          LEFT JOIN public.caregivers g ON g.id = s.caregiver_id
         WHERE s.virtual_office_id = o.id AND s.shift_date BETWEEN v_ws AND v_we AND s.caregiver_id IS NOT NULL
           AND s.status IS DISTINCT FROM 'cancelled' AND o.golive IS NOT NULL AND s.shift_date >= (o.golive AT TIME ZONE o.tz)::date
           AND (s.shift_date + s.start_time) AT TIME ZONE o.tz <= now()
           AND NOT EXISTS (SELECT 1 FROM public.progress_notes x WHERE x.shift_id = s.id AND NOT x.voided)) x), '[]'::jsonb),
    'pending_review', (SELECT count(*) FROM public.progress_notes n WHERE n.virtual_office_id = o.id AND n.service_date BETWEEN v_ws AND v_we
                         AND NOT n.voided AND n.status = 'submitted'));
END $$;

CREATE OR REPLACE FUNCTION public.get_billing_batch(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM public.billing_batches WHERE id = _batch_id;
  PERFORM cp_require_scope(b.agency_id, b.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  RETURN jsonb_build_object('batch_id', b.id, 'status', b.status, 'week_start', b.week_start, 'week_end', b.week_end,
    'lines', COALESCE((SELECT jsonb_agg(l ORDER BY l ->> 'client_id', l ->> 'authorization_id') FROM (
      SELECT jsonb_build_object('client_id', n.client_id, 'authorization_id', n.authorization_id,
        'notes', count(*), 'approved', count(n.batch_approved_at),
        'units_scheduled', COALESCE(sum(n.units_scheduled), 0), 'units_billed', COALESCE(sum(n.units_used), 0),
        'units_lost_late', COALESCE(sum(n.units_scheduled - n.units_used) FILTER (WHERE n.arrived_late), 0),
        'note_ids', jsonb_agg(n.id ORDER BY n.service_date, n.id)) AS l
      FROM public.progress_notes n WHERE n.billing_batch_id = b.id
      GROUP BY n.client_id, n.authorization_id) x), '[]'::jsonb));
END $$;

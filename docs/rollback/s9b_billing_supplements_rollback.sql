-- Rollback of 20261022120000_s9b_billing_supplements.sql: restores build_billing_batch (as B2-02 created it),
-- get_billing_week and list_billing_week_status (as S9 created them) byte-identical, the one-batch-per-week
-- uniqueness (same constraint name) and drops the supplement column. Same signatures, so grants are kept.
-- Precondition: no office-week has more than one batch (delete supplementary batches first, after detaching
-- their notes), otherwise the old unique constraint can't be re-created and the transaction rolls back.
BEGIN;
CREATE OR REPLACE FUNCTION public.build_billing_batch(_office_id uuid, _week_start date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; b record; v_end date; v_in int; v_ex jsonb;
BEGIN
  SELECT id, agency_id, billing_week_start INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin}'::public.app_role[]);
  IF _week_start IS NULL OR extract(isodow FROM _week_start)::int <> o.billing_week_start THEN
    RAISE EXCEPTION 'The billing week for this office starts on ISO day %', o.billing_week_start USING ERRCODE = '22023';
  END IF;
  v_end := _week_start + 6;

  SELECT * INTO b FROM public.billing_batches WHERE virtual_office_id = o.id AND week_start = _week_start FOR UPDATE;
  IF b.id IS NULL THEN
    INSERT INTO public.billing_batches (agency_id, virtual_office_id, week_start, week_end)
    VALUES (o.agency_id, o.id, _week_start, v_end) RETURNING * INTO b;
  ELSIF b.status <> 'open' THEN
    RAISE EXCEPTION 'This batch is already % and can''t be rebuilt', b.status USING ERRCODE = '22023';
  END IF;

  -- detach notes that are no longer eligible (e.g. voided; never billed ones only)
  UPDATE public.progress_notes SET billing_batch_id = NULL, batch_approved_at = NULL, batch_approved_by = NULL
   WHERE billing_batch_id = b.id AND (voided OR status <> 'reviewed' OR NOT billable);
  -- attach every eligible note of the office and week that is in no other batch
  UPDATE public.progress_notes SET billing_batch_id = b.id
   WHERE id IN (SELECT id FROM public.progress_notes
                 WHERE virtual_office_id = o.id AND service_date BETWEEN _week_start AND v_end
                   AND status = 'reviewed' AND billable AND NOT voided AND billing_batch_id IS NULL
                 FOR UPDATE);
  SELECT count(*) INTO v_in FROM public.progress_notes WHERE billing_batch_id = b.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('note_id', n.id,
           'reason', CASE WHEN n.status = 'draft' THEN 'draft' WHEN n.status = 'returned' THEN 'returned'
                          WHEN n.status = 'submitted' THEN 'submitted, not reviewed'
                          WHEN n.status = 'reviewed' AND NOT n.billable THEN 'non-billable'
                          WHEN n.billing_batch_id IS NOT NULL THEN 'in another batch' ELSE n.status::text END,
           'overdue', n.status IN ('draft', 'returned') AND n.due_at <= now()) ORDER BY n.service_date, n.id), '[]'::jsonb)
    INTO v_ex
    FROM public.progress_notes n
   WHERE n.virtual_office_id = o.id AND n.service_date BETWEEN _week_start AND v_end AND NOT n.voided
     AND n.billing_batch_id IS DISTINCT FROM b.id;

  -- a rebuild can add notes: the batch is a draft again until they are approved
  UPDATE public.billing_batches SET status = 'open', reviewed_by = NULL, reviewed_at = NULL
   WHERE id = b.id AND status <> 'open';
  PERFORM cp_audit(o.agency_id, o.id, 'billing_batch_built', 'billing_batch', b.id,
    jsonb_build_object('batch_id', b.id, 'included', v_in, 'excluded', jsonb_array_length(v_ex)));
  RETURN jsonb_build_object('batch_id', b.id, 'week_start', _week_start, 'week_end', v_end, 'included', v_in, 'excluded', v_ex);
END $$;

CREATE OR REPLACE FUNCTION public.get_billing_week(_office_id uuid, _week_start date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; b record; v_today date; v_cur date; v_last date; v_ws date; v_we date;
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
  SELECT bb.id, bb.status, bb.reviewed_at, bb.billed_at, r.full_name reviewed_by_name, p.full_name billed_by_name INTO b
    FROM public.billing_batches bb LEFT JOIN public.profiles r ON r.id = bb.reviewed_by LEFT JOIN public.profiles p ON p.id = bb.billed_by
   WHERE bb.virtual_office_id = o.id AND bb.week_start = v_ws;
  RETURN jsonb_build_object(
    'office', jsonb_build_object('id', o.id, 'name', o.name, 'code', o.code, 'timezone', o.tz, 'billing_week_start', o.wks),
    'today', v_today, 'current_week_start', v_cur, 'last_complete_week_start', v_last,
    'week_start', v_ws, 'week_end', v_we, 'complete', v_we < v_today,
    'batch', CASE WHEN b.id IS NULL THEN NULL ELSE jsonb_build_object('id', b.id,
      'status', CASE b.status WHEN 'reviewed' THEN 'approved' ELSE b.status::text END,
      'approved_at', b.reviewed_at, 'approved_by_name', b.reviewed_by_name, 'billed_at', b.billed_at, 'billed_by_name', b.billed_by_name) END,
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
         WHERE b.id IS NOT NULL AND n.billing_batch_id = b.id
         GROUP BY cl.id, sa.id) l), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object('notes', count(*), 'units_scheduled', COALESCE(sum(n.units_scheduled), 0), 'units_billed', COALESCE(sum(n.units_used), 0),
        'units_lost_late', COALESCE(sum(n.units_scheduled - n.units_used) FILTER (WHERE n.arrived_late), 0), 'approved', count(n.batch_approved_at))
      FROM public.progress_notes n WHERE b.id IS NOT NULL AND n.billing_batch_id = b.id),
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
            WHEN b.status = 'billed' THEN 'reviewed_after_billing'
            WHEN b.status = 'reviewed' THEN 'reviewed_after_approval'
            ELSE 'not_in_bill_yet' END) j
          FROM public.progress_notes n
          JOIN public.clients cl ON cl.id = n.client_id
          LEFT JOIN public.caregivers g ON g.id = n.caregiver_id
         WHERE n.virtual_office_id = o.id AND n.service_date BETWEEN v_ws AND v_we AND NOT n.voided
           AND (b.id IS NULL OR n.billing_batch_id IS DISTINCT FROM b.id)
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

CREATE OR REPLACE FUNCTION public.list_billing_week_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('office_id', w.id, 'office_name', w.name, 'week_start', w.ws, 'week_end', w.ws + 6,
           'status', COALESCE(CASE bb.status WHEN 'reviewed' THEN 'approved' ELSE bb.status::text END, 'not_built'), 'billed_at', bb.billed_at) ORDER BY w.name), '[]'::jsonb)
    FROM (SELECT vo.id, vo.name, d.today - ((extract(isodow FROM d.today)::int - vo.billing_week_start + 7) % 7) - 7 AS ws
            FROM public.virtual_office vo
            CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE COALESCE(vo.timezone, 'America/New_York'))::date AS today) d
           WHERE vo.care_plan_module_enabled AND cp_staff_in_scope(vo.agency_id, vo.id, '{manager,agency_admin}'::public.app_role[])) w
    LEFT JOIN public.billing_batches bb ON bb.virtual_office_id = w.id AND bb.week_start = w.ws
$$;

ALTER TABLE public.billing_batches DROP CONSTRAINT billing_batches_office_week_supplement_key;
ALTER TABLE public.billing_batches ADD CONSTRAINT billing_batches_virtual_office_id_week_start_key UNIQUE (virtual_office_id, week_start);
ALTER TABLE public.billing_batches DROP CONSTRAINT billing_batches_supplement_chk;
ALTER TABLE public.billing_batches DROP COLUMN supplement;
COMMIT;

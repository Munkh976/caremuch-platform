-- Phase B2-02 — weekly billing: build_billing_batch, get_billing_batch, approve_batch_notes,
-- approve_clean_rows, mark_batch_billed; billed batches immutable.
-- Ripple care-plan module. Schema plan §5; arch §12 (weekly billing, Bren reviews every bill);
-- owner decisions Q11 (week per office setting), Q12 (per-note + bulk clean rows). DRAFT FOR REVIEW.
--
-- Roles: manager, agency_admin (clinical tier) in the batch office's scope. Scheduler, hr_staff,
-- system_admin, caregivers, clients and anon: nothing.
-- Batch lifecycle: open (draft; rebuildable) -> reviewed (every note approved) -> billed.
-- A batch holds reviewed, billable, non-voided notes of its office whose service date falls in
-- the week and that are in no other batch. "Clean" note (Q12 bulk approval) = no exception flag:
-- on-time arrival, submitted before the deadline, never returned, billable, all scheduled units billed.
-- mark_batch_billed sets every note to 'billed'; from then on the B2-01 guard makes those notes
-- and their entries immutable (no return, void, re-review or edit), and this file's guard makes
-- the batch immutable.
-- Audited (fail closed, ids/counts only): billing_batch_built, billing_batch_approved, billing_batch_billed.

CREATE FUNCTION public.cp_guard_billed_batch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'billed' AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'A billed batch cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.cp_guard_billed_batch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_cp_guard_billed_batch BEFORE UPDATE OR DELETE ON public.billing_batches
FOR EACH ROW EXECUTE FUNCTION public.cp_guard_billed_batch();

-- =============================================================================================
-- build_billing_batch
-- =============================================================================================
CREATE FUNCTION public.build_billing_batch(_office_id uuid, _week_start date)
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
REVOKE ALL ON FUNCTION public.build_billing_batch(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_billing_batch(uuid, date) TO authenticated;

-- =============================================================================================
-- get_billing_batch — lines by client x authorization (read only, not audited)
-- =============================================================================================
CREATE FUNCTION public.get_billing_batch(_batch_id uuid)
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
REVOKE ALL ON FUNCTION public.get_billing_batch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_billing_batch(uuid) TO authenticated;

-- =============================================================================================
-- approve_batch_notes / approve_clean_rows (Q12: both)
-- =============================================================================================
CREATE FUNCTION public.cp_approve_batch(_batch_id uuid, _note_ids uuid[], _clean_only boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE b record; v_n int; v_left int;
BEGIN
  SELECT * INTO b FROM public.billing_batches WHERE id = _batch_id FOR UPDATE;
  PERFORM cp_require_scope(b.agency_id, b.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF b.status <> 'open' THEN RAISE EXCEPTION 'This batch is already %', b.status USING ERRCODE = '22023'; END IF;
  IF NOT _clean_only THEN
    IF _note_ids IS NULL OR cardinality(_note_ids) = 0 OR cardinality(_note_ids) > 1000 THEN
      RAISE EXCEPTION 'List the notes to approve' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(_note_ids) x WHERE NOT EXISTS (
                 SELECT 1 FROM public.progress_notes WHERE id = x AND billing_batch_id = b.id)) THEN
      RAISE EXCEPTION 'A note is not in this batch' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.progress_notes SET batch_approved_at = now(), batch_approved_by = auth.uid()
   WHERE billing_batch_id = b.id AND batch_approved_at IS NULL
     AND (_clean_only OR id = ANY (_note_ids))
     AND (NOT _clean_only OR (NOT arrived_late AND NOT late_submitted AND returned_count = 0 AND billable
                              AND units_used = units_scheduled));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT count(*) INTO v_left FROM public.progress_notes WHERE billing_batch_id = b.id AND batch_approved_at IS NULL;
  IF v_left = 0 AND EXISTS (SELECT 1 FROM public.progress_notes WHERE billing_batch_id = b.id) THEN
    UPDATE public.billing_batches SET status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = b.id;
  END IF;
  IF v_n > 0 THEN
    PERFORM cp_audit(b.agency_id, b.virtual_office_id, 'billing_batch_approved', 'billing_batch', b.id,
      jsonb_build_object('batch_id', b.id, 'approved', v_n, 'remaining', v_left, 'clean_only', _clean_only));
  END IF;
  RETURN jsonb_build_object('approved', v_n, 'remaining', v_left, 'batch_status', CASE WHEN v_left = 0 THEN 'reviewed' ELSE 'open' END);
END $$;
REVOKE ALL ON FUNCTION public.cp_approve_batch(uuid, uuid[], boolean) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.approve_batch_notes(_batch_id uuid, _note_ids uuid[])
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT cp_approve_batch(_batch_id, _note_ids, false)
$$;
REVOKE ALL ON FUNCTION public.approve_batch_notes(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_batch_notes(uuid, uuid[]) TO authenticated;

CREATE FUNCTION public.approve_clean_rows(_batch_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT cp_approve_batch(_batch_id, NULL, true)
$$;
REVOKE ALL ON FUNCTION public.approve_clean_rows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_clean_rows(uuid) TO authenticated;

-- =============================================================================================
-- mark_batch_billed — every line approved; notes become billed (and immutable)
-- =============================================================================================
CREATE FUNCTION public.mark_batch_billed(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; v_n int; v_units numeric; v_name text;
BEGIN
  SELECT * INTO b FROM public.billing_batches WHERE id = _batch_id FOR UPDATE;
  PERFORM cp_require_scope(b.agency_id, b.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF b.status = 'billed' THEN RAISE EXCEPTION 'This batch is already billed' USING ERRCODE = '22023'; END IF;
  IF b.status <> 'reviewed' OR EXISTS (SELECT 1 FROM public.progress_notes WHERE billing_batch_id = b.id AND batch_approved_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.progress_notes WHERE billing_batch_id = b.id) THEN
    RAISE EXCEPTION 'Approve every line of the batch first' USING ERRCODE = '22023';
  END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM 1 FROM public.progress_notes WHERE billing_batch_id = b.id FOR UPDATE;
  UPDATE public.progress_notes SET status = 'billed', billed_at = now(), biller_name = v_name, biller_signed_at = now()
   WHERE billing_batch_id = b.id AND status = 'reviewed';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT COALESCE(sum(units_used), 0) INTO v_units FROM public.progress_notes WHERE billing_batch_id = b.id;
  UPDATE public.billing_batches SET status = 'billed', billed_by = auth.uid(), billed_at = now() WHERE id = b.id;
  PERFORM cp_audit(b.agency_id, b.virtual_office_id, 'billing_batch_billed', 'billing_batch', b.id,
    jsonb_build_object('batch_id', b.id, 'notes', v_n, 'units', v_units));
  RETURN jsonb_build_object('batch_id', b.id, 'notes', v_n, 'units', v_units);
END $$;
REVOKE ALL ON FUNCTION public.mark_batch_billed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_batch_billed(uuid) TO authenticated;

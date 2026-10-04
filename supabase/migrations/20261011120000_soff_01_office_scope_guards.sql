-- S-OFF-1 — caller office scope in the staff scheduling write paths (M-Office isolation gap found by
-- the Ripple D3 done-test, S8). Owner decision 2026-10-04: fix now.
--
-- These SECURITY DEFINER functions checked the caller's role and AGENCY but never the caller's
-- OFFICE, so an office-restricted manager (Tier 3) could act on another office's rows:
--   * assign_caregiver_to_shift(_shift_id, ...)      -> the shift's office
--   * release_shift_assignments(_shift_ids, _reason) -> every target shift's office
--   * compute_earnings_for_time_entry(_time_entry_id, _recompute) -> the time entry's office
-- Each gets one guard, the same predicate as cp_staff_in_scope and the M-Office RLS policies
-- (is_office_restricted(auth.uid()) -> the row's virtual_office_id must equal
-- current_virtual_office_id()), raising the same generic 'Not found or not allowed' (42501).
-- Unrestricted staff and caregiver self-service paths (caregiver_pick_up_shift, trade pick-up) are
-- unchanged. Every function is CREATE OR REPLACE from its CURRENT DEV definition with its IDENTICAL
-- signature, so CLAUDE.md #13 does not apply and the ACLs are unchanged.
-- Rollback: docs/rollback/soff_01_rollback.sql (bodies restored byte-for-byte).

CREATE OR REPLACE FUNCTION public.assign_caregiver_to_shift(_shift_id uuid, _caregiver_id uuid, _method assignment_method DEFAULT 'manual'::assignment_method, _notes text DEFAULT NULL::text, _override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  elig jsonb; s record; existing record; v_id uuid; v_override boolean := false;
BEGIN
  IF NOT public.is_agency_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only agency staff can assign shifts' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found' USING ERRCODE='P0002'; END IF;
  IF s.agency_id IS DISTINCT FROM public.current_agency_id() THEN
    RAISE EXCEPTION 'Shift belongs to another agency' USING ERRCODE='42501';
  END IF;
  -- S-OFF-1: an office-restricted caller acts only inside its own office (same rule and generic
  -- denial as cp_require_scope / the M-Office RLS predicate)
  IF public.is_office_restricted(auth.uid()) AND s.virtual_office_id IS DISTINCT FROM public.current_virtual_office_id() THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;

  -- Phase C: serialize assignments drawing on this client's authorizations (id order, as review)
  PERFORM public.cp_lock_client_authorizations(s.client_id);
  elig := public.check_assignment_eligibility(_shift_id, _caregiver_id);

  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Assignment refused: %', (
      SELECT string_agg(x->>'detail', ' ') FROM jsonb_array_elements(elig->'hard') x
    ) USING ERRCODE='23514';
  END IF;

  IF jsonb_array_length(elig->'soft') > 0 THEN
    IF _override_reason IS NULL OR btrim(_override_reason) = '' THEN
      RAISE EXCEPTION 'Override reason required: %', (
        SELECT string_agg(x->>'detail', ' ') FROM jsonb_array_elements(elig->'soft') x
      ) USING ERRCODE='23514';
    END IF;
    v_override := true;
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','1',true);

  SELECT * INTO existing FROM public.shift_assignments
   WHERE shift_id=_shift_id AND status NOT IN ('completed','cancelled') LIMIT 1;

  IF FOUND THEN
    UPDATE public.shift_assignments
       SET caregiver_id=_caregiver_id, status='scheduled', assignment_method=_method,
           notes=COALESCE(_notes,notes), assigned_at=now(),
           override_reason=CASE WHEN v_override THEN btrim(_override_reason) ELSE NULL END,
           override_by=CASE WHEN v_override THEN auth.uid() ELSE NULL END,
           override_at=CASE WHEN v_override THEN now() ELSE NULL END
     WHERE id=existing.id
     RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.shift_assignments(shift_id, caregiver_id, status, assignment_method, notes,
      override_reason, override_by, override_at)
    VALUES (_shift_id,_caregiver_id,'scheduled',_method,_notes,
      CASE WHEN v_override THEN btrim(_override_reason) END,
      CASE WHEN v_override THEN auth.uid() END,
      CASE WHEN v_override THEN now() END)
    RETURNING id INTO v_id;
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','',true);
  RETURN jsonb_build_object('assignment_id', v_id, 'overridden', v_override, 'eligibility', elig);
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_shift_assignments(_shift_ids uuid[], _reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count int := 0;
BEGIN
  IF NOT public.is_agency_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only agency staff can release assignments' USING ERRCODE='42501';
  END IF;
  -- S-OFF-1: an office-restricted caller acts only inside its own office (same rule and generic
  -- denial as cp_require_scope / the M-Office RLS predicate)
  IF public.is_office_restricted(auth.uid()) AND EXISTS (SELECT 1 FROM public.shifts s
       WHERE s.id = ANY(_shift_ids) AND s.agency_id = public.current_agency_id()
         AND s.virtual_office_id IS DISTINCT FROM public.current_virtual_office_id()) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','1',true);

  WITH target AS (
    SELECT a.id
    FROM public.shift_assignments a
    JOIN public.shifts s ON s.id = a.shift_id
    WHERE a.shift_id = ANY(_shift_ids)
      AND s.agency_id = public.current_agency_id()
      AND a.status NOT IN ('completed','cancelled')
  )
  UPDATE public.shift_assignments a
     SET status = 'cancelled',
         notes = COALESCE(NULLIF(btrim(_reason),''), a.notes)
    FROM target t
   WHERE a.id = t.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.shifts
     SET status = 'open'
   WHERE id = ANY(_shift_ids)
     AND agency_id = public.current_agency_id()
     AND status NOT IN ('completed','cancelled')
     AND NOT EXISTS (
       SELECT 1 FROM public.shift_assignments a
       WHERE a.shift_id = shifts.id AND a.status <> 'cancelled'
     );

  PERFORM set_config('caremuch.assignment_ctx','',true);
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_earnings_for_time_entry(_time_entry_id uuid, _recompute boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  te record; rate numeric; src public.earnings_rate_source; existing uuid; new_id uuid; gross numeric;
BEGIN
  SELECT t.*, s.pay_rate, c.hourly_rate INTO te
  FROM public.time_entries t
  JOIN public.shifts s ON s.id = t.shift_id
  JOIN public.caregivers c ON c.id = t.caregiver_id
  WHERE t.id = _time_entry_id;
  IF te IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped_reason', 'not_found');
  END IF;
  IF NOT (public.is_agency_staff(auth.uid())
          AND (te.agency_id = public.current_agency_id() OR public.has_role(auth.uid(),'system_admin'))) THEN
    RAISE EXCEPTION 'Only agency staff may compute earnings' USING ERRCODE='42501';
  END IF;
  -- S-OFF-1: an office-restricted caller acts only inside its own office (same rule and generic
  -- denial as cp_require_scope / the M-Office RLS predicate)
  IF public.is_office_restricted(auth.uid()) AND te.virtual_office_id IS DISTINCT FROM public.current_virtual_office_id() THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  IF te.status <> 'approved' OR te.voided_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped_reason', 'not_approved');
  END IF;

  SELECT id INTO existing FROM public.earnings_lines WHERE time_entry_id = te.id AND status = 'calculated';
  IF existing IS NOT NULL AND NOT _recompute THEN
    RETURN jsonb_build_object('ok', true, 'earnings_line_id', existing, 'skipped_reason', 'already_calculated');
  END IF;

  IF te.pay_rate IS NOT NULL AND te.pay_rate > 0 THEN
    rate := te.pay_rate; src := 'shift';
  ELSIF te.hourly_rate IS NOT NULL AND te.hourly_rate > 0 THEN
    rate := te.hourly_rate; src := 'caregiver';
  ELSE
    RETURN jsonb_build_object('ok', false, 'skipped_reason', 'missing_rate');
  END IF;

  IF existing IS NOT NULL THEN
    UPDATE public.earnings_lines SET status = 'voided' WHERE id = existing;
  END IF;

  gross := ROUND(te.hours_worked * rate, 2);
  INSERT INTO public.earnings_lines (
    agency_id, time_entry_id, shift_assignment_id, shift_id, caregiver_id,
    hours_used, rate_used, rate_source, regular_hours, regular_amount,
    overtime_hours, overtime_amount, gross_amount, computed_by, is_demo)
  VALUES (te.agency_id, te.id, te.shift_assignment_id, te.shift_id, te.caregiver_id,
    te.hours_worked, rate, src, te.hours_worked, gross, 0, 0, gross, auth.uid(), te.is_demo)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'earnings_line_id', new_id, 'hours', te.hours_worked,
    'rate', rate, 'rate_source', src, 'gross', gross, 'recomputed', existing IS NOT NULL);
END;
$function$;

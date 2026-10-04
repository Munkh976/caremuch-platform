-- REFERENCE ONLY: not a migration, never run by the Supabase CLI. Proven on PGlite
-- (tests/ripple/pglite/rollback-soff.cjs: exact catalog restore, bodies md5-checked against DEV).
-- S-OFF-1 rollback: the three functions restored VERBATIM from their DEV definitions captured
-- 2026-10-04 (identical signatures: ACLs unchanged). No data changes to undo.
BEGIN;
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
AS E'\r
DECLARE v_count int := 0;\r
BEGIN\r
  IF NOT public.is_agency_staff(auth.uid()) THEN\r
    RAISE EXCEPTION ''Only agency staff can release assignments'' USING ERRCODE=''42501'';\r
  END IF;\r
\r
  PERFORM set_config(''caremuch.assignment_ctx'',''1'',true);\r
\r
  WITH target AS (\r
    SELECT a.id\r
    FROM public.shift_assignments a\r
    JOIN public.shifts s ON s.id = a.shift_id\r
    WHERE a.shift_id = ANY(_shift_ids)\r
      AND s.agency_id = public.current_agency_id()\r
      AND a.status NOT IN (''completed'',''cancelled'')\r
  )\r
  UPDATE public.shift_assignments a\r
     SET status = ''cancelled'',\r
         notes = COALESCE(NULLIF(btrim(_reason),''''), a.notes)\r
    FROM target t\r
   WHERE a.id = t.id;\r
  GET DIAGNOSTICS v_count = ROW_COUNT;\r
\r
  UPDATE public.shifts\r
     SET status = ''open''\r
   WHERE id = ANY(_shift_ids)\r
     AND agency_id = public.current_agency_id()\r
     AND status NOT IN (''completed'',''cancelled'')\r
     AND NOT EXISTS (\r
       SELECT 1 FROM public.shift_assignments a\r
       WHERE a.shift_id = shifts.id AND a.status <> ''cancelled''\r
     );\r
\r
  PERFORM set_config(''caremuch.assignment_ctx'','''',true);\r
  RETURN v_count;\r
END;\r
';
-- (release_shift_assignments: stored body has CR characters on DEV; restored byte-for-byte, md5(prosrc) e23ab249a49e892c588d75c0c7a29175)

CREATE OR REPLACE FUNCTION public.compute_earnings_for_time_entry(_time_entry_id uuid, _recompute boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS E'\r
DECLARE\r
  te record; rate numeric; src public.earnings_rate_source; existing uuid; new_id uuid; gross numeric;\r
BEGIN\r
  SELECT t.*, s.pay_rate, c.hourly_rate INTO te\r
  FROM public.time_entries t\r
  JOIN public.shifts s ON s.id = t.shift_id\r
  JOIN public.caregivers c ON c.id = t.caregiver_id\r
  WHERE t.id = _time_entry_id;\r
  IF te IS NULL THEN\r
    RETURN jsonb_build_object(''ok'', false, ''skipped_reason'', ''not_found'');\r
  END IF;\r
  IF NOT (public.is_agency_staff(auth.uid())\r
          AND (te.agency_id = public.current_agency_id() OR public.has_role(auth.uid(),''system_admin''))) THEN\r
    RAISE EXCEPTION ''Only agency staff may compute earnings'' USING ERRCODE=''42501'';\r
  END IF;\r
  IF te.status <> ''approved'' OR te.voided_at IS NOT NULL THEN\r
    RETURN jsonb_build_object(''ok'', false, ''skipped_reason'', ''not_approved'');\r
  END IF;\r
\r
  SELECT id INTO existing FROM public.earnings_lines WHERE time_entry_id = te.id AND status = ''calculated'';\r
  IF existing IS NOT NULL AND NOT _recompute THEN\r
    RETURN jsonb_build_object(''ok'', true, ''earnings_line_id'', existing, ''skipped_reason'', ''already_calculated'');\r
  END IF;\r
\r
  IF te.pay_rate IS NOT NULL AND te.pay_rate > 0 THEN\r
    rate := te.pay_rate; src := ''shift'';\r
  ELSIF te.hourly_rate IS NOT NULL AND te.hourly_rate > 0 THEN\r
    rate := te.hourly_rate; src := ''caregiver'';\r
  ELSE\r
    RETURN jsonb_build_object(''ok'', false, ''skipped_reason'', ''missing_rate'');\r
  END IF;\r
\r
  IF existing IS NOT NULL THEN\r
    UPDATE public.earnings_lines SET status = ''voided'' WHERE id = existing;\r
  END IF;\r
\r
  gross := ROUND(te.hours_worked * rate, 2);\r
  INSERT INTO public.earnings_lines (\r
    agency_id, time_entry_id, shift_assignment_id, shift_id, caregiver_id,\r
    hours_used, rate_used, rate_source, regular_hours, regular_amount,\r
    overtime_hours, overtime_amount, gross_amount, computed_by, is_demo)\r
  VALUES (te.agency_id, te.id, te.shift_assignment_id, te.shift_id, te.caregiver_id,\r
    te.hours_worked, rate, src, te.hours_worked, gross, 0, 0, gross, auth.uid(), te.is_demo)\r
  RETURNING id INTO new_id;\r
\r
  RETURN jsonb_build_object(''ok'', true, ''earnings_line_id'', new_id, ''hours'', te.hours_worked,\r
    ''rate'', rate, ''rate_source'', src, ''gross'', gross, ''recomputed'', existing IS NOT NULL);\r
END;\r
';
-- (compute_earnings_for_time_entry: stored body has CR characters on DEV; restored byte-for-byte, md5(prosrc) ce7e2ade73511ad840b705514b7444cf)
-- On DEV only (migration history), same transaction:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011120000';
COMMIT;

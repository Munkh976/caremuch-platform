CREATE OR REPLACE FUNCTION public.caregiver_pickup_trade_shift(_trade_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cg record;
  t record;
  s record;
  elig jsonb;
  existing record;
  v_id uuid;
  v_claimed uuid;
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

  elig := public.check_assignment_eligibility(t.shift_id, v_cg.id);

  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Pick-up refused: %', (
      SELECT string_agg(x->>'detail',' ') FROM jsonb_array_elements(elig->'hard') x
    ) USING ERRCODE='23514';
  END IF;

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
    RETURN jsonb_build_object('status', 'sent_for_approval', 'eligibility', elig);
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

  RETURN jsonb_build_object('status', 'picked_up', 'assignment_id', v_id, 'eligibility', elig);
END;
$function$

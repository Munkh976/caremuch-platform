-- Rollback of 20261031170000_visit_actions.sql: restores caregiver_pick_up_shift and caregiver_pickup_trade_shift
-- byte-identical to DEV before the push, drops the new functions and shift columns, restores the events CHECK of
-- 20261031160000. Stops while visit-action events or recorded outcomes exist (cancelled / no-show visits would lose why).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE event_type IN ('shift_unassigned', 'client_no_show')
             OR (event_type = 'shift_cancelled' AND payload ? 'reason_code')) THEN
    RAISE EXCEPTION 'visit action events exist; delete them first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shifts WHERE visit_outcome IS NOT NULL) THEN
    RAISE EXCEPTION 'visits with a recorded outcome exist; clear them first';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.caregiver_pick_up_shift(_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cg uuid; elig jsonb; s record; v_id uuid;
BEGIN
  SELECT id INTO v_cg FROM public.caregivers WHERE user_id = auth.uid() LIMIT 1;
  IF v_cg IS NULL THEN RAISE EXCEPTION 'No caregiver profile for this user' USING ERRCODE='42501'; END IF;

  SELECT * INTO s FROM public.shifts WHERE id=_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found' USING ERRCODE='P0002'; END IF;
  IF s.status NOT IN ('open','unassigned') THEN
    RAISE EXCEPTION 'Shift is not open for pick-up' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_assignments a WHERE a.shift_id=_shift_id AND a.status<>'cancelled') THEN
    RAISE EXCEPTION 'Shift is already assigned' USING ERRCODE='23514';
  END IF;

  -- Phase C: serialize assignments drawing on this client's authorizations (id order, as review)
  PERFORM public.cp_lock_client_authorizations(s.client_id);
  -- Phase C (R6): the caregiver only ever sees caregiver-safe text (error message and response)
  elig := public.cp_caregiver_safe_eligibility(public.check_assignment_eligibility(_shift_id, v_cg));
  -- CHANGED: was `jsonb_array_length(elig->'hard') > 0 OR jsonb_array_length(elig->'soft') > 0`.
  -- Self-pickup now blocks on hard issues only -- soft issues (availability, service-area
  -- over the zip list) are self-consented by the caregiver's own act of picking it up.
  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Pick-up refused: %', (
      SELECT string_agg(x->>'detail',' ') FROM jsonb_array_elements(elig->'hard') x
    ) USING ERRCODE='23514';
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','1',true);
  INSERT INTO public.shift_assignments(shift_id, caregiver_id, status, assignment_method)
  VALUES (_shift_id, v_cg, 'scheduled', 'picked_up') RETURNING id INTO v_id;
  PERFORM set_config('caremuch.assignment_ctx','',true);

  RETURN jsonb_build_object('assignment_id', v_id, 'eligibility', elig);
END;
$function$;

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
  v_safe jsonb;   -- Phase C (R6)
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

  -- Phase C: serialize assignments drawing on this client's authorizations (id order, as review)
  PERFORM public.cp_lock_client_authorizations(s.client_id);
  elig := public.check_assignment_eligibility(t.shift_id, v_cg.id);
  -- Phase C (R6): the full result is kept for the manager (eligibility_snapshot, approval_reasons);
  -- the caregiver only sees the caregiver-safe copy.
  v_safe := public.cp_caregiver_safe_eligibility(elig);

  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Pick-up refused: %', (
      SELECT string_agg(x->>'detail',' ') FROM jsonb_array_elements(v_safe->'hard') x
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
    RETURN jsonb_build_object('status', 'sent_for_approval', 'eligibility', v_safe);
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

  RETURN jsonb_build_object('status', 'picked_up', 'assignment_id', v_id, 'eligibility', v_safe);
END;
$function$;

DROP FUNCTION public.cp_pickup_gate(uuid, jsonb);
DROP FUNCTION public.list_client_no_shows(uuid, date, date);
DROP FUNCTION public.record_client_no_show(uuid, text, boolean);
DROP FUNCTION public.cancel_visit(uuid, text, text, text, boolean, boolean);
DROP FUNCTION public.unassign_visit(uuid, text, text, boolean, boolean);
DROP FUNCTION public.preview_visit_action(uuid, text, boolean, boolean);
DROP FUNCTION public.cp_visit_action_prepare(uuid, text, text, text, boolean, boolean);
DROP FUNCTION public.cp_visit_outbox(uuid, uuid, text);
DROP FUNCTION public.cp_visit_action_blocker(uuid, text);
DROP FUNCTION public.cp_visit_targets(uuid, boolean, boolean);

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
  'office_units_rule_changed', 'progress_note_units_adjusted',
  -- visit location office setting
  'office_visit_location_changed'
]::text[]));

ALTER TABLE public.shifts DROP COLUMN visit_outcome, DROP COLUMN cancel_reason_code, DROP COLUMN cancel_reason_text,
  DROP COLUMN cancel_requested_by, DROP COLUMN cancelled_by, DROP COLUMN cancelled_at, DROP COLUMN late_cancel;

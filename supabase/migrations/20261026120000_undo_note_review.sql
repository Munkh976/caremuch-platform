-- Ripple demo UX Part 2 — undo a note review (owner decision, Oct 19).
-- Rule: a manager (or agency admin) of the note's office can undo a review while the note is not in an approved or
-- billed bill. Undo returns the note to Submitted; from there the reviewer marks it reviewed again or returns it to
-- the caregiver. The caregiver still never edits a submitted or reviewed note (save/submit only accept draft/returned).
--
-- 1. events_event_type_check: ONE ALTER TABLE (drop + add, atomic). Keeps the 51 existing values of 20261023120000
--    exactly and adds 'progress_note_review_undone'.
-- 2. undo_progress_note_review(_note_id): NEW, SECURITY DEFINER, cp_require_scope manager / agency_admin of the
--    note's office (generic refusal 42501). REVOKE PUBLIC/anon, GRANT authenticated (rule 14).
--    Refused (22023, with the reason): not reviewed (draft, submitted, returned), billed, in an approved bill (or
--    approved in an open one), reviewed as not billable (its units can't be restored without recalculating them).
--    In an OPEN (built, not approved) bill: the note leaves the bill now, as void_progress_note does; the week's
--    Approve is then blocked until the note is reviewed again and the week is rebuilt (approveBlockers: a submitted
--    note in the week; a reviewed note not in the bill yet). Mark billed can never bill a submitted note.
--    Units: authorization_id is cleared, so the units trigger gives the authorization its units back; the note keeps
--    its stored units (S12: no recalculation outside draft / returned). Locks in the order build / approve use:
--    the office-week advisory lock, the bill, then the note.
--    Audited through cp_audit (fail closed): actor and time from cp_audit; payload ids and counts only.
-- Unchanged: every existing function, trigger, policy and CHECK other than the events CHECK.

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
  'progress_note_review_undone'
]::text[]));

CREATE FUNCTION public.undo_progress_note_review(_note_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n record; v_batch uuid; v_batch_status text; v_wks int; v_week date;
BEGIN
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided;
  PERFORM cp_require_scope(n.agency_id, n.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  -- same lock order as build_billing_batch / cp_approve_batch: office-week, bill, note
  SELECT billing_week_start INTO v_wks FROM public.virtual_office WHERE id = n.virtual_office_id;
  v_week := n.service_date - ((extract(isodow FROM n.service_date)::int - v_wks + 7) % 7);
  PERFORM pg_advisory_xact_lock(hashtextextended(n.virtual_office_id::text || ':' || v_week::text, 0));
  IF n.billing_batch_id IS NOT NULL THEN
    SELECT id, status::text INTO v_batch, v_batch_status FROM public.billing_batches WHERE id = n.billing_batch_id FOR UPDATE;
  END IF;
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided FOR UPDATE;
  IF n.billing_batch_id IS DISTINCT FROM v_batch THEN
    RAISE EXCEPTION 'The week''s bill changed while undoing; try again' USING ERRCODE = '40001';
  END IF;

  IF n.status = 'billed' OR v_batch_status = 'billed' THEN
    RAISE EXCEPTION 'This note is billed, so its review can''t be undone' USING ERRCODE = '22023';
  END IF;
  IF n.status <> 'reviewed' THEN RAISE EXCEPTION 'Only a reviewed note can have its review undone' USING ERRCODE = '22023'; END IF;
  IF v_batch_status = 'reviewed' OR n.batch_approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'This note''s week is approved, so its review can''t be undone' USING ERRCODE = '22023';
  END IF;
  IF NOT n.billable THEN
    RAISE EXCEPTION 'A note reviewed as not billable can''t have its review undone' USING ERRCODE = '22023';
  END IF;

  UPDATE public.progress_notes SET status = 'submitted', authorization_id = NULL, reviewed_by = NULL, reviewed_at = NULL,
         billing_batch_id = NULL, batch_approved_at = NULL, batch_approved_by = NULL
   WHERE id = n.id;
  PERFORM cp_audit(n.agency_id, n.virtual_office_id, 'progress_note_review_undone', 'progress_note', n.id,
    jsonb_build_object('note_id', n.id, 'authorization_id', n.authorization_id, 'units_restored', n.units_used,
                       'removed_from_batch', v_batch));
  RETURN jsonb_build_object('status', 'submitted', 'units_restored', n.units_used, 'removed_from_batch', v_batch);
END $$;
REVOKE ALL ON FUNCTION public.undo_progress_note_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_progress_note_review(uuid) TO authenticated;

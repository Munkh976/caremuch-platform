-- Rollback of 20261030130000_auto_assign.sql: drops the new functions and restores the events CHECK of 20261029120100.
-- Stops while auto-assign events exist (delete them first). Office weights set through the new screen stay in
-- virtual_office.smart_match_weights (an existing column that nothing else reads).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE event_type IN ('auto_assign_run', 'office_match_weights_changed')) THEN
    RAISE EXCEPTION 'auto-assign events exist; delete them first';
  END IF;
END $$;
DROP FUNCTION public.commit_auto_assignments(uuid, date, date, jsonb);
DROP FUNCTION public.propose_auto_assignments(uuid, date, date);
DROP FUNCTION public.cp_unassigned_shifts(uuid, date, date, date);
DROP FUNCTION public.suggest_caregivers(uuid);
DROP FUNCTION public.cp_shift_candidates(uuid, jsonb, date);
DROP FUNCTION public.cp_client_gate(uuid, uuid);
DROP FUNCTION public.cp_gate_issues(jsonb);
DROP FUNCTION public.cp_match_factors(uuid, uuid, jsonb, date);
DROP FUNCTION public.set_office_match_weights(uuid, jsonb);
DROP FUNCTION public.cp_office_match_weights(uuid);
DROP FUNCTION public.cp_valid_match_weights(jsonb);
DROP FUNCTION public.cp_default_match_weights();

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
  'care_plan_activated', 'care_plan_revised'
]::text[]));

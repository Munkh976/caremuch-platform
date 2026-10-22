-- "Visits take place at" office setting (owner, Oct 22, A: approach approved; extends the item 2 Location card).
-- virtual_office.visit_location: 'client_home' (default: every office shows the client's address on visits, as today) or
-- 'office' (visit screens show the office's name / note location and the office address instead). Display only: client
-- addresses, the match service-area factor and eligibility are unchanged.
-- set_office_visit_location: agency admin of the office (cp_require_scope), audited office_visit_location_changed;
-- 'office' needs the office's street address (Contact tab).
-- events CHECK: the 62 values of 20261031140000 + office_visit_location_changed.

ALTER TABLE public.virtual_office
  ADD COLUMN visit_location text NOT NULL DEFAULT 'client_home'
    CONSTRAINT virtual_office_visit_location_check CHECK (visit_location IN ('client_home', 'office'));

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

CREATE FUNCTION public.set_office_visit_location(_office_id uuid, _mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agency uuid; v_old text; v_addr text;
BEGIN
  SELECT agency_id, visit_location, address INTO v_agency, v_old, v_addr FROM public.virtual_office WHERE id = _office_id FOR UPDATE;
  PERFORM cp_require_scope(v_agency, _office_id, '{agency_admin}'::public.app_role[]);
  IF _mode IS NULL OR _mode NOT IN ('client_home', 'office') THEN
    RAISE EXCEPTION 'Visits take place at the client''s home or the office' USING ERRCODE = '22023';
  END IF;
  IF _mode = 'office' AND btrim(COALESCE(v_addr, '')) = '' THEN
    RAISE EXCEPTION 'Add the office''s street address on the Contact tab first' USING ERRCODE = '22023';
  END IF;
  UPDATE public.virtual_office SET visit_location = _mode WHERE id = _office_id;
  PERFORM cp_audit(v_agency, _office_id, 'office_visit_location_changed', 'virtual_office', _office_id,
    jsonb_build_object('office_id', _office_id, 'before', v_old, 'after', _mode));
  RETURN jsonb_build_object('visit_location', _mode);
END $$;
REVOKE ALL ON FUNCTION public.set_office_visit_location(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_office_visit_location(uuid, text) TO authenticated;

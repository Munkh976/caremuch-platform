-- Ripple UI S10 — the audited compliance enforcement switch (owner approval Oct 6, option 1).
--
-- 1. events_event_type_check: ONE ALTER TABLE (drop + add, atomic). Keeps the 50 existing values exactly
--    and adds 'compliance_enforcement_changed'.
-- 2. set_compliance_enforcement(_office_id, _enabled): NEW, SECURITY DEFINER. agency_admin or system_admin
--    of the office's agency (cp_require_scope, with the M-Office predicate; generic refusal). Turning
--    enforcement on needs the care-plan module on. Same value = no change, no event. Audited through
--    cp_audit (fail closed): {enabled, was_enabled}. REVOKE PUBLIC/anon, GRANT authenticated (rule 14).
--
-- Unchanged (owner: changing that policy needs separate approval): the direct UPDATE of
-- virtual_office.compliance_enforcement_enabled and its admin-only guard trigger guard_virtual_office_flags.
-- A direct update bypasses this audit (known-issues, to close before production). check_assignment_eligibility
-- and every assign path are unchanged; they already read the flag (enforcement on -> hard, off -> advisory).

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
  'compliance_enforcement_changed'
]::text[]));

CREATE FUNCTION public.set_compliance_enforcement(_office_id uuid, _enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  SELECT id, agency_id, compliance_enforcement_enabled, care_plan_module_enabled INTO o
    FROM public.virtual_office WHERE id = _office_id FOR UPDATE;
  PERFORM cp_require_scope(o.agency_id, o.id, '{agency_admin,system_admin}'::public.app_role[]);
  IF _enabled IS NULL THEN RAISE EXCEPTION 'Choose on or off' USING ERRCODE = '22023'; END IF;
  IF o.compliance_enforcement_enabled = _enabled THEN
    RETURN jsonb_build_object('office_id', o.id, 'enabled', _enabled, 'changed', false);
  END IF;
  IF _enabled AND NOT o.care_plan_module_enabled THEN
    RAISE EXCEPTION 'Turn on the care-plan module for this office first' USING ERRCODE = '22023';
  END IF;
  UPDATE public.virtual_office SET compliance_enforcement_enabled = _enabled WHERE id = o.id;
  PERFORM cp_audit(o.agency_id, o.id, 'compliance_enforcement_changed', 'virtual_office', o.id,
    jsonb_build_object('enabled', _enabled, 'was_enabled', o.compliance_enforcement_enabled));
  RETURN jsonb_build_object('office_id', o.id, 'enabled', _enabled, 'changed', true);
END $$;
REVOKE ALL ON FUNCTION public.set_compliance_enforcement(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_compliance_enforcement(uuid, boolean) TO authenticated;

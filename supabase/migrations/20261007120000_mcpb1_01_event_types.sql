-- Phase B1-01 — audit event types for the care-plan module (B1 + B2), FIRST in Phase B
-- (schema plan §2.1 item 4, §10; the M-SEC-6 lesson: the CHECK list must allow a type before any
-- writer uses it, because the module's writers insert events directly and fail closed).
-- DRAFT FOR REVIEW. Not pushed.
--
-- One ALTER TABLE statement (drop + add): atomic on its own, never a window without the check.
-- Keeps the 18 existing values exactly and adds 24:
--   B1: care_plan_module_enabled, template_draft_saved, template_published,
--       instance_template_upgraded, care_plan_created, care_plan_renewed, care_plan_updated,
--       training_version_bumped, objective_measures_set, authorization_created,
--       client_document_saved, credential_entered, credential_overridden, inservice_signed,
--       training_recorded, training_record_overridden
--   B2: progress_note_created, progress_note_submitted, progress_note_returned,
--       progress_note_reviewed, progress_note_voided, billing_batch_built, billing_batch_approved,
--       billing_batch_billed
-- Payload rule for all of them: ids, versions and counts only. Never names, notes, narratives,
-- diagnoses or document content.

ALTER TABLE public.events
  DROP CONSTRAINT events_event_type_check,
  ADD CONSTRAINT events_event_type_check CHECK (event_type = ANY (ARRAY[
  'caregiver_application_received', 'caregiver_approved', 'caregiver_rejected',
  'care_request_received', 'care_request_converted_to_client',
  'shift_created', 'shift_assigned', 'shift_filled', 'shift_completed', 'shift_cancelled', 'shift_no_show',
  'caregiver_pickup', 'assignment_released', 'rating_added',
  'time_entry_submitted', 'time_entry_approved', 'earnings_computed',
  'account_link_issued',
  -- care-plan module, Phase B1
  'care_plan_module_enabled', 'template_draft_saved', 'template_published', 'instance_template_upgraded',
  'care_plan_created', 'care_plan_renewed', 'care_plan_updated', 'training_version_bumped',
  'objective_measures_set', 'authorization_created', 'client_document_saved',
  'credential_entered', 'credential_overridden', 'inservice_signed', 'training_recorded',
  'training_record_overridden',
  -- care-plan module, Phase B2
  'progress_note_created', 'progress_note_submitted', 'progress_note_returned', 'progress_note_reviewed',
  'progress_note_voided', 'billing_batch_built', 'billing_batch_approved', 'billing_batch_billed'
]::text[]));

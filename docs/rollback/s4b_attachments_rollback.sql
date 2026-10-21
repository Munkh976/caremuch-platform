-- Rollback of 20261028120000_s4b_attachments.sql (S4b attachments).
-- Stops (nothing changed) while the bucket still holds objects or cp_attachments has rows: list and remove them
-- first through the Storage API (service role), then rerun. On DEV, if Storage refuses the direct bucket delete,
-- delete the (empty) bucket with the Storage API instead. Restores the events CHECK of 20261026120000 exactly
-- (52 values); fails if attachment_* events exist (delete them first, they reference removed rows only).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'cp-attachments') THEN
    RAISE EXCEPTION 'cp-attachments still holds objects; remove them through the Storage API first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cp_attachments) THEN
    RAISE EXCEPTION 'cp_attachments still has rows; remove them first';
  END IF;
END $$;

DROP FUNCTION public.cp_attachment_stale_pending(integer);
DROP FUNCTION public.cp_attachment_discard(uuid);
DROP FUNCTION public.cp_attachment_mark_checked(uuid, bigint);
DROP FUNCTION public.save_other_client_document(uuid, text, text, public.client_document_status, text, date, date);
DROP FUNCTION public.list_attachments(text, uuid[]);
DROP FUNCTION public.open_attachment(uuid);
DROP FUNCTION public.remove_attachment(uuid, text);
DROP FUNCTION public.complete_attachment_upload(uuid);
DROP FUNCTION public.begin_attachment_upload(text, uuid, text, text, text, integer);
DROP POLICY "cp-attachments: read a readable active attachment" ON storage.objects;
DROP FUNCTION public.cp_attachment_allowed(text, uuid, uuid, uuid);
DROP FUNCTION public.cp_attachment_parent(text, uuid);
DROP TABLE public.cp_attachments;
DELETE FROM storage.buckets WHERE id = 'cp-attachments';
ALTER TABLE public.client_documents DROP COLUMN display_name;

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

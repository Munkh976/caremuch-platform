-- REFERENCE ONLY: not a migration, never run by the Supabase CLI. Proven on PGlite (exact post-B1 catalog restore).
-- Phase B2 rollback (reverse order, one transaction). Restores the post-B1 state exactly.
-- Data notes:
--   * The event types used by B2 belong to B1-01 and stay; B2's audit rows stay valid.
--   * progress_notes.authorization_id becomes NOT NULL again, so notes without an authorization
--     (draft/submitted/returned, non-billable) must be resolved first. ON ANY NON-DEV PROJECT
--     THOSE NOTES (and their entries) ARE ARCHIVED FIRST, NEVER JUST DELETED: copy them out and
--     verify the archived counts in this same transaction before the DELETE below. On DEV,
--     disposable fixture data may be deleted.
BEGIN;

-- 0. notes that can't satisfy the restored NOT NULL (archive first on non-DEV projects)
DELETE FROM public.progress_notes WHERE authorization_id IS NULL;

-- B2-02 billing
DROP FUNCTION IF EXISTS public.mark_batch_billed(uuid);
DROP FUNCTION IF EXISTS public.approve_clean_rows(uuid);
DROP FUNCTION IF EXISTS public.approve_batch_notes(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.cp_approve_batch(uuid, uuid[], boolean);
DROP FUNCTION IF EXISTS public.get_billing_batch(uuid);
DROP FUNCTION IF EXISTS public.build_billing_batch(uuid, date);
DROP TRIGGER IF EXISTS trg_cp_guard_billed_batch ON public.billing_batches;
DROP FUNCTION IF EXISTS public.cp_guard_billed_batch();

-- B2-01 progress notes
DROP FUNCTION IF EXISTS public.list_overdue_notes(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.void_progress_note(uuid, text);
DROP FUNCTION IF EXISTS public.review_progress_note(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.return_progress_note(uuid, text);
DROP FUNCTION IF EXISTS public.submit_progress_note(uuid, text);
DROP FUNCTION IF EXISTS public.save_progress_note_draft(uuid, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.get_progress_note_for_caregiver(uuid);
DROP FUNCTION IF EXISTS public.create_progress_note_for_shift(uuid);
DROP FUNCTION IF EXISTS public.cp_validate_entry_data(jsonb, jsonb, boolean);
DROP FUNCTION IF EXISTS public.cp_validate_answer(jsonb, jsonb, boolean);
DROP FUNCTION IF EXISTS public.cp_objective_measures(uuid);
DROP FUNCTION IF EXISTS public.cp_is_assigned_caregiver(uuid);
DROP TRIGGER IF EXISTS trg_cp_guard_billed_note_entry ON public.progress_note_entries;
DROP TRIGGER IF EXISTS trg_cp_guard_billed_note ON public.progress_notes;
DROP FUNCTION IF EXISTS public.cp_guard_billed_note_entry();
DROP FUNCTION IF EXISTS public.cp_guard_billed_note();
DROP INDEX IF EXISTS public.progress_notes_due_idx;
ALTER TABLE public.progress_notes
  DROP CONSTRAINT IF EXISTS progress_notes_non_billable_reason_chk,
  DROP CONSTRAINT IF EXISTS progress_notes_billable_needs_authorization_chk,
  DROP COLUMN IF EXISTS batch_approved_by, DROP COLUMN IF EXISTS batch_approved_at,
  DROP COLUMN IF EXISTS non_billable_reason, DROP COLUMN IF EXISTS returned_count,
  DROP COLUMN IF EXISTS late_submitted, DROP COLUMN IF EXISTS due_at, DROP COLUMN IF EXISTS service_type,
  ALTER COLUMN authorization_id SET NOT NULL;

-- On DEV only (migration history), same transaction:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20261008120000','20261008120100');
COMMIT;

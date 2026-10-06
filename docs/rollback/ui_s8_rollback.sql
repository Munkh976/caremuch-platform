-- Rollback of 20261019120000_ui_s8_note_review.sql (additive): drops the three staff reads and the
-- internal queue helper. The menu seed (20261019120100) has its own rollback lines in that file.
BEGIN;
DROP FUNCTION public.get_progress_note_for_staff(uuid);
DROP FUNCTION public.get_notes_review_counts();
DROP FUNCTION public.list_notes_for_review(uuid);
DROP FUNCTION public.cp_office_note_queue(uuid);
COMMIT;

-- Rollback of 20261018120000_ui_s7_caregiver_notes.sql: drops the two caregiver-safe reads (nothing else
-- was created or changed).
BEGIN;
DROP FUNCTION public.list_my_notes_due();
DROP FUNCTION public.get_caregiver_clock();
COMMIT;

-- Rollback of 20261016120000_ui_s6_training.sql (additive): drops the two new reads.
-- Restores the exact post-W2 catalog.
BEGIN;
DROP FUNCTION public.list_client_training_status(uuid);
DROP FUNCTION public.get_client_training_context(uuid);
COMMIT;

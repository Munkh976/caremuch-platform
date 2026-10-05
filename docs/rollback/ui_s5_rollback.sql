-- Rollback of 20261014120200_ui_s5_goals.sql (additive): drops the one new function.
-- Restores the exact post-S4 catalog.
BEGIN;
DROP FUNCTION public.would_bump_training_version(uuid, jsonb);
COMMIT;

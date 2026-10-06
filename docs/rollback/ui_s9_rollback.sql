-- Rollback of 20261021120000_ui_s9_weekly_billing.sql (additive): drops the two Weekly Billing reads.
BEGIN;
DROP FUNCTION public.list_billing_week_status();
DROP FUNCTION public.get_billing_week(uuid, date);
COMMIT;

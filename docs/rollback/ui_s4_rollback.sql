-- Rollback of 20261014120100_ui_s4_authorizations.sql (additive): drops the six new functions.
-- Restores the exact post-W1 catalog (no existing object was changed). Data written by
-- correct_service_authorization / set_care_plan_rows stays (it lives in existing tables).
BEGIN;
DROP FUNCTION public.set_care_plan_rows(uuid, text, jsonb);
DROP FUNCTION public.cp_plan_row_spec(text);
DROP FUNCTION public.correct_service_authorization(uuid, jsonb, text);
DROP FUNCTION public.list_authorization_risk(uuid, integer);
DROP FUNCTION public.get_client_authorizations(uuid);
DROP FUNCTION public.cp_authorization_projection(uuid, text, date);
COMMIT;

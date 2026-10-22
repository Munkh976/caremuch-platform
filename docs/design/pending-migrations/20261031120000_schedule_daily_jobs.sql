-- FOR OWNER REVIEW — NOT PUSHED. Move to supabase/migrations/ after approval (owner decision 3, Oct 21).
-- Daily jobs on DEV with pg_cron:
--   1. cp-attachments cleanup (S4b answer 6): pending uploads older than 24 h are discarded (row + object) by the Edge
--      Function's `cleanup` action, which requires a service-role token.
--   2. cp_activate_due_plans (S17): a ready pending IPOS version whose (later) effective date has come becomes active.
--      Added here because it needs the same daily schedule; it is a plain SQL call (no token). Approve separately if
--      you prefer.
--
-- Secrets: the service-role key and the project URL are NOT in this file or in any log. They are stored once in Vault,
-- outside migrations (Supabase SQL editor or `supabase db query` with a file that is deleted right after):
--     SELECT vault.create_secret('<service role key>', 'cp_jobs_service_key');
--     SELECT vault.create_secret('https://<project-ref>.supabase.co', 'cp_jobs_project_url');
-- The job reads them from vault.decrypted_secrets at run time (only the postgres role can). If either is missing,
-- the job's HTTP call fails and is visible in cron.job_run_details / net._http_response; nothing else is affected.
-- Times are UTC: 07:15 UTC = 03:15 Eastern (cleanup); 05:05 UTC = 01:05 EDT / 00:05 EST (activation, after midnight in
-- the office time zone, which the function uses for "today").
-- Note: audit rows written by a scheduled activation have no actor (auth.uid() is empty in a cron session); cp_audit
-- records actor_type 'staff' as for every care-plan event.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule('cp-attachments-cleanup', '15 7 * * *', $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cp_jobs_project_url') || '/functions/v1/cp-attachments',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cp_jobs_service_key')),
    body := '{"action":"cleanup"}'::jsonb,
    timeout_milliseconds := 30000)
$job$);

SELECT cron.schedule('cp-activate-due-plans', '5 5 * * *', $job$ SELECT public.cp_activate_due_plans() $job$);

-- Rollback (docs/rollback/schedule_daily_jobs_rollback.sql once approved):
--   SELECT cron.unschedule('cp-attachments-cleanup'); SELECT cron.unschedule('cp-activate-due-plans');
--   (the extensions stay installed; DROP EXTENSION pg_net / pg_cron only if nothing else uses them)
--   DELETE FROM vault.secrets WHERE name IN ('cp_jobs_service_key', 'cp_jobs_project_url');

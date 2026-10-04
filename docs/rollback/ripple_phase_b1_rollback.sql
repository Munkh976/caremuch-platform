-- REFERENCE ONLY: not a migration, never run by the Supabase CLI. Proven on PGlite (exact post-Phase-A catalog restore).
-- Phase B1 rollback (reverse order, one transaction). Restores the post-Phase-A state exactly.
-- Data note: rows written through the B1 RPCs stay in the Phase A tables (plans, authorizations,
-- documents, training rows, typed certifications); only B1's own objects, columns and audit event
-- types are removed. Events of the 24 new types must be deleted (or archived) first, otherwise the
-- restored 18-value CHECK can't be re-added; that DELETE is step 0 and is part of the rollback.
BEGIN;

-- 0. audit rows of the new event types.
--    ON ANY NON-DEV PROJECT THESE EVENTS ARE ARCHIVED FIRST, NEVER JUST DELETED (owner rule): copy
--    them out (e.g. CREATE TABLE archive.events_ripple_b1 AS SELECT * FROM public.events WHERE
--    event_type IN (...)) and verify the archived count equals the count about to be deleted,
--    in this same transaction, before the DELETE below. On DEV, disposable data may be deleted.
DELETE FROM public.events WHERE event_type IN (
  'care_plan_module_enabled','template_draft_saved','template_published','instance_template_upgraded',
  'care_plan_created','care_plan_renewed','care_plan_updated','training_version_bumped','objective_measures_set',
  'authorization_created','client_document_saved','credential_entered','credential_overridden','inservice_signed',
  'training_recorded','training_record_overridden','progress_note_created','progress_note_submitted',
  'progress_note_returned','progress_note_reviewed','progress_note_voided','billing_batch_built',
  'billing_batch_approved','billing_batch_billed');

-- B1-07
DROP FUNCTION IF EXISTS public.override_training_record(uuid, date, public.training_method, text, text, date);
DROP FUNCTION IF EXISTS public.record_training_form(uuid, public.plan_document_type, date, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.record_inservice_form(uuid, text, uuid, date, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.enter_caregiver_credential(uuid, uuid, date, date, text);
ALTER TABLE public.plan_training_records DROP COLUMN IF EXISTS overridden_by, DROP COLUMN IF EXISTS overridden_at,
  DROP COLUMN IF EXISTS change_history;
DROP POLICY IF EXISTS "Agency staff read certifications in their agency" ON public.caregiver_certifications;
CREATE POLICY "Agency staff manage certifications in their agency" ON public.caregiver_certifications
FOR ALL TO authenticated
USING (is_agency_staff(auth.uid()) AND caregiver_agency_id(caregiver_id) = current_agency_id())
WITH CHECK (is_agency_staff(auth.uid()) AND caregiver_agency_id(caregiver_id) = current_agency_id());
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.caregiver_certifications TO authenticated;
DROP INDEX IF EXISTS public.caregiver_certifications_one_per_type;
ALTER TABLE public.caregiver_certifications DROP COLUMN IF EXISTS overridden_by, DROP COLUMN IF EXISTS overridden_at,
  DROP COLUMN IF EXISTS change_history;

-- B1-06, B1-05
DROP FUNCTION IF EXISTS public.upsert_client_document(uuid, text, public.client_document_status, text, date, date, text, jsonb);
DROP FUNCTION IF EXISTS public.create_service_authorization(uuid, text, text, numeric, date, date, integer, text, text, text,
  public.auth_period_type, numeric, text, jsonb);

-- B1-04
DROP FUNCTION IF EXISTS public.set_objective_measures(uuid, jsonb);
DROP FUNCTION IF EXISTS public.upsert_care_plan_goals(uuid, jsonb);
DROP FUNCTION IF EXISTS public.update_care_plan_fields(uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.renew_care_plan(uuid, public.care_plan_type, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.create_care_plan(uuid, public.care_plan_type, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.cp_goal_tree(uuid);
DROP FUNCTION IF EXISTS public.cp_validate_plan_header(jsonb, boolean);

-- B1-03
DROP FUNCTION IF EXISTS public.upgrade_instance_template(text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.publish_template_version(uuid);
DROP FUNCTION IF EXISTS public.save_template_draft(uuid, uuid, public.form_template_kind, text, text, boolean, jsonb, jsonb, jsonb);
DROP TRIGGER IF EXISTS trg_cp_guard_template_field ON public.form_template_fields;
DROP TRIGGER IF EXISTS trg_cp_guard_template_version ON public.form_template_versions;
DROP FUNCTION IF EXISTS public.cp_guard_template_field();
DROP FUNCTION IF EXISTS public.cp_guard_template_version();
DROP FUNCTION IF EXISTS public.cp_require_template_editor(uuid, uuid);
DROP FUNCTION IF EXISTS public.cp_check_constrained_edit(uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.cp_validate_template_definition(public.form_template_kind, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.cp_spine_columns(text);

-- B1-02
DROP FUNCTION IF EXISTS public.seed_office_care_plan_defaults(uuid);
DROP TABLE IF EXISTS public.cp_default_service_types, public.cp_default_credential_types;
DROP FUNCTION IF EXISTS public.cp_validate_field_values(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.cp_resolve_template(uuid, uuid, public.form_template_kind, text);
DROP FUNCTION IF EXISTS public.cp_template_snapshot(uuid);
DROP FUNCTION IF EXISTS public.cp_audit(uuid, uuid, text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.cp_require_scope(uuid, uuid, public.app_role[]);

-- B1-01: back to the 18 values (M-SEC-6)
ALTER TABLE public.events
  DROP CONSTRAINT events_event_type_check,
  ADD CONSTRAINT events_event_type_check CHECK (event_type = ANY (ARRAY[
  'caregiver_application_received', 'caregiver_approved', 'caregiver_rejected',
  'care_request_received', 'care_request_converted_to_client',
  'shift_created', 'shift_assigned', 'shift_filled', 'shift_completed', 'shift_cancelled', 'shift_no_show',
  'caregiver_pickup', 'assignment_released', 'rating_added',
  'time_entry_submitted', 'time_entry_approved', 'earnings_computed',
  'account_link_issued'
]::text[]));

-- On DEV only (migration history), same transaction:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20261007120000','20261007120100',
--   '20261007120200','20261007120300','20261007120400','20261007120500','20261007120600');
COMMIT;

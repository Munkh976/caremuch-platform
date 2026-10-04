-- REFERENCE ONLY: not a migration, never run by the Supabase CLI. Proven on PGlite (exact catalog restore).
-- Phase A rollback (reverse order, one transaction). Drops every object M-CP-01..07 created and
-- removes the columns they added to existing tables. Any rows in the new tables are lost: before
-- Phase B there are none except the M-CP-07 reference rows. Existing tables keep all their data.
BEGIN;

-- M-CP-07: its system measure_types rows go with the table below.

-- M-CP-05
DROP TRIGGER IF EXISTS trg_cp_refresh_units_upd ON public.progress_notes;
DROP TRIGGER IF EXISTS trg_cp_refresh_units_ins_del ON public.progress_notes;
DROP TRIGGER IF EXISTS trg_cp_derive_authorization_units ON public.service_authorizations;
DROP TRIGGER IF EXISTS trg_cp_derive_note_units ON public.progress_notes;
DROP FUNCTION IF EXISTS public.cp_refresh_authorization_units();
DROP FUNCTION IF EXISTS public.cp_derive_authorization_units();
DROP FUNCTION IF EXISTS public.cp_derive_progress_note_units();

-- M-CP-04
DROP TABLE IF EXISTS public.plan_training_records, public.plan_training_forms, public.plan_inservice_forms;
DROP TRIGGER IF EXISTS trg_cp_certification_type ON public.caregiver_certifications;
DROP FUNCTION IF EXISTS public.cp_check_certification_type();
ALTER TABLE public.caregiver_certifications
  DROP COLUMN IF EXISTS credential_type_id, DROP COLUMN IF EXISTS effective_date, DROP COLUMN IF EXISTS entered_by;
DROP TABLE IF EXISTS public.credential_types;
DROP TYPE IF EXISTS public.training_method, public.plan_document_type, public.credential_category;

-- M-CP-03b
DROP TABLE IF EXISTS public.client_documents;
DROP TYPE IF EXISTS public.client_document_status;

-- M-CP-03
DROP TRIGGER IF EXISTS trg_cp_order_service_authorization ON public.order_services;
DROP FUNCTION IF EXISTS public.cp_check_order_service_authorization();
ALTER TABLE public.order_services DROP COLUMN IF EXISTS service_authorization_id;
DROP TABLE IF EXISTS public.progress_note_entries, public.progress_notes, public.billing_batches,
  public.service_authorizations, public.office_service_types;
DROP FUNCTION IF EXISTS public.cp_progress_note_in_scope(uuid);
DROP TYPE IF EXISTS public.progress_note_kind, public.progress_note_status, public.billing_batch_status,
  public.auth_source_type, public.auth_period_type;

-- M-CP-02
DROP TRIGGER IF EXISTS trg_cp_client_order_care_plan ON public.client_orders;
DROP FUNCTION IF EXISTS public.cp_check_client_order_care_plan();
ALTER TABLE public.client_orders DROP COLUMN IF EXISTS care_plan_id;      -- drops client_orders_care_plan_idx too
DROP TABLE IF EXISTS public.care_plan_reviews, public.objective_measures, public.care_plan_external_services,
  public.care_plan_natural_supports, public.care_plan_dsm_recommendations, public.care_plan_objective_needs,
  public.care_plan_treatment_needs, public.care_plan_needs, public.care_plan_attendees, public.care_plan_objectives,
  public.care_plan_goals, public.care_plans, public.measure_types;
DROP FUNCTION IF EXISTS public.cp_care_plan_objective_in_scope(uuid);
DROP FUNCTION IF EXISTS public.cp_care_plan_goal_in_scope(uuid);
DROP FUNCTION IF EXISTS public.cp_care_plan_in_scope(uuid);
DROP TYPE IF EXISTS public.objective_responsible_party, public.care_plan_type, public.care_plan_status, public.measure_kind;

-- M-CP-01
DROP TABLE IF EXISTS public.form_template_fields, public.form_template_versions, public.form_templates;
DROP FUNCTION IF EXISTS public.cp_form_template_version_readable(uuid);
DROP FUNCTION IF EXISTS public.cp_form_template_readable(uuid);
DROP FUNCTION IF EXISTS public.cp_check_row_scope();
DROP FUNCTION IF EXISTS public.cp_staff_in_agency(uuid, public.app_role[]);
DROP FUNCTION IF EXISTS public.cp_staff_in_scope(uuid, uuid, public.app_role[]);
DROP TYPE IF EXISTS public.form_template_version_status, public.form_field_storage, public.form_template_kind;
DROP TRIGGER IF EXISTS trg_guard_virtual_office_flags ON public.virtual_office;
DROP FUNCTION IF EXISTS public.guard_virtual_office_flags();
ALTER TABLE public.virtual_office
  DROP COLUMN IF EXISTS compliance_enforcement_enabled,
  DROP COLUMN IF EXISTS care_plan_module_enabled,
  DROP COLUMN IF EXISTS billing_week_start;

-- On DEV only (migration history), in the same transaction:
-- DELETE FROM supabase_migrations.schema_migrations
--  WHERE version IN ('20261006120000','20261006120100','20261006120200','20261006120300',
--                    '20261006120400','20261006120500','20261006120700');
COMMIT;

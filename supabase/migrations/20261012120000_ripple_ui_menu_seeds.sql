-- Ripple UI S1 — menu entries for the care-plan module (UI plan §3.9; owner decisions Q3, Q4).
-- Data only: no schema, no functions, no policy change.
--
--   client_care_plans  "Client Care Plans (IPOS)" (Q4: the existing "Care Plan" item is not relabelled)
--   weekly_billing     "Weekly Billing"
--   form_templates     "Form Templates"
-- Roles: manager and agency_admin only (clinical tier). Not system_admin (not in the clinical tier),
-- not scheduler / hr_staff, never caregiver / client.
--
-- role_permissions is global per role, so these rows alone would show the items to every manager of
-- every agency. The app renders them only when the user can see an office with
-- virtual_office.care_plan_module_enabled (useComplianceOffices, Q3), and every route is wrapped in
-- RequireRole + RequireModuleOffice (rule 15). Enforcement stays in RLS and the RPCs.
-- can_create/can_update mirror what these roles can do through the module RPCs; nothing is deleted
-- from these screens.

INSERT INTO public.system_modules (module_code, module_name, description, category, is_active)
VALUES
  ('client_care_plans', 'Client Care Plans (IPOS)', 'Ripple care-plan module: plans of service, goals, authorizations, onboarding and progress notes', 'operations', true),
  ('weekly_billing', 'Weekly Billing', 'Ripple care-plan module: weekly review and billing of progress notes', 'operations', true),
  ('form_templates', 'Form Templates', 'Ripple care-plan module: form shells (IPOS, notes, intake, authorization) and the measure library', 'configuration', true)
ON CONFLICT (module_code) DO NOTHING;

INSERT INTO public.role_permissions (role_code, module_code, can_create, can_read, can_update, can_delete)
VALUES
  ('agency_admin', 'client_care_plans', true, true, true, false),
  ('manager', 'client_care_plans', true, true, true, false),
  ('agency_admin', 'weekly_billing', true, true, true, false),
  ('manager', 'weekly_billing', true, true, true, false),
  ('agency_admin', 'form_templates', true, true, true, false),
  ('manager', 'form_templates', true, true, true, false)
ON CONFLICT DO NOTHING;

-- Rollback:
--   DELETE FROM public.role_permissions WHERE module_code IN ('client_care_plans', 'weekly_billing', 'form_templates');
--   DELETE FROM public.system_modules WHERE module_code IN ('client_care_plans', 'weekly_billing', 'form_templates');

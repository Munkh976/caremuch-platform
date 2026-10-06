-- Ripple UI S8 — menu entry (data only: no schema, function or policy change).
-- "Notes to Review" under Operations, clinical tier only; the app shows it only where
-- an office has the module on (AppLayout RIPPLE_MODULES) and the route is RequireRole + RequireModuleOffice.
INSERT INTO public.system_modules (module_code, module_name, description, category, is_active)
VALUES ('progress_notes_review', 'Notes to Review', 'Ripple care-plan module: review, return and print caregiver progress notes', 'operations', true)
ON CONFLICT (module_code) DO NOTHING;
INSERT INTO public.role_permissions (role_code, module_code, can_create, can_read, can_update, can_delete)
VALUES ('agency_admin', 'progress_notes_review', false, true, true, false),
       ('manager', 'progress_notes_review', false, true, true, false)
ON CONFLICT DO NOTHING;

-- Rollback:
--   DELETE FROM public.role_permissions WHERE module_code = 'progress_notes_review';
--   DELETE FROM public.system_modules WHERE module_code = 'progress_notes_review';

-- M-SEC-4 — caregiver/client sidebars stop linking to staff pages; clients get their own dashboard
-- entry (docs/security-fixes-2026-10-plan.md §1.4, §7 Q4, §14). DRAFT FOR REVIEW. Not pushed.
--
-- Live state (read-only check, 2026-10-04):
--   caregiver: available_shifts, caregiver_dashboard, caregiver_settings, caregiver_time_off,
--              dashboard (core; no route for this role, hidden), schedule (operations -> staff /schedule)
--   client:    dashboard (core, hidden), orders (operations -> staff /order-management, "Care Plan"),
--              schedule (operations -> staff /schedule)
--   system_modules has NO 'client_dashboard' row, although usePermissions.moduleRouteMap and
--   AppLayout.iconMap already know it — so a client's sidebar shows only the two staff links.
--
-- Change (data only, no schema, no functions):
--   1. caregiver.schedule, client.schedule, client.orders -> all CRUD flags false (rows kept, so the
--      change is one UPDATE to revert). The routes themselves are staff-only via RequireRole, and
--      clients book through the Client Dashboard "Care Plans" tab (owner, Q4).
--   2. Seed system_modules 'client_dashboard' (category 'client') and give the client role read on it.
-- No hasPermission() call reads schedule/orders for these roles (only caregiver_approvals and
-- knowledge_base are checked in code), so nothing else changes behaviour.

UPDATE public.role_permissions
SET can_read = false, can_create = false, can_update = false, can_delete = false
WHERE (role_code = 'caregiver' AND module_code = 'schedule')
   OR (role_code = 'client'    AND module_code IN ('schedule', 'orders'));

INSERT INTO public.system_modules (module_code, module_name, description, category, is_active)
VALUES ('client_dashboard', 'My Dashboard', 'Client portal: care plans, schedule, care circle and care team', 'client', true)
ON CONFLICT (module_code) DO NOTHING;

INSERT INTO public.role_permissions (role_code, module_code, can_read, can_create, can_update, can_delete)
VALUES ('client', 'client_dashboard', true, false, false, false)
ON CONFLICT DO NOTHING;

-- Rollback (plan §14.4):
--   UPDATE public.role_permissions SET can_read = true WHERE (role_code='caregiver' AND module_code='schedule')
--     OR (role_code='client' AND module_code='schedule');
--   UPDATE public.role_permissions SET can_read = true, can_create = true WHERE role_code='client' AND module_code='orders';
--   DELETE FROM public.role_permissions WHERE role_code='client' AND module_code='client_dashboard';
--   DELETE FROM public.system_modules WHERE module_code='client_dashboard';

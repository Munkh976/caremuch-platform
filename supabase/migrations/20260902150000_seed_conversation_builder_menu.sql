-- Seeds the Conversation Builder sidebar menu entry (system_modules + role_permissions).
-- The feature itself -- the /flow-builder route, the FlowBuilder component, and the
-- conversation_flows/flow_nodes/flow_options/conversation_sessions/conversation_answers
-- schema -- was never touched; confirmed intact and structurally sound (all FKs correct
-- CASCADE/SET NULL, no orphan risk, active draft/publish development as recently as
-- 20260729042647). Only these two rows were missing, confirmed absent from every
-- migration in this repo's history and from the live system_modules/role_permissions
-- tables (checked 2026-09-02). This is the same class of gap as client_inquiries would
-- have had if 20260729150713 hadn't seeded it -- src/hooks/usePermissions.ts already has
-- conversation_builder mapped to /flow-builder in code; the menu is entirely data-driven
-- from these two tables, so it silently doesn't render without them.
--
-- This restores a menu entry lost in the project switch: it originally lived in the old
-- Lovable dashboard (added there directly, not via a tracked migration), so it never
-- carried over when the project moved off that Supabase project ref. Seeding it as a
-- migration here -- not re-adding it via the dashboard -- means it now survives any
-- future environment move.

INSERT INTO public.system_modules (module_code, module_name, description, category, is_active)
VALUES ('conversation_builder', 'Conversation Builder', 'Build and publish the caregiver screening and family intake conversation flows', 'configuration', true)
ON CONFLICT (module_code) DO NOTHING;

-- Read access matches client_inquiries's exact role set (system_admin, agency_admin,
-- manager, hr_staff), per instruction.
--
-- Write access is NOT a literal copy of client_inquiries's can_update=true-for-all-four.
-- The underlying RLS on flow_nodes/flow_options ("Admins manage nodes"/"Admins manage
-- options", from 20260728214539) and the create_flow_draft()/publish_flow_draft()/
-- discard_flow_draft() RPCs (20260729042647) all gate on
-- has_role(...,'system_admin') OR has_role(...,'agency_admin') only -- manager and
-- hr_staff are not authorized to edit flows at the data layer regardless of what this
-- table says. Granting them can_update=true here would show edit controls RLS silently
-- rejects, which is worse than not showing them. So: full read+write for
-- system_admin/agency_admin (matching what they can actually do), read-only for
-- manager/hr_staff (matching what they can actually do).
INSERT INTO public.role_permissions (role_code, module_code, can_create, can_read, can_update, can_delete)
VALUES
  ('system_admin', 'conversation_builder', true, true, true, true),
  ('agency_admin', 'conversation_builder', true, true, true, true),
  ('manager', 'conversation_builder', false, true, false, false),
  ('hr_staff', 'conversation_builder', false, true, false, false)
ON CONFLICT DO NOTHING;

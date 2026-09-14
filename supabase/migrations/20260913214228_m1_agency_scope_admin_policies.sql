-- M1 security gate: close confirmed cross-tenant admin-policy gaps.
-- See docs/m1-security-gate-plan.md for the full verification pass and rationale.
-- Every fix here is additive/replacing an existing unscoped "any admin" policy with
-- a system_admin-unrestricted + agency_admin-own-agency-only pair, matching the
-- pattern already used by shifts/caregivers/clients/families/etc.
--
-- Explicitly NOT touched here (see plan doc): conversation_flows/flow_nodes/
-- flow_options (Phase M2 - needs a product decision), time_off_requests and
-- virtual_office (already confirmed correctly scoped live), and the global-catalog
-- write governance on care_types/care_service_categories/certifications (flagged,
-- not a cross-tenant leak, deliberately out of M1 scope).

-- =============================================================================
-- 1. user_roles (highest priority - privilege escalation vector)
-- =============================================================================
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;

CREATE POLICY "System admins manage all roles"
ON public.user_roles FOR ALL TO authenticated
USING (has_role(auth.uid(), 'system_admin'))
WITH CHECK (has_role(auth.uid(), 'system_admin'));

-- Hardened: agency_admin may only manage roles for a user who is genuinely a member
-- of their own agency (checked via profiles), not merely a row whose agency_id
-- column happens to say so.
CREATE POLICY "Agency admins manage roles in their own agency"
ON public.user_roles FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'agency_admin')
  AND agency_id = current_agency_id()
  AND agency_id = (SELECT p.agency_id FROM public.profiles p WHERE p.id = user_roles.user_id)
)
WITH CHECK (
  has_role(auth.uid(), 'agency_admin')
  AND agency_id = current_agency_id()
  AND agency_id = (SELECT p.agency_id FROM public.profiles p WHERE p.id = user_roles.user_id)
);

-- =============================================================================
-- 2. profiles
-- =============================================================================
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

CREATE POLICY "System admins view all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'system_admin'));

CREATE POLICY "Agency admins view their agency profiles"
ON public.profiles FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'agency_admin') AND agency_id = current_agency_id());

-- =============================================================================
-- 3. agency
-- =============================================================================
DROP POLICY IF EXISTS "Admins can manage agencies" ON public.agency;

CREATE POLICY "System admins manage all agencies"
ON public.agency FOR ALL TO authenticated
USING (has_role(auth.uid(), 'system_admin'))
WITH CHECK (has_role(auth.uid(), 'system_admin'));

CREATE POLICY "Agency admins manage their own agency"
ON public.agency FOR ALL TO authenticated
USING (has_role(auth.uid(), 'agency_admin') AND id = current_agency_id())
WITH CHECK (has_role(auth.uid(), 'agency_admin') AND id = current_agency_id());

-- =============================================================================
-- 4. conversation_sessions (both read and write side had the gap)
-- =============================================================================
DROP POLICY IF EXISTS "Staff can read agency sessions" ON public.conversation_sessions;
CREATE POLICY "Staff can read agency sessions"
ON public.conversation_sessions FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id())
  OR user_id = auth.uid()
);

DROP POLICY IF EXISTS "Staff can update session follow up" ON public.conversation_sessions;
CREATE POLICY "Staff can update session follow up"
ON public.conversation_sessions FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()))
WITH CHECK (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()));

-- =============================================================================
-- 5. conversation_answers (no agency_id column - scope via session_id join)
-- =============================================================================
DROP POLICY IF EXISTS "Staff can read answers" ON public.conversation_answers;
CREATE POLICY "Staff can read answers"
ON public.conversation_answers FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND EXISTS (
        SELECT 1 FROM public.conversation_sessions s
        WHERE s.id = conversation_answers.session_id
          AND s.agency_id = current_agency_id()
      ))
);

-- =============================================================================
-- 6. pending_notifications (all three CRUD policies were unscoped)
-- =============================================================================
DROP POLICY IF EXISTS "Staff can view pending notifications" ON public.pending_notifications;
CREATE POLICY "Staff can view pending notifications"
ON public.pending_notifications FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()));

DROP POLICY IF EXISTS "Staff can create pending notifications" ON public.pending_notifications;
CREATE POLICY "Staff can create pending notifications"
ON public.pending_notifications FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()));

DROP POLICY IF EXISTS "Staff can update pending notifications" ON public.pending_notifications;
CREATE POLICY "Staff can update pending notifications"
ON public.pending_notifications FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()))
WITH CHECK (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()));

-- =============================================================================
-- 7. caregiver_registrations (drop the agency_id IS NULL cross-tenant branch;
--    legacy unattributed rows become system_admin-only, consistent with #4/#5)
-- =============================================================================
DROP POLICY IF EXISTS "Staff can view caregiver registrations" ON public.caregiver_registrations;
CREATE POLICY "Staff can view caregiver registrations"
ON public.caregiver_registrations FOR SELECT TO authenticated
USING (
  (has_role(auth.uid(),'system_admin') OR has_role(auth.uid(),'agency_admin')
   OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'hr_staff'))
  AND (has_role(auth.uid(),'system_admin')
       OR agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid()))
);

DROP POLICY IF EXISTS "Staff can update caregiver registrations" ON public.caregiver_registrations;
CREATE POLICY "Staff can update caregiver registrations"
ON public.caregiver_registrations FOR UPDATE TO authenticated
USING (
  (has_role(auth.uid(),'system_admin') OR has_role(auth.uid(),'agency_admin')
   OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'hr_staff'))
  AND (has_role(auth.uid(),'system_admin')
       OR agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid()))
)
WITH CHECK (
  (has_role(auth.uid(),'system_admin') OR has_role(auth.uid(),'agency_admin')
   OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'hr_staff'))
  AND (has_role(auth.uid(),'system_admin')
       OR agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid()))
);

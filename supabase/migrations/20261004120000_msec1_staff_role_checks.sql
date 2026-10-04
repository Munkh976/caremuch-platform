-- M-SEC-1 — add the missing staff-role check to "same agency => allowed" policies
-- (docs/security-fixes-2026-10-plan.md §1.3, §1.4, §6.2, §6.3, §11). DRAFT FOR REVIEW. Not pushed.
--
-- Problem (verified live, E1): these policies admit ANY member of the agency — current_agency_id()
-- and profiles.agency_id are set for caregivers and clients too — so a caregiver or client could
-- read (and on several tables write) other people's data: every caregiver's row, skills and
-- availability, every client's care needs, every family, every family inquiry (care_requests),
-- every rating, every trade.
--
-- Also (owner decision Q7, 2026-10-04): caregiver_skills becomes staff-managed — see section 2.
--
-- Rule: MINIMAL change. Each agency-membership predicate gets `is_agency_staff(auth.uid()) AND`
-- prepended (and an explicit identical WITH CHECK where the old policy relied on USING for
-- INSERT). Tenant and office clauses are kept exactly as they are. Every self-policy is kept
-- unchanged ("Caregivers can ... their own ...", "Clients can manage their own care needs",
-- client/family own branches). Two narrow self-read policies are ADDED so existing caregiver
-- screens keep working (own ratings for the Today rating line; own trades for "My trade requests").
-- The client-side caregiver/availability read policies are NOT touched here — M-SEC-5 replaces them.
--
-- No functions are created or changed (CLAUDE.md #13/#14 not triggered). M-SEC-2's triggers stay.
-- Every DROP below is re-created in the same migration with the same name, unless noted.

-- ---------------------------------------------------------------------------------------------
-- 1. caregivers — staff manage caregivers in scope (was: any agency member, FOR ALL)
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agency users can manage their caregivers" ON public.caregivers;
CREATE POLICY "Agency users can manage their caregivers"
ON public.caregivers FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid())
  AND agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
  AND ((NOT is_office_restricted(auth.uid())) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (
  is_agency_staff(auth.uid())
  AND agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
  AND ((NOT is_office_restricted(auth.uid())) OR virtual_office_id = current_virtual_office_id())
);
-- kept: "Caregivers can view their own profile", "Caregivers can update their own profile",
--       "Clients view caregivers (agency scope) 20251106" (-> M-SEC-5)

-- ---------------------------------------------------------------------------------------------
-- 2. caregiver_skills — staff manage skills of caregivers in their agency
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agency users can manage caregiver skills" ON public.caregiver_skills;
CREATE POLICY "Agency users can manage caregiver skills"
ON public.caregiver_skills FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid())
  AND EXISTS (SELECT 1 FROM public.caregivers c JOIN public.profiles p ON p.agency_id = c.agency_id
              WHERE c.id = caregiver_skills.caregiver_id AND p.id = auth.uid())
)
WITH CHECK (
  is_agency_staff(auth.uid())
  AND EXISTS (SELECT 1 FROM public.caregivers c JOIN public.profiles p ON p.agency_id = c.agency_id
              WHERE c.id = caregiver_skills.caregiver_id AND p.id = auth.uid())
);
-- Q7 (owner decision 2026-10-04): caregiver skills are STAFF-MANAGED. The caregiver keeps SELECT
-- on its own rows only; INSERT/UPDATE/DELETE come only from the staff policy above (any
-- is_agency_staff role in the same agency: system_admin, agency_admin, manager, scheduler,
-- hr_staff — scheduler included because /caregivers' Edit dialog, which rewrites skills, is open to
-- every staff role today). Service-role writers (approve-caregiver-registration, import-data) are
-- unaffected. The caregiver profile UI is made read-only in the same change.
DROP POLICY IF EXISTS "Caregivers can manage their own skills" ON public.caregiver_skills;
CREATE POLICY "Caregivers view their own skills"
ON public.caregiver_skills FOR SELECT TO authenticated
USING (caregiver_id IN (SELECT my_caregiver_ids()));

-- ---------------------------------------------------------------------------------------------
-- 3. caregiver_availability — staff manage availability of caregivers in their agency
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agency users can manage caregiver availability" ON public.caregiver_availability;
CREATE POLICY "Agency users can manage caregiver availability"
ON public.caregiver_availability FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid())
  AND EXISTS (SELECT 1 FROM public.caregivers c JOIN public.profiles p ON p.agency_id = c.agency_id
              WHERE c.id = caregiver_availability.caregiver_id AND p.id = auth.uid())
)
WITH CHECK (
  is_agency_staff(auth.uid())
  AND EXISTS (SELECT 1 FROM public.caregivers c JOIN public.profiles p ON p.agency_id = c.agency_id
              WHERE c.id = caregiver_availability.caregiver_id AND p.id = auth.uid())
);
-- kept: "Caregivers can manage their own availability",
--       "Clients view caregiver availability (agency scope) 20251106" (-> M-SEC-5)

-- ---------------------------------------------------------------------------------------------
-- 4. client_care_needs — staff manage care needs of clients in their agency
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agency users can manage client care needs" ON public.client_care_needs;
CREATE POLICY "Agency users can manage client care needs"
ON public.client_care_needs FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid())
  AND client_id IN (SELECT cl.id FROM public.clients cl
                    WHERE cl.agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid()))
)
WITH CHECK (
  is_agency_staff(auth.uid())
  AND client_id IN (SELECT cl.id FROM public.clients cl
                    WHERE cl.agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid()))
);
-- kept: "Clients can manage their own care needs"

-- ---------------------------------------------------------------------------------------------
-- 5. families — SELECT agency branch gets the staff check (system_admin + own-family branches kept)
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "families_select_agency_or_own" ON public.families;
CREATE POLICY "families_select_agency_or_own"
ON public.families FOR SELECT TO authenticated
USING (
  (is_agency_staff(auth.uid())
   AND agency_id = current_agency_id()
   AND ((NOT is_office_restricted(auth.uid())) OR virtual_office_id = current_virtual_office_id()))
  OR has_role(auth.uid(), 'system_admin'::app_role)
  OR id IN (SELECT c.family_id FROM public.clients c
            WHERE c.id IN (SELECT my_client_ids()) AND c.family_id IS NOT NULL)
);
-- INSERT/UPDATE/DELETE policies already require is_agency_staff — unchanged.

-- ---------------------------------------------------------------------------------------------
-- 6. care_requests — SELECT agency branch gets the staff check (client/family own branches kept)
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "care_requests_select" ON public.care_requests;
CREATE POLICY "care_requests_select"
ON public.care_requests FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin'::app_role)
  OR (is_agency_staff(auth.uid())
      AND agency_id = current_agency_id()
      AND ((NOT is_office_restricted(auth.uid())) OR virtual_office_id = current_virtual_office_id()))
  OR client_id IN (SELECT my_client_ids())
  OR family_id IN (SELECT c.family_id FROM public.clients c
                   WHERE c.id IN (SELECT my_client_ids()) AND c.family_id IS NOT NULL)
);
-- INSERT/UPDATE/DELETE policies already require is_agency_staff — unchanged.

-- ---------------------------------------------------------------------------------------------
-- 7. shift_ratings — staff read their agency's ratings; caregivers read ratings about themselves
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agency staff can view ratings in their agency" ON public.shift_ratings;
CREATE POLICY "Agency staff can view ratings in their agency"
ON public.shift_ratings FOR SELECT TO authenticated
USING (
  is_agency_staff(auth.uid())
  AND agency_id = (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
);
CREATE POLICY "Caregivers view ratings about themselves"            -- NEW (keeps the Today rating line,
ON public.shift_ratings FOR SELECT TO authenticated                  -- caregiver_performance is security_invoker)
USING (caregiver_id IN (SELECT my_caregiver_ids()));
-- kept: "Agency staff can manage ratings in their agency" (already role-checked),
--       "Clients can rate their own shifts" (INSERT)

-- ---------------------------------------------------------------------------------------------
-- 8. shift_trades — staff (agency-wide, as today; office scoping stays deferred per known-issues)
--    manage trades; caregivers read only trades they are party to and may create only their OWN
--    outgoing trade. Caregivers never UPDATE (pickups go through caregiver_pickup_trade_shift(),
--    SECURITY DEFINER).
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agency staff can view shift trades" ON public.shift_trades;
CREATE POLICY "Agency staff can view shift trades"
ON public.shift_trades FOR SELECT TO authenticated
USING (
  is_agency_staff(auth.uid())
  AND EXISTS (SELECT 1 FROM public.caregivers c JOIN public.profiles p ON p.id = auth.uid()
              WHERE c.id = shift_trades.original_caregiver_id AND c.agency_id = p.agency_id)
);
CREATE POLICY "Caregivers read their own trades"                    -- NEW ("My trade requests")
ON public.shift_trades FOR SELECT TO authenticated
USING (original_caregiver_id IN (SELECT my_caregiver_ids())
       OR new_caregiver_id IN (SELECT my_caregiver_ids()));

DROP POLICY IF EXISTS "Agency staff can manage shift trades" ON public.shift_trades;
CREATE POLICY "Agency staff can manage shift trades"
ON public.shift_trades FOR UPDATE TO authenticated
USING (
  is_agency_staff(auth.uid())
  AND EXISTS (SELECT 1 FROM public.caregivers c JOIN public.profiles p ON p.id = auth.uid()
              WHERE c.id = shift_trades.original_caregiver_id AND c.agency_id = p.agency_id)
)
WITH CHECK (
  is_agency_staff(auth.uid())
  AND EXISTS (SELECT 1 FROM public.caregivers c JOIN public.profiles p ON p.id = auth.uid()
              WHERE c.id = shift_trades.original_caregiver_id AND c.agency_id = p.agency_id)
);

DROP POLICY IF EXISTS "Agency staff and caregivers can create shift trades" ON public.shift_trades;
CREATE POLICY "Agency staff and caregivers can create shift trades"
ON public.shift_trades FOR INSERT TO authenticated
WITH CHECK (
  (is_agency_staff(auth.uid())
   AND EXISTS (SELECT 1 FROM public.caregivers c JOIN public.profiles p ON p.id = auth.uid()
               WHERE c.id = shift_trades.original_caregiver_id AND c.agency_id = p.agency_id))
  OR original_caregiver_id IN (SELECT my_caregiver_ids())
);

-- ---------------------------------------------------------------------------------------------
-- Post-push verification (read-only):
--   SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('caregivers','caregiver_skills','caregiver_availability',
--      'client_care_needs','families','care_requests','shift_ratings','shift_trades') ORDER BY 1,2;
--   -> every agency-membership branch contains is_agency_staff(auth.uid()); self-policies unchanged.
-- ---------------------------------------------------------------------------------------------

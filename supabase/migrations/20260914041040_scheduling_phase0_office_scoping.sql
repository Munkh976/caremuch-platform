-- Smart Scheduling Phase 0: office-scope the operational scheduling tables.
-- See docs/scheduling-phase0-plan.md for the full verification pass and rationale.
-- Reuses M-Office's fail-closed mechanism verbatim (profiles.office_restricted +
-- is_office_restricted()/current_virtual_office_id(), already live) -- no new
-- scoping mechanism invented here, only the additive-AND RLS clause extended to
-- these five tables, matching the pattern already applied to caregivers/clients/
-- families/care_requests/care_request_time_windows/caregiver_registrations/
-- virtual_office in M-Office.
--
-- No RPC signatures change in this migration -- assign_caregiver_to_shift(),
-- check_assignment_eligibility(), caregiver_pick_up_shift(), and the derived-
-- caregiver trigger functions are all untouched, so the CREATE OR REPLACE
-- stale-overload footgun (known-issues.md) does not apply here.

-- =============================================================================
-- 1. shifts -- new column FIRST (the helper below is LANGUAGE sql, which validates
--    column references at CREATE time, unlike plpgsql -- it must exist before the
--    helper is defined, not just before it's ever called). Backfill + RLS follow
--    the helper so the ordering below reads top-to-bottom as originally designed.
-- =============================================================================
ALTER TABLE public.shifts
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL;

-- =============================================================================
-- 2. shift_assignments office helper (mirrors shift_assignment_agency_id() exactly
--    -- no new column on shift_assignments itself, derived via shift_id, matching
--    its existing agency-via-shift pattern). Placed here, right after shifts gains
--    its column, so the LANGUAGE sql body below resolves cleanly.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.shift_assignment_virtual_office_id(_shift_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT virtual_office_id FROM public.shifts WHERE id = _shift_id
$$;

-- =============================================================================
-- 3. shifts -- backfill from client_id -> clients.virtual_office_id
--    (M-Office's confirmed client-side rule), then RLS.
-- =============================================================================
UPDATE public.shifts s
SET virtual_office_id = c.virtual_office_id
FROM public.clients c
WHERE s.client_id = c.id AND s.virtual_office_id IS NULL;

DROP POLICY IF EXISTS "Agency staff manage shifts in their agency" ON public.shifts;
CREATE POLICY "Agency staff manage shifts in their agency"
ON public.shifts FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (
  is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);

-- =============================================================================
-- 3. client_orders -- new column, same client-side backfill, then RLS.
--    Runs AFTER shifts' backfill above, but does not depend on it -- both derive
--    independently from clients.virtual_office_id (already correct since M-Office).
-- =============================================================================
ALTER TABLE public.client_orders
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL;

UPDATE public.client_orders o
SET virtual_office_id = c.virtual_office_id
FROM public.clients c
WHERE o.client_id = c.id AND o.virtual_office_id IS NULL;

DROP POLICY IF EXISTS "Agency staff manage care plans in their agency" ON public.client_orders;
CREATE POLICY "Agency staff manage care plans in their agency"
ON public.client_orders FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (
  is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);

-- =============================================================================
-- 4. shift_assignments RLS -- helper-based (§1), no column, no backfill needed
--    (always derived live from the shift it belongs to).
-- =============================================================================
DROP POLICY IF EXISTS "Agency staff read assignments in their agency" ON public.shift_assignments;
CREATE POLICY "Agency staff read assignments in their agency"
ON public.shift_assignments FOR SELECT TO authenticated
USING (
  is_agency_staff(auth.uid()) AND shift_assignment_agency_id(shift_id) = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR shift_assignment_virtual_office_id(shift_id) = current_virtual_office_id())
);

DROP POLICY IF EXISTS "Agency staff update operational fields" ON public.shift_assignments;
CREATE POLICY "Agency staff update operational fields"
ON public.shift_assignments FOR UPDATE TO authenticated
USING (
  is_agency_staff(auth.uid()) AND shift_assignment_agency_id(shift_id) = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR shift_assignment_virtual_office_id(shift_id) = current_virtual_office_id())
)
WITH CHECK (
  is_agency_staff(auth.uid()) AND shift_assignment_agency_id(shift_id) = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR shift_assignment_virtual_office_id(shift_id) = current_virtual_office_id())
);

-- =============================================================================
-- 5. time_entries -- new column, backfilled from shift_id -> shifts.virtual_office_id
--    (NOT caregiver_id -- see plan doc §2 for reasoning). Runs AFTER shifts' own
--    backfill (step 2) since it depends on shifts.virtual_office_id being populated
--    first -- this statement ordering matters and is deliberate.
-- =============================================================================
ALTER TABLE public.time_entries
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL;

UPDATE public.time_entries te
SET virtual_office_id = s.virtual_office_id
FROM public.shifts s
WHERE te.shift_id = s.id AND te.virtual_office_id IS NULL;

DROP POLICY IF EXISTS "time_entries_staff_manage" ON public.time_entries;
CREATE POLICY "time_entries_staff_manage"
ON public.time_entries FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid()) AND (agency_id = current_agency_id() OR has_role(auth.uid(), 'system_admin'::app_role))
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (
  is_agency_staff(auth.uid()) AND (agency_id = current_agency_id() OR has_role(auth.uid(), 'system_admin'::app_role))
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);

-- =============================================================================
-- 6. time_off_requests -- new column, backfilled from caregiver_id (caregiver-
--    centric table, no shift/client involved -- see plan doc §2). Office-scoped
--    per the approved flagged decision (Rule H needs this in Phase 1B).
-- =============================================================================
ALTER TABLE public.time_off_requests
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL;

UPDATE public.time_off_requests t
SET virtual_office_id = cg.virtual_office_id
FROM public.caregivers cg
WHERE t.caregiver_id = cg.id AND t.virtual_office_id IS NULL;

DROP POLICY IF EXISTS "Agency managers decide time off in their agency" ON public.time_off_requests;
CREATE POLICY "Agency managers decide time off in their agency"
ON public.time_off_requests FOR UPDATE TO authenticated
USING (
  (has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'agency_admin'::app_role) OR has_role(auth.uid(), 'system_admin'::app_role))
  AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (
  (has_role(auth.uid(), 'manager'::app_role) OR has_role(auth.uid(), 'agency_admin'::app_role) OR has_role(auth.uid(), 'system_admin'::app_role))
  AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);

DROP POLICY IF EXISTS "Agency staff view time off in their agency" ON public.time_off_requests;
CREATE POLICY "Agency staff view time off in their agency"
ON public.time_off_requests FOR SELECT TO authenticated
USING (
  is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);

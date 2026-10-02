-- M-SEC-2 — scope and self-update guards (docs/security-fixes-2026-10-plan.md §6.1, §7 A1/A2)
-- DRAFT FOR REVIEW. Not pushed.
--
-- Closes, in order of severity:
--   (1) profiles: any signed-in user could change their own agency_id / virtual_office_id /
--       office_restricted ("Users can update their own profile" has no WITH CHECK and no guard).
--       current_agency_id() reads profiles.agency_id and is_agency_staff() is role-only, so this
--       let any staff user become staff of another agency (undoing M1), and an office-restricted
--       manager lift their own restriction (undoing M-Office).
--   (2) user_roles: "Agency admins manage roles in their own agency" never restricted `role`, so an
--       agency_admin could INSERT/UPDATE a 'system_admin' row for themselves or anyone in their agency.
--   (3) caregivers: a caregiver could change their own pay rate, status, office, agency, etc.
--       ("Caregivers can update their own profile" has no column guard).
--   (4) clients: same class as (3) for the client's own row (agency_id, user_id,
--       preferred_caregiver_id, medical fields, ...). Approved by the owner 2026-10-02.
--
-- Design:
--   * Policies stay as they are except user_roles (2). Column rules live in BEFORE UPDATE triggers,
--     because RLS cannot compare OLD vs NEW.
--   * Allowlist, not freeze-list: a non-admin self-update may change ONLY the listed personal
--     columns; every other column (including any column added later) is frozen by default.
--   * auth.uid() IS NULL (service_role: Edge Functions, SQL editor, migrations) is never blocked,
--     so enable-*-login / approve-caregiver-registration / create-user keep working.
--   * The three UPDATE guards are SECURITY INVOKER (they only call the existing SECURITY DEFINER
--     helpers has_role / is_agency_staff / current_agency_id). The INSERT/DELETE guard (5) is
--     SECURITY DEFINER (see its note). EXECUTE is revoked from PUBLIC, anon and authenticated on all
--     four: trigger functions are not privilege-checked when a trigger fires, only at CREATE TRIGGER.
--   * No existing RPC signature changes (CLAUDE.md #13 not triggered). CLAUDE.md #14 applied
--     (REVOKE ALL ... FROM PUBLIC, anon; no GRANT at all); verified with aclexplode after push.

-- ---------------------------------------------------------------------------------------------
-- (2) user_roles: an agency_admin can never create, modify or delete a system_admin row.
-- Same name and predicate as 20260913214228 (M1), plus role <> 'system_admin' on both sides.
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agency admins manage roles in their own agency" ON public.user_roles;
CREATE POLICY "Agency admins manage roles in their own agency"
ON public.user_roles FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'agency_admin'::app_role)
  AND role <> 'system_admin'::app_role
  AND agency_id = current_agency_id()
  AND agency_id = (SELECT p.agency_id FROM public.profiles p WHERE p.id = user_roles.user_id)
)
WITH CHECK (
  has_role(auth.uid(), 'agency_admin'::app_role)
  AND role <> 'system_admin'::app_role
  AND agency_id = current_agency_id()
  AND agency_id = (SELECT p.agency_id FROM public.profiles p WHERE p.id = user_roles.user_id)
);

-- ---------------------------------------------------------------------------------------------
-- (1) profiles
--   system_admin          : unrestricted.
--   agency_admin          : may edit profiles in their own agency (RLS today only lets them update
--                           their own row; this guard is ready if a staff UPDATE policy is added).
--                           Scope columns may change only if OLD.agency_id = current_agency_id()
--                           AND NEW.agency_id = current_agency_id() AND the new office is NULL or
--                           belongs to the caller's agency (A2).
--   everyone else         : may change only full_name and phone on their own row.
--   Frozen for non-admins : agency_id, virtual_office_id, office_restricted, email (used by
--                           AdminUserManagement to find reset/delete targets and never synced with
--                           auth.users.email), subscription_tier, business_license,
--                           overtime_threshold, default_ft_min_hours, default_pt_min_hours, id,
--                           created_at.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.guard_profiles_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _caller_agency uuid;
  _self_editable constant text[] := ARRAY['full_name', 'phone', 'updated_at'];
  _scope constant text[] := ARRAY['agency_id', 'virtual_office_id', 'office_restricted'];
  _scope_changed boolean;
  _other_changed boolean;
BEGIN
  IF _uid IS NULL OR has_role(_uid, 'system_admin'::app_role) THEN
    RETURN NEW;
  END IF;

  _scope_changed := NEW.agency_id IS DISTINCT FROM OLD.agency_id
                 OR NEW.virtual_office_id IS DISTINCT FROM OLD.virtual_office_id
                 OR NEW.office_restricted IS DISTINCT FROM OLD.office_restricted;
  _other_changed := (to_jsonb(NEW) - _self_editable - _scope)
                    IS DISTINCT FROM (to_jsonb(OLD) - _self_editable - _scope);

  IF has_role(_uid, 'agency_admin'::app_role) THEN
    _caller_agency := current_agency_id();
    IF OLD.agency_id IS DISTINCT FROM _caller_agency AND (_scope_changed OR _other_changed) THEN
      RAISE EXCEPTION 'Not allowed to change a profile outside your agency' USING ERRCODE = '42501';
    END IF;
    IF _scope_changed AND NOT (
         NEW.agency_id = _caller_agency
         AND (NEW.virtual_office_id IS NULL
              OR EXISTS (SELECT 1 FROM public.virtual_office vo
                         WHERE vo.id = NEW.virtual_office_id AND vo.agency_id = _caller_agency))
       ) THEN
      RAISE EXCEPTION 'Agency and office must stay within your agency' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF _scope_changed OR _other_changed THEN
    RAISE EXCEPTION 'Only name and phone can be changed on your own profile' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_profiles_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_profiles_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_update();

-- ---------------------------------------------------------------------------------------------
-- (3) caregivers — non-staff callers (the caregiver themselves) may update ONLY their own row and
-- ONLY the personal fields the caregiver profile form edits (CaregiverProfileSettings.tsx).
-- Frozen for non-staff: agency_id, virtual_office_id, user_id, email (login identity; the form now
-- shows it read-only), employment_type, role (enum full_time/part_time/on_call — display only:
-- Caregivers.tsx badge, client Care Team label, dev MCP tool; not read by any DB function),
-- hourly_rate, availability (legacy jsonb), is_active, custom_min_hours (staff-set weekly target
-- shown on Today), reliability_score, performance_rating (already frozen by its own trigger),
-- hire_date, service_radius_miles, is_demo, id, created_at.
-- Staff (is_agency_staff / system_admin) are governed by RLS only (tightened in M-SEC-1).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.guard_caregivers_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _self_editable constant text[] := ARRAY[
    'first_name', 'last_name', 'phone',
    'address', 'city', 'state', 'zip_code',
    'emergency_contact_name', 'emergency_contact_phone',
    'location_address', 'location_city', 'location_state', 'location_zip_code',
    'service_zipcodes', 'updated_at'];
BEGIN
  IF _uid IS NULL OR has_role(_uid, 'system_admin'::app_role) OR is_agency_staff(_uid) THEN
    RETURN NEW;
  END IF;
  IF OLD.user_id IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'You can only update your own caregiver profile' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - _self_editable) IS DISTINCT FROM (to_jsonb(OLD) - _self_editable) THEN
    RAISE EXCEPTION 'Only your personal contact and service-area details can be changed here'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_caregivers_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_caregivers_update
BEFORE UPDATE ON public.caregivers
FOR EACH ROW EXECUTE FUNCTION public.guard_caregivers_update();

-- ---------------------------------------------------------------------------------------------
-- (4) clients — approved by the owner (plan §9.1/§9.2). Non-staff callers (the client) may update ONLY
-- their own row and ONLY the fields the client portal form edits
-- (client-dashboard/ProfileSettings.tsx update payload). Frozen for non-staff: agency_id,
-- virtual_office_id, user_id, family_id, email, date_of_birth, care_requirements,
-- medical_conditions, preferred_caregiver_id, is_active, scheduling_flexibility, scheduling_notes,
-- notes (the staff-only "Notes" field shown in the Client Details dialog — owner decision
-- 2026-10-02; the client form no longer shows or sends it), is_demo, id, created_at.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.guard_clients_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _self_editable constant text[] := ARRAY[
    'first_name', 'last_name', 'phone',
    'address', 'city', 'state', 'zip_code',
    'emergency_contact_name', 'emergency_contact_phone',
    'updated_at'];
BEGIN
  IF _uid IS NULL OR has_role(_uid, 'system_admin'::app_role) OR is_agency_staff(_uid) THEN
    RETURN NEW;
  END IF;
  IF OLD.user_id IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'You can only update your own profile' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - _self_editable) IS DISTINCT FROM (to_jsonb(OLD) - _self_editable) THEN
    RAISE EXCEPTION 'Only your contact details can be changed here' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_clients_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_clients_update
BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.guard_clients_update();

-- ---------------------------------------------------------------------------------------------
-- (5) INSERT/DELETE bypass (owner item 2, Oct 2). Live INSERT/DELETE-capable policies:
--   profiles   : none (no INSERT/DELETE policy; only service_role/auth trigger write) - no gap.
--   user_roles : system_admin; agency_admin within own agency (now also role <> system_admin) - no gap.
--   clients    : "Admins and managers can manage clients" (staff roles, own agency/office) - non-staff
--                cannot insert/delete, BUT staff may insert with any user_id (attaching a foreign
--                login to a client record) and, if agency-wide, any virtual_office_id.
--   caregivers : "Agency users can manage their caregivers" FOR ALL with NO role check - ANY agency
--                member (caregiver, client) can INSERT a caregivers row with any user_id (e.g. their
--                own -> becomes a "caregiver" to my_caregiver_ids()) and DELETE any caregiver row,
--                incl. delete-own-and-reinsert with a new hourly_rate, bypassing (3). M-SEC-1 adds
--                the role check to the policy; this guard closes it now and also bounds staff.
-- Rules (both tables): service_role and system_admin exempt; non-staff may not INSERT or DELETE;
-- staff may INSERT only into their own agency, with a NULL office or an office of their agency, and
-- a NULL user_id or a user whose profile is in their agency; staff may DELETE only rows of their
-- own agency. SECURITY DEFINER because a manager cannot read another user's profiles row under RLS
-- (the user_id check would false-negative); search_path pinned; EXECUTE revoked (rule 14).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.guard_person_record_insert_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _agency uuid;
BEGIN
  IF _uid IS NULL OR has_role(_uid, 'system_admin'::app_role) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT is_agency_staff(_uid) THEN
    RAISE EXCEPTION 'Only staff can create or delete % records', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  _agency := current_agency_id();
  IF TG_OP = 'DELETE' THEN
    IF OLD.agency_id IS DISTINCT FROM _agency THEN
      RAISE EXCEPTION 'Not allowed to delete a record outside your agency' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.agency_id IS DISTINCT FROM _agency THEN
    RAISE EXCEPTION 'New record must belong to your agency' USING ERRCODE = '42501';
  END IF;
  IF NEW.virtual_office_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.virtual_office vo WHERE vo.id = NEW.virtual_office_id AND vo.agency_id = _agency) THEN
    RAISE EXCEPTION 'Office must belong to your agency' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.agency_id = _agency) THEN
    RAISE EXCEPTION 'Linked login must belong to your agency' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_person_record_insert_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_caregivers_insert_delete
BEFORE INSERT OR DELETE ON public.caregivers
FOR EACH ROW EXECUTE FUNCTION public.guard_person_record_insert_delete();

CREATE TRIGGER trg_guard_clients_insert_delete
BEFORE INSERT OR DELETE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.guard_person_record_insert_delete();

-- ---------------------------------------------------------------------------------------------
-- Post-push verification (run read-only, results recorded in the plan):
--   SELECT policyname, qual, with_check FROM pg_policies
--    WHERE schemaname='public' AND tablename='user_roles';
--   SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname LIKE 'trg_guard_%';
--   SELECT p.proname, a.grantee::regrole, a.privilege_type
--     FROM pg_proc p, aclexplode(p.proacl) a
--    WHERE p.proname IN ('guard_profiles_update','guard_caregivers_update','guard_clients_update',
--                        'guard_person_record_insert_delete');
--     -> expected: only postgres (owner) EXECUTE; no PUBLIC / anon / authenticated rows.
-- ---------------------------------------------------------------------------------------------

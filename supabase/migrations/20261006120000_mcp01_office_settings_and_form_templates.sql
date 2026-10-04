-- M-CP-01 — office settings (module flag, enforcement flag, billing week), the shared scope helpers,
-- and Layer A form shells (form_templates / form_template_versions / form_template_fields).
-- Ripple care-plan module, Phase A. Schema plan §2, §2.1 (security baseline), §3, §10.
-- DRAFT FOR REVIEW. Not pushed.
--
-- Owner decisions applied (docs/Ripple_UI_Plan_Decisions_2026-10-01.md):
--   R8/Q1  virtual_office.compliance_enforcement_enabled, default false (read by Phase C only).
--   Q3     virtual_office.care_plan_module_enabled, default false (menus / dashboard only).
--          Only agency_admin / system_admin may change either flag. Enforced by a guard trigger,
--          not by the UI (today any agency staff in scope may UPDATE virtual_office).
--   Q11    virtual_office.billing_week_start (ISO day 1 = Monday), default Monday. Open with Ripple.
--          Guarded like the two flags: agency_admin / system_admin only (owner review, Oct 4).
--   R7     every policy uses the live M-Office predicate through cp_staff_in_scope().
--   Role tiers (owner review Oct 4, minimum necessary): every read policy names the roles that
--          may read that table; cp_staff_in_scope(_agency, _office, _roles) checks them.
--            clinical (plans + children, notes, entries, client documents, billing batches):
--              manager, agency_admin
--            authorizations, office_service_types: manager, agency_admin, scheduler
--            credential types, in-service / training forms + records: manager, agency_admin, hr_staff
--            shells (form templates / versions / fields), measure types: all agency staff (no PHI)
--   Q14    form_template_versions.status draft | published (server-side drafts).
--   Q15    agency-wide shells (virtual_office_id IS NULL) are readable by office-restricted staff,
--          so an office without its own shell can use the agency one. Writes are RPC-only (Phase B).
--
-- Security baseline (schema plan §2.1), as applied in every Phase A migration:
--   * RLS on, one SELECT policy for staff in scope. NO insert/update/delete policies: every write
--     goes through a Phase B SECURITY DEFINER RPC. Caregivers, clients and anon get nothing.
--   * Table privileges: REVOKE ALL FROM anon; authenticated keeps SELECT only (no INSERT, UPDATE,
--     DELETE, TRUNCATE, REFERENCES, TRIGGER). service_role is unchanged.
--   * New functions: REVOKE ALL ... FROM PUBLIC, anon before any GRANT (CLAUDE.md #14). Trigger
--     functions get no GRANT at all. No existing function signature changes (#13 not triggered).
--   * Verify after push: aclexplode(proacl) for every function below.

-- =============================================================================================
-- 1. Office settings
-- =============================================================================================
ALTER TABLE public.virtual_office
  ADD COLUMN compliance_enforcement_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN care_plan_module_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN billing_week_start smallint NOT NULL DEFAULT 1
    CONSTRAINT virtual_office_billing_week_start_chk CHECK (billing_week_start BETWEEN 1 AND 7);

COMMENT ON COLUMN public.virtual_office.compliance_enforcement_enabled IS
  'Care-plan module: when true, the new eligibility rules (Phase C) are hard for shifts in this office. agency_admin/system_admin only (trg_guard_virtual_office_flags).';
COMMENT ON COLUMN public.virtual_office.care_plan_module_enabled IS
  'Care-plan module: shows the "Client Care Plans (IPOS)" menu and dashboard section for this office. agency_admin/system_admin only.';
COMMENT ON COLUMN public.virtual_office.billing_week_start IS
  'ISO day the Weekly Billing week starts (1 = Monday). Default per owner decision Q11, open with Ripple. agency_admin/system_admin only.';

-- Column guard (M-SEC-2 pattern): the two flags and billing_week_start may be set or changed only
-- by agency_admin / system_admin. Service role (auth.uid() IS NULL) is never blocked. RLS
-- (vo_update_staff / vo_insert_staff) already limits which offices a caller can touch; this only
-- adds the role rule. INSERT is covered too: a new office can't be created with a flag on or a
-- non-default billing week (0g lesson).
CREATE FUNCTION public.guard_virtual_office_flags()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL
     OR has_role(_uid, 'system_admin'::app_role)
     OR has_role(_uid, 'agency_admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.compliance_enforcement_enabled OR NEW.care_plan_module_enabled OR NEW.billing_week_start <> 1 THEN
      RAISE EXCEPTION 'Only an agency admin can set the care-plan module, compliance enforcement or billing week'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.compliance_enforcement_enabled IS DISTINCT FROM OLD.compliance_enforcement_enabled
     OR NEW.care_plan_module_enabled IS DISTINCT FROM OLD.care_plan_module_enabled
     OR NEW.billing_week_start IS DISTINCT FROM OLD.billing_week_start THEN
    RAISE EXCEPTION 'Only an agency admin can change the care-plan module, compliance enforcement or billing week setting'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_virtual_office_flags() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_virtual_office_flags
BEFORE INSERT OR UPDATE ON public.virtual_office
FOR EACH ROW EXECUTE FUNCTION public.guard_virtual_office_flags();

-- =============================================================================================
-- 2. Shared scope helpers (used by every care-plan policy)
-- =============================================================================================
-- The one staff predicate, role-tiered: the caller holds one of _roles (the table's role tier;
-- all tiers are staff roles, so this is the M-SEC-1 staff check made narrower) + agency + live
-- M-Office office predicate (R7). No cross-agency system_admin bypass: system_admin reads only
-- tables whose tier lists it (shells, measure types). NULL office fails closed for
-- office-restricted staff (M-Office §2.4). has_role() is the existing SECURITY DEFINER helper.
CREATE FUNCTION public.cp_staff_in_scope(_agency_id uuid, _office_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    EXISTS (SELECT 1 FROM unnest(_roles) r WHERE has_role(auth.uid(), r))
    AND _agency_id = current_agency_id()
    AND ((NOT is_office_restricted(auth.uid())) OR _office_id = current_virtual_office_id()),
    false)
$$;
REVOKE ALL ON FUNCTION public.cp_staff_in_scope(uuid, uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cp_staff_in_scope(uuid, uuid, public.app_role[]) TO authenticated;

-- Agency-wide rows with no office (credential_types, agency measure types, agency-wide shells).
CREATE FUNCTION public.cp_staff_in_agency(_agency_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    EXISTS (SELECT 1 FROM unnest(_roles) r WHERE has_role(auth.uid(), r))
    AND _agency_id = current_agency_id(),
    false)
$$;
REVOKE ALL ON FUNCTION public.cp_staff_in_agency(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cp_staff_in_agency(uuid, public.app_role[]) TO authenticated;

-- Row consistency (applies to every writer, service role included): the row's office, client and
-- caregiver must belong to the row's agency. Generic: reads the optional columns from to_jsonb(NEW).
-- SECURITY DEFINER so the check sees the referenced rows regardless of the caller's RLS.
CREATE FUNCTION public.cp_check_row_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r jsonb := to_jsonb(NEW);
  _office uuid := (_r ->> 'virtual_office_id')::uuid;
  _client uuid := (_r ->> 'client_id')::uuid;
  _caregiver uuid := (_r ->> 'caregiver_id')::uuid;
BEGIN
  IF _office IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.virtual_office vo WHERE vo.id = _office AND vo.agency_id = NEW.agency_id) THEN
    RAISE EXCEPTION '%: office does not belong to this agency', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  IF _client IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.clients c WHERE c.id = _client AND c.agency_id = NEW.agency_id) THEN
    RAISE EXCEPTION '%: client does not belong to this agency', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  IF _caregiver IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.caregivers g WHERE g.id = _caregiver AND g.agency_id = NEW.agency_id) THEN
    RAISE EXCEPTION '%: caregiver does not belong to this agency', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_check_row_scope() FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 3. Layer A — form shells
-- =============================================================================================
CREATE TYPE public.form_template_kind AS ENUM
  ('ipos', 'authorization', 'progress_note', 'inservice', 'training', 'intake', 'credential');
CREATE TYPE public.form_field_storage AS ENUM
  ('spine_column', 'child_rows', 'field_value', 'static_text');
CREATE TYPE public.form_template_version_status AS ENUM ('draft', 'published');

CREATE TABLE public.form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,  -- NULL = agency-wide shell
  name text NOT NULL,
  kind public.form_template_kind NOT NULL,
  intake_doc_type text,                       -- kind='intake' only (= client_documents.doc_type)
  is_required_for_client boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_templates_intake_doc_type_chk CHECK ((kind = 'intake') = (intake_doc_type IS NOT NULL))
);
CREATE INDEX form_templates_agency_office_idx ON public.form_templates (agency_id, virtual_office_id, kind);

CREATE TABLE public.form_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status public.form_template_version_status NOT NULL DEFAULT 'draft',
  is_current boolean NOT NULL DEFAULT false,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  note_layout jsonb,                          -- progress_note shells only (schema plan §3)
  published_by uuid,
  published_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version),
  CONSTRAINT form_template_versions_current_is_published_chk CHECK (NOT is_current OR status = 'published')
);
CREATE UNIQUE INDEX one_current_version_per_template
  ON public.form_template_versions (template_id) WHERE is_current;
CREATE UNIQUE INDEX one_draft_version_per_template
  ON public.form_template_versions (template_id) WHERE status = 'draft';

CREATE TABLE public.form_template_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_version_id uuid NOT NULL REFERENCES public.form_template_versions(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  section text,
  label text NOT NULL,
  field_type text NOT NULL,                   -- text|longtext|number|date|select|checkbox|units|money|table
  storage public.form_field_storage NOT NULL,
  writes_to_entity text,
  writes_to_column text,
  shown_on_progress_note boolean NOT NULL DEFAULT false,
  default_value text,
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  options jsonb,
  UNIQUE (template_version_id, field_key)
);

CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.form_templates
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();

-- Child scope helpers (created after their tables: LANGUAGE sql validates at CREATE time).
-- Shell tier: all agency staff (no PHI).
CREATE FUNCTION public.cp_form_template_readable(_template_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT cp_staff_in_scope(t.agency_id, t.virtual_office_id,
                             '{system_admin,agency_admin,manager,scheduler,hr_staff}'::public.app_role[])
           OR (t.virtual_office_id IS NULL
               AND cp_staff_in_agency(t.agency_id, '{system_admin,agency_admin,manager,scheduler,hr_staff}'::public.app_role[]))
    FROM public.form_templates t WHERE t.id = _template_id), false)
$$;
REVOKE ALL ON FUNCTION public.cp_form_template_readable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cp_form_template_readable(uuid) TO authenticated;

CREATE FUNCTION public.cp_form_template_version_readable(_version_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT cp_form_template_readable(v.template_id)
    FROM public.form_template_versions v WHERE v.id = _version_id), false)
$$;
REVOKE ALL ON FUNCTION public.cp_form_template_version_readable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cp_form_template_version_readable(uuid) TO authenticated;

-- RLS: staff read only. Office shells in scope + agency-wide shells (Q15). No write policies.
ALTER TABLE public.form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_template_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read form templates in scope" ON public.form_templates
FOR SELECT TO authenticated
USING (cp_staff_in_scope(agency_id, virtual_office_id, '{system_admin,agency_admin,manager,scheduler,hr_staff}'::public.app_role[])
       OR (virtual_office_id IS NULL
           AND cp_staff_in_agency(agency_id, '{system_admin,agency_admin,manager,scheduler,hr_staff}'::public.app_role[])));

CREATE POLICY "Staff read form template versions in scope" ON public.form_template_versions
FOR SELECT TO authenticated
USING (cp_form_template_readable(template_id));

CREATE POLICY "Staff read form template fields in scope" ON public.form_template_fields
FOR SELECT TO authenticated
USING (cp_form_template_version_readable(template_version_id));

REVOKE ALL ON TABLE public.form_templates, public.form_template_versions, public.form_template_fields FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.form_templates, public.form_template_versions, public.form_template_fields FROM authenticated;
GRANT SELECT ON TABLE public.form_templates, public.form_template_versions, public.form_template_fields TO authenticated;

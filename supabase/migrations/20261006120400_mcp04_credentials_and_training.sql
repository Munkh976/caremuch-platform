-- M-CP-04 — credential catalog (extends caregiver_certifications), IPOS in-service form (step 1)
-- and IPOS training form + per-caregiver records (step 2).
-- Ripple care-plan module, Phase A. Schema plan §8. DRAFT FOR REVIEW. Not pushed.
--
-- Owner decision R3: NO new caregiver_credentials table. caregiver_certifications is extended
-- additively: credential_type_id -> new agency-scoped credential_types, effective_date, entered_by.
--   * The existing engine rule (expired or unverified certification -> hard block, every agency,
--     flag or not) is unchanged. Only the NEW "required credential missing" check (Phase C) goes
--     behind virtual_office.compliance_enforcement_enabled.
--   * Manual entry (Phase B upsert_caregiver_credential) sets is_verified = true, so a
--     manager/HR-entered row does not trip certification_unverified.
--   * Existing rows (credential_type_id NULL) and the existing RLS on caregiver_certifications are
--     unchanged.
-- Q17: hr_staff enters credentials and training forms; managers can do everything HR can and
--   override it. Enforced in the Phase B RPCs (role checks), not here.
-- Security baseline (schema plan §2.1): new tables staff SELECT only; writes via Phase B RPCs.

-- =============================================================================================
-- 1. Credential catalog
-- =============================================================================================
CREATE TYPE public.credential_category AS ENUM ('background_check', 'annual_online', 'annual', 'in_person_recert');

CREATE TABLE public.credential_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  name text NOT NULL,
  category public.credential_category NOT NULL,
  valid_months integer CHECK (valid_months IS NULL OR valid_months > 0),
  required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, name)
);

ALTER TABLE public.caregiver_certifications
  ADD COLUMN credential_type_id uuid REFERENCES public.credential_types(id) ON DELETE RESTRICT,
  ADD COLUMN effective_date date,
  ADD COLUMN entered_by uuid;
CREATE INDEX caregiver_certifications_type_idx
  ON public.caregiver_certifications (caregiver_id, credential_type_id) WHERE credential_type_id IS NOT NULL;

-- Guard: a typed certification must use a credential type of the caregiver's own agency.
-- Fires only when credential_type_id is set, so every existing write path is unaffected.
CREATE FUNCTION public.cp_check_certification_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.credential_type_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.credential_types t JOIN public.caregivers g ON g.agency_id = t.agency_id
       WHERE t.id = NEW.credential_type_id AND g.id = NEW.caregiver_id) THEN
    RAISE EXCEPTION 'Credential type must belong to the caregiver''s agency' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_check_certification_type() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cp_certification_type
BEFORE INSERT OR UPDATE OF credential_type_id, caregiver_id ON public.caregiver_certifications
FOR EACH ROW EXECUTE FUNCTION public.cp_check_certification_type();

-- =============================================================================================
-- 2. Per-client training (two steps per training_version)
-- =============================================================================================
CREATE TYPE public.plan_document_type AS ENUM
  ('ipos_initial', 'ipos_annual', 'ipos_addendum', 'behavior_support_plan', 'protocol');
CREATE TYPE public.training_method AS ENUM ('pcp_meeting', 'outside_pcp');

-- Step 1: the case manager trains the agency's program lead, who signs the In-service form.
CREATE TABLE public.plan_inservice_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  training_version integer NOT NULL CHECK (training_version > 0),
  case_manager_name text,
  program_lead_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,   -- the agency person trained (e.g. Bren)
  trained_on date,
  signed_at timestamptz,
  template_id uuid REFERENCES public.form_templates(id),
  template_version integer,
  field_snapshot jsonb,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  entered_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_inservice_forms_plan_idx ON public.plan_inservice_forms (care_plan_id, training_version);

-- Step 2: one filled ISK training form (header) ...
CREATE TABLE public.plan_training_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  training_version integer NOT NULL CHECK (training_version > 0),
  plan_document_type public.plan_document_type NOT NULL DEFAULT 'ipos_annual',
  plan_effective_date date,
  location text,
  template_id uuid REFERENCES public.form_templates(id),
  template_version integer,
  field_snapshot jsonb,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  entered_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ... and one row per trained caregiver. Valid only while care_plans.training_version matches.
CREATE TABLE public.plan_training_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_form_id uuid NOT NULL REFERENCES public.plan_training_forms(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  caregiver_id uuid NOT NULL REFERENCES public.caregivers(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  training_version integer NOT NULL CHECK (training_version > 0),
  training_date date,
  training_method public.training_method,
  primary_clinician_name text,
  trainer_name text,
  signed_date date,
  entered_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (training_form_id, caregiver_id)
);
CREATE INDEX plan_training_records_gate_idx
  ON public.plan_training_records (caregiver_id, client_id, training_version);

CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.plan_inservice_forms
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();
CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.plan_training_forms
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();
CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.plan_training_records
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();

-- =============================================================================================
-- 3. RLS — read only, role-tiered (manager, agency_admin, hr_staff); no write policies
-- =============================================================================================
ALTER TABLE public.credential_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_inservice_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_training_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_training_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers and HR read credential types in agency" ON public.credential_types
FOR SELECT TO authenticated USING (cp_staff_in_agency(agency_id, '{manager,agency_admin,hr_staff}'::public.app_role[]));

CREATE POLICY "Managers and HR read in-service forms in scope" ON public.plan_inservice_forms
FOR SELECT TO authenticated USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin,hr_staff}'::public.app_role[]));

CREATE POLICY "Managers and HR read training forms in scope" ON public.plan_training_forms
FOR SELECT TO authenticated USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin,hr_staff}'::public.app_role[]));

CREATE POLICY "Managers and HR read training records in scope" ON public.plan_training_records
FOR SELECT TO authenticated USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin,hr_staff}'::public.app_role[]));

REVOKE ALL ON TABLE public.credential_types, public.plan_inservice_forms, public.plan_training_forms,
  public.plan_training_records FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.credential_types,
  public.plan_inservice_forms, public.plan_training_forms, public.plan_training_records FROM authenticated;
GRANT SELECT ON TABLE public.credential_types, public.plan_inservice_forms, public.plan_training_forms,
  public.plan_training_records TO authenticated;

-- M-CP-02 — measure library + care-plan spine (IPOS) and its children; client_orders.care_plan_id.
-- Ripple care-plan module, Phase A. Schema plan §4. DRAFT FOR REVIEW. Not pushed.
--
-- Owner decisions applied:
--   R4/Q2  care_plans is a NEW table (the plan of service). client_orders stays exactly as it is
--          except a nullable care_plan_id link (NULL for every existing and Kind Care order).
--   R7     live M-Office predicate via cp_staff_in_scope(); children derive scope from the plan.
--   Role tier (owner review Oct 4): care_plans and every plan child are read by manager and
--          agency_admin only; the parent-scope helpers apply the same tier.
--   Measure types: system rows (agency_id NULL, seeded by M-CP-07) are readable by all staff of
--          any agency; an agency may add its own rows (agency_id set) later via Phase B RPC.
-- Security baseline (schema plan §2.1): staff SELECT only; no write policies (Phase B RPCs write);
-- anon nothing; authenticated SELECT only; helpers REVOKE ALL FROM PUBLIC, anon before GRANT.
-- Caregivers never read these tables directly: the progress-note screen uses the Phase B RPC
-- get_progress_note_for_caregiver (R5).

-- =============================================================================================
-- 1. Measure library (Layer A, agency-wide)
-- =============================================================================================
CREATE TYPE public.measure_kind AS ENUM
  ('yes_no_na', 'prompt_level', 'graded_steps', 'tally', 'trials', 'short_answer', 'narrative', 'staff_note');

CREATE TABLE public.measure_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES public.agency(id),           -- NULL = system row, shared by every agency
  kind public.measure_kind NOT NULL,
  label text NOT NULL,
  default_options jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, label)                               -- agency rows
);
CREATE UNIQUE INDEX measure_types_system_label_key ON public.measure_types (label) WHERE agency_id IS NULL;

-- =============================================================================================
-- 2. Care-plan spine
-- =============================================================================================
CREATE TYPE public.care_plan_status AS ENUM ('active', 'superseded', 'expired');
CREATE TYPE public.care_plan_type AS ENUM ('initial', 'annual', 'addendum');
CREATE TYPE public.objective_responsible_party AS ENUM
  ('this_agency', 'case_management', 'evaluator', 'family', 'other_provider');

CREATE TABLE public.care_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  training_version integer NOT NULL DEFAULT 1 CHECK (training_version > 0),  -- bumps on every new IPOS version (Phase B RPCs)
  status public.care_plan_status NOT NULL DEFAULT 'active',
  plan_type public.care_plan_type NOT NULL DEFAULT 'annual',
  meeting_date date,
  effective_date date,
  expiration_date date,
  next_review_date date,
  review_frequency text,
  michicans_date date,
  facilitator_name text,
  recorder_name text,
  discharge_criteria text,
  signed_by text,
  signed_date date,
  template_id uuid REFERENCES public.form_templates(id),
  template_version integer,
  field_snapshot jsonb,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, version),
  CONSTRAINT care_plans_dates_chk CHECK (expiration_date IS NULL OR effective_date IS NULL OR expiration_date >= effective_date)
);
CREATE UNIQUE INDEX one_active_plan_per_client ON public.care_plans (client_id) WHERE status = 'active';
CREATE INDEX care_plans_agency_office_idx ON public.care_plans (agency_id, virtual_office_id);

CREATE TABLE public.care_plan_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  goal_text text NOT NULL,
  target_start date,
  target_end date
);
CREATE INDEX care_plan_goals_plan_idx ON public.care_plan_goals (care_plan_id, seq);

CREATE TABLE public.care_plan_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.care_plan_goals(id) ON DELETE CASCADE,
  letter text,
  seq integer NOT NULL DEFAULT 0,
  objective_text text NOT NULL,
  staff_instructions text,                    -- "Instructions for Staff"; may be NULL
  service_type text,                          -- 'cls' | 'respite' | ... ; NULL when not this agency's
  responsible_party public.objective_responsible_party NOT NULL DEFAULT 'this_agency',
  target_start date,
  target_end date
);
CREATE INDEX care_plan_objectives_goal_idx ON public.care_plan_objectives (goal_id, seq);

CREATE TABLE public.care_plan_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  name text, relationship text, attended boolean, contributed boolean
);

CREATE TABLE public.care_plan_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('michicans', 'other')),
  item_kind text NOT NULL DEFAULT 'need' CHECK (item_kind IN ('need', 'centerpiece_strength', 'strength_present')),
  domain text, item_text text, level_of_need text,
  addressed boolean, additional_info text
);

CREATE TABLE public.care_plan_treatment_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  domain text NOT NULL,
  to_address boolean NOT NULL DEFAULT false,
  new_need boolean NOT NULL DEFAULT false,
  treatment_recommendation text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE public.care_plan_objective_needs (
  objective_id uuid NOT NULL REFERENCES public.care_plan_objectives(id) ON DELETE CASCADE,
  treatment_need_id uuid NOT NULL REFERENCES public.care_plan_treatment_needs(id) ON DELETE CASCADE,
  PRIMARY KEY (objective_id, treatment_need_id)
);

CREATE TABLE public.care_plan_dsm_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  service text NOT NULL,
  outcome_code text NOT NULL,
  notes text
);

CREATE TABLE public.care_plan_natural_supports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  name text,
  support_type text CHECK (support_type IN ('natural', 'professional')),
  status text,
  how_they_help text
);

CREATE TABLE public.care_plan_external_services (   -- other providers' lines: REFERENCE ONLY
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  provider_program text, auth_reference text, service text,
  effective_date date, expiration_date date, units_text text, description text
);

CREATE TABLE public.objective_measures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES public.care_plan_objectives(id) ON DELETE CASCADE,
  measure_type_id uuid NOT NULL REFERENCES public.measure_types(id),
  seq integer NOT NULL DEFAULT 0,
  prompt_text text NOT NULL,
  options jsonb,
  trial_count integer CHECK (trial_count IS NULL OR trial_count > 0),
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX objective_measures_objective_idx ON public.objective_measures (objective_id, seq);

CREATE TABLE public.care_plan_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  review_date date, next_review_date date, notes text
);

CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.care_plans
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();

-- R4/Q2: additive link from the existing service schedule to the plan. NULL for every existing row.
ALTER TABLE public.client_orders
  ADD COLUMN care_plan_id uuid REFERENCES public.care_plans(id) ON DELETE SET NULL;
CREATE INDEX client_orders_care_plan_idx ON public.client_orders (care_plan_id) WHERE care_plan_id IS NOT NULL;

-- client_orders keeps its existing staff write policy, so the new column is directly writable.
-- Guard: a schedule may only point at a plan of the SAME client (FK checks ignore RLS, so without
-- this a staff user could link an order to another client's or another agency's plan).
-- Fires only when care_plan_id is set; every existing order path (care_plan_id NULL) is unaffected.
CREATE FUNCTION public.cp_check_client_order_care_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.care_plan_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.care_plans p WHERE p.id = NEW.care_plan_id AND p.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'The care plan must belong to the same client as the service schedule' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_check_client_order_care_plan() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cp_client_order_care_plan
BEFORE INSERT OR UPDATE OF care_plan_id, client_id ON public.client_orders
FOR EACH ROW EXECUTE FUNCTION public.cp_check_client_order_care_plan();

-- =============================================================================================
-- 3. Scope helpers for children (after their tables)
-- =============================================================================================
CREATE FUNCTION public.cp_care_plan_in_scope(_care_plan_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT cp_staff_in_scope(p.agency_id, p.virtual_office_id, '{manager,agency_admin}'::public.app_role[])
                   FROM public.care_plans p WHERE p.id = _care_plan_id), false)
$$;
REVOKE ALL ON FUNCTION public.cp_care_plan_in_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cp_care_plan_in_scope(uuid) TO authenticated;

CREATE FUNCTION public.cp_care_plan_goal_in_scope(_goal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT cp_staff_in_scope(p.agency_id, p.virtual_office_id, '{manager,agency_admin}'::public.app_role[])
                   FROM public.care_plan_goals g JOIN public.care_plans p ON p.id = g.care_plan_id
                   WHERE g.id = _goal_id), false)
$$;
REVOKE ALL ON FUNCTION public.cp_care_plan_goal_in_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cp_care_plan_goal_in_scope(uuid) TO authenticated;

CREATE FUNCTION public.cp_care_plan_objective_in_scope(_objective_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT cp_staff_in_scope(p.agency_id, p.virtual_office_id, '{manager,agency_admin}'::public.app_role[])
                   FROM public.care_plan_objectives o
                   JOIN public.care_plan_goals g ON g.id = o.goal_id
                   JOIN public.care_plans p ON p.id = g.care_plan_id
                   WHERE o.id = _objective_id), false)
$$;
REVOKE ALL ON FUNCTION public.cp_care_plan_objective_in_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cp_care_plan_objective_in_scope(uuid) TO authenticated;

-- =============================================================================================
-- 4. RLS — read only, role-tiered; no write policies
-- =============================================================================================
ALTER TABLE public.measure_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_treatment_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_objective_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_dsm_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_natural_supports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_external_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.objective_measures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read measure types (system + own agency)" ON public.measure_types
FOR SELECT TO authenticated
USING ((agency_id IS NULL AND is_agency_staff(auth.uid()))
       OR cp_staff_in_agency(agency_id, '{system_admin,agency_admin,manager,scheduler,hr_staff}'::public.app_role[]));

CREATE POLICY "Managers read care plans in scope" ON public.care_plans
FOR SELECT TO authenticated USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin}'::public.app_role[]));

CREATE POLICY "Managers read care plan goals in scope" ON public.care_plan_goals
FOR SELECT TO authenticated USING (cp_care_plan_in_scope(care_plan_id));

CREATE POLICY "Managers read care plan objectives in scope" ON public.care_plan_objectives
FOR SELECT TO authenticated USING (cp_care_plan_goal_in_scope(goal_id));

CREATE POLICY "Managers read care plan attendees in scope" ON public.care_plan_attendees
FOR SELECT TO authenticated USING (cp_care_plan_in_scope(care_plan_id));

CREATE POLICY "Managers read care plan needs in scope" ON public.care_plan_needs
FOR SELECT TO authenticated USING (cp_care_plan_in_scope(care_plan_id));

CREATE POLICY "Managers read care plan treatment needs in scope" ON public.care_plan_treatment_needs
FOR SELECT TO authenticated USING (cp_care_plan_in_scope(care_plan_id));

CREATE POLICY "Managers read care plan objective needs in scope" ON public.care_plan_objective_needs
FOR SELECT TO authenticated USING (cp_care_plan_objective_in_scope(objective_id));

CREATE POLICY "Managers read care plan DSM recommendations in scope" ON public.care_plan_dsm_recommendations
FOR SELECT TO authenticated USING (cp_care_plan_in_scope(care_plan_id));

CREATE POLICY "Managers read care plan natural supports in scope" ON public.care_plan_natural_supports
FOR SELECT TO authenticated USING (cp_care_plan_in_scope(care_plan_id));

CREATE POLICY "Managers read care plan external services in scope" ON public.care_plan_external_services
FOR SELECT TO authenticated USING (cp_care_plan_in_scope(care_plan_id));

CREATE POLICY "Managers read objective measures in scope" ON public.objective_measures
FOR SELECT TO authenticated USING (cp_care_plan_objective_in_scope(objective_id));

CREATE POLICY "Managers read care plan reviews in scope" ON public.care_plan_reviews
FOR SELECT TO authenticated USING (cp_care_plan_in_scope(care_plan_id));

REVOKE ALL ON TABLE
  public.measure_types, public.care_plans, public.care_plan_goals, public.care_plan_objectives,
  public.care_plan_attendees, public.care_plan_needs, public.care_plan_treatment_needs,
  public.care_plan_objective_needs, public.care_plan_dsm_recommendations, public.care_plan_natural_supports,
  public.care_plan_external_services, public.objective_measures, public.care_plan_reviews
FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.measure_types, public.care_plans, public.care_plan_goals, public.care_plan_objectives,
  public.care_plan_attendees, public.care_plan_needs, public.care_plan_treatment_needs,
  public.care_plan_objective_needs, public.care_plan_dsm_recommendations, public.care_plan_natural_supports,
  public.care_plan_external_services, public.objective_measures, public.care_plan_reviews
FROM authenticated;
GRANT SELECT ON TABLE
  public.measure_types, public.care_plans, public.care_plan_goals, public.care_plan_objectives,
  public.care_plan_attendees, public.care_plan_needs, public.care_plan_treatment_needs,
  public.care_plan_objective_needs, public.care_plan_dsm_recommendations, public.care_plan_natural_supports,
  public.care_plan_external_services, public.objective_measures, public.care_plan_reviews
TO authenticated;

-- M-CP-03 — office service-type mapping, service authorizations, weekly billing batches,
-- progress notes + entries; order_services.service_authorization_id (display only).
-- Ripple care-plan module, Phase A. Schema plan §5. DRAFT FOR REVIEW. Not pushed.
--
-- Owner decisions applied:
--   R2     office_service_types: office-scoped care_type_code -> service_type ('cls', 'respite', ...).
--          Nothing is added to the global care_types table.
--   R1     group session = one shift per client: a note belongs to exactly one shift, unique per
--          shift (not voided). No shift_clients junction. Staff:client ratio is a header field.
--   Q9     the caregiver records the client's arrival time (client_arrived_at). Late = more than
--          5 minutes after scheduled_start -> first 15-minute unit not billed. Computed by the
--          M-CP-05 trigger; units_used and arrived_late cannot be set by any writer.
--   Q10    reviewers never edit a submitted note; they return it: status 'returned' + reason.
--   Q5     in-app signature = typed name (staff_signature_name) + staff_signed_at; the printout
--          carries a wet-signature line (UI, no column).
--   Q2     order_services.service_authorization_id, nullable, display only (the engine picks FIFO).
-- Security baseline (schema plan §2.1): staff SELECT only, no write policies, anon nothing,
-- caregivers read/write notes only through Phase B RPCs (get_progress_note_for_caregiver,
-- save/submit RPCs). Audit events for submit/review/return/bill are written by those RPCs; their
-- event types are added to events_event_type_check in Phase B, before the RPCs (M-SEC-6 lesson).

-- =============================================================================================
-- 1. Office service-type mapping (R2)
-- =============================================================================================
CREATE TABLE public.office_service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid NOT NULL REFERENCES public.virtual_office(id) ON DELETE CASCADE,
  care_type_code text NOT NULL REFERENCES public.care_types(code) ON UPDATE CASCADE,
  service_type text NOT NULL CHECK (service_type ~ '^[a-z][a-z0-9_]*$'),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (virtual_office_id, care_type_code)
);

-- =============================================================================================
-- 2. Service authorizations (single source of truth for units)
-- =============================================================================================
CREATE TYPE public.auth_period_type AS ENUM ('per_week', 'per_auth', 'per_quarter', 'per_month', 'per_day');
CREATE TYPE public.auth_source_type AS ENUM ('manual', 'doc', 'edi', 'connector');

CREATE TABLE public.service_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  auth_number text NOT NULL,
  service_code text,
  modifier text,
  service_type text NOT NULL CHECK (service_type ~ '^[a-z][a-z0-9_]*$'),
  service_description text,
  units_authorized numeric NOT NULL DEFAULT 0 CHECK (units_authorized >= 0),
  units_claimed numeric NOT NULL DEFAULT 0,
  units_paid numeric NOT NULL DEFAULT 0,
  units_available numeric NOT NULL DEFAULT 0,       -- DERIVED by M-CP-05; any written value is recomputed
  period_type public.auth_period_type,
  units_per_period numeric,
  unit_minutes integer NOT NULL DEFAULT 15 CHECK (unit_minutes > 0),
  rate numeric,
  amount numeric,
  effective_date date NOT NULL,
  expiration_date date NOT NULL,
  source_adapter public.auth_source_type NOT NULL DEFAULT 'manual',
  authorizing_agent_notes text,
  template_id uuid REFERENCES public.form_templates(id),
  template_version integer,
  field_snapshot jsonb,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, auth_number),
  CONSTRAINT service_authorizations_dates_chk CHECK (expiration_date >= effective_date)
);
CREATE INDEX service_authorizations_client_idx
  ON public.service_authorizations (client_id, service_type, expiration_date);

-- =============================================================================================
-- 3. Weekly billing batches (one per office per week)
-- =============================================================================================
CREATE TYPE public.billing_batch_status AS ENUM ('open', 'reviewed', 'billed');

CREATE TABLE public.billing_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid NOT NULL REFERENCES public.virtual_office(id),
  week_start date NOT NULL,
  week_end date NOT NULL,
  status public.billing_batch_status NOT NULL DEFAULT 'open',
  reviewed_by uuid,
  reviewed_at timestamptz,
  billed_by uuid,
  billed_at timestamptz,
  export_ref text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (virtual_office_id, week_start),
  CONSTRAINT billing_batches_week_chk CHECK (week_end = week_start + 6)
);

-- =============================================================================================
-- 4. Progress notes (one per delivered shift) + entries (one per this_agency objective)
-- =============================================================================================
CREATE TYPE public.progress_note_status AS ENUM ('draft', 'submitted', 'returned', 'reviewed', 'billed');
CREATE TYPE public.progress_note_kind AS ENUM ('cls', 'respite');

CREATE TABLE public.progress_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  caregiver_id uuid NOT NULL REFERENCES public.caregivers(id),
  shift_id uuid REFERENCES public.shifts(id) ON DELETE RESTRICT,   -- a delivered, documented shift can't be deleted
  authorization_id uuid NOT NULL REFERENCES public.service_authorizations(id) ON DELETE RESTRICT,
  care_plan_id uuid REFERENCES public.care_plans(id),
  training_version integer,
  billing_batch_id uuid REFERENCES public.billing_batches(id),
  note_kind public.progress_note_kind NOT NULL,
  narrative_text text,                        -- respite "Session Narrative" (required at submit, Phase B)
  service_date date NOT NULL,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  client_arrived_at timestamptz,              -- Q9: recorded by the caregiver on the note
  actual_end timestamptz,
  actual_minutes integer CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  arrived_late boolean NOT NULL DEFAULT false,          -- DERIVED (M-CP-05)
  staff_client_ratio text,
  location text,
  units_scheduled numeric CHECK (units_scheduled IS NULL OR units_scheduled >= 0),
  billable boolean NOT NULL DEFAULT true,
  units_used numeric NOT NULL DEFAULT 0 CHECK (units_used >= 0),   -- DERIVED (M-CP-05) = units billed
  status public.progress_note_status NOT NULL DEFAULT 'draft',
  completed_on timestamptz,
  staff_signature_name text,                  -- Q5: typed name
  staff_signed_at timestamptz,
  returned_reason text,
  returned_by uuid,
  returned_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  biller_name text,
  biller_signed_at timestamptz,
  billed_at timestamptz,
  template_id uuid REFERENCES public.form_templates(id),
  template_version integer,
  field_snapshot jsonb,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT progress_notes_returned_reason_chk CHECK (status <> 'returned' OR returned_reason IS NOT NULL)
);
CREATE UNIQUE INDEX one_note_per_shift ON public.progress_notes (shift_id) WHERE NOT voided AND shift_id IS NOT NULL;
CREATE INDEX progress_notes_authorization_idx ON public.progress_notes (authorization_id) WHERE billable AND NOT voided;
CREATE INDEX progress_notes_office_date_idx ON public.progress_notes (agency_id, virtual_office_id, service_date);
CREATE INDEX progress_notes_caregiver_idx ON public.progress_notes (caregiver_id, status);

CREATE TABLE public.progress_note_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  progress_note_id uuid NOT NULL REFERENCES public.progress_notes(id) ON DELETE CASCADE,
  objective_id uuid REFERENCES public.care_plan_objectives(id) ON DELETE SET NULL,
  notes_text text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  measures_snapshot jsonb,
  UNIQUE (progress_note_id, objective_id)
);

CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.office_service_types
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();
CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.service_authorizations
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();
CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.billing_batches
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();
CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.progress_notes
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();

-- Q2: display-only link from a service line to an authorization. Guard: same client as the order
-- (order_services keeps its existing staff write policy). Fires only when the column is set.
ALTER TABLE public.order_services
  ADD COLUMN service_authorization_id uuid REFERENCES public.service_authorizations(id) ON DELETE SET NULL;

CREATE FUNCTION public.cp_check_order_service_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.service_authorization_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.service_authorizations a
       JOIN public.client_orders o ON o.id = NEW.order_id
       WHERE a.id = NEW.service_authorization_id AND a.client_id = o.client_id) THEN
    RAISE EXCEPTION 'The authorization must belong to the same client as the service schedule' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_check_order_service_authorization() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cp_order_service_authorization
BEFORE INSERT OR UPDATE OF service_authorization_id, order_id ON public.order_services
FOR EACH ROW EXECUTE FUNCTION public.cp_check_order_service_authorization();

-- =============================================================================================
-- 5. Scope helper for entries + RLS (read only, role-tiered; no write policies)
--    authorizations + office_service_types: manager, agency_admin, scheduler
--    billing batches, notes, entries: manager, agency_admin
-- =============================================================================================
CREATE FUNCTION public.cp_progress_note_in_scope(_note_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT cp_staff_in_scope(n.agency_id, n.virtual_office_id, '{manager,agency_admin}'::public.app_role[])
                   FROM public.progress_notes n WHERE n.id = _note_id), false)
$$;
REVOKE ALL ON FUNCTION public.cp_progress_note_in_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cp_progress_note_in_scope(uuid) TO authenticated;

ALTER TABLE public.office_service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_note_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers and schedulers read office service types in scope" ON public.office_service_types
FOR SELECT TO authenticated USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin,scheduler}'::public.app_role[]));

CREATE POLICY "Managers and schedulers read service authorizations in scope" ON public.service_authorizations
FOR SELECT TO authenticated USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin,scheduler}'::public.app_role[]));

CREATE POLICY "Managers read billing batches in scope" ON public.billing_batches
FOR SELECT TO authenticated USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin}'::public.app_role[]));

CREATE POLICY "Managers read progress notes in scope" ON public.progress_notes
FOR SELECT TO authenticated USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin}'::public.app_role[]));

CREATE POLICY "Managers read progress note entries in scope" ON public.progress_note_entries
FOR SELECT TO authenticated USING (cp_progress_note_in_scope(progress_note_id));

REVOKE ALL ON TABLE public.office_service_types, public.service_authorizations, public.billing_batches,
  public.progress_notes, public.progress_note_entries FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.office_service_types,
  public.service_authorizations, public.billing_batches, public.progress_notes, public.progress_note_entries
FROM authenticated;
GRANT SELECT ON TABLE public.office_service_types, public.service_authorizations, public.billing_batches,
  public.progress_notes, public.progress_note_entries TO authenticated;

-- M-CP-03b — intake documents, their own track (no FK to care_plans on purpose).
-- Ripple care-plan module, Phase A. Schema plan §5.1. DRAFT FOR REVIEW. Not pushed.
--
-- Verified live (read-only, 2026-10-04): no existing client-documents/attachments table, so CREATE.
-- Owner decision Q7: doc_type 'safety_behavior_plan' (onboarding item 5) with a 'not_applicable'
-- status. doc_type values are not hard-coded in a CHECK: they come from the intake shells
-- (form_templates.intake_doc_type): consent, insurance, emergency_contacts, allergies, assessment,
-- release_of_information, safety_behavior_plan.
-- Security baseline (schema plan §2.1): read by manager / agency_admin only (clinical tier, owner
-- review Oct 4); writes via Phase B upsert_client_document.

CREATE TYPE public.client_document_status AS ENUM ('missing', 'pending', 'complete', 'expired', 'not_applicable');

CREATE TABLE public.client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type ~ '^[a-z][a-z0-9_]*$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_current boolean NOT NULL DEFAULT true,
  status public.client_document_status NOT NULL DEFAULT 'pending',
  not_applicable_reason text,
  effective_date date,
  expiration_date date,
  file_ref text,
  template_id uuid REFERENCES public.form_templates(id),
  template_version integer,
  field_snapshot jsonb,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, doc_type, version)
);
CREATE UNIQUE INDEX one_current_doc_per_type ON public.client_documents (client_id, doc_type) WHERE is_current;

CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.client_documents
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();

ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read client documents in scope" ON public.client_documents
FOR SELECT TO authenticated USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin}'::public.app_role[]));

REVOKE ALL ON TABLE public.client_documents FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.client_documents FROM authenticated;
GRANT SELECT ON TABLE public.client_documents TO authenticated;

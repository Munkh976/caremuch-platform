-- B1 stand-ins for live objects (PGlite only): events (live constraints as of M-SEC-6), the
-- caregiver_certifications columns/policies, caregiver_agency_id(), virtual_office.timezone.
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id) ON DELETE CASCADE,
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL DEFAULT 'system',
  actor_id uuid, subject_type text NOT NULL, subject_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(), is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_actor_type_check CHECK (actor_type = ANY (ARRAY['staff','caregiver','client','system','anon'])),
  CONSTRAINT events_event_type_check CHECK (event_type = ANY (ARRAY[
    'caregiver_application_received','caregiver_approved','caregiver_rejected','care_request_received',
    'care_request_converted_to_client','shift_created','shift_assigned','shift_filled','shift_completed','shift_cancelled',
    'shift_no_show','caregiver_pickup','assignment_released','rating_added','time_entry_submitted','time_entry_approved',
    'earnings_computed','account_link_issued']::text[])));
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.caregiver_certifications
  ADD COLUMN certification_number text, ADD COLUMN issued_date date, ADD COLUMN document_url text,
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now(),
  ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.caregiver_agency_id(_caregiver_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$ SELECT agency_id FROM public.caregivers WHERE id = _caregiver_id $$;
ALTER TABLE public.caregiver_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Agency staff manage certifications in their agency" ON public.caregiver_certifications FOR ALL TO authenticated
USING (is_agency_staff(auth.uid()) AND caregiver_agency_id(caregiver_id) = current_agency_id())
WITH CHECK (is_agency_staff(auth.uid()) AND caregiver_agency_id(caregiver_id) = current_agency_id());
CREATE POLICY "Caregivers read their own certifications" ON public.caregiver_certifications FOR SELECT TO authenticated
USING (caregiver_id IN (SELECT my_caregiver_ids()));
ALTER TABLE public.virtual_office ADD COLUMN timezone text NOT NULL DEFAULT 'America/New_York';

-- live: anon holds no privilege on caregiver_certifications (read-only check 2026-10-04)
REVOKE ALL ON TABLE public.caregiver_certifications FROM anon;

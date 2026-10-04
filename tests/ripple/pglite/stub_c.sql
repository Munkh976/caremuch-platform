-- Phase C stand-ins (PGlite only): the tables/columns the LIVE eligibility engine and assignment
-- machinery read. The live function bodies themselves are loaded verbatim from phasec/live/.
ALTER TABLE public.agency ADD COLUMN max_weekly_hours integer, ADD COLUMN travel_buffer_minutes integer, ADD COLUMN late_trade_hours integer;
ALTER TABLE public.shifts ADD COLUMN required_skills text[], ADD COLUMN duration_hours numeric NOT NULL DEFAULT 1, ADD COLUMN order_title text;
ALTER TABLE public.caregivers ADD COLUMN is_active boolean DEFAULT true, ADD COLUMN service_zipcodes text[], ADD COLUMN reliability_score integer;
ALTER TABLE public.clients ADD COLUMN zip_code text, ADD COLUMN preferred_caregiver_id uuid;
ALTER TABLE public.care_types ADD COLUMN requires_trade_approval boolean NOT NULL DEFAULT false;
CREATE TYPE public.assignment_status AS ENUM ('scheduled','confirmed','in_progress','completed','no_show','cancelled');
CREATE TABLE public.caregiver_skills (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), caregiver_id uuid NOT NULL, care_type_code text NOT NULL);
CREATE TABLE public.shift_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  caregiver_id uuid NOT NULL, status public.assignment_status DEFAULT 'scheduled', assignment_method public.assignment_method, is_locked boolean,
  notes text, assigned_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  override_reason text, override_by uuid, override_at timestamptz);
CREATE TABLE public.time_off_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), caregiver_id uuid NOT NULL, start_date date NOT NULL, end_date date NOT NULL, status text);
CREATE TABLE public.caregiver_availability (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), caregiver_id uuid NOT NULL, day_of_week int NOT NULL,
  start_time time NOT NULL, end_time time NOT NULL, is_available boolean);
CREATE TABLE public.caregiver_availability_exceptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), caregiver_id uuid NOT NULL, exception_date date NOT NULL,
  is_available boolean, start_time time, end_time time, reason text);
CREATE TABLE public.shift_trades (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_assignment_id uuid, original_caregiver_id uuid NOT NULL, new_caregiver_id uuid,
  status text DEFAULT 'pending', shift_id uuid, eligibility_snapshot jsonb, auto_approved boolean, requires_manager_approval boolean DEFAULT false,
  approval_reasons text[], decided_by uuid, resolved_at timestamptz, updated_at timestamptz);

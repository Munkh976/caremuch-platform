-- S-OFF-1 stand-ins (PGlite only): what the live compute_earnings_for_time_entry reads and writes
-- (enum labels as on DEV, 2026-10-04).
CREATE TYPE public.time_entry_status AS ENUM ('draft','submitted','approved','rejected');
CREATE TYPE public.time_entry_source AS ENUM ('clock','manual','correction','import');
CREATE TYPE public.earnings_rate_source AS ENUM ('shift','caregiver');
CREATE TYPE public.earnings_line_status AS ENUM ('calculated','voided');
ALTER TABLE public.shifts ADD COLUMN pay_rate numeric;
ALTER TABLE public.caregivers ADD COLUMN hourly_rate numeric;
CREATE TABLE public.time_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agency_id uuid NOT NULL, shift_assignment_id uuid, shift_id uuid NOT NULL,
  caregiver_id uuid NOT NULL, hours_worked numeric, status public.time_entry_status NOT NULL DEFAULT 'draft', source public.time_entry_source DEFAULT 'manual',
  voided_at timestamptz, is_demo boolean DEFAULT false, virtual_office_id uuid);
CREATE TABLE public.earnings_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agency_id uuid, time_entry_id uuid, shift_assignment_id uuid, shift_id uuid,
  caregiver_id uuid, hours_used numeric, rate_used numeric, rate_source public.earnings_rate_source, regular_hours numeric, overtime_hours numeric,
  overtime_rate numeric, regular_amount numeric, overtime_amount numeric, gross_amount numeric, status public.earnings_line_status NOT NULL DEFAULT 'calculated',
  computed_at timestamptz DEFAULT now(), computed_by uuid, is_demo boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz);

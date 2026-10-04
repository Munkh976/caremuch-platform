-- Minimal local stand-in for the live objects the M-CP migrations reference (PGlite only).
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Supabase default privileges (verified live: anon/authenticated get arwdDxtm on new tables, X on functions)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('system_admin','agency_admin','manager','scheduler','hr_staff','caregiver','client');
CREATE TYPE public.assignment_method AS ENUM ('manual','ai_suggested','auto_assigned','traded','picked_up');
CREATE TABLE public.agency (id uuid PRIMARY KEY, agency_name text);
CREATE TABLE public.virtual_office (id uuid PRIMARY KEY, agency_id uuid NOT NULL REFERENCES public.agency(id), name text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, smart_match_weights jsonb, updated_at timestamptz);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, agency_id uuid, virtual_office_id uuid, office_restricted boolean DEFAULT false, full_name text);
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL, agency_id uuid);
CREATE TABLE public.clients (id uuid PRIMARY KEY, agency_id uuid NOT NULL REFERENCES public.agency(id), user_id uuid, first_name text, virtual_office_id uuid);
CREATE TABLE public.caregivers (id uuid PRIMARY KEY, agency_id uuid NOT NULL REFERENCES public.agency(id), user_id uuid, first_name text, virtual_office_id uuid);
CREATE TABLE public.care_types (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text);
CREATE TABLE public.client_orders (id uuid PRIMARY KEY, agency_id uuid NOT NULL, client_id uuid NOT NULL REFERENCES public.clients(id), virtual_office_id uuid);
CREATE TABLE public.order_services (id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.client_orders(id), care_type_code text NOT NULL);
CREATE TABLE public.shifts (id uuid PRIMARY KEY, agency_id uuid NOT NULL, client_id uuid NOT NULL REFERENCES public.clients(id), caregiver_id uuid,
  care_type_code text NOT NULL, shift_date date NOT NULL, virtual_office_id uuid);
CREATE TABLE public.caregiver_certifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), caregiver_id uuid NOT NULL REFERENCES public.caregivers(id),
  certification_name text NOT NULL, expiry_date date NOT NULL, is_verified boolean);

-- live virtual_office UPDATE policy (vo_update_staff) so the flag-guard test runs through real RLS
ALTER TABLE public.virtual_office ENABLE ROW LEVEL SECURITY;

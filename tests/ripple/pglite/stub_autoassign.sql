-- Auto-assign stand-ins (PGlite only): live objects the scoring reads (caregiver_performance is a view on DEV).
CREATE TABLE IF NOT EXISTS public.client_care_needs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, care_type_code text NOT NULL, priority int, notes text);
CREATE TABLE IF NOT EXISTS public.caregiver_performance (caregiver_id uuid PRIMARY KEY, agency_id uuid, avg_rating numeric, rating_count bigint, completion_rate numeric, on_time_rate numeric);

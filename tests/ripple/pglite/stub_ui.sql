-- UI round 2 stand-ins (PGlite only): live columns the S3 reads use.
ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS last_name text;

-- S9: virtual_office.code (live column; the Weekly Billing CSV file name uses it)
ALTER TABLE public.virtual_office ADD COLUMN code text;

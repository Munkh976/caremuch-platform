-- UI round 2 stand-ins (PGlite only): live columns the S3 reads use.
ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS last_name text;

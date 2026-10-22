-- Stub columns that exist on DEV (virtual_office contact address; Contact tab) for the visit location suite (Oct 22).
ALTER TABLE public.virtual_office ADD COLUMN IF NOT EXISTS address text, ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text, ADD COLUMN IF NOT EXISTS zip_code text;

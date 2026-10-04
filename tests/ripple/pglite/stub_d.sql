-- Phase D stand-ins (PGlite only): live columns the onboarding RPCs read.
ALTER TABLE public.clients ADD COLUMN is_active boolean DEFAULT true;

-- Rollback of 20261031200000_assign_marker_fix.sql: protect_assignment_columns back to its DEV body before the fix
-- (SECURITY DEFINER, md5 6619cea4). DEV stores that body with CRLF line ends; the repo keeps this file LF, so the
-- carriage returns are rebuilt here to restore it byte-identically.
DO $rb$ BEGIN EXECUTE replace($q$CREATE OR REPLACE FUNCTION public.protect_assignment_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('caremuch.assignment_ctx', true),'') = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Direct assignment inserts are not allowed; use assign_caregiver_to_shift()' USING ERRCODE='42501';
  END IF;
  IF NEW.caregiver_id IS DISTINCT FROM OLD.caregiver_id THEN
    RAISE EXCEPTION 'caregiver_id can only be changed through assign_caregiver_to_shift()' USING ERRCODE='42501';
  END IF;
  IF NEW.override_reason IS DISTINCT FROM OLD.override_reason
     OR NEW.override_by IS DISTINCT FROM OLD.override_by
     OR NEW.override_at IS DISTINCT FROM OLD.override_at THEN
    RAISE EXCEPTION 'Override fields are set by the assignment function only' USING ERRCODE='42501';
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Cancelling an assignment must go through the assignment functions' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$$q$, chr(10), chr(13) || chr(10)); END $rb$;
REVOKE ALL ON FUNCTION public.protect_assignment_columns() FROM PUBLIC, anon, authenticated;

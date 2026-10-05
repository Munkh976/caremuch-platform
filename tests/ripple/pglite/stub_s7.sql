-- S7 stand-ins (PGlite only, loaded by ui-s7.cjs after boot): a client contact column and the M-SEC-2
-- client self-update guard, verbatim from DEV (guard_clients_update md5 ee527d41b7768ccd94b996390ad18751,
-- captured Oct 5), so the suite can prove a client cannot change clients.case_number.
ALTER TABLE public.clients ADD COLUMN phone text;

CREATE OR REPLACE FUNCTION public.guard_clients_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _self_editable constant text[] := ARRAY[
    'first_name', 'last_name', 'phone',
    'address', 'city', 'state', 'zip_code',
    'emergency_contact_name', 'emergency_contact_phone',
    'updated_at'];
BEGIN
  IF _uid IS NULL OR has_role(_uid, 'system_admin'::app_role) OR is_agency_staff(_uid) THEN
    RETURN NEW;
  END IF;
  IF OLD.user_id IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'You can only update your own profile' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - _self_editable) IS DISTINCT FROM (to_jsonb(OLD) - _self_editable) THEN
    RAISE EXCEPTION 'Only your contact details can be changed here' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_guard_clients_update BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.guard_clients_update();

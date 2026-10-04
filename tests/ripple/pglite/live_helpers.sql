CREATE OR REPLACE FUNCTION public.current_agency_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT agency_id FROM public.profiles WHERE id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.current_virtual_office_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN office_restricted THEN virtual_office_id ELSE NULL END
  FROM public.profiles WHERE id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_agency_staff(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('system_admin','agency_admin','manager','scheduler','hr_staff')
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_office_restricted(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(office_restricted, false) FROM public.profiles WHERE id = _user_id
$function$
;

CREATE OR REPLACE FUNCTION public.my_caregiver_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM public.caregivers WHERE user_id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.my_client_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM public.clients WHERE user_id = auth.uid()
$function$
;
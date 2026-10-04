CREATE OR REPLACE FUNCTION public.derived_shift_caregiver(_shift_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.caregiver_id
  FROM public.shift_assignments a
  WHERE a.shift_id = _shift_id
    AND a.status <> 'cancelled'::assignment_status
  ORDER BY (a.status = 'completed'::assignment_status) DESC, a.assigned_at DESC NULLS LAST, a.created_at DESC
  LIMIT 1
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_derived_shift_caregiver()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.caregiver_id := public.derived_shift_caregiver(NEW.id);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_shift_caregiver_from_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_shift_id uuid := COALESCE(NEW.shift_id, OLD.shift_id);
  v_caregiver uuid;
BEGIN
  v_caregiver := public.derived_shift_caregiver(v_shift_id);

  UPDATE public.shifts s
  SET caregiver_id = v_caregiver,
      status = CASE
        WHEN v_caregiver IS NOT NULL AND s.status IN ('open','unassigned') THEN 'assigned'::shift_status
        WHEN v_caregiver IS NULL AND s.status = 'assigned'::shift_status THEN 'open'::shift_status
        ELSE s.status
      END
  WHERE s.id = v_shift_id
    AND (s.caregiver_id IS DISTINCT FROM v_caregiver
         OR (v_caregiver IS NOT NULL AND s.status IN ('open','unassigned'))
         OR (v_caregiver IS NULL AND s.status = 'assigned'::shift_status));

  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_assignment_columns()
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
$function$
;

CREATE OR REPLACE FUNCTION public.protect_completed_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'completed'::assignment_status THEN
    -- Only the demo purge path may remove demo completed rows.
    IF COALESCE(OLD.is_demo, false)
       AND COALESCE(current_setting('caremuch.purge_ctx', true), '') = '1' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Completed shift assignments are historical records and cannot be deleted';
  END IF;
  RETURN OLD;
END;
$function$
;


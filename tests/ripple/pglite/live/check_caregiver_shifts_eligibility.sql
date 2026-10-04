CREATE OR REPLACE FUNCTION public.check_caregiver_shifts_eligibility(_shift_ids uuid[])
 RETURNS TABLE(shift_id uuid, result jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cg uuid;
BEGIN
  SELECT id INTO v_cg FROM public.caregivers WHERE user_id = auth.uid() LIMIT 1;
  IF v_cg IS NULL THEN
    RETURN; -- caller isn't a caregiver -- empty set, not an error
  END IF;

  RETURN QUERY
  SELECT sid, public.check_assignment_eligibility(sid, v_cg)
  FROM unnest(_shift_ids) AS sid;
END;
$function$

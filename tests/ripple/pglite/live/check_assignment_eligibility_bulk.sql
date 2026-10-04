CREATE OR REPLACE FUNCTION public.check_assignment_eligibility_bulk(_shift_id uuid, _caregiver_ids uuid[])
 RETURNS TABLE(caregiver_id uuid, result jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT cid, public.check_assignment_eligibility(_shift_id, cid)
  FROM unnest(_caregiver_ids) AS cid;
END;
$function$

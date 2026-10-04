CREATE OR REPLACE FUNCTION public.caregiver_pick_up_shift(_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cg uuid; elig jsonb; s record; v_id uuid;
BEGIN
  SELECT id INTO v_cg FROM public.caregivers WHERE user_id = auth.uid() LIMIT 1;
  IF v_cg IS NULL THEN RAISE EXCEPTION 'No caregiver profile for this user' USING ERRCODE='42501'; END IF;

  SELECT * INTO s FROM public.shifts WHERE id=_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found' USING ERRCODE='P0002'; END IF;
  IF s.status NOT IN ('open','unassigned') THEN
    RAISE EXCEPTION 'Shift is not open for pick-up' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_assignments a WHERE a.shift_id=_shift_id AND a.status<>'cancelled') THEN
    RAISE EXCEPTION 'Shift is already assigned' USING ERRCODE='23514';
  END IF;

  elig := public.check_assignment_eligibility(_shift_id, v_cg);
  -- CHANGED: was `jsonb_array_length(elig->'hard') > 0 OR jsonb_array_length(elig->'soft') > 0`.
  -- Self-pickup now blocks on hard issues only -- soft issues (availability, service-area
  -- over the zip list) are self-consented by the caregiver's own act of picking it up.
  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Pick-up refused: %', (
      SELECT string_agg(x->>'detail',' ') FROM jsonb_array_elements(elig->'hard') x
    ) USING ERRCODE='23514';
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','1',true);
  INSERT INTO public.shift_assignments(shift_id, caregiver_id, status, assignment_method)
  VALUES (_shift_id, v_cg, 'scheduled', 'picked_up') RETURNING id INTO v_id;
  PERFORM set_config('caremuch.assignment_ctx','',true);

  RETURN jsonb_build_object('assignment_id', v_id, 'eligibility', elig);
END;
$function$

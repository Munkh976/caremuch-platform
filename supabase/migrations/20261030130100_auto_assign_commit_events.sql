-- Auto-assign fix (CLAUDE.md rule 16: a function of the current slice, fixed after its push with the full gates).
-- commit_auto_assignments now writes one shift_assigned event per assignment (owner 4e: "auto_assign_run +
-- shift_assigned each"); the existing assign path writes none. Same signature; grants re-stated.
CREATE OR REPLACE FUNCTION public.commit_auto_assignments(_office_id uuid, _from date, _to date, _assignments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE vo record; v_today date; a jsonb; s record; v_issues jsonb; v_client text; v_done jsonb := '[]'::jsonb; v_skip jsonb := '[]'::jsonb;
BEGIN
  SELECT id, agency_id, COALESCE(timezone, 'America/New_York') tz INTO vo FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(vo.agency_id, vo.id, '{manager,scheduler,agency_admin}'::public.app_role[]);
  IF _assignments IS NULL OR jsonb_typeof(_assignments) <> 'array' OR jsonb_array_length(_assignments) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Nothing to assign (1-500 visits)' USING ERRCODE = '22023';
  END IF;
  v_today := (now() AT TIME ZONE vo.tz)::date;
  FOR a IN SELECT e FROM jsonb_array_elements(_assignments) e LOOP
    SELECT * INTO s FROM public.shifts WHERE id = (a ->> 'shift_id')::uuid;
    IF s.id IS NULL OR s.virtual_office_id IS DISTINCT FROM vo.id OR s.shift_date NOT BETWEEN _from AND _to THEN
      v_skip := v_skip || jsonb_build_object('shift_id', a ->> 'shift_id', 'reason', 'Not a visit of this office and period'); CONTINUE;
    END IF;
    v_client := cp_client_gate(s.client_id, vo.id);
    v_issues := cp_gate_issues(cp_eligibility_core(s.id, (a ->> 'caregiver_id')::uuid, NULL));
    IF v_client IS NOT NULL OR jsonb_array_length(v_issues) > 0 THEN
      v_skip := v_skip || jsonb_build_object('shift_id', s.id, 'caregiver_id', a ->> 'caregiver_id',
        'reason', COALESCE(v_client, (SELECT string_agg(i ->> 'label', '; ') FROM jsonb_array_elements(v_issues) i)));
      CONTINUE;
    END IF;
    BEGIN
      PERFORM assign_caregiver_to_shift(s.id, (a ->> 'caregiver_id')::uuid, 'auto_assigned'::public.assignment_method, 'Auto-assign', NULL);
      -- the existing assign path writes no shift_assigned event; the run writes one per assignment (owner 4e)
      PERFORM cp_audit(vo.agency_id, vo.id, 'shift_assigned', 'shift', s.id,
        jsonb_build_object('shift_id', s.id, 'caregiver_id', (a ->> 'caregiver_id')::uuid, 'method', 'auto_assigned'));
      v_done := v_done || jsonb_build_object('shift_id', s.id, 'caregiver_id', a ->> 'caregiver_id');
    EXCEPTION WHEN OTHERS THEN
      v_skip := v_skip || jsonb_build_object('shift_id', s.id, 'caregiver_id', a ->> 'caregiver_id', 'reason', SQLERRM);
    END;
  END LOOP;
  PERFORM cp_audit(vo.agency_id, vo.id, 'auto_assign_run', 'virtual_office', vo.id,
    jsonb_build_object('office_id', vo.id, 'from', _from, 'to', _to, 'requested', jsonb_array_length(_assignments),
                       'assigned', jsonb_array_length(v_done), 'skipped', jsonb_array_length(v_skip),
                       'shift_ids', (SELECT jsonb_agg(d -> 'shift_id') FROM jsonb_array_elements(v_done) d)));
  RETURN jsonb_build_object('assigned', v_done, 'skipped', v_skip);
END $function$;

REVOKE ALL ON FUNCTION public.commit_auto_assignments(uuid, date, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_auto_assignments(uuid, date, date, jsonb) TO authenticated;

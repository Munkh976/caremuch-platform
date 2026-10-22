-- Rollback of 20261030130200: propose_auto_assignments back to the body pushed in 20261030130000 (md5 9e18f5f2…).
CREATE OR REPLACE FUNCTION public.propose_auto_assignments(_office_id uuid, _from date, _to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  vo record; w jsonb; v_today date; r record; best record; v_count int; v_blocked text;
  v_order jsonb := '[]'::jsonb; v_props jsonb := '[]'::jsonb; v_blocks jsonb := '[]'::jsonb; v_reasons jsonb; x jsonb; v_shift record;
BEGIN
  SELECT id, agency_id, COALESCE(timezone, 'America/New_York') tz INTO vo FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(vo.agency_id, vo.id, '{manager,scheduler,agency_admin}'::public.app_role[]);
  IF _from IS NULL OR _to IS NULL OR _to < _from OR _to - _from > 62 THEN
    RAISE EXCEPTION 'Pick a period of at most two months' USING ERRCODE = '22023';
  END IF;
  w := cp_office_match_weights(vo.id);
  v_today := (now() AT TIME ZONE vo.tz)::date;
  BEGIN
    -- pass 1: eligible caregivers per shift (hardest first)
    FOR r IN SELECT id FROM cp_unassigned_shifts(vo.id, _from, _to, v_today) id LOOP
      SELECT count(*) INTO v_count FROM cp_shift_candidates(r.id, w, v_today) c WHERE c.ok;
      v_order := v_order || jsonb_build_object('id', r.id, 'n', v_count);
    END LOOP;
    -- pass 2: in that order, the best gate-passing caregiver, tentatively assigned (rolled back below)
    FOR r IN SELECT (e ->> 'id')::uuid id FROM jsonb_array_elements(v_order) e
             JOIN public.shifts s ON s.id = (e ->> 'id')::uuid ORDER BY (e ->> 'n')::int, s.shift_date, s.start_time, s.id LOOP
      SELECT sh.id, sh.shift_date, sh.start_time, sh.end_time, sh.care_type_code, sh.client_id, sh.group_session_id,
             btrim(COALESCE(cl.first_name, '') || ' ' || left(COALESCE(cl.last_name, ''), 1) || CASE WHEN COALESCE(cl.last_name, '') <> '' THEN '.' ELSE '' END) client_short
        INTO v_shift FROM public.shifts sh JOIN public.clients cl ON cl.id = sh.client_id WHERE sh.id = r.id;
      v_blocked := cp_client_gate(v_shift.client_id, vo.id);
      best := NULL;
      IF v_blocked IS NULL THEN
        SELECT c.caregiver_id, c.m INTO best FROM cp_shift_candidates(r.id, w, v_today) c JOIN public.caregivers g ON g.id = c.caregiver_id
         WHERE c.ok ORDER BY (c.m ->> 'score')::int DESC, g.last_name, g.first_name, g.id LIMIT 1;
      END IF;
      x := jsonb_build_object('shift_id', v_shift.id, 'shift_date', v_shift.shift_date, 'start_time', v_shift.start_time, 'end_time', v_shift.end_time,
             'care_type_code', v_shift.care_type_code, 'client_id', v_shift.client_id, 'client', v_shift.client_short, 'group_session_id', v_shift.group_session_id);
      IF best.caregiver_id IS NOT NULL THEN
        BEGIN
          PERFORM assign_caregiver_to_shift(v_shift.id, best.caregiver_id, 'auto_assigned'::public.assignment_method, 'auto-assign proposal', NULL);
          v_props := v_props || (x || jsonb_build_object('caregiver_id', best.caregiver_id,
            'caregiver', (SELECT btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) FROM public.caregivers WHERE id = best.caregiver_id),
            'score', (best.m ->> 'score')::int, 'reasons', best.m -> 'key_factors', 'warnings', best.m -> 'warnings'));
        EXCEPTION WHEN OTHERS THEN
          v_blocks := v_blocks || (x || jsonb_build_object('reasons', jsonb_build_array(SQLERRM)));
        END;
      ELSE
        -- why nobody: the client, or the most common issues among the office's caregivers
        IF v_blocked IS NOT NULL THEN
          v_reasons := jsonb_build_array(v_blocked);
        ELSE
          SELECT COALESCE(jsonb_agg(format('%s: %s caregiver%s', label, n, CASE WHEN n = 1 THEN '' ELSE 's' END) ORDER BY n DESC, label), '["No caregiver in this office"]'::jsonb)
            INTO v_reasons FROM (
              SELECT i ->> 'label' label, count(DISTINCT c.caregiver_id)::int n
                FROM cp_shift_candidates(r.id, w, v_today) c CROSS JOIN LATERAL jsonb_array_elements(c.issues) i GROUP BY 1 ORDER BY 2 DESC LIMIT 4) t;
        END IF;
        v_blocks := v_blocks || (x || jsonb_build_object('reasons', v_reasons));
      END IF;
    END LOOP;
    RAISE EXCEPTION 'cp_auto_assign_preview_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cp_auto_assign_preview_rollback' THEN RAISE; END IF;
  END;
  RETURN jsonb_build_object('office_id', vo.id, 'from', _from, 'to', _to, 'weights', w,
    'proposals', (SELECT COALESCE(jsonb_agg(p ORDER BY p ->> 'shift_date', p ->> 'start_time'), '[]'::jsonb) FROM jsonb_array_elements(v_props) p),
    'blocked', (SELECT COALESCE(jsonb_agg(b ORDER BY b ->> 'shift_date', b ->> 'start_time'), '[]'::jsonb) FROM jsonb_array_elements(v_blocks) b));
END $function$;

REVOKE ALL ON FUNCTION public.propose_auto_assignments(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_auto_assignments(uuid, date, date) TO authenticated;

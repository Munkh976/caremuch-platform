-- Auto-assign by period + Smart Assign on one scoring (owner decisions Oct 21 night, item 4; design
-- docs/design/auto-assign-and-smart-scheduling.md §D/§E). Additive: new functions only + the events CHECK.
--
-- 4a gate: proposals (Smart Assign, Auto-assign) only for caregivers who would pass with enforcement ON (no hard / soft
--    issue, no care-plan credential / training / authorization / units issue, client onboarded), even with enforcement
--    off. Manual assignment unchanged (today's advisory lines). 4b weights per office (virtual_office.smart_match_weights,
--    agency value, else today's 40/25/15/10/10 + continuity 0 so existing offices score exactly as match-caregiver),
--    set by agency admins (set_office_match_weights, audited). 4c continuity factor. 4d running totals over the whole
--    proposal set by tentative assignment in a rolled-back block (the engine itself counts units, caps, group ratio,
--    weekly hours and SAME-date overlaps). 4e propose_auto_assignments (read-only, hardest first, reasons) and
--    commit_auto_assignments (re-check, assign_caregiver_to_shift, one auto_assign_run + shift_assigned each).
--    Scheduler, manager and agency_admin of the office.
-- Unchanged: cp_eligibility_core, check_assignment_eligibility(_bulk), assign_caregiver_to_shift, every pickup / trade
-- function, match-caregiver (no longer used by the UI).
-- events CHECK: the 57 values of 20261029120100 + auto_assign_run, office_match_weights_changed.

ALTER TABLE public.events
  DROP CONSTRAINT events_event_type_check,
  ADD CONSTRAINT events_event_type_check CHECK (event_type = ANY (ARRAY[
  'caregiver_application_received', 'caregiver_approved', 'caregiver_rejected',
  'care_request_received', 'care_request_converted_to_client',
  'shift_created', 'shift_assigned', 'shift_filled', 'shift_completed', 'shift_cancelled', 'shift_no_show',
  'caregiver_pickup', 'assignment_released', 'rating_added',
  'time_entry_submitted', 'time_entry_approved', 'earnings_computed',
  'account_link_issued',
  'care_plan_module_enabled', 'template_draft_saved', 'template_published', 'instance_template_upgraded',
  'care_plan_created', 'care_plan_renewed', 'care_plan_updated', 'training_version_bumped',
  'objective_measures_set', 'authorization_created', 'client_document_saved',
  'credential_entered', 'credential_overridden', 'inservice_signed', 'training_recorded',
  'training_record_overridden',
  'progress_note_created', 'progress_note_submitted', 'progress_note_returned', 'progress_note_reviewed',
  'progress_note_voided', 'billing_batch_built', 'billing_batch_approved', 'billing_batch_billed',
  'group_session_created', 'shift_group_session_set',
  -- UI round 3: W1 measure library, W2 authorization corrections
  'measure_type_upserted', 'measure_type_activated', 'measure_type_deactivated', 'measure_type_deleted',
  'authorization_corrected', 'authorization_voided',
  -- UI S10: the audited compliance enforcement switch
  'compliance_enforcement_changed',
  -- demo UX Part 2: undo a note review
  'progress_note_review_undone',
  -- S4b: attachments
  'attachment_added', 'attachment_removed', 'attachment_viewed',
  -- S17: IPOS versions
  'care_plan_activated', 'care_plan_revised',
  -- auto-assign: one event per committed run; office match weights changed
  'auto_assign_run', 'office_match_weights_changed'
]::text[]));

-- =============================================================================================
-- 1. Per-office match weights (owner 4b). virtual_office.smart_match_weights (existing column, read by nothing so far)
--    now drives the score; NULL = the agency's value, else today's weights, so existing offices score exactly as before.
-- =============================================================================================
CREATE FUNCTION public.cp_default_match_weights()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT '{"skills": 40, "service_area": 25, "availability": 15, "reliability": 10, "performance": 10, "continuity": 0}'::jsonb
$$;
REVOKE ALL ON FUNCTION public.cp_default_match_weights() FROM PUBLIC, anon, authenticated;

-- A weights object is valid when it has exactly the 6 factors, whole numbers 0..100, summing to 100.
CREATE FUNCTION public.cp_valid_match_weights(_w jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_typeof(_w) = 'object'
     AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(_w) k) = ARRAY['availability','continuity','performance','reliability','service_area','skills']
     AND NOT EXISTS (SELECT 1 FROM jsonb_each(_w) e WHERE jsonb_typeof(e.value) <> 'number' OR (e.value::text)::numeric NOT BETWEEN 0 AND 100
                                                       OR (e.value::text)::numeric <> trunc((e.value::text)::numeric))
     AND (SELECT sum((e.value::text)::numeric) FROM jsonb_each(_w) e) = 100
$$;
REVOKE ALL ON FUNCTION public.cp_valid_match_weights(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cp_office_match_weights(_office_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT vo.smart_match_weights FROM public.virtual_office vo WHERE vo.id = _office_id AND cp_valid_match_weights(vo.smart_match_weights)),
    (SELECT to_jsonb(a) -> 'smart_match_weights' FROM public.agency a JOIN public.virtual_office vo ON vo.agency_id = a.id
      WHERE vo.id = _office_id AND cp_valid_match_weights(to_jsonb(a) -> 'smart_match_weights')),
    cp_default_match_weights())
$$;
REVOKE ALL ON FUNCTION public.cp_office_match_weights(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_office_match_weights(_office_id uuid, _weights jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE vo record; v_old jsonb;
BEGIN
  SELECT id, agency_id, smart_match_weights INTO vo FROM public.virtual_office WHERE id = _office_id FOR UPDATE;
  PERFORM cp_require_scope(vo.agency_id, vo.id, '{agency_admin}'::public.app_role[]);
  IF _weights IS NOT NULL AND NOT cp_valid_match_weights(_weights) THEN
    RAISE EXCEPTION 'Weights need the 6 factors (skills, service area, availability, reliability, performance, continuity) as whole numbers 0-100 adding up to 100' USING ERRCODE = '22023';
  END IF;
  v_old := cp_office_match_weights(vo.id);
  UPDATE public.virtual_office SET smart_match_weights = _weights WHERE id = vo.id;   -- NULL = back to the agency / default weights
  PERFORM cp_audit(vo.agency_id, vo.id, 'office_match_weights_changed', 'virtual_office', vo.id,
    jsonb_build_object('office_id', vo.id, 'before', v_old, 'after', cp_office_match_weights(vo.id)));
  RETURN cp_office_match_weights(vo.id);
END $$;
REVOKE ALL ON FUNCTION public.set_office_match_weights(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_office_match_weights(uuid, jsonb) TO authenticated;

-- =============================================================================================
-- 2. The score of one caregiver for one shift: today's five factors exactly as match-caregiver computes them (same
--    inputs, 0-1 per factor, same texts), plus continuity (owner 4c). A factor with weight 0 is not in the reasons.
-- =============================================================================================
CREATE FUNCTION public.cp_match_factors(_shift_id uuid, _caregiver_id uuid, _weights jsonb, _today date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record; g record; perf record; v_needed text[]; v_matched text[]; v_names text; v_zip text; v_pref uuid;
  f_skill numeric; f_area numeric := 1; f_avail numeric := 1; f_rel numeric; f_perf numeric := 1; f_cont numeric := 0;
  v_rel int; v_n int; v_last date; kf text[] := ARRAY[]::text[]; wn text[] := ARRAY[]::text[];
  w jsonb := COALESCE(_weights, cp_default_match_weights()); v_score numeric;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  SELECT * INTO g FROM public.caregivers WHERE id = _caregiver_id;
  SELECT c.zip_code, c.preferred_caregiver_id INTO v_zip, v_pref FROM public.clients c WHERE c.id = s.client_id;
  -- skills: the shift's care type + the client's declared care needs
  v_needed := ARRAY(SELECT t.x FROM (SELECT u.x, min(u.o) o FROM unnest(ARRAY[s.care_type_code] || ARRAY(SELECT n.care_type_code FROM public.client_care_needs n WHERE n.client_id = s.client_id))
                       WITH ORDINALITY u(x, o) WHERE u.x IS NOT NULL GROUP BY u.x) t ORDER BY t.o);   -- the shift's own care type first, as the function
  v_matched := ARRAY(SELECT x FROM unnest(v_needed) x WHERE EXISTS (SELECT 1 FROM public.caregiver_skills k WHERE k.caregiver_id = g.id AND k.care_type_code = x));
  f_skill := CASE WHEN cardinality(v_needed) = 0 THEN 0 ELSE cardinality(v_matched)::numeric / cardinality(v_needed) END;
  IF (w ->> 'skills')::numeric > 0 THEN
    IF cardinality(v_matched) > 0 THEN
      SELECT string_agg(COALESCE(t.name, x), ', ' ORDER BY o) INTO v_names FROM unnest(v_matched) WITH ORDINALITY u(x, o) LEFT JOIN public.care_types t ON t.code = u.x;
      kf := kf || format('Matches %s of %s required care skills (%s)', cardinality(v_matched), cardinality(v_needed), v_names);
    ELSE
      wn := wn || 'No matching skills on file for this shift''s care requirements'::text;
    END IF;
  END IF;
  -- service area (neutral when the caregiver declares no zips or the client has none)
  IF COALESCE(cardinality(g.service_zipcodes), 0) > 0 AND v_zip IS NOT NULL AND NOT (v_zip = ANY (g.service_zipcodes)) THEN
    f_area := 0;
    IF (w ->> 'service_area')::numeric > 0 THEN wn := wn || format('Outside service area (client zip %s not in caregiver''s service zip list)', v_zip); END IF;
  END IF;
  -- availability (neutral when none declared); day of week as the function reads it (Sunday = 0)
  IF EXISTS (SELECT 1 FROM public.caregiver_availability a WHERE a.caregiver_id = g.id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.caregiver_availability a WHERE a.caregiver_id = g.id AND a.day_of_week = extract(dow FROM s.shift_date)::int
                     AND a.is_available IS DISTINCT FROM false AND a.start_time <= s.start_time AND a.end_time >= s.end_time) THEN
      f_avail := 0;
      IF (w ->> 'availability')::numeric > 0 THEN wn := wn || 'Outside declared availability for this shift''s day/time'::text; END IF;
    END IF;
  END IF;
  -- reliability
  v_rel := COALESCE(g.reliability_score, 100);
  f_rel := LEAST(GREATEST(v_rel, 0), 100)::numeric / 100;
  IF (w ->> 'reliability')::numeric > 0 AND v_rel < 70 THEN wn := wn || format('Reliability score %s is below the 70 threshold', v_rel); END IF;
  -- performance (neutral when not rated yet)
  SELECT p.avg_rating, p.rating_count, p.completion_rate, p.on_time_rate INTO perf FROM public.caregiver_performance p WHERE p.caregiver_id = g.id;
  IF perf.avg_rating IS NOT NULL THEN
    f_perf := ((perf.avg_rating / 5) + (COALESCE(perf.completion_rate, 100) / 100) + (COALESCE(perf.on_time_rate, 100) / 100)) / 3;
    IF (w ->> 'performance')::numeric > 0 THEN
      kf := kf || format('Rated %s/5.0 from %s shifts (completion %s%%, on-time %s%%)', trim_scale(perf.avg_rating), perf.rating_count,
                         trim_scale(perf.completion_rate), trim_scale(perf.on_time_rate));
    END IF;
  ELSIF (w ->> 'performance')::numeric > 0 THEN
    kf := kf || 'New caregiver — not yet rated (scored neutrally)'::text;
  END IF;
  -- continuity (owner 4c): served this client at least once in the last 60 days; more and more recent visits rank
  -- higher; the client's preferred caregiver adds weight
  SELECT count(*), max(o.shift_date) INTO v_n, v_last FROM public.shift_assignments a JOIN public.shifts o ON o.id = a.shift_id
   WHERE a.caregiver_id = g.id AND a.status <> 'cancelled' AND o.client_id = s.client_id AND o.status::text <> 'cancelled'
     AND o.shift_date >= _today - 60 AND o.shift_date < _today;
  IF v_n > 0 THEN f_cont := 0.6 * LEAST(v_n, 6)::numeric / 6 + 0.4 * GREATEST(0, 1 - (_today - v_last)::numeric / 60); END IF;
  IF v_pref = g.id THEN f_cont := LEAST(1, f_cont + 0.3); END IF;
  IF (w ->> 'continuity')::numeric > 0 THEN
    IF v_n > 0 THEN kf := format('Served this client %s× in the last 60 days (last %s)', v_n, to_char(v_last, 'Mon FMDD')) || kf; END IF;
    IF v_pref = g.id THEN kf := 'Preferred caregiver for this client'::text || kf; END IF;
  END IF;
  v_score := round((w ->> 'skills')::numeric * f_skill + (w ->> 'service_area')::numeric * f_area + (w ->> 'availability')::numeric * f_avail
                 + (w ->> 'reliability')::numeric * f_rel + (w ->> 'performance')::numeric * f_perf + (w ->> 'continuity')::numeric * f_cont);
  RETURN jsonb_build_object('score', v_score, 'key_factors', to_jsonb(kf), 'warnings', to_jsonb(wn),
    'factors', jsonb_build_object('skills', round(f_skill, 3), 'service_area', f_area, 'availability', f_avail, 'reliability', round(f_rel, 3),
                                  'performance', round(f_perf, 3), 'continuity', round(f_cont, 3)),
    'continuity_visits', v_n);
END $$;
REVOKE ALL ON FUNCTION public.cp_match_factors(uuid, uuid, jsonb, date) FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 3. The gate (owner 4a): who can be PROPOSED (Smart Assign, Auto-assign) — only caregivers who would pass with
--    enforcement ON: no hard and no soft issue, none of the care-plan checks the switch would turn into blocks
--    (credentials, training on the current IPOS, authorization / units), and the client onboarded (care-plan offices).
--    Manual assignment is unchanged (today's advisory lines).
-- =============================================================================================
CREATE FUNCTION public.cp_gate_issues(_result jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(i), '[]'::jsonb) FROM (
    SELECT i FROM jsonb_array_elements(COALESCE(_result -> 'hard', '[]'::jsonb)) i
    UNION ALL SELECT i FROM jsonb_array_elements(COALESCE(_result -> 'soft', '[]'::jsonb)) i
    UNION ALL SELECT i FROM jsonb_array_elements(COALESCE(_result -> 'advisory', '[]'::jsonb)) i
      WHERE i ->> 'code' IN ('credential_missing', 'training_missing', 'authorization_missing', 'authorization_expired', 'units_short', 'units_short_period')) x
$$;
REVOKE ALL ON FUNCTION public.cp_gate_issues(jsonb) FROM PUBLIC, anon, authenticated;

-- The client side of the gate: in a care-plan office the client must be onboarded.
CREATE FUNCTION public.cp_client_gate(_client_id uuid, _office_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_on boolean; o jsonb;
BEGIN
  SELECT COALESCE(care_plan_module_enabled, false) OR COALESCE(compliance_enforcement_enabled, false) INTO v_on FROM public.virtual_office WHERE id = _office_id;
  IF NOT COALESCE(v_on, false) THEN RETURN NULL; END IF;
  o := cp_client_onboarding(_client_id);
  IF COALESCE((o ->> 'onboarded')::boolean, false) THEN RETURN NULL; END IF;
  RETURN format('Client not onboarded (%s of %s)', (SELECT count(*) FROM jsonb_array_elements(o -> 'items') e WHERE e ->> 'status' IN ('complete', 'not_applicable')),
                jsonb_array_length(o -> 'items'));
END $$;
REVOKE ALL ON FUNCTION public.cp_client_gate(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Candidates of one shift with eligibility, gate and score (state as of now, including tentative assignments).
CREATE FUNCTION public.cp_shift_candidates(_shift_id uuid, _weights jsonb, _today date)
RETURNS TABLE (caregiver_id uuid, ok boolean, issues jsonb, m jsonb) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; v_ctx jsonb;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  v_ctx := cp_shift_client_context(_shift_id);
  RETURN QUERY
  SELECT g.id, jsonb_array_length(cp_gate_issues(r)) = 0, cp_gate_issues(r), cp_match_factors(_shift_id, g.id, _weights, _today)
    FROM public.caregivers g
    CROSS JOIN LATERAL (SELECT cp_eligibility_core(_shift_id, g.id, v_ctx) r) e
   WHERE g.agency_id = s.agency_id AND g.is_active = true   -- the pool match-caregiver uses
     AND (s.virtual_office_id IS NULL OR g.virtual_office_id = s.virtual_office_id);
END $$;
REVOKE ALL ON FUNCTION public.cp_shift_candidates(uuid, jsonb, date) FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 4. Smart Assign (single shift, owner 4f): the same gate and scoring.
-- =============================================================================================
CREATE FUNCTION public.suggest_caregivers(_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; w jsonb; v_today date; v_client text;
BEGIN
  SELECT sh.*, COALESCE(vo.timezone, 'America/New_York') tz INTO s FROM public.shifts sh LEFT JOIN public.virtual_office vo ON vo.id = sh.virtual_office_id WHERE sh.id = _shift_id;
  PERFORM cp_require_scope(s.agency_id, s.virtual_office_id, '{manager,scheduler,agency_admin}'::public.app_role[]);
  w := cp_office_match_weights(s.virtual_office_id);
  v_today := (now() AT TIME ZONE s.tz)::date;
  v_client := cp_client_gate(s.client_id, s.virtual_office_id);
  RETURN jsonb_build_object('weights', w, 'client_blocked', v_client,
    'matches', CASE WHEN v_client IS NOT NULL THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'caregiver_id', c.caregiver_id, 'match_score', (c.m ->> 'score')::int, 'key_factors', c.m -> 'key_factors', 'warnings', c.m -> 'warnings',
        'caregiver', jsonb_build_object('id', g.id, 'first_name', g.first_name, 'last_name', g.last_name, 'avg_rating', p.avg_rating, 'rating_count', COALESCE(p.rating_count, 0)))
        ORDER BY (c.m ->> 'score')::int DESC, g.last_name, g.first_name, g.id)
      FROM cp_shift_candidates(_shift_id, w, v_today) c JOIN public.caregivers g ON g.id = c.caregiver_id
      LEFT JOIN public.caregiver_performance p ON p.caregiver_id = g.id WHERE c.ok), '[]'::jsonb) END,
    'not_eligible', (SELECT count(*) FROM cp_shift_candidates(_shift_id, w, v_today) c WHERE NOT c.ok));
END $$;
REVOKE ALL ON FUNCTION public.suggest_caregivers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_caregivers(uuid) TO authenticated;

-- =============================================================================================
-- 5. Auto-assign (owner 4d, 4e). propose_auto_assignments is READ-ONLY to the outside: it assigns each pick
--    tentatively through the existing assign_caregiver_to_shift inside a block that is always rolled back, so the
--    unchanged engine sees the earlier picks: authorization units and period caps, group ratio, weekly hours and
--    overlapping times on the SAME date are running totals over the whole set (two visits on one day that don't overlap
--    are fine; different dates never conflict). Hardest shifts (fewest eligible caregivers) first.
-- =============================================================================================
CREATE FUNCTION public.cp_unassigned_shifts(_office_id uuid, _from date, _to date, _today date)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id FROM public.shifts s
   WHERE s.virtual_office_id = _office_id AND s.shift_date BETWEEN GREATEST(_from, _today) AND _to
     AND s.status::text NOT IN ('cancelled', 'completed', 'in_progress') AND s.caregiver_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.shift_assignments a WHERE a.shift_id = s.id AND a.status <> 'cancelled')
   ORDER BY s.shift_date, s.start_time, s.id
   LIMIT 500
$$;
REVOKE ALL ON FUNCTION public.cp_unassigned_shifts(uuid, date, date, date) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.propose_auto_assignments(_office_id uuid, _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.propose_auto_assignments(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_auto_assignments(uuid, date, date) TO authenticated;

-- Commit what the manager confirmed, in the given order: each one re-checked (the gate) and assigned through the
-- existing path (shift_assigned as today); one auto_assign_run event for the run (ids and counts only).
CREATE FUNCTION public.commit_auto_assignments(_office_id uuid, _from date, _to date, _assignments jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.commit_auto_assignments(uuid, date, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_auto_assignments(uuid, date, date, jsonb) TO authenticated;

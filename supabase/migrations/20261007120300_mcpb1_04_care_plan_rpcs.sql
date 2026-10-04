-- Phase B1-04 — care plan (Layer B): create_care_plan, renew_care_plan, update_care_plan_fields,
-- upsert_care_plan_goals, set_objective_measures.
-- Ripple care-plan module. Schema plan §4, arch §12. DRAFT FOR REVIEW. Not pushed.
--
-- Role tier: clinical writes = manager, agency_admin (system_admin is not in the clinical tier).
-- Agency/office always from the client / plan row. Plan create/renew lock the client row; every
-- plan write locks the plan row (two editors can't interleave a renewal with an edit).
-- training_version rule (write path, not UI):
--   * create: training_version = 1 + the client's highest so far (1 for a first plan);
--   * renew (every new IPOS version, identical goals included): +1;
--   * upsert_care_plan_goals: +1 when the goal/objective/Instructions-for-Staff tree actually
--     changes AND someone was already trained on the current version (an in-service or training
--     form exists at it). Before any training, the plan is still being drafted and edits stay on
--     the same version (nobody needs retraining). A no-op save changes nothing and writes no event;
--   * update_care_plan_fields (narratives, header) and set_objective_measures: never.
-- Instances keep field_snapshot (the IPOS shell resolved per Q15 at create/renew time);
-- field_values are validated against it.
-- Audited: care_plan_created, care_plan_renewed, care_plan_updated, training_version_bumped,
-- objective_measures_set (ids, versions and counts only).

-- =============================================================================================
-- Header (spine columns) validation — internal
-- =============================================================================================
CREATE FUNCTION public.cp_validate_plan_header(_h jsonb, _require_dates boolean)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE k text; d_eff date; d_exp date;
BEGIN
  IF _h IS NULL OR jsonb_typeof(_h) <> 'object' THEN RAISE EXCEPTION 'header must be a JSON object' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(_h) LOOP
    IF k <> ALL (ARRAY['meeting_date','effective_date','expiration_date','next_review_date','review_frequency','michicans_date',
                       'facilitator_name','recorder_name','discharge_criteria','signed_by','signed_date']) THEN
      RAISE EXCEPTION 'Unknown header field "%"', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(_h -> k) NOT IN ('string', 'null') THEN RAISE EXCEPTION 'Header field "%" must be text or null', k USING ERRCODE = '22023'; END IF;
    IF k LIKE '%date' AND _h ->> k IS NOT NULL THEN
      BEGIN PERFORM (_h ->> k)::date; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Header field "%" must be a date', k USING ERRCODE = '22023'; END;
    END IF;
    IF length(COALESCE(_h ->> k, '')) > (CASE k WHEN 'discharge_criteria' THEN 8000 ELSE 200 END) THEN
      RAISE EXCEPTION 'Header field "%" is too long', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  d_eff := (_h ->> 'effective_date')::date; d_exp := (_h ->> 'expiration_date')::date;
  IF _require_dates AND (d_eff IS NULL OR d_exp IS NULL) THEN
    RAISE EXCEPTION 'A plan needs an effective and an expiration date' USING ERRCODE = '22023';
  END IF;
  IF d_eff IS NOT NULL AND d_exp IS NOT NULL AND d_exp < d_eff THEN
    RAISE EXCEPTION 'The expiration date is before the effective date' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cp_validate_plan_header(jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- Canonical goal tree (no ids), used to detect a real change. Internal.
CREATE FUNCTION public.cp_goal_tree(_care_plan_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('seq', g.seq, 'goal_text', g.goal_text, 'target_start', g.target_start,
           'target_end', g.target_end,
           'objectives', COALESCE((SELECT jsonb_agg(jsonb_build_object('letter', o.letter, 'seq', o.seq,
               'objective_text', o.objective_text, 'staff_instructions', o.staff_instructions, 'service_type', o.service_type,
               'responsible_party', o.responsible_party, 'target_start', o.target_start, 'target_end', o.target_end)
               ORDER BY o.seq, o.objective_text) FROM public.care_plan_objectives o WHERE o.goal_id = g.id), '[]'::jsonb))
         ORDER BY g.seq), '[]'::jsonb)
  FROM public.care_plan_goals g WHERE g.care_plan_id = _care_plan_id
$$;
REVOKE ALL ON FUNCTION public.cp_goal_tree(uuid) FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- create_care_plan
-- =============================================================================================
CREATE FUNCTION public.create_care_plan(_client_id uuid, _plan_type public.care_plan_type,
                                        _header jsonb, _field_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record; v_ver uuid; v_snap jsonb; v_id uuid; v_version int; v_tv int;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO c FROM public.clients WHERE id = _client_id FOR UPDATE;
  PERFORM cp_require_scope(c.agency_id, c.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF _plan_type IS NULL THEN RAISE EXCEPTION 'plan type is required' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.care_plans WHERE client_id = c.id AND status = 'active') THEN
    RAISE EXCEPTION 'This client already has an active plan; renew it instead' USING ERRCODE = '22023';
  END IF;
  PERFORM cp_validate_plan_header(_header, true);
  v_ver := cp_resolve_template(c.agency_id, c.virtual_office_id, 'ipos', NULL);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;
  PERFORM cp_validate_field_values(v_snap, COALESCE(_field_values, '{}'::jsonb));
  SELECT COALESCE(max(version), 0) + 1, COALESCE(max(training_version), 0) + 1 INTO v_version, v_tv
    FROM public.care_plans WHERE client_id = c.id;

  INSERT INTO public.care_plans (agency_id, virtual_office_id, client_id, version, training_version, status, plan_type,
    meeting_date, effective_date, expiration_date, next_review_date, review_frequency, michicans_date,
    facilitator_name, recorder_name, discharge_criteria, signed_by, signed_date,
    template_id, template_version, field_snapshot, field_values)
  VALUES (c.agency_id, c.virtual_office_id, c.id, v_version, v_tv, 'active', _plan_type,
    (_header ->> 'meeting_date')::date, (_header ->> 'effective_date')::date, (_header ->> 'expiration_date')::date,
    (_header ->> 'next_review_date')::date, _header ->> 'review_frequency', (_header ->> 'michicans_date')::date,
    _header ->> 'facilitator_name', _header ->> 'recorder_name', _header ->> 'discharge_criteria',
    _header ->> 'signed_by', (_header ->> 'signed_date')::date,
    (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap, COALESCE(_field_values, '{}'::jsonb))
  RETURNING id INTO v_id;

  PERFORM cp_audit(c.agency_id, c.virtual_office_id, 'care_plan_created', 'care_plan', v_id,
    jsonb_build_object('care_plan_id', v_id, 'version', v_version, 'training_version', v_tv));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_care_plan(uuid, public.care_plan_type, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_care_plan(uuid, public.care_plan_type, jsonb, jsonb) TO authenticated;

-- =============================================================================================
-- renew_care_plan — new IPOS version: new row, old row superseded, children copied, +1 training
-- =============================================================================================
-- _header NULL = keep the current header; _field_values NULL = carry values whose keys exist in
-- the (possibly newer) IPOS shell, others under "_retired".
CREATE FUNCTION public.renew_care_plan(_care_plan_id uuid, _plan_type public.care_plan_type DEFAULT 'annual',
                                       _header jsonb DEFAULT NULL, _field_values jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p record; v_ver uuid; v_snap jsonb; v_vals jsonb; v_keys text[]; v_retired jsonb; v_new uuid; v_version int; v_tv int;
  g record; o record; tn record; v_gid uuid; v_oid uuid; v_omap jsonb := '{}'::jsonb; v_tmap jsonb := '{}'::jsonb; h jsonb;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR UPDATE;
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  PERFORM 1 FROM public.clients WHERE id = p.client_id FOR UPDATE;
  IF p.status <> 'active' THEN RAISE EXCEPTION 'Only the active plan can be renewed' USING ERRCODE = '22023'; END IF;

  h := COALESCE(_header, jsonb_strip_nulls(jsonb_build_object('meeting_date', p.meeting_date, 'effective_date', p.effective_date,
         'expiration_date', p.expiration_date, 'next_review_date', p.next_review_date, 'review_frequency', p.review_frequency,
         'michicans_date', p.michicans_date, 'facilitator_name', p.facilitator_name, 'recorder_name', p.recorder_name,
         'discharge_criteria', p.discharge_criteria, 'signed_by', p.signed_by, 'signed_date', p.signed_date)));
  -- jsonb_build_object turns dates into strings; validate as a header
  PERFORM cp_validate_plan_header(h, true);

  v_ver := cp_resolve_template(p.agency_id, p.virtual_office_id, 'ipos', NULL);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;
  IF _field_values IS NOT NULL THEN
    v_vals := _field_values;
  ELSIF v_snap IS NULL THEN
    v_vals := '{}'::jsonb;
  ELSE
    SELECT COALESCE(array_agg(x ->> 'field_key'), ARRAY[]::text[]) INTO v_keys
      FROM jsonb_array_elements(v_snap -> 'fields') x WHERE x ->> 'storage' = 'field_value';
    SELECT COALESCE(jsonb_object_agg(key, value) FILTER (WHERE key = ANY (v_keys)), '{}'::jsonb),
           COALESCE(jsonb_object_agg(key, value) FILTER (WHERE key <> ALL (v_keys) AND key <> '_retired'), '{}'::jsonb)
      INTO v_vals, v_retired FROM jsonb_each(p.field_values);
    v_retired := COALESCE(p.field_values -> '_retired', '{}'::jsonb) || v_retired;
    IF v_retired <> '{}'::jsonb THEN v_vals := v_vals || jsonb_build_object('_retired', v_retired); END IF;
  END IF;
  PERFORM cp_validate_field_values(v_snap, v_vals);

  SELECT max(version) + 1, max(training_version) + 1 INTO v_version, v_tv FROM public.care_plans WHERE client_id = p.client_id;
  UPDATE public.care_plans SET status = 'superseded' WHERE id = p.id;
  INSERT INTO public.care_plans (agency_id, virtual_office_id, client_id, version, training_version, status, plan_type,
    meeting_date, effective_date, expiration_date, next_review_date, review_frequency, michicans_date,
    facilitator_name, recorder_name, discharge_criteria, signed_by, signed_date,
    template_id, template_version, field_snapshot, field_values)
  VALUES (p.agency_id, p.virtual_office_id, p.client_id, v_version, v_tv, 'active', COALESCE(_plan_type, 'annual'),
    (h ->> 'meeting_date')::date, (h ->> 'effective_date')::date, (h ->> 'expiration_date')::date,
    (h ->> 'next_review_date')::date, h ->> 'review_frequency', (h ->> 'michicans_date')::date,
    h ->> 'facilitator_name', h ->> 'recorder_name', h ->> 'discharge_criteria', h ->> 'signed_by', (h ->> 'signed_date')::date,
    (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap, v_vals)
  RETURNING id INTO v_new;

  -- copy children forward for editing (history stays on the superseded row)
  FOR g IN SELECT * FROM public.care_plan_goals WHERE care_plan_id = p.id ORDER BY seq LOOP
    INSERT INTO public.care_plan_goals (care_plan_id, seq, goal_text, target_start, target_end)
    VALUES (v_new, g.seq, g.goal_text, g.target_start, g.target_end) RETURNING id INTO v_gid;
    FOR o IN SELECT * FROM public.care_plan_objectives WHERE goal_id = g.id ORDER BY seq LOOP
      INSERT INTO public.care_plan_objectives (goal_id, letter, seq, objective_text, staff_instructions, service_type,
                                               responsible_party, target_start, target_end)
      VALUES (v_gid, o.letter, o.seq, o.objective_text, o.staff_instructions, o.service_type, o.responsible_party,
              o.target_start, o.target_end) RETURNING id INTO v_oid;
      v_omap := v_omap || jsonb_build_object(o.id::text, v_oid);
      INSERT INTO public.objective_measures (objective_id, measure_type_id, seq, prompt_text, options, trial_count, is_active)
      SELECT v_oid, measure_type_id, seq, prompt_text, options, trial_count, is_active
        FROM public.objective_measures WHERE objective_id = o.id;
    END LOOP;
  END LOOP;
  FOR tn IN SELECT * FROM public.care_plan_treatment_needs WHERE care_plan_id = p.id LOOP
    INSERT INTO public.care_plan_treatment_needs (care_plan_id, domain, to_address, new_need, treatment_recommendation, sort_order)
    VALUES (v_new, tn.domain, tn.to_address, tn.new_need, tn.treatment_recommendation, tn.sort_order) RETURNING id INTO v_oid;
    v_tmap := v_tmap || jsonb_build_object(tn.id::text, v_oid);
  END LOOP;
  INSERT INTO public.care_plan_objective_needs (objective_id, treatment_need_id)
  SELECT (v_omap ->> n.objective_id::text)::uuid, (v_tmap ->> n.treatment_need_id::text)::uuid
    FROM public.care_plan_objective_needs n
    JOIN public.care_plan_objectives o2 ON o2.id = n.objective_id
    JOIN public.care_plan_goals g2 ON g2.id = o2.goal_id
   WHERE g2.care_plan_id = p.id;
  INSERT INTO public.care_plan_attendees (care_plan_id, name, relationship, attended, contributed)
    SELECT v_new, name, relationship, attended, contributed FROM public.care_plan_attendees WHERE care_plan_id = p.id;
  INSERT INTO public.care_plan_needs (care_plan_id, source, item_kind, domain, item_text, level_of_need, addressed, additional_info)
    SELECT v_new, source, item_kind, domain, item_text, level_of_need, addressed, additional_info FROM public.care_plan_needs WHERE care_plan_id = p.id;
  INSERT INTO public.care_plan_dsm_recommendations (care_plan_id, service, outcome_code, notes)
    SELECT v_new, service, outcome_code, notes FROM public.care_plan_dsm_recommendations WHERE care_plan_id = p.id;
  INSERT INTO public.care_plan_natural_supports (care_plan_id, name, support_type, status, how_they_help)
    SELECT v_new, name, support_type, status, how_they_help FROM public.care_plan_natural_supports WHERE care_plan_id = p.id;
  INSERT INTO public.care_plan_external_services (care_plan_id, provider_program, auth_reference, service, effective_date,
                                                  expiration_date, units_text, description)
    SELECT v_new, provider_program, auth_reference, service, effective_date, expiration_date, units_text, description
      FROM public.care_plan_external_services WHERE care_plan_id = p.id;

  PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'care_plan_renewed', 'care_plan', v_new,
    jsonb_build_object('care_plan_id', v_new, 'previous_care_plan_id', p.id, 'version', v_version, 'training_version', v_tv));
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.renew_care_plan(uuid, public.care_plan_type, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_care_plan(uuid, public.care_plan_type, jsonb, jsonb) TO authenticated;

-- =============================================================================================
-- update_care_plan_fields — narratives and header; never bumps training_version
-- =============================================================================================
-- _header: only the keys given change (explicit null clears). _field_values: full replacement,
-- validated against the plan's own snapshot.
CREATE FUNCTION public.update_care_plan_fields(_care_plan_id uuid, _header jsonb DEFAULT NULL, _field_values jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; h jsonb;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR UPDATE;
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF p.status <> 'active' THEN RAISE EXCEPTION 'Only the active plan can be edited' USING ERRCODE = '22023'; END IF;
  IF _header IS NULL AND _field_values IS NULL THEN RAISE EXCEPTION 'Nothing to update' USING ERRCODE = '22023'; END IF;
  h := COALESCE(_header, '{}'::jsonb);
  PERFORM cp_validate_plan_header(h, false);
  IF _field_values IS NOT NULL THEN PERFORM cp_validate_field_values(p.field_snapshot, _field_values); END IF;
  UPDATE public.care_plans SET
    meeting_date = CASE WHEN h ? 'meeting_date' THEN (h ->> 'meeting_date')::date ELSE meeting_date END,
    effective_date = CASE WHEN h ? 'effective_date' THEN (h ->> 'effective_date')::date ELSE effective_date END,
    expiration_date = CASE WHEN h ? 'expiration_date' THEN (h ->> 'expiration_date')::date ELSE expiration_date END,
    next_review_date = CASE WHEN h ? 'next_review_date' THEN (h ->> 'next_review_date')::date ELSE next_review_date END,
    review_frequency = CASE WHEN h ? 'review_frequency' THEN h ->> 'review_frequency' ELSE review_frequency END,
    michicans_date = CASE WHEN h ? 'michicans_date' THEN (h ->> 'michicans_date')::date ELSE michicans_date END,
    facilitator_name = CASE WHEN h ? 'facilitator_name' THEN h ->> 'facilitator_name' ELSE facilitator_name END,
    recorder_name = CASE WHEN h ? 'recorder_name' THEN h ->> 'recorder_name' ELSE recorder_name END,
    discharge_criteria = CASE WHEN h ? 'discharge_criteria' THEN h ->> 'discharge_criteria' ELSE discharge_criteria END,
    signed_by = CASE WHEN h ? 'signed_by' THEN h ->> 'signed_by' ELSE signed_by END,
    signed_date = CASE WHEN h ? 'signed_date' THEN (h ->> 'signed_date')::date ELSE signed_date END,
    field_values = COALESCE(_field_values, field_values)
  WHERE id = p.id;
  IF EXISTS (SELECT 1 FROM public.care_plans WHERE id = p.id AND expiration_date < effective_date) THEN
    RAISE EXCEPTION 'The expiration date is before the effective date' USING ERRCODE = '22023';
  END IF;
  PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'care_plan_updated', 'care_plan', p.id,
    jsonb_build_object('care_plan_id', p.id, 'header_fields', (SELECT count(*) FROM jsonb_object_keys(h)),
                       'field_values_replaced', _field_values IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION public.update_care_plan_fields(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_care_plan_fields(uuid, jsonb, jsonb) TO authenticated;

-- =============================================================================================
-- upsert_care_plan_goals — the full goal/objective tree of the active plan (sequence preserved)
-- =============================================================================================
-- _goals: [{id?, seq, goal_text, target_start?, target_end?, objectives: [{id?, letter?, seq,
--   objective_text, staff_instructions?, service_type?, responsible_party, target_start?, target_end?}]}]
-- Rows with an id are updated (they must belong to this plan); rows without are inserted; goals
-- and objectives of the plan missing from the payload are deleted (their measures go with them).
-- this_agency objectives need a service_type that the plan's office maps (office_service_types);
-- other responsible parties (case_management, ...) are reference objectives: service_type optional.
-- A real change after training has started bumps training_version by 1 (event
-- training_version_bumped); a real change before any training is an ordinary edit (event
-- care_plan_updated). Exactly one event either way; none for a no-op save.
CREATE FUNCTION public.upsert_care_plan_goals(_care_plan_id uuid, _goals jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p record; g jsonb; o jsonb; v_gid uuid; v_oid uuid; v_before jsonb; v_after jsonb;
  v_keep_g uuid[] := ARRAY[]::uuid[]; v_keep_o uuid[] := ARRAY[]::uuid[]; v_seqs int[]; v_oseqs int[];
  v_rp public.objective_responsible_party; v_st text; v_tv int; v_ng int := 0; v_no int := 0;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR UPDATE;
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF p.status <> 'active' THEN RAISE EXCEPTION 'Only the active plan can be edited' USING ERRCODE = '22023'; END IF;
  IF _goals IS NULL OR jsonb_typeof(_goals) <> 'array' OR jsonb_array_length(_goals) > 50 THEN
    RAISE EXCEPTION 'goals must be a list of at most 50 goals' USING ERRCODE = '22023';
  END IF;

  -- validate everything before writing anything
  SELECT array_agg((x ->> 'seq')::int) INTO v_seqs FROM jsonb_array_elements(_goals) x;
  IF (SELECT count(DISTINCT s) FROM unnest(v_seqs) s) <> jsonb_array_length(_goals) OR array_position(v_seqs, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Each goal needs a unique seq' USING ERRCODE = '22023';
  END IF;
  FOR g IN SELECT x FROM jsonb_array_elements(_goals) x LOOP
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(g) k WHERE k <> ALL (ARRAY['id','seq','goal_text','target_start','target_end','objectives'])) THEN
      RAISE EXCEPTION 'Unknown goal property' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(btrim(g ->> 'goal_text'), '') = '' OR length(g ->> 'goal_text') > 4000 THEN
      RAISE EXCEPTION 'Each goal needs text of at most 4000 characters' USING ERRCODE = '22023';
    END IF;
    IF g ? 'id' AND NOT EXISTS (SELECT 1 FROM public.care_plan_goals WHERE id = (g ->> 'id')::uuid AND care_plan_id = p.id) THEN
      RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(COALESCE(g -> 'objectives', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(g -> 'objectives', '[]'::jsonb)) > 50 THEN
      RAISE EXCEPTION 'objectives must be a list of at most 50' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg((x ->> 'seq')::int) INTO v_oseqs FROM jsonb_array_elements(COALESCE(g -> 'objectives', '[]'::jsonb)) x;
    IF v_oseqs IS NOT NULL AND ((SELECT count(DISTINCT s) FROM unnest(v_oseqs) s) <> cardinality(v_oseqs) OR array_position(v_oseqs, NULL) IS NOT NULL) THEN
      RAISE EXCEPTION 'Each objective in a goal needs a unique seq' USING ERRCODE = '22023';
    END IF;
    FOR o IN SELECT x FROM jsonb_array_elements(COALESCE(g -> 'objectives', '[]'::jsonb)) x LOOP
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(o) k WHERE k <> ALL (ARRAY['id','letter','seq','objective_text','staff_instructions',
                 'service_type','responsible_party','target_start','target_end'])) THEN
        RAISE EXCEPTION 'Unknown objective property' USING ERRCODE = '22023';
      END IF;
      IF COALESCE(btrim(o ->> 'objective_text'), '') = '' OR length(o ->> 'objective_text') > 4000
         OR length(COALESCE(o ->> 'staff_instructions', '')) > 8000 OR length(COALESCE(o ->> 'letter', '')) > 10 THEN
        RAISE EXCEPTION 'Objective text (4000), Instructions for Staff (8000) or letter (10) too long or empty' USING ERRCODE = '22023';
      END IF;
      BEGIN v_rp := COALESCE(o ->> 'responsible_party', 'this_agency')::public.objective_responsible_party;
      EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid responsible_party' USING ERRCODE = '22023'; END;
      v_st := o ->> 'service_type';
      IF v_rp = 'this_agency' AND (v_st IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.office_service_types s WHERE s.virtual_office_id = p.virtual_office_id
             AND s.service_type = v_st AND s.is_active)) THEN
        RAISE EXCEPTION 'An objective delivered by this agency needs a service type this office provides' USING ERRCODE = '22023';
      END IF;
      IF v_st IS NOT NULL AND v_st !~ '^[a-z][a-z0-9_]{0,62}$' THEN RAISE EXCEPTION 'Invalid service_type' USING ERRCODE = '22023'; END IF;
      IF o ? 'id' AND NOT EXISTS (SELECT 1 FROM public.care_plan_objectives ob JOIN public.care_plan_goals gg ON gg.id = ob.goal_id
                                  WHERE ob.id = (o ->> 'id')::uuid AND gg.care_plan_id = p.id) THEN
        RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END LOOP;

  v_before := cp_goal_tree(p.id);
  SELECT COALESCE(array_agg((x ->> 'id')::uuid) FILTER (WHERE x ? 'id'), ARRAY[]::uuid[]) INTO v_keep_g FROM jsonb_array_elements(_goals) x;
  SELECT COALESCE(array_agg((o2 ->> 'id')::uuid) FILTER (WHERE o2 ? 'id'), ARRAY[]::uuid[]) INTO v_keep_o
    FROM jsonb_array_elements(_goals) x, jsonb_array_elements(COALESCE(x -> 'objectives', '[]'::jsonb)) o2;
  DELETE FROM public.care_plan_objectives ob USING public.care_plan_goals gg
   WHERE gg.id = ob.goal_id AND gg.care_plan_id = p.id AND ob.id <> ALL (v_keep_o);

  FOR g IN SELECT x FROM jsonb_array_elements(_goals) x LOOP
    IF g ? 'id' THEN
      v_gid := (g ->> 'id')::uuid;
      UPDATE public.care_plan_goals SET seq = (g ->> 'seq')::int, goal_text = btrim(g ->> 'goal_text'),
             target_start = (g ->> 'target_start')::date, target_end = (g ->> 'target_end')::date WHERE id = v_gid;
    ELSE
      INSERT INTO public.care_plan_goals (care_plan_id, seq, goal_text, target_start, target_end)
      VALUES (p.id, (g ->> 'seq')::int, btrim(g ->> 'goal_text'), (g ->> 'target_start')::date, (g ->> 'target_end')::date)
      RETURNING id INTO v_gid;
      v_keep_g := v_keep_g || v_gid;
    END IF;
    v_ng := v_ng + 1;
    FOR o IN SELECT x FROM jsonb_array_elements(COALESCE(g -> 'objectives', '[]'::jsonb)) x LOOP
      IF o ? 'id' THEN
        UPDATE public.care_plan_objectives SET goal_id = v_gid, letter = o ->> 'letter', seq = (o ->> 'seq')::int,
               objective_text = btrim(o ->> 'objective_text'), staff_instructions = o ->> 'staff_instructions',
               service_type = o ->> 'service_type',
               responsible_party = COALESCE(o ->> 'responsible_party', 'this_agency')::public.objective_responsible_party,
               target_start = (o ->> 'target_start')::date, target_end = (o ->> 'target_end')::date
         WHERE id = (o ->> 'id')::uuid;
      ELSE
        INSERT INTO public.care_plan_objectives (goal_id, letter, seq, objective_text, staff_instructions, service_type,
                                                 responsible_party, target_start, target_end)
        VALUES (v_gid, o ->> 'letter', (o ->> 'seq')::int, btrim(o ->> 'objective_text'), o ->> 'staff_instructions',
                o ->> 'service_type', COALESCE(o ->> 'responsible_party', 'this_agency')::public.objective_responsible_party,
                (o ->> 'target_start')::date, (o ->> 'target_end')::date);
      END IF;
      v_no := v_no + 1;
    END LOOP;
  END LOOP;

  -- goals dropped from the payload go last, after kept objectives were re-parented
  DELETE FROM public.care_plan_goals WHERE care_plan_id = p.id AND id <> ALL (v_keep_g);
  v_after := cp_goal_tree(p.id);
  v_tv := p.training_version;
  IF v_after IS DISTINCT FROM v_before THEN
    IF EXISTS (SELECT 1 FROM public.plan_inservice_forms WHERE care_plan_id = p.id AND training_version = p.training_version)
       OR EXISTS (SELECT 1 FROM public.plan_training_forms WHERE care_plan_id = p.id AND training_version = p.training_version) THEN
      v_tv := p.training_version + 1;
      UPDATE public.care_plans SET training_version = v_tv WHERE id = p.id;
      PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'training_version_bumped', 'care_plan', p.id,
        jsonb_build_object('care_plan_id', p.id, 'training_version', v_tv, 'goals', v_ng, 'objectives', v_no));
    ELSE
      PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'care_plan_updated', 'care_plan', p.id,
        jsonb_build_object('care_plan_id', p.id, 'training_version', v_tv, 'goals', v_ng, 'objectives', v_no));
    END IF;
  END IF;
  RETURN jsonb_build_object('training_version', v_tv, 'changed', v_after IS DISTINCT FROM v_before, 'goals', v_ng, 'objectives', v_no);
END $$;
REVOKE ALL ON FUNCTION public.upsert_care_plan_goals(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_care_plan_goals(uuid, jsonb) TO authenticated;

-- =============================================================================================
-- set_objective_measures — the data questions of one this_agency objective (never bumps)
-- =============================================================================================
-- _measures: [{measure_type_id, seq, prompt_text, options?, trial_count?}] replaces the set.
-- The measure type must be active and a system row or the plan's agency row; trial_count is
-- required (1-20) for kind 'trials' and must be absent otherwise.
CREATE FUNCTION public.set_objective_measures(_objective_id uuid, _measures jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; ob record; m jsonb; mt record; v_n int;
BEGIN
  SELECT o.id, o.responsible_party, g.care_plan_id INTO ob
    FROM public.care_plan_objectives o JOIN public.care_plan_goals g ON g.id = o.goal_id WHERE o.id = _objective_id;
  SELECT * INTO p FROM public.care_plans WHERE id = ob.care_plan_id FOR UPDATE;
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF p.status <> 'active' THEN RAISE EXCEPTION 'Only the active plan can be edited' USING ERRCODE = '22023'; END IF;
  IF ob.responsible_party <> 'this_agency' THEN
    RAISE EXCEPTION 'Only objectives this agency delivers have data questions' USING ERRCODE = '22023';
  END IF;
  IF _measures IS NULL OR jsonb_typeof(_measures) <> 'array' OR jsonb_array_length(_measures) > 30 THEN
    RAISE EXCEPTION 'measures must be a list of at most 30' USING ERRCODE = '22023';
  END IF;
  FOR m IN SELECT x FROM jsonb_array_elements(_measures) x LOOP
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(m) k WHERE k <> ALL (ARRAY['measure_type_id','seq','prompt_text','options','trial_count'])) THEN
      RAISE EXCEPTION 'Unknown measure property' USING ERRCODE = '22023';
    END IF;
    SELECT id, kind INTO mt FROM public.measure_types
     WHERE id = (m ->> 'measure_type_id')::uuid AND is_active AND (agency_id IS NULL OR agency_id = p.agency_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown measure type' USING ERRCODE = '22023'; END IF;
    IF COALESCE(btrim(m ->> 'prompt_text'), '') = '' OR length(m ->> 'prompt_text') > 1000 THEN
      RAISE EXCEPTION 'Each measure needs a prompt of at most 1000 characters' USING ERRCODE = '22023';
    END IF;
    IF (mt.kind = 'trials') <> (m ->> 'trial_count' IS NOT NULL)
       OR (m ->> 'trial_count' IS NOT NULL AND (m ->> 'trial_count')::int NOT BETWEEN 1 AND 20) THEN
      RAISE EXCEPTION 'trial_count (1-20) is required for trials and only for trials' USING ERRCODE = '22023';
    END IF;
    IF m ? 'options' AND jsonb_typeof(m -> 'options') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'options must be a list' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  DELETE FROM public.objective_measures WHERE objective_id = ob.id;
  INSERT INTO public.objective_measures (objective_id, measure_type_id, seq, prompt_text, options, trial_count)
  SELECT ob.id, (x ->> 'measure_type_id')::uuid, COALESCE((x ->> 'seq')::int, (i - 1)::int), btrim(x ->> 'prompt_text'),
         CASE WHEN jsonb_typeof(x -> 'options') = 'array' THEN x -> 'options' END, (x ->> 'trial_count')::int
  FROM jsonb_array_elements(_measures) WITH ORDINALITY AS e(x, i);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'objective_measures_set', 'care_plan_objective', ob.id,
    jsonb_build_object('care_plan_id', p.id, 'objective_id', ob.id, 'measure_count', v_n));
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.set_objective_measures(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_objective_measures(uuid, jsonb) TO authenticated;

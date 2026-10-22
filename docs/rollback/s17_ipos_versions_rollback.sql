-- Rollback of 20261029120100_s17_ipos_versions.sql (S17). Restores the 10 changed functions to DEV's bodies before the
-- push (byte-identical), drops what S17 added and restores the events CHECK of 20261028120000. Stops (nothing changed)
-- while a pending version exists or S17 audit events exist. The 'pending' enum value of 20261029120000 stays (it can't
-- be dropped in place; unused once no row has it).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.care_plans WHERE status::text = 'pending') THEN
    RAISE EXCEPTION 'A pending plan version exists; activate or delete it first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE event_type IN ('care_plan_activated', 'care_plan_revised')) THEN
    RAISE EXCEPTION 'S17 audit events exist; delete them first (they reference plans only)';
  END IF;
END $$;

DROP TRIGGER trg_cp_guard_shift_dates ON public.shifts;
DROP FUNCTION public.cp_guard_shift_dates();
DROP FUNCTION public.get_shift_creation_limits(uuid);
DROP FUNCTION public.cp_shift_creation_limits(uuid, uuid);
DROP FUNCTION public.list_ipos_expiry(uuid, uuid);
DROP FUNCTION public.start_pending_plan_version(uuid, care_plan_type, jsonb, jsonb);
DROP FUNCTION public.cp_activate_due_plans();
DROP FUNCTION public.cp_try_activate_plan(uuid);
CREATE OR REPLACE FUNCTION public.update_care_plan_fields(_care_plan_id uuid, _header jsonb DEFAULT NULL::jsonb, _field_values jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.update_care_plan_fields(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_care_plan_fields(uuid, jsonb, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.upsert_care_plan_goals(_care_plan_id uuid, _goals jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.upsert_care_plan_goals(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_care_plan_goals(uuid, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.set_objective_measures(_objective_id uuid, _measures jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.set_objective_measures(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_objective_measures(uuid, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.set_care_plan_rows(_care_plan_id uuid, _entity text, _rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record; spec jsonb := cp_plan_row_spec(_entity); tbl text; cols text[]; r jsonb; v jsonb; k text; rule text; req boolean;
  t text; mx int; v_keep uuid[] := ARRAY[]::uuid[]; v_n int := 0; v_id uuid; v_set text; v_list text;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR UPDATE;
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF p.status <> 'active' THEN RAISE EXCEPTION 'Only the active plan can be edited' USING ERRCODE = '22023'; END IF;
  IF spec IS NULL THEN RAISE EXCEPTION 'Unknown plan section' USING ERRCODE = '22023'; END IF;
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) > 200 THEN
    RAISE EXCEPTION 'rows must be a list of at most 200' USING ERRCODE = '22023';
  END IF;
  tbl := spec ->> 'table';
  SELECT array_agg(c ORDER BY c) INTO cols FROM jsonb_object_keys(spec -> 'cols') c;
  -- validate everything before writing anything
  FOR r IN SELECT x FROM jsonb_array_elements(_rows) x LOOP
    IF jsonb_typeof(r) <> 'object' THEN RAISE EXCEPTION 'Each row must be an object' USING ERRCODE = '22023'; END IF;
    FOR k IN SELECT jsonb_object_keys(r) LOOP
      IF k <> 'id' AND k <> ALL (cols) THEN RAISE EXCEPTION 'Unknown column "%"', k USING ERRCODE = '22023'; END IF;
    END LOOP;
    IF r ? 'id' THEN
      BEGIN v_id := (r ->> 'id')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END;
      EXECUTE format('SELECT 1 FROM public.%I WHERE id = $1 AND care_plan_id = $2', tbl) INTO req USING v_id, p.id;
      IF req IS NULL THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
      IF v_id = ANY (v_keep) THEN RAISE EXCEPTION 'A row appears twice' USING ERRCODE = '22023'; END IF;
      v_keep := v_keep || v_id;
    END IF;
    FOREACH k IN ARRAY cols LOOP
      rule := spec -> 'cols' ->> k; req := left(rule, 1) = '!'; rule := ltrim(rule, '!'); v := r -> k;
      IF v IS NULL OR jsonb_typeof(v) = 'null' OR (jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') = '') THEN
        IF req THEN RAISE EXCEPTION 'Column "%" is required', k USING ERRCODE = '22023'; END IF;
        CONTINUE;
      END IF;
      t := split_part(rule, ':', 1);
      IF t = 'text' THEN
        mx := split_part(rule, ':', 2)::int;
        IF jsonb_typeof(v) <> 'string' OR length(v #>> '{}') > mx THEN RAISE EXCEPTION 'Column "%" must be text of at most % characters', k, mx USING ERRCODE = '22023'; END IF;
      ELSIF t = 'bool' THEN
        IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'Column "%" must be true or false', k USING ERRCODE = '22023'; END IF;
      ELSIF t = 'int' THEN
        IF jsonb_typeof(v) <> 'number' OR (v #>> '{}') !~ '^-?\d{1,6}$' THEN RAISE EXCEPTION 'Column "%" must be a whole number', k USING ERRCODE = '22023'; END IF;
      ELSIF t = 'date' THEN
        IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Column "%" must be a date (YYYY-MM-DD)', k USING ERRCODE = '22023'; END IF;
        BEGIN PERFORM (v #>> '{}')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Column "%" must be a valid date', k USING ERRCODE = '22023'; END;
      ELSIF t = 'enum' THEN
        IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') <> ALL (string_to_array(split_part(rule, ':', 2), '|')) THEN
          RAISE EXCEPTION 'Column "%" has an invalid value', k USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  EXECUTE format('DELETE FROM public.%I WHERE care_plan_id = $1 AND id <> ALL ($2)', tbl) USING p.id, v_keep;
  SELECT string_agg(format('%I', c), ', ') INTO v_list FROM unnest(cols) c;
  SELECT string_agg(format('%1$I = x.%1$I', c), ', ') INTO v_set FROM unnest(cols) c;
  FOR r IN SELECT x FROM jsonb_array_elements(_rows) x LOOP
    -- blank text -> NULL; defaults for NOT NULL columns left empty
    SELECT COALESCE(jsonb_object_agg(e.key, CASE WHEN jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') = '' THEN 'null'::jsonb ELSE e.value END), '{}'::jsonb)
      INTO r FROM jsonb_each(r) e;
    r := COALESCE(spec -> 'defaults', '{}'::jsonb) || jsonb_strip_nulls(r);
    IF r ? 'id' THEN
      EXECUTE format('UPDATE public.%1$I t SET %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1) x WHERE t.id = $2 AND t.care_plan_id = $3', tbl, v_set)
        USING r, (r ->> 'id')::uuid, p.id;
    ELSE
      EXECUTE format('INSERT INTO public.%1$I (care_plan_id, %2$s) SELECT $2, %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1)', tbl, v_list)
        USING r, p.id;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'care_plan_updated', 'care_plan', p.id,
    jsonb_build_object('care_plan_id', p.id, 'section', _entity, 'rows', v_n));
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.set_care_plan_rows(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_care_plan_rows(uuid, text, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.would_bump_training_version(_care_plan_id uuid, _goals jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p record; v_tree jsonb; v_changed boolean; v_trained boolean;
BEGIN
  SELECT id, agency_id, virtual_office_id, training_version INTO p FROM public.care_plans WHERE id = _care_plan_id;
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF _goals IS NULL OR jsonb_typeof(_goals) <> 'array' THEN
    RAISE EXCEPTION 'goals must be a list' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('seq', (g ->> 'seq')::int, 'goal_text', btrim(g ->> 'goal_text'),
             'target_start', (g ->> 'target_start')::date, 'target_end', (g ->> 'target_end')::date,
             'objectives', COALESCE((SELECT jsonb_agg(jsonb_build_object('letter', o ->> 'letter', 'seq', (o ->> 'seq')::int,
                 'objective_text', btrim(o ->> 'objective_text'), 'staff_instructions', o ->> 'staff_instructions',
                 'service_type', o ->> 'service_type',
                 'responsible_party', COALESCE(o ->> 'responsible_party', 'this_agency')::public.objective_responsible_party,
                 'target_start', (o ->> 'target_start')::date, 'target_end', (o ->> 'target_end')::date)
                 ORDER BY (o ->> 'seq')::int, btrim(o ->> 'objective_text'))
               FROM jsonb_array_elements(COALESCE(g -> 'objectives', '[]'::jsonb)) o), '[]'::jsonb))
           ORDER BY (g ->> 'seq')::int), '[]'::jsonb)
      INTO v_tree FROM jsonb_array_elements(_goals) g;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'The goals list is not valid' USING ERRCODE = '22023';
  END;
  v_changed := v_tree IS DISTINCT FROM cp_goal_tree(p.id);
  v_trained := EXISTS (SELECT 1 FROM public.plan_inservice_forms WHERE care_plan_id = p.id AND training_version = p.training_version)
            OR EXISTS (SELECT 1 FROM public.plan_training_forms WHERE care_plan_id = p.id AND training_version = p.training_version);
  RETURN jsonb_build_object('changed', v_changed, 'would_bump', v_changed AND v_trained, 'trained', v_trained,
                            'training_version', p.training_version);
END $function$;
REVOKE ALL ON FUNCTION public.would_bump_training_version(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.would_bump_training_version(uuid, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.record_inservice_form(_care_plan_id uuid, _case_manager_name text, _program_lead_id uuid, _trained_on date, _signed_at timestamp with time zone, _field_values jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p record; v_ver uuid; v_snap jsonb; v_id uuid;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR SHARE;   -- blocks a concurrent training_version bump
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
  IF p.status <> 'active' THEN RAISE EXCEPTION 'Training is recorded against the active plan' USING ERRCODE = '22023'; END IF;
  IF COALESCE(btrim(_case_manager_name), '') = '' OR length(_case_manager_name) > 200 THEN
    RAISE EXCEPTION 'The case manager name is required (at most 200 characters)' USING ERRCODE = '22023';
  END IF;
  -- the program lead must be an agency_admin of this agency, or a manager whose office scope
  -- includes the plan's office (agency-wide manager, or office-restricted to this office)
  IF _program_lead_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.profiles pr WHERE pr.id = _program_lead_id AND pr.agency_id = p.agency_id
         AND (has_role(pr.id, 'agency_admin'::public.app_role)
              OR (has_role(pr.id, 'manager'::public.app_role)
                  AND (NOT COALESCE(pr.office_restricted, false) OR pr.virtual_office_id = p.virtual_office_id)))) THEN
    RAISE EXCEPTION 'The program lead must be a manager of this office or an agency admin' USING ERRCODE = '22023';
  END IF;
  IF _trained_on IS NULL OR _trained_on > current_date + 1 OR _signed_at IS NULL OR _signed_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'A training date and a signature time (not in the future) are required' USING ERRCODE = '22023';
  END IF;
  v_ver := cp_resolve_template(p.agency_id, p.virtual_office_id, 'inservice', NULL);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;
  PERFORM cp_validate_field_values(v_snap, COALESCE(_field_values, '{}'::jsonb));
  INSERT INTO public.plan_inservice_forms (agency_id, virtual_office_id, client_id, care_plan_id, training_version,
    case_manager_name, program_lead_id, trained_on, signed_at, template_id, template_version, field_snapshot, field_values)
  VALUES (p.agency_id, p.virtual_office_id, p.client_id, p.id, p.training_version, btrim(_case_manager_name),
    _program_lead_id, _trained_on, _signed_at, (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap,
    COALESCE(_field_values, '{}'::jsonb))
  RETURNING id INTO v_id;
  PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'inservice_signed', 'plan_inservice_form', v_id,
    jsonb_build_object('inservice_form_id', v_id, 'care_plan_id', p.id, 'training_version', p.training_version));
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.record_inservice_form(uuid, text, uuid, date, timestamp with time zone, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inservice_form(uuid, text, uuid, date, timestamp with time zone, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.record_training_form(_care_plan_id uuid, _plan_document_type plan_document_type, _plan_effective_date date, _location text, _records jsonb, _field_values jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p record; x jsonb; g record; v_ver uuid; v_snap jsonb; v_id uuid; v_n int;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR SHARE;
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
  IF p.status <> 'active' THEN RAISE EXCEPTION 'Training is recorded against the active plan' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plan_inservice_forms f WHERE f.care_plan_id = p.id
                   AND f.training_version = p.training_version AND f.signed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Record the signed in-service form for this plan version first' USING ERRCODE = '22023';
  END IF;
  IF _plan_document_type IS NULL OR length(COALESCE(_location, '')) > 200 THEN
    RAISE EXCEPTION 'A plan document type is required; location at most 200 characters' USING ERRCODE = '22023';
  END IF;
  IF _records IS NULL OR jsonb_typeof(_records) <> 'array' OR jsonb_array_length(_records) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'records must list 1-100 trained caregivers' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT e ->> 'caregiver_id') FROM jsonb_array_elements(_records) e) <> jsonb_array_length(_records) THEN
    RAISE EXCEPTION 'Each caregiver can appear once' USING ERRCODE = '22023';
  END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(_records) e LOOP
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(x) k WHERE k <> ALL (ARRAY['caregiver_id','training_date','training_method',
               'primary_clinician_name','trainer_name','signed_date'])) THEN
      RAISE EXCEPTION 'Unknown training record property' USING ERRCODE = '22023';
    END IF;
    SELECT id, agency_id, virtual_office_id INTO g FROM public.caregivers WHERE id = (x ->> 'caregiver_id')::uuid;
    IF g.agency_id IS DISTINCT FROM p.agency_id THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
    PERFORM cp_require_scope(g.agency_id, g.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
    IF x ->> 'training_date' IS NULL OR (x ->> 'training_date')::date > current_date + 1
       OR length(COALESCE(x ->> 'primary_clinician_name', '')) > 200 OR length(COALESCE(x ->> 'trainer_name', '')) > 200 THEN
      RAISE EXCEPTION 'Each record needs a training date (not in the future); names at most 200 characters' USING ERRCODE = '22023';
    END IF;
    IF x ->> 'training_method' IS NOT NULL AND x ->> 'training_method' <> ALL (ARRAY['pcp_meeting', 'outside_pcp']) THEN
      RAISE EXCEPTION 'Invalid training method' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_ver := cp_resolve_template(p.agency_id, p.virtual_office_id, 'training', NULL);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;
  PERFORM cp_validate_field_values(v_snap, COALESCE(_field_values, '{}'::jsonb));

  INSERT INTO public.plan_training_forms (agency_id, virtual_office_id, client_id, care_plan_id, training_version,
    plan_document_type, plan_effective_date, location, template_id, template_version, field_snapshot, field_values)
  VALUES (p.agency_id, p.virtual_office_id, p.client_id, p.id, p.training_version, _plan_document_type,
    _plan_effective_date, NULLIF(btrim(_location), ''), (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int,
    v_snap, COALESCE(_field_values, '{}'::jsonb))
  RETURNING id INTO v_id;
  INSERT INTO public.plan_training_records (training_form_id, agency_id, virtual_office_id, caregiver_id, client_id,
    care_plan_id, training_version, training_date, training_method, primary_clinician_name, trainer_name, signed_date)
  SELECT v_id, p.agency_id, p.virtual_office_id, (e ->> 'caregiver_id')::uuid, p.client_id, p.id, p.training_version,
         (e ->> 'training_date')::date, (e ->> 'training_method')::public.training_method,
         NULLIF(btrim(e ->> 'primary_clinician_name'), ''), NULLIF(btrim(e ->> 'trainer_name'), ''), (e ->> 'signed_date')::date
  FROM jsonb_array_elements(_records) e;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'training_recorded', 'plan_training_form', v_id,
    jsonb_build_object('training_form_id', v_id, 'care_plan_id', p.id, 'training_version', p.training_version, 'records', v_n));
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.record_training_form(uuid, plan_document_type, date, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_training_form(uuid, plan_document_type, date, text, jsonb, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.add_training_attendees(_training_form_id uuid, _records jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t record; p record; x jsonb; g record; v_date date; v_trainer text; v_n int;
BEGIN
  SELECT * INTO t FROM public.plan_training_forms WHERE id = _training_form_id;
  SELECT * INTO p FROM public.care_plans WHERE id = t.care_plan_id FOR SHARE;   -- blocks a concurrent training_version bump
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
  IF p.status <> 'active' OR t.training_version <> p.training_version THEN
    RAISE EXCEPTION 'This session is for an earlier plan version; record a new session for the current version' USING ERRCODE = '22023';
  END IF;
  IF _records IS NULL OR jsonb_typeof(_records) <> 'array' OR jsonb_array_length(_records) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'records must list 1-100 caregivers' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT e ->> 'caregiver_id') FROM jsonb_array_elements(_records) e) <> jsonb_array_length(_records) THEN
    RAISE EXCEPTION 'Each caregiver can appear once' USING ERRCODE = '22023';
  END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(_records) e LOOP
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(x) k WHERE k <> ALL (ARRAY['caregiver_id','signed_date','training_method','primary_clinician_name'])) THEN
      RAISE EXCEPTION 'Unknown training record property' USING ERRCODE = '22023';
    END IF;
    SELECT id, agency_id, virtual_office_id INTO g FROM public.caregivers WHERE id = (x ->> 'caregiver_id')::uuid;
    IF g.agency_id IS DISTINCT FROM p.agency_id THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
    PERFORM cp_require_scope(g.agency_id, g.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
    IF EXISTS (SELECT 1 FROM public.plan_training_records WHERE training_form_id = t.id AND caregiver_id = g.id) THEN
      RAISE EXCEPTION 'A caregiver is already in this session' USING ERRCODE = '22023';
    END IF;
    IF (x ->> 'signed_date')::date > current_date + 1 OR length(COALESCE(x ->> 'primary_clinician_name', '')) > 200 THEN
      RAISE EXCEPTION 'A signature date can''t be in the future; names at most 200 characters' USING ERRCODE = '22023';
    END IF;
    IF x ->> 'training_method' IS NOT NULL AND x ->> 'training_method' <> ALL (ARRAY['pcp_meeting', 'outside_pcp']) THEN
      RAISE EXCEPTION 'Invalid training method' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- the session's date of training and trainer
  SELECT min(training_date), (array_agg(trainer_name ORDER BY created_at) FILTER (WHERE trainer_name IS NOT NULL))[1]
    INTO v_date, v_trainer FROM public.plan_training_records WHERE training_form_id = t.id;
  INSERT INTO public.plan_training_records (training_form_id, agency_id, virtual_office_id, caregiver_id, client_id,
    care_plan_id, training_version, training_date, training_method, primary_clinician_name, trainer_name, signed_date)
  SELECT t.id, t.agency_id, t.virtual_office_id, (e ->> 'caregiver_id')::uuid, t.client_id, t.care_plan_id, t.training_version,
         COALESCE(v_date, (t.created_at AT TIME ZONE 'UTC')::date), (e ->> 'training_method')::public.training_method,
         NULLIF(btrim(e ->> 'primary_clinician_name'), ''), v_trainer, (e ->> 'signed_date')::date
  FROM jsonb_array_elements(_records) e;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM cp_audit(t.agency_id, t.virtual_office_id, 'training_recorded', 'plan_training_form', t.id,
    jsonb_build_object('training_form_id', t.id, 'care_plan_id', t.care_plan_id, 'training_version', t.training_version, 'records', v_n, 'added', true));
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.add_training_attendees(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_training_attendees(uuid, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_client_training_context(_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; p record; v_today date; v_in uuid; v_tr uuid;
BEGIN
  SELECT cl.id, cl.agency_id, cl.virtual_office_id, cl.first_name, cl.last_name, cl.case_number, vo.name office_name, a.agency_name,
         COALESCE(vo.timezone, 'America/New_York') tz INTO c
    FROM public.clients cl LEFT JOIN public.virtual_office vo ON vo.id = cl.virtual_office_id LEFT JOIN public.agency a ON a.id = cl.agency_id
   WHERE cl.id = _client_id;
  PERFORM cp_require_scope(c.agency_id, c.virtual_office_id, '{manager,agency_admin,hr_staff}'::public.app_role[]);
  v_today := (now() AT TIME ZONE c.tz)::date;
  SELECT id, version, training_version, plan_type, effective_date, expiration_date INTO p
    FROM public.care_plans WHERE client_id = c.id AND status = 'active';
  v_in := cp_resolve_template(c.agency_id, c.virtual_office_id, 'inservice', NULL);
  v_tr := cp_resolve_template(c.agency_id, c.virtual_office_id, 'training', NULL);
  RETURN jsonb_build_object(
    'client_id', c.id,
    'client_name', btrim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')),
    'client_short', btrim(COALESCE(c.first_name, '') || ' ' || left(COALESCE(c.last_name, ''), 1) || CASE WHEN COALESCE(c.last_name, '') <> '' THEN '.' ELSE '' END),
    'case_number', c.case_number,
    'agency_name', c.agency_name, 'office_id', c.virtual_office_id, 'office_name', c.office_name, 'as_of', v_today,
    'plan', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('care_plan_id', p.id, 'version', p.version, 'training_version', p.training_version,
              'plan_type', p.plan_type, 'effective_date', p.effective_date, 'expiration_date', p.expiration_date) END,
    'inservice_current', p.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.plan_inservice_forms f WHERE f.care_plan_id = p.id
                           AND f.training_version = p.training_version AND f.signed_at IS NOT NULL),
    'inservice_forms', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'training_version', f.training_version, 'case_manager_name', f.case_manager_name,
         'program_lead_id', f.program_lead_id, 'program_lead_name', pr.full_name, 'trained_on', f.trained_on, 'signed_at', f.signed_at,
         'field_snapshot', f.field_snapshot -> 'fields', 'field_values', f.field_values, 'created_at', f.created_at) ORDER BY f.created_at DESC)
       FROM public.plan_inservice_forms f LEFT JOIN public.profiles pr ON pr.id = f.program_lead_id WHERE f.client_id = c.id), '[]'::jsonb),
    'training_forms', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'training_version', t.training_version, 'plan_document_type', t.plan_document_type,
         'plan_effective_date', t.plan_effective_date, 'location', t.location, 'field_snapshot', t.field_snapshot -> 'fields', 'field_values', t.field_values,
         'created_at', t.created_at,
         'records', COALESCE((SELECT jsonb_agg(jsonb_build_object('caregiver_id', r.caregiver_id,
              'caregiver_name', btrim(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')), 'training_date', r.training_date,
              'training_method', r.training_method, 'primary_clinician_name', r.primary_clinician_name, 'trainer_name', r.trainer_name,
              'signed_date', r.signed_date) ORDER BY g.last_name, g.first_name)
            FROM public.plan_training_records r JOIN public.caregivers g ON g.id = r.caregiver_id WHERE r.training_form_id = t.id), '[]'::jsonb))
         ORDER BY t.created_at DESC)
       FROM public.plan_training_forms t WHERE t.client_id = c.id), '[]'::jsonb),
    'program_leads', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name) ORDER BY pr.full_name)
       FROM public.profiles pr WHERE pr.agency_id = c.agency_id
         AND (has_role(pr.id, 'agency_admin'::public.app_role)
              OR (has_role(pr.id, 'manager'::public.app_role)
                  AND (NOT COALESCE(pr.office_restricted, false) OR pr.virtual_office_id = c.virtual_office_id)))), '[]'::jsonb),
    'caregivers', COALESCE((SELECT jsonb_agg(jsonb_build_object('caregiver_id', g.id,
         'name', btrim(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')),
         'trained_version', (SELECT max(r.training_version) FROM public.plan_training_records r WHERE r.caregiver_id = g.id AND r.client_id = c.id),
         'trained_current', p.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.plan_training_records r WHERE r.caregiver_id = g.id
                              AND r.care_plan_id = p.id AND r.training_version = p.training_version),
         'credentials_current', NOT EXISTS (SELECT 1 FROM public.credential_types t
              LEFT JOIN public.caregiver_certifications cc ON cc.caregiver_id = g.id AND cc.credential_type_id = t.id
              WHERE t.agency_id = g.agency_id AND t.is_active AND t.required AND (cc.id IS NULL OR cc.expiry_date < v_today)))
         ORDER BY g.last_name, g.first_name)
       FROM public.caregivers g WHERE g.virtual_office_id = c.virtual_office_id AND g.agency_id = c.agency_id AND g.is_active IS NOT FALSE), '[]'::jsonb),
    'inservice_fields', CASE WHEN v_in IS NULL THEN '[]'::jsonb ELSE cp_template_snapshot(v_in) -> 'fields' END,
    'training_fields', CASE WHEN v_tr IS NULL THEN '[]'::jsonb ELSE cp_template_snapshot(v_tr) -> 'fields' END);
END $function$;
REVOKE ALL ON FUNCTION public.get_client_training_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_training_context(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.cp_attachment_parent(_kind text, _id uuid, OUT agency_id uuid, OUT office_id uuid, OUT client_id uuid, OUT caregiver_id uuid, OUT attachable boolean)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _kind = 'client_document' THEN
    SELECT d.agency_id, d.virtual_office_id, d.client_id, NULL, d.is_current INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.client_documents d WHERE d.id = _id;
  ELSIF _kind = 'inservice_form' THEN
    SELECT f.agency_id, f.virtual_office_id, f.client_id, NULL, (p.status = 'active' AND f.training_version = p.training_version)
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.plan_inservice_forms f JOIN public.care_plans p ON p.id = f.care_plan_id WHERE f.id = _id;
  ELSIF _kind = 'training_form' THEN
    SELECT f.agency_id, f.virtual_office_id, f.client_id, NULL, (p.status = 'active' AND f.training_version = p.training_version)
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.plan_training_forms f JOIN public.care_plans p ON p.id = f.care_plan_id WHERE f.id = _id;
  ELSIF _kind = 'care_plan' THEN
    SELECT p.agency_id, p.virtual_office_id, p.client_id, NULL, (p.status = 'active')
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.care_plans p WHERE p.id = _id;
  ELSIF _kind = 'credential' THEN
    SELECT g.agency_id, g.virtual_office_id, NULL, g.id, (c.credential_type_id IS NOT NULL)
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.caregiver_certifications c JOIN public.caregivers g ON g.id = c.caregiver_id WHERE c.id = _id;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.cp_attachment_parent(text, uuid) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.cp_record_revision(uuid);
DROP FUNCTION public.cp_revision_baseline(uuid);
DROP FUNCTION public.cp_plan_snapshot(uuid);
DROP TABLE public.care_plan_revisions;
ALTER TABLE public.plan_training_records DROP COLUMN plan_revision;
DROP INDEX public.one_pending_plan_per_client;
ALTER TABLE public.care_plans DROP COLUMN revision;

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
  'attachment_added', 'attachment_removed', 'attachment_viewed'
]::text[]));

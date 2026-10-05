-- Ripple UI S5 — Goals tab: a read-only preview of the retraining rule. ADDITIVE ONLY (one new
-- function; upsert_care_plan_goals is not changed).
--
--   would_bump_training_version(_care_plan_id, _goals)  manager, agency_admin (same scope as the
--       write). Answers, before saving, what upsert_care_plan_goals would do with the same payload:
--       changed    = the payload's goal tree differs from cp_goal_tree(plan) (the same comparison
--                    the RPC makes: goals/objectives text, letters, seq, Instructions for Staff,
--                    service type, responsible party, target dates; measures are not part of it)
--       would_bump = changed AND an in-service or training form exists at the plan's current
--                    training_version (the RPC's bump condition)
--       trained    = that form exists (the UI uses it for its wording)
--       training_version = the plan's current value.
--       The tree is built with the same normalisation as the RPC's writes (btrim on goal/objective
--       text, dates cast, responsible_party default 'this_agency') and the same ordering as
--       cp_goal_tree, so the preview matches the write. The write path stays authoritative: it
--       applies the rule again on save.
-- SECURITY DEFINER, search_path fixed, REVOKE ALL FROM PUBLIC, anon, GRANT authenticated (rule 14).

CREATE FUNCTION public.would_bump_training_version(_care_plan_id uuid, _goals jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.would_bump_training_version(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.would_bump_training_version(uuid, jsonb) TO authenticated;

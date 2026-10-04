-- Phase D2 — client onboarding status (URD Flow 1; arch §12, Bren's 8 items; schema plan §5.1, Q7, Q8).
-- Ripple care-plan module. Read-only RPCs, manager / agency_admin tier, office-scoped. Not audited
-- (reads, like list_caregivers_needing_retraining).
--
--   get_client_onboarding_status(_client_id)  -> one client's 8 items + onboarded
--   list_clients_onboarding(_office_id)        -> every active client of the office, same shape
--
-- The 8 items, each complete | missing | expired | not_applicable, evaluated "today" in the
-- client's office time zone, against the client's ACTIVE plan (care_plans.status = 'active'):
--   1 ipos            active plan in effect today -> complete; active plan past its expiration date,
--                     or only expired plans -> expired; otherwise missing
--   2 assessment      current client_documents row 'assessment' (see "documents" below)
--   3 inservice       a signed in-service form for the active plan at its CURRENT training_version
--                     -> complete; signed only at an older version or for an earlier plan of the
--                     client (e.g. before a renewal) -> expired; none -> missing
--   4 client_forms    consent, insurance, emergency_contacts, allergies, release_of_information:
--                     any missing -> missing; else any expired -> expired; else complete
--                     (all five not_applicable -> not_applicable); detail = count per status
--   5 safety_behavior_plan  current 'safety_behavior_plan' document; not_applicable counts as done (Q7)
--   6 training        >= 1 caregiver trained on the active plan at its CURRENT training_version
--                     (Q8) -> complete; only older versions / earlier plans -> expired; none -> missing
--   7 authorization   an authorization of the client valid today -> complete; only past ones ->
--                     expired; none (or only future ones) -> missing
--   8 cls_note_setup  the active plan has >= 1 this_agency objective and every this_agency
--                     objective has >= 1 active measure -> complete; otherwise missing
-- documents: no current row, or status missing/pending -> missing; status expired, or complete with
-- an expiration_date before today -> expired; complete -> complete; not_applicable -> not_applicable.
-- onboarded = every item complete or not_applicable.
-- Output: ids, item keys, statuses and counts only: no names, no document contents, no clinical text.

-- Internal evaluator (no scope check; called only by the two RPCs below). No API role.
CREATE FUNCTION public.cp_client_onboarding(_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  c record; v_today date; p record; v_items jsonb := '[]'::jsonb; v_st text; v_detail jsonb;
  v_forms text[] := ARRAY['consent', 'insurance', 'emergency_contacts', 'allergies', 'release_of_information'];
  v_counts jsonb; v_obj int; v_obj_nomeasure int; d text;
BEGIN
  SELECT cl.id, cl.virtual_office_id, COALESCE(vo.timezone, 'America/New_York') tz INTO c
    FROM public.clients cl LEFT JOIN public.virtual_office vo ON vo.id = cl.virtual_office_id WHERE cl.id = _client_id;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  v_today := (now() AT TIME ZONE c.tz)::date;
  SELECT id, training_version, effective_date, expiration_date INTO p
    FROM public.care_plans WHERE client_id = c.id AND status = 'active';

  -- 1 IPOS
  v_st := CASE
    WHEN p.id IS NOT NULL AND (p.effective_date IS NULL OR p.effective_date <= v_today)
         AND (p.expiration_date IS NULL OR p.expiration_date >= v_today) THEN 'complete'
    WHEN (p.id IS NOT NULL AND p.expiration_date < v_today)
      OR (p.id IS NULL AND EXISTS (SELECT 1 FROM public.care_plans WHERE client_id = c.id AND status = 'expired')) THEN 'expired'
    ELSE 'missing' END;
  v_items := v_items || jsonb_build_object('key', 'ipos', 'status', v_st, 'care_plan_id', p.id, 'training_version', p.training_version);

  -- 2 assessment, 5 safety/behavior plan (single documents)
  FOREACH d IN ARRAY ARRAY['assessment', 'safety_behavior_plan'] LOOP
    SELECT CASE
      WHEN x.id IS NULL OR x.status IN ('missing', 'pending') THEN 'missing'
      WHEN x.status = 'expired' OR (x.status = 'complete' AND x.expiration_date < v_today) THEN 'expired'
      ELSE x.status::text END INTO v_st
      FROM (SELECT 1) one LEFT JOIN public.client_documents x ON x.client_id = c.id AND x.doc_type = d AND x.is_current;
    v_items := v_items || jsonb_build_object('key', d, 'status', v_st);
  END LOOP;

  -- 3 in-service signed at the current training_version
  v_st := CASE
    WHEN p.id IS NULL THEN 'missing'
    WHEN EXISTS (SELECT 1 FROM public.plan_inservice_forms f WHERE f.care_plan_id = p.id AND f.signed_at IS NOT NULL
                   AND f.training_version = p.training_version) THEN 'complete'
    WHEN EXISTS (SELECT 1 FROM public.plan_inservice_forms f WHERE f.client_id = c.id AND f.signed_at IS NOT NULL) THEN 'expired'
    ELSE 'missing' END;
  v_items := v_items || jsonb_build_object('key', 'inservice', 'status', v_st);

  -- 4 client forms (five intake documents)
  SELECT jsonb_object_agg(s, n) INTO v_counts FROM (
    SELECT s, count(*)::int n FROM (
      SELECT CASE
        WHEN x.id IS NULL OR x.status IN ('missing', 'pending') THEN 'missing'
        WHEN x.status = 'expired' OR (x.status = 'complete' AND x.expiration_date < v_today) THEN 'expired'
        ELSE x.status::text END s
      FROM unnest(v_forms) t(doc_type)
      LEFT JOIN public.client_documents x ON x.client_id = c.id AND x.doc_type = t.doc_type AND x.is_current) y
    GROUP BY s) z;
  v_st := CASE WHEN v_counts ? 'missing' THEN 'missing' WHEN v_counts ? 'expired' THEN 'expired'
               WHEN NOT (v_counts ? 'complete') THEN 'not_applicable' ELSE 'complete' END;
  v_items := v_items || jsonb_build_object('key', 'client_forms', 'status', v_st, 'documents', v_counts);

  -- 6 training forms: >= 1 caregiver at the current training_version (Q8)
  v_st := CASE
    WHEN p.id IS NULL THEN 'missing'
    WHEN EXISTS (SELECT 1 FROM public.plan_training_records r WHERE r.care_plan_id = p.id AND r.training_version = p.training_version) THEN 'complete'
    WHEN EXISTS (SELECT 1 FROM public.plan_training_records r WHERE r.client_id = c.id) THEN 'expired'
    ELSE 'missing' END;
  v_items := v_items || jsonb_build_object('key', 'training', 'status', v_st,
    'caregivers_trained', (SELECT count(DISTINCT r.caregiver_id)::int FROM public.plan_training_records r
                            WHERE r.care_plan_id = p.id AND r.training_version = p.training_version));

  -- 7 authorization valid today
  v_st := CASE
    WHEN EXISTS (SELECT 1 FROM public.service_authorizations a WHERE a.client_id = c.id
                   AND a.effective_date <= v_today AND a.expiration_date >= v_today) THEN 'complete'
    WHEN EXISTS (SELECT 1 FROM public.service_authorizations a WHERE a.client_id = c.id AND a.expiration_date < v_today) THEN 'expired'
    ELSE 'missing' END;
  v_items := v_items || jsonb_build_object('key', 'authorization', 'status', v_st);

  -- 8 CLS note set up: every this_agency objective of the active plan has >= 1 active measure
  SELECT count(*)::int, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.objective_measures m WHERE m.objective_id = o.id AND m.is_active))::int
    INTO v_obj, v_obj_nomeasure
    FROM public.care_plan_objectives o JOIN public.care_plan_goals g ON g.id = o.goal_id
   WHERE g.care_plan_id = p.id AND o.responsible_party = 'this_agency';
  v_items := v_items || jsonb_build_object('key', 'cls_note_setup', 'status', CASE WHEN v_obj > 0 AND v_obj_nomeasure = 0 THEN 'complete' ELSE 'missing' END,
    'objectives', v_obj, 'objectives_without_measures', v_obj_nomeasure);

  -- Bren's order
  v_items := (SELECT jsonb_agg(e ORDER BY array_position(ARRAY['ipos', 'assessment', 'inservice', 'client_forms', 'safety_behavior_plan',
                'training', 'authorization', 'cls_note_setup'], e ->> 'key')) FROM jsonb_array_elements(v_items) e);
  RETURN jsonb_build_object('client_id', c.id, 'as_of', v_today,
    'onboarded', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e WHERE e ->> 'status' NOT IN ('complete', 'not_applicable')),
    'items', v_items);
END $$;
REVOKE ALL ON FUNCTION public.cp_client_onboarding(uuid) FROM PUBLIC, anon, authenticated;

-- One client. Manager / agency_admin in the client's office scope; anything else (or an unknown
-- client) -> 'Not found or not allowed'.
CREATE FUNCTION public.get_client_onboarding_status(_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO c FROM public.clients WHERE id = _client_id;
  PERFORM cp_require_scope(c.agency_id, c.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  RETURN cp_client_onboarding(c.id);
END $$;
REVOKE ALL ON FUNCTION public.get_client_onboarding_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_onboarding_status(uuid) TO authenticated;

-- Every active client of one office (the dashboard's "clients pending — missing documentation").
CREATE FUNCTION public.list_clients_onboarding(_office_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  SELECT id, agency_id INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin}'::public.app_role[]);
  RETURN COALESCE((SELECT jsonb_agg(cp_client_onboarding(cl.id) ORDER BY cl.id)
                     FROM public.clients cl
                    WHERE cl.virtual_office_id = o.id AND cl.agency_id = o.agency_id AND cl.is_active IS NOT FALSE), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_clients_onboarding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_clients_onboarding(uuid) TO authenticated;

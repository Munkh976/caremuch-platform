-- Rollback of 20261015120000_w2_void_authorization.sql: restores the exact pre-void catalog.
-- The nine readers get their previous bodies back verbatim (pg_get_functiondef of DEV before the push),
-- void_service_authorization is dropped, the partial unique index goes back to the table constraint,
-- and the three void columns are dropped. Only valid while no authorization is voided (the old
-- constraint would see a re-entered number as a duplicate) -- check first:
--   SELECT count(*) FROM service_authorizations WHERE voided_at IS NOT NULL;   -- must be 0
BEGIN;
DROP FUNCTION public.void_service_authorization(uuid, text);
CREATE OR REPLACE FUNCTION public.cp_projected_units(_client_id uuid, _service_type text, _shift_date date, _need integer, _exclude_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  a_id uuid[] := ARRAY[]::uuid[]; a_from date[] := ARRAY[]::date[]; a_to date[] := ARRAY[]::date[]; a_left numeric[] := ARRAY[]::numeric[];
  a_per public.auth_period_type[] := ARRAY[]::public.auth_period_type[]; a_cap numeric[] := ARRAY[]::numeric[]; a_ws smallint[] := ARRAY[]::smallint[];
  dm_a uuid[] := ARRAY[]::uuid[]; dm_d date[] := ARRAY[]::date[]; dm_u numeric[] := ARRAY[]::numeric[];
  r record; d record; i int; n int; v_pick int; v_pl numeric; v_best numeric; v_pbest numeric; v_plabel text;
BEGIN
  FOR r IN SELECT sa.id, sa.effective_date, sa.expiration_date, sa.units_available, sa.period_type, sa.units_per_period, vo.billing_week_start
             FROM public.service_authorizations sa JOIN public.virtual_office vo ON vo.id = sa.virtual_office_id
            WHERE sa.client_id = _client_id AND sa.service_type = _service_type
            ORDER BY sa.expiration_date, sa.created_at, sa.id LOOP
    a_id := a_id || r.id; a_from := a_from || r.effective_date; a_to := a_to || r.expiration_date; a_left := a_left || r.units_available;
    a_per := a_per || r.period_type; a_cap := a_cap || r.units_per_period; a_ws := a_ws || r.billing_week_start;
  END LOOP;
  n := COALESCE(array_length(a_id, 1), 0);
  IF n = 0 THEN RETURN jsonb_build_object('status', 'missing'); END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(a_from, a_to) x(f, t) WHERE f <= _shift_date AND t >= _shift_date) THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  FOR d IN
    SELECT pn.service_date AS dt, pn.scheduled_start AS st, pn.units_used AS u
      FROM public.progress_notes pn
     WHERE pn.client_id = _client_id AND pn.service_type = _service_type AND NOT pn.voided AND pn.billable
       AND pn.authorization_id IS NULL AND pn.status IN ('draft', 'submitted', 'returned')
    UNION ALL
    SELECT o.shift_date, (o.shift_date + o.start_time) AT TIME ZONE vo.timezone,
           cp_shift_units(o.shift_date, o.start_time, o.end_time, vo.timezone)
      FROM public.shifts o
      JOIN public.virtual_office vo ON vo.id = o.virtual_office_id
      JOIN public.office_service_types m ON m.virtual_office_id = o.virtual_office_id AND m.care_type_code = o.care_type_code
                                         AND m.is_active AND m.service_type = _service_type
     WHERE o.client_id = _client_id AND o.id IS DISTINCT FROM _exclude_shift AND o.status IS DISTINCT FROM 'cancelled'
       AND (o.shift_date >= (now() AT TIME ZONE vo.timezone)::date
            OR o.shift_date >= (vo.care_plan_module_enabled_at AT TIME ZONE vo.timezone)::date)   -- NULL go-live: no past
       AND EXISTS (SELECT 1 FROM public.shift_assignments sa WHERE sa.shift_id = o.id AND sa.status <> 'cancelled')
       AND NOT EXISTS (SELECT 1 FROM public.progress_notes x WHERE x.shift_id = o.id AND NOT x.voided)
    ORDER BY 1, 2
  LOOP
    v_pick := NULL;
    FOR i IN 1..n LOOP
      IF a_from[i] <= d.dt AND a_to[i] >= d.dt AND a_left[i] >= d.u
         AND COALESCE(cp_period_left(a_id[i], a_per[i], a_cap[i], a_ws[i], d.dt, dm_a, dm_d, dm_u), d.u) >= d.u THEN
        v_pick := i; EXIT;
      END IF;
    END LOOP;
    IF v_pick IS NULL THEN   -- fits nowhere: charge the first authorization valid on its date anyway
      FOR i IN 1..n LOOP
        IF a_from[i] <= d.dt AND a_to[i] >= d.dt THEN v_pick := i; EXIT; END IF;
      END LOOP;
    END IF;
    IF v_pick IS NOT NULL THEN
      a_left[v_pick] := a_left[v_pick] - d.u;
      dm_a := dm_a || a_id[v_pick]; dm_d := dm_d || d.dt; dm_u := dm_u || d.u;
    END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    IF a_from[i] <= _shift_date AND a_to[i] >= _shift_date THEN
      v_pl := cp_period_left(a_id[i], a_per[i], a_cap[i], a_ws[i], _shift_date, dm_a, dm_d, dm_u);
      IF a_left[i] >= _need AND COALESCE(v_pl, _need) >= _need THEN
        RETURN jsonb_build_object('status', 'ok', 'authorization_id', a_id[i], 'projected', GREATEST(a_left[i], 0));
      ELSIF a_left[i] >= _need THEN   -- enough in total, but over the period cap
        IF v_pbest IS NULL OR v_pl > v_pbest THEN v_pbest := v_pl; v_plabel := replace(a_per[i]::text, 'per_', ''); END IF;
      ELSE
        v_best := GREATEST(COALESCE(v_best, a_left[i]), a_left[i]);
      END IF;
    END IF;
  END LOOP;
  IF v_pbest IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'short_period', 'projected', GREATEST(v_pbest, 0), 'period', v_plabel);
  END IF;
  RETURN jsonb_build_object('status', 'short', 'projected', GREATEST(COALESCE(v_best, 0), 0));
END $function$;

CREATE OR REPLACE FUNCTION public.cp_authorization_projection(_client_id uuid, _service_type text, _as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  a_id uuid[] := ARRAY[]::uuid[]; a_from date[] := ARRAY[]::date[]; a_to date[] := ARRAY[]::date[]; a_left numeric[] := ARRAY[]::numeric[];
  a_per public.auth_period_type[] := ARRAY[]::public.auth_period_type[]; a_cap numeric[] := ARRAY[]::numeric[]; a_ws smallint[] := ARRAY[]::smallint[];
  a_start numeric[] := ARRAY[]::numeric[];
  dm_a uuid[] := ARRAY[]::uuid[]; dm_d date[] := ARRAY[]::date[]; dm_u numeric[] := ARRAY[]::numeric[];
  r record; d record; i int; n int; v_pick int; v_out jsonb := '{}'::jsonb;
BEGIN
  FOR r IN SELECT sa.id, sa.effective_date, sa.expiration_date, sa.units_available, sa.period_type, sa.units_per_period, vo.billing_week_start
             FROM public.service_authorizations sa JOIN public.virtual_office vo ON vo.id = sa.virtual_office_id
            WHERE sa.client_id = _client_id AND sa.service_type = _service_type
            ORDER BY sa.expiration_date, sa.created_at, sa.id LOOP
    a_id := a_id || r.id; a_from := a_from || r.effective_date; a_to := a_to || r.expiration_date; a_left := a_left || r.units_available;
    a_per := a_per || r.period_type; a_cap := a_cap || r.units_per_period; a_ws := a_ws || r.billing_week_start;
    a_start := a_start || r.units_available;
  END LOOP;
  n := COALESCE(array_length(a_id, 1), 0);
  IF n = 0 THEN RETURN v_out; END IF;
  -- demand and allocation: identical to cp_projected_units
  FOR d IN
    SELECT pn.service_date AS dt, pn.scheduled_start AS st, pn.units_used AS u
      FROM public.progress_notes pn
     WHERE pn.client_id = _client_id AND pn.service_type = _service_type AND NOT pn.voided AND pn.billable
       AND pn.authorization_id IS NULL AND pn.status IN ('draft', 'submitted', 'returned')
    UNION ALL
    SELECT o.shift_date, (o.shift_date + o.start_time) AT TIME ZONE vo.timezone,
           cp_shift_units(o.shift_date, o.start_time, o.end_time, vo.timezone)
      FROM public.shifts o
      JOIN public.virtual_office vo ON vo.id = o.virtual_office_id
      JOIN public.office_service_types m ON m.virtual_office_id = o.virtual_office_id AND m.care_type_code = o.care_type_code
                                         AND m.is_active AND m.service_type = _service_type
     WHERE o.client_id = _client_id AND o.status IS DISTINCT FROM 'cancelled'
       AND (o.shift_date >= (now() AT TIME ZONE vo.timezone)::date
            OR o.shift_date >= (vo.care_plan_module_enabled_at AT TIME ZONE vo.timezone)::date)
       AND EXISTS (SELECT 1 FROM public.shift_assignments sa WHERE sa.shift_id = o.id AND sa.status <> 'cancelled')
       AND NOT EXISTS (SELECT 1 FROM public.progress_notes x WHERE x.shift_id = o.id AND NOT x.voided)
    ORDER BY 1, 2
  LOOP
    v_pick := NULL;
    FOR i IN 1..n LOOP
      IF a_from[i] <= d.dt AND a_to[i] >= d.dt AND a_left[i] >= d.u
         AND COALESCE(cp_period_left(a_id[i], a_per[i], a_cap[i], a_ws[i], d.dt, dm_a, dm_d, dm_u), d.u) >= d.u THEN
        v_pick := i; EXIT;
      END IF;
    END LOOP;
    IF v_pick IS NULL THEN
      FOR i IN 1..n LOOP
        IF a_from[i] <= d.dt AND a_to[i] >= d.dt THEN v_pick := i; EXIT; END IF;
      END LOOP;
    END IF;
    IF v_pick IS NOT NULL THEN
      a_left[v_pick] := a_left[v_pick] - d.u;
      dm_a := dm_a || a_id[v_pick]; dm_d := dm_d || d.dt; dm_u := dm_u || d.u;
    END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    v_out := v_out || jsonb_build_object(a_id[i]::text, jsonb_build_object(
      'pending', a_start[i] - a_left[i], 'left', a_left[i],
      'period_left', CASE WHEN a_from[i] <= _as_of AND a_to[i] >= _as_of
                          THEN cp_period_left(a_id[i], a_per[i], a_cap[i], a_ws[i], _as_of, dm_a, dm_d, dm_u) END));
  END LOOP;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION public.review_progress_note(_note_id uuid, _billable boolean, _non_billable_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n record; a record; v_left numeric; v_pl numeric; v_per text;
BEGIN
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided FOR UPDATE;
  PERFORM cp_require_scope(n.agency_id, n.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF n.status <> 'submitted' THEN RAISE EXCEPTION 'Only a submitted note can be reviewed' USING ERRCODE = '22023'; END IF;
  IF _billable IS NULL THEN RAISE EXCEPTION 'Say whether the visit is billable' USING ERRCODE = '22023'; END IF;

  IF NOT _billable THEN
    IF COALESCE(btrim(_non_billable_reason), '') = '' OR length(_non_billable_reason) > 1000 THEN
      RAISE EXCEPTION 'A non-billable review needs a reason (at most 1000 characters)' USING ERRCODE = '22023';
    END IF;
    UPDATE public.progress_notes SET billable = false, non_billable_reason = btrim(_non_billable_reason), authorization_id = NULL,
           status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = n.id;
    PERFORM cp_audit(n.agency_id, n.virtual_office_id, 'progress_note_reviewed', 'progress_note', n.id,
      jsonb_build_object('note_id', n.id, 'billable', false, 'units_used', 0));
    RETURN jsonb_build_object('billable', false, 'units_used', 0);
  END IF;
  IF _non_billable_reason IS NOT NULL THEN RAISE EXCEPTION 'A billable review has no non-billable reason' USING ERRCODE = '22023'; END IF;

  -- lock every authorization of this client + service in a fixed order (no deadlocks between
  -- reviewers); the next statement then reads the committed units after any concurrent review
  PERFORM 1 FROM public.service_authorizations
   WHERE client_id = n.client_id AND service_type = n.service_type ORDER BY id FOR UPDATE;
  -- Phase C: the authorization must also have room in the service date's period when it has a
  -- per-period cap (cp_period_left: cap − units already charged in that window)
  SELECT sa.* INTO a FROM public.service_authorizations sa JOIN public.virtual_office vo ON vo.id = sa.virtual_office_id
   WHERE sa.client_id = n.client_id AND sa.service_type = n.service_type
     AND sa.effective_date <= n.service_date AND sa.expiration_date >= n.service_date
     AND sa.units_available >= n.units_used
     AND COALESCE(cp_period_left(sa.id, sa.period_type, sa.units_per_period, vo.billing_week_start, n.service_date, '{}', '{}', '{}'), n.units_used) >= n.units_used
   ORDER BY sa.expiration_date, sa.created_at, sa.id
   LIMIT 1;
  IF a.id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.service_authorizations WHERE client_id = n.client_id AND service_type = n.service_type) THEN
      RAISE EXCEPTION 'Not billable yet: the client has no authorization for this service' USING ERRCODE = '22023';
    ELSIF NOT EXISTS (SELECT 1 FROM public.service_authorizations WHERE client_id = n.client_id AND service_type = n.service_type
                        AND effective_date <= n.service_date AND expiration_date >= n.service_date) THEN
      RAISE EXCEPTION 'Not billable yet: the service date is outside every authorization''s dates' USING ERRCODE = '22023';
    ELSIF EXISTS (SELECT 1 FROM public.service_authorizations WHERE client_id = n.client_id AND service_type = n.service_type
                    AND effective_date <= n.service_date AND expiration_date >= n.service_date AND units_available >= n.units_used) THEN
      -- enough units in total, but every such authorization is at its period cap
      SELECT cp_period_left(sa.id, sa.period_type, sa.units_per_period, vo.billing_week_start, n.service_date, '{}', '{}', '{}'),
             replace(sa.period_type::text, 'per_', '')
        INTO v_pl, v_per
        FROM public.service_authorizations sa JOIN public.virtual_office vo ON vo.id = sa.virtual_office_id
       WHERE sa.client_id = n.client_id AND sa.service_type = n.service_type
         AND sa.effective_date <= n.service_date AND sa.expiration_date >= n.service_date AND sa.units_available >= n.units_used
       ORDER BY sa.expiration_date, sa.created_at, sa.id LIMIT 1;
      RAISE EXCEPTION 'Not billable yet: this visit would go over the authorization''s % cap (% units needed, % left this %)',
        CASE v_per WHEN 'day' THEN 'daily' ELSE v_per || 'ly' END, n.units_used, GREATEST(v_pl, 0), v_per USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'Not billable yet: not enough authorized units remain (% needed)', n.units_used USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.progress_notes SET billable = true, non_billable_reason = NULL, authorization_id = a.id,
         status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = n.id;
  SELECT units_available INTO v_left FROM public.service_authorizations WHERE id = a.id;
  IF v_left < 0 THEN RAISE EXCEPTION 'Not billable yet: not enough authorized units remain' USING ERRCODE = '22023'; END IF;
  PERFORM cp_audit(n.agency_id, n.virtual_office_id, 'progress_note_reviewed', 'progress_note', n.id,
    jsonb_build_object('note_id', n.id, 'billable', true, 'authorization_id', a.id, 'units_used', n.units_used));
  RETURN jsonb_build_object('billable', true, 'authorization_id', a.id, 'units_used', n.units_used, 'units_left', v_left);
END $function$;

CREATE OR REPLACE FUNCTION public.cp_client_onboarding(_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.cp_check_order_service_authorization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.service_authorization_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.service_authorizations a
       JOIN public.client_orders o ON o.id = NEW.order_id
       WHERE a.id = NEW.service_authorization_id AND a.client_id = o.client_id) THEN
    RAISE EXCEPTION 'The authorization must belong to the same client as the service schedule' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.create_service_authorization(_client_id uuid, _service_type text, _auth_number text, _units_authorized numeric, _effective_date date, _expiration_date date, _unit_minutes integer DEFAULT 15, _service_code text DEFAULT NULL::text, _modifier text DEFAULT NULL::text, _service_description text DEFAULT NULL::text, _period_type auth_period_type DEFAULT NULL::auth_period_type, _units_per_period numeric DEFAULT NULL::numeric, _authorizing_agent_notes text DEFAULT NULL::text, _field_values jsonb DEFAULT '{}'::jsonb, _units_used_before_caremuch numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record; v_num text := btrim(_auth_number); v_ver uuid; v_snap jsonb; v_id uuid;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO c FROM public.clients WHERE id = _client_id;
  PERFORM cp_require_scope(c.agency_id, c.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF c.virtual_office_id IS NULL THEN
    RAISE EXCEPTION 'The client has no office, so no service type can be authorized' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.office_service_types s WHERE s.virtual_office_id = c.virtual_office_id
                   AND s.service_type = _service_type AND s.is_active) THEN
    RAISE EXCEPTION 'This office does not provide that service type' USING ERRCODE = '22023';
  END IF;
  IF v_num IS NULL OR v_num !~ '^[[:graph:]][[:print:]]{0,63}$' THEN
    RAISE EXCEPTION 'The authorization number must be 1-64 printable characters' USING ERRCODE = '22023';
  END IF;
  IF _units_authorized IS NULL OR _units_authorized <= 0 OR _units_authorized > 100000 THEN
    RAISE EXCEPTION 'Units authorized must be greater than 0' USING ERRCODE = '22023';
  END IF;
  -- Phase C: opening balance at go-live (units of this authorization already used before CareMuch)
  IF _units_used_before_caremuch IS NULL OR _units_used_before_caremuch < 0 OR _units_used_before_caremuch > _units_authorized THEN
    RAISE EXCEPTION 'Units used before CareMuch must be between 0 and the units authorized' USING ERRCODE = '22023';
  END IF;
  IF _effective_date IS NULL OR _expiration_date IS NULL OR _expiration_date < _effective_date THEN
    RAISE EXCEPTION 'Valid effective and expiration dates are required' USING ERRCODE = '22023';
  END IF;
  IF _unit_minutes IS NULL OR _unit_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'Unit minutes must be between 1 and 1440' USING ERRCODE = '22023';
  END IF;
  IF _units_per_period IS NOT NULL AND _units_per_period <= 0 THEN
    RAISE EXCEPTION 'Units per period must be greater than 0' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(_service_code, '')) > 32 OR length(COALESCE(_modifier, '')) > 32
     OR length(COALESCE(_service_description, '')) > 2000 OR length(COALESCE(_authorizing_agent_notes, '')) > 4000 THEN
    RAISE EXCEPTION 'A text field is too long' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(c.agency_id::text || ':' || upper(v_num), 0));
  IF EXISTS (SELECT 1 FROM public.service_authorizations WHERE agency_id = c.agency_id AND upper(auth_number) = upper(v_num)) THEN
    RAISE EXCEPTION 'This authorization number already exists in your agency' USING ERRCODE = '23505';
  END IF;

  v_ver := cp_resolve_template(c.agency_id, c.virtual_office_id, 'authorization', NULL);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;
  PERFORM cp_validate_field_values(v_snap, COALESCE(_field_values, '{}'::jsonb));

  INSERT INTO public.service_authorizations (agency_id, virtual_office_id, client_id, auth_number, service_code, modifier,
    service_type, service_description, units_authorized, period_type, units_per_period, unit_minutes,
    effective_date, expiration_date, source_adapter, authorizing_agent_notes, units_used_before_caremuch,
    template_id, template_version, field_snapshot, field_values)
  VALUES (c.agency_id, c.virtual_office_id, c.id, v_num, NULLIF(btrim(_service_code), ''), NULLIF(btrim(_modifier), ''),
    _service_type, _service_description, _units_authorized, _period_type, _units_per_period, _unit_minutes,
    _effective_date, _expiration_date, 'manual', _authorizing_agent_notes, _units_used_before_caremuch,
    (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap, COALESCE(_field_values, '{}'::jsonb))
  RETURNING id INTO v_id;

  PERFORM cp_audit(c.agency_id, c.virtual_office_id, 'authorization_created', 'service_authorization', v_id,
    jsonb_build_object('authorization_id', v_id, 'units_authorized', _units_authorized,
      'units_used_before_caremuch', _units_used_before_caremuch));
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.correct_service_authorization(_id uuid, _changes jsonb, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a record; ws smallint; k text; v_changed text[] := ARRAY[]::text[];
  v_num text; v_eff date; v_exp date; v_units numeric; v_per public.auth_period_type; v_cap numeric; v_open numeric;
  v_charged numeric; v_bad date;
BEGIN
  SELECT client_id, service_type INTO a FROM public.service_authorizations WHERE id = _id;
  -- same lock order as review_progress_note: every authorization of the client's service, by id
  PERFORM 1 FROM public.service_authorizations WHERE client_id = a.client_id AND service_type = a.service_type ORDER BY id FOR UPDATE;
  SELECT sa.*, vo.billing_week_start ws INTO a FROM public.service_authorizations sa
    LEFT JOIN public.virtual_office vo ON vo.id = sa.virtual_office_id WHERE sa.id = _id;
  PERFORM cp_require_scope(a.agency_id, a.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF COALESCE(btrim(_reason), '') = '' OR length(_reason) > 1000 THEN
    RAISE EXCEPTION 'A reason (at most 1000 characters) is required' USING ERRCODE = '22023';
  END IF;
  IF _changes IS NULL OR jsonb_typeof(_changes) <> 'object' OR _changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Nothing to change' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_changes) LOOP
    IF k <> ALL (ARRAY['auth_number','effective_date','expiration_date','units_authorized','period_type','units_per_period',
                       'units_used_before_caremuch']) THEN
      RAISE EXCEPTION 'This field can''t be corrected here' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  BEGIN
    v_num := CASE WHEN _changes ? 'auth_number' THEN btrim(_changes ->> 'auth_number') ELSE a.auth_number END;
    v_eff := CASE WHEN _changes ? 'effective_date' THEN (_changes ->> 'effective_date')::date ELSE a.effective_date END;
    v_exp := CASE WHEN _changes ? 'expiration_date' THEN (_changes ->> 'expiration_date')::date ELSE a.expiration_date END;
    v_units := CASE WHEN _changes ? 'units_authorized' THEN (_changes ->> 'units_authorized')::numeric ELSE a.units_authorized END;
    v_per := CASE WHEN _changes ? 'period_type' THEN (_changes ->> 'period_type')::public.auth_period_type ELSE a.period_type END;
    v_cap := CASE WHEN _changes ? 'units_per_period' THEN (_changes ->> 'units_per_period')::numeric ELSE a.units_per_period END;
    v_open := CASE WHEN _changes ? 'units_used_before_caremuch' THEN (_changes ->> 'units_used_before_caremuch')::numeric ELSE a.units_used_before_caremuch END;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'A changed value has the wrong type' USING ERRCODE = '22023';
  END;
  -- the same input rules as create_service_authorization
  IF v_num IS NULL OR v_num !~ '^[[:graph:]][[:print:]]{0,63}$' THEN
    RAISE EXCEPTION 'The authorization number must be 1-64 printable characters' USING ERRCODE = '22023';
  END IF;
  IF v_units IS NULL OR v_units <= 0 OR v_units > 100000 THEN
    RAISE EXCEPTION 'Units authorized must be greater than 0' USING ERRCODE = '22023';
  END IF;
  IF v_open IS NULL OR v_open < 0 OR v_open > v_units THEN
    RAISE EXCEPTION 'Units used before CareMuch must be between 0 and the units authorized' USING ERRCODE = '22023';
  END IF;
  IF v_eff IS NULL OR v_exp IS NULL OR v_exp < v_eff THEN
    RAISE EXCEPTION 'Valid effective and expiration dates are required' USING ERRCODE = '22023';
  END IF;
  IF v_cap IS NOT NULL AND v_cap <= 0 THEN
    RAISE EXCEPTION 'Units per period must be greater than 0' USING ERRCODE = '22023';
  END IF;
  IF upper(v_num) <> upper(a.auth_number) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(a.agency_id::text || ':' || upper(v_num), 0));
    IF EXISTS (SELECT 1 FROM public.service_authorizations WHERE agency_id = a.agency_id AND upper(auth_number) = upper(v_num) AND id <> a.id) THEN
      RAISE EXCEPTION 'This authorization number already exists in your agency' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- refusal 1: units below what is already charged + the opening balance
  SELECT COALESCE(sum(units_used), 0) INTO v_charged FROM public.progress_notes
   WHERE authorization_id = a.id AND billable AND NOT voided;
  IF v_units < v_charged + v_open THEN
    RAISE EXCEPTION 'Units authorized can''t go below the % units already charged plus the % used before CareMuch',
      v_charged, v_open USING ERRCODE = '22023';
  END IF;
  -- refusal 2: the dates must still cover every reviewed or billed visit charged to it
  SELECT min(service_date) INTO v_bad FROM public.progress_notes
   WHERE authorization_id = a.id AND NOT voided AND status IN ('reviewed', 'billed')
     AND (service_date < v_eff OR service_date > v_exp);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'These dates would leave out a reviewed or billed visit on %', v_bad USING ERRCODE = '22023';
  END IF;
  -- refusal 3: a per-period cap that charged units of an existing period already exceed
  IF v_cap IS NOT NULL AND v_per IS NOT NULL THEN
    SELECT min(n.service_date) INTO v_bad FROM public.progress_notes n
     WHERE n.authorization_id = a.id AND n.billable AND NOT n.voided
       AND cp_period_left(a.id, v_per, v_cap, a.ws, n.service_date, '{}', '{}', '{}') < 0;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Units already charged exceed this cap in the period that includes %', v_bad USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_num IS DISTINCT FROM a.auth_number THEN v_changed := array_append(v_changed, 'auth_number'); END IF;
  IF v_eff IS DISTINCT FROM a.effective_date THEN v_changed := array_append(v_changed, 'effective_date'); END IF;
  IF v_exp IS DISTINCT FROM a.expiration_date THEN v_changed := array_append(v_changed, 'expiration_date'); END IF;
  IF v_units IS DISTINCT FROM a.units_authorized THEN v_changed := array_append(v_changed, 'units_authorized'); END IF;
  IF v_per IS DISTINCT FROM a.period_type THEN v_changed := array_append(v_changed, 'period_type'); END IF;
  IF v_cap IS DISTINCT FROM a.units_per_period THEN v_changed := array_append(v_changed, 'units_per_period'); END IF;
  IF v_open IS DISTINCT FROM a.units_used_before_caremuch THEN v_changed := array_append(v_changed, 'units_used_before_caremuch'); END IF;
  IF cardinality(v_changed) = 0 THEN RAISE EXCEPTION 'Nothing to change' USING ERRCODE = '22023'; END IF;

  UPDATE public.service_authorizations SET auth_number = v_num, effective_date = v_eff, expiration_date = v_exp,
         units_authorized = v_units, period_type = v_per, units_per_period = v_cap, units_used_before_caremuch = v_open
   WHERE id = a.id;
  PERFORM cp_audit(a.agency_id, a.virtual_office_id, 'authorization_corrected', 'service_authorization', a.id,
    jsonb_build_object('authorization_id', a.id, 'changed', to_jsonb(v_changed), 'reason', btrim(_reason)));
  RETURN jsonb_build_object('authorization_id', a.id, 'changed', to_jsonb(v_changed),
    'units_available', (SELECT units_available FROM public.service_authorizations WHERE id = a.id));
END $function$;

CREATE OR REPLACE FUNCTION public.get_client_authorizations(_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; v_today date; v_proj jsonb := '{}'::jsonb; s text;
BEGIN
  SELECT cl.id, cl.agency_id, cl.virtual_office_id, COALESCE(vo.timezone, 'America/New_York') tz INTO c
    FROM public.clients cl LEFT JOIN public.virtual_office vo ON vo.id = cl.virtual_office_id WHERE cl.id = _client_id;
  PERFORM cp_require_scope(c.agency_id, c.virtual_office_id, '{manager,agency_admin,scheduler}'::public.app_role[]);
  v_today := (now() AT TIME ZONE c.tz)::date;
  FOR s IN SELECT DISTINCT service_type FROM public.service_authorizations WHERE client_id = c.id LOOP
    v_proj := v_proj || cp_authorization_projection(c.id, s, v_today);
  END LOOP;
  RETURN jsonb_build_object('as_of', v_today, 'authorizations', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id, 'auth_number', a.auth_number, 'service_type', a.service_type, 'service_code', a.service_code,
      'modifier', a.modifier, 'effective_date', a.effective_date, 'expiration_date', a.expiration_date,
      'unit_minutes', a.unit_minutes, 'units_authorized', a.units_authorized,
      'units_used_before_caremuch', a.units_used_before_caremuch,
      'units_charged', ch.units, 'units_used', ch.units + a.units_used_before_caremuch,
      'units_available', a.units_available,
      'units_pending', COALESCE((v_proj -> a.id::text ->> 'pending')::numeric, 0),
      'units_left', COALESCE((v_proj -> a.id::text ->> 'left')::numeric, a.units_available),
      'period_type', a.period_type, 'units_per_period', a.units_per_period,
      'period_left', (v_proj -> a.id::text ->> 'period_left')::numeric,
      'reviewed_from', rv.d_from, 'reviewed_to', rv.d_to,
      'status', CASE WHEN a.expiration_date < v_today THEN 'expired' WHEN a.effective_date > v_today THEN 'future' ELSE 'active' END,
      'void_available', false)
      ORDER BY a.service_type, a.expiration_date, a.created_at, a.id)
    FROM public.service_authorizations a
    CROSS JOIN LATERAL (SELECT COALESCE(sum(n.units_used), 0) units FROM public.progress_notes n
                         WHERE n.authorization_id = a.id AND n.billable AND NOT n.voided) ch
    CROSS JOIN LATERAL (SELECT min(n.service_date) d_from, max(n.service_date) d_to FROM public.progress_notes n
                         WHERE n.authorization_id = a.id AND NOT n.voided AND n.status IN ('reviewed', 'billed')) rv
    WHERE a.client_id = c.id), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.list_authorization_risk(_office_id uuid, _within_days integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o record; v_today date; v_proj jsonb := '{}'::jsonb; p record;
BEGIN
  SELECT id, agency_id, COALESCE(timezone, 'America/New_York') tz INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin,scheduler}'::public.app_role[]);
  IF _within_days IS NULL OR _within_days NOT BETWEEN 0 AND 366 THEN
    RAISE EXCEPTION 'The window must be 0-366 days' USING ERRCODE = '22023';
  END IF;
  v_today := (now() AT TIME ZONE o.tz)::date;
  FOR p IN SELECT DISTINCT a.client_id, a.service_type FROM public.service_authorizations a
            WHERE a.virtual_office_id = o.id AND a.agency_id = o.agency_id
              AND a.expiration_date BETWEEN v_today AND v_today + _within_days LOOP
    v_proj := v_proj || cp_authorization_projection(p.client_id, p.service_type, v_today);
  END LOOP;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'authorization_id', a.id, 'client_id', a.client_id,
      'client_name', btrim(COALESCE(cl.first_name, '') || ' ' || COALESCE(left(cl.last_name, 1) || '.', '')),
      'auth_number', a.auth_number, 'service_type', a.service_type, 'expiration_date', a.expiration_date,
      'days', a.expiration_date - v_today,
      'band', CASE WHEN a.expiration_date - v_today <= 30 THEN 'red' WHEN a.expiration_date - v_today <= 60 THEN 'yellow' ELSE 'ok' END,
      'unit_minutes', a.unit_minutes, 'units_authorized', a.units_authorized, 'units_available', a.units_available,
      'units_pending', COALESCE((v_proj -> a.id::text ->> 'pending')::numeric, 0),
      'units_at_risk', GREATEST(COALESCE((v_proj -> a.id::text ->> 'left')::numeric, a.units_available), 0),
      'hours_at_risk', round(GREATEST(COALESCE((v_proj -> a.id::text ->> 'left')::numeric, a.units_available), 0) * a.unit_minutes / 60.0, 2))
      ORDER BY a.expiration_date, cl.first_name, a.auth_number)
    FROM public.service_authorizations a JOIN public.clients cl ON cl.id = a.client_id
    WHERE a.virtual_office_id = o.id AND a.agency_id = o.agency_id
      AND a.expiration_date BETWEEN v_today AND v_today + _within_days), '[]'::jsonb);
END $function$;

DROP INDEX public.service_authorizations_active_number_key;
ALTER TABLE public.service_authorizations
  ADD CONSTRAINT service_authorizations_agency_id_auth_number_key UNIQUE (agency_id, auth_number),
  DROP CONSTRAINT service_authorizations_void_chk,
  DROP COLUMN voided_at, DROP COLUMN voided_by, DROP COLUMN void_reason;
COMMIT;

-- Ripple UI S4 — client care plans: authorization reads (units table + G2 risk), W2 correction, and
-- the IPOS child-row write the create/edit form needs. ADDITIVE ONLY: new functions, no change to
-- any existing function, policy, trigger, table or grant (owner push rule, UI round 2 review).
--
--   cp_authorization_projection(_client_id, _service_type, _as_of)  internal (no API role). The SAME
--       FIFO allocation as cp_projected_units (demand = unreviewed notes + assigned shifts from today
--       or go-live, earliest-expiring authorization first, per-period caps), copied verbatim, but it
--       returns every authorization's result instead of one shift's verdict: pending (units the
--       demand takes from it), left (after that demand), period_left (cap left in the period that
--       contains _as_of). cp_projected_units itself is not touched (scheduling path unchanged).
--   get_client_authorizations(_client_id)  units table for the IPOS tab: authorized, used (charged +
--       opening balance), pending, left, period cap and what is left of it this period, the date range
--       of reviewed/billed visits. Authorization tier: manager, agency_admin, scheduler.
--   list_authorization_risk(_office_id, _within_days = 60)  G2: authorizations of the office expiring
--       within the window (band red <= 30 days, yellow <= 60), with units at risk = projected units
--       left that no assigned shift will use before the expiration. Authorization tier.
--   correct_service_authorization(_id, _changes, _reason)  W2 (decided Oct 4): manager, agency_admin;
--       may change auth_number, effective/expiration dates, units_authorized, period_type,
--       units_per_period, units_used_before_caremuch. Refuses: units below charged + opening balance;
--       dates that leave out a reviewed/billed visit; a cap that charged units of an existing period
--       already exceed. Audited (authorization_corrected) with the changed fields and the reason;
--       fail closed. Never deletes.
--   set_care_plan_rows(_care_plan_id, _entity, _rows)  writes one IPOS child-row structure of the
--       active plan (attendees, MichiCANS/other needs, treatment needs, DSM recommendations, natural
--       supports, other providers' services, reviews). Rows with an id are updated, rows without are
--       added, rows left out are deleted. Goals/objectives keep their own RPC (upsert_care_plan_goals),
--       so this never touches training_version. Manager, agency_admin; audited as care_plan_updated.
--
-- void_service_authorization (W2) is NOT here: it needs a voided state that the existing readers
-- (cp_projected_units = eligibility, review_progress_note, cp_client_onboarding, the order-service
-- check) must skip, i.e. changes to existing functions -> owner approval first (drafted separately).
-- Every new function: SECURITY DEFINER (except the internal helper), search_path fixed,
-- REVOKE ALL FROM PUBLIC, anon, then GRANT EXECUTE TO authenticated (CLAUDE.md rule 14).

-- =============================================================================================
-- 1. Projection per authorization (internal)
-- =============================================================================================
CREATE FUNCTION public.cp_authorization_projection(_client_id uuid, _service_type text, _as_of date)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.cp_authorization_projection(uuid, text, date) FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 2. Units table for one client (IPOS tab)
-- =============================================================================================
CREATE FUNCTION public.get_client_authorizations(_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.get_client_authorizations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_authorizations(uuid) TO authenticated;

-- =============================================================================================
-- 3. G2: authorizations expiring / units at risk (office)
-- =============================================================================================
CREATE FUNCTION public.list_authorization_risk(_office_id uuid, _within_days integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.list_authorization_risk(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_authorization_risk(uuid, integer) TO authenticated;

-- =============================================================================================
-- 4. W2: correct an authorization (never delete)
-- =============================================================================================
CREATE FUNCTION public.correct_service_authorization(_id uuid, _changes jsonb, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.correct_service_authorization(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_service_authorization(uuid, jsonb, text) TO authenticated;

-- =============================================================================================
-- 5. IPOS child rows (non-goal structures) of the active plan
-- =============================================================================================
-- Column rules per structure: name -> 'text:<max>' | 'bool' | 'date' | 'int' | 'enum:<a>|<b>'; '!' = required.
CREATE FUNCTION public.cp_plan_row_spec(_entity text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _entity
    WHEN 'care_plan_attendee' THEN '{"table":"care_plan_attendees","cols":{"name":"text:200","relationship":"text:200","attended":"bool","contributed":"bool"}}'
    WHEN 'care_plan_need' THEN '{"table":"care_plan_needs","cols":{"source":"!enum:michicans|other","item_kind":"enum:need|centerpiece_strength|strength_present","domain":"text:200","item_text":"text:4000","level_of_need":"text:200","addressed":"bool","additional_info":"text:4000"},"defaults":{"item_kind":"need"}}'
    WHEN 'care_plan_treatment_need' THEN '{"table":"care_plan_treatment_needs","cols":{"domain":"!text:200","to_address":"bool","new_need":"bool","treatment_recommendation":"text:4000","sort_order":"int"},"defaults":{"to_address":false,"new_need":false,"sort_order":0}}'
    WHEN 'care_plan_dsm_recommendation' THEN '{"table":"care_plan_dsm_recommendations","cols":{"service":"!text:200","outcome_code":"!text:64","notes":"text:4000"}}'
    WHEN 'care_plan_natural_support' THEN '{"table":"care_plan_natural_supports","cols":{"name":"text:200","support_type":"enum:natural|professional","status":"text:200","how_they_help":"text:4000"}}'
    WHEN 'care_plan_external_service' THEN '{"table":"care_plan_external_services","cols":{"provider_program":"text:200","auth_reference":"text:200","service":"text:200","effective_date":"date","expiration_date":"date","units_text":"text:200","description":"text:4000"}}'
    WHEN 'care_plan_review' THEN '{"table":"care_plan_reviews","cols":{"review_date":"date","next_review_date":"date","notes":"text:4000"}}'
  END::jsonb
$$;
REVOKE ALL ON FUNCTION public.cp_plan_row_spec(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_care_plan_rows(_care_plan_id uuid, _entity text, _rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.set_care_plan_rows(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_care_plan_rows(uuid, text, jsonb) TO authenticated;

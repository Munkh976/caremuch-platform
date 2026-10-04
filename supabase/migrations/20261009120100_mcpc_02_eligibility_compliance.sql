-- Phase C-02 — M-CP-06: care-plan compliance rules in the eligibility engine + group-session
-- exemption, caregiver-safe text (R6), projected units (past demand, go-live cutover, per-period
-- caps), shared shift-units helper.
-- Ripple care-plan module. Schema plan §7. Owner line-by-line review done 2026-10-04 (changes
-- scheduling).
--
-- Changed existing functions: every one is CREATE OR REPLACE with its IDENTICAL signature, so
-- CLAUDE.md #13 (DROP on a changed parameter list) does not apply and the existing ACLs stay as
-- they are (verified after push with pg_get_function_identity_arguments + aclexplode):
--   * check_assignment_eligibility       now a wrapper: RETURN cp_eligibility_core(shift, caregiver, NULL).
--                                         The engine body moved VERBATIM into the internal core, plus:
--                                         group-session exemption from double_booked (only same group +
--                                         same caregiver), per-caregiver group_full, compliance rules
--   * check_assignment_eligibility_bulk  client-level context (plan/training version, projected units)
--                                         computed ONCE per shift, then the core per caregiver
--   * assign_caregiver_to_shift          locks the client's authorizations (id order) before evaluating
--   * check_caregiver_shifts_eligibility  returns the caregiver-safe copy
--   * caregiver_pick_up_shift            authorization lock + caregiver-safe copy in its error and response
--   * caregiver_pickup_trade_shift       authorization lock + caregiver-safe copy to the caregiver; full
--                                         copy kept for managers
--   * create_progress_note_for_shift     units from cp_shift_units (same result)
-- match-caregiver is unchanged: it calls the bulk check, so Manual, Smart and Auto assign all
-- honour the rules.
-- Compliance rules apply only on offices with care_plan_module_enabled or
-- compliance_enforcement_enabled; hard when enforcement is on, advisory otherwise. Every other
-- office gets exactly today's result. Already-assigned shifts are not re-checked (they stay
-- assigned); list_caregivers_needing_retraining() gives the dashboard the retraining list.

-- =============================================================================================
-- 1. New helpers (internal: REVOKE ALL FROM PUBLIC, anon, authenticated; no grant)
-- =============================================================================================
-- Q18 / owner note: shift-length units in ONE place, used by note creation and by projection.
-- Elapsed minutes between the shift's start and end in the office time zone (end on the next
-- day when not after the start), in whole 15-minute units.
CREATE FUNCTION public.cp_shift_units(_date date, _start time, _end time, _tz text)
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT floor(extract(epoch FROM ((CASE WHEN e <= st THEN e + interval '1 day' ELSE e END) - st)) / 60 / 15)::int
  FROM (SELECT (_date + _start) AT TIME ZONE _tz AS st, (_date + _end) AT TIME ZONE _tz AS e) x
$$;
REVOKE ALL ON FUNCTION public.cp_shift_units(date, time, time, text) FROM PUBLIC, anon, authenticated;

-- Per-period caps (authorization period_type + units_per_period; Authorization Form 1 "20 Per
-- Week"). The window containing a date: per_day = that day; per_week = the office's billing week
-- (virtual_office.billing_week_start, Q11); per_month / per_quarter = the calendar month / quarter.
-- per_auth (or no period / no cap) = no window: only the total (units_available) applies.
CREATE FUNCTION public.cp_period_window(_period public.auth_period_type, _d date, _week_start smallint)
RETURNS daterange LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _period
    WHEN 'per_day' THEN daterange(_d, _d, '[]')
    WHEN 'per_week' THEN daterange(_d - ((extract(isodow FROM _d)::int - _week_start + 7) % 7),
                                   _d - ((extract(isodow FROM _d)::int - _week_start + 7) % 7) + 6, '[]')
    WHEN 'per_month' THEN daterange(date_trunc('month', _d::timestamp)::date, (date_trunc('month', _d::timestamp) + interval '1 month')::date, '[)')
    WHEN 'per_quarter' THEN daterange(date_trunc('quarter', _d::timestamp)::date, (date_trunc('quarter', _d::timestamp) + interval '3 months')::date, '[)')
    ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.cp_period_window(public.auth_period_type, date, smallint) FROM PUBLIC, anon, authenticated;

-- Units left in the period of _d on one authorization: units_per_period − units CHARGED to it in
-- that window (reviewed/billed billable, non-voided notes) − pending demand the caller has
-- allocated to it in that window (_dm_* arrays: authorization id, date, units). NULL = no cap.
CREATE FUNCTION public.cp_period_left(_auth uuid, _period public.auth_period_type, _cap numeric, _week_start smallint, _d date,
  _dm_auth uuid[], _dm_date date[], _dm_units numeric[])
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN _cap IS NULL OR w IS NULL THEN NULL ELSE
    _cap - COALESCE((SELECT sum(n.units_used) FROM public.progress_notes n
                      WHERE n.authorization_id = _auth AND n.billable AND NOT n.voided AND n.service_date <@ w), 0)
         - COALESCE((SELECT sum(x.u) FROM unnest(_dm_auth, _dm_date, _dm_units) AS x(a, d, u) WHERE x.a = _auth AND x.d <@ w), 0) END
  FROM (SELECT public.cp_period_window(_period, _d, _week_start) AS w) p
$$;
REVOKE ALL ON FUNCTION public.cp_period_left(uuid, public.auth_period_type, numeric, smallint, date, uuid[], date[], numeric[]) FROM PUBLIC, anon, authenticated;

-- Projected units (owner formula). For the client + service, authorizations in FIFO order
-- (expiration_date, created_at, id: the order review_progress_note uses):
--   projected_left(A) = units_available(A)                  -- = units_authorized − units used
--                                                            --   before CareMuch (opening balance)
--                                                            --   − units of reviewed/billed notes on A
--                     − Σ units of pending demand allocated to A, where pending demand is
--                         (1) notes not yet charged to an authorization (draft / submitted /
--                             returned, billable, not voided): their derived units_used, and
--                         (2) other actively assigned (non-cancelled) shifts of this client and
--                             service that have no (non-voided) note yet: their scheduled units
--                             (cp_shift_units). Future shifts always; PAST shifts only on or after
--                             the office's go-live date (virtual_office.care_plan_module_enabled_at,
--                             office time zone; NULL = no past shifts), so work done before
--                             CareMuch isn't counted twice (it is in the opening balance). A shift
--                             stops counting when its note is created (then the note counts) or
--                             when it is cancelled.
--                       Each demand, in service-date order, goes to the first authorization valid
--                       on its date with enough total AND period units left; if none has, it is
--                       still charged to the first authorization valid on its date (it may drive
--                       that one to zero or below: demand never disappears).
-- The shift being checked passes on the first authorization valid on its date with
-- projected_left >= its units AND (if the authorization has a per-period cap) period units left
-- >= its units. Result: {status: ok | missing | expired | short | short_period, projected
-- (never below 0), authorization_id (ok), period (short_period: day | week | month | quarter)}.
CREATE FUNCTION public.cp_projected_units(_client_id uuid, _service_type text, _shift_date date, _need integer, _exclude_shift uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.cp_projected_units(uuid, text, date, integer, uuid) FROM PUBLIC, anon, authenticated;

-- Client-level part of one shift's eligibility (office flags, service, active plan, units,
-- projection), independent of the caregiver. The bulk path computes it ONCE per shift and hands
-- it to cp_eligibility_core for every caregiver; a single check computes it itself.
CREATE FUNCTION public.cp_shift_client_context(_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE s record; vo record; v_svc text; v_plan record; v_need integer;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO vo FROM public.virtual_office WHERE id = s.virtual_office_id;
  IF NOT (COALESCE(vo.compliance_enforcement_enabled, false) OR COALESCE(vo.care_plan_module_enabled, false)) THEN
    RETURN jsonb_build_object('rules', false);
  END IF;
  SELECT m.service_type INTO v_svc FROM public.office_service_types m
   WHERE m.virtual_office_id = s.virtual_office_id AND m.care_type_code = s.care_type_code AND m.is_active;
  IF v_svc IS NULL OR v_svc NOT IN ('cls', 'respite') THEN
    RETURN jsonb_build_object('rules', true, 'enforce', vo.compliance_enforcement_enabled, 'svc', v_svc);
  END IF;
  SELECT id, training_version INTO v_plan FROM public.care_plans
   WHERE client_id = s.client_id AND status = 'active'
     AND (effective_date IS NULL OR effective_date <= s.shift_date) AND (expiration_date IS NULL OR expiration_date >= s.shift_date);
  v_need := cp_shift_units(s.shift_date, s.start_time, s.end_time, COALESCE(vo.timezone, 'America/New_York'));
  RETURN jsonb_build_object('rules', true, 'enforce', vo.compliance_enforcement_enabled, 'svc', v_svc,
    'plan_id', v_plan.id, 'training_version', v_plan.training_version, 'need', v_need,
    'proj', cp_projected_units(s.client_id, v_svc, s.shift_date, v_need, s.id));
END $$;
REVOKE ALL ON FUNCTION public.cp_shift_client_context(uuid) FROM PUBLIC, anon, authenticated;

-- Serializes writers that draw on one client's authorizations: every authorization of the client,
-- locked in id order (review_progress_note locks a subset in the same order, so no deadlock).
-- Called by the assign paths BEFORE they evaluate eligibility, so a concurrent assignment that
-- used the last projected units is committed and visible when the next one is checked.
CREATE FUNCTION public.cp_lock_client_authorizations(_client_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.service_authorizations WHERE client_id = _client_id ORDER BY id FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION public.cp_lock_client_authorizations(uuid) FROM PUBLIC, anon, authenticated;

-- R6: caregiver-facing copy of an eligibility result (minimum necessary). credential_missing (the
-- caregiver's own records) keeps its code with generic text; training_missing,
-- authorization_missing, authorization_expired, units_short, units_short_period and group_full are reported to the
-- caregiver as ONE generic code, 'not_bookable', so neither the code nor the text reveals a
-- client's plan, authorization or units. Every other issue is passed through unchanged.
CREATE FUNCTION public.cp_safe_issue_list(_issues jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(CASE
      WHEN x ->> 'code' = 'credential_missing' THEN jsonb_build_object('code', x ->> 'code', 'label', 'Credentials need updating',
        'detail', 'Your credentials need updating before you can take this shift. Your office will contact you.')
      WHEN x ->> 'code' IN ('training_missing', 'authorization_missing', 'authorization_expired', 'units_short', 'units_short_period', 'group_full')
        THEN jsonb_build_object('code', 'not_bookable', 'label', 'Not bookable yet',
        'detail', 'This shift can''t be booked yet. Your office will contact you.')
      ELSE x END ORDER BY o), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(_issues, '[]'::jsonb)) WITH ORDINALITY AS e(x, o)
$$;
REVOKE ALL ON FUNCTION public.cp_safe_issue_list(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cp_caregiver_safe_eligibility(_elig jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _elig IS NULL THEN NULL ELSE _elig || jsonb_build_object(
    'hard', cp_safe_issue_list(_elig -> 'hard'), 'soft', cp_safe_issue_list(_elig -> 'soft'),
    'advisory', cp_safe_issue_list(_elig -> 'advisory')) END
$$;
REVOKE ALL ON FUNCTION public.cp_caregiver_safe_eligibility(jsonb) FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 2. Eligibility engine: cp_eligibility_core (internal) + check_assignment_eligibility (wrapper,
--    identical signature and attributes; grants unchanged) + bulk (client context once per shift)
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.cp_eligibility_core(_shift_id uuid, _caregiver_id uuid, _ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  s record; cg record; cl record; svc record; r record;
  hard jsonb := '[]'::jsonb; soft jsonb := '[]'::jsonb; adv jsonb := '[]'::jsonb;
  v_cap numeric := 40; v_buffer int := 30; v_late int := 24;
  v_week_start date; v_week_end date;
  v_weekly numeric := 0; v_projected numeric; v_hours numeric;
  v_missing text[]; v_expired text[]; v_unverified text[];
  v_avail_rows int; v_covered boolean; v_dow int;
  v_hours_until numeric; v_exc record;
  -- Phase C
  v_ctx jsonb; v_enforce boolean := false; v_svc text; v_need integer; v_proj jsonb;
  v_creds text[]; v_gmax integer; v_gcount integer; v_issue jsonb;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'hard',
      jsonb_build_array(jsonb_build_object('code','shift_missing','label','Shift not found','detail','This shift no longer exists.')),
      'soft','[]'::jsonb,'advisory','[]'::jsonb,'weekly_hours',0,'projected_weekly_hours',0);
  END IF;

  SELECT * INTO cg FROM public.caregivers WHERE id = _caregiver_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'hard',
      jsonb_build_array(jsonb_build_object('code','caregiver_missing','label','Caregiver not found','detail','This caregiver no longer exists.')),
      'soft','[]'::jsonb,'advisory','[]'::jsonb,'weekly_hours',0,'projected_weekly_hours',0);
  END IF;

  SELECT COALESCE(max_weekly_hours,40), COALESCE(travel_buffer_minutes,30), COALESCE(late_trade_hours,24)
    INTO v_cap, v_buffer, v_late
  FROM public.agency WHERE id = s.agency_id;
  v_cap := COALESCE(v_cap,40); v_buffer := COALESCE(v_buffer,30); v_late := COALESCE(v_late,24);

  v_hours := COALESCE(s.duration_hours, EXTRACT(EPOCH FROM (s.end_time - s.start_time))/3600.0);

  IF cg.agency_id IS DISTINCT FROM s.agency_id THEN
    hard := hard || jsonb_build_object('code','tenancy','label','Different agency','detail','Caregiver belongs to another agency.');
  END IF;

  -- NEW: Rule B, mirrors Rule A exactly. NULL IS DISTINCT FROM NULL = false, so two
  -- not-yet-backfilled-office rows don't false-positive-block each other; any real
  -- mismatch (including one-sided NULL) does.
  IF cg.virtual_office_id IS DISTINCT FROM s.virtual_office_id THEN
    hard := hard || jsonb_build_object('code','office_scope','label','Different office','detail','Caregiver belongs to a different office.');
  END IF;

  IF cg.is_active IS FALSE THEN
    hard := hard || jsonb_build_object('code','inactive','label','Inactive caregiver','detail','This caregiver is not active.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shift_assignments a
    WHERE a.shift_id = _shift_id AND a.status IN ('in_progress','completed')
      AND a.caregiver_id <> _caregiver_id
  ) THEN
    hard := hard || jsonb_build_object('code','shift_taken','label','Shift already worked','detail','Another caregiver has already started or completed this shift.');
  END IF;

  IF s.status IN ('completed','cancelled') THEN
    hard := hard || jsonb_build_object('code','shift_state','label','Shift not open','detail','Shift is '||s.status||'.');
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT code FROM unnest(
      ARRAY[s.care_type_code]::text[] || COALESCE(s.required_skills, ARRAY[]::text[])
    ) AS code
    WHERE code IS NOT NULL AND code <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.caregiver_skills k
        WHERE k.caregiver_id = _caregiver_id AND k.care_type_code = code
      )
  ) INTO v_missing;
  IF array_length(v_missing,1) > 0 THEN
    hard := hard || jsonb_build_object('code','skill','label','Missing care service skill',
      'detail','Not qualified for '||array_to_string(v_missing,', ')||'.');
  END IF;

  SELECT ARRAY(SELECT certification_name FROM public.caregiver_certifications
               WHERE caregiver_id=_caregiver_id AND expiry_date IS NOT NULL AND expiry_date < s.shift_date)
    INTO v_expired;
  IF array_length(v_expired,1) > 0 THEN
    hard := hard || jsonb_build_object('code','certification_expired','label','Expired certification',
      'detail',array_to_string(v_expired,', ')||' expired before this shift date.');
  END IF;
  SELECT ARRAY(SELECT certification_name FROM public.caregiver_certifications
               WHERE caregiver_id=_caregiver_id AND is_verified IS NOT TRUE)
    INTO v_unverified;
  IF array_length(v_unverified,1) > 0 THEN
    hard := hard || jsonb_build_object('code','certification_unverified','label','Unverified certification',
      'detail',array_to_string(v_unverified,', ')||' has not been verified.');
  END IF;

  FOR r IN
    SELECT o.id, o.start_time, o.end_time, o.group_session_id
    FROM public.shift_assignments a
    JOIN public.shifts o ON o.id = a.shift_id
    WHERE a.caregiver_id = _caregiver_id AND a.status <> 'cancelled'
      AND o.shift_date = s.shift_date AND o.id <> s.id
  LOOP
    IF s.start_time < r.end_time AND r.start_time < s.end_time
       AND s.group_session_id IS NOT NULL AND r.group_session_id = s.group_session_id THEN
      NULL;  -- Phase C: both shifts are in the same group session and (this loop only sees
             -- _caregiver_id's own assignments) worked by the same caregiver: allowed overlap.
    ELSIF s.start_time < r.end_time AND r.start_time < s.end_time THEN
      hard := hard || jsonb_build_object('code','double_booked','label','Double booked',
        'detail','Overlaps a shift '||to_char(r.start_time,'HH24:MI')||'-'||to_char(r.end_time,'HH24:MI')||' on this day.');
    ELSIF s.start_time < r.end_time + make_interval(mins => v_buffer)
      AND r.start_time < s.end_time + make_interval(mins => v_buffer) THEN
      adv := adv || jsonb_build_object('code','travel_buffer','label','Tight turnaround',
        'detail','Less than '||v_buffer||' minutes between this and a shift at '||to_char(r.start_time,'HH24:MI')||'.');
    END IF;
  END LOOP;

  -- Phase C: per caregiver, a group session can't take more clients than its max (session
  -- value, else the office default): distinct clients THIS caregiver already has on other
  -- actively assigned shifts of the same group, plus this one.
  IF s.group_session_id IS NOT NULL THEN
    SELECT COALESCE(gs.max_clients, gvo.group_session_max_clients) INTO v_gmax
      FROM public.group_sessions gs JOIN public.virtual_office gvo ON gvo.id = gs.virtual_office_id
     WHERE gs.id = s.group_session_id;
    SELECT count(DISTINCT o.client_id) INTO v_gcount
      FROM public.shifts o
      JOIN public.shift_assignments a ON a.shift_id = o.id AND a.status <> 'cancelled' AND a.caregiver_id = _caregiver_id
     WHERE o.group_session_id = s.group_session_id AND o.id <> s.id AND o.client_id <> s.client_id;
    IF v_gcount + 1 > COALESCE(v_gmax, 3) THEN
      hard := hard || jsonb_build_object('code','group_full','label','Group session full',
        'detail','This caregiver already has '||v_gcount||' of '||COALESCE(v_gmax, 3)||' clients in this group session.');
    END IF;
  END IF;

  v_week_start := (date_trunc('week', s.shift_date::timestamp))::date;
  v_week_end := v_week_start + 6;
  SELECT COALESCE(SUM(o.duration_hours),0) INTO v_weekly
  FROM public.shift_assignments a
  JOIN public.shifts o ON o.id = a.shift_id
  WHERE a.caregiver_id = _caregiver_id AND a.status <> 'cancelled'
    AND o.shift_date BETWEEN v_week_start AND v_week_end AND o.id <> s.id;
  v_projected := round((v_weekly + v_hours)::numeric, 2);

  IF v_projected > v_cap THEN
    soft := soft || jsonb_build_object('code','weekly_hours','label','Over weekly hours cap',
      'detail','Would reach '||v_projected||'h this week (cap '||v_cap||'h).');
  ELSIF v_projected > v_cap - 8 THEN
    adv := adv || jsonb_build_object('code','overtime_risk','label','Approaching overtime',
      'detail','Would reach '||v_projected||'h of '||v_cap||'h this week.');
  END IF;

  -- CHANGED: Rule H moves from soft to hard (was: soft := soft || ...).
  IF EXISTS (SELECT 1 FROM public.time_off_requests t
             WHERE t.caregiver_id=_caregiver_id AND t.status='approved'
               AND s.shift_date BETWEEN t.start_date AND t.end_date) THEN
    hard := hard || jsonb_build_object('code','time_off','label','Approved time off',
      'detail','Caregiver has approved time off covering this date.');
  END IF;

  -- date-specific exception overrides the weekly rule for that date
  SELECT * INTO v_exc FROM public.caregiver_availability_exceptions
   WHERE caregiver_id=_caregiver_id AND exception_date = s.shift_date;

  IF FOUND THEN
    IF v_exc.is_available IS FALSE THEN
      soft := soft || jsonb_build_object('code','availability_exception','label','Unavailable on this date',
        'detail', COALESCE(NULLIF(v_exc.reason,''),'Caregiver marked this date as unavailable.'));
    ELSIF NOT (v_exc.start_time <= s.start_time AND v_exc.end_time >= s.end_time) THEN
      soft := soft || jsonb_build_object('code','availability_exception','label','Outside availability for this date',
        'detail','On this date the caregiver is only available '||to_char(v_exc.start_time,'HH24:MI')||'-'||to_char(v_exc.end_time,'HH24:MI')||'.');
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_avail_rows FROM public.caregiver_availability WHERE caregiver_id=_caregiver_id;
    IF v_avail_rows > 0 THEN
      v_dow := EXTRACT(DOW FROM s.shift_date)::int;
      SELECT EXISTS (
        SELECT 1 FROM public.caregiver_availability av
        WHERE av.caregiver_id=_caregiver_id AND av.day_of_week=v_dow AND av.is_available IS NOT FALSE
          AND av.start_time <= s.start_time AND av.end_time >= s.end_time
      ) INTO v_covered;
      IF NOT v_covered THEN
        soft := soft || jsonb_build_object('code','availability','label','Outside declared availability',
          'detail','This shift falls outside the caregiver''s availability for that weekday.');
      END IF;
    END IF;
  END IF;

  SELECT * INTO cl FROM public.clients WHERE id = s.client_id;
  -- CHANGED: Rule J moves from advisory to soft (was: adv := adv || ...). Existing
  -- zip-list check only -- real distance/mileage deferred to Phase 2 (see
  -- known-issues.md).
  IF cl.zip_code IS NOT NULL AND cg.service_zipcodes IS NOT NULL AND array_length(cg.service_zipcodes,1) > 0
     AND NOT (cl.zip_code = ANY(cg.service_zipcodes)) THEN
    soft := soft || jsonb_build_object('code','service_area','label','Outside service area',
      'detail','Client ZIP '||cl.zip_code||' is not in this caregiver''s service ZIP list.');
  END IF;
  IF cl.preferred_caregiver_id IS NOT NULL AND cl.preferred_caregiver_id <> _caregiver_id THEN
    adv := adv || jsonb_build_object('code','preferred_caregiver','label','Client has a preferred caregiver',
      'detail','Continuity of care: the client requested a specific caregiver.');
  END IF;

  SELECT * INTO svc FROM public.care_types WHERE code = s.care_type_code;
  IF svc.requires_trade_approval THEN
    adv := adv || jsonb_build_object('code','specialized_service','label','Specialised care service',
      'detail',COALESCE(svc.name,s.care_type_code)||' requires manager approval before a trade.');
  END IF;

  v_hours_until := EXTRACT(EPOCH FROM ((s.shift_date + s.start_time) - now()))/3600.0;
  IF v_hours_until > 0 AND v_hours_until < v_late THEN
    adv := adv || jsonb_build_object('code','late_trade','label','Late assignment',
      'detail','Shift starts in under '||v_late||' hours.');
  END IF;
  IF s.status = 'in_progress' THEN
    adv := adv || jsonb_build_object('code','in_progress','label','Shift in progress','detail','This shift has already started.');
  END IF;
  IF cg.reliability_score IS NOT NULL AND cg.reliability_score < 70 THEN
    adv := adv || jsonb_build_object('code','reliability','label','Low reliability score',
      'detail','Reliability score is '||cg.reliability_score||'.');
  END IF;

  -- Phase C (M-CP-06, schema plan §7): care-plan compliance rules, evaluated on the SHIFT's office.
  -- The client-level part (office flags, service, active plan, projected units) comes from
  -- _ctx when the bulk path computed it once for the shift, else from cp_shift_client_context().
  -- Only offices using the care-plan module (module flag or enforcement flag on) are evaluated,
  -- so every other office's result is unchanged. Enforcement on -> hard; off -> advisory.
  v_ctx := COALESCE(_ctx, cp_shift_client_context(_shift_id));
  v_enforce := COALESCE((v_ctx ->> 'enforce')::boolean, false);
  IF COALESCE((v_ctx ->> 'rules')::boolean, false) THEN
    -- (a) a required credential type the caregiver has no record of (expired ones are the existing rule above)
    SELECT ARRAY(SELECT t.name FROM public.credential_types t
                  WHERE t.agency_id = s.agency_id AND t.required AND t.is_active
                    AND NOT EXISTS (SELECT 1 FROM public.caregiver_certifications c
                                    WHERE c.caregiver_id = _caregiver_id AND c.credential_type_id = t.id)
                  ORDER BY t.name) INTO v_creds;
    IF array_length(v_creds, 1) > 0 THEN
      v_issue := jsonb_build_object('code','credential_missing','label','Required credential missing',
        'detail','Missing required credential(s): '||array_to_string(v_creds, ', ')||'.');
      IF v_enforce THEN hard := hard || v_issue; ELSE adv := adv || v_issue; END IF;
    END IF;
    v_svc := v_ctx ->> 'svc';
    IF v_svc IN ('cls', 'respite') THEN
      -- (b) trained on this client's current plan version (CLS and respite alike)
      IF v_ctx ->> 'plan_id' IS NULL THEN
        v_issue := jsonb_build_object('code','training_missing','label','No active plan of service',
          'detail','The client has no active plan of service on this date, so no training can apply.');
      ELSIF NOT EXISTS (SELECT 1 FROM public.plan_training_records tr
                         WHERE tr.caregiver_id = _caregiver_id AND tr.care_plan_id = (v_ctx ->> 'plan_id')::uuid
                           AND tr.training_version = (v_ctx ->> 'training_version')::int) THEN
        v_issue := jsonb_build_object('code','training_missing','label','Not trained on the current plan',
          'detail','Not trained on this client''s current plan (training version '||(v_ctx ->> 'training_version')||').');
      ELSE
        v_issue := NULL;
      END IF;
      IF v_issue IS NOT NULL THEN
        IF v_enforce THEN hard := hard || v_issue; ELSE adv := adv || v_issue; END IF;
      END IF;
      -- (c) projected authorized units cover this shift (formula: cp_projected_units)
      v_need := (v_ctx ->> 'need')::int;
      v_proj := v_ctx -> 'proj';
      v_issue := CASE v_proj ->> 'status'
        WHEN 'missing' THEN jsonb_build_object('code','authorization_missing','label','No authorization',
          'detail','The client has no '||v_svc||' authorization.')
        WHEN 'expired' THEN jsonb_build_object('code','authorization_expired','label','No authorization on this date',
          'detail','No '||v_svc||' authorization is valid on '||to_char(s.shift_date,'YYYY-MM-DD')||'.')
        WHEN 'short' THEN jsonb_build_object('code','units_short','label','Not enough authorized units',
          'detail','This shift needs '||v_need||' units; '||COALESCE((v_proj ->> 'projected'), '0')||' projected units remain after scheduled and delivered work.')
        WHEN 'short_period' THEN jsonb_build_object('code','units_short_period','label','Over the authorization''s period cap',
          'detail','This shift needs '||v_need||' units; '||COALESCE((v_proj ->> 'projected'), '0')||' left this '||(v_proj ->> 'period')||'.')
        ELSE NULL END;
      IF v_issue IS NOT NULL THEN
        IF v_enforce THEN hard := hard || v_issue; ELSE adv := adv || v_issue; END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'eligible', jsonb_array_length(hard) = 0,
    'auto_approvable', jsonb_array_length(hard) = 0 AND jsonb_array_length(soft) = 0,
    'hard', hard, 'soft', soft, 'advisory', adv,
    'weekly_hours', round(v_weekly::numeric,2), 'projected_weekly_hours', v_projected);
END;
$function$;
REVOKE ALL ON FUNCTION public.cp_eligibility_core(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_assignment_eligibility(_shift_id uuid, _caregiver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Phase C: the engine body lives in cp_eligibility_core (internal); NULL ctx = compute the
  -- client-level context for this one check.
  RETURN public.cp_eligibility_core(_shift_id, _caregiver_id, NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_assignment_eligibility_bulk(_shift_id uuid, _caregiver_ids uuid[])
 RETURNS TABLE(caregiver_id uuid, result jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ctx jsonb;
BEGIN
  -- Phase C: the client-level checks (plan/training version, projected units) are computed ONCE
  -- for the shift and shared by every caregiver; the per-caregiver rules stay in the core.
  v_ctx := public.cp_shift_client_context(_shift_id);
  RETURN QUERY
  SELECT cid, public.cp_eligibility_core(_shift_id, cid, v_ctx)
  FROM unnest(_caregiver_ids) AS cid;
END;
$function$;

-- assign_caregiver_to_shift: authorization lock before evaluating; identical signature
CREATE OR REPLACE FUNCTION public.assign_caregiver_to_shift(_shift_id uuid, _caregiver_id uuid, _method assignment_method DEFAULT 'manual'::assignment_method, _notes text DEFAULT NULL::text, _override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  elig jsonb; s record; existing record; v_id uuid; v_override boolean := false;
BEGIN
  IF NOT public.is_agency_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only agency staff can assign shifts' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found' USING ERRCODE='P0002'; END IF;
  IF s.agency_id IS DISTINCT FROM public.current_agency_id() THEN
    RAISE EXCEPTION 'Shift belongs to another agency' USING ERRCODE='42501';
  END IF;

  -- Phase C: serialize assignments drawing on this client's authorizations (id order, as review)
  PERFORM public.cp_lock_client_authorizations(s.client_id);
  elig := public.check_assignment_eligibility(_shift_id, _caregiver_id);

  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Assignment refused: %', (
      SELECT string_agg(x->>'detail', ' ') FROM jsonb_array_elements(elig->'hard') x
    ) USING ERRCODE='23514';
  END IF;

  IF jsonb_array_length(elig->'soft') > 0 THEN
    IF _override_reason IS NULL OR btrim(_override_reason) = '' THEN
      RAISE EXCEPTION 'Override reason required: %', (
        SELECT string_agg(x->>'detail', ' ') FROM jsonb_array_elements(elig->'soft') x
      ) USING ERRCODE='23514';
    END IF;
    v_override := true;
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','1',true);

  SELECT * INTO existing FROM public.shift_assignments
   WHERE shift_id=_shift_id AND status NOT IN ('completed','cancelled') LIMIT 1;

  IF FOUND THEN
    UPDATE public.shift_assignments
       SET caregiver_id=_caregiver_id, status='scheduled', assignment_method=_method,
           notes=COALESCE(_notes,notes), assigned_at=now(),
           override_reason=CASE WHEN v_override THEN btrim(_override_reason) ELSE NULL END,
           override_by=CASE WHEN v_override THEN auth.uid() ELSE NULL END,
           override_at=CASE WHEN v_override THEN now() ELSE NULL END
     WHERE id=existing.id
     RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.shift_assignments(shift_id, caregiver_id, status, assignment_method, notes,
      override_reason, override_by, override_at)
    VALUES (_shift_id,_caregiver_id,'scheduled',_method,_notes,
      CASE WHEN v_override THEN btrim(_override_reason) END,
      CASE WHEN v_override THEN auth.uid() END,
      CASE WHEN v_override THEN now() END)
    RETURNING id INTO v_id;
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','',true);
  RETURN jsonb_build_object('assignment_id', v_id, 'overridden', v_override, 'eligibility', elig);
END;
$function$;

-- =============================================================================================
-- 3. Caregiver-facing callers — caregiver-safe text (R6) + authorization lock; identical signatures
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.check_caregiver_shifts_eligibility(_shift_ids uuid[])
 RETURNS TABLE(shift_id uuid, result jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cg uuid;
BEGIN
  SELECT id INTO v_cg FROM public.caregivers WHERE user_id = auth.uid() LIMIT 1;
  IF v_cg IS NULL THEN
    RETURN; -- caller isn't a caregiver -- empty set, not an error
  END IF;

  RETURN QUERY
  SELECT sid, public.cp_caregiver_safe_eligibility(public.check_assignment_eligibility(sid, v_cg))  -- Phase C (R6): caregiver-safe text
  FROM unnest(_shift_ids) AS sid;
END;
$function$;

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

  -- Phase C: serialize assignments drawing on this client's authorizations (id order, as review)
  PERFORM public.cp_lock_client_authorizations(s.client_id);
  -- Phase C (R6): the caregiver only ever sees caregiver-safe text (error message and response)
  elig := public.cp_caregiver_safe_eligibility(public.check_assignment_eligibility(_shift_id, v_cg));
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
$function$;

CREATE OR REPLACE FUNCTION public.caregiver_pickup_trade_shift(_trade_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cg record;
  t record;
  s record;
  elig jsonb;
  existing record;
  v_id uuid;
  v_claimed uuid;
  v_safe jsonb;   -- Phase C (R6)
BEGIN
  SELECT cg.id, cg.agency_id, cg.virtual_office_id
    INTO v_cg
  FROM public.caregivers cg
  WHERE cg.user_id = auth.uid();
  IF v_cg.id IS NULL THEN
    RAISE EXCEPTION 'No caregiver profile for this user' USING ERRCODE='42501';
  END IF;

  SELECT * INTO t FROM public.shift_trades WHERE id = _trade_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trade not found' USING ERRCODE='P0002'; END IF;
  IF t.status <> 'pending' OR t.requires_manager_approval THEN
    RAISE EXCEPTION 'This trade is no longer available' USING ERRCODE='23514';
  END IF;
  IF t.original_caregiver_id = v_cg.id THEN
    RAISE EXCEPTION 'You cannot pick up your own dropped shift' USING ERRCODE='23514';
  END IF;

  SELECT * INTO s FROM public.shifts WHERE id = t.shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found' USING ERRCODE='P0002'; END IF;
  -- Office scope: shift_trades itself has no virtual_office_id column and its own RLS is
  -- agency-wide only (see docs/known-issues.md) -- this function enforces the same
  -- office boundary get_caregiver_trade_shifts() already applies at read time, so a
  -- caregiver can't pick up a trade this function's own read path wouldn't have shown them.
  IF s.agency_id IS DISTINCT FROM v_cg.agency_id OR s.virtual_office_id IS DISTINCT FROM v_cg.virtual_office_id THEN
    RAISE EXCEPTION 'This trade is not available to you' USING ERRCODE='42501';
  END IF;

  -- Phase C: serialize assignments drawing on this client's authorizations (id order, as review)
  PERFORM public.cp_lock_client_authorizations(s.client_id);
  elig := public.check_assignment_eligibility(t.shift_id, v_cg.id);
  -- Phase C (R6): the full result is kept for the manager (eligibility_snapshot, approval_reasons);
  -- the caregiver only sees the caregiver-safe copy.
  v_safe := public.cp_caregiver_safe_eligibility(elig);

  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Pick-up refused: %', (
      SELECT string_agg(x->>'detail',' ') FROM jsonb_array_elements(v_safe->'hard') x
    ) USING ERRCODE='23514';
  END IF;

  -- Soft-only: escalate to a manager, exactly like the existing staff-facing
  -- completeTrade() flow -- this is unchanged trade-path behavior, just reachable from a
  -- caregiver-safe entry point now. Claim the row atomically (WHERE status='pending') so
  -- two caregivers racing the same trade can't both succeed.
  IF jsonb_array_length(elig->'soft') > 0 THEN
    UPDATE public.shift_trades
       SET new_caregiver_id = v_cg.id,
           requires_manager_approval = true,
           approval_reasons = ARRAY(
             SELECT x->>'label' FROM jsonb_array_elements(elig->'hard' || elig->'soft') x
           ),
           eligibility_snapshot = elig,
           updated_at = now()
     WHERE id = _trade_id AND status = 'pending'
    RETURNING id INTO v_claimed;
    IF v_claimed IS NULL THEN
      RAISE EXCEPTION 'This trade is no longer available' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('status', 'sent_for_approval', 'eligibility', v_safe);
  END IF;

  -- Clean: claim the trade FIRST (atomic, race-safe), only then touch shift_assignments --
  -- avoids a losing concurrent caller reassigning the shift after another caller already won.
  UPDATE public.shift_trades
     SET new_caregiver_id = v_cg.id,
         status = 'accepted',
         auto_approved = true,
         requires_manager_approval = false,
         eligibility_snapshot = elig,
         decided_by = auth.uid(),
         resolved_at = now(),
         updated_at = now()
   WHERE id = _trade_id AND status = 'pending'
  RETURNING id INTO v_claimed;
  IF v_claimed IS NULL THEN
    RAISE EXCEPTION 'This trade is no longer available' USING ERRCODE='23514';
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','1',true);

  -- The shift is currently assigned to the ORIGINAL caregiver (trades don't touch
  -- shifts.status) -- reassign the existing row, mirroring assign_caregiver_to_shift()'s
  -- own existing-vs-insert branch exactly, rather than inserting a second row.
  SELECT * INTO existing FROM public.shift_assignments
   WHERE shift_id = t.shift_id AND status NOT IN ('completed','cancelled') LIMIT 1;

  IF FOUND THEN
    UPDATE public.shift_assignments
       SET caregiver_id = v_cg.id, status = 'scheduled', assignment_method = 'traded', assigned_at = now()
     WHERE id = existing.id
     RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.shift_assignments (shift_id, caregiver_id, status, assignment_method)
    VALUES (t.shift_id, v_cg.id, 'scheduled', 'traded')
    RETURNING id INTO v_id;
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','',true);

  RETURN jsonb_build_object('status', 'picked_up', 'assignment_id', v_id, 'eligibility', v_safe);
END;
$function$;

-- =============================================================================================
-- 4. create_progress_note_for_shift — shift units from the shared helper (Q18 note); identical signature
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.create_progress_note_for_shift(_shift_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record; v_tz text; v_start timestamptz; v_end timestamptz; v_svc text; v_kind public.progress_note_kind;
  v_plan record; v_existing uuid; v_ver uuid; v_snap jsonb; v_id uuid; v_mgr boolean; v_cg boolean;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id FOR UPDATE;               -- serializes creators
  v_mgr := s.id IS NOT NULL AND cp_staff_in_scope(s.agency_id, s.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  v_cg := s.id IS NOT NULL AND cp_is_assigned_caregiver(s.caregiver_id);
  IF NOT (v_mgr OR v_cg) THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;

  SELECT id INTO v_existing FROM public.progress_notes WHERE shift_id = s.id AND NOT voided;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;                             -- idempotent, no event

  IF s.virtual_office_id IS NULL THEN RAISE EXCEPTION 'This shift has no office' USING ERRCODE = '22023'; END IF;
  IF s.caregiver_id IS NULL THEN RAISE EXCEPTION 'This shift has no assigned caregiver' USING ERRCODE = '22023'; END IF;
  IF s.status = 'cancelled' THEN RAISE EXCEPTION 'This shift is cancelled' USING ERRCODE = '22023'; END IF;
  SELECT timezone INTO v_tz FROM public.virtual_office WHERE id = s.virtual_office_id;
  v_start := (s.shift_date + s.start_time) AT TIME ZONE v_tz;
  v_end := (s.shift_date + s.end_time) AT TIME ZONE v_tz;
  IF v_end <= v_start THEN v_end := v_end + interval '1 day'; END IF;
  IF v_cg AND NOT v_mgr AND now() < v_start THEN
    RAISE EXCEPTION 'The note opens when the shift starts' USING ERRCODE = '22023';
  END IF;

  SELECT service_type INTO v_svc FROM public.office_service_types
   WHERE virtual_office_id = s.virtual_office_id AND care_type_code = s.care_type_code AND is_active;
  IF v_svc IS NULL THEN RAISE EXCEPTION 'This office has no service mapping for the shift''s care type' USING ERRCODE = '22023'; END IF;
  IF v_svc NOT IN ('cls', 'respite') THEN RAISE EXCEPTION 'Progress notes are kept for CLS and respite services only' USING ERRCODE = '22023'; END IF;
  v_kind := v_svc::public.progress_note_kind;

  SELECT * INTO v_plan FROM public.care_plans
   WHERE client_id = s.client_id AND status = 'active'
     AND (effective_date IS NULL OR effective_date <= s.shift_date) AND (expiration_date IS NULL OR expiration_date >= s.shift_date);
  IF v_kind = 'cls' AND v_plan.id IS NULL THEN
    RAISE EXCEPTION 'The client has no active plan on this date' USING ERRCODE = '22023';
  END IF;

  v_ver := cp_resolve_template(s.agency_id, s.virtual_office_id, 'progress_note', NULL);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;

  INSERT INTO public.progress_notes (agency_id, virtual_office_id, client_id, caregiver_id, shift_id, care_plan_id,
    training_version, note_kind, service_type, service_date, scheduled_start, scheduled_end, units_scheduled,
    due_at, template_id, template_version, field_snapshot)
  VALUES (s.agency_id, s.virtual_office_id, s.client_id, s.caregiver_id, s.id, v_plan.id, v_plan.training_version,
    v_kind, v_svc, s.shift_date, v_start, v_end, cp_shift_units(s.shift_date, s.start_time, s.end_time, v_tz),
    ((s.shift_date + 2)::timestamp AT TIME ZONE v_tz), (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap)
  RETURNING id INTO v_id;

  IF v_kind = 'cls' THEN       -- one entry per this_agency objective of this service; none for CM/others
    INSERT INTO public.progress_note_entries (progress_note_id, objective_id)
    SELECT v_id, o.id FROM public.care_plan_objectives o JOIN public.care_plan_goals g ON g.id = o.goal_id
     WHERE g.care_plan_id = v_plan.id AND o.responsible_party = 'this_agency' AND o.service_type = v_svc
     ORDER BY g.seq, o.seq;
  END IF;
  PERFORM cp_audit(s.agency_id, s.virtual_office_id, 'progress_note_created', 'progress_note', v_id,
    jsonb_build_object('note_id', v_id, 'shift_id', s.id, 'entries', (SELECT count(*) FROM public.progress_note_entries WHERE progress_note_id = v_id)));
  RETURN v_id;
END $$;


-- =============================================================================================
-- 5. list_caregivers_needing_retraining — computed list for the dashboard (open question 4)
-- =============================================================================================
-- Actively assigned shifts from today on (office zone) of a CLS/respite service whose caregiver
-- has no training record at the client's current plan version. Shifts stay assigned; this only
-- lists them. Roles: manager, agency_admin, hr_staff (training tier). Read only, not audited.
CREATE FUNCTION public.list_caregivers_needing_retraining(_office_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  SELECT id, agency_id, timezone INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin,hr_staff}'::public.app_role[]);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('shift_id', s.id, 'shift_date', s.shift_date, 'caregiver_id', s.caregiver_id,
            'client_id', s.client_id, 'care_plan_id', p.id, 'training_version', p.training_version) ORDER BY s.shift_date, s.start_time, s.id)
    FROM public.shifts s
    JOIN public.office_service_types m ON m.virtual_office_id = s.virtual_office_id AND m.care_type_code = s.care_type_code
                                       AND m.is_active AND m.service_type IN ('cls', 'respite')
    JOIN public.care_plans p ON p.client_id = s.client_id AND p.status = 'active'
                            AND (p.effective_date IS NULL OR p.effective_date <= s.shift_date)
                            AND (p.expiration_date IS NULL OR p.expiration_date >= s.shift_date)
    WHERE s.virtual_office_id = o.id AND s.caregiver_id IS NOT NULL AND s.status IS DISTINCT FROM 'cancelled'
      AND s.shift_date >= (now() AT TIME ZONE o.timezone)::date
      AND NOT EXISTS (SELECT 1 FROM public.plan_training_records r
                      WHERE r.caregiver_id = s.caregiver_id AND r.care_plan_id = p.id AND r.training_version = p.training_version)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_caregivers_needing_retraining(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_caregivers_needing_retraining(uuid) TO authenticated;

-- =============================================================================================
-- 1. Schema (additive)
-- =============================================================================================
ALTER TABLE public.care_plans ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0);
CREATE UNIQUE INDEX one_pending_plan_per_client ON public.care_plans (client_id) WHERE status = 'pending';
ALTER TABLE public.plan_training_records ADD COLUMN plan_revision integer;

CREATE TABLE public.care_plan_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision >= 0),
  snapshot jsonb NOT NULL,
  summary text,
  changed_by uuid DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (care_plan_id, revision)
);
CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.care_plan_revisions
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();
ALTER TABLE public.care_plan_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read plan revisions in scope" ON public.care_plan_revisions
FOR SELECT TO authenticated USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin}'::public.app_role[]));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.care_plan_revisions FROM authenticated;
REVOKE ALL ON TABLE public.care_plan_revisions FROM anon;

-- =============================================================================================
-- 2. Revisions (Ripple's own edits of the ACTIVE version; owner: edits while pending aren't revisions)
-- =============================================================================================
-- Everything a revision compares: header, IPOS field values, goals/objectives, data questions, IPOS child rows.
CREATE FUNCTION public.cp_plan_snapshot(_care_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; v_rows jsonb := '{}'::jsonb; t text; v jsonb;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOREACH t IN ARRAY ARRAY['care_plan_treatment_needs', 'care_plan_attendees', 'care_plan_needs', 'care_plan_dsm_recommendations',
                           'care_plan_natural_supports', 'care_plan_external_services'] LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(x ORDER BY x::text), ''[]''::jsonb) FROM (SELECT to_jsonb(r) - ''id'' - ''care_plan_id'' - ''created_at'' - ''updated_at'' x FROM public.%I r WHERE r.care_plan_id = $1) s', t)
      INTO v USING p.id;
    v_rows := v_rows || jsonb_build_object(t, v);
  END LOOP;
  RETURN jsonb_build_object(
    'header', jsonb_build_object('plan_type', p.plan_type, 'meeting_date', p.meeting_date, 'effective_date', p.effective_date,
      'expiration_date', p.expiration_date, 'next_review_date', p.next_review_date, 'review_frequency', p.review_frequency,
      'michicans_date', p.michicans_date, 'facilitator_name', p.facilitator_name, 'recorder_name', p.recorder_name,
      'discharge_criteria', p.discharge_criteria, 'signed_by', p.signed_by, 'signed_date', p.signed_date),
    'field_values', p.field_values,
    'goals', cp_goal_tree(p.id),
    'measures', COALESCE((SELECT jsonb_agg(jsonb_build_object('letter', o.letter, 'seq', m.seq, 'kind', mt.kind, 'prompt_text', m.prompt_text,
        'options', m.options, 'trial_count', m.trial_count, 'is_active', m.is_active) ORDER BY o.letter, m.seq, m.prompt_text)
      FROM public.objective_measures m JOIN public.care_plan_objectives o ON o.id = m.objective_id
      JOIN public.care_plan_goals g ON g.id = o.goal_id JOIN public.measure_types mt ON mt.id = m.measure_type_id
      WHERE g.care_plan_id = p.id), '[]'::jsonb),
    'rows', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.cp_plan_snapshot(uuid) FROM PUBLIC, anon, authenticated;

-- Before an edit of an active plan that has no revision yet (plans from before S17): store its state as the baseline.
CREATE FUNCTION public.cp_revision_baseline(_care_plan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id;
  IF p.status = 'active' AND NOT EXISTS (SELECT 1 FROM public.care_plan_revisions WHERE care_plan_id = p.id) THEN
    INSERT INTO public.care_plan_revisions (agency_id, virtual_office_id, client_id, care_plan_id, revision, snapshot, summary)
    VALUES (p.agency_id, p.virtual_office_id, p.client_id, p.id, p.revision, cp_plan_snapshot(p.id), 'baseline');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cp_revision_baseline(uuid) FROM PUBLIC, anon, authenticated;

-- After an edit: an active plan whose snapshot changed gets revision + 1 (a save that changes nothing doesn't bump).
CREATE FUNCTION public.cp_record_revision(_care_plan_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; v_snap jsonb; v_last jsonb; v_parts text[]; v_rev int;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id;
  IF p.status IS DISTINCT FROM 'active' THEN RETURN NULL; END IF;
  v_snap := cp_plan_snapshot(p.id);
  SELECT snapshot INTO v_last FROM public.care_plan_revisions WHERE care_plan_id = p.id ORDER BY revision DESC LIMIT 1;
  IF v_last IS NOT DISTINCT FROM v_snap THEN RETURN p.revision; END IF;
  v_parts := ARRAY(SELECT k FROM unnest(ARRAY['header', 'field_values', 'goals', 'measures', 'rows']) k WHERE v_snap -> k IS DISTINCT FROM v_last -> k);
  v_rev := p.revision + 1;
  UPDATE public.care_plans SET revision = v_rev WHERE id = p.id;
  INSERT INTO public.care_plan_revisions (agency_id, virtual_office_id, client_id, care_plan_id, revision, snapshot, summary)
  VALUES (p.agency_id, p.virtual_office_id, p.client_id, p.id, v_rev, v_snap, array_to_string(v_parts, ', '));
  PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'care_plan_revised', 'care_plan', p.id,
    jsonb_build_object('care_plan_id', p.id, 'revision', v_rev, 'sections', to_jsonb(v_parts)));
  RETURN v_rev;
END $$;
REVOKE ALL ON FUNCTION public.cp_record_revision(uuid) FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 3. Pending -> active
-- =============================================================================================
-- A pending version becomes active when its in-service is signed and at least one training session (with attendees)
-- exists at its training version, on its effective date (today when none or an earlier date was entered; a later date
-- waits for that day: cp_activate_due_plans). The previous active version is superseded in the same transaction.
CREATE FUNCTION public.cp_try_activate_plan(_care_plan_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; a record; v_today date;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR UPDATE;
  IF NOT FOUND OR p.status <> 'pending' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plan_inservice_forms f WHERE f.care_plan_id = p.id AND f.training_version = p.training_version AND f.signed_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.plan_training_records r WHERE r.care_plan_id = p.id AND r.training_version = p.training_version) THEN
    RETURN false;
  END IF;
  SELECT (now() AT TIME ZONE COALESCE(vo.timezone, 'America/New_York'))::date INTO v_today FROM public.virtual_office vo WHERE vo.id = p.virtual_office_id;
  v_today := COALESCE(v_today, (now() AT TIME ZONE 'America/New_York')::date);
  IF p.effective_date IS NOT NULL AND p.effective_date > v_today THEN RETURN false; END IF;
  SELECT * INTO a FROM public.care_plans WHERE client_id = p.client_id AND status = 'active' FOR UPDATE;
  IF a.id IS NOT NULL AND a.version > p.version THEN RETURN false; END IF;   -- a newer version is in effect (stale pending)
  IF a.id IS NOT NULL THEN UPDATE public.care_plans SET status = 'superseded' WHERE id = a.id; END IF;
  UPDATE public.care_plans SET status = 'active', revision = 0,
         effective_date = CASE WHEN effective_date IS NULL OR effective_date < v_today THEN v_today ELSE effective_date END
   WHERE id = p.id;
  INSERT INTO public.care_plan_revisions (agency_id, virtual_office_id, client_id, care_plan_id, revision, snapshot, summary)
  VALUES (p.agency_id, p.virtual_office_id, p.client_id, p.id, 0, cp_plan_snapshot(p.id), 'activated');
  PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'care_plan_activated', 'care_plan', p.id,
    jsonb_build_object('care_plan_id', p.id, 'previous_care_plan_id', a.id, 'version', p.version, 'training_version', p.training_version,
                       'effective_date', CASE WHEN p.effective_date IS NULL OR p.effective_date < v_today THEN v_today ELSE p.effective_date END));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.cp_try_activate_plan(uuid) FROM PUBLIC, anon, authenticated;

-- Daily: pending versions that are ready and whose (later) effective date has come. For a scheduled job (service role).
CREATE FUNCTION public.cp_activate_due_plans()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.care_plans WHERE status = 'pending' ORDER BY client_id LOOP
    IF cp_try_activate_plan(r.id) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.cp_activate_due_plans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cp_activate_due_plans() TO service_role;

-- =============================================================================================
-- 4. Shift creation limits (owner decisions 1a + 1d): refused for every writer, regardless of the enforcement switch,
--    in offices using the care-plan module (or enforcement): a date after the ACTIVE IPOS's expiration date, or (CLS /
--    respite) after the latest end date of the client's non-voided authorizations for that service type. Clients with no
--    IPOS, or no authorization of that type, keep today's behaviour. Only inserts and moves (date, client, care type or
--    office changed) are checked; other updates of existing shifts (assign, status, notes) are not.
-- =============================================================================================
CREATE FUNCTION public.cp_shift_creation_limits(_client_id uuid, _office_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_on boolean; p record;
BEGIN
  SELECT COALESCE(vo.care_plan_module_enabled, false) OR COALESCE(vo.compliance_enforcement_enabled, false) INTO v_on
    FROM public.virtual_office vo WHERE vo.id = _office_id;
  IF NOT COALESCE(v_on, false) THEN RETURN jsonb_build_object('rules', false); END IF;
  SELECT version, expiration_date INTO p FROM public.care_plans WHERE client_id = _client_id AND status = 'active';
  RETURN jsonb_build_object('rules', true,
    'ipos', CASE WHEN p.version IS NULL THEN NULL ELSE jsonb_build_object('version', p.version, 'expiration_date', p.expiration_date) END,
    'services', COALESCE((SELECT jsonb_agg(jsonb_build_object('care_type_code', m.care_type_code, 'service_type', m.service_type,
        'authorized_until', (SELECT max(a.expiration_date) FROM public.service_authorizations a
                              WHERE a.client_id = _client_id AND a.service_type = m.service_type AND a.voided_at IS NULL)) ORDER BY m.care_type_code)
      FROM public.office_service_types m WHERE m.virtual_office_id = _office_id AND m.is_active AND m.service_type IN ('cls', 'respite')), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.cp_shift_creation_limits(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cp_guard_shift_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_office uuid; v_lim jsonb; v_exp date; v_svc jsonb; v_until date;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.shift_date IS NOT DISTINCT FROM OLD.shift_date AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
     AND NEW.care_type_code IS NOT DISTINCT FROM OLD.care_type_code AND NEW.virtual_office_id IS NOT DISTINCT FROM OLD.virtual_office_id THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NULL OR NEW.shift_date IS NULL OR NEW.status::text = 'cancelled' THEN RETURN NEW; END IF;
  v_office := COALESCE(NEW.virtual_office_id, (SELECT c.virtual_office_id FROM public.clients c WHERE c.id = NEW.client_id));
  v_lim := cp_shift_creation_limits(NEW.client_id, v_office);
  IF NOT (v_lim ->> 'rules')::boolean THEN RETURN NEW; END IF;
  v_exp := (v_lim #>> '{ipos,expiration_date}')::date;
  IF v_exp IS NOT NULL AND NEW.shift_date > v_exp THEN
    RAISE EXCEPTION 'IPOS v% expires on %: no visit can be scheduled after that date (start the new IPOS version or correct the expiration date)',
      v_lim #>> '{ipos,version}', to_char(v_exp, 'Mon FMDD, YYYY') USING ERRCODE = '22023';
  END IF;
  SELECT x INTO v_svc FROM jsonb_array_elements(v_lim -> 'services') x WHERE x ->> 'care_type_code' = NEW.care_type_code;
  v_until := (v_svc ->> 'authorized_until')::date;
  IF v_until IS NOT NULL AND NEW.shift_date > v_until THEN
    RAISE EXCEPTION 'No authorization for % after %', CASE v_svc ->> 'service_type' WHEN 'cls' THEN 'CLS' ELSE 'respite' END,
      to_char(v_until, 'Mon FMDD, YYYY') USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_guard_shift_dates() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_cp_guard_shift_dates BEFORE INSERT OR UPDATE OF shift_date, client_id, care_type_code, virtual_office_id
ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.cp_guard_shift_dates();

-- The same limits for a screen that creates a series (the order wizard stops the series and reports what it skipped).
CREATE FUNCTION public.get_shift_creation_limits(_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO c FROM public.clients WHERE id = _client_id;
  PERFORM cp_require_scope(c.agency_id, c.virtual_office_id, '{manager,agency_admin,scheduler,hr_staff,system_admin}'::public.app_role[]);
  RETURN cp_shift_creation_limits(c.id, c.virtual_office_id);
END $$;
REVOKE ALL ON FUNCTION public.get_shift_creation_limits(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_creation_limits(uuid) TO authenticated;

-- =============================================================================================
-- 5. IPOS expiry warnings (owner decision 1c): active plans expiring within 30 days or expired, the pending version's
--    progress, and existing visits dated after the expiration date. Manager / agency admin of the office.
-- =============================================================================================
CREATE FUNCTION public.list_ipos_expiry(_office_id uuid, _client_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE vo record; v_today date;
BEGIN
  SELECT id, agency_id, COALESCE(timezone, 'America/New_York') tz INTO vo FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(vo.agency_id, vo.id, '{manager,agency_admin}'::public.app_role[]);
  v_today := (now() AT TIME ZONE vo.tz)::date;
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'days_left')::int, x ->> 'client_name') FROM (
    SELECT jsonb_build_object('client_id', cl.id, 'client_name', btrim(COALESCE(cl.first_name, '') || ' ' || COALESCE(cl.last_name, '')),
      'care_plan_id', p.id, 'version', p.version, 'expiration_date', p.expiration_date, 'days_left', p.expiration_date - v_today,
      'band', CASE WHEN p.expiration_date - v_today <= 14 THEN 'red' WHEN p.expiration_date - v_today <= 30 THEN 'amber' ELSE 'none' END,
      'pending', (SELECT jsonb_build_object('care_plan_id', pq.id, 'version', pq.version, 'effective_date', pq.effective_date,
           'inservice_signed', EXISTS (SELECT 1 FROM public.plan_inservice_forms f WHERE f.care_plan_id = pq.id AND f.training_version = pq.training_version AND f.signed_at IS NOT NULL),
           'sessions', (SELECT count(*) FROM public.plan_training_forms t WHERE t.care_plan_id = pq.id AND t.training_version = pq.training_version))
         FROM public.care_plans pq WHERE pq.client_id = cl.id AND pq.status = 'pending'),
      'shifts_after_count', (SELECT count(*) FROM public.shifts s WHERE s.client_id = cl.id AND s.shift_date > p.expiration_date AND s.status::text <> 'cancelled'),
      'shifts_after', COALESCE((SELECT jsonb_agg(jsonb_build_object('shift_id', s.id, 'shift_date', s.shift_date, 'start_time', s.start_time) ORDER BY s.shift_date, s.start_time)
         FROM (SELECT * FROM public.shifts s WHERE s.client_id = cl.id AND s.shift_date > p.expiration_date AND s.status::text <> 'cancelled'
               ORDER BY s.shift_date, s.start_time LIMIT 20) s), '[]'::jsonb)) x
    FROM public.care_plans p JOIN public.clients cl ON cl.id = p.client_id
    WHERE p.status = 'active' AND p.virtual_office_id = vo.id AND p.expiration_date IS NOT NULL
      AND (_client_id IS NULL OR cl.id = _client_id)
      AND (p.expiration_date - v_today <= 30
           OR EXISTS (SELECT 1 FROM public.shifts s WHERE s.client_id = cl.id AND s.shift_date > p.expiration_date AND s.status::text <> 'cancelled'))) q), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_ipos_expiry(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_ipos_expiry(uuid, uuid) TO authenticated;

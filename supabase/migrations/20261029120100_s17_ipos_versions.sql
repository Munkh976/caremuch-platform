-- S17 — IPOS versions: pending -> active, revisions, shift creation limits, expiry warnings.
-- Design docs/design/s17-ipos-effective-and-revisions.md; owner approval + decisions Oct 21 (1a-1d, 2, 5).
-- Needs 20261029120000 (care_plan_status 'pending').
--
-- New: care_plans.revision, plan_training_records.plan_revision, care_plan_revisions (+RLS, read manager / agency admin),
--   one pending version per client (unique index), start_pending_plan_version (renew_care_plan's copy, the new version is
--   PENDING; refused when one is already pending), cp_try_activate_plan / cp_activate_due_plans (pending -> active when
--   the in-service is signed and a training session has attendees, on its effective date; the old version superseded in
--   the same transaction), revisions of the ACTIVE version (cp_plan_snapshot / cp_revision_baseline /
--   cp_record_revision; rev 0 at activation; a no-change save doesn't bump), the shift trigger cp_guard_shift_dates
--   (1a: no visit after the active IPOS's expiration date; 1d: CLS / respite not after the client's latest authorization
--   end date; every writer, regardless of the enforcement switch; inserts and moves only), get_shift_creation_limits
--   (series screens), list_ipos_expiry (1c warnings).
-- Changed (existing functions, approved; same signatures, CREATE OR REPLACE, grants re-stated; bodies = DEV's + the
--   marked S17 lines): update_care_plan_fields, upsert_care_plan_goals, set_objective_measures, set_care_plan_rows
--   (accept pending; revisions), would_bump_training_version + upsert_care_plan_goals (a pending version never bumps),
--   record_inservice_form, record_training_form, add_training_attendees (accept pending; plan_revision; activation),
--   get_client_training_context (the pending version when there is one; 'in_effect'; plan_revision),
--   cp_attachment_parent (S4b: files on a pending version).
-- events CHECK: the 55 values of 20261028120000 + care_plan_activated, care_plan_revised.
-- Unchanged: renew_care_plan, notes (create_progress_note_for_shift), eligibility (cp_eligibility_core,
--   cp_shift_client_context), every assign / trade / pickup function.

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
  'care_plan_activated', 'care_plan_revised'
]::text[]));

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

-- =============================================================================================
-- 6. start_pending_plan_version
-- =============================================================================================
CREATE FUNCTION public.start_pending_plan_version(_care_plan_id uuid, _plan_type care_plan_type DEFAULT 'annual'::care_plan_type, _header jsonb DEFAULT NULL::jsonb, _field_values jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record; v_ver uuid; v_snap jsonb; v_vals jsonb; v_keys text[]; v_retired jsonb; v_new uuid; v_version int; v_tv int;
  g record; o record; tn record; v_gid uuid; v_oid uuid; v_omap jsonb := '{}'::jsonb; v_tmap jsonb := '{}'::jsonb; h jsonb;
BEGIN
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR UPDATE;
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  PERFORM 1 FROM public.clients WHERE id = p.client_id FOR UPDATE;
  IF p.status <> 'active' THEN RAISE EXCEPTION 'A new version starts from the active plan' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.care_plans WHERE client_id = p.client_id AND status = 'pending') THEN
    RAISE EXCEPTION 'A new IPOS version is already pending for this client' USING ERRCODE = '22023';
  END IF;

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
  INSERT INTO public.care_plans (agency_id, virtual_office_id, client_id, version, training_version, status, plan_type,
    meeting_date, effective_date, expiration_date, next_review_date, review_frequency, michicans_date,
    facilitator_name, recorder_name, discharge_criteria, signed_by, signed_date,
    template_id, template_version, field_snapshot, field_values)
  VALUES (p.agency_id, p.virtual_office_id, p.client_id, v_version, v_tv, 'pending', COALESCE(_plan_type, 'annual'),
    (h ->> 'meeting_date')::date, (h ->> 'effective_date')::date, (h ->> 'expiration_date')::date,
    (h ->> 'next_review_date')::date, h ->> 'review_frequency', (h ->> 'michicans_date')::date,
    h ->> 'facilitator_name', h ->> 'recorder_name', h ->> 'discharge_criteria', h ->> 'signed_by', (h ->> 'signed_date')::date,
    (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap, v_vals)
  RETURNING id INTO v_new;

  -- copy children forward for editing (the active version keeps its own)
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
    jsonb_build_object('care_plan_id', v_new, 'previous_care_plan_id', p.id, 'version', v_version, 'training_version', v_tv, 'pending', true));
  RETURN v_new;
END $function$;
REVOKE ALL ON FUNCTION public.start_pending_plan_version(uuid, care_plan_type, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_pending_plan_version(uuid, care_plan_type, jsonb, jsonb) TO authenticated;

-- =============================================================================================
-- 7. Existing functions (approved changes)
-- =============================================================================================
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
  IF p.status NOT IN ('active', 'pending') THEN RAISE EXCEPTION 'Only the active or pending plan can be edited' USING ERRCODE = '22023'; END IF;
  PERFORM cp_revision_baseline(p.id);   -- S17: revisions of the active version
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
  PERFORM cp_record_revision(p.id);
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
  IF p.status NOT IN ('active', 'pending') THEN RAISE EXCEPTION 'Only the active or pending plan can be edited' USING ERRCODE = '22023'; END IF;
  PERFORM cp_revision_baseline(p.id);   -- S17: revisions of the active version
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
    -- S17: a pending version never bumps its training version
    IF p.status = 'active' AND (EXISTS (SELECT 1 FROM public.plan_inservice_forms WHERE care_plan_id = p.id AND training_version = p.training_version)
       OR EXISTS (SELECT 1 FROM public.plan_training_forms WHERE care_plan_id = p.id AND training_version = p.training_version)) THEN
      v_tv := p.training_version + 1;
      UPDATE public.care_plans SET training_version = v_tv WHERE id = p.id;
      PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'training_version_bumped', 'care_plan', p.id,
        jsonb_build_object('care_plan_id', p.id, 'training_version', v_tv, 'goals', v_ng, 'objectives', v_no));
    ELSE
      PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'care_plan_updated', 'care_plan', p.id,
        jsonb_build_object('care_plan_id', p.id, 'training_version', v_tv, 'goals', v_ng, 'objectives', v_no));
    END IF;
  END IF;
  PERFORM cp_record_revision(p.id);
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
  IF p.status NOT IN ('active', 'pending') THEN RAISE EXCEPTION 'Only the active or pending plan can be edited' USING ERRCODE = '22023'; END IF;
  PERFORM cp_revision_baseline(p.id);   -- S17: revisions of the active version
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
  PERFORM cp_record_revision(p.id);
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
  IF p.status NOT IN ('active', 'pending') THEN RAISE EXCEPTION 'Only the active or pending plan can be edited' USING ERRCODE = '22023'; END IF;
  PERFORM cp_revision_baseline(p.id);   -- S17: revisions of the active version
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
  PERFORM cp_record_revision(p.id);
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
  SELECT id, agency_id, virtual_office_id, training_version, status INTO p FROM public.care_plans WHERE id = _care_plan_id;
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
  -- S17: a pending version never bumps
  v_trained := p.status = 'active' AND (EXISTS (SELECT 1 FROM public.plan_inservice_forms WHERE care_plan_id = p.id AND training_version = p.training_version)
            OR EXISTS (SELECT 1 FROM public.plan_training_forms WHERE care_plan_id = p.id AND training_version = p.training_version));
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
  -- S17: recordings for a pending version run one at a time (they can activate it)
  PERFORM 1 FROM public.care_plans WHERE id = _care_plan_id AND status = 'pending' FOR UPDATE;
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR SHARE;   -- blocks a concurrent training_version bump
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
  IF p.status NOT IN ('active', 'pending') THEN RAISE EXCEPTION 'Training is recorded against the active or pending plan' USING ERRCODE = '22023'; END IF;
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
  PERFORM cp_try_activate_plan(p.id);
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
  -- S17: recordings for a pending version run one at a time (they can activate it)
  PERFORM 1 FROM public.care_plans WHERE id = _care_plan_id AND status = 'pending' FOR UPDATE;
  SELECT * INTO p FROM public.care_plans WHERE id = _care_plan_id FOR SHARE;
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
  IF p.status NOT IN ('active', 'pending') THEN RAISE EXCEPTION 'Training is recorded against the active or pending plan' USING ERRCODE = '22023'; END IF;
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
    care_plan_id, training_version, training_date, training_method, primary_clinician_name, trainer_name, signed_date, plan_revision)
  SELECT v_id, p.agency_id, p.virtual_office_id, (e ->> 'caregiver_id')::uuid, p.client_id, p.id, p.training_version,
         (e ->> 'training_date')::date, (e ->> 'training_method')::public.training_method,
         NULLIF(btrim(e ->> 'primary_clinician_name'), ''), NULLIF(btrim(e ->> 'trainer_name'), ''), (e ->> 'signed_date')::date, p.revision
  FROM jsonb_array_elements(_records) e;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM cp_audit(p.agency_id, p.virtual_office_id, 'training_recorded', 'plan_training_form', v_id,
    jsonb_build_object('training_form_id', v_id, 'care_plan_id', p.id, 'training_version', p.training_version, 'records', v_n));
  PERFORM cp_try_activate_plan(p.id);
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
  PERFORM 1 FROM public.care_plans WHERE id = t.care_plan_id AND status = 'pending' FOR UPDATE;   -- S17
  SELECT * INTO p FROM public.care_plans WHERE id = t.care_plan_id FOR SHARE;   -- blocks a concurrent training_version bump
  PERFORM cp_require_scope(p.agency_id, p.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
  IF p.status NOT IN ('active', 'pending') OR t.training_version <> p.training_version THEN
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
    care_plan_id, training_version, training_date, training_method, primary_clinician_name, trainer_name, signed_date, plan_revision)
  SELECT t.id, t.agency_id, t.virtual_office_id, (e ->> 'caregiver_id')::uuid, t.client_id, t.care_plan_id, t.training_version,
         COALESCE(v_date, (t.created_at AT TIME ZONE 'UTC')::date), (e ->> 'training_method')::public.training_method,
         NULLIF(btrim(e ->> 'primary_clinician_name'), ''), v_trainer, (e ->> 'signed_date')::date, p.revision
  FROM jsonb_array_elements(_records) e;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM cp_audit(t.agency_id, t.virtual_office_id, 'training_recorded', 'plan_training_form', t.id,
    jsonb_build_object('training_form_id', t.id, 'care_plan_id', t.care_plan_id, 'training_version', t.training_version, 'records', v_n, 'added', true));
  PERFORM cp_try_activate_plan(p.id);
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
  -- S17: the version being trained = the pending one when there is one, else the active one
  SELECT id, version, training_version, plan_type, effective_date, expiration_date, status, revision INTO p
    FROM public.care_plans WHERE client_id = c.id AND status IN ('active', 'pending') ORDER BY (status = 'pending') DESC LIMIT 1;
  v_in := cp_resolve_template(c.agency_id, c.virtual_office_id, 'inservice', NULL);
  v_tr := cp_resolve_template(c.agency_id, c.virtual_office_id, 'training', NULL);
  RETURN jsonb_build_object(
    'client_id', c.id,
    'client_name', btrim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')),
    'client_short', btrim(COALESCE(c.first_name, '') || ' ' || left(COALESCE(c.last_name, ''), 1) || CASE WHEN COALESCE(c.last_name, '') <> '' THEN '.' ELSE '' END),
    'case_number', c.case_number,
    'agency_name', c.agency_name, 'office_id', c.virtual_office_id, 'office_name', c.office_name, 'as_of', v_today,
    'plan', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('care_plan_id', p.id, 'version', p.version, 'training_version', p.training_version,
              'plan_type', p.plan_type, 'effective_date', p.effective_date, 'expiration_date', p.expiration_date,
              'status', p.status, 'revision', p.revision) END,
    'in_effect', (SELECT jsonb_build_object('care_plan_id', a.id, 'version', a.version, 'training_version', a.training_version,
              'effective_date', a.effective_date, 'expiration_date', a.expiration_date)
              FROM public.care_plans a WHERE a.client_id = c.id AND a.status = 'active' AND a.id IS DISTINCT FROM p.id),
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
              'signed_date', r.signed_date, 'plan_revision', r.plan_revision) ORDER BY g.last_name, g.first_name)
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
    SELECT f.agency_id, f.virtual_office_id, f.client_id, NULL, (p.status IN ('active', 'pending') AND f.training_version = p.training_version)
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.plan_inservice_forms f JOIN public.care_plans p ON p.id = f.care_plan_id WHERE f.id = _id;
  ELSIF _kind = 'training_form' THEN
    SELECT f.agency_id, f.virtual_office_id, f.client_id, NULL, (p.status IN ('active', 'pending') AND f.training_version = p.training_version)
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.plan_training_forms f JOIN public.care_plans p ON p.id = f.care_plan_id WHERE f.id = _id;
  ELSIF _kind = 'care_plan' THEN
    SELECT p.agency_id, p.virtual_office_id, p.client_id, NULL, (p.status IN ('active', 'pending'))
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.care_plans p WHERE p.id = _id;
  ELSIF _kind = 'credential' THEN
    SELECT g.agency_id, g.virtual_office_id, NULL, g.id, (c.credential_type_id IS NOT NULL)
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.caregiver_certifications c JOIN public.caregivers g ON g.id = c.caregiver_id WHERE c.id = _id;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.cp_attachment_parent(text, uuid) FROM PUBLIC, anon, authenticated;


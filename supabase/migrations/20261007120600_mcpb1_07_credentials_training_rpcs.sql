-- Phase B1-07 — credentials and per-client training: enter_caregiver_credential,
-- record_inservice_form, record_training_form, override_training_record.
-- Ripple care-plan module. Schema plan §8; arch §11.6, §12; owner decisions R3, Q17. DRAFT FOR REVIEW.
--
-- Role tier (writes): hr_staff, manager, agency_admin, with the live M-Office office check on the
-- caregiver's office (credentials) or the plan's office (training). Q17: hr_staff and managers
-- enter; a manager can override an entry someone else made; hr_staff cannot change a row a
-- manager entered or overrode. Every row keeps entered_by, and an override records
-- overridden_by/overridden_at plus the previous values in change_history.
--
-- caregiver_certifications (existing table, extended in Phase A):
--   * ONE row per (caregiver, credential type): a renewal updates that row in place. The live
--     eligibility rule hard-blocks on ANY expired or unverified row of the caregiver, so a second
--     row would leave the expired one blocking. Rows without a credential type are untouched.
--   * Manual entry sets is_verified = true (R3).
--   * Closes the known-issues office gap FOR WRITES: the staff FOR ALL policy (agency check only)
--     becomes SELECT-only with the same predicate, and authenticated loses INSERT/UPDATE/DELETE/
--     TRUNCATE. Verified first (2026-10-04): no app code, Edge Function or database function writes
--     this table. The read-side office gap stays logged in known-issues.
-- Training: step 1 in-service (CM trains the program lead, who signs) must exist and be signed at
-- the plan's current training_version before step 2 (program lead trains caregivers) is recorded.
-- Audited: credential_entered, credential_overridden, inservice_signed, training_recorded,
-- training_record_overridden (ids, versions and counts only).

-- =============================================================================================
-- 1. Schema additions + write lock-down on caregiver_certifications
-- =============================================================================================
ALTER TABLE public.caregiver_certifications
  ADD COLUMN overridden_by uuid,
  ADD COLUMN overridden_at timestamptz,
  ADD COLUMN change_history jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX caregiver_certifications_one_per_type
  ON public.caregiver_certifications (caregiver_id, credential_type_id) WHERE credential_type_id IS NOT NULL;

DROP POLICY IF EXISTS "Agency staff manage certifications in their agency" ON public.caregiver_certifications;
CREATE POLICY "Agency staff read certifications in their agency" ON public.caregiver_certifications
FOR SELECT TO authenticated
USING (is_agency_staff(auth.uid()) AND caregiver_agency_id(caregiver_id) = current_agency_id());
-- kept unchanged: "Caregivers read their own certifications" (SELECT)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.caregiver_certifications FROM authenticated;
REVOKE ALL ON TABLE public.caregiver_certifications FROM anon;

ALTER TABLE public.plan_training_records
  ADD COLUMN overridden_by uuid,
  ADD COLUMN overridden_at timestamptz,
  ADD COLUMN change_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- =============================================================================================
-- 2. enter_caregiver_credential — insert, renew in place, or (manager) override
-- =============================================================================================
CREATE FUNCTION public.enter_caregiver_credential(
  _caregiver_id uuid, _credential_type_id uuid, _effective_date date, _expiry_date date,
  _certification_number text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g record; t record; r record; v_uid uuid := auth.uid(); v_mgr boolean; v_override boolean; v_id uuid;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO g FROM public.caregivers WHERE id = _caregiver_id;
  PERFORM cp_require_scope(g.agency_id, g.virtual_office_id, '{hr_staff,manager,agency_admin}'::public.app_role[]);
  SELECT id, name INTO t FROM public.credential_types WHERE id = _credential_type_id AND agency_id = g.agency_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown credential type' USING ERRCODE = '22023'; END IF;
  IF _expiry_date IS NULL OR (_effective_date IS NOT NULL AND _expiry_date < _effective_date) THEN
    RAISE EXCEPTION 'A valid expiry date (on or after the effective date) is required' USING ERRCODE = '22023';
  END IF;
  IF _effective_date IS NOT NULL AND _expiry_date > _effective_date + interval '20 years' THEN
    RAISE EXCEPTION 'The expiry date is too far in the future' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(_certification_number, '')) > 64 THEN
    RAISE EXCEPTION 'The certification number is too long' USING ERRCODE = '22023';
  END IF;
  v_mgr := has_role(v_uid, 'manager'::public.app_role) OR has_role(v_uid, 'agency_admin'::public.app_role);

  SELECT * INTO r FROM public.caregiver_certifications
   WHERE caregiver_id = g.id AND credential_type_id = t.id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.caregiver_certifications (caregiver_id, certification_name, certification_number, issued_date,
      effective_date, expiry_date, is_verified, credential_type_id, entered_by, is_demo)
    VALUES (g.id, t.name, NULLIF(btrim(_certification_number), ''), _effective_date, _effective_date, _expiry_date,
      true, t.id, v_uid, false)
    RETURNING id INTO v_id;
    PERFORM cp_audit(g.agency_id, g.virtual_office_id, 'credential_entered', 'caregiver_certification', v_id,
      jsonb_build_object('certification_id', v_id, 'caregiver_id', g.id, 'credential_type_id', t.id, 'renewal', false));
    RETURN v_id;
  END IF;

  IF NOT v_mgr AND (r.overridden_by IS NOT NULL
                    OR (r.entered_by IS NOT NULL AND (has_role(r.entered_by, 'manager'::public.app_role)
                                                      OR has_role(r.entered_by, 'agency_admin'::public.app_role)))) THEN
    RAISE EXCEPTION 'A manager entered or overrode this credential; only a manager can change it' USING ERRCODE = '42501';
  END IF;
  v_override := v_mgr AND COALESCE(r.overridden_by, r.entered_by) IS DISTINCT FROM v_uid;
  UPDATE public.caregiver_certifications SET
    certification_number = NULLIF(btrim(_certification_number), ''), issued_date = _effective_date,
    effective_date = _effective_date, expiry_date = _expiry_date, is_verified = true, updated_at = now(),
    overridden_by = CASE WHEN v_override THEN v_uid ELSE overridden_by END,
    overridden_at = CASE WHEN v_override THEN now() ELSE overridden_at END,
    change_history = change_history || jsonb_build_array(jsonb_build_object(
      'changed_at', now(), 'changed_by', v_uid, 'override', v_override,
      'previous_writer', COALESCE(r.overridden_by, r.entered_by),
      'previous_effective_date', r.effective_date, 'previous_expiry_date', r.expiry_date,
      'previous_certification_number', r.certification_number))
  WHERE id = r.id;
  PERFORM cp_audit(g.agency_id, g.virtual_office_id,
    CASE WHEN v_override THEN 'credential_overridden' ELSE 'credential_entered' END,
    'caregiver_certification', r.id,
    jsonb_build_object('certification_id', r.id, 'caregiver_id', g.id, 'credential_type_id', t.id, 'renewal', NOT v_override));
  RETURN r.id;
END $$;
REVOKE ALL ON FUNCTION public.enter_caregiver_credential(uuid, uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enter_caregiver_credential(uuid, uuid, date, date, text) TO authenticated;

-- =============================================================================================
-- 3. record_inservice_form — step 1 (CM trains the program lead, who signs)
-- =============================================================================================
CREATE FUNCTION public.record_inservice_form(
  _care_plan_id uuid, _case_manager_name text, _program_lead_id uuid, _trained_on date, _signed_at timestamptz,
  _field_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.record_inservice_form(uuid, text, uuid, date, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inservice_form(uuid, text, uuid, date, timestamptz, jsonb) TO authenticated;

-- =============================================================================================
-- 4. record_training_form — step 2 (program lead trains caregivers) at the current training_version
-- =============================================================================================
-- _records: [{caregiver_id, training_date, training_method?, primary_clinician_name?, trainer_name?,
-- signed_date?}], 1-100, each caregiver once, each in the caller's office scope.
CREATE FUNCTION public.record_training_form(
  _care_plan_id uuid, _plan_document_type public.plan_document_type, _plan_effective_date date, _location text,
  _records jsonb, _field_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.record_training_form(uuid, public.plan_document_type, date, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_training_form(uuid, public.plan_document_type, date, text, jsonb, jsonb) TO authenticated;

-- =============================================================================================
-- 5. override_training_record — manager / agency_admin correct a recorded training row (Q17)
-- =============================================================================================
CREATE FUNCTION public.override_training_record(
  _record_id uuid, _training_date date, _training_method public.training_method,
  _primary_clinician_name text, _trainer_name text, _signed_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.plan_training_records WHERE id = _record_id FOR UPDATE;
  PERFORM cp_require_scope(r.agency_id, r.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF _training_date IS NULL OR _training_date > current_date + 1
     OR length(COALESCE(_primary_clinician_name, '')) > 200 OR length(COALESCE(_trainer_name, '')) > 200 THEN
    RAISE EXCEPTION 'A training date (not in the future) is required; names at most 200 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE public.plan_training_records SET
    training_date = _training_date, training_method = _training_method,
    primary_clinician_name = NULLIF(btrim(_primary_clinician_name), ''), trainer_name = NULLIF(btrim(_trainer_name), ''),
    signed_date = _signed_date, overridden_by = auth.uid(), overridden_at = now(),
    change_history = change_history || jsonb_build_array(jsonb_build_object(
      'changed_at', now(), 'changed_by', auth.uid(), 'previous_writer', COALESCE(r.overridden_by, r.entered_by),
      'previous_training_date', r.training_date, 'previous_training_method', r.training_method,
      'previous_primary_clinician_name', r.primary_clinician_name, 'previous_trainer_name', r.trainer_name,
      'previous_signed_date', r.signed_date))
  WHERE id = r.id;
  PERFORM cp_audit(r.agency_id, r.virtual_office_id, 'training_record_overridden', 'plan_training_record', r.id,
    jsonb_build_object('training_record_id', r.id, 'care_plan_id', r.care_plan_id, 'training_version', r.training_version));
END $$;
REVOKE ALL ON FUNCTION public.override_training_record(uuid, date, public.training_method, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.override_training_record(uuid, date, public.training_method, text, text, date) TO authenticated;

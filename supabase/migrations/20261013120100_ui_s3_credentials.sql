-- Ripple UI S3 — caregiver credentials + training: read G1 and the caregiver compliance read.
-- ADDITIVE ONLY: new functions; no existing function, policy, trigger, constraint or table changes.
-- Same baseline as S2: SECURITY DEFINER, fixed search_path, REVOKE ALL FROM PUBLIC, anon before GRANT
-- EXECUTE TO authenticated (rule 14), cp_require_scope with the TRAINING tier (manager, agency_admin,
-- hr_staff), generic denial. Both are office-scoped through the office / the caregiver's office, so
-- they are stricter than the agency-wide caregiver_certifications read policy (known-issues).
--
--   list_credential_expirations(_office_id, _within_days default 60)  G1: the office's active caregivers'
--       credentials that are overdue or expire within the window, plus required types with no record.
--       Bands (Q16, fixed): overdue (before today), red (<= 30 days), yellow (<= 60 days), missing.
--       "Today" is the office's date (its time zone).
--   get_caregiver_compliance(_caregiver_id)  the Credentials & Training tab: every active credential
--       type of the agency with the caregiver's record (entered by / overridden by / history, names of
--       staff only), and per-client plan training: trained version vs the client's current
--       training_version, needs_retraining. No clinical content: client first name + last initial,
--       version numbers and dates only (hr_staff never reads care plans).

-- =============================================================================================
-- G1 list_credential_expirations
-- =============================================================================================
CREATE FUNCTION public.list_credential_expirations(_office_id uuid, _within_days integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; v_today date; v_days int := LEAST(GREATEST(COALESCE(_within_days, 60), 1), 365);
BEGIN
  SELECT id, agency_id, timezone INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin,hr_staff}'::public.app_role[]);
  v_today := (now() AT TIME ZONE COALESCE(o.timezone, 'America/New_York'))::date;
  RETURN COALESCE((
    SELECT jsonb_agg(r ORDER BY (r ->> 'sort')::int, r ->> 'expiry_date' NULLS FIRST, r ->> 'caregiver_name', r ->> 'credential_type')
    FROM (
      SELECT jsonb_build_object(
        'caregiver_id', g.id, 'caregiver_name', btrim(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')),
        'credential_type_id', t.id, 'credential_type', t.name, 'category', t.category, 'required', t.required,
        'certification_id', c.id, 'expiry_date', c.expiry_date,
        'days', CASE WHEN c.expiry_date IS NULL THEN NULL ELSE c.expiry_date - v_today END,
        'band', CASE WHEN c.id IS NULL THEN 'missing' WHEN c.expiry_date < v_today THEN 'overdue'
                     WHEN c.expiry_date - v_today <= 30 THEN 'red' ELSE 'yellow' END,
        'sort', CASE WHEN c.id IS NULL THEN 1 WHEN c.expiry_date < v_today THEN 0 WHEN c.expiry_date - v_today <= 30 THEN 2 ELSE 3 END) AS r
      FROM public.caregivers g
      JOIN public.credential_types t ON t.agency_id = g.agency_id AND t.is_active
      LEFT JOIN public.caregiver_certifications c ON c.caregiver_id = g.id AND c.credential_type_id = t.id
      WHERE g.virtual_office_id = o.id AND g.agency_id = o.agency_id AND g.is_active IS NOT FALSE
        AND ((c.id IS NULL AND t.required)
             OR (c.id IS NOT NULL AND c.expiry_date IS NOT NULL AND c.expiry_date - v_today <= LEAST(v_days, 60)))
    ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_credential_expirations(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_credential_expirations(uuid, integer) TO authenticated;

-- =============================================================================================
-- get_caregiver_compliance
-- =============================================================================================
CREATE FUNCTION public.get_caregiver_compliance(_caregiver_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; v_today date;
BEGIN
  SELECT cg.id, cg.agency_id, cg.virtual_office_id, COALESCE(vo.timezone, 'America/New_York') tz INTO g
    FROM public.caregivers cg LEFT JOIN public.virtual_office vo ON vo.id = cg.virtual_office_id WHERE cg.id = _caregiver_id;
  PERFORM cp_require_scope(g.agency_id, g.virtual_office_id, '{manager,agency_admin,hr_staff}'::public.app_role[]);
  v_today := (now() AT TIME ZONE g.tz)::date;
  RETURN jsonb_build_object(
    'caregiver_id', g.id, 'as_of', v_today,
    'credentials', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'credential_type_id', t.id, 'name', t.name, 'category', t.category, 'required', t.required, 'valid_months', t.valid_months,
        'certification_id', c.id, 'effective_date', c.effective_date, 'expiry_date', c.expiry_date,
        'certification_number', c.certification_number,
        'entered_by', pe.full_name, 'entered_by_manager', (c.entered_by IS NOT NULL AND (has_role(c.entered_by, 'manager'::public.app_role) OR has_role(c.entered_by, 'agency_admin'::public.app_role))),
        'overridden_by', po.full_name, 'overridden_at', c.overridden_at, 'updated_at', c.updated_at,
        'locked_for_hr', (c.overridden_by IS NOT NULL OR (c.entered_by IS NOT NULL AND (has_role(c.entered_by, 'manager'::public.app_role) OR has_role(c.entered_by, 'agency_admin'::public.app_role)))),
        'history', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'changed_at', h ->> 'changed_at', 'changed_by', ph.full_name, 'override', (h ->> 'override')::boolean,
            'previous_writer', pw.full_name, 'previous_effective_date', h ->> 'previous_effective_date',
            'previous_expiry_date', h ->> 'previous_expiry_date') ORDER BY h ->> 'changed_at' DESC), '[]'::jsonb)
          FROM jsonb_array_elements(COALESCE(c.change_history, '[]'::jsonb)) h
          LEFT JOIN public.profiles ph ON ph.id = (h ->> 'changed_by')::uuid
          LEFT JOIN public.profiles pw ON pw.id = (h ->> 'previous_writer')::uuid)
      ) ORDER BY t.category, t.name)
      FROM public.credential_types t
      LEFT JOIN public.caregiver_certifications c ON c.caregiver_id = g.id AND c.credential_type_id = t.id
      LEFT JOIN public.profiles pe ON pe.id = c.entered_by
      LEFT JOIN public.profiles po ON po.id = c.overridden_by
      WHERE t.agency_id = g.agency_id AND t.is_active), '[]'::jsonb),
    'training', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id', cl.id, 'client_name', btrim(COALESCE(cl.first_name, '') || ' ' || left(COALESCE(cl.last_name, ''), 1) || CASE WHEN COALESCE(cl.last_name, '') <> '' THEN '.' ELSE '' END),
        'current_version', ap.training_version,
        -- highest version this caregiver was trained on for this client (versions carry across renewals)
        'trained_version', (SELECT max(r2.training_version) FROM public.plan_training_records r2 WHERE r2.caregiver_id = g.id AND r2.client_id = cl.id),
        'last_training_date', (SELECT max(r3.training_date) FROM public.plan_training_records r3 WHERE r3.caregiver_id = g.id AND r3.client_id = cl.id),
        'needs_retraining', ap.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.plan_training_records r4
                              WHERE r4.caregiver_id = g.id AND r4.care_plan_id = ap.id AND r4.training_version = ap.training_version)
      ) ORDER BY cl.first_name, cl.last_name, cl.id)
      FROM public.clients cl
      LEFT JOIN public.care_plans ap ON ap.client_id = cl.id AND ap.status = 'active'
      WHERE cl.id IN (SELECT DISTINCT r.client_id FROM public.plan_training_records r WHERE r.caregiver_id = g.id)
        AND cl.agency_id = g.agency_id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_caregiver_compliance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_caregiver_compliance(uuid) TO authenticated;

-- Ripple UI S6 follow-ups (owner decisions, Oct 5):
--   (4) clients.case_number: the ISK case number, nullable text, trimmed, 1..32 characters. Staff edit it
--       (existing client edit dialog, care-plan header) through the existing staff UPDATE policy. The
--       client self-update guard (guard_clients_update, M-SEC-2) is an allow-list of contact fields that
--       does NOT include case_number, so a client can never change it (unchanged function).
--       Shown on the IPOS header and both training prints; managers read it with the client row (S8/S9
--       note billing footer).
--   (3) list_client_training_status returns the client's full name ('client_name', first + last); hr_staff
--       matches the paper forms. 'client_short' is kept.
-- Changed existing functions (owner-approved, same signatures, so grants are kept; no overload):
--   get_client_training_context  + 'case_number' (the training prints show it)
--   list_client_training_status  + 'client_name'
-- Nothing else changes; no scheduling function is touched.

ALTER TABLE public.clients ADD COLUMN case_number text;
ALTER TABLE public.clients ADD CONSTRAINT clients_case_number_chk
  CHECK (case_number IS NULL OR (case_number = btrim(case_number) AND length(case_number) BETWEEN 1 AND 32));

CREATE OR REPLACE FUNCTION public.get_client_training_context(_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.list_client_training_status(_office_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; v_today date;
BEGIN
  SELECT id, agency_id, COALESCE(timezone, 'America/New_York') tz INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin,hr_staff}'::public.app_role[]);
  v_today := (now() AT TIME ZONE o.tz)::date;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'client_id', cl.id,
      'client_name', btrim(COALESCE(cl.first_name, '') || ' ' || COALESCE(cl.last_name, '')),
      'client_short', btrim(COALESCE(cl.first_name, '') || ' ' || left(COALESCE(cl.last_name, ''), 1) || CASE WHEN COALESCE(cl.last_name, '') <> '' THEN '.' ELSE '' END),
      'plan_version', p.version, 'training_version', p.training_version,
      'inservice_current', EXISTS (SELECT 1 FROM public.plan_inservice_forms f WHERE f.care_plan_id = p.id AND f.training_version = p.training_version AND f.signed_at IS NOT NULL),
      'caregivers_trained', (SELECT count(DISTINCT r.caregiver_id)::int FROM public.plan_training_records r WHERE r.care_plan_id = p.id AND r.training_version = p.training_version),
      'needing_retraining', (SELECT count(DISTINCT s.caregiver_id)::int FROM public.shifts s
         WHERE s.client_id = cl.id AND s.caregiver_id IS NOT NULL AND s.status IS DISTINCT FROM 'cancelled' AND s.shift_date >= v_today
           AND NOT EXISTS (SELECT 1 FROM public.plan_training_records r WHERE r.caregiver_id = s.caregiver_id AND r.care_plan_id = p.id AND r.training_version = p.training_version)),
      'last_training_date', (SELECT max(r.training_date) FROM public.plan_training_records r WHERE r.client_id = cl.id))
      ORDER BY cl.first_name, cl.last_name)
    FROM public.clients cl JOIN public.care_plans p ON p.client_id = cl.id AND p.status = 'active'
    WHERE cl.virtual_office_id = o.id AND cl.agency_id = o.agency_id AND cl.is_active IS NOT FALSE), '[]'::jsonb);
END $$;

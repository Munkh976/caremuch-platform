-- Ripple UI S2 — Form Templates + measure library: read G3 and writes W1 (UI plan §4).
-- ADDITIVE ONLY: new functions; no existing function, policy, trigger, constraint or table changes.
-- Security baseline (as Phases A–D): SECURITY DEFINER with a fixed search_path; REVOKE ALL FROM
-- PUBLIC, anon before GRANT EXECUTE TO authenticated (rule 14); scope via cp_require_scope /
-- cp_staff_in_agency; generic 'Not found or not allowed' (42501); ids, counts, dates and staff names
-- only (no client data).
--
--   list_templates_with_usage(_office_id)  G3: the shells an office uses (its own + agency-wide), with
--       versions, draft, last published (who/when), whether the caller may edit, and per-version usage
--       counted over THIS office's records. manager, agency_admin.
--   upsert_measure_type(_id, _kind, _label, _default_options)  W1: create (_id NULL) or edit an agency
--       measure type. The 8 system types (agency_id NULL) are read-only. The kind is fixed once the type
--       is used by an objective.
--   set_measure_type_active(_id, _active)  W1: deactivate / reactivate (used types can be deactivated).
--   delete_measure_type(_id)               W1: only while no objective uses it.
--   Measure-library writes: manager, agency_admin of the agency (the library is agency-wide).
-- Not audited: adding event types means changing the existing events CHECK constraint, which needs
-- owner approval (UI round 2 report). measure_types.created_by records the creator.

-- =============================================================================================
-- G3 list_templates_with_usage
-- =============================================================================================
CREATE FUNCTION public.list_templates_with_usage(_office_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o record;
BEGIN
  SELECT id, agency_id INTO o FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin}'::public.app_role[]);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'template_id', t.id, 'name', t.name, 'kind', t.kind, 'intake_doc_type', t.intake_doc_type,
      'service_type', t.service_type, 'is_required_for_client', t.is_required_for_client,
      'office_id', t.virtual_office_id, 'scope', CASE WHEN t.virtual_office_id IS NULL THEN 'agency' ELSE 'office' END,
      'can_edit', CASE WHEN t.virtual_office_id IS NULL
                       THEN cp_staff_in_agency(t.agency_id, '{agency_admin,system_admin}'::public.app_role[])
                       ELSE cp_staff_in_scope(t.agency_id, t.virtual_office_id, '{agency_admin,system_admin,manager}'::public.app_role[]) END,
      'current_version', (SELECT v.version FROM public.form_template_versions v WHERE v.template_id = t.id AND v.is_current),
      'draft_version', (SELECT v.version FROM public.form_template_versions v WHERE v.template_id = t.id AND v.status = 'draft'),
      'versions', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'version_id', v.id, 'version', v.version, 'status', v.status, 'is_current', v.is_current,
          'published_at', v.published_at, 'published_by', pr.full_name,
          'usage', (SELECT count(*) FROM public.care_plans x WHERE x.template_id = t.id AND x.template_version = v.version AND x.virtual_office_id = o.id)
                 + (SELECT count(*) FROM public.service_authorizations x WHERE x.template_id = t.id AND x.template_version = v.version AND x.virtual_office_id = o.id)
                 + (SELECT count(*) FROM public.progress_notes x WHERE x.template_id = t.id AND x.template_version = v.version AND x.virtual_office_id = o.id)
                 + (SELECT count(*) FROM public.client_documents x WHERE x.template_id = t.id AND x.template_version = v.version AND x.virtual_office_id = o.id)
                 + (SELECT count(*) FROM public.plan_inservice_forms x WHERE x.template_id = t.id AND x.template_version = v.version AND x.virtual_office_id = o.id)
                 + (SELECT count(*) FROM public.plan_training_forms x WHERE x.template_id = t.id AND x.template_version = v.version AND x.virtual_office_id = o.id)
          ) ORDER BY v.version DESC), '[]'::jsonb)
        FROM public.form_template_versions v LEFT JOIN public.profiles pr ON pr.id = v.published_by
        WHERE v.template_id = t.id)
    ) ORDER BY t.kind, t.service_type NULLS LAST, t.intake_doc_type NULLS FIRST, t.name, t.id)
    FROM public.form_templates t
    WHERE t.agency_id = o.agency_id AND t.is_active AND (t.virtual_office_id = o.id OR t.virtual_office_id IS NULL)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_templates_with_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_templates_with_usage(uuid) TO authenticated;

-- =============================================================================================
-- W1 measure library
-- =============================================================================================
-- A measure type row of the caller's agency (never a system row), locked; else generic denial.
CREATE FUNCTION public.cp_require_agency_measure_type(_id uuid)
RETURNS public.measure_types LANGUAGE plpgsql SET search_path = public AS $$
DECLARE m public.measure_types;
BEGIN
  SELECT * INTO m FROM public.measure_types WHERE id = _id FOR UPDATE;
  IF m.id IS NULL OR m.agency_id IS NULL
     OR NOT cp_staff_in_agency(m.agency_id, '{manager,agency_admin}'::public.app_role[]) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN m;
END $$;
REVOKE ALL ON FUNCTION public.cp_require_agency_measure_type(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.upsert_measure_type(_id uuid, _kind public.measure_kind, _label text, _default_options jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agency uuid := current_agency_id(); m public.measure_types; v_label text := btrim(_label); v_id uuid;
BEGIN
  IF v_label IS NULL OR length(v_label) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'A label of 1-120 characters is required' USING ERRCODE = '22023';
  END IF;
  IF _default_options IS NOT NULL AND _default_options <> 'null'::jsonb AND (jsonb_typeof(_default_options) <> 'array'
     OR jsonb_array_length(_default_options) > 20
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(_default_options) e
                WHERE jsonb_typeof(e) <> 'string' OR length(e #>> '{}') NOT BETWEEN 1 AND 60)) THEN
    RAISE EXCEPTION 'Options must be a list of up to 20 short texts' USING ERRCODE = '22023';
  END IF;
  IF _id IS NULL THEN
    IF v_agency IS NULL OR NOT cp_staff_in_agency(v_agency, '{manager,agency_admin}'::public.app_role[]) THEN
      RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
    END IF;
    IF _kind IS NULL THEN RAISE EXCEPTION 'A kind is required' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.measure_types WHERE (agency_id = v_agency OR agency_id IS NULL) AND lower(label) = lower(v_label)) THEN
      RAISE EXCEPTION 'A measure type with this label already exists' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.measure_types (agency_id, kind, label, default_options)
    VALUES (v_agency, _kind, v_label, NULLIF(_default_options, 'null'::jsonb))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  m := cp_require_agency_measure_type(_id);
  IF _kind IS NOT NULL AND _kind <> m.kind
     AND EXISTS (SELECT 1 FROM public.objective_measures om WHERE om.measure_type_id = m.id) THEN
    RAISE EXCEPTION 'This measure type is in use, so its kind can''t change' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.measure_types WHERE id <> m.id AND (agency_id = m.agency_id OR agency_id IS NULL) AND lower(label) = lower(v_label)) THEN
    RAISE EXCEPTION 'A measure type with this label already exists' USING ERRCODE = '23505';
  END IF;
  UPDATE public.measure_types SET kind = COALESCE(_kind, kind), label = v_label, default_options = NULLIF(_default_options, 'null'::jsonb)
   WHERE id = m.id;
  RETURN m.id;
END $$;
REVOKE ALL ON FUNCTION public.upsert_measure_type(uuid, public.measure_kind, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_measure_type(uuid, public.measure_kind, text, jsonb) TO authenticated;

CREATE FUNCTION public.set_measure_type_active(_id uuid, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.measure_types;
BEGIN
  IF _active IS NULL THEN RAISE EXCEPTION 'Say whether the type is active' USING ERRCODE = '22023'; END IF;
  m := cp_require_agency_measure_type(_id);
  UPDATE public.measure_types SET is_active = _active WHERE id = m.id;
END $$;
REVOKE ALL ON FUNCTION public.set_measure_type_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_measure_type_active(uuid, boolean) TO authenticated;

CREATE FUNCTION public.delete_measure_type(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.measure_types;
BEGIN
  m := cp_require_agency_measure_type(_id);
  IF EXISTS (SELECT 1 FROM public.objective_measures om WHERE om.measure_type_id = m.id) THEN
    RAISE EXCEPTION 'This measure type is in use; deactivate it instead' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.measure_types WHERE id = m.id;
END $$;
REVOKE ALL ON FUNCTION public.delete_measure_type(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_measure_type(uuid) TO authenticated;

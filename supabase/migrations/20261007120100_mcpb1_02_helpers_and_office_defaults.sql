-- Phase B1-02 — shared internal helpers + seed_office_care_plan_defaults.
-- Ripple care-plan module. Schema plan §2.1, §8 (reference data), §10. DRAFT FOR REVIEW. Not pushed.
--
-- Internal helpers (cp_require_scope, cp_audit, cp_validate_field_values, cp_template_snapshot,
-- cp_resolve_template) are called only by the SECURITY DEFINER RPCs (owner postgres). They get
-- REVOKE ALL FROM PUBLIC, anon, authenticated and NO grant: no user can call them directly.
--
-- Rules every B1 RPC follows (schema plan §2.1):
--   * SECURITY DEFINER, SET search_path = public, REVOKE ALL FROM PUBLIC, anon, then GRANT EXECUTE
--     TO authenticated (CLAUDE.md #13/#14; no existing signature changes).
--   * Agency and office come from the parent row (client, office, plan, caregiver), never from a
--     parameter. Role tier + live M-Office office check via cp_require_scope().
--   * Missing parent, other agency, other office and wrong role all raise the SAME error
--     ('Not found or not allowed', 42501), so a caller can't probe which rows exist.
--   * Audited writes call cp_audit(), a direct INSERT into events (no exception handler): if it
--     fails, the whole RPC rolls back (fail closed). Payloads carry ids, versions and counts only.

-- =============================================================================================
-- 1. Internal helpers
-- =============================================================================================
CREATE FUNCTION public.cp_require_scope(_agency_id uuid, _office_id uuid, _roles public.app_role[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF _agency_id IS NULL OR NOT cp_staff_in_scope(_agency_id, _office_id, _roles) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cp_require_scope(uuid, uuid, public.app_role[]) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cp_audit(_agency_id uuid, _office_id uuid, _event_type text,
                                _subject_type text, _subject_id uuid, _payload jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Direct insert, no exception handler: an audit failure aborts the calling RPC (fail closed).
  INSERT INTO public.events (agency_id, virtual_office_id, event_type, actor_type, actor_id,
                             subject_type, subject_id, payload, occurred_at, is_demo)
  VALUES (_agency_id, _office_id, _event_type, 'staff', auth.uid(),
          _subject_type, _subject_id, COALESCE(_payload, '{}'::jsonb), now(), false);
END $$;
REVOKE ALL ON FUNCTION public.cp_audit(uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Snapshot of one shell version: frozen into every instance at fill time (arch §4 rule 3).
CREATE FUNCTION public.cp_template_snapshot(_version_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'template_id', v.template_id, 'version', v.version, 'kind', t.kind,
    'sections', v.sections, 'note_layout', v.note_layout,
    'fields', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'field_key', f.field_key, 'section', f.section, 'label', f.label, 'field_type', f.field_type,
        'storage', f.storage, 'writes_to_entity', f.writes_to_entity, 'writes_to_column', f.writes_to_column,
        'shown_on_progress_note', f.shown_on_progress_note, 'default_value', f.default_value,
        'required', f.required, 'sort_order', f.sort_order, 'options', f.options) ORDER BY f.sort_order, f.field_key)
      FROM public.form_template_fields f WHERE f.template_version_id = v.id), '[]'::jsonb))
  FROM public.form_template_versions v JOIN public.form_templates t ON t.id = v.template_id
  WHERE v.id = _version_id AND v.status = 'published'
$$;
REVOKE ALL ON FUNCTION public.cp_template_snapshot(uuid) FROM PUBLIC, anon, authenticated;

-- Q15: the office's own active shell of that kind wins over the agency-wide shell. Returns the
-- current published version id, or NULL when no shell exists.
CREATE FUNCTION public.cp_resolve_template(_agency_id uuid, _office_id uuid,
                                           _kind public.form_template_kind, _intake_doc_type text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.id
  FROM public.form_templates t
  JOIN public.form_template_versions v ON v.template_id = t.id AND v.is_current
  WHERE t.agency_id = _agency_id AND t.kind = _kind AND t.is_active
    AND (t.virtual_office_id = _office_id OR t.virtual_office_id IS NULL)
    AND (_intake_doc_type IS NULL OR t.intake_doc_type = _intake_doc_type)
  ORDER BY (t.virtual_office_id IS NOT NULL) DESC, t.created_at DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.cp_resolve_template(uuid, uuid, public.form_template_kind, text) FROM PUBLIC, anon, authenticated;

-- field_values must match the instance's snapshot: only its field_value keys (plus the reserved
-- "_retired" bucket written by upgrade_instance_template), right JSON type per field_type, select
-- values from the options, max lengths, required fields present. No snapshot -> values must be {}.
CREATE FUNCTION public.cp_validate_field_values(_snapshot jsonb, _values jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  f jsonb; k text; v jsonb; t text; n int;
BEGIN
  IF _values IS NULL OR jsonb_typeof(_values) <> 'object' THEN
    RAISE EXCEPTION 'field_values must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF _snapshot IS NULL THEN
    IF _values - '_retired' <> '{}'::jsonb THEN
      RAISE EXCEPTION 'This record has no template, so field_values must be empty' USING ERRCODE = '22023';
    END IF;
    RETURN;
  END IF;
  IF length(_values::text) > 200000 THEN
    RAISE EXCEPTION 'field_values is too large' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_values) LOOP
    IF k = '_retired' THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_snapshot -> 'fields') x
                   WHERE x ->> 'field_key' = k AND x ->> 'storage' = 'field_value') THEN
      RAISE EXCEPTION 'Unknown field "%" for this template version', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR f IN SELECT x FROM jsonb_array_elements(_snapshot -> 'fields') x WHERE x ->> 'storage' = 'field_value' LOOP
    k := f ->> 'field_key'; v := _values -> k; t := f ->> 'field_type';
    IF v IS NULL OR jsonb_typeof(v) = 'null' OR (jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') = '') THEN
      IF COALESCE((f ->> 'required')::boolean, false) THEN
        RAISE EXCEPTION 'Field "%" is required', k USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;
    IF t IN ('text', 'longtext') THEN
      IF jsonb_typeof(v) <> 'string' THEN RAISE EXCEPTION 'Field "%" must be text', k USING ERRCODE = '22023'; END IF;
      IF length(v #>> '{}') > (CASE t WHEN 'text' THEN 2000 ELSE 20000 END) THEN
        RAISE EXCEPTION 'Field "%" is too long', k USING ERRCODE = '22023';
      END IF;
    ELSIF t IN ('number', 'units', 'money') THEN
      IF jsonb_typeof(v) <> 'number' THEN RAISE EXCEPTION 'Field "%" must be a number', k USING ERRCODE = '22023'; END IF;
    ELSIF t = 'checkbox' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'Field "%" must be true or false', k USING ERRCODE = '22023'; END IF;
    ELSIF t = 'date' THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'Field "%" must be a date (YYYY-MM-DD)', k USING ERRCODE = '22023';
      END IF;
      BEGIN PERFORM (v #>> '{}')::date;
      EXCEPTION WHEN others THEN RAISE EXCEPTION 'Field "%" must be a valid date', k USING ERRCODE = '22023'; END;
    ELSIF t = 'select' THEN
      IF jsonb_typeof(v) <> 'string' OR NOT COALESCE(f -> 'options', '[]'::jsonb) ? (v #>> '{}') THEN
        RAISE EXCEPTION 'Field "%" must be one of its options', k USING ERRCODE = '22023';
      END IF;
    ELSIF t = 'table' THEN
      IF jsonb_typeof(v) <> 'array' THEN RAISE EXCEPTION 'Field "%" must be a list of rows', k USING ERRCODE = '22023'; END IF;
      n := jsonb_array_length(v);
      IF n > 200 OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE jsonb_typeof(r) <> 'object') THEN
        RAISE EXCEPTION 'Field "%" must be at most 200 row objects', k USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Field "%" has an unsupported type', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.cp_validate_field_values(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 2. System default catalogs (copied into an office/agency when the module is enabled)
-- =============================================================================================
-- System-wide rows, no agency. Not readable or writable by any API role (RLS on, no policy, no
-- grants): only seed_office_care_plan_defaults reads them. Their CONTENT is deployment reference
-- data and is loaded outside migrations (scripts/seed/care_plan_defaults_dev_seed.sql on DEV).
CREATE TABLE public.cp_default_credential_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category public.credential_category NOT NULL,
  valid_months integer CHECK (valid_months IS NULL OR valid_months > 0),
  required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.cp_default_service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_type_code text NOT NULL UNIQUE REFERENCES public.care_types(code) ON UPDATE CASCADE,
  service_type text NOT NULL CHECK (service_type ~ '^[a-z][a-z0-9_]*$'),
  is_active boolean NOT NULL DEFAULT true
);
ALTER TABLE public.cp_default_credential_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cp_default_service_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cp_default_credential_types, public.cp_default_service_types FROM anon, authenticated;

-- =============================================================================================
-- 3. seed_office_care_plan_defaults — agency_admin only
-- =============================================================================================
-- Copies the active defaults that are missing: credential types into the office's agency
-- (agency-wide catalog) and service-type mappings into the office. Turns on
-- care_plan_module_enabled in the same transaction (the virtual_office guard trigger re-checks the
-- caller is agency_admin). Idempotent: a second run adds nothing, changes nothing, writes no event.
-- Audited: care_plan_module_enabled {office_id, credential_types_added, service_types_added,
-- module_was_enabled}.
CREATE FUNCTION public.seed_office_care_plan_defaults(_office_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o record; v_ct int := 0; v_st int := 0;
BEGIN
  SELECT id, agency_id, care_plan_module_enabled INTO o FROM public.virtual_office WHERE id = _office_id FOR UPDATE;
  PERFORM cp_require_scope(o.agency_id, o.id, '{agency_admin}'::public.app_role[]);

  INSERT INTO public.credential_types (agency_id, name, category, valid_months, required)
  SELECT o.agency_id, d.name, d.category, d.valid_months, d.required
  FROM public.cp_default_credential_types d WHERE d.is_active
  ON CONFLICT (agency_id, name) DO NOTHING;
  GET DIAGNOSTICS v_ct = ROW_COUNT;

  INSERT INTO public.office_service_types (agency_id, virtual_office_id, care_type_code, service_type)
  SELECT o.agency_id, o.id, d.care_type_code, d.service_type
  FROM public.cp_default_service_types d WHERE d.is_active
  ON CONFLICT (virtual_office_id, care_type_code) DO NOTHING;
  GET DIAGNOSTICS v_st = ROW_COUNT;

  IF NOT o.care_plan_module_enabled THEN
    UPDATE public.virtual_office SET care_plan_module_enabled = true WHERE id = o.id;
  END IF;

  IF v_ct > 0 OR v_st > 0 OR NOT o.care_plan_module_enabled THEN
    PERFORM cp_audit(o.agency_id, o.id, 'care_plan_module_enabled', 'virtual_office', o.id,
      jsonb_build_object('credential_types_added', v_ct, 'service_types_added', v_st,
                         'module_was_enabled', o.care_plan_module_enabled));
  END IF;
  RETURN jsonb_build_object('credential_types_added', v_ct, 'service_types_added', v_st, 'module_enabled', true);
END $$;
REVOKE ALL ON FUNCTION public.seed_office_care_plan_defaults(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_office_care_plan_defaults(uuid) TO authenticated;

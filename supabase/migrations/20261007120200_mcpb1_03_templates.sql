-- Phase B1-03 — Layer A shells: save_template_draft, publish_template_version,
-- upgrade_instance_template; published versions immutable.
-- Ripple care-plan module. Schema plan §3, §3.1; owner decisions Q13, Q14, Q15. DRAFT FOR REVIEW.
--
-- Who may draft/publish (Q13):
--   * office shell      : agency_admin, system_admin, or a manager whose scope includes that office
--   * agency-wide shell : agency_admin, system_admin only
-- Constrained edits (Q13), checked against the current published version when one exists:
--   * spine_column and child_rows fields are FIXED (same keys, storage, type, target);
--     labels, help/static text, options, required, order, shown_on_progress_note may change;
--   * field_value fields may be added or removed; an existing key keeps its field_type;
--   * progress-note note_layout: only billing_footer and notes_prompt may change.
--   First version of a shell: any fields, but spine/child-row targets come from a fixed whitelist
--   per kind (no new child_rows structures, no new kinds).
-- Spine guard (publish): an IPOS shell must keep care_plan.effective_date/expiration_date; an
--   authorization shell must keep service_authorization.units_authorized/effective_date/
--   expiration_date (schema plan §3).
-- One draft per shell (Phase A partial index); save_template_draft replaces it in place.
-- Published versions are immutable: a guard trigger refuses any change except flipping
-- is_current, and refuses field changes under a published version.
-- Audited: template_draft_saved, template_published, instance_template_upgraded.

-- =============================================================================================
-- 1. Definition rules (internal)
-- =============================================================================================
CREATE FUNCTION public.cp_spine_columns(_entity text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _entity
    WHEN 'care_plan' THEN ARRAY['meeting_date','effective_date','expiration_date','next_review_date','review_frequency',
                                'michicans_date','facilitator_name','recorder_name','discharge_criteria','signed_by','signed_date']
    WHEN 'service_authorization' THEN ARRAY['auth_number','service_code','modifier','service_type','service_description',
                                'units_authorized','units_per_period','period_type','unit_minutes','rate','amount',
                                'effective_date','expiration_date','authorizing_agent_notes']
    WHEN 'progress_note' THEN ARRAY['service_date','scheduled_start','scheduled_end','client_arrived_at','actual_end',
                                'staff_client_ratio','location','units_scheduled','staff_signature_name','biller_name']
    WHEN 'client_document' THEN ARRAY['status','effective_date','expiration_date']
    WHEN 'plan_inservice_form' THEN ARRAY['case_manager_name','trained_on','signed_at']
    WHEN 'plan_training_form' THEN ARRAY['plan_document_type','plan_effective_date','location']
    ELSE ARRAY[]::text[] END
$$;
REVOKE ALL ON FUNCTION public.cp_spine_columns(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cp_validate_template_definition(_kind public.form_template_kind, _fields jsonb, _note_layout jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  f jsonb; k text; st text; ent text; col text; ft text; seen text[] := ARRAY[]::text[];
  allowed_props constant text[] := ARRAY['field_key','section','label','field_type','storage','writes_to_entity',
    'writes_to_column','shown_on_progress_note','default_value','required','sort_order','options'];
  spine_entity text := CASE _kind WHEN 'ipos' THEN 'care_plan' WHEN 'authorization' THEN 'service_authorization'
    WHEN 'progress_note' THEN 'progress_note' WHEN 'intake' THEN 'client_document'
    WHEN 'inservice' THEN 'plan_inservice_form' WHEN 'training' THEN 'plan_training_form' ELSE NULL END;
  child_entities text[] := CASE _kind
    WHEN 'ipos' THEN ARRAY['care_plan_goal','care_plan_objective','care_plan_attendee','care_plan_need',
      'care_plan_treatment_need','care_plan_dsm_recommendation','care_plan_natural_support',
      'care_plan_external_service','care_plan_review']
    WHEN 'progress_note' THEN ARRAY['progress_note_entry']
    WHEN 'training' THEN ARRAY['plan_training_record']
    ELSE ARRAY[]::text[] END;
BEGIN
  IF _fields IS NULL OR jsonb_typeof(_fields) <> 'array' THEN
    RAISE EXCEPTION 'fields must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_fields) > 300 THEN RAISE EXCEPTION 'A shell can have at most 300 fields' USING ERRCODE = '22023'; END IF;
  FOR f IN SELECT x FROM jsonb_array_elements(_fields) x LOOP
    IF jsonb_typeof(f) <> 'object' THEN RAISE EXCEPTION 'Each field must be an object' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(f) p WHERE p <> ALL (allowed_props)) THEN
      RAISE EXCEPTION 'Unknown field property' USING ERRCODE = '22023';
    END IF;
    k := f ->> 'field_key';
    IF k IS NULL OR k !~ '^[a-z][a-z0-9_]{0,62}$' THEN RAISE EXCEPTION 'Invalid field_key' USING ERRCODE = '22023'; END IF;
    IF k = ANY (seen) THEN RAISE EXCEPTION 'Duplicate field_key "%"', k USING ERRCODE = '22023'; END IF;
    seen := seen || k;
    IF COALESCE(btrim(f ->> 'label'), '') = '' OR length(f ->> 'label') > 200 THEN
      RAISE EXCEPTION 'Field "%" needs a label of at most 200 characters', k USING ERRCODE = '22023';
    END IF;
    ft := f ->> 'field_type';
    IF ft IS NULL OR ft <> ALL (ARRAY['text','longtext','number','date','select','checkbox','units','money','table']) THEN
      RAISE EXCEPTION 'Field "%" has an unsupported field_type', k USING ERRCODE = '22023';
    END IF;
    st := f ->> 'storage'; ent := f ->> 'writes_to_entity'; col := f ->> 'writes_to_column';
    IF st = 'spine_column' THEN
      IF spine_entity IS NULL OR ent IS DISTINCT FROM spine_entity OR col IS NULL OR col <> ALL (cp_spine_columns(ent)) THEN
        RAISE EXCEPTION 'Field "%": not an allowed spine column for this kind of shell', k USING ERRCODE = '22023';
      END IF;
    ELSIF st = 'child_rows' THEN
      IF ent IS NULL OR ent <> ALL (child_entities) OR col IS NOT NULL THEN
        RAISE EXCEPTION 'Field "%": not an allowed child-row structure for this kind of shell', k USING ERRCODE = '22023';
      END IF;
    ELSIF st IN ('field_value', 'static_text') THEN
      IF ent IS NOT NULL OR col IS NOT NULL THEN
        RAISE EXCEPTION 'Field "%": % fields have no write target', k, st USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Field "%" has an invalid storage', k USING ERRCODE = '22023';
    END IF;
    IF f ? 'options' AND jsonb_typeof(f -> 'options') <> 'null' AND (jsonb_typeof(f -> 'options') <> 'array'
       OR jsonb_array_length(f -> 'options') > 200
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(f -> 'options') o WHERE jsonb_typeof(o) <> 'string' OR length(o #>> '{}') > 200)) THEN
      RAISE EXCEPTION 'Field "%": options must be a list of at most 200 short strings', k USING ERRCODE = '22023';
    END IF;
    IF ft = 'select' AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(f -> 'options') = 'array' THEN f -> 'options' END), 0) = 0 THEN
      RAISE EXCEPTION 'Select field "%" needs options', k USING ERRCODE = '22023';
    END IF;
    IF (f ? 'required' AND jsonb_typeof(f -> 'required') NOT IN ('boolean', 'null'))
       OR (f ? 'shown_on_progress_note' AND jsonb_typeof(f -> 'shown_on_progress_note') NOT IN ('boolean', 'null'))
       OR (f ? 'sort_order' AND jsonb_typeof(f -> 'sort_order') NOT IN ('number', 'null'))
       OR (f ? 'default_value' AND jsonb_typeof(f -> 'default_value') NOT IN ('string', 'null'))
       OR length(COALESCE(f ->> 'default_value', '')) > 2000
       OR (f ? 'section' AND jsonb_typeof(f -> 'section') NOT IN ('string', 'null'))
       OR length(COALESCE(f ->> 'section', '')) > 200 THEN
      RAISE EXCEPTION 'Field "%" has an invalid property value', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF _note_layout IS NOT NULL AND jsonb_typeof(_note_layout) <> 'null' THEN
    IF _kind <> 'progress_note' THEN
      RAISE EXCEPTION 'note_layout is only for progress-note shells' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(_note_layout) <> 'object' OR length(_note_layout::text) > 20000 THEN
      RAISE EXCEPTION 'note_layout must be a JSON object' USING ERRCODE = '22023';
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cp_validate_template_definition(public.form_template_kind, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Q13 constrained edit against the current published version.
CREATE FUNCTION public.cp_check_constrained_edit(_current_version_id uuid, _fields jsonb, _note_layout jsonb)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  cur_struct text; new_struct text; cur_layout jsonb;
BEGIN
  SELECT string_agg(field_key || '|' || storage || '|' || field_type || '|' || COALESCE(writes_to_entity, '') || '|' || COALESCE(writes_to_column, ''), ',' ORDER BY field_key)
    INTO cur_struct FROM public.form_template_fields
   WHERE template_version_id = _current_version_id AND storage IN ('spine_column', 'child_rows');
  SELECT string_agg((x ->> 'field_key') || '|' || (x ->> 'storage') || '|' || (x ->> 'field_type') || '|' || COALESCE(x ->> 'writes_to_entity', '') || '|' || COALESCE(x ->> 'writes_to_column', ''), ',' ORDER BY x ->> 'field_key')
    INTO new_struct FROM jsonb_array_elements(_fields) x WHERE x ->> 'storage' IN ('spine_column', 'child_rows');
  IF cur_struct IS DISTINCT FROM new_struct THEN
    RAISE EXCEPTION 'Spine and child-row fields are fixed: only labels, help text, options, required, order and narrative fields can change'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.form_template_fields c JOIN jsonb_array_elements(_fields) x ON x ->> 'field_key' = c.field_key
             WHERE c.template_version_id = _current_version_id
               AND (c.storage <> (x ->> 'storage')::public.form_field_storage OR c.field_type <> x ->> 'field_type')) THEN
    RAISE EXCEPTION 'An existing field keeps its storage and type; add a new field_key instead' USING ERRCODE = '22023';
  END IF;
  SELECT note_layout INTO cur_layout FROM public.form_template_versions WHERE id = _current_version_id;
  IF (COALESCE(cur_layout, '{}'::jsonb) - 'billing_footer' - 'notes_prompt')
     IS DISTINCT FROM (COALESCE(NULLIF(_note_layout, 'null'::jsonb), '{}'::jsonb) - 'billing_footer' - 'notes_prompt') THEN
    RAISE EXCEPTION 'Only the billing footer and the notes prompt of a progress-note layout can change' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cp_check_constrained_edit(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Q13 publisher roles for one shell.
CREATE FUNCTION public.cp_require_template_editor(_agency_id uuid, _office_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF _office_id IS NULL THEN
    IF _agency_id IS NULL OR NOT cp_staff_in_agency(_agency_id, '{agency_admin,system_admin}'::public.app_role[]) THEN
      RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
    END IF;
  ELSE
    PERFORM cp_require_scope(_agency_id, _office_id, '{agency_admin,system_admin,manager}'::public.app_role[]);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cp_require_template_editor(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- 2. Published versions are immutable
-- =============================================================================================
CREATE FUNCTION public.cp_guard_template_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'A published template version cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'published'
     AND (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current') THEN
    RAISE EXCEPTION 'A published template version cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_guard_template_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_cp_guard_template_version BEFORE UPDATE OR DELETE ON public.form_template_versions
FOR EACH ROW EXECUTE FUNCTION public.cp_guard_template_version();

CREATE FUNCTION public.cp_guard_template_field()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _vid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.template_version_id ELSE NEW.template_version_id END;
BEGIN
  -- a cascade from a deleted version finds no parent row: allowed
  IF EXISTS (SELECT 1 FROM public.form_template_versions v WHERE v.id = _vid AND v.status = 'published')
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.form_template_versions v
                                      WHERE v.id = OLD.template_version_id AND v.status = 'published')) THEN
    RAISE EXCEPTION 'Fields of a published template version cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.cp_guard_template_field() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_cp_guard_template_field BEFORE INSERT OR UPDATE OR DELETE ON public.form_template_fields
FOR EACH ROW EXECUTE FUNCTION public.cp_guard_template_field();

-- =============================================================================================
-- 3. save_template_draft
-- =============================================================================================
-- New shell: _template_id NULL; _office_id NULL = agency-wide (agency = the caller's own agency),
-- else the office row gives the agency. Existing shell: pass _template_id; _office_id/_kind/
-- _intake_doc_type must be NULL (they're fixed on the shell). Replaces the shell's single draft.
CREATE FUNCTION public.save_template_draft(
  _template_id uuid, _office_id uuid, _kind public.form_template_kind, _name text,
  _intake_doc_type text, _is_required_for_client boolean,
  _sections jsonb, _note_layout jsonb, _fields jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t record; v_agency uuid; v_draft uuid; v_cur uuid; v_next int; v_count int;
BEGIN
  IF _template_id IS NULL THEN
    IF _kind IS NULL OR COALESCE(btrim(_name), '') = '' OR length(_name) > 200 THEN
      RAISE EXCEPTION 'A new shell needs a kind and a name of at most 200 characters' USING ERRCODE = '22023';
    END IF;
    IF (_kind = 'intake') <> (_intake_doc_type IS NOT NULL) OR (_intake_doc_type IS NOT NULL AND _intake_doc_type !~ '^[a-z][a-z0-9_]{0,62}$') THEN
      RAISE EXCEPTION 'intake_doc_type is required for intake shells only' USING ERRCODE = '22023';
    END IF;
    IF _office_id IS NULL THEN
      v_agency := current_agency_id();
    ELSE
      SELECT agency_id INTO v_agency FROM public.virtual_office WHERE id = _office_id;
    END IF;
    PERFORM cp_require_template_editor(v_agency, _office_id);
    PERFORM cp_validate_template_definition(_kind, _fields, _note_layout);
    INSERT INTO public.form_templates (agency_id, virtual_office_id, name, kind, intake_doc_type, is_required_for_client)
    VALUES (v_agency, _office_id, btrim(_name), _kind, _intake_doc_type, COALESCE(_is_required_for_client, false))
    RETURNING * INTO t;
  ELSE
    IF _office_id IS NOT NULL OR _kind IS NOT NULL OR _intake_doc_type IS NOT NULL THEN
      RAISE EXCEPTION 'Office, kind and intake type are fixed on an existing shell' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO t FROM public.form_templates WHERE id = _template_id FOR UPDATE;
    PERFORM cp_require_template_editor(t.agency_id, t.virtual_office_id);
    PERFORM cp_validate_template_definition(t.kind, _fields, _note_layout);
    IF _name IS NOT NULL OR _is_required_for_client IS NOT NULL THEN
      IF COALESCE(btrim(_name), t.name) = '' OR length(COALESCE(_name, '')) > 200 THEN
        RAISE EXCEPTION 'Invalid name' USING ERRCODE = '22023';
      END IF;
      UPDATE public.form_templates SET name = COALESCE(btrim(_name), name),
             is_required_for_client = COALESCE(_is_required_for_client, is_required_for_client)
       WHERE id = t.id;
    END IF;
  END IF;

  SELECT id INTO v_cur FROM public.form_template_versions WHERE template_id = t.id AND is_current;
  IF v_cur IS NOT NULL THEN
    PERFORM cp_check_constrained_edit(v_cur, _fields, _note_layout);
  END IF;
  IF _sections IS NOT NULL AND (jsonb_typeof(_sections) <> 'array' OR length(_sections::text) > 50000) THEN
    RAISE EXCEPTION 'sections must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_draft FROM public.form_template_versions WHERE template_id = t.id AND status = 'draft';
  IF v_draft IS NULL THEN
    SELECT COALESCE(max(version), 0) + 1 INTO v_next FROM public.form_template_versions WHERE template_id = t.id;
    INSERT INTO public.form_template_versions (template_id, version, status, sections, note_layout)
    VALUES (t.id, v_next, 'draft', COALESCE(_sections, '[]'::jsonb), NULLIF(_note_layout, 'null'::jsonb))
    RETURNING id INTO v_draft;
  ELSE
    UPDATE public.form_template_versions SET sections = COALESCE(_sections, '[]'::jsonb),
           note_layout = NULLIF(_note_layout, 'null'::jsonb)
     WHERE id = v_draft RETURNING version INTO v_next;
    DELETE FROM public.form_template_fields WHERE template_version_id = v_draft;
  END IF;

  INSERT INTO public.form_template_fields (template_version_id, field_key, section, label, field_type, storage,
    writes_to_entity, writes_to_column, shown_on_progress_note, default_value, required, sort_order, options)
  SELECT v_draft, x ->> 'field_key', x ->> 'section', btrim(x ->> 'label'), x ->> 'field_type',
         (x ->> 'storage')::public.form_field_storage, x ->> 'writes_to_entity', x ->> 'writes_to_column',
         COALESCE((x ->> 'shown_on_progress_note')::boolean, false), x ->> 'default_value',
         COALESCE((x ->> 'required')::boolean, false), COALESCE((x ->> 'sort_order')::int, (o - 1)::int),
         CASE WHEN jsonb_typeof(x -> 'options') = 'array' THEN x -> 'options' END
  FROM jsonb_array_elements(_fields) WITH ORDINALITY AS e(x, o);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT version INTO v_next FROM public.form_template_versions WHERE id = v_draft;
  PERFORM cp_audit(t.agency_id, t.virtual_office_id, 'template_draft_saved', 'form_template', t.id,
    jsonb_build_object('template_id', t.id, 'version', v_next, 'field_count', v_count));
  RETURN v_draft;
END $$;
REVOKE ALL ON FUNCTION public.save_template_draft(uuid, uuid, public.form_template_kind, text, text, boolean, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_template_draft(uuid, uuid, public.form_template_kind, text, text, boolean, jsonb, jsonb, jsonb) TO authenticated;

-- =============================================================================================
-- 4. publish_template_version
-- =============================================================================================
CREATE FUNCTION public.publish_template_version(_template_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t record; d record; v_cur uuid; v_fields jsonb; v_missing text;
BEGIN
  SELECT * INTO t FROM public.form_templates WHERE id = _template_id FOR UPDATE;   -- serializes publishers
  PERFORM cp_require_template_editor(t.agency_id, t.virtual_office_id);
  SELECT * INTO d FROM public.form_template_versions WHERE template_id = t.id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'This shell has no draft to publish' USING ERRCODE = '22023'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('field_key', field_key, 'storage', storage, 'field_type', field_type,
           'writes_to_entity', writes_to_entity, 'writes_to_column', writes_to_column)), '[]'::jsonb)
    INTO v_fields FROM public.form_template_fields WHERE template_version_id = d.id;
  SELECT string_agg(req, ', ') INTO v_missing FROM unnest(CASE t.kind
      WHEN 'ipos' THEN ARRAY['care_plan.effective_date', 'care_plan.expiration_date']
      WHEN 'authorization' THEN ARRAY['service_authorization.units_authorized', 'service_authorization.effective_date',
                                      'service_authorization.expiration_date']
      ELSE ARRAY[]::text[] END) req
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) x
                     WHERE x ->> 'storage' = 'spine_column'
                       AND (x ->> 'writes_to_entity') || '.' || (x ->> 'writes_to_column') = req);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'This shell must keep its required spine fields: %', v_missing USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_cur FROM public.form_template_versions WHERE template_id = t.id AND is_current;
  IF v_cur IS NOT NULL THEN
    PERFORM cp_check_constrained_edit(v_cur, v_fields, d.note_layout);
    UPDATE public.form_template_versions SET is_current = false WHERE id = v_cur;
  END IF;
  UPDATE public.form_template_versions
     SET status = 'published', is_current = true, published_by = auth.uid(), published_at = now()
   WHERE id = d.id;

  PERFORM cp_audit(t.agency_id, t.virtual_office_id, 'template_published', 'form_template', t.id,
    jsonb_build_object('template_id', t.id, 'version', d.version, 'field_count', jsonb_array_length(v_fields)));
  RETURN d.id;
END $$;
REVOKE ALL ON FUNCTION public.publish_template_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_template_version(uuid) TO authenticated;

-- =============================================================================================
-- 5. upgrade_instance_template — explicit re-shape of one instance onto its shell's current version
-- =============================================================================================
-- Matching field_value keys carry over; values whose key left the shell move under "_retired"
-- (never silently dropped). _new_values fills fields the new version added or made required.
-- Role tier = the instance table's read tier.
CREATE FUNCTION public.upgrade_instance_template(_instance_table text, _instance_id uuid, _new_values jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_roles public.app_role[]; r record; v_new uuid; v_snap jsonb; v_keys text[]; v_vals jsonb; v_retired jsonb; v_from int;
BEGIN
  v_roles := CASE _instance_table
    WHEN 'care_plans' THEN '{manager,agency_admin}'::public.app_role[]
    WHEN 'client_documents' THEN '{manager,agency_admin}'::public.app_role[]
    WHEN 'service_authorizations' THEN '{manager,agency_admin}'::public.app_role[]
    WHEN 'plan_inservice_forms' THEN '{hr_staff,manager,agency_admin}'::public.app_role[]
    WHEN 'plan_training_forms' THEN '{hr_staff,manager,agency_admin}'::public.app_role[]
    ELSE NULL END;
  IF v_roles IS NULL THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
  IF _new_values IS NULL OR jsonb_typeof(_new_values) <> 'object' THEN
    RAISE EXCEPTION 'new values must be a JSON object' USING ERRCODE = '22023';
  END IF;
  EXECUTE format('SELECT agency_id, virtual_office_id, template_id, template_version, field_values FROM public.%I WHERE id = $1 FOR UPDATE',
                 _instance_table) INTO r USING _instance_id;
  PERFORM cp_require_scope(r.agency_id, r.virtual_office_id, v_roles);
  IF _instance_table = 'care_plans' AND NOT EXISTS (SELECT 1 FROM public.care_plans WHERE id = _instance_id AND status = 'active') THEN
    RAISE EXCEPTION 'Only the active plan can be re-shaped' USING ERRCODE = '22023';
  END IF;
  IF r.template_id IS NULL THEN RAISE EXCEPTION 'This record has no template' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_new FROM public.form_template_versions WHERE template_id = r.template_id AND is_current;
  v_from := r.template_version;
  IF v_new IS NULL OR (SELECT version FROM public.form_template_versions WHERE id = v_new) = v_from THEN
    RAISE EXCEPTION 'Already on the current template version' USING ERRCODE = '22023';
  END IF;
  v_snap := cp_template_snapshot(v_new);
  SELECT COALESCE(array_agg(x ->> 'field_key'), ARRAY[]::text[]) INTO v_keys
    FROM jsonb_array_elements(v_snap -> 'fields') x WHERE x ->> 'storage' = 'field_value';
  SELECT COALESCE(jsonb_object_agg(key, value) FILTER (WHERE key = ANY (v_keys)), '{}'::jsonb),
         COALESCE(jsonb_object_agg(key, value) FILTER (WHERE key <> ALL (v_keys) AND key <> '_retired'), '{}'::jsonb)
    INTO v_vals, v_retired FROM jsonb_each(r.field_values);
  v_retired := COALESCE(r.field_values -> '_retired', '{}'::jsonb) || v_retired;
  v_vals := v_vals || (_new_values - '_retired');
  IF v_retired <> '{}'::jsonb THEN v_vals := v_vals || jsonb_build_object('_retired', v_retired); END IF;
  PERFORM cp_validate_field_values(v_snap, v_vals);
  EXECUTE format('UPDATE public.%I SET template_version = $1, field_snapshot = $2, field_values = $3 WHERE id = $4', _instance_table)
    USING (v_snap ->> 'version')::int, v_snap, v_vals, _instance_id;
  PERFORM cp_audit(r.agency_id, r.virtual_office_id, 'instance_template_upgraded', _instance_table, _instance_id,
    jsonb_build_object('instance_id', _instance_id, 'from_version', v_from, 'to_version', (v_snap ->> 'version')::int));
  RETURN jsonb_build_object('from_version', v_from, 'to_version', (v_snap ->> 'version')::int,
                            'retired_keys', (SELECT count(*) FROM jsonb_object_keys(v_retired)));
END $$;
REVOKE ALL ON FUNCTION public.upgrade_instance_template(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upgrade_instance_template(text, uuid, jsonb) TO authenticated;

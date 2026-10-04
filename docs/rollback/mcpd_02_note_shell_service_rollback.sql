-- REFERENCE ONLY: not a migration, never run by the Supabase CLI. Proven on PGlite
-- (tests/ripple/pglite/rollback-soff.cjs, run together with S-OFF-1).
-- Note-shell service_type rollback: save_template_draft back to its 9-argument DEV definition (+ grants),
-- create_progress_note_for_shift restored verbatim, the resolver and the column dropped. Shells
-- created with a service_type keep working as "any service" shells after the column is gone.
BEGIN;
DROP FUNCTION IF EXISTS public.save_template_draft(uuid, uuid, public.form_template_kind, text, text, boolean, jsonb, jsonb, jsonb, text);
CREATE FUNCTION public.save_template_draft(_template_id uuid, _office_id uuid, _kind form_template_kind, _name text, _intake_doc_type text, _is_required_for_client boolean, _sections jsonb, _note_layout jsonb, _fields jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.save_template_draft(uuid, uuid, public.form_template_kind, text, text, boolean, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_template_draft(uuid, uuid, public.form_template_kind, text, text, boolean, jsonb, jsonb, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_progress_note_for_shift(_shift_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

DROP FUNCTION IF EXISTS public.cp_resolve_note_template(uuid, uuid, text);
ALTER TABLE public.form_templates DROP CONSTRAINT IF EXISTS form_templates_service_type_chk, DROP COLUMN IF EXISTS service_type;
-- On DEV only (migration history), same transaction:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261011120100';
COMMIT;

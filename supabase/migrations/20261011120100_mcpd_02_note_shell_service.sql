-- Phase D follow-up — progress-note shells per service (the D3 INFO finding S4.1b).
-- Ripple care-plan module. Owner decision 2026-10-04.
--
--   * form_templates.service_type (nullable): for kind progress_note only, 'cls' or 'respite';
--     NULL = any service (every existing shell, so nothing changes for them).
--   * cp_resolve_note_template(agency, office, service): the office's shells first, then agency-wide
--     (Q15 order kept); inside each, a shell for exactly this service first, then the newest of the
--     rest, which is today's behaviour, so with no service-specific shell nothing changes.
--   * create_progress_note_for_shift uses it (identical signature). Existing notes keep their
--     snapshots (nothing is re-resolved).
--   * save_template_draft gets a trailing _service_type (set on a new shell only, fixed after):
--     parameter list changes -> CLAUDE.md #13: the old 9-argument function is dropped by pronargs,
--     the new one created, REVOKE/GRANT re-applied.
-- Rollback: docs/rollback/mcpd_02_note_shell_service_rollback.sql.

ALTER TABLE public.form_templates
  ADD COLUMN service_type text,
  ADD CONSTRAINT form_templates_service_type_chk
    CHECK (service_type IS NULL OR (kind = 'progress_note' AND service_type IN ('cls', 'respite')));
COMMENT ON COLUMN public.form_templates.service_type IS
  'Progress-note shells only: cls or respite; NULL = any service. Picked by cp_resolve_note_template.';

-- Internal (no API role).
CREATE FUNCTION public.cp_resolve_note_template(_agency_id uuid, _office_id uuid, _service_type text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.id
  FROM public.form_templates t
  JOIN public.form_template_versions v ON v.template_id = t.id AND v.is_current
  WHERE t.agency_id = _agency_id AND t.kind = 'progress_note' AND t.is_active
    AND (t.virtual_office_id = _office_id OR t.virtual_office_id IS NULL)
  ORDER BY (t.virtual_office_id IS NOT NULL) DESC, COALESCE(t.service_type = _service_type, false) DESC, t.created_at DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.cp_resolve_note_template(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- identical signature (ACL unchanged)
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

  -- D3 follow-up: the shell for this note's service first (office, then agency-wide; Q15 order kept)
  v_ver := cp_resolve_note_template(s.agency_id, s.virtual_office_id, v_svc);
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

-- save_template_draft: new trailing parameter (rule 13)
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'save_template_draft' AND p.pronargs = 9 LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig; n := n + 1;
  END LOOP;
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly one 9-argument save_template_draft, found %', n; END IF;
END $$;
CREATE FUNCTION public.save_template_draft(_template_id uuid, _office_id uuid, _kind form_template_kind, _name text, _intake_doc_type text, _is_required_for_client boolean, _sections jsonb, _note_layout jsonb, _fields jsonb, _service_type text DEFAULT NULL)
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
    -- D3 follow-up: a progress-note shell may be for one service (cls / respite); NULL = any service
    IF _service_type IS NOT NULL AND (_kind <> 'progress_note' OR _service_type NOT IN ('cls', 'respite')) THEN
      RAISE EXCEPTION 'service_type is cls or respite, for progress-note shells only' USING ERRCODE = '22023';
    END IF;
    IF _office_id IS NULL THEN
      v_agency := current_agency_id();
    ELSE
      SELECT agency_id INTO v_agency FROM public.virtual_office WHERE id = _office_id;
    END IF;
    PERFORM cp_require_template_editor(v_agency, _office_id);
    PERFORM cp_validate_template_definition(_kind, _fields, _note_layout);
    INSERT INTO public.form_templates (agency_id, virtual_office_id, name, kind, intake_doc_type, is_required_for_client, service_type)
    VALUES (v_agency, _office_id, btrim(_name), _kind, _intake_doc_type, COALESCE(_is_required_for_client, false), _service_type)
    RETURNING * INTO t;
  ELSE
    IF _office_id IS NOT NULL OR _kind IS NOT NULL OR _intake_doc_type IS NOT NULL OR _service_type IS NOT NULL THEN
      RAISE EXCEPTION 'Office, kind, intake type and service type are fixed on an existing shell' USING ERRCODE = '22023';
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
REVOKE ALL ON FUNCTION public.save_template_draft(uuid, uuid, public.form_template_kind, text, text, boolean, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_template_draft(uuid, uuid, public.form_template_kind, text, text, boolean, jsonb, jsonb, jsonb, text) TO authenticated;

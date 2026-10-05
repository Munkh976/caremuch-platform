-- Ripple UI round 3 — W1 audit (owner approval, UI round 2 review): one change to the events CHECK
-- constraint, then the three measure-library writes from UI S2 audit through cp_audit (fail closed).
--
-- 1. events_event_type_check: ONE ALTER TABLE (drop + add, atomic; never a window without the check).
--    Keeps the 44 existing values exactly and adds 6:
--      W1 (S2 measure library): measure_type_upserted, measure_type_activated, measure_type_deactivated,
--                               measure_type_deleted
--      W2 (S4 authorizations):  authorization_corrected, authorization_voided   (added now so the
--                               constraint changes only once; their writers arrive in S4)
-- 2. upsert_measure_type / set_measure_type_active / delete_measure_type: same signatures, same bodies
--    plus one cp_audit call each. CREATE OR REPLACE with an identical signature keeps the ACL
--    (REVOKE PUBLIC/anon, GRANT authenticated, from 20261013120000); verified with aclexplode.
--    Measure types are agency-level, so the event has no office. Payload: ids and the kind only.

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
  'authorization_corrected', 'authorization_voided'
]::text[]));

CREATE OR REPLACE FUNCTION public.upsert_measure_type(_id uuid, _kind public.measure_kind, _label text, _default_options jsonb DEFAULT NULL)
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
    PERFORM cp_audit(v_agency, NULL, 'measure_type_upserted', 'measure_type', v_id,
      jsonb_build_object('measure_type_id', v_id, 'kind', _kind, 'created', true));
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
  PERFORM cp_audit(m.agency_id, NULL, 'measure_type_upserted', 'measure_type', m.id,
    jsonb_build_object('measure_type_id', m.id, 'kind', COALESCE(_kind, m.kind), 'created', false));
  RETURN m.id;
END $$;

CREATE OR REPLACE FUNCTION public.set_measure_type_active(_id uuid, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.measure_types;
BEGIN
  IF _active IS NULL THEN RAISE EXCEPTION 'Say whether the type is active' USING ERRCODE = '22023'; END IF;
  m := cp_require_agency_measure_type(_id);
  UPDATE public.measure_types SET is_active = _active WHERE id = m.id;
  PERFORM cp_audit(m.agency_id, NULL, CASE WHEN _active THEN 'measure_type_activated' ELSE 'measure_type_deactivated' END,
    'measure_type', m.id, jsonb_build_object('measure_type_id', m.id));
END $$;

CREATE OR REPLACE FUNCTION public.delete_measure_type(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.measure_types;
BEGIN
  m := cp_require_agency_measure_type(_id);
  IF EXISTS (SELECT 1 FROM public.objective_measures om WHERE om.measure_type_id = m.id) THEN
    RAISE EXCEPTION 'This measure type is in use; deactivate it instead' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.measure_types WHERE id = m.id;
  PERFORM cp_audit(m.agency_id, NULL, 'measure_type_deleted', 'measure_type', m.id,
    jsonb_build_object('measure_type_id', m.id, 'kind', m.kind));
END $$;

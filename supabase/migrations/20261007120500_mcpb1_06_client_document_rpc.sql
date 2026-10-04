-- Phase B1-06 — upsert_client_document (intake track, schema plan §5.1; Q7, Q8).
-- DRAFT FOR REVIEW. Not pushed.
--
-- Each save is a new version of (client, doc_type): the previous current row is kept as history
-- (is_current false) and the new row becomes current. Locks the client row so two saves can't
-- both become version N. Status 'not_applicable' needs a reason (1-1000 chars); other statuses
-- must not carry one. 'missing' is not stored (missing = no current row). The intake shell is
-- resolved per Q15 by intake_doc_type; field_values validated against its snapshot.
-- Role tier: clinical (manager, agency_admin). Agency/office from the client row.
-- Audited: client_document_saved {document_id, version} (no doc type, status or content).

CREATE FUNCTION public.upsert_client_document(
  _client_id uuid, _doc_type text, _status public.client_document_status,
  _not_applicable_reason text DEFAULT NULL, _effective_date date DEFAULT NULL, _expiration_date date DEFAULT NULL,
  _file_ref text DEFAULT NULL, _field_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record; v_ver uuid; v_snap jsonb; v_version int; v_id uuid;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO c FROM public.clients WHERE id = _client_id FOR UPDATE;
  PERFORM cp_require_scope(c.agency_id, c.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF _doc_type IS NULL OR _doc_type !~ '^[a-z][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'Invalid document type' USING ERRCODE = '22023';
  END IF;
  IF _status IS NULL OR _status = 'missing' THEN
    RAISE EXCEPTION 'Status must be pending, complete, expired or not_applicable' USING ERRCODE = '22023';
  END IF;
  IF _status = 'not_applicable' THEN
    IF COALESCE(btrim(_not_applicable_reason), '') = '' OR length(_not_applicable_reason) > 1000 THEN
      RAISE EXCEPTION 'A not-applicable document needs a reason (at most 1000 characters)' USING ERRCODE = '22023';
    END IF;
  ELSIF _not_applicable_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Only a not-applicable document has a reason' USING ERRCODE = '22023';
  END IF;
  IF _effective_date IS NOT NULL AND _expiration_date IS NOT NULL AND _expiration_date < _effective_date THEN
    RAISE EXCEPTION 'The expiration date is before the effective date' USING ERRCODE = '22023';
  END IF;
  IF _file_ref IS NOT NULL AND (length(_file_ref) > 500 OR _file_ref ~ '(^/|\.\.|\\)' OR _file_ref !~ '^[[:print:]]+$') THEN
    RAISE EXCEPTION 'Invalid file reference' USING ERRCODE = '22023';
  END IF;

  v_ver := cp_resolve_template(c.agency_id, c.virtual_office_id, 'intake', _doc_type);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;
  PERFORM cp_validate_field_values(v_snap, COALESCE(_field_values, '{}'::jsonb));

  SELECT COALESCE(max(version), 0) + 1 INTO v_version FROM public.client_documents WHERE client_id = c.id AND doc_type = _doc_type;
  UPDATE public.client_documents SET is_current = false WHERE client_id = c.id AND doc_type = _doc_type AND is_current;
  INSERT INTO public.client_documents (agency_id, virtual_office_id, client_id, doc_type, version, is_current, status,
    not_applicable_reason, effective_date, expiration_date, file_ref, template_id, template_version, field_snapshot, field_values)
  VALUES (c.agency_id, c.virtual_office_id, c.id, _doc_type, v_version, true, _status,
    NULLIF(btrim(_not_applicable_reason), ''), _effective_date, _expiration_date, _file_ref,
    (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap, COALESCE(_field_values, '{}'::jsonb))
  RETURNING id INTO v_id;

  PERFORM cp_audit(c.agency_id, c.virtual_office_id, 'client_document_saved', 'client_document', v_id,
    jsonb_build_object('document_id', v_id, 'version', v_version));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.upsert_client_document(uuid, text, public.client_document_status, text, date, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_client_document(uuid, text, public.client_document_status, text, date, date, text, jsonb) TO authenticated;

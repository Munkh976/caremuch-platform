-- Phase B1-05 — create_service_authorization (V1 manual adapter: the manager reads the
-- authorization from KARE and enters it). Schema plan §5; arch §3, §5. DRAFT FOR REVIEW.
--
-- Role tier: manager, agency_admin. Agency/office from the client row; the client must have an
-- office, and the service type must be one that office maps (office_service_types, active).
-- auth_number: trimmed, 1-64 printable characters, unique per agency (case-insensitive check
-- under a per-agency+number advisory lock, plus the UNIQUE (agency_id, auth_number) backstop).
-- units_available is derived by the Phase A trigger (= units_authorized at creation).
-- Audited: authorization_created {authorization_id, units_authorized}.

CREATE FUNCTION public.create_service_authorization(
  _client_id uuid, _service_type text, _auth_number text, _units_authorized numeric,
  _effective_date date, _expiration_date date,
  _unit_minutes integer DEFAULT 15, _service_code text DEFAULT NULL, _modifier text DEFAULT NULL,
  _service_description text DEFAULT NULL, _period_type public.auth_period_type DEFAULT NULL,
  _units_per_period numeric DEFAULT NULL, _authorizing_agent_notes text DEFAULT NULL,
  _field_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record; v_num text := btrim(_auth_number); v_ver uuid; v_snap jsonb; v_id uuid;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO c FROM public.clients WHERE id = _client_id;
  PERFORM cp_require_scope(c.agency_id, c.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF c.virtual_office_id IS NULL THEN
    RAISE EXCEPTION 'The client has no office, so no service type can be authorized' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.office_service_types s WHERE s.virtual_office_id = c.virtual_office_id
                   AND s.service_type = _service_type AND s.is_active) THEN
    RAISE EXCEPTION 'This office does not provide that service type' USING ERRCODE = '22023';
  END IF;
  IF v_num IS NULL OR v_num !~ '^[[:graph:]][[:print:]]{0,63}$' THEN
    RAISE EXCEPTION 'The authorization number must be 1-64 printable characters' USING ERRCODE = '22023';
  END IF;
  IF _units_authorized IS NULL OR _units_authorized <= 0 OR _units_authorized > 100000 THEN
    RAISE EXCEPTION 'Units authorized must be greater than 0' USING ERRCODE = '22023';
  END IF;
  IF _effective_date IS NULL OR _expiration_date IS NULL OR _expiration_date < _effective_date THEN
    RAISE EXCEPTION 'Valid effective and expiration dates are required' USING ERRCODE = '22023';
  END IF;
  IF _unit_minutes IS NULL OR _unit_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'Unit minutes must be between 1 and 1440' USING ERRCODE = '22023';
  END IF;
  IF _units_per_period IS NOT NULL AND _units_per_period <= 0 THEN
    RAISE EXCEPTION 'Units per period must be greater than 0' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(_service_code, '')) > 32 OR length(COALESCE(_modifier, '')) > 32
     OR length(COALESCE(_service_description, '')) > 2000 OR length(COALESCE(_authorizing_agent_notes, '')) > 4000 THEN
    RAISE EXCEPTION 'A text field is too long' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(c.agency_id::text || ':' || upper(v_num), 0));
  IF EXISTS (SELECT 1 FROM public.service_authorizations WHERE agency_id = c.agency_id AND upper(auth_number) = upper(v_num)) THEN
    RAISE EXCEPTION 'This authorization number already exists in your agency' USING ERRCODE = '23505';
  END IF;

  v_ver := cp_resolve_template(c.agency_id, c.virtual_office_id, 'authorization', NULL);
  v_snap := CASE WHEN v_ver IS NULL THEN NULL ELSE cp_template_snapshot(v_ver) END;
  PERFORM cp_validate_field_values(v_snap, COALESCE(_field_values, '{}'::jsonb));

  INSERT INTO public.service_authorizations (agency_id, virtual_office_id, client_id, auth_number, service_code, modifier,
    service_type, service_description, units_authorized, period_type, units_per_period, unit_minutes,
    effective_date, expiration_date, source_adapter, authorizing_agent_notes,
    template_id, template_version, field_snapshot, field_values)
  VALUES (c.agency_id, c.virtual_office_id, c.id, v_num, NULLIF(btrim(_service_code), ''), NULLIF(btrim(_modifier), ''),
    _service_type, _service_description, _units_authorized, _period_type, _units_per_period, _unit_minutes,
    _effective_date, _expiration_date, 'manual', _authorizing_agent_notes,
    (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap, COALESCE(_field_values, '{}'::jsonb))
  RETURNING id INTO v_id;

  PERFORM cp_audit(c.agency_id, c.virtual_office_id, 'authorization_created', 'service_authorization', v_id,
    jsonb_build_object('authorization_id', v_id, 'units_authorized', _units_authorized));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_service_authorization(uuid, text, text, numeric, date, date, integer, text, text, text,
  public.auth_period_type, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_service_authorization(uuid, text, text, numeric, date, date, integer, text, text, text,
  public.auth_period_type, numeric, text, jsonb) TO authenticated;

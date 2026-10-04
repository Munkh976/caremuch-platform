-- Phase C-03 — authorization units: go-live opening balance + per-period caps in review.
-- Ripple care-plan module. Owner review of Phase C (fixes 2 and 3). Applied after C-02.
--
--   * service_authorizations.units_used_before_caremuch (opening balance, >= 0 and <= units_authorized,
--     default 0): units of the authorization already used before CareMuch. Entered once, with the
--     authorization (create_service_authorization, new trailing parameter); subtracted in
--     units_available by the Phase A derive trigger. API roles can't write the table (SELECT only).
--   * review_progress_note refuses a review that would push the authorization over its per-period
--     cap (per_day / per_week = the office's billing week / per_month / per_quarter); the note stays
--     submitted. per_auth = the total only (units_available), as before.
--   * create_service_authorization's parameter list changes (CLAUDE.md rule 13): the old 14-argument
--     function is dropped by pronargs, the new one created and its REVOKE/GRANT re-applied.

-- =============================================================================================
-- 1. Opening balance column + derive trigger
-- =============================================================================================
ALTER TABLE public.service_authorizations
  ADD COLUMN units_used_before_caremuch numeric NOT NULL DEFAULT 0,
  ADD CONSTRAINT service_authorizations_units_before_chk
    CHECK (units_used_before_caremuch >= 0 AND units_used_before_caremuch <= units_authorized);
COMMENT ON COLUMN public.service_authorizations.units_used_before_caremuch IS
  'Opening balance at go-live: units of this authorization used before CareMuch. Subtracted in units_available.';

-- identical signature (trigger function): ACL unchanged
CREATE OR REPLACE FUNCTION public.cp_derive_authorization_units()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Phase C: minus the opening balance (units used before CareMuch, entered with the authorization)
  NEW.units_available := NEW.units_authorized - NEW.units_used_before_caremuch - COALESCE((
    SELECT SUM(n.units_used) FROM public.progress_notes n
    WHERE n.authorization_id = NEW.id AND n.billable AND NOT n.voided), 0);
  RETURN NEW;
END $$;

-- =============================================================================================
-- 2. create_service_authorization — new trailing parameter _units_used_before_caremuch (rule 13)
-- =============================================================================================
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'create_service_authorization' AND p.pronargs = 14 LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig; n := n + 1;
  END LOOP;
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly one 14-argument create_service_authorization, found %', n; END IF;
END $$;

CREATE FUNCTION public.create_service_authorization(
  _client_id uuid, _service_type text, _auth_number text, _units_authorized numeric,
  _effective_date date, _expiration_date date,
  _unit_minutes integer DEFAULT 15, _service_code text DEFAULT NULL, _modifier text DEFAULT NULL,
  _service_description text DEFAULT NULL, _period_type public.auth_period_type DEFAULT NULL,
  _units_per_period numeric DEFAULT NULL, _authorizing_agent_notes text DEFAULT NULL,
  _field_values jsonb DEFAULT '{}'::jsonb, _units_used_before_caremuch numeric DEFAULT 0)
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
  -- Phase C: opening balance at go-live (units of this authorization already used before CareMuch)
  IF _units_used_before_caremuch IS NULL OR _units_used_before_caremuch < 0 OR _units_used_before_caremuch > _units_authorized THEN
    RAISE EXCEPTION 'Units used before CareMuch must be between 0 and the units authorized' USING ERRCODE = '22023';
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
    effective_date, expiration_date, source_adapter, authorizing_agent_notes, units_used_before_caremuch,
    template_id, template_version, field_snapshot, field_values)
  VALUES (c.agency_id, c.virtual_office_id, c.id, v_num, NULLIF(btrim(_service_code), ''), NULLIF(btrim(_modifier), ''),
    _service_type, _service_description, _units_authorized, _period_type, _units_per_period, _unit_minutes,
    _effective_date, _expiration_date, 'manual', _authorizing_agent_notes, _units_used_before_caremuch,
    (v_snap ->> 'template_id')::uuid, (v_snap ->> 'version')::int, v_snap, COALESCE(_field_values, '{}'::jsonb))
  RETURNING id INTO v_id;

  PERFORM cp_audit(c.agency_id, c.virtual_office_id, 'authorization_created', 'service_authorization', v_id,
    jsonb_build_object('authorization_id', v_id, 'units_authorized', _units_authorized,
      'units_used_before_caremuch', _units_used_before_caremuch));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_service_authorization(uuid, text, text, numeric, date, date, integer, text, text, text,
  public.auth_period_type, numeric, text, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_service_authorization(uuid, text, text, numeric, date, date, integer, text, text, text,
  public.auth_period_type, numeric, text, jsonb, numeric) TO authenticated;

-- =============================================================================================
-- 3. review_progress_note — per-period cap; identical signature (grants unchanged)
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.review_progress_note(_note_id uuid, _billable boolean, _non_billable_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n record; a record; v_left numeric; v_pl numeric; v_per text;
BEGIN
  SELECT * INTO n FROM public.progress_notes WHERE id = _note_id AND NOT voided FOR UPDATE;
  PERFORM cp_require_scope(n.agency_id, n.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF n.status <> 'submitted' THEN RAISE EXCEPTION 'Only a submitted note can be reviewed' USING ERRCODE = '22023'; END IF;
  IF _billable IS NULL THEN RAISE EXCEPTION 'Say whether the visit is billable' USING ERRCODE = '22023'; END IF;

  IF NOT _billable THEN
    IF COALESCE(btrim(_non_billable_reason), '') = '' OR length(_non_billable_reason) > 1000 THEN
      RAISE EXCEPTION 'A non-billable review needs a reason (at most 1000 characters)' USING ERRCODE = '22023';
    END IF;
    UPDATE public.progress_notes SET billable = false, non_billable_reason = btrim(_non_billable_reason), authorization_id = NULL,
           status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = n.id;
    PERFORM cp_audit(n.agency_id, n.virtual_office_id, 'progress_note_reviewed', 'progress_note', n.id,
      jsonb_build_object('note_id', n.id, 'billable', false, 'units_used', 0));
    RETURN jsonb_build_object('billable', false, 'units_used', 0);
  END IF;
  IF _non_billable_reason IS NOT NULL THEN RAISE EXCEPTION 'A billable review has no non-billable reason' USING ERRCODE = '22023'; END IF;

  -- lock every authorization of this client + service in a fixed order (no deadlocks between
  -- reviewers); the next statement then reads the committed units after any concurrent review
  PERFORM 1 FROM public.service_authorizations
   WHERE client_id = n.client_id AND service_type = n.service_type ORDER BY id FOR UPDATE;
  -- Phase C: the authorization must also have room in the service date's period when it has a
  -- per-period cap (cp_period_left: cap − units already charged in that window)
  SELECT sa.* INTO a FROM public.service_authorizations sa JOIN public.virtual_office vo ON vo.id = sa.virtual_office_id
   WHERE sa.client_id = n.client_id AND sa.service_type = n.service_type
     AND sa.effective_date <= n.service_date AND sa.expiration_date >= n.service_date
     AND sa.units_available >= n.units_used
     AND COALESCE(cp_period_left(sa.id, sa.period_type, sa.units_per_period, vo.billing_week_start, n.service_date, '{}', '{}', '{}'), n.units_used) >= n.units_used
   ORDER BY sa.expiration_date, sa.created_at, sa.id
   LIMIT 1;
  IF a.id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.service_authorizations WHERE client_id = n.client_id AND service_type = n.service_type) THEN
      RAISE EXCEPTION 'Not billable yet: the client has no authorization for this service' USING ERRCODE = '22023';
    ELSIF NOT EXISTS (SELECT 1 FROM public.service_authorizations WHERE client_id = n.client_id AND service_type = n.service_type
                        AND effective_date <= n.service_date AND expiration_date >= n.service_date) THEN
      RAISE EXCEPTION 'Not billable yet: the service date is outside every authorization''s dates' USING ERRCODE = '22023';
    ELSIF EXISTS (SELECT 1 FROM public.service_authorizations WHERE client_id = n.client_id AND service_type = n.service_type
                    AND effective_date <= n.service_date AND expiration_date >= n.service_date AND units_available >= n.units_used) THEN
      -- enough units in total, but every such authorization is at its period cap
      SELECT cp_period_left(sa.id, sa.period_type, sa.units_per_period, vo.billing_week_start, n.service_date, '{}', '{}', '{}'),
             replace(sa.period_type::text, 'per_', '')
        INTO v_pl, v_per
        FROM public.service_authorizations sa JOIN public.virtual_office vo ON vo.id = sa.virtual_office_id
       WHERE sa.client_id = n.client_id AND sa.service_type = n.service_type
         AND sa.effective_date <= n.service_date AND sa.expiration_date >= n.service_date AND sa.units_available >= n.units_used
       ORDER BY sa.expiration_date, sa.created_at, sa.id LIMIT 1;
      RAISE EXCEPTION 'Not billable yet: this visit would go over the authorization''s % cap (% units needed, % left this %)',
        CASE v_per WHEN 'day' THEN 'daily' ELSE v_per || 'ly' END, n.units_used, GREATEST(v_pl, 0), v_per USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'Not billable yet: not enough authorized units remain (% needed)', n.units_used USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.progress_notes SET billable = true, non_billable_reason = NULL, authorization_id = a.id,
         status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = n.id;
  SELECT units_available INTO v_left FROM public.service_authorizations WHERE id = a.id;
  IF v_left < 0 THEN RAISE EXCEPTION 'Not billable yet: not enough authorized units remain' USING ERRCODE = '22023'; END IF;
  PERFORM cp_audit(n.agency_id, n.virtual_office_id, 'progress_note_reviewed', 'progress_note', n.id,
    jsonb_build_object('note_id', n.id, 'billable', true, 'authorization_id', a.id, 'units_used', n.units_used));
  RETURN jsonb_build_object('billable', true, 'authorization_id', a.id, 'units_used', n.units_used, 'units_left', v_left);
END $$;

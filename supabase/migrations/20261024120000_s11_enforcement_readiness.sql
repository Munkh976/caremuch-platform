-- Ripple UI S11 — enforcement readiness for the dashboard compliance section (G4, deferred from S10).
--
-- get_enforcement_readiness(_office_id, _days default 14): NEW, read-only, SECURITY DEFINER. Manager or agency_admin
-- of the office (cp_require_scope: clinical tier + the M-Office predicate; generic refusal). For every shift of the
-- office from today (office time zone) through today + _days - 1 that is not cancelled / completed:
--   * assigned: the existing check_assignment_eligibility(shift, caregiver) (unchanged); the care-plan codes that
--     the switch controls are counted whether the result lists them as advisory (switch off) or hard (switch on);
--   * unassigned: the client-level part only (cp_shift_client_context: no / expired authorization, units short),
--     since training and credentials depend on who is assigned.
-- Switch-controlled codes: credential_missing, training_missing, authorization_missing, authorization_expired,
-- units_short, units_short_period. group_full and the older rules block whatever the switch, so they aren't counted.
-- Returns counts, the breakdown by reason and the first 50 affected shifts (client first name + initial, caregiver
-- name, codes; no clinical text). Writes nothing. REVOKE PUBLIC/anon, GRANT authenticated (rule 14).

CREATE FUNCTION public.get_enforcement_readiness(_office_id uuid, _days integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o record; v_today date; v_days integer := LEAST(GREATEST(COALESCE(_days, 14), 1), 31);
  s record; v_cg uuid; v_elig jsonb; v_ctx jsonb; v_codes text[];
  v_checked integer := 0; v_block integer := 0; v_by jsonb := '{}'::jsonb; v_rows jsonb := '[]'::jsonb; c text;
  k_codes CONSTANT text[] := ARRAY['credential_missing','training_missing','authorization_missing','authorization_expired','units_short','units_short_period'];
BEGIN
  SELECT id, agency_id, timezone, compliance_enforcement_enabled, care_plan_module_enabled INTO o
    FROM public.virtual_office WHERE id = _office_id;
  PERFORM cp_require_scope(o.agency_id, o.id, '{manager,agency_admin}'::public.app_role[]);
  v_today := (now() AT TIME ZONE COALESCE(o.timezone, 'America/New_York'))::date;
  FOR s IN
    SELECT sh.id, sh.shift_date, sh.start_time, sh.client_id, cl.first_name, left(cl.last_name, 1) AS last_initial
      FROM public.shifts sh LEFT JOIN public.clients cl ON cl.id = sh.client_id
     WHERE sh.virtual_office_id = o.id AND sh.shift_date BETWEEN v_today AND v_today + v_days - 1
       AND sh.status NOT IN ('cancelled', 'completed')
     ORDER BY sh.shift_date, sh.start_time, sh.id
  LOOP
    v_checked := v_checked + 1;
    SELECT a.caregiver_id INTO v_cg FROM public.shift_assignments a
     WHERE a.shift_id = s.id AND a.status <> 'cancelled' ORDER BY a.created_at DESC LIMIT 1;
    IF v_cg IS NOT NULL THEN
      v_elig := public.check_assignment_eligibility(s.id, v_cg);
      SELECT COALESCE(array_agg(DISTINCT x ->> 'code' ORDER BY x ->> 'code'), '{}') INTO v_codes
        FROM jsonb_array_elements(COALESCE(v_elig -> 'hard', '[]'::jsonb) || COALESCE(v_elig -> 'advisory', '[]'::jsonb)) x
       WHERE x ->> 'code' = ANY (k_codes);
    ELSE
      v_ctx := public.cp_shift_client_context(s.id);
      v_codes := CASE WHEN COALESCE((v_ctx ->> 'rules')::boolean, false) AND v_ctx ->> 'svc' IN ('cls', 'respite') THEN
        CASE v_ctx -> 'proj' ->> 'status' WHEN 'missing' THEN ARRAY['authorization_missing'] WHEN 'expired' THEN ARRAY['authorization_expired']
          WHEN 'short' THEN ARRAY['units_short'] WHEN 'short_period' THEN ARRAY['units_short_period'] ELSE '{}'::text[] END
        ELSE '{}'::text[] END;
    END IF;
    IF cardinality(v_codes) > 0 THEN
      v_block := v_block + 1;
      FOREACH c IN ARRAY v_codes LOOP
        v_by := jsonb_set(v_by, ARRAY[c], to_jsonb(COALESCE((v_by ->> c)::int, 0) + 1));
      END LOOP;
      IF jsonb_array_length(v_rows) < 50 THEN
        v_rows := v_rows || jsonb_build_object('shift_id', s.id, 'shift_date', s.shift_date, 'start_time', s.start_time,
          'client_id', s.client_id, 'client_first_name', s.first_name, 'client_last_initial', s.last_initial,
          'caregiver_id', v_cg, 'caregiver_name', (SELECT NULLIF(btrim(concat_ws(' ', g.first_name, g.last_name)), '') FROM public.caregivers g WHERE g.id = v_cg),
          'codes', to_jsonb(v_codes));
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('office_id', o.id, 'module_enabled', o.care_plan_module_enabled, 'enforcement', o.compliance_enforcement_enabled,
    'from', v_today, 'to', v_today + v_days - 1, 'days', v_days, 'shifts_checked', v_checked, 'would_block', v_block,
    'by_reason', v_by, 'shifts', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.get_enforcement_readiness(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_enforcement_readiness(uuid, integer) TO authenticated;

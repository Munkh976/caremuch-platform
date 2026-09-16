-- Caregiver Available Shifts redesign: two separate sections (trade shifts, open shifts)
-- instead of one merged list. See docs/scheduling-caregiver-board-plan.md (rev 2) for the
-- full design and why the merge was rejected.
--
-- Footgun check (CLAUDE.md rule #14): two brand-new SECURITY DEFINER functions below
-- (get_caregiver_trade_shifts, check_caregiver_shifts_eligibility) -- REVOKE ALL FROM
-- PUBLIC, anon BEFORE granting to authenticated, verified via aclexplode after push.
-- caregiver_pick_up_shift's signature (_shift_id uuid) is UNCHANGED -- confirmed live
-- before this migration that it already holds only postgres/authenticated/service_role
-- (no anon), so a plain CREATE OR REPLACE preserves those grants correctly; only its body
-- changes.

-- =============================================================================
-- 1. caregiver_pick_up_shift(): self-pickup becomes hard-only. A caregiver volunteering
--    for their own shift consents to it -- there is no manager to escalate a soft issue
--    to on this path (unlike the trade path, which already has that escalation). Soft
--    issues are still computed and returned in `eligibility` for the UI to show as an
--    FYI note; they no longer block the pickup itself. Hard issues (time-off, wrong
--    office, missing skill, expired/unverified cert, double-booking, shift not open,
--    shift already taken) are unchanged -- still an unconditional refusal.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.caregiver_pick_up_shift(_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cg uuid; elig jsonb; s record; v_id uuid;
BEGIN
  SELECT id INTO v_cg FROM public.caregivers WHERE user_id = auth.uid() LIMIT 1;
  IF v_cg IS NULL THEN RAISE EXCEPTION 'No caregiver profile for this user' USING ERRCODE='42501'; END IF;

  SELECT * INTO s FROM public.shifts WHERE id=_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found' USING ERRCODE='P0002'; END IF;
  IF s.status NOT IN ('open','unassigned') THEN
    RAISE EXCEPTION 'Shift is not open for pick-up' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_assignments a WHERE a.shift_id=_shift_id AND a.status<>'cancelled') THEN
    RAISE EXCEPTION 'Shift is already assigned' USING ERRCODE='23514';
  END IF;

  elig := public.check_assignment_eligibility(_shift_id, v_cg);
  -- CHANGED: was `jsonb_array_length(elig->'hard') > 0 OR jsonb_array_length(elig->'soft') > 0`.
  -- Self-pickup now blocks on hard issues only -- soft issues (availability, service-area
  -- over the zip list) are self-consented by the caregiver's own act of picking it up.
  IF jsonb_array_length(elig->'hard') > 0 THEN
    RAISE EXCEPTION 'Pick-up refused: %', (
      SELECT string_agg(x->>'detail',' ') FROM jsonb_array_elements(elig->'hard') x
    ) USING ERRCODE='23514';
  END IF;

  PERFORM set_config('caremuch.assignment_ctx','1',true);
  INSERT INTO public.shift_assignments(shift_id, caregiver_id, status, assignment_method)
  VALUES (_shift_id, v_cg, 'scheduled', 'picked_up') RETURNING id INTO v_id;
  PERFORM set_config('caremuch.assignment_ctx','',true);

  RETURN jsonb_build_object('assignment_id', v_id, 'eligibility', elig);
END;
$function$;

-- =============================================================================
-- 2. get_caregiver_trade_shifts(): the Trade Shifts section's own data source. Only
--    reaches into shift_trades (joined to shifts for display fields) -- no UNION, no
--    discriminator, every row this returns is unambiguously a trade. Office-scoped here
--    explicitly because shift_trades' own RLS is agency-wide only (no virtual_office_id
--    column on that table) -- see known-issues.md. Excludes the caller's own drop
--    requests (those surface separately via "My Trade Requests", client-side, using
--    shift_trades' existing RLS directly -- no new function needed for that).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_caregiver_trade_shifts()
RETURNS TABLE(
  trade_id uuid,
  shift_id uuid,
  client_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  duration_hours numeric,
  care_type_code text,
  order_title text,
  original_caregiver_first_name text,
  original_caregiver_last_name text,
  reason text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cg record;
BEGIN
  SELECT cg.id, cg.agency_id, cg.virtual_office_id
    INTO v_cg
  FROM public.caregivers cg
  WHERE cg.user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN; -- caller isn't a caregiver -- empty set, not an error
  END IF;

  RETURN QUERY
  SELECT t.id, s.id, s.client_id, s.shift_date, s.start_time, s.end_time, s.duration_hours,
         s.care_type_code, s.order_title, oc.first_name, oc.last_name, t.reason
  FROM public.shift_trades t
  JOIN public.shifts s ON s.id = t.shift_id
  JOIN public.caregivers oc ON oc.id = t.original_caregiver_id
  WHERE t.status = 'pending'
    AND t.requires_manager_approval = false
    AND s.agency_id = v_cg.agency_id
    AND s.virtual_office_id = v_cg.virtual_office_id
    AND t.original_caregiver_id <> v_cg.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_caregiver_trade_shifts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_caregiver_trade_shifts() TO authenticated;

-- =============================================================================
-- 3. check_caregiver_shifts_eligibility(): the transpose of Phase 1B's
--    check_assignment_eligibility_bulk -- one caregiver (the caller, resolved internally,
--    never a parameter) against many shifts. Shared by both the Trade Shifts and Open
--    Shifts sections; call once with the combined shift ids from both.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_caregiver_shifts_eligibility(_shift_ids uuid[])
RETURNS TABLE(shift_id uuid, result jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cg uuid;
BEGIN
  SELECT id INTO v_cg FROM public.caregivers WHERE user_id = auth.uid() LIMIT 1;
  IF v_cg IS NULL THEN
    RETURN; -- caller isn't a caregiver -- empty set, not an error
  END IF;

  RETURN QUERY
  SELECT sid, public.check_assignment_eligibility(sid, v_cg)
  FROM unnest(_shift_ids) AS sid;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_caregiver_shifts_eligibility(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_caregiver_shifts_eligibility(uuid[]) TO authenticated;

-- =============================================================================
-- 4. Menu: remove "Shift Trades" from the caregiver's data-driven sidebar. Confirmed
--    (docs/scheduling-caregiver-board-plan.md §0.4) no live caregiver-facing feature
--    depends on this row -- the only shift_trades INSERT in the codebase is staff-side
--    (TimeOffDecisionDialog.tsx, on time-off approval). This is necessary but not
--    sufficient on its own -- the actual access-control fix is the route guard added to
--    ShiftTrades.tsx in this same change (frontend code, not a migration).
-- =============================================================================
DELETE FROM public.role_permissions WHERE role_code = 'caregiver' AND module_code = 'shift_trades';

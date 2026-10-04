-- Fix: Trade Shifts cards show "Unknown" for the client name (Open Shifts correctly show
-- Betty Baker / Eleanor Whitfield). Same class of bug as 20260916120000's original
-- "Unknown client" fix -- get_caregiver_visible_clients() was never taught about the Trade
-- Shifts board when it was added in 20260916180000, so its row-filter has no clause that
-- matches a shift that's still assigned to a DIFFERENT (original) caregiver but advertised
-- via shift_trades. AvailableShifts.tsx's own merge (`visibleClients.get(t.client_id)`) was
-- already correct -- the RPC just never returned that client, so the merge fell through to
-- null and the UI's "Unknown" fallback fired.
--
-- Fix: add a third visibility clause, mirroring get_caregiver_trade_shifts()'s own WHERE
-- clause exactly (same office scope, same status='pending'/requires_manager_approval=false/
-- original_caregiver_id<>caller predicates) so a trade card's client can never resolve
-- differently than whether the trade itself is shown at all.
--
-- Footgun check (CLAUDE.md rule #14): CREATE OR REPLACE on an EXISTING function with the
-- SAME signature (zero args) does not reset ACLs, but re-asserting REVOKE/GRANT here is the
-- established checklist practice on this project -- verify via aclexplode after push, not
-- just "it applied without error."
CREATE OR REPLACE FUNCTION public.get_caregiver_visible_clients()
RETURNS TABLE(
  id uuid,
  first_name text,
  last_name text,
  phone text,
  address text,
  city text,
  state text,
  zip_code text,
  scheduling_flexibility text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cg record;
BEGIN
  SELECT cg.id, cg.agency_id, cg.virtual_office_id
    INTO v_cg
  FROM public.caregivers cg
  WHERE cg.user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN; -- caller isn't a caregiver -- empty set, not an error
  END IF;

  RETURN QUERY
  SELECT DISTINCT c.id, c.first_name, c.last_name, c.phone, c.address, c.city, c.state, c.zip_code, c.scheduling_flexibility
  FROM public.clients c
  JOIN public.shifts s ON s.client_id = c.id
  WHERE s.agency_id = v_cg.agency_id
    AND (
      -- (a) a shift this caregiver is actively assigned to
      EXISTS (
        SELECT 1 FROM public.shift_assignments sa
        WHERE sa.shift_id = s.id AND sa.caregiver_id = v_cg.id AND sa.status <> 'cancelled'
      )
      OR
      -- (b) an open shift in the caregiver's own office (so AvailableShifts previews resolve)
      (s.status IN ('open', 'unassigned') AND s.virtual_office_id = v_cg.virtual_office_id)
      OR
      -- (c) a shift currently on the Trade Shifts board in the caller's own office --
      -- mirrors get_caregiver_trade_shifts()'s WHERE clause exactly.
      EXISTS (
        SELECT 1 FROM public.shift_trades t
        WHERE t.shift_id = s.id
          AND t.status = 'pending'
          AND t.requires_manager_approval = false
          AND s.virtual_office_id = v_cg.virtual_office_id
          AND t.original_caregiver_id <> v_cg.id
      )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_caregiver_visible_clients() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_caregiver_visible_clients() TO authenticated;

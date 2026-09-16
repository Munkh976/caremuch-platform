-- Fix: caregiver-facing shift views show "Unknown client" for every shift, always.
-- Root cause (confirmed via live audit, not a data problem -- see
-- docs/known-issues.md's "Caregivers cannot see any client info" entry): public.clients
-- has never (since its first RLS policies, 20251103220124) had a SELECT policy for the
-- 'caregiver' role -- only staff roles and the client's own login can read a clients row.
-- A caregiver-facing nested PostgREST embed (shifts -> clients) silently resolves to NULL
-- when RLS denies the embedded table, rather than erroring.
--
-- Fix shape: a full-row RLS policy is the WRONG mechanism here -- clients carries
-- medical_conditions/notes (PHI-adjacent free text), and this project's own established
-- principle (match-caregiver already excludes these fields from matching for
-- privacy/safety/legal reasons) means a caregiver-facing view must not expose them either.
-- Postgres column-level GRANT can't help: every application role (caregiver, manager,
-- agency_admin, ...) maps to the SAME database role `authenticated` in this project, so a
-- column-level grant/revoke on `authenticated` would affect staff too. Instead: a new
-- SECURITY DEFINER function that (a) determines the calling caregiver's own row, (b) row-
-- filters to only clients they're legitimately connected to (assigned shift, OR an open
-- shift in their own office -- mirrors the Phase 1B AvailableShifts policy shape exactly),
-- and (c) returns ONLY a narrow, non-PHI column list. The base `clients` table's RLS/grants
-- are completely untouched -- staff access is unaffected by construction, not by care.
--
-- Footgun check (known-issues.md / CLAUDE.md rule #14): this is a NEW SECURITY DEFINER
-- function -- REVOKE ALL FROM PUBLIC, anon BEFORE granting to authenticated, verified via
-- aclexplode after push, not just "it applied without error."
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
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_caregiver_visible_clients() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_caregiver_visible_clients() TO authenticated;

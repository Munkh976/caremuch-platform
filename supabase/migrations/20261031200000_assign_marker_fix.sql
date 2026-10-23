-- Same marker fix as cp_guard_shift_cancel (20261031190100), for protect_assignment_columns (owner, Oct 23, 4b): an API
-- role could call set_config('caremuch.assignment_ctx', '1') itself and then insert / reassign / cancel assignments or
-- write the override fields directly. The mark is now honoured only when current_user is not anon / authenticated /
-- service_role / authenticator — i.e. inside the SECURITY DEFINER assignment functions (assign_caregiver_to_shift,
-- release_shift_assignments, the two pickups, unassign_visit, cancel_visit, record_client_no_show; all owned by postgres)
-- or a direct owner session.
-- The function becomes SECURITY INVOKER: as SECURITY DEFINER, current_user inside it is always its owner, so it could not
-- see the caller. Its body only compares OLD / NEW and raises (it reads no table), so nothing else changes.
-- Existing function (approved, 4b). Same signature; grants re-stated (no API role). The trigger is unchanged.

CREATE OR REPLACE FUNCTION public.protect_assignment_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $fn$
BEGIN
  -- the mark counts only when it isn't set by an API role itself: inside the SECURITY DEFINER assignment functions
  -- current_user is their owner; a session of anon / authenticated / service_role (or the authenticator) can't use it
  IF COALESCE(current_setting('caremuch.assignment_ctx', true),'') = '1'
     AND current_user NOT IN ('anon', 'authenticated', 'service_role', 'authenticator') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Direct assignment inserts are not allowed; use assign_caregiver_to_shift()' USING ERRCODE='42501';
  END IF;
  IF NEW.caregiver_id IS DISTINCT FROM OLD.caregiver_id THEN
    RAISE EXCEPTION 'caregiver_id can only be changed through assign_caregiver_to_shift()' USING ERRCODE='42501';
  END IF;
  IF NEW.override_reason IS DISTINCT FROM OLD.override_reason
     OR NEW.override_by IS DISTINCT FROM OLD.override_by
     OR NEW.override_at IS DISTINCT FROM OLD.override_at THEN
    RAISE EXCEPTION 'Override fields are set by the assignment function only' USING ERRCODE='42501';
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Cancelling an assignment must go through the assignment functions' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.protect_assignment_columns() FROM PUBLIC, anon, authenticated;

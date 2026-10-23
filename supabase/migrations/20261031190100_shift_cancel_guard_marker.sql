-- Rule-16 fix of cp_guard_shift_cancel (created and pushed in this slice, 20261031190000; owner, Oct 23, check 2a): an API
-- role could set the transaction-local mark caremuch.assignment_ctx itself (set_config is callable from SQL by any role)
-- and then cancel directly. The mark is now honoured only when current_user is not an API role, i.e. inside the two
-- SECURITY DEFINER actions (cancel_visit, record_client_no_show run as their owner) or a direct owner session. Same
-- signature; grants re-stated (no API role). Otherwise byte-identical to the pushed body.

CREATE OR REPLACE FUNCTION public.cp_guard_shift_cancel()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  -- the mark counts only when it isn't set by an API role itself: inside the two SECURITY DEFINER actions current_user is
  -- the function owner; a session of anon / authenticated / service_role (or the authenticator) can't use it
  v_marked boolean := COALESCE(current_setting('caremuch.assignment_ctx', true), '') = '1'
                      AND current_user NOT IN ('anon', 'authenticated', 'service_role', 'authenticator');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.status::text = 'cancelled' OR NEW.visit_outcome IS NOT NULL) AND NOT v_marked THEN
      RAISE EXCEPTION 'Cancel visits with Cancel visit or Client no-show (reason required)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF v_marked THEN
    IF NEW.status::text = 'cancelled' AND OLD.status::text IS DISTINCT FROM 'cancelled' AND NEW.visit_outcome IS NULL THEN
      RAISE EXCEPTION 'A cancellation needs its outcome and reason' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status::text = 'cancelled' AND OLD.status::text IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'Cancel visits with Cancel visit or Client no-show (reason required)' USING ERRCODE = '42501';
  END IF;
  IF OLD.status::text = 'cancelled' AND NEW.status::text IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled visit can''t be reopened directly' USING ERRCODE = '42501';
  END IF;
  IF (NEW.visit_outcome, NEW.cancel_reason_code, NEW.cancel_reason_text, NEW.cancel_requested_by, NEW.cancelled_by, NEW.cancelled_at, NEW.late_cancel)
     IS DISTINCT FROM
     (OLD.visit_outcome, OLD.cancel_reason_code, OLD.cancel_reason_text, OLD.cancel_requested_by, OLD.cancelled_by, OLD.cancelled_at, OLD.late_cancel) THEN
    RAISE EXCEPTION 'The cancellation record is written by Cancel visit or Client no-show only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_guard_shift_cancel() FROM PUBLIC, anon, authenticated;

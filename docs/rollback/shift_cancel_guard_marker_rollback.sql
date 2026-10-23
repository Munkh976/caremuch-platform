-- Rollback of 20261031190100_shift_cancel_guard_marker.sql: cp_guard_shift_cancel back to the body pushed in
-- 20261031190000 (byte-identical; proven by tests/ripple/pglite/shift-cancel-guard.cjs RB2 against the DEV md5).
CREATE OR REPLACE FUNCTION public.cp_guard_shift_cancel()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_marked boolean := COALESCE(current_setting('caremuch.assignment_ctx', true), '') = '1';
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

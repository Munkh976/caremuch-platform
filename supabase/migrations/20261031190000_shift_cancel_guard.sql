-- 3b (owner, Oct 23): a visit is cancelled (or recorded as a client no-show) only through the two actions, which require a
-- reason and write the audit record (cancel_visit, record_client_no_show; 20261031170000). A direct INSERT / UPDATE —
-- from the app, an Edge Function, the API or a script — that
--   * sets a shift to cancelled (or inserts one already cancelled),
--   * moves a cancelled shift back to another status, or
--   * writes the cancellation record (visit_outcome, cancel_reason_*, cancel_requested_by, cancelled_by / _at, late_cancel)
-- is refused. The actions mark their own updates with the transaction-local setting caremuch.assignment_ctx = '1' (they
-- already do, as the assignment functions); with the mark, a cancellation must still carry its outcome. Deleting a shift,
-- and every other update (times, notes, assignments syncing caregiver_id) are unchanged.
-- Additive: one trigger function (no API role) and one trigger. The two actions and every existing function are unchanged.
CREATE FUNCTION public.cp_guard_shift_cancel()
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
REVOKE ALL ON FUNCTION public.cp_guard_shift_cancel() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cp_guard_shift_cancel BEFORE INSERT OR UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.cp_guard_shift_cancel();

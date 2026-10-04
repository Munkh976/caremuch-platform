-- M-CP-05 — derived units: progress_notes.units_used / arrived_late and
-- service_authorizations.units_available. One write path each; no writer can set them.
-- Ripple care-plan module, Phase A. Schema plan §6 (after M-CP-03). DRAFT FOR REVIEW. Not pushed.
--
-- Rules (arch §9.1, Bren Oct 1; owner decision Q9):
--   * Late = client_arrived_at more than 5 minutes after scheduled_start. A late visit loses its
--     FIRST 15-minute unit only: units_used = units_scheduled - 1 (4 -> 3), never below 0.
--   * A non-billable note bills 0 units.
--   * units_available = units_authorized - SUM(units_used) of billable, non-voided notes.
--     Voiding a note or flipping it non-billable restores units through the same path; no
--     separate "credit" logic. A note moved between authorizations recalculates both.
-- How "cannot be set" is enforced: both BEFORE triggers overwrite the derived columns on every
-- INSERT/UPDATE, whatever value a writer sent (service role and Phase B RPCs included).
-- units_claimed / units_paid are funder-reported figures (EDI later) and are NOT derived.
-- Trigger functions: REVOKE ALL FROM PUBLIC, anon, authenticated; no GRANT (not needed to fire).

-- 1. Note units (no table reads, so SECURITY INVOKER).
CREATE FUNCTION public.cp_derive_progress_note_units()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.arrived_late := COALESCE(
    NEW.client_arrived_at > NEW.scheduled_start + interval '5 minutes', false);
  NEW.units_used := CASE
    WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0
    ELSE GREATEST(NEW.units_scheduled - CASE WHEN NEW.arrived_late THEN 1 ELSE 0 END, 0)
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_derive_progress_note_units() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cp_derive_note_units
BEFORE INSERT OR UPDATE ON public.progress_notes
FOR EACH ROW EXECUTE FUNCTION public.cp_derive_progress_note_units();

-- 2. Authorization units (reads every note of the authorization regardless of the caller's RLS).
CREATE FUNCTION public.cp_derive_authorization_units()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.units_available := NEW.units_authorized - COALESCE((
    SELECT SUM(n.units_used) FROM public.progress_notes n
    WHERE n.authorization_id = NEW.id AND n.billable AND NOT n.voided), 0);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cp_derive_authorization_units() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cp_derive_authorization_units
BEFORE INSERT OR UPDATE ON public.service_authorizations
FOR EACH ROW EXECUTE FUNCTION public.cp_derive_authorization_units();

-- 3. A note change re-derives its authorization(s): a no-op UPDATE fires trigger 2.
CREATE FUNCTION public.cp_refresh_authorization_units()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public.service_authorizations SET units_authorized = units_authorized WHERE id = OLD.authorization_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND (TG_OP = 'INSERT' OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id) THEN
    UPDATE public.service_authorizations SET units_authorized = units_authorized WHERE id = NEW.authorization_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cp_refresh_authorization_units() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cp_refresh_units_ins_del
AFTER INSERT OR DELETE ON public.progress_notes
FOR EACH ROW EXECUTE FUNCTION public.cp_refresh_authorization_units();

CREATE TRIGGER trg_cp_refresh_units_upd
AFTER UPDATE ON public.progress_notes
FOR EACH ROW
WHEN (OLD.authorization_id IS DISTINCT FROM NEW.authorization_id
      OR OLD.units_used IS DISTINCT FROM NEW.units_used
      OR OLD.billable IS DISTINCT FROM NEW.billable
      OR OLD.voided IS DISTINCT FROM NEW.voided)
EXECUTE FUNCTION public.cp_refresh_authorization_units();

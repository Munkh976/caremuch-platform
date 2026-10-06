-- Rollback of 20261020120000_late_arrival_no_grace.sql: restores cp_derive_progress_note_units exactly as
-- 20261006120500_mcp05_units_triggers.sql created it (the 5-minute threshold, derived on every write).
-- Same signature; the ACL is untouched by CREATE OR REPLACE. Notes written meanwhile keep their stored units
-- until their next update, when the old rule re-derives them.
BEGIN;
CREATE OR REPLACE FUNCTION public.cp_derive_progress_note_units()
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
COMMIT;

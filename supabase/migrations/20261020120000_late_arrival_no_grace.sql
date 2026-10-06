-- Late arrival: no grace period (owner-approved change, Oct 6; Ripple open question 4 pending).
-- Ripple's "5 mins late means we lose the full 15 min" answered our 5-minute example only; there was never
-- a grace period. Until Ripple gives the full rule (1-4 minutes late, longer delays, early departure), ANY
-- arrival after the scheduled start loses the first 15-minute unit.
--
-- The rule lives in the units trigger function cp_derive_progress_note_units (submit_progress_note does
-- not compute lateness; its late_submitted flag is about the deadline and is unchanged). Changed:
--   * late = date_trunc('minute', client_arrived_at) > scheduled_start: minute precision, so 09:00:59 is on
--     time and 09:01 is late (client_arrived_at is timestamptz; the caregiver enters HH:MM);
--   * no backfill: the trigger fires on every UPDATE, so the flag is derived only on INSERT and while the
--     note is the caregiver's (OLD.status draft / returned, which includes the submit transition).
--     Submitted, reviewed and billed notes keep the flag they were submitted with, whatever a writer sends
--     (the derived columns stay unsettable); units_used is derived exactly as before.
-- Same signature, SECURITY INVOKER, search_path, ACL (no API role). Nothing else changes: no other
-- function, trigger, policy or CHECK; no data update.

CREATE OR REPLACE FUNCTION public.cp_derive_progress_note_units()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IN ('draft', 'returned') THEN
    NEW.arrived_late := COALESCE(date_trunc('minute', NEW.client_arrived_at) > NEW.scheduled_start, false);
  ELSE
    NEW.arrived_late := OLD.arrived_late;          -- submitted / reviewed / billed: as submitted (no backfill)
  END IF;
  NEW.units_used := CASE
    WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0
    ELSE GREATEST(NEW.units_scheduled - CASE WHEN NEW.arrived_late THEN 1 ELSE 0 END, 0)
  END;
  RETURN NEW;
END $$;

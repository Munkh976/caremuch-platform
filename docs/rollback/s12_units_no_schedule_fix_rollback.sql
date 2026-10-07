-- Rollback of 20261025120100_s12_units_no_schedule_fix.sql: restores the S12 body as pushed (20261025120000).

CREATE OR REPLACE FUNCTION public.cp_derive_progress_note_units()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_blocks numeric;
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IN ('draft', 'returned') THEN
    -- the caregiver's note (incl. the submit transition): an end time is required to submit
    IF TG_OP = 'UPDATE' AND NEW.status = 'submitted' AND NEW.actual_end IS NULL THEN
      RAISE EXCEPTION 'Enter the client''s end time before submitting the note' USING ERRCODE = '22023';
    END IF;
    NEW.arrived_late := COALESCE(date_trunc('minute', NEW.client_arrived_at) > NEW.scheduled_start, false);
    -- S12 (Ripple, Oct 6): bill only the shift's scheduled 15-minute blocks (start, start+15, ...) that lie completely
    -- inside [arrival, end], minute precision; arrival at/before the start counts as the start, end at/after the
    -- scheduled end as the end; never more than units_scheduled. No grace period, no other rule.
    v_from := GREATEST(COALESCE(date_trunc('minute', NEW.client_arrived_at), NEW.scheduled_start), NEW.scheduled_start);
    v_to := LEAST(COALESCE(date_trunc('minute', NEW.actual_end), NEW.scheduled_end), NEW.scheduled_end);
    v_blocks := GREATEST(floor(extract(epoch FROM (v_to - NEW.scheduled_start)) / 900)
                       - ceil(extract(epoch FROM (v_from - NEW.scheduled_start)) / 900), 0);
    NEW.units_used := CASE WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0 ELSE LEAST(v_blocks, NEW.units_scheduled) END;
  ELSE
    -- submitted / reviewed / billed: the units and the flag stay as submitted (no backfill)
    NEW.arrived_late := OLD.arrived_late;
    NEW.units_used := CASE
      WHEN NOT NEW.billable OR NEW.units_scheduled IS NULL THEN 0
      WHEN OLD.billable AND OLD.units_scheduled IS NOT NULL THEN OLD.units_used
      ELSE GREATEST(NEW.units_scheduled - CASE WHEN NEW.arrived_late THEN 1 ELSE 0 END, 0)
    END;
  END IF;
  RETURN NEW;
END $$;

-- Seeds realistic time_entries for the 8 completed demo shifts under agency
-- 56fbfe38, per the confirmed investigation
-- (20260909032000_investigate_completed_shifts_for_time_entries.sql): each
-- completed shift has exactly one non-cancelled assignment and zero existing
-- time_entries. All 8 are scheduled 09:00-13:00 (4.0h).
--
-- Deliberately NOT flat 100%: clock-in/out times vary a few minutes around
-- the scheduled window per shift (a caregiver arriving a bit early/late,
-- leaving a bit early/late), landing most shifts at ~95-103% of scheduled
-- and one (Michael Gonzalez, 2026-09-03) at a deliberately lower 87.5% to
-- avoid a synthetic-looking, uniform result. Overall fulfillment lands at
-- ~98%, in the "high 90s, not flat 100" range requested.
--
-- hours_worked is NOT set directly -- public.time_entry_normalize() (BEFORE
-- INSERT trigger) derives it from ended_at - started_at - break_minutes, and
-- also derives caregiver_id/shift_id/agency_id from shift_assignment_id, so
-- only shift_assignment_id + the clock times need to be provided.
--
-- status = 'approved', voided_at left NULL -- the two conditions
-- hoursDelivered.ts's isCountableTimeEntry() requires to count a row into
-- actualHours. is_demo = true, consistent with every other demo row.
DO $$
DECLARE
  v_agency_id uuid;
  v_already   int;
BEGIN
  SELECT id INTO v_agency_id FROM public.agency WHERE id::text LIKE '56fbfe38%';
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'CareMuch Agency (56fbfe38...) not found -- aborting.';
  END IF;

  SELECT count(*) INTO v_already
  FROM public.time_entries
  WHERE shift_assignment_id IN (
    '071352cc-cc3d-4905-8e87-ec52a1eeb5cd', '0422d442-f9a7-48d5-bbb7-d6bb04c7c002',
    '5d0703c1-3e47-4890-bd35-bbc0088b8512', 'f3e12ee4-d1f9-4e51-a250-8bb83968e539',
    '6c5ac5b2-ea3f-4785-83d2-cec67cfa27f1', '11ec4321-4341-4e84-892d-eb9783dbbecb',
    'dfcbcbf6-dd81-41d2-89af-5fcf398f8dfa', '0befe6d6-7c40-485d-8040-7e96908fe15e'
  );
  IF v_already > 0 THEN
    RAISE NOTICE 'Time entries already exist for one or more of these assignments (% found) -- skipping to avoid duplicates.', v_already;
    RETURN;
  END IF;

  INSERT INTO public.time_entries (shift_assignment_id, started_at, ended_at, status, source, is_demo)
  VALUES
    -- Nancy Young, 2026-07-31: 08:58-13:02 -> 4.0667h (101.7% of 4h)
    ('071352cc-cc3d-4905-8e87-ec52a1eeb5cd', '2026-07-31T08:58:00', '2026-07-31T13:02:00', 'approved', 'clock', true),
    -- David Jackson, 2026-08-10: 09:03-13:00 -> 3.95h (98.75%)
    ('0422d442-f9a7-48d5-bbb7-d6bb04c7c002', '2026-08-10T09:03:00', '2026-08-10T13:00:00', 'approved', 'clock', true),
    -- Nancy Young, 2026-08-20: 09:00-12:55 -> 3.9167h (97.9%)
    ('5d0703c1-3e47-4890-bd35-bbc0088b8512', '2026-08-20T09:00:00', '2026-08-20T12:55:00', 'approved', 'clock', true),
    -- David Jackson, 2026-09-02: 09:05-13:05 -> 4.0h (100%)
    ('f3e12ee4-d1f9-4e51-a250-8bb83968e539', '2026-09-02T09:05:00', '2026-09-02T13:05:00', 'approved', 'clock', true),
    -- Michael Gonzalez, 2026-09-03: 09:10-12:40 -> 3.5h (87.5%, the deliberate outlier)
    ('6c5ac5b2-ea3f-4785-83d2-cec67cfa27f1', '2026-09-03T09:10:00', '2026-09-03T12:40:00', 'approved', 'clock', true),
    -- Michael Gonzalez, 2026-09-04: 08:55-13:00 -> 4.0833h (102.1%)
    ('11ec4321-4341-4e84-892d-eb9783dbbecb', '2026-09-04T08:55:00', '2026-09-04T13:00:00', 'approved', 'clock', true),
    -- Robert Miller, 2026-09-06: 09:00-12:50 -> 3.8333h (95.8%)
    ('dfcbcbf6-dd81-41d2-89af-5fcf398f8dfa', '2026-09-06T09:00:00', '2026-09-06T12:50:00', 'approved', 'clock', true),
    -- Robert Miller, 2026-09-07: 09:02-13:08 -> 4.1h (102.5%)
    ('0befe6d6-7c40-485d-8040-7e96908fe15e', '2026-09-07T09:02:00', '2026-09-07T13:08:00', 'approved', 'clock', true);

  RAISE NOTICE 'Inserted % time_entries for the 8 completed demo shifts.', (SELECT count(*) FROM public.time_entries WHERE is_demo = true AND agency_id = v_agency_id);
END $$;

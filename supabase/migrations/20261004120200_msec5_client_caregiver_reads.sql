-- M-SEC-5 — client reads of caregivers only through display-safe RPCs
-- (docs/security-fixes-2026-10-plan.md §7 Q3, §12). DRAFT FOR REVIEW. Not pushed.
--
-- Problem (E1 §6.3): a client login reads EVERY caregiver row in its agency through
-- "Clients view caregivers (agency scope) 20251106" (email, phone, address, hourly_rate,
-- emergency contacts, ...) and every caregiver's availability through
-- "Clients view caregiver availability (agency scope) 20251106". The client portal uses them in four
-- places: CareTeam, CareCircle, MySchedule (shift -> caregiver embed) and the OrdersManagement
-- "request a caregiver" picker (which even priced the booking with the caregiver's PAY rate).
--
-- Fix: drop both client policies; serve the portal through two SECURITY DEFINER functions that
-- scope to the caller's own client record(s) (clients.user_id = auth.uid()) and return only
-- display-safe columns: first name, last initial, employment role label, care-type codes, and the
-- aggregate rating already shown today. NEVER: email, phone, address, zip codes, pay rate,
-- emergency contacts, user_id, notes. (caregivers has no photo column, so none is returned.)
--
--   get_my_care_team()                -> caregivers on the caller's shifts in a bounded window,
--                                        plus the client's preferred caregiver.
--   get_bookable_caregivers(_day int) -> the booking picker: active caregivers of the client's
--                                        agency (and office, if the client has one) who list the
--                                        client's zip code and have availability on that weekday,
--                                        with that day's time windows only.
--
-- CLAUDE.md #13: both names are new (verified absent in pg_proc). CLAUDE.md #14: SECURITY DEFINER,
-- fixed search_path, auth.uid() scoping inside, REVOKE ALL FROM PUBLIC, anon, GRANT to
-- authenticated only; verify with aclexplode after push. LANGUAGE sql: all columns already exist.
--
-- Window for get_my_care_team (owner to confirm): shifts dated from CURRENT_DATE - 180 days to
-- CURRENT_DATE + 90 days. CareTeam/CareCircle show the client's current and recent caregivers;
-- MySchedule lists the client's shifts and names their caregiver — shifts outside the window
-- show "Caregiver assigned" without a name.

-- ---------------------------------------------------------------------------------------------
-- 1. get_my_care_team()
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_my_care_team()
RETURNS TABLE (
  caregiver_id uuid,
  first_name text,
  last_initial text,
  employment_role text,
  care_type_codes text[],
  avg_rating numeric,
  rating_count bigint,
  shift_count bigint,
  last_shift_date date,
  next_shift_date date,
  is_preferred boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH my_clients AS (
    SELECT cl.id, cl.agency_id, cl.preferred_caregiver_id
    FROM public.clients cl
    WHERE cl.user_id = auth.uid()
  ),
  on_shifts AS (
    SELECT sa.caregiver_id,
           count(*)                                                AS shift_count,
           max(s.shift_date) FILTER (WHERE s.shift_date <  CURRENT_DATE) AS last_shift_date,
           min(s.shift_date) FILTER (WHERE s.shift_date >= CURRENT_DATE) AS next_shift_date
    FROM public.shift_assignments sa
    JOIN public.shifts s ON s.id = sa.shift_id
    JOIN my_clients mc ON mc.id = s.client_id
    WHERE sa.status <> 'cancelled'
      AND s.shift_date BETWEEN CURRENT_DATE - 180 AND CURRENT_DATE + 90
    GROUP BY sa.caregiver_id
  ),
  team AS (
    SELECT caregiver_id FROM on_shifts
    UNION
    SELECT mc.preferred_caregiver_id FROM my_clients mc WHERE mc.preferred_caregiver_id IS NOT NULL
  )
  SELECT c.id,
         c.first_name,
         left(c.last_name, 1),
         c.role::text,
         ARRAY(SELECT k.care_type_code FROM public.caregiver_skills k WHERE k.caregiver_id = c.id ORDER BY 1),
         (SELECT round(avg(r.rating), 2) FROM public.shift_ratings r WHERE r.caregiver_id = c.id),
         (SELECT count(*) FROM public.shift_ratings r WHERE r.caregiver_id = c.id),
         COALESCE(os.shift_count, 0),
         os.last_shift_date,
         os.next_shift_date,
         EXISTS (SELECT 1 FROM my_clients mc WHERE mc.preferred_caregiver_id = c.id)
  FROM team t
  JOIN public.caregivers c ON c.id = t.caregiver_id
  LEFT JOIN on_shifts os ON os.caregiver_id = c.id
  -- the caregiver must belong to the same agency as one of the caller's client records
  WHERE c.agency_id IN (SELECT mc.agency_id FROM my_clients mc)
  ORDER BY COALESCE(os.shift_count, 0) DESC, c.first_name
$$;
REVOKE ALL ON FUNCTION public.get_my_care_team() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_care_team() TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. get_bookable_caregivers(_day_of_week int)  (0 = Sunday .. 6 = Saturday, as caregiver_availability)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.get_bookable_caregivers(_day_of_week integer)
RETURNS TABLE (
  caregiver_id uuid,
  first_name text,
  last_initial text,
  care_type_codes text[],
  avg_rating numeric,
  rating_count bigint,
  day_windows jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH my_clients AS (
    SELECT cl.agency_id, cl.virtual_office_id, cl.zip_code
    FROM public.clients cl
    WHERE cl.user_id = auth.uid()
  )
  SELECT c.id,
         c.first_name,
         left(c.last_name, 1),
         ARRAY(SELECT k.care_type_code FROM public.caregiver_skills k WHERE k.caregiver_id = c.id ORDER BY 1),
         (SELECT round(avg(r.rating), 2) FROM public.shift_ratings r WHERE r.caregiver_id = c.id),
         (SELECT count(*) FROM public.shift_ratings r WHERE r.caregiver_id = c.id),
         (SELECT jsonb_agg(jsonb_build_object('start_time', a.start_time, 'end_time', a.end_time) ORDER BY a.start_time)
            FROM public.caregiver_availability a
           WHERE a.caregiver_id = c.id AND a.day_of_week = _day_of_week AND a.is_available)
  FROM public.caregivers c
  -- Guard (owner, Oct 4): a day outside 0-6 returns an EMPTY set — no exception, no error text.
  WHERE _day_of_week BETWEEN 0 AND 6
    -- active caregivers only (owner, Oct 4)
    AND c.is_active
    AND EXISTS (
      SELECT 1 FROM my_clients mc
      WHERE mc.agency_id = c.agency_id
        AND (mc.virtual_office_id IS NULL OR c.virtual_office_id = mc.virtual_office_id)
        AND mc.zip_code = ANY (c.service_zipcodes)
    )
    AND EXISTS (
      SELECT 1 FROM public.caregiver_availability a
      WHERE a.caregiver_id = c.id AND a.day_of_week = _day_of_week AND a.is_available
    )
  ORDER BY c.first_name
$$;
REVOKE ALL ON FUNCTION public.get_bookable_caregivers(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bookable_caregivers(integer) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Drop the two broad client read policies (all four client screens now use the RPCs above).
--    After this, caregiver_performance (security_invoker) returns nothing to a client; the
--    client screens take their ratings from the RPCs instead.
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Clients view caregivers (agency scope) 20251106" ON public.caregivers;
DROP POLICY IF EXISTS "Clients view caregiver availability (agency scope) 20251106" ON public.caregiver_availability;

-- ---------------------------------------------------------------------------------------------
-- Post-push verification:
--   aclexplode on get_my_care_team / get_bookable_caregivers -> postgres, authenticated,
--     service_role; NO PUBLIC / anon.
--   pg_policies: no policy left on caregivers / caregiver_availability that admits a client role.
-- ---------------------------------------------------------------------------------------------

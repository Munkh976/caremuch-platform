-- M-SEC-3 — get_my_trade_requests() (docs/security-fixes-2026-10-plan.md §11/§12). DRAFT FOR REVIEW.
--
-- Why: after M-SEC-1 a caregiver can read only its OWN caregivers row, so "My trade requests"
-- (AvailableShifts -> fetchMyTradeRequests) can no longer embed new_caregiver(first_name,last_name)
-- and the taker's name would silently become NULL. The embedded shifts(...) also already went NULL
-- once an accepted trade moved the shift to the new caregiver (is_my_assigned_shift() false).
--
-- What: one SECURITY DEFINER read that returns ONLY the caller's own outgoing trades
-- (original_caregiver_id = a caregivers row whose user_id = auth.uid()), with display fields only:
--   - the other caregiver's first name + last initial, and only once the trade is 'accepted'
--     (the only state in which AvailableShifts.tsx:478 shows a name);
--   - the shift's date/time/title.
-- No email, phone, rate, or any other caregiver/client column.
--
-- CLAUDE.md #13: new function, no prior overload (verified: no get_my_trade_requests in pg_proc).
-- CLAUDE.md #14: SECURITY DEFINER + fixed search_path; REVOKE ALL FROM PUBLIC, anon; GRANT to
-- authenticated only; verify with aclexplode after push. LANGUAGE sql: every referenced column
-- already exists (shift_trades/caregivers/shifts), so create-time validation passes.

CREATE FUNCTION public.get_my_trade_requests()
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  status text,
  reason text,
  created_at timestamptz,
  resolved_at timestamptz,
  new_caregiver_first_name text,
  new_caregiver_last_initial text,
  shift_date date,
  start_time time,
  end_time time,
  order_title text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id,
         t.shift_id,
         t.status::text,
         t.reason,
         t.created_at,
         t.resolved_at,
         CASE WHEN t.status = 'accepted' THEN nc.first_name END,
         CASE WHEN t.status = 'accepted' THEN left(nc.last_name, 1) END,
         s.shift_date,
         s.start_time,
         s.end_time,
         s.order_title
  FROM public.shift_trades t
  LEFT JOIN public.caregivers nc ON nc.id = t.new_caregiver_id
  LEFT JOIN public.shifts s ON s.id = t.shift_id
  WHERE t.original_caregiver_id IN (SELECT c.id FROM public.caregivers c WHERE c.user_id = auth.uid())
  ORDER BY t.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.get_my_trade_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_trade_requests() TO authenticated;

-- Post-push verification:
--   SELECT coalesce(a.grantee::regrole::text,'PUBLIC'), a.privilege_type
--     FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
--    WHERE p.proname = 'get_my_trade_requests';
--   -> postgres, authenticated, service_role (Supabase default); NO PUBLIC / anon.

-- Follow-up to 20260915215024: check_assignment_eligibility_bulk was created with only
-- a GRANT to authenticated, which left it holding Supabase's default PUBLIC/anon EXECUTE
-- grant (confirmed live via aclexplode immediately after the prior migration -- anon had
-- EXECUTE, unlike the single-candidate check_assignment_eligibility, which has always had
-- anon explicitly revoked, see 20260821045810/20260821045557). This is a SECURITY DEFINER
-- function that bypasses RLS, so an anon-callable bulk version would have let an
-- unauthenticated caller read eligibility detail (weekly hours, hard/soft block reasons)
-- for any shift/caregiver id pair. Applying the same REVOKE-then-GRANT pattern used
-- everywhere else in this codebase for RLS-bypassing RPCs.
REVOKE ALL ON FUNCTION public.check_assignment_eligibility_bulk(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_assignment_eligibility_bulk(uuid, uuid[]) TO authenticated;

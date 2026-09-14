-- Fix-up for 20260914005540_m_office_scoping.sql. Two distinct problems, both from
-- the same root cause: CREATE OR REPLACE FUNCTION does NOT replace a function when
-- a new trailing parameter is added -- it creates a brand-new, separately-privileged
-- function object (new oid) alongside the original.
--
-- 1. DUPLICATE OVERLOADS: match_agency_knowledge and search_agency_knowledge each
--    ended up with TWO live versions (old, without _virtual_office_id, and new,
--    with it) instead of one updated version -- not the reviewed/approved design,
--    and a duplicate-system smell (CLAUDE.md). Dropped below. Existing callers
--    (e.g. rag-eval-harness) that don't pass _virtual_office_id are unaffected --
--    the remaining function's _virtual_office_id defaults to NULL, identical to the
--    old behavior (agency-wide, no office filtering) for anyone who doesn't pass it.
--
-- 2. SECURITY REGRESSION (the more serious one): because the new 7-arg overloads
--    are new function objects, they did NOT inherit the anon/authenticated EXECUTE
--    revocation that Tranche 3A (20260905090000_establish_surface_boundary.sql)
--    deliberately applied to the old ones -- confirmed live via aclexplode(proacl):
--    the new overloads had EXECUTE granted to anon AND authenticated by default,
--    meaning any anonymous client could call either function directly, bypassing
--    search-knowledge's PHI guard entirely (the exact bypass Tranche 3A's own Step 0
--    empirically proved and closed). Re-applying the identical REVOKE below.

DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc
  WHERE proname = 'match_agency_knowledge' AND pronamespace = 'public'::regnamespace
    AND pg_get_function_identity_arguments(oid) =
      '_query_embedding vector, _language text, _limit integer, _match_threshold real, _agency_id uuid, _surfaces text[]';
  IF v_oid IS NOT NULL THEN
    EXECUTE format('DROP FUNCTION public.match_agency_knowledge(%s)', pg_get_function_identity_arguments(v_oid));
  END IF;
END $$;

DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc
  WHERE proname = 'search_agency_knowledge' AND pronamespace = 'public'::regnamespace
    AND pg_get_function_identity_arguments(oid) =
      '_query text, _language text, _limit integer, _agency_id uuid, _surfaces text[]';
  IF v_oid IS NOT NULL THEN
    EXECUTE format('DROP FUNCTION public.search_agency_knowledge(%s)', pg_get_function_identity_arguments(v_oid));
  END IF;
END $$;

-- Re-apply the Tranche 3A anon/authenticated EXECUTE revocation to the surviving
-- (new, office-aware) overloads -- identical statements to
-- 20260905090000_establish_surface_boundary.sql, just with the extra trailing
-- uuid parameter reflected in the signature.
REVOKE ALL ON FUNCTION public.match_agency_knowledge(extensions.vector, text, integer, real, uuid, text[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_agency_knowledge(text, text, integer, uuid, text[], uuid) FROM PUBLIC, anon, authenticated;

-- Second fix-up: 20260914012746's DROP for the old match_agency_knowledge overload
-- silently no-op'd. Root cause: its DO block matched on the exact string returned
-- by pg_get_function_identity_arguments(oid), which renders the `vector` type
-- schema-qualified (`extensions.vector`) or unqualified (`vector`) depending on the
-- CALLING session's search_path at render time -- supabase db push's session does
-- not have `extensions` in its search_path, so the rendered string never matched the
-- hardcoded unqualified literal, and the guarded IF silently skipped the DROP with
-- no error (search_agency_knowledge's DROP had no vector-typed parameter, so it
-- wasn't affected by this and succeeded correctly).
--
-- Fixed by identifying the stale overload structurally (argument count = 6, i.e.
-- lacking the new _virtual_office_id parameter) instead of by rendered type-name
-- string, which sidesteps search_path-dependent rendering entirely.
DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT oid INTO v_oid FROM pg_proc
  WHERE proname = 'match_agency_knowledge' AND pronamespace = 'public'::regnamespace
    AND pronargs = 6;
  IF v_oid IS NOT NULL THEN
    EXECUTE format('DROP FUNCTION public.match_agency_knowledge(%s)', pg_get_function_identity_arguments(v_oid));
  END IF;
END $$;

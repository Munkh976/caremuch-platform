-- M-Office: virtual-office scoping mechanism + fixes for the confirmed gaps in
-- docs/m-office-scoping-plan.md. Fail-closed nested-tenancy design (§2): a Tier-3
-- (office-restricted) user's office is never inferred from NULL -- it requires an
-- explicit, DB-enforced marker (office_restricted) plus a CHECK constraint that
-- makes "office-restricted with no office" an unrepresentable state.
--
-- Deliberately NOT in this migration (see plan §1/§7): virtual_office_id columns on
-- shifts/shift_assignments/client_orders/order_services/time_entries/
-- time_off_requests/caregiver_availability/etc. -- sequenced as a later phase once
-- this mechanism is proven. conversation_flows/flow_nodes/flow_options -- M2's own
-- scoped phase. Secondary tables (pending_notifications/earnings_lines/
-- shift_ratings/events) -- confirmed agency-wide-for-now per plan §6.

-- =============================================================================
-- 1. The mechanism: profiles.virtual_office_id + office_restricted, fail-closed
-- =============================================================================
ALTER TABLE public.profiles
  ADD COLUMN virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  ADD COLUMN office_restricted boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_office_restricted_requires_office
  CHECK (NOT office_restricted OR virtual_office_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.current_virtual_office_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE WHEN office_restricted THEN virtual_office_id ELSE NULL END
  FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_office_restricted(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(office_restricted, false) FROM public.profiles WHERE id = _user_id
$$;

-- =============================================================================
-- 2. RLS: add the office-composition clause to every table that already has
--    virtual_office_id but never checked it. Pattern throughout:
--    AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
-- =============================================================================

-- caregivers
DROP POLICY IF EXISTS "Agency users can manage their caregivers" ON public.caregivers;
CREATE POLICY "Agency users can manage their caregivers"
ON public.caregivers FOR ALL TO authenticated
USING (
  agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK (
  agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);

-- clients
DROP POLICY IF EXISTS "Admins and managers can manage clients" ON public.clients;
CREATE POLICY "Admins and managers can manage clients"
ON public.clients FOR ALL TO authenticated
USING (
  (agency_id IN (SELECT profiles.agency_id FROM public.profiles WHERE profiles.id = auth.uid()))
  AND (has_role(auth.uid(), 'system_admin') OR has_role(auth.uid(), 'agency_admin') OR has_role(auth.uid(), 'manager'))
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);

DROP POLICY IF EXISTS "Staff can view clients" ON public.clients;
CREATE POLICY "Staff can view clients"
ON public.clients FOR SELECT TO authenticated
USING (
  (agency_id IN (SELECT profiles.agency_id FROM public.profiles WHERE profiles.id = auth.uid()))
  AND (has_role(auth.uid(), 'system_admin') OR has_role(auth.uid(), 'agency_admin') OR has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'scheduler') OR has_role(auth.uid(), 'hr_staff'))
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
);

-- families (staff-management branches only; the client-self-read branch is untouched)
DROP POLICY IF EXISTS "families_delete_staff" ON public.families;
CREATE POLICY "families_delete_staff"
ON public.families FOR DELETE TO authenticated
USING (
  (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
   AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
  OR has_role(auth.uid(), 'system_admin')
);

DROP POLICY IF EXISTS "families_insert_staff" ON public.families;
CREATE POLICY "families_insert_staff"
ON public.families FOR INSERT TO authenticated
WITH CHECK (
  (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
   AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
  OR has_role(auth.uid(), 'system_admin')
);

DROP POLICY IF EXISTS "families_update_staff" ON public.families;
CREATE POLICY "families_update_staff"
ON public.families FOR UPDATE TO authenticated
USING (
  (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
   AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
  OR has_role(auth.uid(), 'system_admin')
)
WITH CHECK (
  (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
   AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
  OR has_role(auth.uid(), 'system_admin')
);

DROP POLICY IF EXISTS "families_select_agency_or_own" ON public.families;
CREATE POLICY "families_select_agency_or_own"
ON public.families FOR SELECT TO authenticated
USING (
  (agency_id = current_agency_id()
   AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
  OR has_role(auth.uid(), 'system_admin')
  OR (id IN (SELECT c.family_id FROM public.clients c WHERE c.id IN (SELECT my_client_ids()) AND c.family_id IS NOT NULL))
);

-- care_requests
DROP POLICY IF EXISTS "care_requests_delete" ON public.care_requests;
CREATE POLICY "care_requests_delete"
ON public.care_requests FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
);

DROP POLICY IF EXISTS "care_requests_insert" ON public.care_requests;
CREATE POLICY "care_requests_insert"
ON public.care_requests FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
);

DROP POLICY IF EXISTS "care_requests_update" ON public.care_requests;
CREATE POLICY "care_requests_update"
ON public.care_requests FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
)
WITH CHECK (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
);

DROP POLICY IF EXISTS "care_requests_select" ON public.care_requests;
CREATE POLICY "care_requests_select"
ON public.care_requests FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin')
  OR (agency_id = current_agency_id()
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
  OR (client_id IN (SELECT my_client_ids()))
  OR (family_id IN (SELECT c.family_id FROM public.clients c WHERE c.id IN (SELECT my_client_ids()) AND c.family_id IS NOT NULL))
);

-- care_request_time_windows
DROP POLICY IF EXISTS "crtw_delete" ON public.care_request_time_windows;
CREATE POLICY "crtw_delete"
ON public.care_request_time_windows FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
);

DROP POLICY IF EXISTS "crtw_insert" ON public.care_request_time_windows;
CREATE POLICY "crtw_insert"
ON public.care_request_time_windows FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
);

DROP POLICY IF EXISTS "crtw_select" ON public.care_request_time_windows;
CREATE POLICY "crtw_select"
ON public.care_request_time_windows FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
);

DROP POLICY IF EXISTS "crtw_update" ON public.care_request_time_windows;
CREATE POLICY "crtw_update"
ON public.care_request_time_windows FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
)
WITH CHECK (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()))
);

-- caregiver_registrations (M1 already closed the cross-tenant NULL-agency gap;
-- this adds the office composition on top of that same policy shape)
DROP POLICY IF EXISTS "Staff can view caregiver registrations" ON public.caregiver_registrations;
CREATE POLICY "Staff can view caregiver registrations"
ON public.caregiver_registrations FOR SELECT TO authenticated
USING (
  (has_role(auth.uid(),'system_admin') OR has_role(auth.uid(),'agency_admin')
   OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'hr_staff'))
  AND (
    has_role(auth.uid(),'system_admin')
    OR (
      agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
    )
  )
);

DROP POLICY IF EXISTS "Staff can update caregiver registrations" ON public.caregiver_registrations;
CREATE POLICY "Staff can update caregiver registrations"
ON public.caregiver_registrations FOR UPDATE TO authenticated
USING (
  (has_role(auth.uid(),'system_admin') OR has_role(auth.uid(),'agency_admin')
   OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'hr_staff'))
  AND (
    has_role(auth.uid(),'system_admin')
    OR (
      agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
    )
  )
)
WITH CHECK (
  (has_role(auth.uid(),'system_admin') OR has_role(auth.uid(),'agency_admin')
   OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'hr_staff'))
  AND (
    has_role(auth.uid(),'system_admin')
    OR (
      agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
      AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
    )
  )
);

-- virtual_office: manage policies gain the same composition (a Tier-3 user manages
-- only their own office row; INSERT of a brand-new office is naturally excluded the
-- same way M1's agency-INSERT restriction worked -- current_virtual_office_id() can
-- never equal a not-yet-existing row's freshly generated id). SELECT is unchanged
-- (already agency-wide, no role check at all today, non-sensitive branding data).
DROP POLICY IF EXISTS "vo_delete_staff" ON public.virtual_office;
CREATE POLICY "vo_delete_staff"
ON public.virtual_office FOR DELETE TO authenticated
USING (
  (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
   AND (NOT is_office_restricted(auth.uid()) OR id = current_virtual_office_id()))
  OR has_role(auth.uid(), 'system_admin')
);

DROP POLICY IF EXISTS "vo_insert_staff" ON public.virtual_office;
CREATE POLICY "vo_insert_staff"
ON public.virtual_office FOR INSERT TO authenticated
WITH CHECK (
  (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
   AND (NOT is_office_restricted(auth.uid()) OR id = current_virtual_office_id()))
  OR has_role(auth.uid(), 'system_admin')
);

DROP POLICY IF EXISTS "vo_update_staff" ON public.virtual_office;
CREATE POLICY "vo_update_staff"
ON public.virtual_office FOR UPDATE TO authenticated
USING (
  (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
   AND (NOT is_office_restricted(auth.uid()) OR id = current_virtual_office_id()))
  OR has_role(auth.uid(), 'system_admin')
)
WITH CHECK (
  (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()
   AND (NOT is_office_restricted(auth.uid()) OR id = current_virtual_office_id()))
  OR has_role(auth.uid(), 'system_admin')
);

-- =============================================================================
-- 3. Knowledge retrieval RPCs: add the office filter (closes the literal
--    Ripple/Kind Care contamination). NULL preserves today's agency-wide behavior
--    exactly -- zero risk to any caller that doesn't pass the new parameter.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.match_agency_knowledge(
  _query_embedding extensions.vector, _language text, _limit integer DEFAULT 5,
  _match_threshold real DEFAULT 0, _agency_id uuid DEFAULT NULL::uuid,
  _surfaces text[] DEFAULT NULL::text[], _virtual_office_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(document_id uuid, document_title text, chunk_id uuid, content text, similarity real)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF _language NOT IN ('en', 'es') THEN
    RAISE EXCEPTION 'Unsupported language: %', _language USING ERRCODE = '22023';
  END IF;

  IF _surfaces IS NULL OR array_length(_surfaces, 1) IS NULL
     OR NOT (_surfaces <@ ARRAY['public','caregiver']::text[]) THEN
    RAISE EXCEPTION 'Invalid surfaces: % -- must be a non-empty subset of {public,caregiver}, and callers must pass this explicitly (no default)', _surfaces
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT d.id, d.title, c.id, c.content,
         (1 - (c.embedding OPERATOR(extensions.<=>) _query_embedding))::real AS similarity
  FROM public.knowledge_chunks c
  JOIN public.knowledge_documents d ON d.id = c.document_id
  WHERE d.agency_id = COALESCE(_agency_id, public.my_agency_id())
    AND (_virtual_office_id IS NULL OR d.virtual_office_id = _virtual_office_id)
    AND d.is_active
    AND d.surface = ANY(_surfaces)
    AND c.language = _language
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding OPERATOR(extensions.<=>) _query_embedding)) >= _match_threshold
  ORDER BY c.embedding OPERATOR(extensions.<=>) _query_embedding ASC
  LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_agency_knowledge(
  _query text, _language text, _limit integer DEFAULT 5,
  _agency_id uuid DEFAULT NULL::uuid, _surfaces text[] DEFAULT NULL::text[],
  _virtual_office_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(document_id uuid, document_title text, chunk_id uuid, content text, rank real)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_config regconfig;
  v_lexemes text[];
  v_tsquery tsquery;
BEGIN
  IF _language NOT IN ('en', 'es') THEN
    RAISE EXCEPTION 'Unsupported language: %', _language USING ERRCODE = '22023';
  END IF;

  IF _surfaces IS NULL OR array_length(_surfaces, 1) IS NULL
     OR NOT (_surfaces <@ ARRAY['public','caregiver']::text[]) THEN
    RAISE EXCEPTION 'Invalid surfaces: % -- must be a non-empty subset of {public,caregiver}, and callers must pass this explicitly (no default)', _surfaces
      USING ERRCODE = '22023';
  END IF;

  v_config := CASE _language WHEN 'es' THEN 'spanish'::regconfig ELSE 'english'::regconfig END;

  v_lexemes := (
    SELECT array_agg(cleaned) FROM (
      SELECT regexp_replace(lex, '[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ_]', '', 'g') AS cleaned
      FROM unnest(tsvector_to_array(to_tsvector(v_config, _query))) AS lex
    ) s
    WHERE cleaned <> ''
  );

  IF v_lexemes IS NULL OR array_length(v_lexemes, 1) IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    v_tsquery := to_tsquery(v_config, array_to_string(v_lexemes, ' | '));
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  RETURN QUERY
  SELECT d.id, d.title, c.id, c.content,
         ts_rank(c.search_vector, v_tsquery) AS rank
  FROM public.knowledge_chunks c
  JOIN public.knowledge_documents d ON d.id = c.document_id
  WHERE d.agency_id = COALESCE(_agency_id, public.my_agency_id())
    AND (_virtual_office_id IS NULL OR d.virtual_office_id = _virtual_office_id)
    AND d.is_active
    AND d.surface = ANY(_surfaces)
    AND c.language = _language
    AND c.search_vector @@ v_tsquery
  ORDER BY rank DESC
  LIMIT _limit;
END;
$$;

-- =============================================================================
-- 4. flow_session_submit_intake: office fallback, same shape as its existing
--    agency-level fallback (falls back to the resolved agency's primary active
--    office instead of leaving virtual_office_id NULL).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.flow_session_submit_intake(
  p_session_id uuid, p_token text, p_name text, p_phone text, p_email text,
  p_preference text, p_total_score numeric DEFAULT 0, p_trait_scores jsonb DEFAULT '{}'::jsonb,
  p_agency_id uuid DEFAULT NULL::uuid, p_virtual_office_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_updated uuid;
  v_family_id uuid;
  v_already boolean := false;
  v_name text := NULLIF(btrim(p_name), '');
  v_agency_id uuid;
  v_virtual_office_id uuid := p_virtual_office_id;
BEGIN
  SELECT (s.status = 'submitted'::conversation_session_status),
         COALESCE(p_agency_id, s.agency_id, f.agency_id)
    INTO v_already, v_agency_id
  FROM public.conversation_sessions s
  JOIN public.conversation_flows f ON f.id = s.flow_id
  WHERE s.id = p_session_id AND s.session_token = p_token;

  -- Fall back to the only real agency when the flow is unscoped (legacy /assistant path)
  IF v_agency_id IS NULL OR v_agency_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    SELECT a.id INTO v_agency_id
    FROM public.agency a
    WHERE a.is_active AND a.id <> '00000000-0000-0000-0000-000000000000'::uuid
    LIMIT 1;
  END IF;

  -- Fall back to that agency's primary active office when no office was resolved
  -- (same legacy /assistant path -- reuses the already-existing is_primary flag
  -- rather than inventing new fallback semantics).
  IF v_virtual_office_id IS NULL AND v_agency_id IS NOT NULL THEN
    SELECT id INTO v_virtual_office_id
    FROM public.virtual_office
    WHERE agency_id = v_agency_id AND is_primary AND is_active
    LIMIT 1;
  END IF;

  UPDATE public.conversation_sessions
  SET status = 'submitted'::conversation_session_status,
      submitted_at = now(),
      completed_at = now(),
      current_node_id = NULL,
      total_score = p_total_score,
      trait_scores = p_trait_scores,
      client_name = v_name,
      client_phone = NULLIF(btrim(p_phone), ''),
      client_email = NULLIF(btrim(p_email), ''),
      contact_preference = NULLIF(btrim(p_preference), ''),
      contact_name = COALESCE(v_name, contact_name),
      contact_email = COALESCE(NULLIF(btrim(p_email), ''), contact_email),
      contact_phone = COALESCE(NULLIF(btrim(p_phone), ''), contact_phone),
      agency_id = COALESCE(p_agency_id, agency_id)
  WHERE id = p_session_id
    AND session_token = p_token
  RETURNING id INTO v_updated;

  IF v_updated IS NULL OR v_agency_id IS NULL OR COALESCE(v_already, false) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.care_requests WHERE session_id = p_session_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.families (agency_id, virtual_office_id, family_name, notes, is_demo)
  VALUES (
    v_agency_id,
    v_virtual_office_id,
    COALESCE(v_name, 'Website inquiry') || ' family',
    'Created from the public website intake assistant.',
    false
  )
  RETURNING id INTO v_family_id;

  INSERT INTO public.family_contacts (family_id, first_name, last_name, email, phone, is_primary, is_decision_maker, is_demo)
  VALUES (
    v_family_id,
    COALESCE(split_part(COALESCE(v_name, 'Website inquiry'), ' ', 1), 'Website'),
    COALESCE(NULLIF(btrim(substr(COALESCE(v_name, ''), length(split_part(COALESCE(v_name, ''), ' ', 1)) + 1)), ''), ''),
    NULLIF(btrim(p_email), ''),
    NULLIF(btrim(p_phone), ''),
    true,
    true,
    false
  );

  INSERT INTO public.care_requests (
    agency_id, virtual_office_id, family_id, session_id, status, source, priority, care_type_codes, notes, is_demo
  )
  VALUES (
    v_agency_id,
    v_virtual_office_id,
    v_family_id,
    p_session_id,
    'new'::care_request_status,
    CASE WHEN p_agency_id IS NULL THEN 'assistant_intake' ELSE 'public_site' END,
    'normal',
    ARRAY[]::text[],
    'Website intake. Preferred contact: ' || COALESCE(NULLIF(btrim(p_preference), ''), 'not set'),
    false
  );
END;
$$;

-- =============================================================================
-- 5. New RPC: submit_caregiver_registration -- replaces the 3 direct-insert
--    callers (ResultRegistration.tsx, CaregiverRegistration.tsx) with one
--    server-side path carrying the same agency+office fallback chain as
--    flow_session_submit_intake, instead of duplicating fallback logic 3x.
--    SECURITY DEFINER bypasses RLS on caregiver_registrations, so this function
--    re-implements the same validation the existing INSERT policy's WITH CHECK
--    already enforces (status/reviewed fields, published-agency check) -- the
--    existing RLS INSERT policy is left in place, unchanged, as a second path.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.submit_caregiver_registration(
  p_first_name text, p_last_name text, p_phone text, p_email text,
  p_care_type_codes text[] DEFAULT ARRAY[]::text[],
  p_hourly_rate numeric DEFAULT NULL,
  p_address text DEFAULT NULL, p_city text DEFAULT NULL,
  p_state text DEFAULT NULL, p_zip_code text DEFAULT NULL,
  p_employment_type text DEFAULT 'full_time',
  p_agency_id uuid DEFAULT NULL::uuid,
  p_virtual_office_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_agency_id uuid := p_agency_id;
  v_virtual_office_id uuid := p_virtual_office_id;
BEGIN
  IF v_agency_id IS NOT NULL AND NOT public.is_published_public_agency(v_agency_id) THEN
    RAISE EXCEPTION 'Invalid agency' USING ERRCODE = '22023';
  END IF;

  -- Same legacy-path fallback as flow_session_submit_intake: an unscoped submission
  -- (e.g. /caregiver-registration, which passes no agency at all) resolves to the
  -- one active real agency rather than staying NULL.
  IF v_agency_id IS NULL THEN
    SELECT a.id INTO v_agency_id
    FROM public.agency a
    WHERE a.is_active AND a.id <> '00000000-0000-0000-0000-000000000000'::uuid
    LIMIT 1;
  END IF;

  IF v_virtual_office_id IS NULL AND v_agency_id IS NOT NULL THEN
    SELECT id INTO v_virtual_office_id
    FROM public.virtual_office
    WHERE agency_id = v_agency_id AND is_primary AND is_active
    LIMIT 1;
  END IF;

  INSERT INTO public.caregiver_registrations (
    id, first_name, last_name, phone, email, care_type_codes, hourly_rate,
    address, city, state, zip_code, employment_type,
    status, agency_id, virtual_office_id
  ) VALUES (
    v_id, p_first_name, COALESCE(p_last_name, ''), p_phone, p_email,
    COALESCE(p_care_type_codes, ARRAY[]::text[]), p_hourly_rate,
    p_address, p_city, p_state, p_zip_code, COALESCE(p_employment_type, 'full_time'),
    'pending', v_agency_id, v_virtual_office_id
  );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_caregiver_registration TO anon, authenticated;

-- =============================================================================
-- 6. Backfill -- verified individually against live data (docs/m-office-scoping-plan.md
--    §4), not bulk-assumed. All target Ripple Effects (12faa863-017e-438c-966c-f67be9b726e7).
-- =============================================================================
UPDATE public.clients
SET virtual_office_id = '12faa863-017e-438c-966c-f67be9b726e7'
WHERE agency_id = '56fbfe38-e8eb-40c1-ba27-07428f62ed2e' AND virtual_office_id IS NULL;

UPDATE public.caregivers
SET virtual_office_id = '12faa863-017e-438c-966c-f67be9b726e7'
WHERE id = '74d6e08b-f4c7-408c-b8e3-1628e1583399' AND virtual_office_id IS NULL;

UPDATE public.families
SET virtual_office_id = '12faa863-017e-438c-966c-f67be9b726e7'
WHERE id = '5f2496dd-ab6e-4e1c-973d-31d4718d181e' AND virtual_office_id IS NULL;

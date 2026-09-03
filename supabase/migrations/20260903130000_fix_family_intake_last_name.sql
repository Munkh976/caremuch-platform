-- Fixes flow_session_submit_intake: a single-word name (e.g. "Maria", no space) made
-- last_name compute to NULL via NULLIF(...), violating family_contacts.last_name's
-- NOT NULL constraint and surfacing as "We could not send your request." with no
-- indication of the real cause. Confirmed via testing: a two-word "First Last" name
-- submits successfully; a one-word name fails.
--
-- Fix is the RPC falling back to '' instead of NULL, not loosening the constraint --
-- family_contacts.last_name NOT NULL is a deliberate, codebase-wide convention shared
-- by caregivers/clients/caregiver_registrations, and FamilyDialog.tsx's Contact
-- interface already types last_name as a guaranteed (non-null) string. The real fix --
-- separate first/last name fields on FamilyIntakeSurface's contact form, matching how
-- CaregiverRegistration.tsx avoids this problem entirely -- is a UI change deferred to
-- the planned redesign (see docs/known-issues.md). This is the minimal interim fix:
-- one COALESCE, no schema change, no ripple to any consumer.
--
-- Function-only CREATE OR REPLACE. Identical to the current body
-- (20260823221719_...sql) except the one wrapped expression below.

CREATE OR REPLACE FUNCTION public.flow_session_submit_intake(
  p_session_id uuid, p_token text, p_name text, p_phone text, p_email text, p_preference text,
  p_total_score numeric DEFAULT 0, p_trait_scores jsonb DEFAULT '{}'::jsonb,
  p_agency_id uuid DEFAULT NULL::uuid, p_virtual_office_id uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated uuid;
  v_family_id uuid;
  v_already boolean := false;
  v_name text := NULLIF(btrim(p_name), '');
  v_agency_id uuid;
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
    p_virtual_office_id,
    COALESCE(v_name, 'Website inquiry') || ' family',
    'Created from the public website intake assistant.',
    false
  )
  RETURNING id INTO v_family_id;

  INSERT INTO public.family_contacts (family_id, first_name, last_name, email, phone, is_primary, is_decision_maker, is_demo)
  VALUES (
    v_family_id,
    COALESCE(split_part(COALESCE(v_name, 'Website inquiry'), ' ', 1), 'Website'),
    -- Fixed: was NULLIF(...) alone, which is NULL for a single-word name and violates
    -- last_name's NOT NULL constraint. Outer COALESCE falls back to '' instead.
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
    p_virtual_office_id,
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
$function$;

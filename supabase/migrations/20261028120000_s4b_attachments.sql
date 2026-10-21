-- S4b — file attachments (design docs/design/s4b-file-attachments.md, owner approval Oct 21 with answers 1-7).
-- Additive: one table, one column, one bucket, storage policies, new functions, and the events CHECK (+3 values).
--
-- 1. events_event_type_check: ONE ALTER TABLE (drop + add, atomic). Keeps the 52 values of 20261026120000 exactly
--    and adds 'attachment_added', 'attachment_removed', 'attachment_viewed' (owner answer 2: views are audited too).
-- 2. client_documents.display_name (nullable): the custom name of an "other" intake document (doc_type 'other_<hex>').
-- 3. cp_attachments: one row per file. parent_kind client_document | inservice_form | training_form | credential |
--    care_plan (answer 5: S17 attaches the ISK IPOS PDF). Pending until the Edge Function has checked the stored
--    object (size + file signature) and the uploader completed it. Removal is soft (the object is kept, §6).
--    Read: RLS, the same tiers as the parent (client documents and plans: manager / agency_admin; in-service,
--    training and credentials: + hr_staff; credentials: also the caregiver for their own). No direct writes.
-- 4. Storage: private bucket 'cp-attachments' (20 MB, answer 1; PDF / JPEG / PNG / .docx; HEIC is converted to JPEG
--    on the device, answer 4, so it isn't accepted here). storage.objects: SELECT only when a readable active
--    cp_attachments row has that path; no INSERT / UPDATE / DELETE policy (uploads only through a signed upload URL
--    the Edge Function issues after begin_attachment_upload succeeded).
-- 5. Write RPCs (SECURITY DEFINER; REVOKE PUBLIC, anon; GRANT authenticated; rule 14):
--    begin_attachment_upload, complete_attachment_upload, remove_attachment, open_attachment (audits the view),
--    list_attachments (read), save_other_client_document (calls upsert_client_document unchanged, then sets the name).
--    Caregivers (answer 3): may upload to their own credential entry; the entry itself is not changed (dates and
--    is_verified stay HR's; the existing unverified rule is untouched). Their file shows "Waiting for HR" until HR or
--    a manager saves that credential after the upload (enter_caregiver_credential, unchanged).
-- 6. Service-role helpers for the Edge Function (no API-role EXECUTE): cp_attachment_mark_checked,
--    cp_attachment_discard, cp_attachment_stale_pending (answer 6: pending uploads older than 24 h are discarded).
-- Event payloads: ids, kind, MIME type and size only (never the display name or description). Paths are
-- '<agency>/<office|none>/<attachment id>': no names, no extension.
-- Unchanged: every existing function, trigger, policy and CHECK other than the events CHECK.

ALTER TABLE public.events
  DROP CONSTRAINT events_event_type_check,
  ADD CONSTRAINT events_event_type_check CHECK (event_type = ANY (ARRAY[
  'caregiver_application_received', 'caregiver_approved', 'caregiver_rejected',
  'care_request_received', 'care_request_converted_to_client',
  'shift_created', 'shift_assigned', 'shift_filled', 'shift_completed', 'shift_cancelled', 'shift_no_show',
  'caregiver_pickup', 'assignment_released', 'rating_added',
  'time_entry_submitted', 'time_entry_approved', 'earnings_computed',
  'account_link_issued',
  'care_plan_module_enabled', 'template_draft_saved', 'template_published', 'instance_template_upgraded',
  'care_plan_created', 'care_plan_renewed', 'care_plan_updated', 'training_version_bumped',
  'objective_measures_set', 'authorization_created', 'client_document_saved',
  'credential_entered', 'credential_overridden', 'inservice_signed', 'training_recorded',
  'training_record_overridden',
  'progress_note_created', 'progress_note_submitted', 'progress_note_returned', 'progress_note_reviewed',
  'progress_note_voided', 'billing_batch_built', 'billing_batch_approved', 'billing_batch_billed',
  'group_session_created', 'shift_group_session_set',
  -- UI round 3: W1 measure library, W2 authorization corrections
  'measure_type_upserted', 'measure_type_activated', 'measure_type_deactivated', 'measure_type_deleted',
  'authorization_corrected', 'authorization_voided',
  -- UI S10: the audited compliance enforcement switch
  'compliance_enforcement_changed',
  -- demo UX Part 2: undo a note review
  'progress_note_review_undone',
  -- S4b: attachments
  'attachment_added', 'attachment_removed', 'attachment_viewed'
]::text[]));

ALTER TABLE public.client_documents
  ADD COLUMN display_name text CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 120);

-- =============================================================================================
-- cp_attachments
-- =============================================================================================
CREATE TABLE public.cp_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  parent_kind text NOT NULL CHECK (parent_kind IN ('client_document', 'inservice_form', 'training_form', 'credential', 'care_plan')),
  parent_id uuid NOT NULL,                                                -- checked by the RPCs (no polymorphic FK)
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,         -- client-side parents
  caregiver_id uuid REFERENCES public.caregivers(id) ON DELETE CASCADE,   -- credentials
  object_path text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR length(description) <= 500),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  uploaded_by uuid NOT NULL DEFAULT auth.uid(),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,                                                 -- the Edge Function checked the object
  completed_at timestamptz,                                               -- NULL = pending
  removed_at timestamptz, removed_by uuid, removed_reason text CHECK (removed_reason IS NULL OR length(removed_reason) <= 500),
  CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  CHECK (completed_at IS NULL OR checked_at IS NOT NULL),
  CHECK ((parent_kind = 'credential') = (caregiver_id IS NOT NULL)),
  CHECK ((parent_kind = 'credential') = (client_id IS NULL))
);
CREATE INDEX cp_attachments_parent_idx ON public.cp_attachments (parent_kind, parent_id);
CREATE INDEX cp_attachments_pending_idx ON public.cp_attachments (uploaded_at) WHERE completed_at IS NULL;

CREATE TRIGGER trg_cp_row_scope BEFORE INSERT OR UPDATE ON public.cp_attachments
FOR EACH ROW EXECUTE FUNCTION public.cp_check_row_scope();

ALTER TABLE public.cp_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff and own caregiver read attachments in scope" ON public.cp_attachments
FOR SELECT TO authenticated USING (
  completed_at IS NOT NULL AND removed_at IS NULL AND (
    (parent_kind IN ('client_document', 'care_plan')
       AND cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin}'::public.app_role[]))
    OR (parent_kind IN ('inservice_form', 'training_form', 'credential')
       AND cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin,hr_staff}'::public.app_role[]))
    OR (parent_kind = 'credential' AND caregiver_id IN (SELECT public.my_caregiver_ids()))));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.cp_attachments FROM authenticated;
REVOKE ALL ON TABLE public.cp_attachments FROM anon;

-- =============================================================================================
-- Storage
-- =============================================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cp-attachments', 'cp-attachments', false, 20971520, ARRAY['application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

CREATE POLICY "cp-attachments: read a readable active attachment" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'cp-attachments'
  AND EXISTS (SELECT 1 FROM public.cp_attachments a WHERE a.object_path = storage.objects.name));   -- cp_attachments RLS applies

-- =============================================================================================
-- Internal helpers
-- =============================================================================================
-- The parent's agency / office / client / caregiver, and whether files can still be added (current version).
CREATE FUNCTION public.cp_attachment_parent(_kind text, _id uuid,
  OUT agency_id uuid, OUT office_id uuid, OUT client_id uuid, OUT caregiver_id uuid, OUT attachable boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _kind = 'client_document' THEN
    SELECT d.agency_id, d.virtual_office_id, d.client_id, NULL, d.is_current INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.client_documents d WHERE d.id = _id;
  ELSIF _kind = 'inservice_form' THEN
    SELECT f.agency_id, f.virtual_office_id, f.client_id, NULL, (p.status = 'active' AND f.training_version = p.training_version)
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.plan_inservice_forms f JOIN public.care_plans p ON p.id = f.care_plan_id WHERE f.id = _id;
  ELSIF _kind = 'training_form' THEN
    SELECT f.agency_id, f.virtual_office_id, f.client_id, NULL, (p.status = 'active' AND f.training_version = p.training_version)
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.plan_training_forms f JOIN public.care_plans p ON p.id = f.care_plan_id WHERE f.id = _id;
  ELSIF _kind = 'care_plan' THEN
    SELECT p.agency_id, p.virtual_office_id, p.client_id, NULL, (p.status = 'active')
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.care_plans p WHERE p.id = _id;
  ELSIF _kind = 'credential' THEN
    SELECT g.agency_id, g.virtual_office_id, NULL, g.id, (c.credential_type_id IS NOT NULL)
      INTO agency_id, office_id, client_id, caregiver_id, attachable
      FROM public.caregiver_certifications c JOIN public.caregivers g ON g.id = c.caregiver_id WHERE c.id = _id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cp_attachment_parent(text, uuid) FROM PUBLIC, anon, authenticated;

-- May the caller see / add files on this parent? Staff tiers as the parent's read policy; credentials also the
-- caregiver themself (caregiver role, own active record).
CREATE FUNCTION public.cp_attachment_allowed(_kind text, _agency uuid, _office uuid, _caregiver uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _agency IS NOT NULL AND (
    (_kind IN ('client_document', 'care_plan') AND cp_staff_in_scope(_agency, _office, '{manager,agency_admin}'::public.app_role[]))
    OR (_kind IN ('inservice_form', 'training_form', 'credential') AND cp_staff_in_scope(_agency, _office, '{manager,agency_admin,hr_staff}'::public.app_role[]))
    OR (_kind = 'credential' AND has_role(auth.uid(), 'caregiver'::public.app_role)
        AND EXISTS (SELECT 1 FROM public.caregivers g WHERE g.id = _caregiver AND g.user_id = auth.uid()
                      AND g.agency_id = _agency AND g.is_active IS NOT FALSE)))
$$;
REVOKE ALL ON FUNCTION public.cp_attachment_allowed(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- =============================================================================================
-- begin_attachment_upload — a pending row and its server-generated path
-- =============================================================================================
CREATE FUNCTION public.begin_attachment_upload(_parent_kind text, _parent_id uuid, _display_name text,
  _description text, _mime_type text, _size_bytes integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; v_id uuid := gen_random_uuid(); v_path text; v_name text := btrim(_display_name); v_desc text := NULLIF(btrim(_description), '');
BEGIN
  IF _parent_kind IS NULL OR _parent_kind NOT IN ('client_document', 'inservice_form', 'training_form', 'credential', 'care_plan') THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM cp_attachment_parent(_parent_kind, _parent_id);
  IF NOT cp_attachment_allowed(_parent_kind, p.agency_id, p.office_id, p.caregiver_id) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT p.attachable THEN
    RAISE EXCEPTION 'This is an earlier version; its files are read-only' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_name, '') = '' OR length(v_name) > 120 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A file name of 1-120 characters is required' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(v_desc, '')) > 500 THEN RAISE EXCEPTION 'The description is too long (at most 500 characters)' USING ERRCODE = '22023'; END IF;
  IF _mime_type IS NULL OR _mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document') THEN
    RAISE EXCEPTION 'This file type isn''t accepted (PDF, JPEG, PNG or Word .docx)' USING ERRCODE = '22023';
  END IF;
  IF _size_bytes IS NULL OR _size_bytes < 1 OR _size_bytes > 20971520 THEN
    RAISE EXCEPTION 'A file can be at most 20 MB' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.cp_attachments WHERE parent_kind = _parent_kind AND parent_id = _parent_id AND removed_at IS NULL) >= 50 THEN
    RAISE EXCEPTION 'At most 50 files per item' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.cp_attachments WHERE uploaded_by = auth.uid() AND completed_at IS NULL AND removed_at IS NULL) >= 20 THEN
    RAISE EXCEPTION 'Too many unfinished uploads; try again later' USING ERRCODE = '22023';
  END IF;
  v_path := p.agency_id::text || '/' || COALESCE(p.office_id::text, 'none') || '/' || v_id::text;
  INSERT INTO public.cp_attachments (id, agency_id, virtual_office_id, parent_kind, parent_id, client_id, caregiver_id,
    object_path, display_name, description, mime_type, size_bytes)
  VALUES (v_id, p.agency_id, p.office_id, _parent_kind, _parent_id, p.client_id, p.caregiver_id,
    v_path, v_name, v_desc, _mime_type, _size_bytes);
  RETURN jsonb_build_object('id', v_id, 'object_path', v_path);
END $$;
REVOKE ALL ON FUNCTION public.begin_attachment_upload(text, uuid, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_attachment_upload(text, uuid, text, text, text, integer) TO authenticated;

-- =============================================================================================
-- complete_attachment_upload — the uploader activates their checked file; audit attachment_added
-- =============================================================================================
CREATE FUNCTION public.complete_attachment_upload(_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; p record;
BEGIN
  SELECT * INTO a FROM public.cp_attachments WHERE id = _id AND uploaded_by = auth.uid() AND completed_at IS NULL AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM cp_attachment_parent(a.parent_kind, a.parent_id);
  IF NOT cp_attachment_allowed(a.parent_kind, p.agency_id, p.office_id, p.caregiver_id) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT p.attachable THEN RAISE EXCEPTION 'This is an earlier version; its files are read-only' USING ERRCODE = '22023'; END IF;
  IF a.checked_at IS NULL THEN RAISE EXCEPTION 'The file hasn''t been checked yet' USING ERRCODE = '22023'; END IF;
  UPDATE public.cp_attachments SET completed_at = now() WHERE id = a.id;
  PERFORM cp_audit(a.agency_id, a.virtual_office_id, 'attachment_added', 'cp_attachment', a.id,
    jsonb_build_object('attachment_id', a.id, 'parent_kind', a.parent_kind, 'parent_id', a.parent_id,
                       'mime_type', a.mime_type, 'size_bytes', a.size_bytes));
  RETURN a.id;
END $$;
REVOKE ALL ON FUNCTION public.complete_attachment_upload(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_attachment_upload(uuid) TO authenticated;

-- =============================================================================================
-- remove_attachment — soft remove with a reason (staff tier of the parent, or the caregiver's own upload)
-- =============================================================================================
CREATE FUNCTION public.remove_attachment(_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; p record; v_staff boolean;
BEGIN
  SELECT * INTO a FROM public.cp_attachments WHERE id = _id AND completed_at IS NOT NULL AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM cp_attachment_parent(a.parent_kind, a.parent_id);
  v_staff := cp_staff_in_scope(p.agency_id, p.office_id, CASE WHEN a.parent_kind IN ('client_document', 'care_plan')
    THEN '{manager,agency_admin}'::public.app_role[] ELSE '{manager,agency_admin,hr_staff}'::public.app_role[] END);
  IF NOT (v_staff OR (a.uploaded_by = auth.uid() AND cp_attachment_allowed(a.parent_kind, p.agency_id, p.office_id, p.caregiver_id))) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(_reason), '') = '' OR length(_reason) > 500 THEN
    RAISE EXCEPTION 'Say why the file is removed (at most 500 characters)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cp_attachments SET removed_at = now(), removed_by = auth.uid(), removed_reason = btrim(_reason) WHERE id = a.id;
  PERFORM cp_audit(a.agency_id, a.virtual_office_id, 'attachment_removed', 'cp_attachment', a.id,
    jsonb_build_object('attachment_id', a.id, 'parent_kind', a.parent_kind, 'parent_id', a.parent_id));
  RETURN a.id;
END $$;
REVOKE ALL ON FUNCTION public.remove_attachment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_attachment(uuid, text) TO authenticated;

-- =============================================================================================
-- open_attachment — authorizes a preview / download (the Edge Function signs a 60-second URL); audit attachment_viewed
-- =============================================================================================
CREATE FUNCTION public.open_attachment(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; p record;
BEGIN
  SELECT * INTO a FROM public.cp_attachments WHERE id = _id AND completed_at IS NOT NULL AND removed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM cp_attachment_parent(a.parent_kind, a.parent_id);
  IF NOT cp_attachment_allowed(a.parent_kind, p.agency_id, p.office_id, p.caregiver_id) THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM cp_audit(a.agency_id, a.virtual_office_id, 'attachment_viewed', 'cp_attachment', a.id,
    jsonb_build_object('attachment_id', a.id, 'parent_kind', a.parent_kind, 'parent_id', a.parent_id));
  RETURN jsonb_build_object('object_path', a.object_path, 'display_name', a.display_name, 'mime_type', a.mime_type);
END $$;
REVOKE ALL ON FUNCTION public.open_attachment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_attachment(uuid) TO authenticated;

-- =============================================================================================
-- list_attachments — active files of one or more parents of one kind (every parent must be readable)
-- =============================================================================================
CREATE FUNCTION public.list_attachments(_parent_kind text, _parent_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; p record; v_staff boolean := false;
BEGIN
  IF _parent_kind IS NULL OR _parent_kind NOT IN ('client_document', 'inservice_form', 'training_form', 'credential', 'care_plan')
     OR _parent_ids IS NULL OR cardinality(_parent_ids) > 200 THEN
    RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
  END IF;
  FOREACH v_id IN ARRAY _parent_ids LOOP
    SELECT * INTO p FROM cp_attachment_parent(_parent_kind, v_id);
    IF NOT cp_attachment_allowed(_parent_kind, p.agency_id, p.office_id, p.caregiver_id) THEN
      RAISE EXCEPTION 'Not found or not allowed' USING ERRCODE = '42501';
    END IF;
    v_staff := v_staff OR cp_staff_in_scope(p.agency_id, p.office_id, '{manager,agency_admin,hr_staff}'::public.app_role[]);
  END LOOP;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', a.id, 'parent_id', a.parent_id, 'display_name', a.display_name, 'description', a.description,
      'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'uploaded_at', a.uploaded_at,
      'uploaded_by', COALESCE(pr.full_name, 'Unknown'), 'uploaded_by_me', a.uploaded_by = auth.uid(),
      'by_caregiver', g.user_id IS NOT NULL AND a.uploaded_by = g.user_id,
      'waiting_for_hr', a.parent_kind = 'credential' AND g.user_id IS NOT NULL AND a.uploaded_by = g.user_id
                        AND a.uploaded_at > COALESCE(c.updated_at, c.created_at),
      'can_remove', v_staff OR a.uploaded_by = auth.uid())
      ORDER BY a.uploaded_at, a.id)
    FROM public.cp_attachments a
    LEFT JOIN public.profiles pr ON pr.id = a.uploaded_by
    LEFT JOIN public.caregivers g ON g.id = a.caregiver_id
    LEFT JOIN public.caregiver_certifications c ON a.parent_kind = 'credential' AND c.id = a.parent_id
    WHERE a.parent_kind = _parent_kind AND a.parent_id = ANY(_parent_ids) AND a.completed_at IS NOT NULL AND a.removed_at IS NULL), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_attachments(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_attachments(text, uuid[]) TO authenticated;

-- =============================================================================================
-- save_other_client_document — "Add other document": a custom-named intake document (doc_type other_<hex>)
-- =============================================================================================
CREATE FUNCTION public.save_other_client_document(_client_id uuid, _doc_type text, _display_name text,
  _status public.client_document_status, _not_applicable_reason text DEFAULT NULL,
  _effective_date date DEFAULT NULL, _expiration_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_type text := _doc_type; v_name text := btrim(_display_name); v_id uuid;
BEGIN
  SELECT id, agency_id, virtual_office_id INTO c FROM public.clients WHERE id = _client_id;
  PERFORM cp_require_scope(c.agency_id, c.virtual_office_id, '{manager,agency_admin}'::public.app_role[]);
  IF COALESCE(v_name, '') = '' OR length(v_name) > 120 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A document name of 1-120 characters is required' USING ERRCODE = '22023';
  END IF;
  IF v_type IS NULL THEN
    v_type := 'other_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  ELSIF v_type !~ '^other_[0-9a-f]{12}$' OR NOT EXISTS (SELECT 1 FROM public.client_documents WHERE client_id = c.id AND doc_type = v_type) THEN
    RAISE EXCEPTION 'Unknown other document' USING ERRCODE = '22023';
  END IF;
  v_id := upsert_client_document(c.id, v_type, _status, _not_applicable_reason, _effective_date, _expiration_date, NULL, '{}'::jsonb);
  UPDATE public.client_documents SET display_name = v_name WHERE id = v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.save_other_client_document(uuid, text, text, public.client_document_status, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_other_client_document(uuid, text, text, public.client_document_status, text, date, date) TO authenticated;

-- =============================================================================================
-- Service-role helpers for the cp-attachments Edge Function (no API-role EXECUTE)
-- =============================================================================================
-- The stored object has the declared size and a matching file signature (checked by the function): mark it checked.
CREATE FUNCTION public.cp_attachment_mark_checked(_id uuid, _size bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.cp_attachments SET checked_at = now()
   WHERE id = _id AND completed_at IS NULL AND removed_at IS NULL AND size_bytes = _size;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.cp_attachment_mark_checked(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cp_attachment_mark_checked(uuid, bigint) TO service_role;

-- Delete a pending row (failed check, abandoned upload); returns its path so the function removes the object.
CREATE FUNCTION public.cp_attachment_discard(_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_path text;
BEGIN
  DELETE FROM public.cp_attachments WHERE id = _id AND completed_at IS NULL RETURNING object_path INTO v_path;
  RETURN v_path;
END $$;
REVOKE ALL ON FUNCTION public.cp_attachment_discard(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cp_attachment_discard(uuid) TO service_role;

CREATE FUNCTION public.cp_attachment_stale_pending(_hours integer DEFAULT 24)
RETURNS TABLE (id uuid, object_path text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.object_path FROM public.cp_attachments a
   WHERE a.completed_at IS NULL AND a.uploaded_at < now() - make_interval(hours => GREATEST(_hours, 1))
   ORDER BY a.uploaded_at LIMIT 500
$$;
REVOKE ALL ON FUNCTION public.cp_attachment_stale_pending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cp_attachment_stale_pending(integer) TO service_role;

# S4b — File attachments: design and security review

Status: **BUILT on DEV** (2026-10-21, migration `20261028120000_s4b_attachments.sql`, Edge Function `cp-attachments`).
Approved by the owner on Oct 21 with the answers in §11; the sections below are the approved design, §11 records what
changed on the way.

## 1. What exists today

| Place | Table | File field today |
|---|---|---|
| Onboarding intake documents (consent, insurance, emergency contacts, allergies, assessment, release of information, safety/behavior plan) | `client_documents`: one row per client × `doc_type` × `version`; `is_current`; `status`, `effective_date`, `expiration_date` | `file_ref text`: unused |
| In-service (case manager → program lead) | `plan_inservice_forms`: one per plan `training_version` | none |
| Training sessions (ISK 33.01_01F) | `plan_training_forms` (session) + `plan_training_records` (attendees) | none |
| Caregiver credentials | `caregiver_certifications`: one row per entry or renewal; `issued_date`, `expiry_date`, `is_verified` | `document_url text`: legacy; free text |

The only Storage bucket used by the app is `knowledge-uploads` (Phase 3, agency-folder policy). The other bucket in the
project is an unrelated export artefact. Nothing stores client or caregiver files yet.

Reads of these tables are role-tiered:
- client documents: manager / agency_admin;
- training: + hr_staff;
- credentials: hr_staff / manager / agency_admin, plus the caregiver for their own.

All of them go through `cp_staff_in_scope(agency_id, virtual_office_id, roles)`, the M-Office predicate: same agency,
and an office-restricted user only for their own office.

## 2. Scope

Attachments on four kinds of parent:
1. **Intake document version** (`client_documents` row), including **"Add other document"**: a new `doc_type` of
   `other_<slug>` with a custom **display name** stored on the row. This needs one new column, `display_name`; standard
   types keep using the template name.
2. **In-service form** (`plan_inservice_forms` row).
3. **Training session** (`plan_training_forms` row): the signed sign-in sheet, one or more scans.
4. **Credential entry** (`caregiver_certifications` row).

Rules:
- **Many files per parent.**
- **Status, effective and expiry stay ONE per parent version**, credentials included, never per file. A new version of
  the document (renewal) is a new parent row with its own files. The old version's files stay attached to the old
  version (retention, §6).

## 3. Data model (additive, for approval)

```sql
CREATE TABLE public.cp_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agency(id),
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  parent_kind text NOT NULL CHECK (parent_kind IN ('client_document','inservice_form','training_form','credential')),
  parent_id uuid NOT NULL,                       -- checked by the RPC (no polymorphic FK)
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,        -- set for client-side parents
  caregiver_id uuid REFERENCES public.caregivers(id) ON DELETE CASCADE,  -- set for credentials
  object_path text NOT NULL UNIQUE,              -- '<agency>/<office|none>/<uuid>' — no names, no PHI
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  description text CHECK (length(description) <= 500),
  mime_type text NOT NULL,                       -- from the allowlist, checked server side
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256 text,                                   -- optional duplicate check
  uploaded_by uuid NOT NULL DEFAULT auth.uid(),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz, removed_by uuid, removed_reason text,       -- soft remove, audited
  CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
```

- **Row scope:** the existing `cp_check_row_scope` trigger.
- **RLS (read only):**
  - client parents: managers / agency admins in scope;
  - training and credential parents: + hr_staff;
  - credentials: also the caregiver for their own (`caregiver_id` = their record).
- **No direct writes** from API roles: `REVOKE INSERT/UPDATE/DELETE`, as for every care-plan table.
- **Write RPCs** (SECURITY DEFINER; `REVOKE ALL FROM PUBLIC, anon` + `GRANT authenticated`; checked with
  `aclexplode`; each audited through `cp_audit`):
  - `begin_attachment_upload(parent_kind, parent_id, display_name, description, mime_type, size_bytes)`:
    - checks the parent's scope and role;
    - checks the allowlist and size;
    - inserts a **pending** row (`object_path` generated server side);
    - returns the path for one signed **upload** URL (`createSignedUploadUrl`), issued by an Edge Function using the
      service role only after the RPC succeeded.
  - `complete_attachment_upload(id)`: confirms the object exists, its size matches and its MIME is sniffed; marks it
    active; audit `attachment_added`.
  - `remove_attachment(id, reason)`: soft remove; the object is kept for retention (§6); audit `attachment_removed`.
  - `get_attachment_url(id)`: checks the scope and returns a **60-second signed download URL** (Edge Function);
    audit `attachment_viewed` (owner to decide: on or off).
- **New event types** (events CHECK, owner approval, same pattern as S10): `attachment_added`, `attachment_removed`,
  optionally `attachment_viewed`. Payload is ids, kind, size and type only: never the file name or description.

## 4. Storage

- **Bucket:** `cp-attachments`, `public = false`, `file_size_limit = 10 MB`, `allowed_mime_types` =
  `application/pdf`, `image/jpeg`, `image/png`, `image/heic`,
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. The bucket enforces the limits as well
  as the RPC.
- **Path:** `<agency_id>/<office_id or "none">/<attachment uuid>`. No client, caregiver or file names and no
  extension: the display name lives in the table and is sent as `Content-Disposition` on download.
- **Storage RLS** on `storage.objects` for `bucket_id = 'cp-attachments'`:
  - **No INSERT/UPDATE/DELETE for authenticated.** Uploads only through the signed upload URL, which is issued after
    the RPC checks.
  - **SELECT** only when a matching active `cp_attachments` row exists that the caller may read, using the same
    `cp_staff_in_scope` predicate, plus the caregiver-own rule for credentials.
  - So a path alone gives nothing. Downloads normally use signed URLs anyway.
- **Signed URLs:** download 60 s, upload 5 min, single object. Never stored, logged or put in app URLs or browser
  storage. The app keeps only the attachment id in memory.
- **Browser:**
  - no file names in the route;
  - preview in a sandboxed `<iframe>` (PDF) or `<img>` (images);
  - `.docx` and HEIC download only. No server-side conversion in S4b.

## 5. UI (after approval)

- An **Attachments** block on each parent:
  - onboarding document card;
  - in-service row;
  - training session;
  - credential entry.
- Each file shows: display name, description, type, size, uploaded by and at, **Preview / Download / Remove**.
- **Add files:** a multi-select picker with the allowlist and size checked in the browser first, a progress bar,
  and per-file errors.
- **Add other document** on the Onboarding tab: a custom name, then status / effective / expiry, then files.

## 6. Retention and version replace

- **Renewal** (new parent version): the old version and its files are kept, read-only. They show under "History"
  and aren't attachable any more.
- **Remove** is soft: the row is marked and the object stays.
- **Deleting objects:** only by a retention job that is out of scope for S4b. It needs an agency retention policy
  (Michigan Medicaid records: 7 years is the usual assumption; confirm with compliance).
- **Client or caregiver deleted** (`ON DELETE CASCADE`): rows go. Objects stay until the retention job; that is
  documented, not automatic.

## 7. Threats and the tests that prove them (PGlite + DEV + browser, tagged fixtures)

| # | Threat | Control | Test |
|---|---|---|---|
| T1 | Office-Y manager reads office-X files | RLS + RPC scope (`cp_staff_in_scope`) | `get_attachment_url` / table / `storage.objects` select refused for mgrY |
| T2 | Other agency | agency_id in path + predicate | aaB refused on every RPC, table and object |
| T3 | anon | no grants; private bucket | anon: RPCs 42501; object GET 400/404; table not visible |
| T4 | Caregiver reads client documents or another caregiver's credential | role tiers; caregiver-own only for credentials | cg sees own credential files only |
| T5 | Scheduler / client role | not in any role list | refused everywhere |
| T6 | Direct upload or overwrite with a known path | no storage write policy; signed upload URL is single-path, short-lived | authenticated `upload()` to the bucket refused; expired upload URL refused |
| T7 | Signed URL leaked | 60 s expiry, not logged, not in app URLs | URL works < 60 s, fails after; app storage and URL scan clean |
| T8 | Disguised file type / oversize | bucket MIME + size limits, sniffing on complete | .exe renamed .pdf refused; 10 MB + 1 refused |
| T9 | PHI in paths, logs or events | uuid paths; payload ids only | grep of paths and events for names = 0 |
| T10 | Remove hides evidence | soft remove + audit; object kept | removed file not listed, event present, object still there (service role) |
| T11 | `SECURITY DEFINER` grant footgun (rule 14) | REVOKE PUBLIC, anon; aclexplode | ACL check in every suite |
| T12 | Rollback leaves orphans | rollback drops policies, table and bucket only when empty | rollback proof (catalog md5) + an emptiness pre-check |

## 8. Rollback

- Drop the RPCs, the storage policies, `cp_attachments`, the new event types (CHECK restored, md5 vs DEV), and
  `client_documents.display_name`.
- The bucket is deleted only when empty; otherwise the rollback stops and lists the objects.
- PGlite rollback proof as for every slice. DEV before / after suites.

## 9. Production prerequisites (not DEV)

- A **Supabase BAA** (HIPAA add-on) **before any real client file is stored**. Storage objects are PHI.
- Point-in-time recovery and backups covering Storage.
- A retention policy confirmed by compliance.
- Malware scanning (Supabase has none built in: an Edge Function plus a scanning service, or a vendor).
- The custom SMTP / Auth hardening items already in known-issues.
- Until then, DEV uses fictitious files only (demo office: generated PDFs with no PHI).

## 10. Open questions for the owner (answered, see §11)

1. Is the 10 MB limit enough? Phone photos of multi-page forms may need 20 MB, or client-side compression.
2. Audit every view (`attachment_viewed`) or only add and remove?
3. Can a caregiver upload their own credential scans (HR verifies), or HR only?
4. Is HEIC allowed as-is (iPhone default; most browsers can't preview it), or converted on the device?

## 11. Owner answers (Oct 21) and the build

1. **Size:** 20 MB per file (bucket, table CHECK, RPC, browser). Photos are compressed in the browser to a JPEG of about
   2–3 MB (longest side 2400 px) before upload.
2. **Views are audited:** `attachment_viewed` on every preview or download (ids and kind only).
3. **Caregivers upload their own credential scans:** the caregiver app has **Profile → My credentials**. The upload changes
   nothing on the entry (dates, `is_verified`); the existing unverified rule is unchanged. The file shows **Waiting for HR**
   (HR: **New upload**) until HR or a manager saves that entry after the upload (`enter_caregiver_credential`, unchanged).
   A credential HR hasn't entered has no entry to attach to (the caregiver gives it to HR).
4. **HEIC:** converted to JPEG on the device (`heic2any`, loaded only when needed); if that fails, a clear error that says
   how to take JPEG photos or upload a PDF. The bucket and the RPC don't accept HEIC.
5. **`parent_kind = 'care_plan'`** exists now (managers / agency admins; active plan only); S17 attaches the ISK IPOS PDF.
6. **Abandoned uploads:** pending rows older than 24 h are discarded (row + object) by the Edge Function's `cleanup`
   action, callable only with a service-role token. **Scheduling it is an owner action** (a Supabase scheduled job calling
   the function daily); until then it runs on demand.
7. **S16 signature images will use their own table**, not `cp_attachments`.

As built (differences from §3–§4):
- **Upload check:** `complete` goes through the Edge Function, which reads the stored object back with the service role,
  checks its size and file signature (PDF `%PDF-`, JPEG, PNG, .docx = zip with `word/`), marks it checked
  (`cp_attachment_mark_checked`, service role only), and then calls `complete_attachment_upload` **as the user**. A failed
  check deletes the object and the pending row.
- **Signed upload URL lifetime:** Supabase fixes it at 2 hours (not configurable), not 5 minutes. It is single-path, never
  overwrites (no upsert), and an upload that isn't completed is discarded by the cleanup.
- **PDF preview:** a plain `<iframe>` from the storage domain (cross-origin, so it can't reach the app); Chrome refuses to
  render PDFs inside a sandboxed frame. Images use `<img>`. `.docx` is download only.
- **Reads** go through `list_attachments` (uploader's name, "waiting for HR", can-remove) and `open_attachment` (audited),
  besides the table's RLS and the bucket's read policy.
- **Other documents** are saved by `save_other_client_document`, which calls `upsert_client_document` unchanged and then sets
  `display_name`; `doc_type` is `other_<12 hex>` (no name in it). They don't count toward onboarding.
- **Gates:** PGlite `s4b.cjs` 18/18, rollback proof 4/4 (events CHECK md5 = DEV before the push), DEV before 2/2 and after
  12/12 (incl. NB1), browser round 12 10/10, unit tests.

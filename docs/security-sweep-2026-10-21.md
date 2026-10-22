# Security sweep: caller checks in Edge Functions and SECURITY DEFINER functions (Oct 21, 2026)

Trigger: the auto-assign investigation found that `match-caregiver` answered the public anon key with caregivers' contact
data. Owner decision (Oct 21 night, item 1): fix it, add the caller check to the eligibility functions, sweep every Edge
Function and SECURITY DEFINER read for the same gap, fix the same way where needed. Branch `hotfix-match-caregiver`.

## Fixed (DEV: migration `20261030110000_hotfix_caller_checks.sql` md5 ca79ac94…, functions redeployed)

| Where | Gap (verified on DEV before the fix) | Fix |
|---|---|---|
| `match-caregiver` (Edge) | service role only, no caller check: the anon key + a shift id returned that office's caregivers with e-mail, phone, city, hourly rate (HIGH) | signed-in user required (401); `match_caregiver_scope` (new RPC, run **as the user**: manager / scheduler / agency_admin in scope of the shift's office) before any service-role read (403); eligibility runs as the user; response keeps only `id, first_name, last_name, avg_rating, rating_count` (what Smart Assign / Auto-fill show; completion / on-time already appear in the key-factor text); the database error message is returned instead of "Unknown error" |
| `check_assignment_eligibility`, `_bulk` (DB) | any signed-in user of any agency could evaluate any shift / caregiver (credential names, plan / authorization state) (MEDIUM) | caller must be staff (system_admin, agency_admin, manager, scheduler, hr_staff) in scope of the shift's office, or a caregiver checking only themselves (the pickup paths call these as the caregiver). Results for allowed callers byte-identical (PGlite E1; NB1 behaviour identical on DEV) |
| `log_event` (DB) | SECURITY DEFINER, EXECUTE for PUBLIC / anon / authenticated: anyone could write audit rows into any agency with any actor (HIGH) | EXECUTE revoked from PUBLIC, anon, authenticated (its only callers are the SECURITY DEFINER `tg_event_*` triggers, which run as the owner; the shift trigger still writes its event, DEV L1) |
| `reset-database` (Edge) | an **agency_admin** could delete every row of 15 tables and **every auth user of every agency** (HIGH) | system_admin only (never called with an admin token in tests). Recommended: undeploy it (owner action) |
| `import-data` (Edge) | an agency_admin could insert raw rows with any `agency_id` into 13 tables (cross-tenant write) (HIGH) | system_admin only |
| `rag-eval-harness` (Edge) | no caller check, service role: the anon key + an agency id returned that agency's staff-only knowledge text (and billed OpenAI calls) (HIGH) | system_admin only (`_shared/requireSystemAdmin.ts`) |
| `embedding-provider-check` (Edge, **not deployed**) | no caller check (billed OpenAI calls) | system_admin only in code; stays undeployed |
| `create-user` (Edge) | an office-restricted manager creating a scheduler / hr_staff produced an **agency-wide** staff profile (privilege escalation, MEDIUM) | the new staff profile inherits the caller's office restriction |
| `approve-caregiver-registration` (Edge) | an office-restricted reviewer could approve another office's registrations (LOW-MEDIUM) | office check for office-restricted reviewers |

Tests: PGlite `hotfix.cjs` 6/6, `rollback-hotfix.cjs` 3/3 (eligibility bodies md5 = DEV before; log_event grantees back),
DEV `hotfix.cjs` before 3/3 (gaps reproduced) and after 6/6 (NB1 behaviour identical), browser round 8 18/18 (Smart Assign
and Auto-fill with enforcement off and on; caregiver Available Shifts).

## Swept and OK (no change)

- **Edge:** admin-delete-user, admin-reset-password, enable-caregiver-login, enable-client-login (user JWT, role, agency and
  office checks before service-role writes; TypeScript-only, as designed in M-SEC-2b), link-existing-accounts
  (system_admin), backfill-knowledge-embeddings and ingest-knowledge-document (user JWT + RLS), search-knowledge (public by
  design, public surface hardcoded), cp-attachments (S4b: every check in the database as the user).
- **DB:** 121 SECURITY DEFINER functions are executable by API roles; 34 have no direct caller-check keyword. Reviewed:
  they check through a helper (`cp_is_assigned_caregiver`, `cp_approve_batch`, `cp_require_agency_measure_type`,
  `cp_attachment_allowed`, `cp_form_template_readable`), are token-gated public flows (`flow_session_*` compare the
  session token; `submit_caregiver_registration`, `get_public_office`, `is_published_public_agency` are the public pages),
  or are the two eligibility functions and `log_event` fixed above.

## Remaining (low; not changed, for the owner)

- Identity / tenancy helpers used by RLS policies are executable by anon or any user and answer for any id:
  `is_agency_staff`, `is_office_restricted`, `get_user_role`, `has_permission`, `order_agency_id`, `order_client_id`,
  `caregiver_agency_id`, `family_agency_id`, `shift_assignment_agency_id`, `shift_assignment_virtual_office_id`,
  `knowledge_document_agency_id`, `event_default_agency_id`. They reveal a role or an agency id for a known UUID (an
  oracle, no records). Revoking anon could break RLS evaluation on public pages; a per-function check is a separate change.
- `generate_order_number` is callable by any signed-in user (burns sequence numbers).
- `enable-*-login`: "not found" vs "other agency" messages differ (existence oracle). `create-user` answers a missing token
  with 500 instead of 401. Some admin functions pass database messages through after authorization.
- `search-knowledge` (public): no rate limit (provider cost).
- `mcp` (not deployed; OAuth issuer is the old project) would expose client `medical_conditions` and interpolates `search`
  into a PostgREST filter. Keep it undeployed (CLAUDE.md: dev tooling, not the product Tool Layer).
- **Owner actions recommended:** undeploy `reset-database` and `import-data` from any shared environment.

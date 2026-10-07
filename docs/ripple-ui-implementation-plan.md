# Ripple Effects — UI Implementation Plan

> **Status (refreshed Oct 4, 2026 against the BUILT backend).** Backend Phases A–D and S-OFF-1 are
> live on DEV and the D3 end-to-end done-test is green (schema plan §14). This plan maps every UI
> slice to the **exact live RPC names and read paths**. UI round 1 = **S0 + S1**. Slices are built
> in order, one reviewed commit each.
>
> **Scope (owner, Oct 1):** the module's only change to scheduling is the additive rules in the
> eligibility engine behind the per-office `compliance_enforcement_enabled` flag. Everything else
> in scheduling is preserved exactly (Schedule screens, assign dialogs, AutoFill, trades). No AI
> provider anywhere in this module. Progress notes, IPOS content and authorizations never enter the
> knowledge/RAG pipeline.
>
> **Build target:** CareMuch's existing components: `AppLayout` (staff), `CaregiverAppShell`
> (caregivers), shadcn `ui/*`, `StatCard`, the navy theme. `docs/design/ripple-console-prototype-v9.html`
> is a UX sketch only (its teal/serif theme, dark mode, office picker and "Client login" toggle are
> not built).
>
> Companions: architecture doc (§12 authoritative), schema plan (§14 results),
> `docs/Ripple_UI_Plan_Decisions_2026-10-01.md` (owner decisions; wins on conflict).

---

## 0. Facts the plan depends on (code and DEV, Oct 4)

| Area | Reality | Consequence |
|---|---|---|
| Route guards | `RequireRole` + `src/lib/roleHome.ts` shipped in `419fed0`. Every staff route is guarded, `/schedule` included (S0b). CLAUDE.md rule 15 requires a guard on every new route. | New routes reuse `RequireRole` with an explicit role list. |
| Menu | Data-driven: `system_modules` ⨝ `role_permissions` via `usePermissions()` + the code maps `moduleRouteMap` / `iconMap` / `CATEGORY_ITEM_ORDER` in `AppLayout`. `role_permissions` is keyed by role only (global across agencies). M-SEC-4 (`20261004130000`) removed staff links from caregiver/client sidebars. | A new item = seed migration + code maps + route, **and** module gating (Q3) so Kind Care managers don't see Ripple items. |
| Module / enforcement flags | `virtual_office.care_plan_module_enabled` (menus, dashboard; Q3), `compliance_enforcement_enabled` (hard vs advisory rules), `care_plan_module_enabled_at` (go-live date, stamped automatically, read-only). Only agency_admin / system_admin can change the flags (guard trigger). | `useComplianceOffices()` reads them; the S10 switch card writes them. |
| Generated types | `src/integrations/supabase/types.ts` is stale (no Phase A–D tables/RPCs, no office columns). | S0 regenerates it from DEV; no manual edits. |
| Office context | No office switcher. Profiles carry `virtual_office_id` + `office_restricted`; RLS scopes everything. | `useCurrentProfile()`; pages that need one office (Weekly Billing) use a page-level office select. |
| Eligibility | `check_assignment_eligibility` → `{eligible, auto_approvable, hard[], soft[], advisory[], …}`; each issue `{code, label, detail}`. `EligibilityReport.tsx` renders server label/detail with no code map. New codes: `credential_missing`, `training_missing`, `authorization_missing`, `authorization_expired`, `units_short` ("N projected units remain"), `units_short_period` ("needs N units; M left this week"), `group_full`. Caregiver-facing results are masked to `not_bookable` / generic credential text (R6). | Display needs almost no code (S10). |
| Caregiver app | `CaregiverAppShell`, Today / Schedule / Shifts / Profile tabs; `ShiftDetailsDialog` read-only with optional `onAssign`. Caregivers have **no** table access to any Ripple table. | S7 reads only through `get_progress_note_for_caregiver`. |
| Print | No print CSS anywhere today. | S8 adds a print route + `@media print`. |
| Responsive | `AppLayout` sidebar starts open on mobile with no scrim; many staff tables overflow at 390px. | S0 fixes the sidebar; new screens are responsive from day one (§6). |

---

## 1. Data-access rules (binding for every slice)

1. **Manager-tier pages may read Phase A tables directly** through their SELECT policies (RLS, M-Office
   predicate). Tiers as built:

   | Read tier | Tables |
   |---|---|
   | Clinical: manager, agency_admin | `care_plans` (+ goals, objectives, objective_measures, needs, DSM, supports, attendees, external services, reviews), `client_documents`, `progress_notes`, `progress_note_entries`, `billing_batches` |
   | Authorizations: + scheduler | `service_authorizations`, `office_service_types` |
   | Group sessions: manager, agency_admin, scheduler | `group_sessions` |
   | Training: manager, agency_admin, hr_staff | `credential_types`, `plan_inservice_forms`, `plan_training_forms`, `plan_training_records` |
   | All staff | `form_templates`, `form_template_versions`, `form_template_fields`, `measure_types` |
   | Agency staff (existing policy) | `caregiver_certifications` (staff read is agency-wide today; known-issues) |

2. **Caregiver screens read ONLY through caregiver-safe RPCs:** `get_progress_note_for_caregiver`,
   `check_caregiver_shifts_eligibility`, `get_caregiver_visible_clients` (existing). A caregiver view
   never calls a manager RPC and never selects a Ripple table.
3. **All writes go through RPCs.** API roles have SELECT only on every Ripple table (schema §2.1).
   No direct `insert/update/delete` on Ripple tables from the UI, ever.
4. **Errors:** refused calls raise `Not found or not allowed` (42501). The UI shows generic text
   ("You can't do that here" / "Not found"), never echoes ids, and never retries with other ids.
5. **No PHI outside the screen:** nothing clinical or identifying in `console.*`, `localStorage` /
   `sessionStorage`, URLs or query strings (use ids only, e.g. `?note=<uuid>`, never names), page
   titles, or analytics. No service keys in the frontend (anon/publishable key only).
6. **Gating is UX, not security:** `RequireRole` and `useComplianceOffices()` decide what renders;
   RLS and the SECURITY DEFINER checks decide what is allowed.

---

## 2. The built backend surface (exact names)

**Writes (RPC, SECURITY DEFINER, role + office scope checked server-side)**

| Area | RPC (live signature, abbreviated) | Roles |
|---|---|---|
| Module | `seed_office_care_plan_defaults(_office_id)` | agency_admin |
| Shells | `save_template_draft(_template_id, _office_id, _kind, _name, _intake_doc_type, _is_required_for_client, _sections, _note_layout, _fields, _service_type)`, `publish_template_version(_template_id)`, `upgrade_instance_template(_instance_table, _instance_id, _new_values)` | template editors (agency_admin; office manager for office shells, Q13) / manager, agency_admin (+ hr_staff for training-form instances) |
| Care plan | `create_care_plan(_client_id, _plan_type, _header, _field_values)`, `renew_care_plan(_care_plan_id, …)`, `update_care_plan_fields(_care_plan_id, _header, _field_values)`, `upsert_care_plan_goals(_care_plan_id, _goals)`, `set_objective_measures(_objective_id, _measures)` | manager, agency_admin |
| Authorizations | `create_service_authorization(_client_id, _service_type, _auth_number, _units_authorized, _effective_date, _expiration_date, _unit_minutes, _service_code, _modifier, _service_description, _period_type, _units_per_period, _authorizing_agent_notes, _field_values, _units_used_before_caremuch)` | manager, agency_admin |
| Intake docs | `upsert_client_document(_client_id, _doc_type, _status, _not_applicable_reason, _effective_date, _expiration_date, _file_ref, _field_values)` | manager, agency_admin |
| Credentials / training | `enter_caregiver_credential(_caregiver_id, _credential_type_id, _effective_date, _expiry_date, _certification_number)`, `record_inservice_form(…)`, `record_training_form(…)`, `override_training_record(…)` | hr_staff, manager, agency_admin (override: manager, agency_admin) |
| Notes (caregiver) | `create_progress_note_for_shift(_shift_id)` (idempotent: returns the existing note), `save_progress_note_draft(_note_id, _header, _entries, _narrative_text)`, `submit_progress_note(_note_id, _typed_signature)` | the assigned caregiver (create also manager, agency_admin) |
| Notes (staff) | `review_progress_note(_note_id, _billable, _non_billable_reason)`, `return_progress_note(_note_id, _reason)`, `void_progress_note(_note_id, _reason)` | manager, agency_admin |
| Billing | `build_billing_batch(_office_id, _week_start)`, `approve_batch_notes(_batch_id, _note_ids)`, `approve_clean_rows(_batch_id)`, `mark_batch_billed(_batch_id)` | manager, agency_admin |
| Group sessions | `create_group_session(_office_id, _session_date, _start_time, _end_time, _staff_client_ratio, _max_clients)`, `set_shift_group_session(_shift_id, _group_session_id)` | manager, agency_admin, scheduler |
| Scheduling (unchanged API) | `assign_caregiver_to_shift`, `release_shift_assignments`, `caregiver_pick_up_shift`, `check_assignment_eligibility[_bulk]`, `check_caregiver_shifts_eligibility`, `match-caregiver` | as before (+ S-OFF-1 office scope) |

**Reads (RPC)**

| RPC | Returns | Roles |
|---|---|---|
| `get_client_onboarding_status(_client_id)` / `list_clients_onboarding(_office_id)` | the 8 items, each complete / missing / expired / not_applicable, + `onboarded` | manager, agency_admin |
| `list_caregivers_needing_retraining(_office_id)` | assigned future shifts whose caregiver isn't trained at the plan's current version | manager, agency_admin, hr_staff |
| `list_overdue_notes(_office_id, _as_of)` | draft/returned notes past their deadline | manager, agency_admin |
| `get_billing_batch(_batch_id)` | lines by client × authorization (units scheduled / billed / lost late) | manager, agency_admin |
| `get_progress_note_for_caregiver(_note_id)` | header + this_agency objectives + Instructions for Staff + measures, own assigned note only (R5) | caregiver |

---

## 3. Screen map

Notation: **R** = read, **W** = write. Every route is wrapped in `RequireRole` with the listed roles.

### Shared building blocks

| Component | Purpose | Status |
|---|---|---|
| `useCurrentProfile()` | agency, office, `office_restricted`, roles (from `user_roles`) | **S0** |
| `useComplianceOffices()` | offices the user can see, with both flags and go-live date | **S0** |
| `ExpiryPill` | ★ overdue, red ≤ 30 d, yellow ≤ 60 d, ok (Q16); date-only safe via `parseShiftDate` | **S0** |
| `UnitsBar` | authorized / used / pending / left (units + hours), optional period cap ("N left this week"); no dollars | **S0** |
| `ProvenanceBadge` | read-only "built from <shell> v<n>" (not a link) | **S0** |
| `TemplateFormRenderer` | renders one instance from its own `field_snapshot` | S4 |
| `PrintableProgressNote` + print CSS | Ripple's paper layout | S8 |

### 3.1 Dashboard compliance section (S11)
Right under the Dashboard header (where the S8 notes panel was, which it now contains), only for manager /
agency_admin with a module office; Kind Care's dashboard is unchanged (round1 hides the section by test id). Panels: caregivers (credential expiry 60/30/overdue, retraining),
clients (onboarding pending, authorizations expiring / units at risk), scheduling (overdue notes,
unassigned shifts — existing query).
- **R:** `list_clients_onboarding`, `list_caregivers_needing_retraining`, `list_overdue_notes`,
  and the new reads **G1** (credential expiry) and **G2** (authorizations at risk) from §4.
- **W:** none. Rows deep-link to the record and tab.

### 3.2 Client Care Plans list + detail (S4–S6)
Routes `/care-plans` (list), `/clients/:clientId/care-plan?tab=ipos|goals|notes|scheduling&version=N&note=:id`.
Roles: manager, agency_admin. The existing "Care Plan" (`/order-management`) is unchanged (Q4).
- **List R:** `list_clients_onboarding(_office_id)` (+ `clients` names via staff RLS), `care_plans`
  (version, status, dates), `service_authorizations` (next expiry).
- **Record spine / onboarding:** `get_client_onboarding_status(_client_id)`; the UI renders the 8 items
  and links each to its tab. "Expired" items (in-service / training after a renewal) say "redo at
  version N".
- **IPOS tab R:** `care_plans` + children, `service_authorizations`, `client_documents`,
  `care_plan_external_services` (reference only). **W:** `create_care_plan`, `update_care_plan_fields`
  (narrative; never bumps a version), `renew_care_plan`, `upgrade_instance_template` (explicit, with
  confirm), `create_service_authorization` (incl. period cap and **opening balance "units used before
  CareMuch"**, shown only on the first entry), `upsert_client_document` (incl. `not_applicable` +
  reason).
- **Goals tab R:** goals/objectives/`objective_measures`, `measure_types`. **W:** `upsert_care_plan_goals`,
  `set_objective_measures`. **Retraining confirmation:** before saving a goal/objective/instructions
  change, the UI checks for an in-service or training form at the plan's current `training_version`
  (`plan_inservice_forms` / `plan_training_records`, readable by managers). If one exists it shows
  "This change requires retraining all caregivers for this client" and saves only after confirm; the
  server applies the same rule. Measure and narrative edits never warn.
- **Progress notes tab R (built in S8):** `list_notes_for_review` filtered to the client; Open / Print per note.
  **W:** `review_progress_note` (Mark reviewed), `return_progress_note` (Submitted only; reason ≥ 10 characters in the UI).
  `void_progress_note` is not exposed in S8. Staff never author or edit notes (Q10).
- **Scheduling tab R:** `shifts`/`shift_assignments` (existing RLS), training rows, `client_orders`.
  Assign/Smart buttons open the **existing** `AssignShiftDialog` / `SmartAssignSheet`; no new assign
  path. **W:** `record_inservice_form`, `record_training_form`.

### 3.3 Caregiver progress note (S7)
Route `/caregiver/notes/:shiftId` inside `CaregiverAppShell`, behind `RequireCaregiverRecord` (a linked caregiver
record, not a role ranking; owner, Oct 5). **Built in S7 (Oct 5).** Flow:
`create_progress_note_for_shift(_shift_id)` → note id (idempotent) → `get_progress_note_for_caregiver(_note_id)`
→ `save_progress_note_draft` (header incl. client arrival time; entries; respite narrative) →
`submit_progress_note` (typed name). A `returned` note shows the reason and reopens for edit. The URL
carries only the shift id. Nothing is cached in local storage.

### 3.4 Eligibility display + enforcement switch (S10)
`EligibilityReport`: the key fix (`${code}-${i}`) and a "Fix →" link per compliance code
(`authorization_*`, `units_short*` → IPOS / Authorizations; `training_missing` → the client's training page;
`credential_missing`, `certification_*` → the caregiver's Credentials tab). Text comes from the server; only
offices with the module (or enforcement) get the grouped care-plan lines, Kind-Care-only offices render as before.
Virtual Office **Compliance card** (S10, done): module status and go-live date (read-only; Turn on via the existing
audited seed RPC), enforcement switch with a confirm that states what changes; admin-only edit through
`set_compliance_enforcement` (audited); managers read-only. Readiness counts in the warning were not built (S11
dashboard panels cover them).

### 3.5 Caregiver profile (S3)
Route `/caregivers/:caregiverId`, staff roles. Tabs: Overview (existing data), Background checks /
Trainings (`credential_types` + `caregiver_certifications`, `ExpiryPill`; **W** `enter_caregiver_credential`,
manager override), Training for clients (`plan_training_records` ⨝ `care_plans`; **W** `record_training_form`,
`override_training_record`).

### 3.6 Weekly Billing (S9)
Route `/billing/weekly`; manager, agency_admin. Office select (agency-wide users) + week picker
starting on the office's `billing_week_start` (Q11 default Monday). **R:** `progress_notes`,
`service_authorizations`, `billing_batches`, `get_billing_batch`, `shifts` (visits without a note).
**Built in S9 (Oct 6):** R `get_billing_week` (bill lines, exclusions with reasons, pending review, batch status) and
`list_billing_week_status` (dashboard line). **W:** `build_billing_batch`, `approve_batch_notes` with the bill's notes ("Approve
week", one confirmed action), `mark_batch_billed` (confirm). Reviews and returns happen in S8 only (the exclusions link there);
`approve_clean_rows` is never used (Q12). Billed weeks are read-only (server-locked). CSV export client-side, units only, on
demand, file `ripple-billing-<office code>-<week start>.csv`.

### 3.7 Form Templates + measure library (S2)
Route `/form-templates`; manager, agency_admin (Q13: publish = agency_admin, or the office's manager
for office shells; agency-wide shells read-only for office managers). **R:** `form_templates`,
`_versions`, `_fields`, `measure_types`; usage counts via new read **G3**. **W:** `save_template_draft`
(new shell or new draft; progress-note shells may be **CLS** or **Respite** via `_service_type`, fixed
after creation), `publish_template_version`. Measure library writes need new **W1** (§4).

### 3.8 Group sessions (S6b, optional until Ripple answers the ratio question)
**Placement with the least change to scheduling:** its own small page `/group-sessions` (Operations
menu, module-gated, roles manager, agency_admin, scheduler), not a change to the Schedule screens.
- Office + date picker; list of sessions for the day (slot, ratio, max clients, linked shifts per
  caregiver vs max).
- **Create session** (`create_group_session`).
- **Link shifts:** a picker listing that office's unlinked shifts in exactly the session's date and
  slot; link/unlink via `set_shift_group_session` (server refuses wrong slot and a second shift for
  the same client).
- Assignment stays in the **existing** Schedule/assign dialogs; the engine applies the group
  exemption and `group_full`. Optional later, display only: a "Group" badge in shift details.
- R: `group_sessions` (manager/agency_admin/scheduler tier), `shifts` (existing RLS).

### 3.9 Navigation (S1)

| Menu group | Label | Route | Module code | Roles (seed + RequireRole) |
|---|---|---|---|---|
| Operations | **Client Care Plans (IPOS)** (Q4) | `/care-plans` | `client_care_plans` | manager, agency_admin |
| Operations | Weekly Billing | `/billing/weekly` | `weekly_billing` | manager, agency_admin |
| Configuration | Form Templates | `/form-templates` | `form_templates` | manager, agency_admin |
| Operations (S6b) | Group Sessions | `/group-sessions` | `group_sessions` | manager, agency_admin, scheduler |
| (no menu) | Client care plan detail | `/clients/:clientId/care-plan` | — | manager, agency_admin |
| (no menu) | Caregiver profile | `/caregivers/:caregiverId` | — | staff |
| (caregiver app) | Progress note | `/caregiver/notes/:shiftId` (+ `/caregiver/notes`) | — | caregiver record (`RequireCaregiverRecord`) |

Items render only when the user can see at least one office with `care_plan_module_enabled` (Q3).
system_admin is not in the clinical tier and gets none of them.

---

## 4. UI-blocking gaps to add inside the slice that needs them

Small additions, built and tested in their slice with the same security baseline as A–D: SECURITY
DEFINER only when needed, fixed `search_path`, `REVOKE ALL FROM PUBLIC, anon` before `GRANT EXECUTE TO
authenticated` (rule 14, `aclexplode` check), `cp_require_scope` with the read tier, generic denial,
ids/counts/dates only (no names or clinical text in what isn't already readable), PGlite test +
rollback proof + DEV suite.

| # | Gap | Kind | Slice | Shape |
|---|---|---|---|---|
| G1 | Credential expiry list with 60/30/overdue bands | read | S3 (used again in S11) | `list_credentials_expiring(_office_id, _within_days default 60)` → caregiver id, credential type, expiry, band; also "required credential missing". Training tier. Office-scoped (the table's own policy is agency-wide). |
| G2 | Authorizations expiring / units at risk | read | S4 (used again in S11) | `list_authorizations_at_risk(_office_id)` → authorization id, client id, service, expiry, units available, projected (scheduled + pending), weekly cap left, "bookable hours". Authorization tier. Reuses `cp_projected_units`. |
| G3 | Template list with usage counts | read | S2 | `list_templates_with_usage(_office_id)` → shell, kind, service type, current version, records per version. All-staff tier. |
| W1 | Measure library create / edit / deactivate | write | S2 | `upsert_measure_type(…)` (agency-scoped; deactivate, never delete in use). Manager, agency_admin. |
| W2 | Correct or void an authorization (**decided Oct 4**) | write | S4 | Authorizations are never deleted. `correct_service_authorization(_id, …changes, _reason)` (manager, agency_admin; audited with the reason, fail-closed) may change the auth number, dates, `units_authorized`, period type / cap and the opening balance, but refuses: `units_authorized` below the units already charged + the opening balance; dates that would exclude any reviewed/billed note's service date; a period cap that the charged units of some existing period already exceed. `void_service_authorization(_id, _reason)` only when nothing has ever been charged or allocated to it. |
| G4 | Readiness counts for the enforcement switch | read | S10 | `get_office_compliance_readiness(_office_id)` → caregivers ready / total, clients with an active authorization / total. Manager, agency_admin. |

Everything else a screen needs is either a manager-tier table read (§1) or an existing RPC (§2).

**Push rule inside a UI slice (owner, Oct 4).** A migration that only ADDS things for the slice (new
read/write RPCs, seeds) may be pushed to DEV once PGlite, its rollback proof and the DEV before-run are
all green, and is reported afterwards. A migration that changes an existing function, policy, trigger,
or anything scheduling-related still stops for owner approval before the push.

---

## 5. Roles and visibility (as built)

| Screen / action | system_admin | agency_admin | manager | scheduler | hr_staff | caregiver | client |
|---|---|---|---|---|---|---|---|
| Ripple menu items (S1) | — | V | V | — (Group Sessions: V) | — | — | — |
| Dashboard compliance section | — | V | V | — | — | — | — |
| Care plans list / detail, intake docs, review notes | — | E | E | — | — | — | — |
| Authorizations | — | E | E | V | — | — | — |
| Credentials + training-form entry | — | E | E | — | E | — | — |
| Caregiver profile view | V | V | V | V | V | — | — |
| Progress note authoring | — | — | — | — | — | E (own) | — |
| Weekly Billing | — | E | E | — | — | — | — |
| Form Templates | — | E | E (office shells) / V (agency-wide) | — | — | — | — |
| Group sessions | — | E | E | E | — | — | — |
| Module / enforcement switches | E | E | V | — | — | — | — |

Office scope: office-restricted staff see and act only on their office (RLS + RPC scope +, since
S-OFF-1, the scheduling write paths). The client portal shows nothing new in V1 (Q6).

### 5.1 `client_orders` vs `care_plans` (unchanged decision, R4/Q2)
`care_plans` is the plan of service (one active per client); `client_orders` stays the recurring
service schedule that generates shifts, unchanged for every agency. They are linked by the nullable
`client_orders.care_plan_id`. No field exists in both. The Care Plan Scheduling tab opens the existing
`OrderWizardDialog`; no second shift generator.

---

## 6. Mobile (390px)

| Screen | Fix in this work? | What |
|---|---|---|
| `AppLayout` (all staff pages) | **S0** | Sidebar starts closed below `md`, scrim with click-outside close, closes on navigation. No change at desktop widths. |
| New screens | Built responsive | Tables in `overflow-x-auto` with key columns first, row → card under `md`, two-column panes stack with a `Sheet` for detail. Acceptance: no horizontal page scroll at 390px. |
| Dashboard (S11), Caregivers / Clients (icons added in S3/S4), Virtual Office (S10) | Partly | Only the wrappers needed for what the slice adds. |
| Schedule, assign dialogs, OrderManagement | No | Scheduling preserved exactly; separate responsive pass later. |
| Caregiver note (S7) | Built for the phone | Sticky Save/Submit footer above the bottom nav; inputs ≥ 16px. |

---

## 7. Slices (order kept: S0 → S1 → S2/S3 → S4–S6 → S7–S9 → S10 → S11)

Every slice: one commit; tests through real logins on DEV with disposable fixtures and verified
teardown; `tsc` / `vite build` / ESLint with no new errors; the **scheduling no-change check** (NB1
suite: Manual, Smart and Auto assign on a Kind Care shift identical); screenshots at 1440 and 390 in
`docs/screenshots/ripple-ui/<round>/`.

| # | Slice | Contents (exact names) | Acceptance |
|---|---|---|---|
| ~~S0a~~ | Route guards | **Done** `419fed0`: `RequireRole`, `roleHome.ts`, S0b `/schedule`, M-SEC-4 menu seeds. | Verified in the security batch. |
| **S0** | Foundations | Regenerate `types.ts` from DEV; `useCurrentProfile()`; `useComplianceOffices()`; `ExpiryPill`, `UnitsBar`, `ProvenanceBadge`; AppLayout mobile sidebar. | tsc/build clean; existing pages unchanged at 1440; sidebar closed at 390 with no page scroll. |
| **S1** | Menu + module gating | Seed `client_care_plans`, `weekly_billing`, `form_templates` (manager, agency_admin); `moduleRouteMap` / icons / order; Q3 gating via `useComplianceOffices()`; three routes with `RequireRole` and empty shells. | Module-office manager sees the 3 items; a Kind-Care-only restricted manager, scheduler, caregiver and client don't, and are redirected on direct URL; NB1. |
| **S2** | Form Templates + measure library | Shell list (+ G3 usage counts), version history, field viewer with storage tags, constrained editor (`save_template_draft` / `publish_template_version`), CLS / Respite note shells; measure library (+ W1). | An office manager edits office shells but only views agency-wide ones; publishing v2 leaves existing instances on v1; a shell missing a spine field can't publish (server message shown); a respite note shell can be created and its service is fixed afterwards; deactivating a used measure works, deleting is impossible. |
| **S3** | Caregiver profile + credentials | `/caregivers/:id` tabs; `enter_caregiver_credential` (hr + manager override); training-for-clients view; G1. | `ExpiryPill` colors at 61/59/29/−1 days; a cross-office caregiver URL shows "not found" for a restricted manager; G1 bands match a fixture. |
| **S4** | Care plan list + IPOS + authorizations | `/care-plans` (`list_clients_onboarding`), detail spine with server onboarding, IPOS tab, `create_service_authorization` incl. per-period cap and **opening balance**, intake docs incl. N/A; G2; W2 if approved. | **Onboarding statuses:** items flip one at a time; "expired" in-service/training after a renewal reads "redo at version N"; onboarded only when all 8 are complete/N/A. A 40-unit authorization with 10 used before CareMuch shows 30 left; a weekly cap shows "N left this week" in `UnitsBar`; the **go-live date** shows read-only; publishing IPOS v2 leaves the plan on v1 with its `ProvenanceBadge` until an explicit upgrade. |
| **S5** | Goals + measures + retraining confirm | Goals tab, measure picker, `upsert_care_plan_goals`, `set_objective_measures`. | Before any training: goal edits save without a dialog. After training at the current version: the **retraining confirmation** appears and, once confirmed, `training_version` is bumped (verified by query); measure edits never warn or bump. |
| S5b *(optional)* | Caregiver self-view of credentials | Read-only section in Profile (existing caregiver self-read policy). | Caregiver sees only own rows. |
| **S6** | Training workflow + Scheduling tab | In-service / training-form sheets (`record_inservice_form`, `record_training_form`), "who can deliver" list, `list_caregivers_needing_retraining`, client schedules + existing `OrderWizardDialog`, existing Assign/Smart buttons. | Renewal → caregivers flip to "retraining needed" and appear on the list; already-assigned shifts stay assigned; after retraining they're assignable again; no new assign code path (grep). |
| S6b *(optional, until Ripple answers the ratio question)* | Group sessions | `/group-sessions` page (§3.8): `create_group_session`, `set_shift_group_session`, menu item `group_sessions` (manager, agency_admin, scheduler). | Two caregivers with 3 clients each in one session assign; a 4th client for one caregiver shows `group_full`; linking the same client twice or a wrong slot shows the server message; Schedule screens unchanged. |
| **S7** (done Oct 5) | Caregiver progress note | `/caregiver/notes/:shiftId`; Today/History buttons, "Notes due"; `create_progress_note_for_shift` → `get_progress_note_for_caregiver` → `save_progress_note_draft` → `submit_progress_note`. | CLS: one block per this_agency objective; respite: narrative required; any late arrival bills 4 → 3 (no grace period since Oct 6: 09:01 is late, 09:00:59 is not); second open returns the same note; **return/resubmit:** a returned note shows the reason, reopens, and resubmits; another caregiver's shift is refused generically; no PHI in URL/storage/console; works at 390. |
| **S8** (done Oct 5) | Staff review + print | `/progress-notes` (queue: Submitted / Returned / Reviewed / Overdue; client, caregiver, week filters; oldest first; menu "Notes to Review" with a count badge; dashboard panel), `/progress-notes/:noteId` (read-only detail, history, Mark reviewed, Return), `/progress-notes/:noteId/print` (paper layout), client Progress Notes tab. New reads `list_notes_for_review`, `get_progress_note_for_staff`, `get_notes_review_counts` (`20261019120000`, fix `20261019120200`); menu seed `20261019120100`. | Review FIFO across two authorizations as the server decides; a **per-period cap** refusal shows "would go over the authorization's weekly cap (N needed, M left this week)" and the note stays submitted; **respite note prints with the respite shell** and CLS with the CLS shell; print has no app chrome. |
| **S9** (done Oct 6) | Weekly Billing | `/billing/weekly`: week picker (office week, last complete week by default), Build week (`build_billing_batch`), bill by client → authorization with totals, "Not in this week's bill" with reasons and fix links, Approve week (one confirmed action = `approve_batch_notes` with the bill's notes; **no bulk "approve clean rows", Q12**), Mark billed (`mark_batch_billed`), Export CSV; dashboard line "Last week: billed / not yet billed". New reads `get_billing_week`, `list_billing_week_status` (`20261021120000`). | Only reviewed notes in the bill, the rest listed with reasons; FIFO across authorizations and the per-period cap shown; units lost to late arrival (no grace period); Approve week only when nothing waits for review and every reviewed note is in the bill; billed locks the batch and its notes (S8 too); CSV totals equal the table; a restricted user can't open another office's week. |
| **S9b** (done Oct 6) | Billing after approval / billing | Same page. Build week on an **approved, unbilled** bill reopens it (approval cleared, note set rebuilt, audited) → approve again. On a **billed** week, "Build supplement N" creates a supplementary bill for the same week (`billing_batches.supplement` 0 = main, 1, 2, …; unique (office, week, supplement)) with only reviewed notes outside every bill; each bill has its own status, totals, Approve, Mark billed and CSV (`…-<week>-s1.csv`). Exclusion "Reviewed after billing: build a supplement". Column "Units left now". Dashboard line: billed only when every bill of the week is billed. Migration `20261022120000` (column + unique swap; `build_billing_batch`, `get_billing_week`, `list_billing_week_status` re-created with the same signatures and grants; no new event type, `billing_batch_built` payload gains `supplement`, `reopened`). | Reopen → re-approve; supplement 1 and 2 bill only late-reviewed notes; no note in two bills; units charged once (at review); rebuild of a billed week with nothing waiting is refused; rollback restores the old bodies and the old unique byte-identical. |
| **S10** (done Oct 6) | Eligibility UI + enforcement switch | `EligibilityReport` key fix (`${code}-${i}`) + care-plan lines with the server text and Fix → links (caregiver Credentials tab via `/caregivers?caregiver=<id>&tab=credentials`, `/training/:clientId`, `/care-plans/:clientId?tab=ipos`); `group_full` reads "Group is full (1:N)"; advisory lines also shown for an eligible pick in Assign; Shift Trades dialog gets the same lines; caregiver Available Shifts shows "Not bookable yet" once. Virtual Office **Compliance** tab (G4): module status (+ Turn on via `seed_office_care_plan_defaults`), enforcement switch through the new audited `set_compliance_enforcement` (owner option 1: one new event type `compliance_enforcement_changed`, `20261023120000`), confirm stating what changes; managers read-only. `check_assignment_eligibility` and every assign path unchanged (md5). | Flag off: compliance issues show as advisory, Confirm enabled, Kind Care identical. Flag on: Blocked with the server text ("N projected units remain", "needs N units; M left this week", `group_full`), Smart omits the caregiver, caregiver Available Shifts shows only "Not bookable yet". |
| **S11** (done Oct 6) | Dashboard compliance section | "Care plan compliance" section (manager, agency_admin; module offices; office picker): clients pending onboarding (`list_clients_onboarding`, "N of 8" + missing items → Onboarding tab), expiring credentials (G1 `list_credential_expirations`, ★ / red / yellow / missing → Credentials tab), units at risk (G2 `list_authorization_risk` → IPOS), caregivers needing retraining (`list_caregivers_needing_retraining`, next shift → client training), notes to review / overdue + last week's billing (the S8 / S9 panel, moved in), enforcement readiness (new `get_enforcement_readiness`, `20261024120000`: switch state, upcoming shifts in 14 days the switch would block, by reason → client schedule; "Compliance settings" → `/virtual-offices/:id?tab=compliance`). Top 5 rows per panel. | Kind-Care-only users see the dashboard exactly as before; counts equal the RPC output on a fixture; every row deep-links to the right record/tab. |
| **S12** (done Oct 7) | Ripple's answers (Oct 6) | **Units:** only full scheduled 15-minute blocks inside [arrival, end] are billed (late arrival AND early departure; `cp_derive_progress_note_units`, `get_billing_week`, `get_billing_batch` re-created with the same signatures, `20261025120000` + same-slice fix `20261025120100` for rows without scheduled times); end time required to submit; caregiver note "Units to bill: N of M" with the reason; S8 detail / print "Units not billed: K (late arrival / left early)"; Weekly Billing "Units not billed (late / early)". **Billing week:** Sunday–Saturday via the existing `billing_week_start` (7). **Group:** 1:3 allowed, advisory above 1:2 (UI-computed). | Every Ripple case (09:00–10:00 → 4, 09:01 → 3, 09:15 → 3, 09:20 → 2, 09:35 → 1, 09:50 → 0, 09:00–09:50 → 3, 09:00–09:44 → 2, 09:20–09:50 → 1) in PGlite and DEV; no backfill; Sat/Sun and month boundaries; supplements on a Sunday week; advisory never blocks. |
| S4b *(optional, owner)* | EligibilityReport soft-vs-hard wording | Display only. | Override flow unchanged. |

---

## 8. Decisions and open questions

All R and Q items from Oct 1 are resolved except **Q11** (billing week; default Monday–Sunday per
office), open with Ripple. **Q12 decided by the owner (Oct 5): per-note review only** — no bulk "approve clean
rows" button, not in S8 and not in S9 (`approve_clean_rows` stays in the backend, unused by any screen); see
`docs/Ripple_UI_Plan_Decisions_2026-10-01.md`. New open items from this refresh:
- **W2 (decided Oct 4):** correct (with the three refusals) or void (only if never charged/allocated); never delete. Built in S4.
  - **Status after S4 (Oct 5):** `correct_service_authorization` is live (additive). **Void: approved and built after round 3 (`20261015120000`).** Before that, the
    table has no voided state, so a voided authorization would still count in `cp_projected_units` (eligibility),
    `review_progress_note`, `cp_client_onboarding` and the order-service check. Building it changes those existing
    functions (one of them scheduling-related) plus a column on `service_authorizations`, so it stops for approval.
    The UI shows Void only when `get_client_authorizations` returns `void_available = true` (false until then).
- **S4b (owner, Oct 5):** intake document file upload is not in V1. It needs a private storage bucket with office-scoped
  storage policies and its own security review. S4 records document metadata only (type, status, dates, N/A reason).
- **S6 decisions (Oct 5):**
  - hr_staff route: `/training` (clients of the office with their training state) and `/training/:clientId` (the two
    forms, the retraining list, print), guarded by `TRAINING_TIER` (hr_staff, manager, agency_admin) + RequireModuleOffice.
    Reached from the Caregiver tab ("Record training ->" per client) and the expirations panel ("Client training ->"); no
    menu item (no seed). Both read `get_client_training_context` / `list_client_training_status`: plan spine only, never goals,
    needs or notes. Print: `/training/:clientId/print/:kind/:formId`, no app chrome.
  - Scheduler: NOT granted the client Scheduling tab (the client page stays manager / agency_admin); schedulers keep the
    full Schedule screen, which `Open full Schedule ->` deep-links with `?client=`.
  - **S6 polish (owner, Oct 5):** filter chips use the primary navy (`FilterChip`; the shared toggle keeps its accent).
    `/training/:clientId` and its dialogs show the client's full name to hr_staff (a name isn't clinical content; HR matches
    the paper forms); the `/training` list still shows first name + initial (`list_client_training_status` returns only that).
    **Case number:** `clients` has no case-number column (nor any table on DEV), so the training print keeps a blank line; the
    prototype's progress-note billing box ("Case number — from client record") hits the same gap in S8/S9.
  - **In-service print: provisional layout, pending Ripple's form sample** (owner will provide a redacted sample). It is
    inferred from the architecture text; the 33.01_01F training form follows arch §1.3 field by field.
- **Owner decisions after round 4 (Oct 5):**
  - **caregiver-app-shell:** option (b) salvage. Archived as tag `archive/caregiver-app-shell-2026-10` (9a83e24); branch
    deleted locally and on origin. Salvaged into S7: `CaregiverAppShell` + bottom nav (Today · Schedule · Notes · Shifts ·
    Profile), Today, Sign out on Profile, the two display fixes (cancelled assignments hidden on the caregiver dashboard;
    `ShiftDetailsDialog` shows Assign only with an `onAssign` handler). Left in the archive: the Schedule stub and design-doc
    phases B–D.
  - **Caregiver route guard:** `RequireCaregiverRecord` (active caregivers row, `user_id = auth.uid()`, user's agency) on every
    caregiver route; a dual-role user reaches both UIs. The role switcher stays a known issue.
  - **`/training` list full names:** `list_client_training_status` returns `client_name` (`20261017120000`, changed function).
  - **Case number:** nullable `clients.case_number` (trimmed, 1–32, CHECK), not client-editable (M-SEC-2 allow-list, unchanged).
    Edited in the existing client dialog and on the care-plan header (same staff UPDATE path as that dialog; no new RPC);
    shown on the IPOS card and both training prints (`get_client_training_context` + `case_number`). Managers read it with the
    client row for the S8/S9 billing footer.
- **S7 (Oct 5):** new caregiver-safe reads `get_caregiver_clock()` (DB clock, office time zone, office week start) and
  `list_my_notes_due()` (own started shifts in module offices after go-live; 13 keys; open work at any age, history 60 days)
  in `20261018120000`. Note page `/caregiver/notes/:shiftId`: in-memory state only, Save + 2 s debounced autosave, "Not saved —
  retry", submit sheet (typed name, attestation, server time), returned banner, read-only after submit. Times are entered as
  HH:MM in the office time zone; the UI shows only "Late arrival recorded" (the server's flag). **No grace period (owner,
  Oct 6):** any arrival after the scheduled start at minute precision loses the first unit (`20261020120000`); the earlier
  "more than 5 minutes" threshold was a misreading of Ripple's example. The full rule (1-4 minutes, longer delays, early
  departure) is pending Ripple question 4 (known-issues). Today's "N shifts you can pick up" counts only shifts the caregiver eligibility returns as
  bookable.
- **S8 (owner decisions, Oct 5, final):**
  - **Return: Submitted notes only.** `return_progress_note` is unchanged. A Reviewed note is never returned; the program lead
    returns a note before marking it Reviewed. This is the intended workflow, not a known issue.
  - **Return reason ≥ 10 characters (trimmed), UI only:** the Return button stays disabled with a hint until it is met; the
    server keeps its non-empty check (known-issues).
  - **Per-note review only (Q12).** "Mark reviewed" calls `review_progress_note` (billable; FIFO authorization chosen by the
    server, its refusal shown and the note stays submitted). Non-billable review is not offered in S8.
  - **Differences from the schema plan:** the FIFO authorization is chosen at review (the live code), not at submit; the
    staff detail shows the one review *would* use as "FIFO, at review" for a submitted note. Overdue includes visits with no
    note yet (started, past the day-after deadline). The audit uses the existing event types (no CHECK change).
  - **History:** from the audit events (who / when). Only the latest return reason is kept on the note, so earlier returns show
    who and when without their reason (known-issues).
  - **Same-slice fix:** `20261019120200` re-creates the new `get_progress_note_for_staff` (same signature) so a note that is
    neither submitted nor linked to an authorization (right after a return) reads; found by round6, rollback-proven.
- **S9 (owner decisions Oct 6, final):** per-note review only (Q12: no bulk approve anywhere); Q11 still open, default Monday–Sunday
  per office in the office time zone; units lost to late arrival = 1 per late note (no grace period, Part 0 of round 7).
  - **Batch behaviour (S9b, owner-approved Oct 6):** a note reviewed after the build but before approval is picked up by "Build week".
    After **approval** (not billed), "Build week again" reopens the bill: approval cleared on its notes, the note set rebuilt,
    audited (`billing_batch_built` with `reopened: true`), then approved again. After **billing**, a later-reviewed note shows
    "Reviewed after billing: build a supplement"; "Build supplement N" makes a supplementary bill for the same week with only
    reviewed notes outside every bill, with the same approve → mark billed → lock → CSV flow (`-s<N>` file suffix). A note can be in
    one bill only (single `billing_batch_id`); units are charged once, at review. "Approve" is still enabled only when nothing waits
    for review and every reviewed note is in the bill.
  - "Units left now" (column renamed in S9b) shows the authorization's units and period cap left **now** (later reviews included).
- **S10 (owner decisions Oct 6):** the switch is audited through a new RPC `set_compliance_enforcement` and one new event
  type `compliance_enforcement_changed` (option 1); the Compliance card uses only that RPC. The existing direct UPDATE of the
  flag and its admin-only guard trigger are unchanged (a direct update bypasses the audit: known-issues, close before
  production). Turning enforcement on requires the module on. `group_full` is hard on the server whatever the switch
  (unchanged engine), so it shows Blocked even with enforcement off.
- **Ripple's answers (Oct 6), applied in S12:** **Q11** billing week = **Sunday–Saturday** (per office,
  `billing_week_start` = 7; Ripple's default). **Q4** units = only **full 15-minute blocks** the client attends between
  arrival and end (late arrival and early departure; no grace period). **Q5** group ratio = up to **1:3** allowed, **1:2**
  preferred (advisory above it, never blocking).
- **S6b:** group sessions wait for Ripple's staff:client ratio answer (default 1:3, office default
  max clients 3).
- E-signature acceptance and notifications (R9) remain later phases (known-issues).

The Oct 1 conflict and question tables (former §7.1, §7.2) are kept in git history (this file before
the Oct 4 refresh).

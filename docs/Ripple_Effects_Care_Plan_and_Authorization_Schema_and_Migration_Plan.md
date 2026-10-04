# Ripple Effects — Care-Plan & Authorization Module: Schema & Migration Plan (for Claude Code)

> **Status: PLAN ONLY. Nothing here has been applied. STOP for review before any push.**
> Companion to `Ripple_Effects_Care_Plan_and_Authorization_Module_Architecture.md` — that
> doc is the *why*; this is the *what to build*. Same discipline as
> `m-office-scoping-plan.md`: additive-only, tenancy through the proven helpers, every
> `SECURITY DEFINER` REVOKE-before-GRANT, migrations shown for review before push, and the
> two §9 tests as the done-definition — not a code review.

> **UPDATE (Sep 30, 2026):** aligned with the architecture doc §9.1/§9.2 and Bren's Sep 30
> answers: (a) `form_template_kind` spans all form types — nothing is hard-coded; (b)
> per-client training keys to the **IPOS training version** (`training_version`); (c)
> `service_notes` gains `care_plan_objective_id` and `checklist_state` — checklist and
> service note are two separate fields; (d) the authorization + its services render
> **inside the IPOS**, and the in-client Scheduling view is a **summary that links to the
> existing Schedule Management module**, never a second scheduler.

> **UPDATE (Oct 1, 2026) — template-model pass (arch §11).** Changes in this doc:
> (a) the two layers are named — **Layer A agency shells** (§3) and **Layer B instances**
> (§3.1), with one instance contract (`template_id`, `template_version`, `field_snapshot`,
> `field_values`) on every instance table; (b) shell fields declare `storage` and
> `seeds_checklist`, and Service Note shells carry a `checklist_rule`; (c) the care-plan
> spine gains the IPOS sections the first draft skipped — treatment needs, MichiCANS DSM
> recommendations, natural supports, other-provider services — and moves
> `service_type` / `responsible_party` from goal to **objective**; (d) new
> `care_plan_checklist_items` (derived, manager-curated) and a defined `checklist_state`
> snapshot shape; (e) **intake documents on their own track** (`client_documents`, §5.1);
> (f) training form split into header + per-caregiver rows, and `credential_types` gains the
> **background_check** category; (g) the Care Plan module **ALTERs existing tables** and
> **reuses** the Schedule + Manual/Smart/Auto Assign engine — only
> `check_assignment_eligibility` changes.

> **UPDATE (Oct 1, 2026, afternoon) — Progress Notes (arch §1.5, §11.3).** Lauren's three
> CLS progress notes replace the "service note + derived checklist" design:
> `service_notes` → **`progress_notes`** (one per delivered shift) + **`progress_note_entries`**
> (one per Ripple objective: Notes + Data) + **`progress_note_observations`** (caregiver
> "Additional observation", promotable). The derived checklist (`care_plan_checklist_items`,
> `checklist_rule`, `seeds_checklist`, `checklist_state`) is **removed**; per-objective data
> questions are **`objective_measures`** drawn from an agency **`measure_types`** library.
> Respite shifts create **no** progress note (Respite = no goals). Billing footer / batching
> are pending Lauren (arch §11.8) — the columns are included but the billing workflow is not
> built until answered. Items (b)–(d) of the earlier Oct 1 update below are superseded where
> they mention the checklist.

> **UPDATE (Oct 1, 2026, evening) — Bren's answers (arch §12, authoritative).** Changes here:
> `goals_version` renamed **`training_version`** and bumped on **every new IPOS version**
> (renewal or goals change); `progress_notes.note_kind` (`cls` | `respite`) + `narrative_text`
> — respite visits get a **Respite Progress Note**; **`progress_note_observations` and the
> promote flow removed**; new **`plan_inservice_forms`** (CM → Bren, step 1 of training);
> new **`billing_batches`** (weekly billing, Bren reviews); **late arrival = first unit lost**
> (`units_used = units_scheduled − 1`); units only; notes printable; onboarding = 8 items.

> **UPDATE (Oct 4, 2026) — owner decisions applied (`docs/Ripple_UI_Plan_Decisions_2026-10-01.md`,
> authoritative; where it conflicts with anything here, it wins).** Arch §12 (Bren's answers) stays
> authoritative for workflow. Changes in this doc:
> - **R7:** the §2 RLS shape is the **live** M-Office predicate.
> - **New §2.1:** a security baseline from the October 2026 security batch.
> - **R4/Q2:** `care_plans` is a **new** table. `client_orders` is unchanged except a nullable
>   `care_plan_id`; `order_services` gets an optional display-only `service_authorization_id`.
> - **R2:** new office-scoped `office_service_types`.
> - **R3:** `caregiver_certifications` is extended; no `caregiver_credentials` table.
> - **R1:** one shift per client; no `shift_clients`.
> - **R8/Q1, Q3:** two guarded flags on `virtual_office`.
> - **Q9:** `client_arrived_at`; late = more than 5 minutes.
> - **Q10:** a `returned` status with a reason.
> - **Q7:** `not_applicable` intake status.
> - **Q11:** `billing_week_start`.
> - **Q14:** draft/published shell versions.
> - **Q13/Q15:** publish roles and shell precedence.
> - **R5/R6:** caregiver-safe reads.
> - **Phase A is drafted** in `supabase/migrations/20261006120000…120700` (not pushed).
>
> Every conflict found between the docs, and how it was resolved, is listed in §13.

> **Hard preconditions before starting (do not assume, verify live, read-only):**
> 1. M-Office is applied: `profiles.virtual_office_id`, `current_virtual_office_id()`,
>    `is_office_restricted()` exist and the two-office test passed. This module composes on
>    top of that three-tier pattern; if it isn't there, STOP.
> 2. `check_assignment_eligibility` returns the hard/soft/advisory jsonb contract as
>    documented in the scheduling Phase 1B plan, and is the function the Manual / Smart /
>    Auto Assign paths call. Confirm its exact current signature and every caller before §7
>    edits it.
> 3. Confirm the exact live names of the shift/assignment tables and the `shifts` office
>    column (M-Office added `shifts.virtual_office_id`) — §5 and §7 depend on them.
> 4. Confirm the live care-plan structure (`client_orders` and any `care_plans`-like table)
>    — ALTER additively if it exists, never a parallel table (dev-rule 7). Same check for
>    any existing **client documents / attachments** table before §5.1, and any existing
>    **caregiver certifications** table before §8 (Phase 1B Rule F reads certifications —
>    extend that table rather than duplicate it if it fits).
>
> **Verified 2026-10-04 (read-only):**
> 1. M-Office is live (`current_virtual_office_id()`, `is_office_restricted()`,
>    `profiles.virtual_office_id`).
> 2. `check_assignment_eligibility(_shift_id uuid, _caregiver_id uuid)` is the function every
>    assign path calls. It is **not touched in Phase A**.
> 3. The live tables are `shifts` (with `virtual_office_id`) and `shift_assignments`.
> 4. Existing tables:
>    - `client_orders` is a recurring service schedule, so `care_plans` is **new** (R4);
>    - no client-documents table exists, so one is created;
>    - `caregiver_certifications` exists and is **extended** (R3).

---

## 1. Migration set & ordering (the footgun map)

Build as **separate, reviewable migrations in this order.** Ordering is not cosmetic — two
filed footguns make order load-bearing:

- **`LANGUAGE sql` bodies validate column refs at CREATE time** → every column a function
  reads must exist in an *earlier* migration. (The Phase 0 rollback was exactly this.)
- **`CREATE OR REPLACE FUNCTION` with a changed signature creates a second overload** that
  does NOT inherit REVOKEs → default anon/PUBLIC EXECUTE. Never change a signature with
  `OR REPLACE`; `DROP FUNCTION` the old signature first, then create. (This reopened anon
  EXECUTE twice already.)

```
M-CP-01  office + shells  virtual_office flags (+guard trigger) + billing_week_start; scope helpers;
                          form_templates, form_template_versions (draft|published), form_template_fields
M-CP-02  care-plan spine  measure_types; care_plans (NEW, R4) + all children + objective_measures;
                          client_orders.care_plan_id (nullable, same-client guard)
M-CP-03  authorizations   office_service_types (R2), service_authorizations, billing_batches,
                          progress_notes, progress_note_entries;
                          order_services.service_authorization_id (nullable, display only)
M-CP-03b intake track     client_documents (NEW: no existing table)
M-CP-04  credentials      credential_types; ALTER caregiver_certifications (R3);
                          plan_inservice_forms, plan_training_forms, plan_training_records
M-CP-05  units triggers   derived units_used / arrived_late / units_available  (AFTER M-CP-03)
M-CP-06  eligibility      Phase C: new rules in check_assignment_eligibility behind the office flag
M-CP-07  system rows      the eight measure_types as SYSTEM rows (agency_id NULL), every agency uses them
                          (agency-specific rows -> scripts/seed/ripple_dev_reference_seed.sql, DEV only)
(every table above: RLS on, SELECT-only role-tiered policy, anon nothing — §2, §2.1)
```

M-CP-06 is last and stands alone: it changes the signature of an existing, security-critical
function, so it must be `DROP FUNCTION` + recreate (not `OR REPLACE`), with an explicit
`REVOKE ALL ... FROM PUBLIC, anon;` then `GRANT EXECUTE ... TO authenticated;` re-stated in
the same migration — the moment the drop happens the grants are gone and must be rebuilt
deliberately. If the signature does **not** need to change (new rules read only existing
args), prefer keeping the signature and use `CREATE OR REPLACE` with an identical
signature — confirm by diffing `pg_get_function_identity_arguments` before and after.

---

## 2. Shared conventions (apply to every table below)

- Every table: `id uuid PK default gen_random_uuid()`, `agency_id uuid NOT NULL`,
  `virtual_office_id uuid` (nullable; NULL = agency-wide, per M-Office convention),
  `created_at timestamptz default now()`, `created_by uuid default auth.uid()`.
- Every table: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` immediately after create.
- **The one RLS policy shape — corrected Oct 4 (owner decision R7).** It uses the **live** M-Office
  predicate, `NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()`,
  not the earlier draft's `current_virtual_office_id() IS NULL OR …`. With the live predicate, a row
  whose office is NULL **fails closed** for office-restricted staff.
  - **Role-tiered reads (owner review, Oct 4: minimum necessary).** The predicate is wrapped once in
    `cp_staff_in_scope(agency_id, virtual_office_id, _roles app_role[])`: the caller holds one of
    the table's roles + agency + live office predicate. The parent-scope helpers apply the same
    role set as their table.
  - Policies are **SELECT only**: writes go through RPCs (§2.1).
  - There is **no cross-agency `system_admin` bypass**. A system_admin reads only the tiers that
    list it (shells, measure types).

  | Tier | Roles | Tables |
  |---|---|---|
  | Clinical | manager, agency_admin | `care_plans` + every plan child (goals, objectives, objective_needs, objective_measures, attendees, needs, treatment_needs, dsm_recommendations, natural_supports, external_services, reviews), `progress_notes`, `progress_note_entries`, `client_documents`, `billing_batches` |
  | Authorizations | manager, agency_admin, scheduler | `service_authorizations`, `office_service_types` |
  | Training | manager, agency_admin, hr_staff | `credential_types`, `plan_inservice_forms`, `plan_training_forms`, `plan_training_records` |
  | Shells (no PHI) | all agency staff | `form_templates` / `_versions` / `_fields`, `measure_types` (system rows + own agency) |

```sql
CREATE FUNCTION public.cp_staff_in_scope(_agency_id uuid, _office_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    EXISTS (SELECT 1 FROM unnest(_roles) r WHERE has_role(auth.uid(), r))
    AND _agency_id = current_agency_id()
    AND ((NOT is_office_restricted(auth.uid())) OR _office_id = current_virtual_office_id()),
    false)
$$;

CREATE POLICY "Managers read <table> in scope" ON public.<table>
FOR SELECT TO authenticated
USING (cp_staff_in_scope(agency_id, virtual_office_id, '{manager,agency_admin}'::public.app_role[]));
```

  - Rows with no office (`credential_types`, agency `measure_types`, agency-wide shells) use
    `cp_staff_in_agency(agency_id, _roles)`.
  - System `measure_types` rows (`agency_id IS NULL`) are readable by any staff member.
  - Agency-wide shells (`form_templates.virtual_office_id IS NULL`) are readable by
    office-restricted staff through one explicit extra clause (Q15, §3).
  - **UI consequence:** scheduler and hr_staff do not see the Client Care Plan page's clinical
    content. Scheduler works from authorizations and the schedule; HR enters credentials and
    training through Phase B RPCs.

- Child tables with no own `agency_id` (goals, objectives, attendees, needs, treatment needs, DSM
  recommendations, natural supports, external services, objective measures, progress-note entries,
  reviews) derive scope from their parent.
  - The derivation is a `SECURITY DEFINER` boolean helper: `cp_care_plan_in_scope`,
    `cp_care_plan_goal_in_scope`, `cp_care_plan_objective_in_scope`, `cp_progress_note_in_scope`,
    `cp_form_template_readable` / `cp_form_template_version_readable`.
  - Each helper applies `cp_staff_in_scope` to the parent row.
  - No new column on the child. The helper is created AFTER its parent table (LANGUAGE sql
    ordering rule). Example:

```sql
CREATE FUNCTION public.cp_care_plan_in_scope(_care_plan_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT cp_staff_in_scope(p.agency_id, p.virtual_office_id)
                   FROM public.care_plans p WHERE p.id = _care_plan_id), false)
$$;
REVOKE ALL ON FUNCTION public.cp_care_plan_in_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cp_care_plan_in_scope(uuid) TO authenticated;
```

Child RLS then reads the parent's scope, not a duplicated column — same discipline as
`shift_assignment_agency_id()`. (`progress_notes` is the exception — it carries its own
`agency_id`/`virtual_office_id`; see §5.)

- **Row consistency:** `cp_check_row_scope()` (a BEFORE INSERT/UPDATE trigger on every table with
  `agency_id`) requires the row's office, client and caregiver to belong to the row's agency. It
  applies to every writer, service role and RPCs included.
- **Link columns on existing tables:** `client_orders.care_plan_id` and
  `order_services.service_authorization_id` stay directly writable under those tables' existing
  staff policies, and FK checks ignore RLS. Two narrow guards therefore require the same client.

## 2.1 Security baseline for new tables and RPCs (from the October 2026 security batch)

This applies to every Phase A–D table, RPC and route of this module. A change that doesn't meet it
is a review blocker.

1. **RLS on every new table.**
   - Staff access = agency scope + the live M-Office predicate + the M-SEC-1 staff-role check
     (`cp_staff_in_scope`, §2).
   - **Caregivers get no direct table access** to clinical tables: plans, goals, objectives,
     measures, needs, authorizations, notes, entries, documents, training.
     - They read only through scoped `SECURITY DEFINER` RPCs (`get_progress_note_for_caregiver`, R5).
     - They write only through RPCs.
   - **Clients and anon get nothing** (Q6: no client/family view in V1).
2. **Every write path is an RPC.**
   - Phase A creates **SELECT-only** policies.
   - Table privileges: `REVOKE ALL` from `anon`; `authenticated` keeps `SELECT` only (no INSERT,
     UPDATE, DELETE, **TRUNCATE**, REFERENCES, TRIGGER). Supabase's default privileges grant
     everything to `anon` and `authenticated` on every new table, so the revokes are explicit in
     each migration.
   - CLAUDE.md rules 13/14 apply:
     - `DROP FUNCTION` the old signature (matched by `pronargs`) before re-creating;
     - `REVOKE ALL ... FROM PUBLIC, anon` before any `GRANT`;
     - check `aclexplode(proacl)` right after the push;
     - trigger functions get no GRANT.
3. **Authority columns can't be changed by direct UPDATE.** These are flags, status, units,
   billable, signatures, reviewed/returned/billed by-and-at.
   - Derived values (`units_used`, `arrived_late`, `units_available`) are computed by triggers that
     overwrite whatever a writer sends (§6).
   - The two `virtual_office` flags **and `billing_week_start`** have an M-SEC-2-style guard trigger
     (agency_admin / system_admin only), because `virtual_office` keeps its existing staff UPDATE
     policy.
   - If a later phase adds a direct-write policy to a care-plan table, it must come with an
     allow-list guard trigger:
     - M-SEC-2 pattern: everything not listed is frozen;
     - the service role (`auth.uid() IS NULL`) is not blocked.
4. **Audit events for sign / submit / review / return / bill**, written by the Phase B RPCs.
   - New event types need an `events_event_type_check` migration **before** the RPCs that write
     them (M-SEC-6 lesson).
   - Audited writers insert the `events` row directly and **fail closed**: no audit row means the
     action rolls back. They don't use `log_event()`, which swallows errors.
   - Payloads carry ids and status, never note content.
5. **New routes use RequireRole** (CLAUDE.md rule 15), with role sets from `src/lib/roleHome.ts`.
6. **Fixtures only.**
   - Tests use disposable fixtures with teardown verified by re-query.
   - The redacted Ripple documents are workflow models and are **never seeded**.
   - M-CP-07 seeds reference rows only.

---

## 3. M-CP-01 — Layer A: agency shells (the backbone)

Nothing in this module is a hard-coded form. The IPOS, Authorization, Progress Note, Training
form, and intake documents are all **kinds of shell**, managed only in **Configuration →
Form Templates**:

```sql
CREATE TYPE form_template_kind AS ENUM
  ('ipos','authorization','progress_note','inservice','training','intake','credential');
  -- 'inservice' added Oct 4: the IPOS In-service form (arch §12) is its own shell
CREATE TYPE form_template_version_status AS ENUM ('draft','published');   -- Q14
CREATE TYPE form_field_storage AS ENUM
  ('spine_column','child_rows','field_value','static_text');

CREATE TABLE public.form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  name text NOT NULL,
  kind form_template_kind NOT NULL,
  intake_doc_type text,                -- kind='intake' only: consent|insurance|emergency_contacts|allergies|assessment|release_of_information
  is_required_for_client boolean NOT NULL DEFAULT false,  -- intake: counts toward "missing documentation"
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  CHECK ((kind = 'intake') = (intake_doc_type IS NOT NULL))
);

CREATE TABLE public.form_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status form_template_version_status NOT NULL DEFAULT 'draft',   -- Q14: server-side drafts
  is_current boolean NOT NULL DEFAULT false,     -- CHECK (NOT is_current OR status = 'published')
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ordered section metadata + static text blocks
  published_by uuid, published_at timestamptz,
  note_layout jsonb,                             -- progress_note shells only; see below
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (template_id, version)
);
-- exactly-one-current guard (partial unique index):
CREATE UNIQUE INDEX one_current_version_per_template
  ON public.form_template_versions (template_id) WHERE is_current;
-- at most one open draft per shell (Q14; no localStorage drafts):
CREATE UNIQUE INDEX one_draft_version_per_template
  ON public.form_template_versions (template_id) WHERE status = 'draft';

CREATE TABLE public.form_template_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_version_id uuid NOT NULL
    REFERENCES public.form_template_versions(id) ON DELETE CASCADE,
  field_key text NOT NULL,            -- stable key used in field_values / field_snapshot
  section text,
  label text NOT NULL,
  field_type text NOT NULL,           -- text|longtext|number|date|select|checkbox|units|money|table
  storage form_field_storage NOT NULL,
  writes_to_entity text,              -- spine_column/child_rows: 'care_plan' | 'care_plan_objective' | 'service_authorization' | ...
  writes_to_column text,              -- spine_column: the fixed column this field populates
  shown_on_progress_note boolean NOT NULL DEFAULT false,  -- IPOS shells: goal/objective/Instructions for Staff
  default_value text,                 -- e.g. ISK standard discharge-criteria text
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  options jsonb,                      -- select/table option lists (DSM outcome codes, treatment domains, ...)
  UNIQUE (template_version_id, field_key)
);
```

**`note_layout` shape** (Progress Note shell; arch §11.3):

```json
{
  "header": ["client","service_date","completed_on","staff_client_ratio","start_time","end_time","location","staff_name","staff_signature"],
  "objective_block": ["goal","objective","service_tag","staff_instructions","notes","data"],
  "notes_prompt": "include reinforcers",
  "billing_footer": {"enabled": true, "fields": ["case_number","units_scheduled","units_billed","biller_name","biller_signature"]}
}
```

**Measure library (Layer A).** A catalog of data-question types. **Corrected Oct 4 (owner review):**
the eight generic types seen in Ripple's notes are **system rows** (`agency_id NULL`, seeded by
M-CP-07). Any agency's staff can read them, and any agency's objectives can reference them. An agency
may add its own rows (`agency_id` set) through a Phase B RPC. System rows are read-only to agencies.

```sql
CREATE TYPE measure_kind AS ENUM
  ('yes_no_na','prompt_level','graded_steps','tally','trials','short_answer','narrative','staff_note');

CREATE TABLE public.measure_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid,                       -- NULL = system row (unique label among system rows)
  kind measure_kind NOT NULL,
  label text NOT NULL,                  -- e.g. 'Highest prompt level used'
  default_options jsonb,                -- e.g. ["Gestural","Visual","Verbal","Modeling","Partial physical"]
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now()
);
```

RLS (as drafted): `(agency_id IS NULL AND is_agency_staff(auth.uid())) OR
cp_staff_in_agency(agency_id, <all staff roles>)`. There is no office column.

**Spine-column guard:** a shell may relabel or reorder a `spine_column` field but
`publish_template_version` must reject a version that **drops** a spine column the engine
requires for that kind (e.g. authorization without `units_authorized` / `effective_date` /
`expiration_date`; IPOS without `effective_date` / `expiration_date`). This keeps "fixed
spine underneath" true no matter what a manager publishes.

RLS: `form_templates` uses the §2 shape (all-staff tier) plus one read clause for agency-wide shells
(`virtual_office_id IS NULL AND cp_staff_in_agency(agency_id, <all staff roles>)`). An office-restricted user can then
read the agency shell their office falls back to (Q15). `versions` and `fields` derive scope through
`cp_form_template_readable(template_id)` / `cp_form_template_version_readable(template_version_id)`
(created after their parents). Do NOT add agency_id to versions/fields.

**Owner decisions on shells (Oct 4):**
- **Q13 — V1 edit scope is constrained.** Allowed: labels, help/static text, options, required,
  order, add/remove `field_value` fields, and billing-footer fields. Not allowed in V1: new
  `child_rows` structures or new shell kinds.
- **Q13 — who publishes.** `publish_template_version` (Phase B) checks the caller:
  - an office shell: `agency_admin` / `system_admin`, or a `manager` whose scope includes that office;
  - an agency-wide shell: `agency_admin` / `system_admin` only.
- **Q14 — drafts are server-side.** A draft is a `form_template_versions` row with
  `status = 'draft'`, at most one per shell. Publish flips it to `published` + `is_current` and
  retires the old current version, in one transaction.
- **Q15 — precedence.** When creating an instance, the create RPC uses the office's own active
  shell of that kind if one exists, otherwise the agency-wide shell.

**`is_current` transition is a write-path invariant, not a UI concern:** publishing a new
version must, in one transaction, set the old current to false and the new to true. Put this
behind a `SECURITY DEFINER` RPC `publish_template_version(_template_id, _sections,
_note_layout, _fields)` (REVOKE/GRANT per rule #14) so two managers can't race two
"current" versions past the partial index. The index is the backstop; the RPC is the
correct path.

## 3.1 Layer B instance contract (applies to every instance table)

Every instance table — `care_plans`, `service_authorizations`, `progress_notes`,
`client_documents`, `plan_training_forms` — carries:

```sql
template_id      uuid REFERENCES public.form_templates(id),
template_version integer,
field_snapshot   jsonb,   -- the shell's field defs + static text at fill time (arch §4 rule 3)
field_values     jsonb NOT NULL DEFAULT '{}'::jsonb   -- values for storage='field_value' fields, keyed by field_key
```

Rules:
- `spine_column` fields are written to real columns; `child_rows` fields to child tables;
  only `field_value` fields go in `field_values`. The engines never read `field_values`.
- `field_snapshot` is written once at create (by the create RPC from the current shell
  version) and is **not** editable by the client UI. Instance values stay fully editable.
- Re-shaping an existing instance onto a newer shell is an explicit RPC
  (`upgrade_instance_template(_table, _id)`) that rewrites the snapshot and migrates
  `field_values` by `field_key`; never implicit.
- `progress_notes` stores `template_id`/`template_version`/`field_snapshot` (the Progress
  Note shell's layout); each `progress_note_entries` row stores `measures_snapshot` (the
  questions as asked that visit). Add `field_values` only if the shell adds custom header
  fields (cheap, nullable).

---

## 4. M-CP-02 — Care-plan spine (extends existing Care Plan module)

> **Resolved Oct 4 (owner decision R4/Q2): CREATE.** `client_orders` (today's "Care Plan" menu)
> is a recurring **service schedule** that generates shifts. A client can have several active
> orders, and wizard edits regenerate shifts. It is not a plan of service.
> - ALTERing it would break existing behavior (dev rule 8).
> - So `care_plans` is a **new** table. `client_orders` is unchanged except a nullable
>   `care_plan_id` link: set when a Ripple manager creates a schedule from the plan, NULL for every
>   existing and Kind Care order. A same-client guard trigger protects it.
> - No field exists in both, so dev rule 7 holds: units live only in authorizations, recurrence
>   only in `order_services`, goals only in `care_plan_goals`.
> - Optional `order_services.service_authorization_id` is display only (M-CP-03).

```sql
CREATE TYPE care_plan_status AS ENUM ('active','superseded','expired');
CREATE TYPE care_plan_type   AS ENUM ('initial','annual','addendum');

CREATE TABLE public.care_plans (               -- NEW table (R4, Oct 4); see note above
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,          -- plan record version
  training_version integer NOT NULL DEFAULT 1, -- bumps on EVERY new IPOS version (renewal or goals change); gates retraining
  status care_plan_status NOT NULL DEFAULT 'active',
  plan_type care_plan_type NOT NULL DEFAULT 'annual',
  meeting_date date,
  effective_date date,
  expiration_date date,
  next_review_date date,
  review_frequency text,                       -- 'quarterly' etc. (options from the shell)
  michicans_date date,
  facilitator_name text,
  recorder_name text,
  discharge_criteria text,
  signed_by text, signed_date date,
  template_id uuid REFERENCES public.form_templates(id),
  template_version integer,
  field_snapshot jsonb,                        -- frozen field defs at fill time (arch §4 rule 3)
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,  -- hopes & dreams, strengths, needs, abilities, preferences, barriers, ABD type, crisis plan, ...
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now()
);
-- one active plan per client (partial unique):
CREATE UNIQUE INDEX one_active_plan_per_client
  ON public.care_plans (client_id) WHERE status = 'active';

CREATE TABLE public.care_plan_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  seq integer NOT NULL,                 -- sequence order, preserved in the UI
  goal_text text NOT NULL,
  target_start date, target_end date
);
-- NOTE (Oct 1): service grouping moved to the objective — one IPOS goal can mix a CM
-- objective with a respite objective. The Goals tab groups by the objectives' service_type.

CREATE TYPE objective_responsible_party AS ENUM
  ('this_agency','case_management','evaluator','family','other_provider');

CREATE TABLE public.care_plan_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.care_plan_goals(id) ON DELETE CASCADE,
  letter text,                          -- 'A','B' per IPOS structure
  seq integer NOT NULL DEFAULT 0,
  objective_text text NOT NULL,
  staff_instructions text,              -- IPOS "INSTRUCTIONS FOR STAFF" → shown read-only on the progress note; may be NULL
  service_type text,                    -- 'cls' | 'respite' | ... ; NULL when not this agency's
  responsible_party objective_responsible_party NOT NULL DEFAULT 'this_agency',
  target_start date, target_end date
);

CREATE TABLE public.care_plan_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  name text, relationship text, attended boolean, contributed boolean
);

CREATE TABLE public.care_plan_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('michicans','other')),
  item_kind text NOT NULL DEFAULT 'need'
    CHECK (item_kind IN ('need','centerpiece_strength','strength_present')),
  domain text, item_text text, level_of_need text,
  addressed boolean, additional_info text
);

CREATE TABLE public.care_plan_treatment_needs (     -- the "Need identified to be addressed in treatment" grid
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  domain text NOT NULL,                 -- row list comes from the IPOS shell's options
  to_address boolean NOT NULL DEFAULT false,
  new_need boolean NOT NULL DEFAULT false,      -- planning flag for the CM
  treatment_recommendation text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE public.care_plan_objective_needs (     -- which treatment needs an objective addresses
  objective_id uuid NOT NULL REFERENCES public.care_plan_objectives(id) ON DELETE CASCADE,
  treatment_need_id uuid NOT NULL REFERENCES public.care_plan_treatment_needs(id) ON DELETE CASCADE,
  PRIMARY KEY (objective_id, treatment_need_id)
);

CREATE TABLE public.care_plan_dsm_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  service text NOT NULL,
  outcome_code text NOT NULL,           -- '01','03',... (option list on the shell)
  notes text
);

CREATE TABLE public.care_plan_natural_supports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  name text, support_type text CHECK (support_type IN ('natural','professional')),
  status text, how_they_help text
);

CREATE TABLE public.care_plan_external_services (   -- other providers' IPOS authorization lines; REFERENCE ONLY
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  provider_program text, auth_reference text, service text,
  effective_date date, expiration_date date, units_text text, description text
);  -- never read by the units trigger or eligibility engine

CREATE TABLE public.objective_measures (          -- the DATA questions for one objective (arch §11.3)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES public.care_plan_objectives(id) ON DELETE CASCADE,
  measure_type_id uuid NOT NULL REFERENCES public.measure_types(id),
  seq integer NOT NULL DEFAULT 0,
  prompt_text text NOT NULL,            -- e.g. 'Did the client practice brushing their teeth?'
  options jsonb,                        -- overrides: ladder steps, tally labels, trial answer label
  trial_count integer,                  -- kind='trials' only
  is_active boolean NOT NULL DEFAULT true
);
-- Managed by the manager / clinical lead on the Goals tab. Editing measures does NOT bump
-- training_version (no retraining). Only objectives with responsible_party='this_agency' get measures.

CREATE TABLE public.care_plan_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id uuid NOT NULL REFERENCES public.care_plans(id) ON DELETE CASCADE,
  review_date date, next_review_date date, notes text
);
```

**Plan renewal is a version transition, not an edit:** creating a new annual IPOS inserts a
new `care_plans` row (version+1, status active) and sets the prior row to `superseded` in
one transaction — behind an RPC, same reasoning as §3's publish path. Never mutate an active
plan's identity in place; history must be preserved (Bren: old authorizations and IPOS are
kept in a "folder"). Renewal copies children forward for editing.

**`training_version` rule (write-path, in the plan RPCs, not the UI):** bump on **every new
IPOS version** — renewal (even with identical goals, per Bren), addendum, or any change to
goals, objectives, or Instructions for Staff. Do **not** bump for narrative edits, needs/DSM
edits, client forms, or `objective_measures` edits. A bump invalidates existing
`plan_inservice_forms` and `plan_training_records` for this client (§8).
**As built (B1, owner-accepted):**
- A goal/objective/Instructions change bumps `training_version` only once someone was trained on
  the current version (an in-service or training form exists at it). Before that, the plan is
  still being drafted and the change is an ordinary edit (`care_plan_updated`).
- Renewal always bumps.
- The UI asks the manager to confirm "This change requires retraining all caregivers for this
  client" before a save that will bump it.

**Measure management (RPC `set_objective_measures`, Phase B):** Bren (manager role) enters the
ISK goals/objectives and sets each objective's measures from the library. Caregivers cannot
change measures.

RLS: `care_plans` uses the §2 shape. All children derive via
`care_plan_child_agency_id()/office_id()` helpers (objective-level children via the
objective → goal → plan path).

---

## 5. M-CP-03 — Authorizations + progress notes

```sql
CREATE TYPE auth_period_type  AS ENUM ('per_week','per_auth','per_quarter','per_month','per_day');
CREATE TYPE auth_source_type  AS ENUM ('manual','doc','edi','connector');  -- 'connector' = KARE

CREATE TABLE public.service_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  auth_number text NOT NULL,
  service_code text,                    -- CPT/revenue code
  modifier text,
  service_type text,                    -- 'cls' | 'respite' | ...
  service_description text,             -- the IPOS line's scope text
  units_authorized numeric NOT NULL DEFAULT 0,
  units_claimed  numeric NOT NULL DEFAULT 0,
  units_paid     numeric NOT NULL DEFAULT 0,
  units_available numeric NOT NULL DEFAULT 0,   -- DERIVED, single write path (§6)
  period_type auth_period_type,
  units_per_period numeric,
  unit_minutes integer,                 -- '15' for "Per 15 Minutes", etc.
  rate numeric, amount numeric,
  effective_date date NOT NULL,
  expiration_date date NOT NULL,
  source_adapter auth_source_type NOT NULL DEFAULT 'manual',  -- official record = Authorization form, via KARE
  authorizing_agent_notes text,
  template_id uuid REFERENCES public.form_templates(id),
  template_version integer,
  field_snapshot jsonb,                 -- immutable structural snapshot (audit/billing record)
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (agency_id, auth_number)       -- an auth number is unique within an agency
);
-- Units only (Bren, Oct 1): no dollar-allocation tracking.

CREATE TYPE billing_batch_status AS ENUM ('open','reviewed','billed');
CREATE TABLE public.billing_batches (            -- one per office per week (Weekly Billing screen)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  week_start date NOT NULL, week_end date NOT NULL,
  status billing_batch_status NOT NULL DEFAULT 'open',
  reviewed_by uuid, reviewed_at timestamptz, billed_at timestamptz,
  export_ref text,                      -- file/claim reference sent to ISK
  UNIQUE (agency_id, virtual_office_id, week_start)
);

CREATE TYPE progress_note_status AS ENUM ('draft','submitted','returned','reviewed','billed');
-- 'returned' added Oct 4 (Q10): reviewers never edit a submitted note; they return it with a reason

CREATE TYPE progress_note_kind AS ENUM ('cls','respite');

-- R2 (Oct 4): which care types are which service, per office. Not a column on global care_types.
CREATE TABLE public.office_service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  virtual_office_id uuid NOT NULL REFERENCES public.virtual_office(id) ON DELETE CASCADE,
  care_type_code text NOT NULL REFERENCES public.care_types(code) ON UPDATE CASCADE,
  service_type text NOT NULL,           -- 'cls' | 'respite' | ...
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (virtual_office_id, care_type_code)
);
-- A shift's service_type = office_service_types for (shift.virtual_office_id, shift.care_type_code).
-- It fixes the note kind and the authorization type (Phase B/C).

CREATE TABLE public.progress_notes (             -- ONE per delivered shift (R1: one client per shift)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  note_kind progress_note_kind NOT NULL,   -- from the shift's service; never mixed
  narrative_text text,                  -- respite: "Session Narrative" (required for respite)
  billing_batch_id uuid REFERENCES public.billing_batches(id),
  shift_id uuid REFERENCES public.shifts(id) ON DELETE RESTRICT,   -- unique per shift (not voided)
  authorization_id uuid NOT NULL REFERENCES public.service_authorizations(id) ON DELETE RESTRICT,
  care_plan_id uuid REFERENCES public.care_plans(id),
  training_version integer,                -- plan goals version in force for this visit
  caregiver_id uuid NOT NULL,
  service_date date NOT NULL,
  scheduled_start timestamptz, scheduled_end timestamptz,
  client_arrived_at timestamptz,         -- Q9: recorded by the caregiver (replaces actual_start)
  actual_end timestamptz,
  actual_minutes integer,
  arrived_late boolean NOT NULL DEFAULT false,   -- DERIVED (§6): client_arrived_at > scheduled_start + 5 min
  staff_client_ratio text,              -- '1:3'
  location text,
  units_scheduled numeric,              -- from the shift
  billable boolean NOT NULL DEFAULT true,
  units_used numeric NOT NULL DEFAULT 0 CHECK (units_used >= 0),   -- = "units billed"
  status progress_note_status NOT NULL DEFAULT 'draft',
  completed_on timestamptz,             -- "Note Completed On"
  staff_signature_name text,            -- Q5: typed name; the printout adds a wet-signature line
  staff_signed_at timestamptz,
  returned_reason text, returned_by uuid, returned_at timestamptz,   -- Q10 (CHECK: returned => reason)
  reviewed_by uuid, reviewed_at timestamptz,
  biller_name text, biller_signed_at timestamptz, billed_at timestamptz,   -- set via the weekly batch
  template_id uuid REFERENCES public.form_templates(id),   -- Progress Note shell
  template_version integer,
  field_snapshot jsonb,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  voided boolean NOT NULL DEFAULT false,
  voided_at timestamptz, voided_by uuid, void_reason text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX one_note_per_shift ON public.progress_notes (shift_id) WHERE NOT voided AND shift_id IS NOT NULL;

CREATE TABLE public.progress_note_entries (      -- one per Ripple objective on the note
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  progress_note_id uuid NOT NULL REFERENCES public.progress_notes(id) ON DELETE CASCADE,
  objective_id uuid REFERENCES public.care_plan_objectives(id) ON DELETE SET NULL,
  notes_text text,                      -- "Notes 1A (include reinforcers)"
  data jsonb NOT NULL DEFAULT '{}'::jsonb,  -- answers keyed by objective_measures.id (shape below)
  measures_snapshot jsonb,              -- the questions as asked this visit (frozen at submit)
  UNIQUE (progress_note_id, objective_id)
);

```

**`progress_note_entries.data` shape** (answers keyed by measure id):

```json
{
  "m_yesno":   {"value": "Yes"},
  "m_prompt":  {"value": "Verbal"},
  "m_ladder":  {"steps": [0,1,2,3,4]},
  "m_tally":   {"count": 4},
  "m_trials":  {"trials": [{"value":"Yes","text":"Board games"},{"value":"N/A","text":""}]},
  "m_text":    {"value": "Breathing with a visual card"}
}
```

**Rules (enforced in the note RPCs, Phase B):**
- `create_progress_note_for_shift(_shift_id)` creates **one note for the shift**.
  - R1: a group session is one shift per client in the same slot, so group sessions still get one
    note per client. The staff:client ratio is a header field. No `shift_clients` junction.
  - CLS: one entry per active `this_agency` objective on the client's current plan.
  - Respite: `note_kind='respite'`, no entries, `narrative_text` required at submit.
  - It copies `units_scheduled` and times from the shift, and refuses unassigned shifts (R12).
- **Deadline:** a note not submitted by end of the day after the visit is **overdue**
  (dashboard alert to the caregiver and manager).
- `submit_progress_note` snapshots `measures_snapshot` per entry, sets `completed_on` /
  `staff_signed_at`, computes `billable` / `units_used` (billing rule below), selects the
  FIFO authorization. After submit the caregiver cannot edit.
- **Q10:** reviewers (manager, Bren) **cannot edit** a submitted note.
  `return_progress_note(_note_id, _reason)` sets `status='returned'` + `returned_reason/by/at`. The
  caregiver edits and re-submits a returned note.
- `review_progress_note` → `reviewed` (Bren).
- **Q12 (default until Ripple answers):** per-note review, plus a second "bulk-approve clean rows"
  action (`review_progress_notes(_ids uuid[])`). A row is clean when submitted, not late, all
  measures answered, and has no return history in the week.
- Weekly: `build_billing_batch(_office_id, _week_start)` gathers the week's reviewed notes for one
  office, and `mark_batch_billed(_batch_id)` sets every note to `billed`.
  - **Q11 (default until Ripple answers):** the week is Monday–Sunday, set per office by
    `virtual_office.billing_week_start` (ISO day, default 1).
- Each transition writes a fail-closed audit event (§2.1 item 4).
- **Print (Q5):** every note renders a print / PDF view in Ripple's paper layout and **always
  prints a wet-signature line**. Signing in-app = typed name (`staff_signature_name`) + timestamp
  until Ripple confirms e-signature acceptance. Electronic archiving is a later phase.
- Every entry must have each `yes_no_na` measure answered (N/A allowed) before submit.

Notes carry their own `agency_id`/`virtual_office_id` (denormalized from the authorization
at write time, like `shifts.agency_id`) so their RLS uses the §2 shape directly rather than
a join helper — a note is a high-write operational row and shouldn't pay a join per RLS
check. Entries derive scope through a `progress_note_agency_id()` helper.
`ON DELETE RESTRICT` on the authorization FK: you must not be able to delete an authorization that
has delivered units against it (billing integrity). The same applies to `shift_id`: a documented
shift can't be deleted.
- Notes exist only for assigned, delivered shifts.
- The order wizard deletes only future unassigned shifts, so scheduling behavior is unchanged.

**Caregiver access (corrected Oct 4; owner decision R5 + security baseline §2.1):** caregivers get
**no table policy** on `progress_notes` or `progress_note_entries`. This replaces the earlier
"caregiver policy on own draft notes".
- **Read:** `get_progress_note_for_caregiver(_shift_id)`, a `SECURITY DEFINER` RPC.
  - It serves the caller's **own assigned shifts only**.
  - It returns the note header, the client's `this_agency` objectives, Instructions for Staff and
    the active measures.
  - It **never** returns needs, diagnoses, MichiCANS, other providers' objectives or
    authorization units.
  - No AI provider is involved.
- **Write:** `save_progress_note_draft` / `submit_progress_note`, both only while the note is
  `draft` or `returned`.

**Billing rule (arch §9.1, corrected with Bren Oct 1; Q9 Oct 4):**
- The caregiver records the client's **arrival time** (`client_arrived_at`) on the note.
- **Late** = `client_arrived_at > scheduled_start + 5 minutes`. The threshold is fixed at
  5 minutes.
- A late visit loses its **first** 15-minute unit: `units_used = units_scheduled − 1` (e.g. 4 → 3).
  The rest bills normally. A non-billable note bills 0.
- `units_used` and `arrived_late` are **derived by a trigger** (§6), not set by the RPC or the UI.
  No writer sets `units_available`.
- Lost units are reported on the dashboard and Weekly Billing.
- **Time types (owner review, Oct 4).** `scheduled_start`, `scheduled_end` and
  `client_arrived_at` are all `timestamptz`.
  - `create_progress_note_for_shift` (Phase B) fills `scheduled_start` from the shift **in the
    shift office's time zone**: `(shift.shift_date + shift.start_time) AT TIME ZONE
    virtual_office.timezone`. `scheduled_end` is built the same way from `end_time`, plus one day
    if it is at or before the start.
  - It never uses a naive `shift_date + start_time`.
  - `virtual_office.timezone` is the only zone source; `agency` has none. Verified Oct 4: every
    live shift has an office, and the offices use America/New_York, America/Detroit and
    America/Chicago. A shift without an office is refused.
  - The caregiver's arrival time is entered as local time in the same office zone, and the RPC
    converts it the same way.
  - Boundary (tested): arrival exactly at +5:00 is **not** late; +5:01 is late.

**Authorization selection at write time (arch §9.1, FIFO):** when the client has more than
one active authorization for the note's service, the RPC selects the **oldest valid** one
(earliest `expiration_date`) that still has `units_available` — oldest first (Bren). The
`service_type` comes from the scheduled service, so CLS-vs-Respite is never ambiguous; FIFO
only breaks same-service ties.

## 5.1 M-CP-03b — Intake documents (their own track)

```sql
CREATE TYPE client_document_status AS ENUM ('missing','pending','complete','expired','not_applicable');
-- 'not_applicable' added Oct 4 (Q7), with not_applicable_reason text

CREATE TABLE public.client_documents (          -- or ALTER an existing client-documents table
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  virtual_office_id uuid REFERENCES public.virtual_office(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  doc_type text NOT NULL,               -- = form_templates.intake_doc_type
  version integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  status client_document_status NOT NULL DEFAULT 'pending',
  effective_date date, expiration_date date,     -- e.g. release of information, insurance
  file_ref text,                        -- optional uploaded scan (storage path)
  template_id uuid REFERENCES public.form_templates(id),
  template_version integer,
  field_snapshot jsonb,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX one_current_doc_per_type
  ON public.client_documents (client_id, doc_type) WHERE is_current;
```

- **No FK to `care_plans`** — on purpose. An intake update never bumps the plan version or
  `training_version`; an IPOS renewal never re-versions intake documents.
- Intake types: consent, insurance, emergency_contacts, allergies, assessment,
  release_of_information, and (Q7, Oct 4) **`safety_behavior_plan`**, the onboarding item "Safety
  plan or behavior plan (if applicable)". Its current row may be `not_applicable` (with a reason),
  which counts as done. **"Summary page" is dropped** (struck on `IMG_1296`). `doc_type` is not
  hard-coded in a CHECK; it comes from the intake shells.
- "Missing documentation" (dashboard) = required intake shells (`is_required_for_client`) with no
  current `complete` or `not_applicable` row for the client.
- **Onboarding item ⑥ "Training forms" (Q8):** complete when ≥ 1 caregiver has a
  `plan_training_records` row at the plan's current `training_version`. Per-caregiver gating stays
  in the eligibility engine (Phase C).
- `expiration_date` feeds the notification engine as a fifth source.
- RLS: §2 shape directly.

## 6. M-CP-05 — the derived-units trigger (AFTER M-CP-03)

`units_available` has exactly one write path. It is **never** set directly by application
code; it is maintained by a trigger on `progress_notes`, the same "derived value, single
enforced path" discipline as `trg_enforce_derived_shift_caregiver`. The sum counts only
**billable, non-voided** notes (per the §5 billing rule).

**As drafted (M-CP-05, Oct 4): three triggers, one derivation point each.**

1. `cp_derive_progress_note_units` (BEFORE INSERT/UPDATE on `progress_notes`) sets
   `arrived_late` and `units_used`:
   - `units_used = 0` if the note is not billable or has no `units_scheduled`;
   - otherwise `units_scheduled − 1` if late, else `units_scheduled` (never below 0).
2. `cp_derive_authorization_units` (BEFORE INSERT/UPDATE on `service_authorizations`, SECURITY
   DEFINER) sets
   `units_available = units_authorized − SUM(units_used of billable, non-voided notes)`. So a new
   authorization starts at `units_authorized`, and **any value a writer sends is overwritten**.
   This is the one path; there is no separate init step.
3. `cp_refresh_authorization_units` (AFTER INSERT/DELETE, and AFTER UPDATE WHEN the authorization,
   units, billable or voided changed) re-derives the old **and** new authorization with a no-op
   UPDATE.

Voiding a note, or flipping it non-billable, restores units through the same path. There is no
separate "credit" logic.
`units_claimed`/`units_paid` are funder-reported figures that arrive via the EDI/remittance
adapter later (V3); leave them manager-editable for now, they are NOT the scheduling gate —
`units_available` is.

## 7. M-CP-06 — extend `check_assignment_eligibility` (last)

> **Confirm the exact current signature, return shape, and callers live before touching
> it.** The scheduling Phase 1B plan documents it as returning a jsonb with
> `hard`/`soft`/`advisory` arrays. These are ADDITIVE hard rules appended to the existing
> `hard` array — existing rules (office scope Rule B, skills, certifications, availability,
> etc.) are preserved verbatim. Do not alter existing rule logic. **The Manual, Smart, and
> Auto Assign paths and Schedule Management keep calling this one function** — no new
> scheduler, no per-path copy of the rules.

Four new hard checks (all only fire when the module's tables have data for the client —
absence of an authorization for a client with none yet configured must be a **soft/advisory**
during rollout, not a hard block, or it breaks every existing Kind Care shift; see the
rollout flag below):

1. **Active authorization exists** for `(client_id, service_type)` with
   `effective_date <= shift_date <= expiration_date`. When more than one matches, consider
   the **oldest-expiring** one first (FIFO, arch §9.1) — this is the authorization the
   session will bill against, so it is the one whose units rule 2 checks.
2. **`units_available` >= units this shift consumes** (shift minutes ÷ `unit_minutes`),
   evaluated against the FIFO-selected authorization from rule 1.
3. **Signed `plan_training_record`** for `(caregiver_id, client_id, training_version)` where the
   plan is the client's current active plan — i.e. trained on the **current IPOS goals
   version** (arch §9.2), not per service.
4. **All `required` credentials present and current**, including background checks.
   **Resolved Oct 4 (R3):** these are `caregiver_certifications` rows with a `credential_type_id`
   whose `credential_types.required = true` and `expiry_date >= shift_date`.
   - The existing Rule F (expired or unverified certification → hard, every agency) is unchanged.
   - The new check adds only "required type **missing**" (or none current), behind the flag.

```
-- migration shape when the signature changes (NOT OR REPLACE — SECURITY DEFINER fn):
DROP FUNCTION IF EXISTS public.check_assignment_eligibility(<exact old signature>);
CREATE FUNCTION public.check_assignment_eligibility(<same args>) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ ... $$;
REVOKE ALL ON FUNCTION public.check_assignment_eligibility(<sig>) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_assignment_eligibility(<sig>) TO authenticated;
```

**Rollout flag (critical, prevents breaking the live demo). Resolved Oct 4 (R8/Q1).**
- `virtual_office.compliance_enforcement_enabled` (added in M-CP-01), default **false**. It is
  evaluated against the **shift's** office: the engine's first office-level setting, so Phase C
  tests it explicitly.
- Only `agency_admin` / `system_admin` can change it. This is enforced by
  `trg_guard_virtual_office_flags`, not the UI.
- The separate `care_plan_module_enabled` flag (Q3) controls menus and dashboard only and **never**
  affects eligibility.
- **Rule 4 (R3):** reads `caregiver_certifications` joined to `credential_types`. Only the new
  "required credential **missing**" check is flagged. The existing expired/unverified rule (Rule F)
  is unchanged and stays hard for every agency.
- **R2:** the shift's `service_type` comes from `office_service_types`.
- **R6:** `check_caregiver_shifts_eligibility` emits a **caregiver-safe `detail`** for the new codes
  (e.g. "This shift can't be booked yet. Your office will contact you"). It never shows
  authorization numbers or units to a caregiver.

The flag gates the four new hard rules: When false, the four checks emit `advisory` entries only (informational), never
`hard`. Ripple Effects flips it true once its authorizations/credentials are entered; Kind
Care and every existing agency keep working unchanged. This is the same "NULL/false = today's
behavior, opt-in to tighten" zero-risk-default discipline M-Office used for the knowledge
RPC office parameter. Without this flag, M-CP-06 would hard-block every shift for every
client who has no authorization row yet — i.e. all of them on day one.

## 8. M-CP-04 / M-CP-07 — credentials, training form, seed

```sql
CREATE TYPE credential_category AS ENUM
  ('background_check','annual_online','annual','in_person_recert');

credential_types      (id, agency_id, name, category credential_category,
                       valid_months, required bool, is_active)   -- agency-wide catalog, no office
-- R3 (Oct 4): NO caregiver_credentials table. caregiver_certifications is extended additively:
ALTER caregiver_certifications ADD credential_type_id (-> credential_types), effective_date, entered_by
-- expiry stays in the existing expiry_date; office comes from the caregiver. Manual entry
-- (Phase B upsert_caregiver_credential) sets is_verified = true. Existing rows and the existing
-- expired/unverified rule are unchanged. A guard requires the type's agency = the caregiver's.
-- Q17: hr_staff enters credentials and training forms; manager can do everything hr_staff can and
-- override it (Phase B RPC role checks). Bren and Lauren are manager.

CREATE TYPE plan_document_type AS ENUM
  ('ipos_initial','ipos_annual','ipos_addendum','behavior_support_plan','protocol');
CREATE TYPE training_method AS ENUM ('pcp_meeting','outside_pcp');

plan_inservice_forms  (id, agency_id, virtual_office_id, client_id, care_plan_id,
                       training_version int, case_manager_name, program_lead_id (-> profiles),
                       trained_on date, signed_at timestamptz,
                       template_id, template_version, field_snapshot, field_values)
                       -- STEP 1: the CM (caseworker) trains Ripple's program lead (Bren) on the new
                       -- IPOS; Bren signs. Required before step 2 for that training_version.
plan_training_forms   (id, agency_id, virtual_office_id, client_id, care_plan_id,
                       training_version int, plan_document_type, plan_effective_date, location,
                       template_id, template_version, field_snapshot, field_values)
                       -- one filled ISK 33.01_01F form
plan_training_records (id, training_form_id REFERENCES plan_training_forms ON DELETE CASCADE,
                       agency_id, virtual_office_id, caregiver_id, client_id, care_plan_id,
                       training_version int, training_date, training_method,
                       primary_clinician_name, trainer_name, signed_date, entered_by)
-- STEP 2: one row per trained caregiver. trainer_name = Ripple's program lead (Bren), who
-- was trained by the CM in step 1. A record is valid only while care_plans.training_version
-- matches; every new IPOS version (renewal or goals change) invalidates prior records and
-- requires fresh in-service + training. Applies to CLS and respite alike (one training per
-- IPOS version covers the client).
```

**Reference data (owner review, Oct 4):**
- **M-CP-07** (a migration) seeds only **system-wide rows every agency uses**: the eight
  `measure_types` with `agency_id NULL`.
- **Agency-specific rows** are not in migrations. They live in
  `scripts/seed/ripple_dev_reference_seed.sql`, run on **DEV only** after the push, as an approved
  data statement:
  - Ripple's `credential_types` (below);
  - its `office_service_types`: `CLS0001 → cls`, `RESP0001 → respite`.

  The script is one DO-block transaction. It refuses to run unless the dev agency and office
  exist, and it checks the inserted and total counts (22 / 2), rolling back on any mismatch.
- **Phase B** adds `seed_office_care_plan_defaults(_office_id)`. When an agency_admin enables the
  care-plan module for an office, it seeds that office's editable defaults (credential types and
  service-type mappings). Agencies edit them afterwards.

`credential_types` content (DEV seed):
- `background_check` (12 months, required): ICHAT, MDHHS Central Registry, OIG, Sanctioned
  Provider, MI Sex Offender Registry, National Sex Offender Registry (`IMG_1295`).
- `annual_online` / `annual` / `in_person_recert` from Lauren Williams's checklist,
  `required=true` except Medication (if applicable) and Recipient Rights initial-only.

**Moved to Phase B (Oct 4):** the **Ripple shells** are created by `publish_template_version`, the
same path managers use, not by a raw migration insert:
- IPOS v1 (sections/fields per arch §11.2, option lists for DSM outcome codes and the 18
  treatment-need domains, ISK default discharge text, static appeal text);
- Authorization v1;
- Progress Note v1 with the §3 `note_layout`;
- In-service v1 and Training v1;
- the seven intake shells (including `safety_behavior_plan`).

This is structure only: **no content from the redacted documents is seeded as client data.**

## 9. Done-definition — the two tests (+ billing/FIFO/training-version/template-model checks)

1. **Template-version no-drift test** (proves §3/§3.1) — across all template kinds:
   - v1 → fill A; publish v2 → fill B; A renders with v1, B with v2; hard-delete v1, A still
     renders from `field_snapshot`.
   - Editing A's values (narratives, goals) creates **no** new template version.
   - `publish_template_version` rejects a version that drops a required spine column.
2. **Units-enforcement + isolation test** (proves §5–7 + derived-units single path +
   M-Office cross-office/agency rejection regression). Also covers arch §9.1/§9.2/§11:
   - **Late arrival:** a 4-unit visit with `client_arrived_at > scheduled_start + 5 min` records
     `units_used = 3`; the trigger decrements exactly 3; voiding the note restores them.
   - **FIFO draw:** two same-service authorizations draw earliest-expiring first; when it is
     exhausted, the next note draws from the later one.
   - **Training-version retraining:** a caregiver trained on `training_version=2` is eligible;
     renew the IPOS with identical goals → `training_version=3`; the caregiver is now
     **hard-blocked** until an in-service form and a fresh training record at 3 exist. Editing
     a narrative, a client form, or an objective's measures does **not** bump it.
   - **Progress note per shift:** creating a note for a CLS shift adds one entry per
     `this_agency` objective (none for `case_management`); a respite shift creates a
     `respite` note with no entries that cannot be submitted without `narrative_text`;
     a second note for the same shift/client is rejected; submit snapshots
     `measures_snapshot`, and editing the objective's measures afterwards leaves that note
     unchanged; a group session (3 clients = 3 shifts in the same slot, R1) creates 3 notes,
     and a second note for the same shift is rejected.
   - **Weekly batch:** `build_billing_batch` picks up only reviewed notes in the week; an
     unsubmitted note past the day-after deadline is flagged overdue and excluded.
   - **External services inert:** a `care_plan_external_services` row never affects
     `units_available` or eligibility.

Plus one rollout regression, because of §7's flag: **with `compliance_enforcement_enabled =
false`, every existing Kind Care and Ripple shift assignment must still succeed** through
Manual, Smart, and Auto Assign (new rules advisory-only). Flip Ripple to true, re-run,
confirm Ripple now hard-blocks an over-units/expired-auth/untrained assignment while Kind
Care (still false) is unaffected.

## 10. Build phases for Claude Code

- **Phase A — schema:** M-CP-01…05 (+03b) + M-CP-07 seed. Drafted Oct 4 as
  `supabase/migrations/20261006120000…120700` and shown for review before push. Done when:
  - tables exist and RLS composes: office X vs Y, other agency, and caregiver/client/anon denied;
  - the units trigger is proven with a manual note insert/void cycle (non-billable = 0, late
    4 → 3);
  - the flag guard holds: manager/scheduler refused, agency_admin allowed;
  - `aclexplode` is clean for every new function;
  - the no-break check passes: Manual/Smart/Auto assign unchanged with both flags false.
- **Phase B — write paths (RPCs):** `publish_template_version` (with spine-column guard),
  plan create/renew (applies the `training_version` rule), `set_objective_measures`,
  authorization create (manual adapter), in-service + training-form entry,
  `build_billing_batch` / `mark_batch_billed`,
  `create_progress_note_for_shift` / `submit_progress_note` / `review_progress_note`
  (sets `billable`/`units_used`, selects FIFO authorization, snapshots measures),
  client-document upsert, credential + training-form entry, `upgrade_instance_template`. Added
  Oct 4:
  - `get_progress_note_for_caregiver` (R5) and `save_progress_note_draft`;
  - `return_progress_note` (Q10) and `review_progress_notes(_ids uuid[])` (Q12 bulk);
  - `get_client_onboarding_status` (Q7/Q8);
  - the Ripple shell seed via `publish_template_version`;
  - **first in Phase B:** the `events_event_type_check` migration for the new audit event types,
    pushed **before** any RPC that writes them (§2.1 item 4);
  - `seed_office_care_plan_defaults(_office_id)`: seeds an office's editable defaults when the
    care-plan module is enabled (agency_admin);
  - **submit/review refusal rule:** `submit_progress_note` and `review_progress_note` refuse a
    note when the chosen authorization's `units_available < units_used` of this note (the units
    trigger alone would allow a negative balance), or when the service date is outside the
    authorization's `effective_date … expiration_date`;
  - `create_progress_note_for_shift` builds `scheduled_start`/`scheduled_end` in the office time
    zone (§5 "Time types").

  All REVOKE-before-GRANT, all role-checked (Q13, Q17). Done when a manager can, via RPC, build a shell → fill an IPOS and an
  authorization → set measures on an objective → a caregiver submits a progress note for a
  shift → units decrement → enter a credential, all office-scoped.
- **Phase C — eligibility:** M-CP-06 behind the rollout flag. Done when the units-enforcement
  and training-version tests pass with the flag true and the no-break regression passes with it
  false.
- **Phase D — the two tests** as the formal done-definition, then update `known-issues.md`
  and this project's roadmap docs with what closed.

UI comes AFTER Phase D proves the mechanism. The manager UX (arch §9.2, §11 and the reviewed
prototype) is:
- **Configuration → Form Templates** — the only place shells are created, edited, and
  versioned (Layer A): list of shells by kind, field editor showing each field's storage and
  whether it shows on the progress note, version history; the **measure library** with
  CLS and Respite note shells, In-service and Training form shells.
- **Weekly Billing** — the week's notes by client × authorization, units scheduled vs billable,
  Bren's review, export, mark billed (replaces the billing spreadsheet).
- **Client Care Plan** (Layer B, fully editable): **IPOS** (authorization + services inside;
  other providers as reference), **Goals** (grouped by objective service, sequence
  preserved, select-in-place, ISK Instructions for Staff, per-objective data questions), **Progress Notes** (one per visit:
  header, each objective's Notes + Data, billing footer; Respite note = narrative; print / PDF), **Scheduling summary** linking to the existing Schedule Management
  module and assign flow. Each section shows a **read-only** provenance badge; no
  edit-template action on this page. Intake documents listed on their own track.
- **Caregiver** — credentials (background checks + trainings) and per-client training forms.

## 11. What this plan deliberately does not do

(Unchanged by the Oct 4 decisions, except that the flags are per office and seeded off.)

Apply anything. Build the manager UI or dashboard. Build any adapter beyond the V1 manual
form's write RPC. Touch `check_assignment_eligibility`'s existing rules. Enable enforcement
for any agency by default. Seed any content from the redacted documents. Re-implement the
Schedule Management module or the assign engine inside the care plan. Model
dollar-allocation gating (units only, per Bren). Build electronic archiving (later phase). Decide the architecture doc's open
flags (§9, §11.8), noted inline where they affect a shape.

## 12. Still open (asked to Ripple; defaults built)

| # | Question | Default until answered |
|---|---|---|
| Q11 | Billing week: Monday–Sunday or ISK's week? | Monday–Sunday, office setting `virtual_office.billing_week_start` (default 1) |
| Q12 | Note-by-note review or bulk-approve clean rows? | Per-note review + a second "bulk-approve clean rows" button |
| Q18 | Late arrival / early departure: should a much later arrival, or an early departure, bill only the 15-minute units actually delivered? | **Current rule kept:** more than 5 minutes late removes exactly one unit (`units_used = units_scheduled − 1`); early departure is not deducted. The billed-unit rule lives in ONE function, `cp_derive_progress_note_units` (the Phase A trigger), so a change to "delivered units" is a single-function change plus a test. Shift-length units (`floor(minutes / 15)`) move to one shared helper in Phase C, used by note creation and by eligibility projection. |

## 13. Conflicts found on Oct 4 and how they were resolved

| # | Conflict | Where | Resolution |
|---|---|---|---|
| C1 | RLS predicate `current_virtual_office_id() IS NULL OR …` vs live M-Office `NOT is_office_restricted(…) OR …` | this doc §2, arch §6 | Live predicate (R7). |
| C2 | Draft policy had a cross-agency `system_admin` bypass | this doc §2 | Dropped: the owner baseline is agency + office + staff check. system_admin sees own agency. |
| C3 | "ALTER the existing care-plan table if it exists" vs a new table | this doc §4, arch §2.2, §11.7 | New `care_plans` + nullable `client_orders.care_plan_id` (R4/Q2). |
| C4 | New `caregiver_credentials` vs the existing `caregiver_certifications` | this doc §1, §8, arch §2.4, §6, §7 | Extend `caregiver_certifications` (R3). Only "required missing" is flagged. |
| C5 | Flag "per-agency (or per-office)" | this doc §7 | `virtual_office` column, admin-only, guard trigger (R8/Q1). Separate module flag (Q3). |
| C6 | `service_type` "from the scheduled service" with no mapping | this doc §5, §7 | `office_service_types` (R2). |
| C7 | "A group shift with 3 clients creates 3 notes" and unique (shift, client) | this doc §5, §9, arch §12 | One shift per client. Unique per shift (R1). Workflow unchanged: one note per client. |
| C8 | Caregiver table policy on own draft notes vs "caregivers get no direct table access" | this doc §5 | Baseline wins: RPC-only (R5). |
| C9 | "The manager can return it": no status, no path | this doc §5 | `returned` status + reason; `return_progress_note` (Q10). |
| C10 | Shell versions had only `is_current`: no drafts | this doc §3 | `status draft|published`, one draft per shell (Q14). |
| C11 | Office-restricted users could not read agency-wide shells under the live predicate | this doc §3 | Explicit read clause for NULL-office shells (Q15). Writes RPC-only. |
| C12 | Intake list had no safety/behavior plan; no N/A status | this doc §5.1, arch §11.5, §12 | `safety_behavior_plan` + `not_applicable` (Q7). |
| C13 | Late arrival keyed on `actual_start`, "Bren's threshold" unspecified | this doc §5, arch §9.1 | `client_arrived_at` recorded by the caregiver; late = > 5 min (Q9). |
| C14 | No `inservice` shell kind, although the in-service form carries a template | this doc §3 | Added `inservice` to `form_template_kind`. |
| C15 | `billing_batches` office nullable but unique per office/week | this doc §5 | Office NOT NULL (one batch per office per week). |
| C16 | M-CP-07 seeded the shells by raw insert; agency rows were in a migration | this doc §8 | Shells move to Phase B via `publish_template_version`. M-CP-07 = system measure types only; agency rows → DEV seed script (owner review Oct 4). |
| C19 | One staff predicate for every table (any staff role read clinical data) | this doc §2 | Role tiers, minimum necessary (owner review Oct 4). |
| C20 | `billing_week_start` followed the existing open `virtual_office` edit rule | this doc §2.1 | Guarded like the flags (owner review Oct 4). |
| C17 | Notification engine (arch §2.5, §7) vs V1 dashboard | arch §2.5, §7 | V1 shows computed status only; sending is a later phase (R9). |
| C18 | `ripple_trainer_id` names an agency in a generic schema | this doc §8 | `program_lead_id` → profiles. |

Open observations (not changed here):
- `caregiver_certifications` keeps its existing staff policy, which is agency-wide with no office
  predicate.
- `virtual_office` UPDATE is open to every staff role in scope. Only the two new flags are guarded.

## 14. Results

### 14.1 Phase A: live on DEV 2026-10-04 (`fbb3291`)
- **Local (PGlite):** 36/36 checks.
- **DEV after-suite:** R1, R1b, R2, R3, U1, F1, A1/A2 and NB1 all pass.
- **Rollback:** restores the exact catalog (`docs/rollback/ripple_phase_a_rollback.sql`).

### 14.2 Phase B1: live on DEV 2026-10-04 (`537debf`)
- **Local (PGlite):** 22/22 checks, including the forced audit failure (local only: forcing it on
  DEV would need a schema change).
- **Rollback:** restores the exact post-Phase-A catalog
  (`docs/rollback/ripple_phase_b1_rollback.sql`).
- **Defaults seed:** `scripts/seed/care_plan_defaults_dev_seed.sql`: 22 credential types
  (20 required) and 2 service mappings.
- **DEV after-suite** (`cp_b1_tests.cjs after`), all 19 green: NB1, H1–H7, TV1, T1, T4, T5,
  D1 (93 denied calls), A1, X1–X3, C1 and ACL (28/28). Teardown verified.

**Test-harness note (A1, first after-run).** The first after-run reported A1 FAIL on the first
audited write. The cause was the harness, not B1:
- the local machine clock ran about 1.37 s ahead of the database;
- the event-count window started at "local time − 1 s", so the first event fell before it.

The call itself had succeeded, and its audit insert is fail-closed in the same transaction.
Owner-approved fix, applied to every test from now on:
- A1 matches each audited call's event by the entity ids it touched plus `event_type`, and
  asserts exactly one, with no other events for those ids.
- The time window is only a secondary filter.
- "Now", deadlines and arrival times are always taken from the database clock, never the local
  one.
- Each run prints the measured skew (re-run: local − DB = 1062 ms).

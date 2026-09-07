# CareMuch — Multi-Tenant SaaS Architecture Plan

> **Status: PLAN ONLY, POST-DEMO.** Nothing in this document has been executed. No
> schema, migration, RLS, RPC, data, code, or config change has been made. This is a
> proposal to review and approve in stages after the Ripple Effects demo closes.

## Executive Summary

The single most important finding in this plan is not a missing feature — it's a
**dateable architectural transition that was never finished**. Around 2026-08-21, the
codebase introduced a correct, reusable tenant-scoping pattern
(`current_agency_id()` / `is_agency_staff()` / `my_agency_id()`, all `SECURITY DEFINER`
helpers) and retrofitted it onto `shifts`, `shift_assignments`, `caregivers`,
`clients`, `client_orders`, `families`, `family_contacts`, and `knowledge_documents`/
`knowledge_chunks`. Every one of those tables is now genuinely, verifiably
agency-isolated. But the retrofit was never applied to several other tables that
still carry the **earlier** pattern — a bare `has_role()` check with no agency
comparison at all, because at the time only one agency (`56fbfe38`) existed and any
`agency_admin`/`system_admin` was implicitly platform-trustworthy. That assumption is
false the moment a second real tenant exists, and it hasn't been revisited since the
correct pattern was built. **This is Layer 1's real content**, not a hypothetical: the
platform's own root tables (`agency`, `profiles`, `user_roles`) are among the tables
still on the old, cross-tenant-open pattern.

This plan treats fixing that transition, not any greenfield design, as Layer 1's core
work.

---

## STEP 1 — Complete Tenancy Map

Read from the live generated schema (`src/integrations/supabase/types.ts`) and the
migration history for RLS bodies — not from original `CREATE TABLE` statements alone,
per the `care_types.agency_id` lesson (that column was dropped from the live table at
some point after its original migration; the generated types were the only source that
told the truth).

Legend: ✅ enforced correctly · ⚠️ column present, not fully re-verified this pass ·
🔴 confirmed gap · 🌐 intentionally global (correct as-is)

| Table | Scope column(s) | Enforced how | SaaS-correct? | Notes |
|---|---|---|---|---|
| `agency` | — (is the tenant) | `has_role(system_admin\|agency_admin)`, **no self-row comparison** | 🔴 | "Admins can manage agencies" lets *any* agency's admin manage *any other* agency's row. Root-table leak. |
| `care_request_time_windows` | `agency_id`, `virtual_office_id` | ⚠️ not individually re-checked | ⚠️ | Column present; verify body before trusting. |
| `care_requests` | `agency_id`, `virtual_office_id` | ⚠️ not individually re-checked | ⚠️ | Same. |
| `care_service_categories` | none | `USING (true)` for read, admin-managed | 🌐 | Paired reference catalog for `care_types`. Correct global. |
| `care_types` | none (**dropped from live schema** — original migration had it, live table doesn't) | `USING (true)` read-all, admin-write | 🌐 | Confirmed empirically this session (a real INSERT attempt failed on `agency_id`). Correct as global *catalog*; the gap is the missing per-tenant *selection* mechanism (Step 4). |
| `caregiver_availability` | `agency_id` | ⚠️ not re-checked | ⚠️ | |
| `caregiver_availability_exceptions` | `agency_id` | ⚠️ not re-checked | ⚠️ | |
| `caregiver_certifications` | none (indirect via `caregiver_id`) | ⚠️ not re-checked | ⚠️ | |
| `caregiver_preferences` | `agency_id` | ⚠️ not re-checked | ⚠️ | |
| `caregiver_registrations` | `agency_id`, `virtual_office_id` | ⚠️ policy names suggest role+scope gating; body not fully read | ⚠️ | |
| `caregiver_skills` | none (indirect via `caregiver_id`→`caregivers`) | ✅ `EXISTS (... JOIN caregivers c JOIN profiles p ON p.agency_id=c.agency_id ...)` | ✅ | Confirmed, real join-based scoping. |
| `caregivers` | `agency_id`, `virtual_office_id` | ✅ `agency_id IN (SELECT agency_id FROM profiles WHERE id=auth.uid())` | ✅ | Modernized 2026-07-26. |
| `certifications` | none | anon+authenticated SELECT `true`; **"ALL TO authenticated" write policy body not fully inspected** | 🌐 / ⚠️ | Likely intentional global catalog (cert names), but flag the ALL-write grant to verify it's admin-gated, not open to any authenticated user. |
| `client_care_needs` | none (indirect via `client_id`→`clients`) | ✅ `client_id IN (SELECT id FROM clients WHERE agency_id IN (...))` | ✅ | Confirmed. |
| `client_orders` | `agency_id` | ✅ `agency_id IN (SELECT agency_id FROM profiles ...)` | ✅ | Confirmed. |
| `client_time_windows` | `agency_id` | ⚠️ not re-checked | ⚠️ | |
| `clients` | `agency_id`, `virtual_office_id`, `family_id` | ✅ agency_id-scoped + role-gated | ✅ | Confirmed. |
| `conversation_answers` | none (via `session_id`) | 🔴 `has_role(...)` only, **no agency comparison anywhere** | 🔴 | Confirmed: any `system_admin`/`agency_admin`/`manager`/`hr_staff`, of ANY agency, can read every agency's screening/intake answers. |
| `conversation_flows` | `agency_id` (column exists, **unused**) | Global by design: `status <> 'draft'` read policy + a **unique partial index `(audience) WHERE status='published'`** with no agency in it | 🔴 (by design, needs decision) | Confirmed at three independent layers this session: RLS, the unique index, and the client-side query. Not a bug — a deliberate single-tenant-per-audience design that the SaaS vision breaks. |
| `conversation_sessions` | `agency_id` (column exists, **unused in the read policy**) | 🔴 `has_role(...) OR user_id=auth.uid()`, no agency filter | 🔴 | Same class as `conversation_answers` — confirmed. Contains contact PII (name/email/phone) of screening candidates and family-intake submitters. |
| `demo_purge_audit` | — | "Platform admins read purge audit" — not fully inspected | ⚠️ | Presumed system_admin-only by name/purpose; not a tenant-data table (platform operational log), low priority to re-verify. |
| `earnings_lines` | `agency_id` | ⚠️ not re-checked | ⚠️ | |
| `events` | `agency_id`, `virtual_office_id` | ⚠️ not re-checked | ⚠️ | This is the `log_event()`/audit table CLAUDE.md references. |
| `families` | `agency_id`, `virtual_office_id` | ✅ `current_agency_id()`/`is_agency_staff()` | ✅ | Confirmed, modern pattern (2026-08-21). |
| `family_contacts` | none (indirect via `family_id`, `family_agency_id()` helper) | ✅ | ✅ | Confirmed, modern pattern. |
| `flow_nodes` | none (indirect via `flow_id`→`conversation_flows`) | Inherits `conversation_flows`' global scoping | 🔴 (inherited) | Child of the global-by-design table above. |
| `flow_options` | none (indirect via `node_id`→`flow_nodes`) | Same inheritance | 🔴 (inherited) | Same. |
| `knowledge_chunks` | none (indirect via `document_id`→`knowledge_documents`) | ✅ "Agency staff manage their agency's knowledge chunks" | ✅ | Confirmed (this session's own 3A/3C work). |
| `knowledge_documents` | `agency_id`, `surface` | ✅ staff-only RLS + surface-scoped RPCs, anon/authenticated EXECUTE revoked on retrieval RPCs | ✅ | Confirmed extensively this session. |
| `order_services` | (via `order_id`) | Policy dropped/re-created 2026-08-21 alongside an `order_agency_id()` helper — likely modernized, **not individually re-verified** | ⚠️ | |
| `pending_notifications` | `agency_id` | ⚠️ not re-checked | ⚠️ | |
| `profiles` | `agency_id` (**the source of `current_agency_id()` itself**) | Self-row policies ✅, but "Admins can view all profiles" = 🔴 `has_role(system_admin\|agency_admin)`, no agency comparison | 🔴 | Any agency's admin can read every user's profile across every agency. |
| `role_permissions` | none | read-all authenticated, system_admin-managed | 🌐 | Platform config (role→module permission map). Correct global. |
| `shift_assignments` | none (via `shift_id`, `shift_assignment_agency_id()` helper) | ✅ `is_agency_staff() AND ... = current_agency_id()`; INSERT/DELETE revoked from `authenticated` entirely (RPC-only) | ✅ | Confirmed, best-designed table in the map. |
| `shift_ratings` | `agency_id` | ⚠️ not re-checked | ⚠️ | |
| `shift_trades` | none | ⚠️ policy names seen, bodies not read | ⚠️ | |
| `shifts` | `agency_id` | ✅ `is_agency_staff() AND agency_id=current_agency_id()` | ✅ | Confirmed, modern pattern. |
| `system_modules` | none | read-all authenticated, system_admin-managed | 🌐 | Platform menu registry. Correct global. |
| `system_roles` | none | not individually re-checked, low risk (role-name lookup) | 🌐 (presumed) | |
| `time_entries` | `agency_id` | ⚠️ not re-checked | ⚠️ | |
| `time_off_requests` | `agency_id` | 🔴 (suspected) — the excerpt seen is `has_role(manager\|agency_admin\|scheduler)` with no agency comparison, same *early* pattern as `agency`/`profiles`/`user_roles`, from the **original** 2025-10-30 migration — no evidence found of a later re-scope the way `shifts`/`caregivers` got | 🔴 (suspected, not fully confirmed) | Flagging with lower certainty than the *confirmed* rows above — the exact current policy body needs a direct re-read before treating this as settled, but the pattern match is strong. |
| `user_roles` | `agency_id` | Self-row read ✅; "Admins can manage all roles" = 🔴 `has_role(system_admin\|agency_admin)`, no agency comparison | 🔴 **most severe** | This is the role-*assignment* table — an agency_admin of Agency A can grant/revoke roles for users in Agency B. Privilege-escalation vector, not just a read leak. |
| `virtual_office` | `agency_id` | ⚠️ not directly inspected this pass | ⚠️ | Given the pattern found elsewhere, check for the same unscoped-admin-policy shape before trusting the staff-management side (the public `get_public_office()` read path is separately confirmed safe — SECURITY DEFINER, filtered by slug+`is_active`). |
| `caregiver_performance` (view) | `agency_id` | not inspected | ⚠️ | Reporting view; lower priority. |

**Reading this table:** ✅ rows need nothing. 🌐 rows need nothing (they're correctly
global). ⚠️ rows are the "re-verify before Layer 1 is declared done" list — likely fine
given the column is present and the codebase's general discipline, but not personally
confirmed this pass, so they shouldn't be assumed. 🔴 rows are real, are where Layer 1's
actual work is.

---

## STEP 2 — Classification

**(a) Correctly tenant-isolated today:** `caregivers`, `clients`, `client_orders`,
`client_care_needs`, `caregiver_skills`, `shifts`, `shift_assignments`, `families`,
`family_contacts`, `knowledge_documents`, `knowledge_chunks`. This is the operational
core plus knowledge — the highest-value, highest-risk data is, encouragingly, already
done right.

**(b) Intentionally global, correctly so — leave global:** `care_types`,
`care_service_categories`, `certifications` (pending the write-policy check above),
`role_permissions`, `system_modules`, `system_roles`. These are shared reference
catalogs, not tenant-owned records — a code/name catalog is meant to be shared, the
same way a ZIP-code table would be. No change needed to *these tables*; the gap is
entirely in how a tenant *selects from* the global catalog (Step 4).

**(c) Should be tenant-isolated, isn't (or isn't fully verified) — the real work:**

| Table | Current problem | Correct scoping |
|---|---|---|
| `agency` | Any admin can manage any tenant's root row | Restrict "manage" to system_admin only, or add `id = current_agency_id()` for agency_admin self-management |
| `profiles` | Any admin can read every tenant's user profiles | Add `agency_id = current_agency_id()` to the admin-read policy |
| `user_roles` | Any admin can assign/revoke roles in any tenant (privilege escalation) | Add `agency_id = current_agency_id()` to the admin-manage policy — highest priority in this whole list |
| `conversation_sessions` | Any qualifying role can read any tenant's screening/intake PII | Add `agency_id = current_agency_id()` |
| `conversation_answers` | Same | Same, via `session_id` join |
| `conversation_flows` | Deliberately global by unique-index design — one published flow per audience, platform-wide | Needs the dedicated phase in Step 5 (relax the index to `(audience, agency_id)`) |
| `flow_nodes`/`flow_options` | Inherit the above | Same phase |
| `time_off_requests` | Suspected same class as `agency`/`profiles`/`user_roles` (unconfirmed) | Verify, then fix if confirmed |
| `virtual_office` (admin side) | Unverified | Verify against the same pattern before assuming safe |
| Several ⚠️ tables | Column present, enforcement unconfirmed | A verification pass, not a redesign — likely already correct given the codebase's general discipline post-Aug-21, but "likely" isn't "confirmed" |

**Caregivers/clients are agency-*owned*, correctly isolated, not marketplace
entities** — confirmed directly (b) above. This is the right foundation for the "no
cross-agency matching" product promise; nothing here needs to change in kind, only the
handful of 🔴 tables need to catch up to the pattern these already use correctly.

---

## STEP 3 — Current Admin Surface Inventory

| Surface | Reachable by | Manages | Tenant-safe? |
|---|---|---|---|
| `AgencySettings.tsx` | staff (role-gated per section) | knowledge ingestion test harness, embedding backfill | Ingestion resolves `agency_id` from the caller's own profile only — safe by construction (can't target another tenant even if it wanted to). |
| `VirtualOfficeConfig.tsx` | staff | branding, contact info, operating hours per virtual_office row | Not independently re-verified this pass against the `agency`/`profiles`-class leak pattern — flag for the same check. |
| `FlowBuilder.tsx` | staff (system_admin/agency_admin per RLS on `conversation_flows`) | screening/family-intake flow authoring, draft/publish | **Structurally cannot be tenant-scoped as it stands** — there is no agency concept anywhere in the flow model it edits (confirmed: zero `agency_id` references in the component). Whatever agency's admin publishes last wins, platform-wide. |
| `AddUser.tsx` | staff | creates caregiver/client/staff accounts | **Confirmed broken** (already logged in `known-issues.md`): leaves `profiles.agency_id` NULL, breaking `current_agency_id()` for that account. Not usable safely today. |
| `batch-create-users` (Edge Function) | **no auth check at all** | mass-deletes all `auth.users` except a hardcoded preserve list, recreates under a **hardcoded** agency id | **Confirmed dangerous** (already logged): unauthenticated, wrong-target for any agency but `56fbfe38`, and would be catastrophic if reachable in a multi-tenant deployment. Must be fixed or removed before any second real agency is onboarded via any admin surface. |
| `create-user` (Edge Function) | staff (role-gated) | correctly provisions a new user under the **caller's own** `agency_id` | Confirmed safe and correct — the model to build more of, not fix. |
| The knowledge test-harness UI (part of `AgencySettings.tsx`) | staff | document ingestion, explicitly labeled "test harness, not a real upload surface yet" | Safe by construction (same as above), but not a real self-service admin panel yet by design. |

**The gap between what exists and a real SaaS admin plane:** there is currently no
system-admin panel at all (agency provisioning today is a manual migration + Edge
Function call, done by a developer, not a UI), and no coherent agency-admin
self-service panel — what exists is a scattered set of staff-facing screens, most
correctly scoped, two confirmed broken/dangerous (`AddUser.tsx`,
`batch-create-users`), and one (`FlowBuilder.tsx`) structurally unable to be
tenant-scoped until Layer 1's `conversation_flows` phase lands. **Layer 2 is mostly
unbuilt, not partially built** — this plan should not assume more exists than does.

---

## STEP 4 — Per-Office Services Junction

**Design: `agency_care_types`, scoped to `virtual_office_id`, not `agency_id`.**

Reasoning: the entire point (confirmed directly by this session's Ripple Effects work)
is that *different offices under the same agency* need to show *different* services —
Kind Care's five home-care codes vs. Ripple Effects' five inclusion-program codes,
both under agency `56fbfe38`. Scoping the junction to `agency_id` would reproduce
exactly the bug just found (global-catalog leakage between offices of the same
tenant) one level up. `virtual_office_id` is the correct grain because it's *which
storefront displays which services* that varies — `agency_id` alone can't express
that, since one agency can have N offices with different service line-ups (also true
for a *single* agency running distinct branded storefronts for different service
lines, not just this session's two-tenant-under-one-agency situation).

```sql
CREATE TABLE public.agency_care_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  virtual_office_id uuid NOT NULL REFERENCES public.virtual_office(id) ON DELETE CASCADE,
  care_type_code text NOT NULL REFERENCES public.care_types(code) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (virtual_office_id, care_type_code)
);
-- RLS: staff of the office's own agency manage; public read mirrors get_public_office's
-- existing anon-safe pattern (SECURITY DEFINER function, not direct table grant).
```

**`get_public_office` changes from filtering a JSON array to a real join:**

```sql
-- Before (JSON key inside virtual_office.public_content):
--   ct.code = ANY (v.public_content->'service_codes')
-- After:
'services', COALESCE((
  SELECT jsonb_agg(jsonb_build_object('code', ct.code, 'name', ct.name, ...) ORDER BY act.sort_order)
  FROM public.agency_care_types act
  JOIN public.care_types ct ON ct.code = act.care_type_code
  WHERE act.virtual_office_id = v.id AND ct.is_active
), '[]'::jsonb)
```

**Confirmed additive, not destructive:** `care_types` itself is untouched — no
`agency_id` re-added, no rows modified, `code` stays the FK target every existing
`caregiver_skills.care_type_code`/`client_care_needs.care_type_code`/
`shifts.care_type_code` reference already points to. The junction is a new table
sitting *beside* the existing global catalog, not a restructuring of it. Migration
path for existing data: backfill one row per `(kind-care virtual_office_id,
each of its 5 codes)` from the current `service_codes` JSON array, then the
`service_codes` key in `public_content` becomes dead/ignorable (not dropped
immediately — leave it inert for one release in case anything else reads it, confirm
nothing does, then remove in a follow-up).

---

## STEP 5 — Phased Roadmap

Ordered by: unblocks real onboarding soonest, risk (operational core untouched
wherever possible), dependency (Layer 1 → 2 → 3).

> **The actual first post-demo step is NOT M1 directly.** Step 1's map contains both
> *confirmed* 🔴 rows (read the real policy body, it's genuinely unscoped) and
> *suspected/unverified* ⚠️ rows (`time_off_requests`, `virtual_office`'s admin side,
> and the ~14 other ⚠️ tables — column present, RLS body not personally re-read this
> pass). M1 must not be scoped as "the confirmed ones plus whatever the suspected ones
> turn out to be" — that's an open-ended list, not a shippable phase. **Phase M0 below
> exists specifically to close that gap first**, so M1 starts from an exact,
> known-complete table list, not a hedge.

### Phase M0 — Verification pass: turn every ⚠️ and suspected 🔴 into confirmed
**What:** read the actual current RLS policy body (not the column's presence, not a
naming-pattern guess) for `time_off_requests`, `virtual_office` (admin/management
side), and the full ~14-table ⚠️ list from Step 1 (`care_request_time_windows`,
`care_requests`, `caregiver_availability`, `caregiver_availability_exceptions`,
`caregiver_certifications`, `caregiver_preferences`, `caregiver_registrations`,
`certifications`' write policy, `client_time_windows`, `earnings_lines`, `events`,
`order_services`, `pending_notifications`, `shift_ratings`, `shift_trades`,
`demo_purge_audit`, `system_roles`, `caregiver_performance`). For each, produce a
definitive ✅ or 🔴 — no row leaves this phase still marked "likely."
**Unblocks:** M1 having an exact, closed scope instead of an open-ended one.
**Risk:** none — this is a read-only investigation phase, identical in kind to Step 1
of this document, just deeper per table.
**Output:** an updated Step 1 table with zero ⚠️ rows remaining, and the confirmed
table list that becomes M1's actual scope.

### Phase M1 — Close every confirmed cross-tenant admin-policy gap — **SECURITY GATE, not a roadmap item**
> **M1 is a hard prerequisite, not feature work paced by business need.** M2 through
> M8 below can be sequenced against product priorities and can slip without
> consequence to anyone currently using the system. M1 cannot: it **must be complete,
> verified, and tested before any non-CareMuch person receives a real agency-admin
> login, and before any second real agency is onboarded** — including a second real
> pilot/demo agency, not only a paying customer. Onboarding a second tenant before M1
> lands means that tenant's admin can read the first tenant's user profiles and, via
> `user_roles`, grant or revoke roles in the first tenant's account. That is not an
> acceptable interim state for *any* amount of business urgency.
>
> **M1's done-definition includes a two-tenant isolation test, not just a code
> review.** Tenant isolation is unverifiable with only one agency in the system —
> every 🔴 policy in Step 1 looks identical whether it's fixed or not when there's
> nothing else to leak to. M1 is not done until: two real agency rows exist, each with
> its own agency_admin account, and a deliberate attempt by Agency A's admin to read
> Agency B's profiles/roles/conversation data/time-off requests (per M0's final
> confirmed list) is verified to fail. This test can use disposable throwaway
> accounts/agencies (same precedented, create-and-tear-down method used earlier this
> session for the Tranche 3E staging proof) — it does not require a real second
> customer, only a real second tenant *row* to test against.

**What:** using M0's confirmed list (not the current draft list below, which is
pending M0), add `agency_id = current_agency_id()` (or the equivalent
already-established helper) to every confirmed unscoped "admin can manage/view"
policy. Known members of this list already: `agency`, `profiles`, `user_roles` (the
privilege-escalation one), `conversation_sessions`, `conversation_answers`. M0 will
confirm whether `time_off_requests`, `virtual_office`, and any of the ~14 ⚠️ tables
join this list.
**Unblocks:** the actual security precondition for onboarding *any* second real
agency — today, a second agency's admin could read/manage the first agency's users,
roles, and screening PII.
**Risk:** low per-table (additive `AND` clause to an existing `USING`), but touches
`user_roles` — the most sensitive table in the system, since a mistake here can lock
out legitimate admins. The two-tenant isolation test above is what catches that,
not code review alone.
**Backfill:** none needed — these are policy changes, not data changes.
**Kind Care stays working:** yes — Kind Care's own admins keep full access to Kind
Care's own data; the change only removes access *to other tenants*, which today has
no other tenant to lose access to (until the two-tenant test above deliberately
creates one, disposably, to prove it).

### Phase M2 — `conversation_flows` agency-scoping
**What:** relax the unique partial index from `(audience) WHERE status='published'` to
`(audience, agency_id) WHERE status='published'`; decide the NULL-`agency_id` fallback
semantics (recommend: NULL = platform-default flow, only used if an agency has no
flow of its own — preserves today's single-flow behavior with zero migration for
existing rows); add `agency_id` filtering to `useConversationFlow.loadFlow()` and to
`flow_nodes`/`flow_options`' RLS (currently inherited-global, would need to inherit
the now-agency-scoped parent correctly).
**Unblocks:** the literal thing this session's Ripple Effects demo hit — two agencies
having simultaneously live, independently branded screening/intake flows.
**Risk:** medium — touches the public-facing conversation engine directly; a mistake
here breaks live screening/intake for every agency, not just one. Requires careful
testing of the NULL-fallback path specifically, since that's what keeps existing
(single-agency) behavior unchanged.
**Backfill:** existing flows keep `agency_id = NULL` (fallback/default), no forced
migration.
**Kind Care stays working:** yes, via the NULL-fallback design — Kind Care's flow
becomes "the platform default" unless/until it's given its own `agency_id`.

### Phase M3 — Services junction (`agency_care_types`)
**What:** exactly Step 4's design.
**Unblocks:** per-office service lists without JSON-key gymnastics; the thing this
session had to hand-roll for the Ripple Effects demo becomes a real, reusable
mechanism.
**Risk:** low — new table, additive, `care_types`/its FKs untouched.
**Backfill:** one-time script converting existing `service_codes` JSON arrays to
junction rows (covers Kind Care today).
**Kind Care stays working:** yes, backfilled identically to its current display.

### Phase M4 — Verification pass on the ⚠️ tables
**What:** individually re-read and confirm/fix the ~14 tables marked ⚠️ in Step 1's
map (RLS bodies not yet re-checked this pass).
**Unblocks:** confidence that Layer 1 is actually complete, not "probably complete."
**Risk:** low — mostly a reading/verification task; any fixes found follow the same
additive-`AND`-clause pattern as M1.
**Kind Care stays working:** yes, verification-only unless a real gap is found.

### Phase M5 — Fix or remove `batch-create-users`; retire/fix `AddUser.tsx`
**What:** either add the missing auth/role check and remove the hardcoded
agency/wipe behavior, or delete it outright if nothing legitimate depends on it;
either fix `AddUser.tsx`'s missing `agency_id` or replace its call path with
`create-user` (the already-correct function).
**Unblocks:** safe to build Layer 2's agency-admin panel on top of user provisioning
without inheriting a live landmine.
**Risk:** low for the fix itself; the *investigation* of whether anything currently
depends on `batch-create-users`' exact behavior is the real work here (per
`known-issues.md`'s existing note).
**Kind Care stays working:** yes, unaffected either way.

### Phase M6 — System-admin panel (Layer 2)
**What:** the first real UI for what's currently manual-migration-only: provisioning
a new agency (row + first agency_admin account via `create-user`), platform-wide
oversight (agency list, basic health/activity), cross-tenant visibility that is
*itself* properly gated to system_admin only (no repeat of the M1 pattern in the new
UI).
**Unblocks:** onboarding a second real agency without a developer running SQL by
hand.
**Risk:** medium — new surface, but sits on top of Layer 1's now-fixed foundation
rather than needing to invent its own isolation logic.
**Depends on:** M1 (can't safely expose a cross-tenant-visible panel over
still-leaky RLS).

### Phase M7 — Agency-admin panel (Layer 2)
**What:** self-service for a tenant to manage their own agency + virtual office(s):
branding/content (already mostly data-driven, per this session's Ripple Effects
work), services (via M3's junction), knowledge (already has a test-harness precursor
in `AgencySettings.tsx`), flows (once M2 makes per-agency flows real), staff
(replacing `AddUser.tsx`/depending on M5).
**Unblocks:** the actual "agency admins self-serve their own agency" product promise.
**Risk:** medium-high — the biggest net-new surface in this plan; every screen must
double-check it can't reach past its own `agency_id`, learning directly from the M1
gaps.
**Depends on:** M1, M3, M5, and M2 if flow self-service is in scope for v1.

### Phase M8 — Custom domains / tenant resolution (Layer 3, higher-level only)
**What, at the architecture level:** move from path-based (`/a/:slug`) to
domain-based (`agencydomain.com`) resolution. Requires: a domain→`virtual_office_id`
lookup (new table or column, e.g. `virtual_office.custom_domain text UNIQUE`), a
request-time resolution step (edge middleware or a routing layer) that maps the
incoming `Host` header to exactly one `virtual_office`/`agency_id` *before* any data
access happens, and DNS/TLS provisioning per tenant (a real operational undertaking —
verification, certificate issuance, likely a third-party service rather than
hand-rolled). The critical design constraint, stated for Layer 1/2 to design toward
now so this doesn't get painted into a corner later: **the domain→tenant mapping must
be a single, unambiguous, server-side lookup that every subsequent query derives its
`agency_id`/`virtual_office_id` from — never a client-supplied parameter, the same
discipline `search-knowledge` already applies by hardcoding `_surfaces` server-side
rather than trusting the request body.**
**Depends on:** Layers 1 and 2 substantially complete — domain resolution over
still-leaky tenant isolation just gives cross-tenant leaks a prettier URL.
**Not detailed further per your instruction — this is the one phase to plan at
architecture-level only, since it's furthest out.**

---

## STEP 6 — Risks & Open Decisions

**Must decide before building:**
- **Agency-vs-office scoping for services (Step 4):** this plan recommends
  `virtual_office_id`. Confirm — it's the one design choice everything else in M3
  builds on.
- **Can virtual offices under one agency genuinely differ, or is "one agency, one
  brand" close enough for v1?** This session's Ripple Effects work assumed genuine
  per-office difference is required (that's *why* M2/M3 exist as separate phases) —
  worth an explicit confirmation since it changes M2's urgency.
- **The `conversation_flows` NULL-agency fallback semantics** (M2) — recommended
  "NULL = platform default," but this is a real product decision about what a brand
  new agency sees before authoring their own flow, not just an implementation detail.
- **Custom-domain provisioning model** (M8) — self-service (agency admin enters a
  domain, gets DNS instructions + auto-TLS via a provider) vs. white-glove
  (CareMuch staff provisions it manually per agency). Changes M8's shape
  substantially; flagging now so Layer 2's agency-admin panel design doesn't assume
  one over the other prematurely.

**Decide later (not blocking near-term work):**
- Exact UI/UX of the system-admin and agency-admin panels (M6/M7) — Step 3's gap
  analysis is enough to sequence the work; detailed screen design can wait until M1-M5
  land.
- Whether `service_codes` (the JSON key M3 makes dead) gets removed immediately or
  left inert for a release — low-stakes, reversible either way.

**Specific risks called out:**
- **`user_roles` (M1) is the single highest-risk change in this entire plan** — it's
  the table that determines who can do what, for whom. A scoping mistake here doesn't
  just leak data, it can silently lock out a legitimate admin or, worse, fail open in
  a way that's hard to notice. Test with real multi-agency accounts, not just a single
  tenant, before trusting it.
- **The operational core (`caregivers`/`clients`/`shifts`/`shift_assignments`) is
  already correctly isolated** (Step 2a) — this plan deliberately does **not** touch
  any of those tables. The temptation in a "multi-tenant SaaS" plan is to re-touch
  everything; resist it here, since these are real, working, already-correct
  features and the risk/reward of touching them is strictly negative.
- **`conversation_flows` (M2) is medium risk specifically because it's live and
  public-facing** — any regression breaks screening/intake for every agency
  simultaneously, not just the one being onboarded. Test the NULL-fallback path
  exhaustively.
- **Data backfill:** M2 and M3 both need one-time backfills (NULL `agency_id` for
  existing flows; `service_codes` JSON → junction rows for Kind Care's existing
  office). Both are small, one-time, reversible, and don't touch the operational
  core.
- **Custom-domain tenant resolution (M8) is a security boundary, not just a routing
  convenience** — a bug here means a request on `agencyA.com` could resolve to
  `agencyB`'s data. This is the same class of risk the surface-boundary work (Tranche
  3A) already solved once, for a different axis (public vs. caregiver knowledge) — M8
  should reuse that same discipline (server-side resolution, no client-supplied
  tenant identifier trusted) rather than inventing a new pattern.

---

## What This Plan Deliberately Does Not Do

Redesign or re-touch anything already confirmed correct (Step 2a's list). Propose UI
mockups for M6/M7 (explicitly deferred per Step 6). Detail M8 beyond
architecture-level, per your instruction. Assume any table's RLS without either
reading its actual policy body this session or explicitly marking it ⚠️ unverified.
Execute anything — every phase above is a proposal, none is started.

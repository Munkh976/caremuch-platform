# M1 Security Gate — Verification Results, Fix Design & Closure

> **Status: CLOSED — applied and verified 2026-09-13.** This started as the M0
> verification pass (per `multitenant-saas-architecture-plan.md`'s Step 5, Phase M0)
> plus the M1 fix design, done by reading the **live** RLS policy bodies directly from
> the live DEV database (`rgeldgztadebgvrdhaqa` — the only project; no production project exists
> yet, see `docs/Ripple_UI_Plan_Decisions_2026-10-01.md`), not by inference from migration
> files. §7 records the applied migration, the pre-push regression finding
> (`EditUser.tsx`) and its fix, and the full two-tenant isolation test run — 25/25
> checks passed, teardown confirmed clean by content. M1 is closed per the roadmap's
> own done-definition (§5 of this doc): a real second tenant existed, isolation was
> proven to fail correctly for it, and Kind Care/Ripple Effects' own access was proven
> unchanged.

**Method:** direct read-only Postgres connection (`pg` npm driver, `SELECT`-only
queries against `pg_policies`, `pg_class.relrowsecurity`, `information_schema`,
`pg_proc`), using the real database password — not the anon/publishable key, which is
a JWT for the PostgREST/Auth API and cannot authenticate a raw Postgres connection.
`psql` is not installed on this machine; `pg` was installed locally
(`npm install --no-save pg`, not committed, confirmed `git status` clean throughout).
This connection was used for reads only, per your instruction — **all actual fixes go
through reviewed migrations (`supabase db push`), never ad-hoc writes through this
connection.**

---

## 1. Definitive Tenancy Map (M0 complete — zero ⚠️ remaining)

Every table in `public` (44 base tables + 1 view) was checked. All 44 base tables have
`rls_enabled = true`, `rls_forced = false`, and **none have zero policies** (no
accidentally-wide-open or accidentally-locked tables).

Legend: ✅ correctly agency-scoped · 🔴 confirmed cross-tenant gap · 🌐 intentionally
global (correct as-is) · 🆕 new finding not in the original plan.

| Table | Verdict | What the live policy actually says |
|---|---|---|
| `agency` | 🔴 | "Admins can manage agencies": `ALL`, `USING (has_role(system_admin) OR has_role(agency_admin))`, **no self-row check, no `WITH CHECK`**. Since `ALL` with no explicit `WITH CHECK` reuses `USING`, this also lets any agency's admin **INSERT new agency rows**, not just read/edit existing ones. |
| `care_request_time_windows` | ✅ | All 4 CRUD policies: `has_role(system_admin) OR (is_agency_staff() AND agency_id = current_agency_id())`. Confirmed correct. |
| `care_requests` | ✅ | Same pattern, plus client/family self-read via `my_client_ids()`. Confirmed correct. |
| `care_service_categories` | 🌐 | Global catalog, public+staff read; write is role-only (`agency_admin`/`manager`, any tenant) — see §3 governance note. |
| `care_types` | 🌐 | Confirmed: `agency_id` column genuinely absent from live table. Global catalog, same write-governance note as above. |
| `caregiver_availability` | ✅ | Join-based (`caregivers.agency_id = profiles.agency_id`). Confirmed correct. |
| `caregiver_availability_exceptions` | ✅ | `has_role(system_admin) OR caregiver_id IN my_caregiver_ids() OR (is_agency_staff() AND agency_id=current_agency_id())`. Confirmed correct. |
| `caregiver_certifications` | ✅ | `is_agency_staff() AND caregiver_agency_id(caregiver_id) = current_agency_id()`. Confirmed correct. |
| `caregiver_preferences` | ✅ | Same additive pattern on all 4 CRUD ops. Confirmed correct. |
| `caregiver_registrations` | 🔴 🆕 | Non-NULL `agency_id` rows are correctly scoped (`agency_id IN (own profile's agency)`). **But** the SELECT/UPDATE policies also OR in `agency_id IS NULL` — so every un-attributed registration (the confirmed `/assistant` office-attribution gap in `known-issues.md`) is visible/editable by **any agency's** staff with a qualifying role, not just the one agency that should triage it. This compounds the known gap into a cross-tenant one. |
| `caregiver_skills` | ✅ | Already confirmed in the original plan. |
| `caregivers` | ✅ | Already confirmed. |
| `certifications` | 🌐 | Confirmed: same global-catalog shape as `care_types`. |
| `client_care_needs` | ✅ | Already confirmed. |
| `client_orders` | ✅ | Already confirmed. |
| `client_time_windows` | ✅ | `has_role(system_admin) OR (is_agency_staff() AND agency_id=current_agency_id())` (+ client self-read). Confirmed correct. |
| `clients` | ✅ | Already confirmed. |
| `conversation_answers` | 🔴 | "Staff can read answers": `has_role(system_admin\|agency_admin\|manager\|hr_staff)` — **literally no reference to `session_id`, `agency_id`, or any join at all.** Any qualifying role, any tenant, reads every agency's screening/intake answers. |
| `conversation_flows` | 🔴 (by design, M2 territory) | "Admins manage flows": role-only, no agency check — confirmed live, and it's worse than read-only exposure: any tenant's admin can edit/publish/delete **any other tenant's** flow content, platform-wide. Read side (`status <> 'draft'`) also global. Deliberately **not** in M1's fix list — needs the `(audience, agency_id)` index redesign + NULL-fallback decision already scoped as **Phase M2** in the roadmap. |
| `conversation_sessions` | 🔴 | Both SELECT ("Staff can read agency sessions") **and** UPDATE ("Staff can update session follow up") are role-only with **zero** `agency_id` reference, despite the column existing on the table. Broader than the original plan's read-only framing — the write path is unscoped too. |
| `demo_purge_audit` | 🌐 | `has_role(system_admin)` only. Confirmed platform-only, not tenant data. |
| `earnings_lines` | ✅ | Staff: `is_agency_staff() AND (agency_id=current_agency_id() OR system_admin)`; caregiver: own rows only. Confirmed correct. No INSERT/UPDATE/DELETE policy exists at all (writes are RPC/service-role only) — expected. |
| `events` | ✅ | `is_agency_staff() AND agency_id=current_agency_id()` (staff) + `system_admin` (platform). Confirmed correct. SELECT-only, as expected (`log_event()` is `SECURITY DEFINER`). |
| `families` | ✅ | Already confirmed. |
| `family_contacts` | ✅ | Already confirmed. |
| `flow_nodes` | 🔴 (inherited, M2) | Same as `conversation_flows` — role-only management, status-only read. Deferred with its parent. |
| `flow_options` | 🔴 (inherited, M2) | Same. |
| `knowledge_chunks` | ✅ | Already confirmed. Single staff-only `ALL` policy, no direct public/anon grant — reads go through the `SECURITY DEFINER` RPCs only, as CLAUDE.md describes. |
| `knowledge_documents` | ✅ | Already confirmed, same shape. |
| `order_services` | ✅ | `is_agency_staff() AND order_agency_id(order_id)=current_agency_id()` + client self-read via `order_client_id()`. Confirmed correct. |
| `pending_notifications` | 🔴 | **All three** policies (INSERT/UPDATE/SELECT) are role-only with no `agency_id` check — `known-issues.md` had only confirmed the SELECT side; the write side (INSERT/UPDATE) has the identical gap. An agency_admin/manager of Agency B can view, and — if the client ever passes an explicit `agency_id` — insert/update Agency A's notification rows. |
| `profiles` | 🔴 | "Admins can view all profiles": `has_role(system_admin\|agency_admin)`, no agency check. Confirmed exactly as flagged — full cross-tenant PII read for any agency's admin. |
| `role_permissions` | 🌐 | Confirmed: read-all-authenticated, `system_admin`-only write. Correctly platform-gated (unlike the catalogs above). |
| `shift_assignments` | ✅ | Already confirmed — best-designed table in the map (no INSERT/DELETE policy at all; RPC-only). |
| `shift_ratings` | ✅ | Uses an inline `profiles` subquery instead of the `current_agency_id()` helper, but is equivalent and correctly own-agency-only. Style inconsistency, not a security gap. |
| `shift_trades` | ✅ | Scopes via `caregivers.agency_id = profiles.agency_id` for the acting user — correctly same-agency only. (No role check at all, so any authenticated user whose own `profiles.agency_id` matches could act — an intra-tenant authorization question, not a cross-tenant one; out of M1 scope.) |
| `shifts` | ✅ | Already confirmed. |
| `system_modules` | 🌐 | Confirmed: `system_admin`-only write, matches `role_permissions`. |
| `system_roles` | 🌐 | Confirmed: same pattern, resolves the plan's "presumed" note. |
| `time_entries` | ✅ | Own-caregiver + `is_agency_staff() AND (agency_id=current_agency_id() OR system_admin)`. Confirmed correct. |
| `time_off_requests` | ✅ 🆕 (reverses the plan's suspicion) | **The live policy is already correctly scoped**: `(has_role(manager\|agency_admin\|system_admin) AND agency_id=current_agency_id())` for the decide/update path, `is_agency_staff() AND agency_id=current_agency_id()` for staff view. The plan's "suspected 🔴" was based on an older migration excerpt; a later, unlogged migration already fixed this. **No fix needed — remove from M1 scope.** |
| `user_roles` | 🔴 (most severe) | "Admins can manage all roles": `ALL`, `has_role(system_admin\|agency_admin)`, no agency check. Confirmed exactly — privilege-escalation vector, highest-risk item in the whole map. |
| `virtual_office` | ✅ 🆕 (reverses the plan's suspicion) | All 4 CRUD policies correctly use `is_agency_staff() AND agency_id=current_agency_id()` (or `system_admin`). **No fix needed — remove from M1 scope.** |
| `caregiver_performance` (view) | ✅ 🆕 | `security_invoker = true` — it runs with the querying user's own permissions, so RLS on its base tables (`caregivers`, `shift_assignments`, `shifts`, `shift_ratings` — all confirmed ✅ above) applies normally. `anon`/`authenticated` hold raw SQL grants on the view (standard Supabase default), but RLS on the base tables blocks anon entirely and scopes authenticated users correctly. No gap. |

**Net result of M0:** every ⚠️ row from the original plan is now ✅, 🔴, or 🌐 — no
open questions remain. Two items the plan had flagged with lower confidence
(`time_off_requests`, `virtual_office`) turn out to already be fixed live and **drop
out of M1's scope**. One new compounding gap was found (`caregiver_registrations`'
NULL-`agency_id` branch). The `pending_notifications` gap is confirmed on all three
CRUD policies, not just SELECT.

---

## 2. Confirmed M1 fix list (final, after M0)

| # | Table | Fix complexity | Notes |
|---|---|---|---|
| 1 | `user_roles` | Additive `AND`, but highest blast radius | Privilege escalation vector — test hardest |
| 2 | `profiles` | Additive `AND` | |
| 3 | `agency` | Split into system_admin-unrestricted + agency_admin-self-row policies | Also closes the INSERT gap |
| 4 | `conversation_sessions` | Additive `AND` on both SELECT and UPDATE | NULL-`agency_id` rows become system_admin-only (see §4 side effect) |
| 5 | `conversation_answers` | Additive `AND` via `EXISTS` join to `conversation_sessions` | No `agency_id` column on this table itself |
| 6 | `pending_notifications` | Additive `AND` on all three policies (INSERT/UPDATE/SELECT) | Original plan only had SELECT |
| 7 | `caregiver_registrations` | Remove the `agency_id IS NULL` OR-branch from staff SELECT/UPDATE | Minimal fix: NULL rows become system_admin-only, consistent with #4. Full fix (require attribution) stays with the `/assistant` retirement work already tracked in `known-issues.md`. |

**Explicitly out of M1 scope, confirmed correct or already fixed:**
`time_off_requests`, `virtual_office` (both ✅ live already), and all tables listed ✅
or 🌐 above.

**Explicitly deferred to M2, not M1** (per the existing roadmap — not re-litigated
here): `conversation_flows`, `flow_nodes`, `flow_options`. These need a product
decision (the `(audience, agency_id)` index + NULL-fallback semantics), not a
mechanical additive-`AND` fix, so bundling them into M1 would block M1 on a decision
that doesn't need to gate the rest of the security fixes.

---

## 3. Fix designs (SQL sketches — NOT applied)

All fixes follow the codebase's own established pattern
(`is_agency_staff(auth.uid()) AND agency_id = current_agency_id()`, with an explicit
`system_admin` bypass preserved wherever it already exists) rather than inventing a
new mechanism.

### 3.1 `user_roles` (highest priority)
```sql
DROP POLICY "Admins can manage all roles" ON public.user_roles;

CREATE POLICY "System admins manage all roles"
ON public.user_roles FOR ALL TO authenticated
USING (has_role(auth.uid(), 'system_admin'))
WITH CHECK (has_role(auth.uid(), 'system_admin'));

CREATE POLICY "Agency admins manage roles in their own agency"
ON public.user_roles FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'agency_admin')
  AND agency_id = current_agency_id()
  AND agency_id = (SELECT p.agency_id FROM public.profiles p WHERE p.id = user_roles.user_id)
)
WITH CHECK (
  has_role(auth.uid(), 'agency_admin')
  AND agency_id = current_agency_id()
  AND agency_id = (SELECT p.agency_id FROM public.profiles p WHERE p.id = user_roles.user_id)
);
```
**Hardening beyond the minimal fix:** the extra `agency_id = target user's real
profiles.agency_id` clause stops an agency_admin from writing a `user_roles` row whose
`agency_id` column says "mine" while `user_id` actually points at a user in a
different tenant — a mismatch nothing currently prevents. Given this is the
single highest-risk table in the map, recommend including this extra check rather
than the bare minimal fix.

### 3.2 `profiles`
```sql
DROP POLICY "Admins can view all profiles" ON public.profiles;

CREATE POLICY "System admins view all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'system_admin'));

CREATE POLICY "Agency admins view their agency profiles"
ON public.profiles FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'agency_admin') AND agency_id = current_agency_id());
```

### 3.3 `agency`
```sql
DROP POLICY "Admins can manage agencies" ON public.agency;

CREATE POLICY "System admins manage all agencies"
ON public.agency FOR ALL TO authenticated
USING (has_role(auth.uid(), 'system_admin'))
WITH CHECK (has_role(auth.uid(), 'system_admin'));

CREATE POLICY "Agency admins manage their own agency"
ON public.agency FOR ALL TO authenticated
USING (has_role(auth.uid(), 'agency_admin') AND id = current_agency_id())
WITH CHECK (has_role(auth.uid(), 'agency_admin') AND id = current_agency_id());
```
Side effect (intended): an agency_admin can no longer INSERT a brand-new `agency` row
(their own `current_agency_id()` never equals a not-yet-existing row's `id`) —
provisioning a new tenant becomes system_admin-only, matching M6's planned design.

### 3.4 `conversation_sessions`
```sql
DROP POLICY "Staff can read agency sessions" ON public.conversation_sessions;
CREATE POLICY "Staff can read agency sessions"
ON public.conversation_sessions FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id())
  OR user_id = auth.uid()
);

DROP POLICY "Staff can update session follow up" ON public.conversation_sessions;
CREATE POLICY "Staff can update session follow up"
ON public.conversation_sessions FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()))
WITH CHECK (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()));
```

### 3.5 `conversation_answers`
```sql
DROP POLICY "Staff can read answers" ON public.conversation_answers;
CREATE POLICY "Staff can read answers"
ON public.conversation_answers FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin')
  OR (is_agency_staff(auth.uid()) AND EXISTS (
        SELECT 1 FROM public.conversation_sessions s
        WHERE s.id = conversation_answers.session_id
          AND s.agency_id = current_agency_id()
      ))
);
```

### 3.6 `pending_notifications`
```sql
DROP POLICY "Staff can view pending notifications" ON public.pending_notifications;
CREATE POLICY "Staff can view pending notifications"
ON public.pending_notifications FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()));

DROP POLICY "Staff can create pending notifications" ON public.pending_notifications;
CREATE POLICY "Staff can create pending notifications"
ON public.pending_notifications FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()));

DROP POLICY "Staff can update pending notifications" ON public.pending_notifications;
CREATE POLICY "Staff can update pending notifications"
ON public.pending_notifications FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()))
WITH CHECK (has_role(auth.uid(), 'system_admin') OR (is_agency_staff(auth.uid()) AND agency_id = current_agency_id()));
```

### 3.7 `caregiver_registrations`
```sql
DROP POLICY "Staff can view caregiver registrations" ON public.caregiver_registrations;
CREATE POLICY "Staff can view caregiver registrations"
ON public.caregiver_registrations FOR SELECT TO authenticated
USING (
  (has_role(auth.uid(),'system_admin') OR has_role(auth.uid(),'agency_admin')
   OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'hr_staff'))
  AND (has_role(auth.uid(),'system_admin')
       OR agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid()))
);
-- Same change (drop the `agency_id IS NULL` branch) on "Staff can update caregiver registrations".
```

---

## 4. Side effects requiring a decision before applying (not a blocker, but flag now)

- **NULL-`agency_id` legacy rows become system_admin-only** on `conversation_sessions`
  and `caregiver_registrations` after these fixes. Today, agency staff can currently
  see these (that's the leak). After the fix, only `system_admin` can triage the
  handful of legacy `/assistant`-path rows. This is the *correct* tightening (no
  tenant should see another tenant's unattributed leads), but it does mean whoever
  currently handles those stray rows loses visibility unless they're a system_admin —
  worth a one-line heads-up to whoever does that triage today, not a redesign.
- **`user_roles`' extra profile-match check (§3.1)** is a deliberate hardening beyond
  the minimal fix. If you'd rather ship the minimal `agency_id = current_agency_id()`
  version first and add the cross-check later, that's a smaller, lower-risk diff —
  flagging the tradeoff rather than deciding it here.
- **Global-catalog write governance** (`care_types`, `care_service_categories`,
  `certifications` — any tenant's `agency_admin`/`manager` can edit these shared
  catalogs, unlike `role_permissions`/`system_modules`/`system_roles` which are
  already `system_admin`-only): not a cross-tenant *data* leak (catalogs are meant to
  be shared), so **not proposed as part of M1**. Flagging only because it's an
  inconsistency with its sibling global tables — a product decision for later if it
  ever matters, not a security fix.

---

## 5. Two-tenant isolation test (M1's actual done-definition)

Per the roadmap's own M1 done-definition, none of the above is "done" until proven
against a real second tenant. Plan:

1. **Provision a disposable Agency B** — a throwaway `agency` row + one throwaway
   `agency_admin` user, created directly (there's no self-service "create agency" flow
   yet — that's M6), same precedented create-and-tear-down method used for the
   Tranche 3E staging proof. Agency A = the real `56fbfe38` (Kind Care / Ripple
   Effects).
2. **Authenticate as Agency B's admin** (real JWT, not service_role) and attempt,
   against every table in §2's fix list:
   - `agency`: `SELECT`/`UPDATE` where `id` = Agency A's id → expect 0 rows / reject.
   - `profiles`: `SELECT` where `agency_id` = Agency A → expect 0 rows.
   - `user_roles`: `SELECT` Agency A's rows → expect 0 rows. **Privilege-escalation
     attempt specifically:** try to `INSERT`/`UPDATE` a `user_roles` row granting a
     role to an Agency-A user, or granting Agency B's admin a role scoped to Agency A
     → must be rejected.
   - `conversation_sessions` / `conversation_answers`: `SELECT` Agency A's rows →
     expect 0 rows.
   - `pending_notifications`: `SELECT`/`INSERT`/`UPDATE` against Agency A's rows →
     expect 0 rows / reject.
   - `caregiver_registrations`: confirm a NULL-`agency_id` row (if one exists) is no
     longer visible to Agency B's admin.
3. **Regression check (Kind Care must keep working):** repeat every read/write above
   as Agency A's own real admin against Agency A's own data → must all still succeed,
   unchanged from today.
4. **system_admin bypass check:** confirm a real system_admin account still sees
   across both tenants everywhere it's supposed to (the intended, unchanged bypass —
   not a bug if it still works after the fix).
5. **Tear down** Agency B's disposable rows/user afterward — reversible, no
   permanent footprint, same as the Tranche 3E precedent.

Only once all of the above passes is M1 considered closed per the roadmap's own
definition — not just "the migration applied cleanly."

---

## 6. What this document deliberately does not do

Apply any of the fixes in §3. Touch `conversation_flows`/`flow_nodes`/`flow_options`
(M2, needs a product decision first). Re-touch any table already confirmed correct.
Decide the NULL-`agency_id` triage-ownership question in §4 (flagged for you, not
decided here). Propose changes to the global-catalog write governance in §4 (flagged,
not proposed as required).

**Next step, on your approval:** write the §3 fixes as a single reviewed migration,
apply via `supabase db push` (with your explicit approval per your standing
instructions), then run the §5 two-tenant test against it before declaring M1 closed.

---

## 7. Closure Record (2026-09-13)

### 7.1 Migration applied
`supabase/migrations/20260913214228_m1_agency_scope_admin_policies.sql` — exactly the
§3.1–§3.7 fixes, `user_roles` hardened per your decision. Applied via
`supabase db push` after your explicit SQL review and approval.

### 7.2 Pre-push regression found and fixed: `EditUser.tsx`
Before pushing, checked whether the hardened `user_roles` policy could break account
creation. The four flows named in your question (`create-user`,
`enable-client-login`, `enable-caregiver-login`, `approve-caregiver-registration`) all
write `user_roles` via a `service_role` client — confirmed by grep — so they bypass RLS
entirely and were never at risk.

A fifth, unasked-about path was found and *would* have broken: `EditUser.tsx`
(`/users/edit/:id`, live and reachable from `Users.tsx`) ran as the calling
agency_admin/system_admin via the regular authenticated client, doing a
non-transactional `DELETE` then `INSERT` into `user_roles` with **no `agency_id` set
on the insert** (column is nullable, no default, no trigger backfill). Post-migration,
an agency_admin using this page would have the `INSERT` rejected by the new `WITH
CHECK` (NULL never equals `current_agency_id()`) — and since the `DELETE` had already
committed, the target user would be left with **zero roles** (locked out) until a
system_admin intervened. `system_admin` itself was unaffected (its bypass policy has
no `agency_id` condition).

**Fix applied** (`src/pages/EditUser.tsx`): fetch the target user's own
`profiles.agency_id` and pass it on the write; reorder to `upsert`-the-new-role
**before** deleting the old one (`onConflict: 'user_id,role'`, matching the unique
constraint already used by the other role-write flows), so a failure partway through
can never leave the user with zero roles. Both the NULL-`agency_id` bug (same class as
the earlier `AddUser` NULL-agency bug) and the lockout window are closed by this one
change — no follow-up needed for either.

Pushed together with the RLS migration as one atomic change, per your instruction —
no window where the security fix was live without its required app accommodation.

*Noted, not acted on:* `UserRoles.tsx`'s inline edit dialog performs the same
role-change job via a safe partial `.update()` that never touches `agency_id`, and
already provides listing/search/filter/edit/delete in one place. `EditUser.tsx` looks
like redundant, narrower duplication of that — worth consolidating later, not part of
this fix.

### 7.3 Two-tenant isolation test — 25/25 passed

Ran via a disposable-fixture script (`@supabase/supabase-js`, mirroring the
`create-user`/Tranche 3E precedent: real `auth.admin.createUser` accounts, real
`signInWithPassword` JWTs — actual RLS enforcement through PostgREST, not a superuser
connection). Agency A = the real `56fbfe38-e8eb-40c1-ba27-07428f62ed2e` ("CareMuch
Agency" — Kind Care/Ripple Effects are its virtual offices). Agency B = one throwaway
disposable agency + throwaway agency_admin. Also bootstrapped: a throwaway Agency-A
agency_admin and system_admin (to test regression/bypass without needing real
production credentials), and one throwaway Agency-A "target" staff user (to exercise
the fixed `EditUser.tsx` flow on).

**Isolation (as Agency B's admin, targeting Agency A's data) — all 12 blocked:**
| Check | Result |
|---|---|
| Read `agency` row A | 0 rows |
| Read own `agency` row B (sanity) | 1 row ✅ |
| Read `profiles` in A | 0 rows |
| Read `user_roles` in A | 0 rows |
| **Escalation attempt 1:** move own `user_roles.agency_id` to A | rejected (RLS violation); service-role recheck confirmed unchanged |
| **Escalation attempt 2:** grant a role on an Agency-A user, scoped to A | rejected (RLS violation); confirmed no row created |
| Read `conversation_sessions` in A | 0 rows |
| Read `conversation_answers` in A | 0 rows |
| Read `pending_notifications` in A | 0 rows |
| Update `pending_notifications` in A | 0 rows affected; body unchanged |
| Read `caregiver_registrations` in A | 0 rows |
| Read NULL-`agency_id` `caregiver_registrations` (the fixed branch) | 0 rows |

**Regression (as Agency A's admin, own data) — all 9 passed:**
| Check | Result |
|---|---|
| Read own `agency` row | 1 row |
| Read own-agency `profiles` | 9 rows |
| Read own `conversation_sessions`/`conversation_answers` | 1 row each |
| Read own `pending_notifications` | 1 row |
| Read own real-agency `caregiver_registrations` | 1 row |
| Read the NULL-agency registration | 0 rows (intended — system_admin-only now, per your §4 decision) |
| **Fixed `EditUser.tsx` flow** (upsert-then-delete) on the Agency-A target user | succeeded; target ended with exactly one role (`manager`, correct `agency_id`) — no lockout |
| **`create-user` Edge Function, end-to-end** | succeeded (`success:true`, real user created) — empirical proof the account-creation flows still work, not just a code read |

**system_admin bypass — all 4 confirmed still working:**
sees both agency rows, profiles from both agencies, `user_roles` from both agencies,
and the NULL-`agency_id` registration that agency_admins can no longer see.

**Teardown:** all fixture rows/users/agency deleted, then **re-queried** (not just
trusting delete responses) — every throwaway user id came back "not found" from
`auth.admin.getUserById`, the disposable agency row and every fixture row across
`conversation_sessions`/`conversation_answers`/`pending_notifications`/
`caregiver_registrations` came back absent. Confirmed clean, no footprint. (Local
scripts and the temporarily-installed `pg`/`@supabase/supabase-js` npm packages were
`--no-save`, never touched `package.json`/lockfile — `git status` stayed clean
throughout this entire pass.)

### 7.4 Housekeeping note
The DB connection string pasted in chat during this session (containing the database
password) is now in the session log. **Rotate the database password** once you're
satisfied M1 is fully closed — noted per your instruction, not acted on.

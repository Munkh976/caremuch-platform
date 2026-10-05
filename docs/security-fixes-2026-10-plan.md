# Security fixes — October 2026 (from the Oct 1 UI capture)

> **Status (Oct 2): plan APPROVED with the owner's answers and additions A1–A3 (§7). E1 DONE
> (read-only) — results in §6. Stopped for owner review of E1; next is the M-SEC-1 draft. Nothing
> pushed, no data written.**
> Original status line: PLAN ONLY — awaiting approval. No code, migration, configuration or data has been
> changed. Migrations below are **drafts for review**; they are pushed only after approval, one
> at a time, each followed by an `aclexplode(proacl)` / `pg_policies` verification. Data writes
> (§2.5 redaction, §3.3 deletion) each need their own explicit approval with the row list shown.
>
> Method: static replay of every migration in `supabase/migrations` (in filename order, tracking
> `CREATE/DROP POLICY` and `DROP TABLE`) to derive the **current** policy set per table; reading
> every route component, Edge Function and caller; and a read-only PostgREST probe.
> **The live JWT probe could not run:** both `SCREENSHOT_*` logins in `.env.local` now return
> `Invalid login credentials` (passwords changed since the capture). Every RLS finding below is
> therefore *derived from migrations* and is marked **[to confirm live]** until §4 step E1 runs.

---

## 0. Findings at a glance

| # | Issue | Severity | Real fix | Data write needing approval |
|---|---|---|---|---|
| 1a | 13 staff routes have no role guard (caregiver/client can open them) | 🟠 UX/defense-in-depth | Route guard in `App.tsx` | — |
| 1b | **Caregivers (and clients) can read *and write* other caregivers' rows**, and read families / care requests / client care needs / all ratings in their agency — policies check *agency membership*, not *staff role* | 🔴 | RLS migration M-SEC-1 | — |
| 1c | **A caregiver can edit protected columns on their own `caregivers` row** (pay rate, status, office) and possibly **their own `profiles.agency_id`** — no WITH CHECK, no column guard | 🔴 (cross-tenant if 1c-profiles confirms) | Trigger migration M-SEC-2 | — |
| 1d | Clients can read every caregiver in the agency incl. email, phone, **hourly_rate** (client portal) | 🟠 | Separate decision (Q3) | — |
| 2a | Temporary passwords stored in plain text in `pending_notifications.body` **and** `payload.temp_password`, returned to the browser, shown in 3 dialogs + the outbox, kept forever | 🔴 | Invite / recovery links (Supabase Auth), no stored secret | Redact existing rows (§2.5) |
| 2b | `admin-reset-password` has **no agency check** on the target user | 🔴 | Add tenant check in the function | — |
| 3a | One Supabase project (`rgeldgztadebgvrdhaqa`) is dev, demo and production at once | 🟠 process | Owner decision; no config change here | — |
| 3b | `/caregiver-registration`, `/a/:slug/apply`, and the caregiver path on `/` and `/assistant` insert a `conversation_sessions` row on page load | 🟡 | Defer insert in `useConversationFlow` | Delete the 2 capture rows (§3.3) |

**Why M1 didn't catch 1b/1c:** M1 and M-Office proved **tenant** isolation (Agency A vs Agency B,
Office X vs Office Y). They never tested **role** isolation *inside* one agency (caregiver vs
staff). Every 1b policy is "same agency ⇒ allowed", which M1 correctly marked ✅ for its
question (`m1-security-gate-plan.md:47-60`). This plan closes the other axis.

---

## 1. Issue 1 — caregiver (and client) access to staff pages and data

### 1.1 Route audit (every route in `src/App.tsx`)

There is **no route-level guard**; `App.tsx:55-101` mounts pages directly and `AppLayout` does
no session/role check. Each page guards itself, inconsistently. `get_user_role(uid)` returns the
single highest role (`system_admin > agency_admin > manager > scheduler > hr_staff > caregiver`;
**`client` is missing from its `ORDER BY CASE`**, so it sorts last — harmless today, noted).

| Route | Page | Session check | Role check | Caregiver today | Client today | Audience → proposed guard |
|---|---|---|---|---|---|---|
| `/dashboard` | Dashboard | ✓ | **none** | staff dashboard (screen 77) | same | staff → **STAFF** |
| `/schedule` (+ `/live-operations`, `/quick-assign`, `/auto-schedule` redirects) | Schedule | ✓ | **none** | Schedule incl. Assign (screen 78) | same | staff → **STAFF** |
| `/caregivers` | Caregivers | ✓ | **none** (role only toggles some buttons) | full roster, Edit/Delete (screen 79) | same | staff → **STAFF** |
| `/clients` | Clients | ✓ | STAFF at 121-125, **but a NULL role passes** (`if (roleData)`) | redirected `/` | redirected `/` | staff → **STAFF** |
| `/client-inquiries` | ClientInquiries | **none** | none | care requests list + actions | same; **logged-out renders too** | staff → **STAFF** |
| `/time-off` | TimeOffRequests | ✓ | none (approve buttons gated) | agency list + create | same | staff → **STAFF** |
| `/shift-trades` | ShiftTrades | ✓ | manager/agency_admin/system_admin/scheduler | → `/available-shifts` | → `/available-shifts` | keep in-page list; wrap **STAFF** |
| `/flow-builder` | FlowBuilder | **none** | none | flow editor | same | staff → **STAFF** |
| `/caregiver-approvals` | CaregiverApprovals | ✓ | none (buttons gated) | registrations list (RLS-limited) | same | staff → **STAFF** |
| `/notifications-outbox` | NotificationsOutbox | **none** | none | outbox (RLS returns nothing to non-staff) | same | staff → **STAFF** |
| `/care-types`, `/care-service-categories` | CareTypes | **none** | none | catalog + edit buttons | same | staff → **STAFF** |
| `/order-management` | OrderManagement | ✓ | none | Care Plan list | same (client role has an `orders` grant) | staff → **STAFF** (Q4) |
| `/knowledge-base` | KnowledgeBase | ✓ | none (edit gated) | doc list (RLS-limited) | same | staff → **STAFF** |
| `/reports` | Reports | toast only | none | reports | same | staff → **STAFF** |
| `/admin-user-management` | AdminUserManagement | **none on mount** | none | user-creation form | same | admin → **ADMIN** |
| `/users`, `/users/add`, `/users/edit/:id` | Users/AddUser/EditUser | ✓ | admin → else `/dashboard` | bounced to staff Dashboard | same | **ADMIN** |
| `/user-roles` | UserRoles | ✓ | admin → else `/` | `/` | `/` | **ADMIN** |
| `/agency-settings` | AgencySettings | ✓ | admin → else `/dashboard` | bounced to Dashboard | same | **ADMIN** |
| `/virtual-offices`, `/virtual-offices/:id` | VirtualOffices/Config | ✓ | admin+manager → else `/dashboard` | bounced to Dashboard | same | **STAFF** wrap, keep in-page list |
| `/system-admin(-dashboard)`, `/system-roles`, `/role-permissions`, `/admin-utilities` | … | ✓ | system_admin (AdminUtilities renders before the check resolves) | bounced / `/` | same | **SYSTEM_ADMIN** |
| `/caregiver-dashboard`, `/caregiver-schedule` | CaregiverToday/Schedule | ✓ | none; needs a `caregivers` row | own data | empty shell + toast | caregiver → session only (see 1.2 note) |
| `/available-shifts`, `/caregiver-time-off`, `/caregiver-settings` | dual-shell pages | ✓ (AvailableShifts: toast only) | none; needs a `caregivers` row | own data | empty AppLayout | session only |
| `/client-dashboard` | ClientDashboard | ✓ | none; needs a `clients` row | empty + toast | own data | session only |
| `/`, `/auth`, `/a/*`, `/caregiver-registration`, `/assistant`, `/.lovable/oauth/consent`, `*` | public | — | — | — | — | unguarded (consent keeps its own `next` redirect) |

Sidebar note: caregivers are seeded `schedule` read (shows "Schedule" → staff page); clients are
seeded `schedule` and `orders` read and have **no** `client_dashboard` menu entry
(`20251122234531:209-214`, `20260726192642:63-66`). See §1.5 optional M-SEC-4.

### 1.2 Frontend guard (reuses `get_user_role` + the Clients.tsx pattern; no second mechanism)

- New `src/components/auth/RequireRole.tsx` wrapping routes in `App.tsx`:
  `getSession()` → none ⇒ `/auth?next=<path>` (Auth already honors `next`);
  `rpc('get_user_role', {_user_id})` → **NULL is denied** (fixes the Clients.tsx hole) ⇒ `/auth`
  with the existing "pending approval" message; role ∉ allow ⇒ the role's home + toast.
  Renders a spinner until resolved (no content flash — the AdminUtilities problem).
- The role → home mapping moves out of `Auth.tsx:29-41` (`routeByRole`) into
  `src/lib/roleHome.ts` and is used by both — caregiver → `/caregiver-dashboard`, client →
  `/client-dashboard`, system_admin → `/system-admin-dashboard`, staff → `/dashboard`. One
  mapping, two callers.
- Allowlists: `STAFF = system_admin, agency_admin, manager, scheduler, hr_staff`;
  `ADMIN = system_admin, agency_admin`; `SYSTEM_ADMIN = system_admin`. Existing in-page checks
  stay as a second layer (narrower lists on `/shift-trades`, `/virtual-offices` remain the
  pages' own).
- **Caregiver / client routes stay session-only** (not role-guarded): `get_user_role` collapses a
  staff+caregiver user to the staff role, so a `['caregiver']` guard would lock such a user out of
  their own caregiver app; these pages already show only the caller's own rows. Their data
  exposure is closed by RLS (§1.3), not by the route.
- This is defense-in-depth/UX. **The real fix is §1.3** — a caregiver with the anon key and their
  JWT can call PostgREST directly regardless of any route.

### 1.3 Database: what a caregiver can read/write today [derived from migrations; to confirm live]

`current_agency_id()` = the caller's `profiles.agency_id` — **set for caregivers and clients
too** (enable-caregiver-login / enable-client-login / approve-caregiver-registration upsert
`profiles.agency_id`). So any policy of the form "row.agency_id = my profile's agency" without
`is_agency_staff()` admits caregivers and clients.

| Table | Policy that admits a caregiver | Caregiver can | Client can | Needed by caregiver app? |
|---|---|---|---|---|
| `caregivers` | "Agency users can manage their caregivers" — `FOR ALL`, agency (+office if restricted), **no role check** | **SELECT/INSERT/UPDATE/DELETE every caregiver in the agency** (email, phone, address, hourly_rate, reliability…) | read all via "Clients view caregivers (agency scope)" + same FOR ALL policy ⇒ **write too** | own row only (`user_id = auth.uid()`, policy already exists) |
| `caregiver_performance` (view, `security_invoker`) | inherits `caregivers` | read all caregivers' stats | read all | own row (Today rating line) |
| `caregiver_skills` | "Agency users can manage caregiver skills" — `FOR ALL`, agency join | **read/write any caregiver's skills** (changes eligibility outcomes) | same | own (policy exists) |
| `caregiver_availability` | "Agency users can manage caregiver availability" — `FOR ALL` | **read/write any caregiver's availability** | same + client read policy | own (policy exists) |
| `client_care_needs` | "Agency users can manage client care needs" — `FOR ALL` | **read/write every client's care needs** (care-type codes + priority; health-adjacent) | same | no |
| `families` | `families_select_agency_or_own` agency branch has no `is_agency_staff` | read all families | read all families | no |
| `care_requests` | `care_requests_select` agency branch has no `is_agency_staff` | **read all family inquiries** (contact details, needs, notes) | read all | no |
| `shift_ratings` | "Agency staff can view ratings…" — agency only | read every rating/comment for every caregiver | read all | own ratings (via `caregiver_performance`) |
| `shift_trades` | view/update/insert gated on "original caregiver is in my agency" | **read and UPDATE any trade in the agency** (status/approval fields) | same | own requests (`fetchMyTradeRequests`, filtered client-side) |
| `profiles` | own row SELECT; agency_admin agency read | own only ✅ | own only ✅ | own |
| `clients` | staff role list | none ✅ (uses `get_caregiver_visible_clients()`) | own ✅ | via RPC |
| `shifts` | assigned-to-me; open/unassigned in my office (Phase 1B) | own + open in own office ✅ | own ✅ | yes |
| `shift_assignments` | `my_caregiver_ids()` | own ✅ | — | yes |
| `time_entries`, `earnings_lines`, `time_off_requests`, `caregiver_certifications`, `caregiver_preferences`, `caregiver_availability_exceptions` | own via `my_caregiver_ids()`; staff via `is_agency_staff` | own ✅ | — | yes |
| `virtual_office`, `agency` | same agency SELECT | read office/agency config (non-sensitive) | same | branding/offices — leave |

**Self-update with no column guard (1c):**
- `caregivers` "Caregivers can update their own profile" — `FOR UPDATE USING (user_id = auth.uid())`,
  no WITH CHECK, and the only BEFORE UPDATE triggers are `updated_at` and
  `freeze_caregiver_performance_rating`. A caregiver can set their own `hourly_rate`, `status`,
  `employment_type`, `virtual_office_id` (defeats eligibility Rule B), `agency_id`, `user_id`.
- `profiles` "Users can update their own profile" — same shape, no trigger protecting
  `agency_id` / `virtual_office_id` / `office_restricted`. **If confirmed live, any signed-in user
  can set their own `profiles.agency_id` to another agency's UUID, and `current_agency_id()` then
  returns that agency for every policy and RPC that relies on it — a cross-tenant escape that
  undoes M1.** (Agency UUIDs are not secret: they appear in public-office payloads.) This is the
  highest-priority item to confirm in E1.

**Known-issues "caregiver-shifts RLS gap" folded in:** the entry "Caregivers cannot see
open/unassigned shifts" (`known-issues.md:369`, and the CLAUDE.md Phase-0 line "caregiver-shifts
RLS gap … deferred") was **closed by Phase 1B** — the live set is "Caregivers read their own
assigned shifts" + "Caregivers view open shifts in their office" (`20260915215024`), product
decision taken = *all open shifts in the caregiver's own office*. This plan **keeps** that set
unchanged and records the entry as RESOLVED. One residual noted for a decision (Q5): the open-shift
policy returns the **whole** `shifts` row to any caregiver in the office, including
`special_instructions` / `special_notes` (free text that can carry care details) and `pay_rate`.

### 1.4 Proposed migrations (drafts — shown for review, not pushed)

Principle: **minimal change** — add the missing `is_agency_staff(auth.uid())` to the existing
predicate, keep every self-policy, keep tenant/office clauses exactly as they are; no new grants
to anyone; no RPC signature changes (rule 13 not triggered); every new `SECURITY DEFINER`
function REVOKE-before-GRANT and verified (rule 14).

**M-SEC-1 `2026100xxxxxx_role_scope_staff_policies.sql`** (one transaction)

```sql
-- caregivers: staff-only management; self + client read policies unchanged
DROP POLICY IF EXISTS "Agency users can manage their caregivers" ON public.caregivers;
CREATE POLICY "Agency staff manage caregivers in scope" ON public.caregivers
FOR ALL TO authenticated
USING (
  is_agency_staff(auth.uid())
  AND agency_id IN (SELECT p.agency_id FROM public.profiles p WHERE p.id = auth.uid())
  AND (NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id())
)
WITH CHECK ( /* identical */ );

-- caregiver_skills / caregiver_availability / client_care_needs: same edit — prepend
-- is_agency_staff(auth.uid()) AND to the existing USING, add an identical WITH CHECK.
-- Self policies ("Caregivers can manage their own …", "Clients can manage their own care needs") unchanged.

-- families: agency branch gets the staff check; system_admin + own-family branches unchanged
-- care_requests: agency branch gets the staff check; client/family own branches unchanged

-- shift_ratings: staff read + caregiver reads ratings about themselves (keeps the Today rating)
DROP POLICY IF EXISTS "Agency staff can view ratings in their agency" ON public.shift_ratings;
CREATE POLICY "Agency staff view ratings in their agency" ON public.shift_ratings
FOR SELECT TO authenticated
USING (is_agency_staff(auth.uid()) AND agency_id = current_agency_id());
CREATE POLICY "Caregivers view their own ratings" ON public.shift_ratings
FOR SELECT TO authenticated
USING (caregiver_id IN (SELECT public.my_caregiver_ids()));

-- shift_trades: staff manage (agency-wide, as today — office scoping stays deferred per
-- known-issues §38); caregivers read only trades they are party to; caregivers INSERT only
-- their own outgoing trade (future give-up flow); caregivers never UPDATE (pickups go through
-- the SECURITY DEFINER caregiver_pickup_trade_shift()).
--   "Agency staff can view/manage shift trades"   -> + is_agency_staff(auth.uid())
--   NEW "Caregivers read their own trades"         -> original_caregiver_id OR new_caregiver_id IN my_caregiver_ids()
--   "Agency staff and caregivers can create …"     -> staff-in-agency OR original_caregiver_id IN my_caregiver_ids()
```

`caregiver_performance` needs no change: as a `security_invoker` view it follows `caregivers`.

**M-SEC-2 `2026100xxxxxx_protect_self_update_columns.sql`**

```sql
-- One trigger function per table. Non-staff callers updating their OWN row may change only
-- personal fields; scope/compensation columns are frozen. Service-role/Edge-Function writes
-- (auth.uid() IS NULL) and staff in scope are unaffected.
CREATE FUNCTION public.protect_profile_scope_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT has_role(auth.uid(),'system_admin')
     AND NOT (has_role(auth.uid(),'agency_admin') AND OLD.agency_id = current_agency_id())
     AND (NEW.agency_id IS DISTINCT FROM OLD.agency_id
          OR NEW.virtual_office_id IS DISTINCT FROM OLD.virtual_office_id
          OR NEW.office_restricted IS DISTINCT FROM OLD.office_restricted) THEN
    RAISE EXCEPTION 'Not allowed to change agency/office scope';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_profile_scope_columns() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_protect_profile_scope BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_scope_columns();

-- caregivers: for a non-staff caller, freeze agency_id, virtual_office_id, user_id,
-- hourly_rate, employment_type, status, reliability_score (+ any other column in the live
-- column list that is not on the personal allowlist used by CaregiverProfileSettings:
-- names, email, phone, address fields, service_zipcodes, bio/photo — exact list fixed after
-- E1 reads the live column set).
```

**M-SEC-3 `2026100xxxxxx_get_my_trade_requests.sql`** — needed because M-SEC-1 narrows
`caregivers` to the own row, so `fetchMyTradeRequests`' embed
`new_caregiver:new_caregiver_id(first_name,last_name)` would silently resolve to `null`
(the exact "Unknown client" failure mode recorded in known-issues §157). Replace the embed with a
`SECURITY DEFINER` RPC `get_my_trade_requests()` returning the caller's trades plus the other
party's **first name + last initial only**. `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ...
TO authenticated;` then verify with `aclexplode(proacl)`. `src/lib/caregiverBoard.ts` switches to it.

**M-SEC-4 (optional, Q4) — menu seeds:** set `can_read=false` for caregiver `schedule` and
client `schedule`/`orders` in `role_permissions`, and re-seed a `client_dashboard` module for
the client role, so caregiver/client sidebars stop linking to staff pages.

**Not in this change (needs a product decision, Q3):** clients' read of all agency caregivers
(`CareTeam.tsx:53`, `CareCircle.tsx:78`, and `OrdersManagement.tsx:195`, which selects
`hourly_rate` for a "request a caregiver" picker). Narrowing it to caregivers on the client's own
shifts via an RPC would change the client portal's request flow.

### 1.5 Breakage check (every authenticated-client write/read to the tightened tables)

| Path | Role | After M-SEC-1/2 |
|---|---|---|
| `Caregivers.tsx` 239/289/388/437 (caregivers), 256/265/312 (skills) | staff | ✓ unchanged (staff pass `is_agency_staff`) |
| `Clients.tsx` 329/340/381 (client_care_needs) | staff | ✓ |
| `AvailabilityDialog.tsx` 115/225/245 | staff **and** caregiver (own) | ✓ staff policy + own policy |
| `CaregiverProfileSettings.tsx` 110 (caregivers), 169/197 (skills), 133 (profiles) | caregiver own | ✓ own policies; M-SEC-2 rejects only frozen columns — verify the form never sends them (E1 grep of its update payload) |
| `ProfileSettings.tsx` (client) 137/154 client_care_needs, clients | client own | ✓ own policies |
| `FamilyDialog.tsx` 88, `ClientInquiries.tsx` 183/197 | staff | ✓ |
| `ShiftTrades.tsx` 183/207/248, `TimeOffDecisionDialog.tsx` 94 | staff | ✓ |
| `fetchMyTradeRequests` (caregiver) | caregiver | ✓ via M-SEC-3 |
| `CaregiverToday` rating (`caregiver_performance`) | caregiver | ✓ own row + "view their own ratings" |
| Edge Functions (approve-caregiver-registration, enable-*-login, link-existing-accounts) | service_role | ✓ bypass RLS; M-SEC-2 skips `auth.uid() IS NULL` |
| `Caregivers.tsx:223`, `Clients.tsx:303` — staff updating *another user's* `profiles` row | staff | **already fails today** (no staff UPDATE policy on `profiles`) — pre-existing, logged, not changed here |
| `useMenuBadgeCounts` (care_requests, shift_trades counts) | staff | ✓ |
| Client portal reads of `caregivers` | client | ✓ unchanged (client policy kept, Q3) |

---

## 2. Issue 2 — passwords in the notification outbox

### 2.1 Every path that stores, returns or shows a password

| Path | Generates | Stored in DB | Returned to browser | Shown in UI |
|---|---|---|---|---|
| `enable-client-login/index.ts:66` | `Care-` + 10 hex | `pending_notifications.body` ("Temporary password: …") **and** `payload.temp_password` (102-110) | `tempPassword` (112) | `Clients.tsx:1223-1253` dialog + copy button |
| `enable-caregiver-login/index.ts:72` | same | same (111-119) | (121) | `Caregivers.tsx:1127-1157` |
| `approve-caregiver-registration/index.ts:127` | same (registration never collects a password) | same (254-262) | (264) | `CaregiverApprovals.tsx:543-577` |
| `NotificationsOutbox.tsx:36,117` | — | — | — | renders `body` in full to any staff role (incl. scheduler, hr_staff); "Mark delivered" keeps the row; no delete policy ⇒ kept forever |
| `create-user/index.ts:76-94` | admin-chosen | not stored | no | no (admin knows it) |
| `admin-reset-password/index.ts:68-92` | admin-chosen | not stored | no | no (admin knows it) — **no tenant check on `userId`** (2b) |
| Password change in `CaregiverProfileSettings.tsx:211-238` / client `ProfileSettings.tsx:199-226` | user | Supabase Auth only | — | "Current password" collected but never verified; 6-char min vs `validation.ts` 8–72 |

No email/SMS is sent anywhere — the outbox is manual copy-paste (`NotificationsOutbox.tsx:69-72`).
No `[auth]` section in `supabase/config.toml`; no reset/recovery route exists in the app.

### 2.2 Replacement design — no password ever generated, stored or displayed by the app

1. **New `/auth/set-password` route** (public): handles the Supabase Auth `PASSWORD_RECOVERY`
   / invite session from the link, asks for a new password (8–72, `validation.ts`), calls
   `supabase.auth.updateUser({ password })`, then routes by role (`roleHome.ts`). Auth page gets
   a "Forgot password?" link calling `resetPasswordForEmail(email, { redirectTo })`.
2. **enable-client-login / enable-caregiver-login / approve-caregiver-registration:**
   - new account: `auth.admin.inviteUserByEmail(email, { redirectTo: <site>/auth/set-password, data })`
     (Supabase emails a one-time link) — or, in fallback mode, `auth.admin.generateLink({type:'invite'})`.
   - existing account: nothing to set (they keep their own password) — or send a recovery link on request.
   - `pending_notifications` row keeps an audit line only: *"Account created; set-password link
     sent to <email> on <date>"* — **no password, no link, no `temp_password` key.**
   - HTTP response drops `tempPassword`; the three dialogs change to "An email with a link to set
     a password was sent to …" (fallback mode: "Copy one-time link" shown once, never stored).
3. **admin-reset-password:** replace "admin types a new password" with "send reset link"
   (`generateLink({type:'recovery'})` / `resetPasswordForEmail`), and **add the missing tenant
   check**: the target's `profiles.agency_id` must equal the caller's (system_admin excepted),
   the same guard enable-*-login already have. `create-user` likewise moves to invite-by-email;
   the dead "Require password change on first login" checkbox in `AddUser.tsx` is removed.
4. **Email delivery is the dependency (Q1).** Supabase's built-in mailer only delivers to the
   project's own team addresses and is heavily rate-limited; real invites need **custom SMTP**
   configured in the Supabase dashboard (e.g. Resend/SendGrid/Postmark) plus Site URL /
   redirect URLs. That is a dashboard configuration the owner does — this plan does not touch it.
   - **Mode A (recommended, needs SMTP):** Supabase sends invite/recovery emails. Nothing secret
     ever passes through the app.
   - **Mode B (interim, no SMTP):** `generateLink` returns a one-time, expiring link that is shown
     **once** to the admin in the dialog to deliver by hand, and never written to any table or log.
     Strictly better than today (single-use, expiring, not stored), but the admin still handles a
     credential — move to Mode A when SMTP exists.
5. `NotificationsOutbox.tsx`: add `caregiver_login_created` to `kindLabels`; nothing else needed
   once bodies carry no secrets.

### 2.3 Rule 13/14 relevance
No SQL functions change for issue 2 (Edge Functions only). If a helper RPC is added for the
tenant check, it follows rule 14.

### 2.4 Exposure that redaction alone does not fix
- **Every temp password ever issued is still a valid credential** unless the user changed it.
  After Mode A/B ships, the affected accounts (recipients of the redacted rows) should get a forced
  reset: set a random unknown password via the Admin API and send a set-password link. List shown
  for approval with §2.5.
- The temp passwords also traveled through HTTP responses and admins' clipboards — not
  recoverable, covered by the forced reset.
- `supabase/migrations/20251110220912_*.sql:20-33` seeds the owner's own `auth.users` row with a
  literal, weak password hash committed in git. If that account still uses it, change it (owner
  action; not something this plan does).

### 2.5 Redaction of rows already stored (DATA WRITE — needs approval with the count)

Count first (read-only; run in E1 as system_admin or with the DB connection):

```sql
SELECT kind, (sent_at IS NOT NULL) AS delivered, agency_id, count(*)
FROM public.pending_notifications
WHERE payload ? 'temp_password' OR body ~* 'temporary password'
GROUP BY 1,2,3 ORDER BY 1,2;
-- plus the recipient list for the forced reset:
SELECT id, kind, recipient_email, created_at FROM public.pending_notifications
WHERE payload ? 'temp_password' OR body ~* 'temporary password' ORDER BY created_at;
```

**Row count: not yet known** — the probe login failed (see header). It will be reported in E1 and
the write waits for approval. Proposed write (one transaction, applied as a reviewed migration so
it is recorded in history):

```sql
UPDATE public.pending_notifications
SET body    = regexp_replace(body, '(temporary password)\s*:?\s*\S+', '\1: [redacted 2026-10]', 'gi'),
    payload = payload - 'temp_password'
WHERE payload ? 'temp_password' OR body ~* 'temporary password';
-- verify: the count query above returns 0 rows
```

---

## 3. Issue 3 — Supabase projects and write-on-load

### 3.1 Projects found (no configuration changed)

| Project ref | Where | Described as | Used by the app now? |
|---|---|---|---|
| `rgeldgztadebgvrdhaqa` | `.env.local` (`VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_URL`); `supabase/config.toml:1`; `supabase/.temp/project-ref` + `linked-project.json` (name "caremuch") | commit `6929a20` (2026-08-27): "the new caremuch dev project"; `m1-security-gate-plan.md:6`: "the production database"; `CLAUDE.md:227` "dev project"; Ripple schema plan "dev project only" | **Yes — the only live project** (frontend, CLI link, Edge Functions) |
| `jipsobxiblzgivjmtwtq` | `.env.local:1` comment "old/unused"; **`supabase/functions/mcp/index.ts:165`** (OAuth issuer); `known-issues.md:585,596`; old `.env` (URL + anon key) in git history before `a297165` | old Lovable Cloud project, disconnected | No — except the stale issuer in the `mcp` function (open in known-issues) |

`.env.example`, `Dockerfile` (build ARGs only), `fly.toml`, `src/integrations/supabase/client.ts`
(reads env) and `package.json` contain no other ref. **No doc or config describes a separate
dev/staging project.**

**Which holds Kind Care and Ripple data:** `rgeldgztadebgvrdhaqa` — agency `56fbfe38` with offices
Primary Office, Kind Care Services and Ripple Effects (m-office plan, M1 §7).

**Corrected (owner, Oct 1 — `docs/Ripple_UI_Plan_Decisions_2026-10-01.md`):** `rgeldgztadebgvrdhaqa`
is the **DEV project**. **No production project exists yet**, and no real clients have been entered.
The "production database" wording in `m1-security-gate-plan.md` (and the SEED doc / Ripple UI
plan R13) has been corrected. No other project is to be created. The rows that *looked* real in
`/client-inquiries` and `/caregiver-approvals` are listed in §6.4 for the owner to judge; they are
not changed. Whether `jipsobxiblzgivjmtwtq` (the old Lovable Cloud project) still exists cannot be
known from the repo; its anon key is in git history.

Consequence for this plan: migrations and tests run on the dev project with **disposable fixtures
and verified teardown** (the M1 pattern), never touching existing accounts' data.

### 3.2 Write-on-load fix

Today `useConversationFlow.ts:101-124` inserts `conversation_sessions` on mount unless
`deferSession` is set; `ChatWidget` (`/caregiver-registration`) and `ConversationSurface`
(`/a/:slug/apply`, and the caregiver path on `/` and `/assistant`) don't set it.
`FamilyIntakeSurface` passes `deferSession: true` and creates the row in `ensureSession`
on the first answer (`:137-157`, called from `answer()` :176 and `submitIntake()` :281).

Change, all inside `src/hooks/useConversationFlow.ts` so every caller benefits:
1. Make deferral the default (the mount branch only initializes state; no insert).
2. **Single-flight `ensureSession`:** keep the in-flight promise in a ref
   (`pendingRef.current ??= insert()`), cleared on error — today a fast double-tap or
   multi-select Continue can call it twice before `sessionRef` is set and create two rows with
   answers split between them.
3. Include `current_node_id` in the deferred insert (parity with the old mount insert).
4. `back`, `rewindTo`, `complete`, `linkRegistration` read `sessionRef.current` instead of the
   `sessionId` state, so a one-question flow or a stale closure can't skip `flow_session_complete`
   / `flow_session_link_registration`; the hook also returns `sessionRef.current?.id` for
   `ChatWidget`'s `onComplete`.
5. `FamilyIntakeSurface`'s explicit `deferSession: true` becomes redundant (kept harmlessly).

No resume path depends on an early session id (no localStorage resume exists); visitors who
leave without answering produce no row, which is the intent.

### 3.3 The 2 empty anonymous rows from 2026-10-01 (DATA WRITE — needs approval)

Not yet listed: `/caregiver-registration` sessions have `agency_id = NULL`, which only
`system_admin` (or the DB connection) can read, and the probe login failed. E1 runs:

```sql
SELECT s.id, f.audience, s.agency_id, s.created_at, s.status
FROM public.conversation_sessions s JOIN public.conversation_flows f ON f.id = s.flow_id
WHERE s.user_id IS NULL AND s.status = 'in_progress'
  AND s.completed_at IS NULL AND s.submitted_at IS NULL AND s.registration_id IS NULL
  AND s.contact_name IS NULL AND s.client_name IS NULL
  AND s.created_at >= '2026-10-01 12:00-04' AND s.created_at < '2026-10-02 06:00-04'
  AND NOT EXISTS (SELECT 1 FROM public.conversation_answers a WHERE a.session_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM public.care_requests c WHERE c.session_id = s.id);
```

The rows found (expected 2, from screen 04 desktop + mobile) are shown to you **by id**; only on
approval: `DELETE FROM public.conversation_sessions WHERE id IN (<the approved ids>)` with the same
NOT-EXISTS guards repeated in the statement, then re-query to confirm 0.

---

## 4. Execution order (after approval) and done-tests

| Step | What | Gate |
|---|---|---|
| **E1 — live pre-flight (read-only)** | Needs **working test logins** (update the `SCREENSHOT_*` passwords) **or** the DB password ad hoc (memory: direct `pg`, never stored). Snapshot `pg_policies` + triggers for every table in §1.3 to confirm the static replay; **confirm or refute the `profiles.agency_id` self-update escape** (catalog check, no write); read the `caregivers` column list; run the §2.5 count + recipient list and the §3.3 row list. | Report back; nothing written |
| E2 | M-SEC-1, M-SEC-2, M-SEC-3 shown as files for review → push one at a time → verify `pg_policies` and `aclexplode(proacl)` (no `PUBLIC`/`anon` EXECUTE on the new functions) | your approval per migration |
| E3 | Frontend: `RequireRole` + `roleHome.ts` + `App.tsx` wrapping; `caregiverBoard.ts` → `get_my_trade_requests()` | code review |
| E4 | Issue 2 code (Edge Functions, `/auth/set-password`, dialogs, Auth "Forgot password?") in Mode A or B per Q1; deploy functions | Q1 answered |
| E5 | §2.5 redaction (+ forced-reset list) | **your approval with the count** |
| E6 | Write-on-load change | code review |
| E7 | §3.3 deletion | **your approval with the ids** |
| E8 | Tests below | — |
| E9 | `docs/known-issues.md` (close §369/caregiver-shifts entry, add + close the role-isolation, self-update, outbox-password, reset-tenant and write-on-load entries; leave Q3/Q5 items open); CLAUDE.md's Phase-0 "caregiver-shifts RLS gap … deferred" line updated only if you want CLAUDE.md touched | — |

**Done-tests (real JWTs through PostgREST, M1-style disposable fixtures, teardown verified by re-query):**
fixtures = in agency `56fbfe38`: two disposable caregivers CG-A, CG-B (with logins), one
disposable client CL-A (login), one disposable manager; plus one disposable second agency with
one admin for the cross-tenant check. Run **before** E2 (expect the 🔴 rows to *fail*, proving
the test detects the gap) and **after** (expect all pass).

1. CG-A: `caregivers` returns exactly 1 row (own); `caregiver_performance` 1 row; `profiles` 1;
   `caregiver_skills`/`caregiver_availability`/`client_care_needs`/`families`/`care_requests`
   return none of other people's rows; `shift_ratings` only rows about CG-A; `shift_trades` only
   trades CG-A is party to.
2. CG-A write attempts on CG-B: UPDATE `caregivers` (hourly_rate), INSERT/DELETE
   `caregiver_skills`, UPDATE `caregiver_availability`, UPDATE a `shift_trades` row → 0 rows
   affected / RLS error.
3. CG-A self-update: own phone/address succeed; own `hourly_rate`, `status`, `virtual_office_id`,
   `agency_id` rejected; own `profiles.agency_id` → other agency rejected.
4. CG-A app still works: Today (own shifts, hours, rating), Schedule, Available Shifts (open +
   trade shifts, pick-up via RPC), My trade requests with the other party's name, Settings save,
   Availability save, Time Off.
5. Manager: Caregivers, Clients, Schedule, Trade Board, Client Inquiries, Approvals unchanged
   (counts equal the pre-change snapshot).
6. Routes (browser, CG-A and CL-A sessions): each STAFF/ADMIN/SYSTEM_ADMIN route → redirected to
   `/caregiver-dashboard` / `/client-dashboard`; logged-out → `/auth?next=…`; null-role user →
   pending message.
7. Issue 2: enable a login for a disposable caregiver and approve a disposable registration →
   `pending_notifications` row has no password and no `temp_password` key; HTTP response has no
   `tempPassword`; the outbox shows none; the link sets a password and signs in;
   `admin-reset-password` from the second agency's admin against CG-A → 403.
   After E5: the count query returns 0.
8. Issue 3: load `/caregiver-registration` and `/a/ripple-effects/apply` (and the caregiver path on
   `/`) without answering → `conversation_sessions` count unchanged; answer one question → exactly
   one row; double-tap the first answer → still one row.
9. Teardown: fixtures deleted, re-query shows 0 rows for every fixture id.

---

## 5. Questions for you

| # | Question |
|---|---|
| Q1 | Email for invites/resets: will you configure custom SMTP in the Supabase dashboard (Mode A), or ship Mode B (one-time link shown once to the admin) first? |
| Q2 | Should a separate dev/staging Supabase project be created so tests and migrations stop running against the database with Kind Care / Ripple data? (Out of scope to do here; affects how E8 runs.) |
| Q3 | Clients can currently read every agency caregiver incl. hourly_rate (client "request a caregiver" picker). Narrow it now (changes the client portal flow) or log it as a follow-up? |
| Q4 | Apply M-SEC-4 (remove staff Schedule/Care Plan links from caregiver/client sidebars, add a Client Dashboard menu entry)? It also makes `/order-management` staff-only — confirm clients are not meant to create orders there (they have the Client Dashboard "Care Plans" tab). |
| Q5 | Open-shift visibility returns the whole `shifts` row (incl. `special_notes`, `special_instructions`, `pay_rate`) to every caregiver in the office. Narrow via a view/RPC now or log for later? |
| Q6 | E1 needs either corrected `SCREENSHOT_*` passwords in `.env.local` or the DB password pasted ad hoc (not stored; please rotate it afterwards, as last time). Which? |

---

## 6. E1 results — live, read-only (2026-10-02)

Method: direct `pg` connection to the dev project with the password from `SUPABASE_DB_PASSWORD`
(never printed or written). The session was forced `default_transaction_read_only = on` and
verified before any query. Only SELECTs were issued. Visibility was simulated per user with
`BEGIN READ ONLY; SET LOCAL ROLE authenticated; set_config('request.jwt.claims', {sub})`, then
ROLLBACK. That runs the real RLS policies as that user. The JWT-through-PostgREST done-tests still
run in E8 with disposable logins.

### 6.1 A1 — `user_roles` / `system_roles` / `role_permissions`, and `profiles` (reported first)

| Table | Live policies (writes) | Self/other escalation by a non-admin? |
|---|---|---|
| `user_roles` | "System admins manage all roles" (ALL); "Agency admins manage roles in their own agency" (ALL, `agency_admin AND row.agency_id = current_agency_id() AND target's profile agency = row.agency_id`); "Users can view their own roles" (SELECT) | **caregiver / client / manager / scheduler / hr_staff: NO.** They have no INSERT/UPDATE/DELETE path. 🔴 **agency_admin: YES.** The CHECK never restricts `role`, so an agency_admin can INSERT `role = 'system_admin'` for themselves or any user in their agency. That gives platform-wide, cross-tenant power. No trigger on `user_roles`. |
| `system_roles` | "System admins can manage system roles" (ALL, CHECK null, so it uses USING) | No (system_admin only) |
| `role_permissions` | "System admins can manage permissions" (ALL) | No (system_admin only) |
| `profiles` | "Users can update their own profile": `FOR UPDATE TO public USING (auth.uid() = id)`, **no WITH CHECK**. Its only trigger is `update_profiles_updated_at`. `authenticated` holds UPDATE. | 🔴 **CONFIRMED.** Any signed-in user can change their own `agency_id`, `virtual_office_id` and `office_restricted`. Live columns: `id, email, full_name, phone, agency_id, business_license, subscription_tier, default_ft_min_hours, default_pt_min_hours, overtime_threshold, created_at, updated_at, virtual_office_id, office_restricted`. |

**Why the `profiles` hole is the most severe finding:**
- `current_agency_id()` = `profiles.agency_id`, and `is_agency_staff()` is role-only (`user_roles` has no agency column).
- So **any staff user** (scheduler, hr_staff, manager…) who sets their own `profiles.agency_id` to another agency's UUID becomes staff of that agency for every policy and RPC. That undoes M1.
- An office-restricted manager can set `office_restricted = false` and see every office. That undoes M-Office.
- A caregiver doing the same gains the 1b access in the other agency.

Both holes are fixed in **M-SEC-2** (§7). Until then they are the highest-priority open items.

### 6.2 Live policies for the §1.3 tables
The live `pg_policies` match the static migration replay in §1.3 exactly: same policy names,
predicates and triggers. Three extra details:
- `caregiver_skills`, `caregiver_availability` and `client_care_needs` policies are `TO public` with
  no WITH CHECK, so their USING expression also governs INSERT.
- `caregiver_performance` is `security_invoker=true`.
- `caregivers` live columns include `hourly_rate, employment_type, is_active, role, reliability_score,
  performance_rating, hire_date, agency_id, virtual_office_id, user_id, emergency_contact_*`. The
  exact freeze-list for M-SEC-2 is taken from the full column list at drafting time.

### 6.3 Simulated SELECT visibility (counts; agency `56fbfe38` dev data)

| Table | All rows | Caregiver (screenshot account) | Client (first client login) | Expected after fix |
|---|---|---|---|---|
| caregivers | 6 | **6** (own 1) | **6** | caregiver 1; client 0 direct (M-SEC-5 RPC) |
| caregiver_performance | 6 | **6** | **6** | caregiver 1 |
| profiles | 8 | 1 | 1 | unchanged ✅ |
| clients | 5 | 0 (uses RPC) | 1 | unchanged ✅ |
| shifts | 48 | 34 (7 assigned + 27 open in office) | 26 (own) | unchanged ✅ |
| shift_assignments | 21 | 7 | 0 | unchanged ✅ |
| caregiver_skills | 21 (6 caregivers) | **21 (6)** | **21 (6)** | caregiver own only; client via M-SEC-5 RPC |
| caregiver_availability | 19 (5) | **19 (5)** | **19 (5)** | caregiver own only; client per M-SEC-5 |
| client_care_needs | 8 | 0 \* | 2 (own) | caregiver 0 |
| families | 4 | **4** | **4** | caregiver 0; client own family only |
| care_requests | 4 | **4** | **4** | caregiver 0; client own only |
| shift_ratings | 0 | 0 \* | 0 | caregiver own only |
| shift_trades | 3 | **3** | **3** | caregiver: trades they are party to; client 0 |
| user_roles | 8 | 1 | 1 | unchanged ✅ |
| pending_notifications | 6 | 0 | 0 | unchanged ✅ |

\* 0 only because of current data (no rows in that caregiver's join path, no ratings yet). The
policy still admits them, so the done-tests seed fixture rows to prove it.

### 6.4 Rows that looked real (listed only, not changed — owner to judge)

`/client-inquiries` (`care_requests`). Contact details live on the linked `conversation_sessions`:

| id | created_at (UTC) | source → page | is_demo | contact email (masked) | phone |
|---|---|---|---|---|---|
| e9ea99d4-b4d6-4166-8919-f842624b3a59 | 2026-09-09 02:54 | `assistant_intake` → `/assistant` family path | true | t\*\*\*@gmail.com | non-555 (269…) |
| 3a0f21fe-525c-4169-97d6-c54f686ec216 | 2026-09-09 02:59 | `public_site` → `/a/:slug/care` | true | d\*\*\*@nextsocial.com | non-555 (269…) |
| 0db5d8b8-e7cf-4d0d-a9ab-39a288c07518 | 2026-09-09 17:31 | `public_site` → `/a/:slug/care` | false | e\*\*\*@example.com | non-555 (269…) |
| a3541354-62da-4188-8d19-f71688662b80 | 2026-09-14 02:10 | `public_site` → `/a/:slug/care` | false | a\*\*\*@client.com | non-555 (877…) |

`/caregiver-approvals` (`caregiver_registrations`, all `pending`, office Ripple `12faa863…`):

| id | created_at (UTC) | page (via linked session) | email (masked) | phone |
|---|---|---|---|---|
| f0ee92f0-e17f-45ba-838c-c2f7cfa3bbff | 2026-09-03 00:58 | `/caregiver-registration` or `/assistant` | c\*\*\*@gmail.com | non-555 (269…) |
| 7b839ea9-ebc7-4ef6-b863-76d1581f23c3 | 2026-09-03 00:59 | `/caregiver-registration` or `/assistant` | g\*\*\*@test.com | non-555 (269…) |
| 5a18d35f-126d-4743-a5b9-fae566ab2f7f | 2026-09-09 02:57 | `/a/:slug/apply` | e\*\*\*@example.com | 555 |
| 0218be0d-5acc-4217-a348-a3bf13e66377 | 2026-09-09 03:01 | `/a/:slug/apply` | c\*\*\*@gmail.com | non-555 (877…) |
| 43217dd3-7e7e-4774-83f1-be2c576f2044 | 2026-09-09 17:35 | `/a/:slug/apply` | e\*\*\*@example.com | non-555 (269…) |

(269 is the Kalamazoo/Portage MI area code; 877 is toll-free.)

### 6.5 §2.5 password rows in `pending_notifications` (for E5 — count only, no write)

**4 rows**, all in agency `56fbfe38`. Each holds the password in both `body` and `payload.temp_password`.
Breakdown: 3 `caregiver_login_created` (2 undelivered, 1 delivered) and 1 `client_login_created`
(delivered).

| id | kind | recipient | created | ever signed in since? |
|---|---|---|---|---|
| bf56c29b-d234-4f29-936f-128778b7b1ef | caregiver_login_created | robert.miller@caremuch-demo.test | 2026-09-09 | yes |
| a56fae11-d722-45fc-b28c-fea26e178bbf | client_login_created | betty.baker.client@caremuch-demo.test | 2026-09-09 | yes |
| b77eb0e8-304e-4744-b367-158b8b935a02 | caregiver_login_created | maria.brown@caremuch-demo.test | 2026-09-09 | yes |
| a549bb3f-e02c-4985-981e-5aca2417c4d2 | caregiver_login_created | michael.gonzalez@caremuch-demo.test | 2026-09-13 | **never — temp password certainly still valid** |

Supabase `auth.users` has no password-changed timestamp, so whether the other three still use the
temp password cannot be known. All four go on the forced-reset list in E5.

### 6.6 §3.3 empty anonymous sessions (for E7 — listed only, no write)

| id | flow audience | agency_id | created_at (UTC) | answers |
|---|---|---|---|---|
| 36757fa8-44e5-4dd0-aae8-760bf6907688 | caregiver_screening | NULL | 2026-10-01 21:17:48 | 0 |
| ea0877fd-b879-4d13-a6d5-460cc6cd6332 | caregiver_screening | NULL | 2026-10-01 21:17:53 | 0 |

Exactly 2, 4.6 s apart (screen 04 desktop, then mobile). No care request and no registration
references them.

---

## 7. Approved changes to the plan (owner, Oct 1–2)

- **Environment:** see the corrected §3.1. No new project.
- **Q1 → Mode B now** (one-time link shown once, never stored). known-issues gets a "configure
  custom SMTP, switch to Mode A — required before production" entry.
- **Q3 → M-SEC-5** at the end of the batch. Clients read caregivers only through a `SECURITY DEFINER`
  RPC returning first name, last initial and skills/care types. No email, phone, address or rate.
  - `CareTeam.tsx`, `CareCircle.tsx` and the `OrdersManagement.tsx` picker switch to it.
  - The client policies "Clients view caregivers (agency scope)" and "Clients view caregiver
    availability (agency scope)" are dropped in M-SEC-5. That happens only after the draft confirms
    no client screen reads availability directly.
  - Shown for review.
- **Q4 → M-SEC-4 applies.** `/order-management` is staff-only.
- **Q5 → follow-up slice, not this batch.** Caregivers keep date, time, service, city, client first
  name + last initial and `pay_rate` on open shifts. `special_notes` / `special_instructions` stay
  hidden until assigned (view or RPC). Recorded in known-issues.
- **A1 → added to M-SEC-2.** The `user_roles` agency_admin policy gets `role <> 'system_admin'` in
  both USING and WITH CHECK, so an agency_admin can neither create nor modify/delete a
  system_admin row. Granting `agency_admin` within one's own agency stays allowed (current product
  behaviour).
- **A2 → M-SEC-2 profiles trigger.** A non-system_admin caller may change `agency_id`,
  `virtual_office_id` or `office_restricted` only if:
  - the caller is `agency_admin`, and
  - `OLD.agency_id = current_agency_id()` **and** `NEW.agency_id = current_agency_id()`, and
  - `NEW.virtual_office_id` is NULL or an office whose `agency_id = current_agency_id()`.

  Everyone else, including the user themselves, is rejected. Service-role writes
  (`auth.uid() IS NULL`, the Edge Functions) are unaffected.
- **A3:** the caregiver-shifts RLS entry is marked RESOLVED. The CLAUDE.md Phase-0 line about it is
  updated (that line only) in the known-issues step.
- **Route guard covers `/schedule`** (S0b approved).
- **Run order** (stop at each push and each data write): E1 ✅ → M-SEC-1 → M-SEC-2 → M-SEC-3 →
  M-SEC-4 (each with `pg_policies` + `aclexplode` checks) → RequireRole incl. `/schedule` →
  Issue 2 in Mode B + `admin-reset-password` tenant check → E5 redaction + forced-reset list (wait)
  → write-on-load fix → E7 deletion (wait) → M-SEC-5 → done-tests 1–9 before and after →
  known-issues update.

---

## 8. Owner review of E1 (Oct 2) and the M-SEC-2 draft

### 8.1 Decisions recorded
- **Order:** M-SEC-2 first, then M-SEC-1, M-SEC-3, M-SEC-4.
- **New "before" tests:**
  - **0a:** a disposable scheduler sets its own `profiles.agency_id` to the disposable second agency.
    It must succeed before M-SEC-2 and fail after.
  - **0b:** a disposable agency_admin inserts a `system_admin` `user_roles` row. It must succeed
    before and fail after.
  - Both run with real JWTs against disposable fixtures. Teardown is verified.
- **§6.4 rows:** keep all 9 unchanged (dev data). known-issues gets "wipe dev intake/registration
  rows; production starts empty".
- **E5:** approved for the 4 rows in §6.5 (redact + forced reset), run after Mode B ships. Demo
  logins that will stop working until a set-password link is used:
  - robert.miller@caremuch-demo.test, betty.baker.client@caremuch-demo.test,
    maria.brown@caremuch-demo.test and michael.gonzalez@caremuch-demo.test.
  - The screenshot manager and caregiver (Dana Reyes) accounts are not among them.
- **E7:** approved for `36757fa8-44e5-4dd0-aae8-760bf6907688` and
  `ea0877fd-b879-4d13-a6d5-460cc6cd6332` (NOT EXISTS guards, then re-query). It runs at its place in
  the order, after the write-on-load fix.

### 8.2 Where the `profiles` columns are used (item 2)

| Column | Read by app code (src, Edge Functions) | Read by any DB function / view | Written by staff screens | Live values |
|---|---|---|---|---|
| `subscription_tier` | none | none | none | all `starter` |
| `business_license` | none | none | none | all NULL |
| `overtime_threshold` | **none.** Scheduling uses `agency.max_weekly_hours`; eligibility reads only `agency` caps | none (`check_assignment_eligibility` included) | none | all 40 |
| `default_ft_min_hours` | none | none | none | all 35 |
| `default_pt_min_hours` | none | none | none | all 15 |
| `email` | `AdminUserManagement.tsx:121,173` finds reset/delete targets **by `profiles.email`**; `UserRoles.tsx` displays it | — | `Caregivers.tsx:224` (another user's row; already a no-op, since no staff UPDATE policy exists) | equals `auth.users.email` for all 8 profiles |

- All five non-email columns are dead legacy fields (they came from the 2025-11-22 schema rebuild),
  so freezing them changes nothing.
- `profiles.email` is **not** kept in sync with auth: the app never calls `auth.updateUser({email})`.
  Because a target lookup keys on it, it is frozen for non-admins.
- The caregiver profile form no longer sends email: it is shown read-only with "contact your
  office". That companion code change is in `CaregiverProfileSettings.tsx` and ships with M-SEC-2.
- Profile writes found:
  - Edge Functions (service role): unaffected.
  - `CaregiverProfileSettings` (own row: full_name, phone): allowed.
  - `Caregivers.tsx:224` / `Clients.tsx:304` (another user's row): already blocked by RLS today, unchanged.

### 8.3 `caregivers` (item 3)
- **`caregivers.role`** is an enum (`full_time` / `part_time` / `on_call`; live values 4/1/1). It is
  display only: the badge color in `Caregivers.tsx:456`, the client Care Team label and the dev MCP
  `list-caregivers` tool. No DB function, eligibility rule or matcher reads it. It is frozen anyway
  (it is employment classification).
- **Emergency fields:** the caregiver form *does* edit `emergency_contact_name/phone`, so they stay
  self-editable.
- **Self-editable allowlist:** first/last name, phone, address/city/state/zip, emergency contact,
  `location_*`, `service_zipcodes`. Everything else is frozen for non-staff, including email,
  `role`, `is_active`, `hire_date`, `performance_rating`, `reliability_score`, `hourly_rate`,
  `employment_type`, `custom_min_hours`, `service_radius_miles`, agency, office and user_id.
- The guard also stops a caregiver updating *another* caregiver's row immediately, ahead of M-SEC-1's
  RLS change.
- No DB function updates `caregivers`, `clients` or `profiles` under a user's identity. The only
  function writing any guarded table is `assign_caregiver_role` (`user_roles`), granted to
  `service_role` only.
- **Drafter addition (strike if unwanted):** the same guard on `clients` for the client portal. Today
  a client can change their own `agency_id`, `user_id`, `preferred_caregiver_id`, medical fields and so on.

### 8.4 A4 — Edge Function audit (verified in source)

| Function | Role check | Agency check on target | Escalation found | Fix (Issue 2 step) |
|---|---|---|---|---|
| `create-user` | system_admin / agency_admin / manager | new user gets the caller's agency ✓ | 🔴 **role taken from the body with no allow-list** (`:171-175`): a manager or agency_admin can create a **system_admin** (or agency_admin) with a password they chose. `userData` is spread into `caregivers`/`clients` (column injection). The `user_roles` insert error is unchecked. | Per-caller allow-list (manager → caregiver/client/scheduler/hr_staff; agency_admin → + manager/agency_admin; only system_admin → system_admin); whitelist `userData` columns; check the insert |
| `admin-reset-password` | system_admin / agency_admin / manager | **none** | 🔴 the guard at `:81` only covers agency_admin → system_admin. **A manager can reset a system_admin's or agency_admin's password and log in as them.** An agency_admin can reset users in any agency. | Same-agency check (system_admin exempt); target's role must rank below the caller's; Mode B (send a link, never a typed password) |
| `admin-delete-user` | system_admin / agency_admin | **none** | 🔴 an agency_admin can delete any non-system_admin user in **any agency**; no self-delete guard | Same-agency check; forbid self-delete; target rank below caller |
| `enable-client-login` / `enable-caregiver-login` | system_admin / agency_admin / manager | record ✓ (`:48` / `:51`) | 🟠 an existing auth user is matched by email (body `email` override allowed). Profiles with NULL or legacy agency pass the cross-agency guard and are **moved into the caller's agency** with a new role. A system_admin acting cross-agency writes their own agency. | Refuse existing users not already in the caller's agency (NULL/legacy → system_admin only); drop the email override; derive agency from the record |
| `approve-caregiver-registration` | agency_admin / manager / hr_staff + `has_permission` | only if `reg.agency_id` is set (`:85`) | 🟠 NULL-agency registrations are claimable by any agency. Same NULL/legacy profile capture. `.ilike(email)` treats `%`/`_` as wildcards (`:163`). | Require `reg.agency_id = caller agency`; `.eq` on lower-cased email; close the NULL/legacy gap |
| `link-existing-accounts` | system_admin / agency_admin | **none (global)** | 🔴 an agency_admin run links records **across all agencies** and rewrites `profiles.agency_id` for NULL/legacy profiles (planted-email capture) | system_admin only, or filter both queries to the caller's agency; never relink NULL/legacy |

`verify_jwt` is on for all seven (default; no override in `config.toml`), and every function calls
`getUser`, so anonymous callers cannot reach them. All writes use the service role.

**Recommendation for your decision:** the `create-user` and `admin-reset-password` escalations are
live today and as severe as the `profiles` hole. M-SEC-2 does **not** cover them, because Edge
Functions use the service role and bypass the new guards. I suggest pulling their fixes forward to
run right after M-SEC-2 (before M-SEC-1). They are small, independent and testable with the
same disposable fixtures (new tests 0c/0d: a manager tries to create a system_admin; a manager tries
to reset an agency_admin). The rest of A4 stays in the Issue 2 step.

---

## 9. Owner decisions (Oct 2, second review) and before-test results

### 9.1 Decisions
- **M-SEC-2b** (new) runs right after M-SEC-2 and before M-SEC-1. It covers the four 🔴 Edge Function
  escalations, with **role and agency checks only**:
  - `create-user`: per-caller role allow-list, whitelist of `userData` columns, check the
    `user_roles` insert.
  - `admin-reset-password`: target must be in the caller's agency and rank below the caller.
  - `admin-delete-user`: same-agency, no self-delete, target ranks below the caller.
  - `link-existing-accounts`: system_admin only, or scoped to the caller's agency; never relinks
    NULL/legacy profiles.

  The typed-password → link change (Mode B) stays in the Issue 2 step. The 🟠 items
  (`enable-*-login`, `approve-caregiver-registration`) also stay in Issue 2.
- **Clients guard approved.** It freezes `agency_id`, `user_id`, `virtual_office_id`,
  `preferred_caregiver_id` and every column the client ProfileSettings form does not edit. The
  allow-list is shown below for owner sign-off.
- **Before/after tests 0c–0f added** (0a/0b from §8.1).
- **M-SEC-2 is not pushed** until the owner finishes reviewing the SQL.

### 9.2 Clients allow-list, taken from the form
`src/components/client-dashboard/ProfileSettings.tsx:174-186` is the only client-side write to
`clients`. Its `.update({...})` payload is exactly:

| Self-editable (allow-list) | Note |
|---|---|
| `first_name`, `last_name` | |
| `phone` | |
| `address`, `city`, `state`, `zip_code` | |
| `emergency_contact_name`, `emergency_contact_phone` | |
| ~~`notes`~~ | **Frozen (owner decision, Oct 2):** it is the staff "Notes" field. The client form no longer shows or sends it (`ProfileSettings.tsx`, ships with M-SEC-2). known-issues: "consider a separate client-editable field (`client_notes`)". |
| `updated_at` | set by trigger |

Frozen for the client: `id, agency_id, user_id, email, date_of_birth, care_requirements,
medical_conditions, preferred_caregiver_id, is_active, created_at, is_demo, family_id,
virtual_office_id, scheduling_flexibility, scheduling_notes`. Every other read of `clients` on the
client side is a SELECT (`ClientDashboard.tsx:98`, `CareCircle.tsx:44`, `OrdersManagement.tsx:181`).
The draft migration's clients guard already uses exactly this list.

### 9.3 Before-test results (2026-10-02, run `before-mur99uwi`)
Real JWTs (`signInWithPassword`) and real Edge Functions. Every outcome was re-checked through the
service role, not taken from the response. The service-role key was fetched into memory from the
logged-in Supabase CLI and never printed or stored. Fixtures:
- a disposable agency B;
- six disposable users: a scheduler, an agency_admin, a manager and an agency_admin target in
  agency `56fbfe38`, a client with a `clients` row in `56fbfe38`, and a caregiver in agency B.

| Test | Action (as the attacker's own JWT) | Result before | Must be after |
|---|---|---|---|
| 0a | scheduler sets own `profiles.agency_id` → agency B | **succeeded** (agency now B) | blocked (M-SEC-2) |
| 0b | agency_admin inserts a `system_admin` `user_roles` row for itself | **succeeded** (1 row) | blocked (M-SEC-2) |
| 0c | manager calls `create-user` with `staffRole: system_admin` | **succeeded** (new user holds system_admin) | blocked (M-SEC-2b) |
| 0d | manager calls `admin-reset-password` on an agency_admin | **succeeded** (sign-in with the manager-chosen password works) | blocked (M-SEC-2b) |
| 0e | agency_admin of A calls `admin-delete-user` on a user in agency B | **succeeded** (user deleted) | blocked (M-SEC-2b) |
| 0f | client sets own `clients.agency_id` → agency B | **succeeded** (agency now B) | blocked (M-SEC-2) |

Immediate repair inside the run:
- 0a and 0f were reverted.
- The system_admin rows from 0b and 0c were deleted.
- The user created by 0c was removed at teardown.

**Teardown:** 7 auth users (6 fixtures plus the one 0c created), their profiles and roles, the
client row and agency B were deleted. A re-query found none remaining, including a sweep of
`profiles` for the run's email suffix. The after-run uses the same script
(`sec_tests_0.cjs after`).

### 9.4 INSERT/DELETE bypass check (owner item 2) → guard (5) added to M-SEC-2

| Table | INSERT/DELETE-capable policies (live) | Own-row delete + re-insert, or insert with arbitrary agency/office/user_id? |
|---|---|---|
| `profiles` | none | No. Only service_role / the `on_auth_user_created` trigger write. |
| `user_roles` | system_admin; agency_admin in own agency | No. Bounded by the policy (and `role <> system_admin` after M-SEC-2). |
| `clients` | "Admins and managers can manage clients" (system_admin / agency_admin / manager; own agency/office) | Non-staff cannot. **Staff can insert with any `user_id`** (attaching a foreign login) and, if agency-wide, any `virtual_office_id`. |
| `caregivers` | "Agency users can manage their caregivers", FOR ALL with **no role check** | 🔴 **Yes, for any agency member.** A caregiver or client can INSERT a caregivers row with any `user_id` (their own → they count as a caregiver to `my_caregiver_ids()`) and any office. They can also DELETE any caregiver row, including deleting their own and re-inserting it with a new `hourly_rate`, which bypasses the UPDATE guard. |

Fix: `guard_person_record_insert_delete()`, a BEFORE INSERT OR DELETE trigger on `caregivers` and
`clients`.
- **Exempt:** service role and system_admin.
- **Non-staff:** may not insert or delete at all.
- **Staff:** insert only into their own agency, with a NULL office or one of their agency's offices,
  and a NULL `user_id` or a user whose profile is in their agency. Delete only rows of their own
  agency.

It is SECURITY DEFINER, because a manager can't read another user's `profiles` row under RLS; its
EXECUTE is revoked. The existing staff paths stay compatible: `Caregivers.tsx:290`, `Clients.tsx:360`
(own agency, no `user_id`), `convert_care_request_to_client` (office from the care request) and the
service-role Edge Functions.

**New before/after test 0g:** (i) a client inserts a `caregivers` row with `user_id` = itself;
(ii) a caregiver deletes its own `caregivers` row. Both must succeed before and fail after.

### 9.5 Rollback for M-SEC-2 (kept here, not in the migration)

```sql
-- 1. Remove the guards
DROP TRIGGER IF EXISTS trg_guard_profiles_update          ON public.profiles;
DROP TRIGGER IF EXISTS trg_guard_caregivers_update        ON public.caregivers;
DROP TRIGGER IF EXISTS trg_guard_clients_update           ON public.clients;
DROP TRIGGER IF EXISTS trg_guard_caregivers_insert_delete ON public.caregivers;
DROP TRIGGER IF EXISTS trg_guard_clients_insert_delete    ON public.clients;
DROP FUNCTION IF EXISTS public.guard_profiles_update();
DROP FUNCTION IF EXISTS public.guard_caregivers_update();
DROP FUNCTION IF EXISTS public.guard_clients_update();
DROP FUNCTION IF EXISTS public.guard_person_record_insert_delete();

-- 2. Restore the exact previous user_roles policy (20260913214228_m1_agency_scope_admin_policies.sql:26-37)
DROP POLICY IF EXISTS "Agency admins manage roles in their own agency" ON public.user_roles;
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
Rolling back reopens all of §6.1 / §9.3, so it is for an emergency regression only. Revert the two
`.tsx` changes with it if the guards are removed (they are harmless to leave in place).

### 9.6 M-SEC-2 pushed and verified (2026-10-02) — commit `f2b4aa2`

`supabase migration list` showed `20261002120000` as the only pending migration, so `db push`
applied only it. Post-push checks (read-only):
- **`pg_policies` user_roles:** "Agency admins manage roles in their own agency" now carries
  `role <> 'system_admin'::app_role` in both USING and WITH CHECK. The other two policies are unchanged.
- **`pg_trigger`:** five enabled BEFORE triggers.
  - `trg_guard_profiles_update` (UPDATE)
  - `trg_guard_caregivers_update` (UPDATE)
  - `trg_guard_clients_update` (UPDATE)
  - `trg_guard_caregivers_insert_delete` (INSERT, DELETE)
  - `trg_guard_clients_insert_delete` (INSERT, DELETE)
- **`aclexplode`:** the four guard functions have EXECUTE for `postgres` (owner) and `service_role`
  only. There is **no `PUBLIC`, `anon` or `authenticated`**, so CLAUDE.md #14 holds.
  - Deviation from "owner-only": the extra `service_role` grant comes from Supabase's default
    privileges on new functions in `public`.
  - It is inert: Postgres refuses to call a trigger function except as a trigger.
  - **ACCEPTED DEVIATION (owner, Oct 4):** keep the `service_role` EXECUTE. Trigger functions can't
    be called directly, so it grants nothing.

After-tests (run `after-msec2-mura5zj2`, plus a re-run with the staff smoke test):

| Test | Before | After M-SEC-2 | Blocked by |
|---|---|---|---|
| 0a scheduler moves own profile to agency B | succeeded | **blocked** | profiles guard: "Only name and phone can be changed on your own profile" |
| 0b agency_admin grants itself system_admin | succeeded | **blocked** | RLS: new row violates policy for `user_roles` |
| 0c manager creates system_admin (create-user) | succeeded | still open (expected) | M-SEC-2b |
| 0d manager resets agency_admin password | succeeded | still open (expected) | M-SEC-2b |
| 0e agency_admin deletes agency-B user | succeeded | still open (expected) | M-SEC-2b |
| 0f client moves own clients row to agency B | succeeded | **blocked** | clients guard: "Only your contact details can be changed here" |
| 0g-i client inserts a caregivers row for itself | succeeded | **blocked** | insert/delete guard: "Only staff can create or delete caregivers records" |
| 0g-ii caregiver deletes its own caregivers row | succeeded | **blocked** | same |
| S1 caregiver saves own profile (form payload) | OK | **OK** | — |
| S2 client saves own profile (form payload) | OK | **OK** | — |
| S3 manager adds + deletes a caregiver and a client (staff UI path) | — | **OK** | — |

Teardown is verified by re-query after every run, with nothing left.

---

## 10. M-SEC-2b — Edge Function role/agency checks (DEPLOYED 2026-10-04, see §10.3)

Files (uncommitted):
- `supabase/functions/_shared/authz.ts` (new)
- `create-user/index.ts`
- `admin-reset-password/index.ts`
- `admin-delete-user/index.ts`
- `link-existing-accounts/index.ts`

All five parse and bundle with esbuild. Deno isn't installed here, so `deno check` hasn't run. The
Mode B link change and the 🟠 functions are **not** touched (Issue 2 step).

**Shared rules (`_shared/authz.ts`):**
- **Caller and target role** come from **all** of the user's `user_roles` rows, taking the highest
  by rank. This deliberately avoids `get_user_role()`, which leaves `client` out of its ordering.
  Ranks: system_admin 100 > agency_admin 80 > manager 60 > scheduler = hr_staff 40 > caregiver 20 >
  client 10.
- **`canActOn(caller, target)`** allows an action only when all of these hold:
  - the target exists;
  - it isn't the caller (unless `allowSelf`);
  - the target ranks **strictly below** the caller;
  - unless the caller is system_admin, both the caller and the target have the same non-NULL agency.
- **`CREATABLE_ROLES`:**
  - manager → scheduler, hr_staff, caregiver, client;
  - agency_admin → those + manager, agency_admin;
  - system_admin → all.

| Function | Change |
|---|---|
| `create-user` | Rejects an unknown `userType` or a non-staff `staffRole`. Checks the requested role against `CREATABLE_ROLES[caller]` **before** creating the auth user. `userData` is filtered through an allow-list (client: address/city/state/zip/date_of_birth/emergency contact; caregiver: address/city/state/zip/employment_type/hourly_rate/emergency contact); id, user_id, agency_id, office and is_active are always ignored. The `user_roles` insert result is checked; on failure the record and auth user are rolled back and a 500 is returned. |
| `admin-reset-password` | After the existing caller-role check (system_admin / agency_admin / manager): `canActOn` (same agency, target ranks below). Still accepts a typed password until Mode B. |
| `admin-delete-user` | After the existing caller-role check (system_admin / agency_admin): `canActOn`, which also refuses self-delete. |
| `link-existing-accounts` | **system_admin only** (its only caller is the system_admin AdminUtilities page). It links only when the matched account's profile **already** has the record's agency. NULL, legacy, missing or other-agency profiles are never moved; they are returned in `skipped` with a reason. |

**Behaviour changes you will notice (all intended by the "rank below caller" rule):**
- **Peer actions are now refused.** An agency_admin can no longer reset or delete another
  agency_admin, and a system_admin can no longer reset or delete another system_admin through these
  functions. `Users.tsx` "Reset password"/"Delete" on a peer admin will show the 403 message.
- **A manager can reset only** scheduler, hr_staff, caregiver and client accounts in their own
  agency. That covers `Caregivers.tsx` and `Clients.tsx`.
- **A manager can no longer create** manager or agency_admin accounts.

**After-tests for M-SEC-2b** (same script, added before deploy):
- **Must be blocked:** 0c, 0d, 0e, plus **0h**: an agency_admin calls `link-existing-accounts` → 403.
- **Must still work** (new smoke tests S4–S6):
  - S4: a manager creates a caregiver via `create-user`;
  - S5: a manager resets a caregiver's password in its own agency;
  - S6: an agency_admin deletes a caregiver in its own agency.

**Deploy (after approval):** `supabase functions deploy create-user admin-reset-password
admin-delete-user link-existing-accounts`. The `_shared` file is bundled with each function.

### 10.1 Owner conditions A–E (Oct 4) — how the code meets them

| # | Condition | Where it holds |
|---|---|---|
| A | Only manager / agency_admin / system_admin may call create-user, admin-reset-password, admin-delete-user. scheduler, hr_staff, caregiver and client always get 403. | `hasCallerRole(caller, MANAGER_OR_ABOVE)` is the first check in create-user and admin-reset-password. admin-delete-user is narrower still (`system_admin`, `agency_admin`). The caller's role is the highest of **all** their role rows. |
| B | create-user sets agency_id server-side (caller's agency; system_admin may pass an existing `agencyId`). Any `agency_id` in userData is ignored. An office must belong to that agency, and an office-restricted caller may use only its own office. | `targetAgencyId` / `targetOfficeId` in create-user. A non-system_admin passing another `agencyId` gets 403. `pick()` drops `agency_id`, `virtual_office_id`, `user_id` etc. from userData. An explicit `virtualOfficeId` is checked against `virtual_office.agency_id`; a restricted caller must equal its own office. |
| C | Target rank = highest of all its role rows. A target with no profile or NULL agency is refused unless the caller is system_admin. | `loadPrincipal()` (all `user_roles` rows; a profile-less target gets `agencyId = null`). `canActOn()` refuses a NULL-agency target for every non-system_admin. |
| D | Cross-agency and unknown targets return the same generic 403. | `canActOn()` returns `GENERIC_DENY` ("You do not have permission to manage this user", 403) for unknown, malformed id, other agency and not-lower-rank. Only "your own account" has its own message. |
| E | No change to `verify_jwt` or any function setting in `supabase/config.toml`. | `git diff supabase/config.toml` is empty. |

Type check: Deno 2.9.6 (installed via `npm i -g deno`), `deno check` on the four functions plus
`_shared/authz.ts` → exit 0, no errors. No fixes were needed beyond A–E.

### 10.2 Rollback for M-SEC-2b
The four functions are untouched in git up to `f2b4aa2`, and the before-run (§10.3) behaved exactly
as that code reads. Supabase keeps no version history I can roll back to, so the rollback is to
redeploy them from that commit:
```bash
git checkout f2b4aa2 -- supabase/functions/create-user supabase/functions/admin-reset-password \
  supabase/functions/admin-delete-user supabase/functions/link-existing-accounts
npx supabase functions deploy create-user admin-reset-password admin-delete-user link-existing-accounts \
  --project-ref rgeldgztadebgvrdhaqa
git checkout HEAD -- supabase/functions   # restore the working tree afterwards
```
The old versions don't import `_shared/authz.ts`, so that file can stay in place. Rolling back
reopens 0c, 0d, 0e, 0h and T2.

### 10.3 Deployed and tested (2026-10-04)
Deployed only `create-user`, `admin-reset-password`, `admin-delete-user` and
`link-existing-accounts` to `rgeldgztadebgvrdhaqa` (new versions 14/13/13/13). `verify_jwt` is
still `true` on all four.

Tests used real JWTs and the deployed functions against disposable fixtures:
- agency B;
- in agency `56fbfe38`: a manager, two agency_admins, an hr_staff and two caregivers with rows;
- in agency B: one caregiver.

Every outcome was confirmed by re-query. Teardown swept every auth user with the run's email suffix,
including users created *by* the functions (11 before, 10 after). Re-query found none remaining.

| Test | Before (runs `before-mutwea8g`) | After (runs `after-mutwg83f`) |
|---|---|---|
| 0c manager creates a system_admin | **ALLOWED**: 200, account created with system_admin | **BLOCKED**: 403 "You do not have permission to create a system_admin account", no account |
| 0d manager resets an agency_admin's password | **ALLOWED**: 200, login with the new password works | **BLOCKED**: 403 generic, login fails |
| 0e agency_admin of A deletes a user in agency B | **ALLOWED**: 200, user deleted | **BLOCKED**: 403 generic, user still exists |
| 0h agency_admin calls link-existing-accounts | **ALLOWED**: 200 (pre-check: 0 real records linkable, so nothing was written) | **BLOCKED**: 403 "Only a system administrator can run the account backfill" |
| T1 hr_staff resets a caregiver's password | blocked: 403 "Insufficient permissions" | **BLOCKED**: same; login fails |
| T2 agency_admin resets another agency_admin | **ALLOWED**: 200, login works | **BLOCKED**: 403 generic, login fails |
| T3 manager create-user with `userData.agency_id = B` | created in **A** (the server value overrode the spread) | created in **A**. `agency_id` in userData is now dropped by the allow-list; profile, caregivers row and role row are all in A |
| T4 manager deletes itself | blocked: 403 (manager may not call delete) | **BLOCKED**: same; manager still exists |
| S4 manager creates a caregiver | works | **WORKS**: profile, caregivers row and `caregiver` role row all in A |
| S5 manager resets a caregiver's password | works | **WORKS**: caregiver logs in with it |
| S6 agency_admin deletes a caregiver in its own agency | works | **WORKS** |
| S7 agency_admin creates a manager in its own agency | works | **WORKS**: `manager` role in A |
| S8 caregiver "Forgot password" request | not run (independent of M-SEC-2b) | **NOT VERIFIED.** Supabase Auth refused the request: `400 Email address "…@caremuch-sectest.test" is invalid`. The `.test` fixture domain isn't deliverable, so GoTrue rejects it before any email step. |

**S8 notes:**
- The app has **no Forgot-password UI** today (§2.1; added in the Issue 2 step). S8 exercised the
  same Supabase Auth endpoint that UI will call.
- Verifying it needs a deliverable address that is allowed to receive the project's default-SMTP
  mail, i.e. a project team address. Supabase's built-in mailer only sends to those. Or it needs
  custom SMTP (known-issues: Mode A).
- Proposal: re-run S8 in the Issue 2 step against an address the owner names. None of this is
  affected by M-SEC-2b.

Committed `a954cfc` and pushed to `origin/phase-3`. The push also published two earlier local
commits that had not been pushed yet: `0898363` (client visibility) and `0ea2f99` (Available Shifts
redesign). The owner confirmed that was fine.

### 10.4 Owner acceptance (Oct 4)
- **M-SEC-2b accepted.** `admin-delete-user` limited to agency_admin / system_admin is approved: it
  is intentionally stricter than "manager or above". Consequence for the UI: **the Delete-user
  button must be hidden for manager.** This is added to the RequireRole step (§13).
- **Agency_admin password resets are done by system_admin**, which follows from the peer rule.
- **S8 is deferred to the Issue 2 step.** The owner will supply a real test address.

### 10.5 Uncommitted migration `20260917090000` — synced
`20260917090000_caregiver_visible_clients_trade_shifts.sql` re-creates
`get_caregiver_visible_clients()` (same zero-arg signature) with a third visibility clause. It lets
a caregiver see the name, address and phone of clients whose shifts are on the **Trade Shifts**
board in its own office: pending trades that don't need manager approval and were offered by
another caregiver. It mirrors `get_caregiver_trade_shifts()`'s WHERE clause, which fixed "Unknown"
client names on trade cards, and re-asserts REVOKE/GRANT.

Verified 2026-10-04 (read-only):
- the 3 statements recorded in `supabase_migrations.schema_migrations` equal the file, ignoring
  comments and whitespace;
- the live function is the single zero-arg overload and contains the file's body;
- EXECUTE is held by `postgres`, `authenticated` and `service_role` (no PUBLIC / anon).

Committed alone as `cd12ff4` ("Sync already-applied migration …"). No database change.

---

## 11. M-SEC-1 — staff-role checks (DRAFT, not pushed)

**Migration:** `supabase/migrations/20261004120000_msec1_staff_role_checks.sql`

**Rule:** prepend `is_agency_staff(auth.uid()) AND` to every "same agency ⇒ allowed" branch, keep
the tenant and office clauses verbatim, keep every self-policy, and re-create each policy under
its own name. No functions are touched.

| Table | Policy changed | Added |
|---|---|---|
| `caregivers` | "Agency users can manage their caregivers" (FOR ALL) | — |
| `caregiver_skills` | "Agency users can manage caregiver skills" (now `TO authenticated`, explicit WITH CHECK) | — |
| `caregiver_availability` | "Agency users can manage caregiver availability" (same) | — |
| `client_care_needs` | "Agency users can manage client care needs" (same) | — |
| `families` | `families_select_agency_or_own`: agency branch | — |
| `care_requests` | `care_requests_select`: agency branch | — |
| `shift_ratings` | "Agency staff can view ratings in their agency" | **"Caregivers view ratings about themselves"** (keeps the Today rating; `caregiver_performance` is security_invoker) |
| `shift_trades` | view / manage / create policies | **"Caregivers read their own trades"** (original or new caregiver). Caregiver INSERT is limited to their own outgoing trade, and caregivers never UPDATE. |

Not touched: the two client read policies on `caregivers` and `caregiver_availability`, which
M-SEC-5 replaces with an RPC.

### 11.1 Before-tests (run `before-mutwn98v`, 2026-10-04)
Real JWTs against disposable fixtures in agency `56fbfe38`:
- logins for caregiver A, caregiver B, a client and a manager;
- caregiver rows;
- a second client (no login) with a family, care need and inquiry;
- skills and availability;
- 2 shifts assigned through `assign_caregiver_to_shift()`;
- 2 ratings and 2 trades.

Direct `shift_assignments` inserts are blocked by `trg_protect_assignment_columns`, so the
assignments went through the real path, as the fixture manager, with a recorded override reason.
Teardown deleted every fixture row and its audit `events`, and a re-query found none remaining.

| # | Check (as the caregiver or client's own JWT) | Before | Must be after |
|---|---|---|---|
| 1.1 | caregiver reads another caregiver's row (email, phone, rate) | **OPEN** | closed |
| 1.2 | … another caregiver's skills | **OPEN** | closed |
| 1.3 | … another caregiver's availability | **OPEN** | closed |
| 1.4 | … a client's care needs | closed\* | closed |
| 1.5 | … a family | **OPEN** | closed |
| 1.6 | … a family inquiry (care_request) | **OPEN** | closed |
| 1.7 | … a rating about another caregiver | **OPEN** | closed |
| 1.8 | … another caregiver's trade | **OPEN** | closed |
| 2.1 | caregiver adds a skill to another caregiver | **OPEN** | closed |
| 2.2 | caregiver deletes another caregiver's availability | **OPEN** | closed |
| 2.3 | caregiver changes a client's care-need priority | closed\* | closed |
| 2.4 | caregiver cancels another caregiver's trade | **OPEN** | closed |
| 3.1 | client reads a caregiver's skills | **OPEN** | closed |
| 3.2 / 3.9 | client reads / changes **another** client's care needs | closed\* | closed |
| 3.3 | client reads another family | **OPEN** | closed |
| 3.4 | client reads another family's inquiry | **OPEN** | closed |
| 3.5 | client reads ratings | **OPEN** | closed |
| 3.6 | client reads trades | **OPEN** | closed |
| 3.7 / 3.8 | client reads a caregiver row / availability | visible | visible (M-SEC-5 closes) |
| S1–S3 | caregiver reads own row, own skills and availability; replaces own availability (AvailabilityDialog) | works | must work |
| S4 | caregiver sees own rating via `caregiver_performance`, and **only** its own row | **fails** (sees 8 rows) | must work (1 row) |
| S5 | caregiver reads own trade ("My trade requests") | works; other party's name shown | works. **Name will be NULL until M-SEC-3** |
| S6 | client reads own care needs and own inquiry | works | must work |
| S7 | manager reads all 8 fixture rows | works | must work |
| S8 | manager adds and removes a caregiver skill (Caregivers.tsx path) | works | must work |

\* `client_care_needs` is already effectively closed: its "agency" policy finds the client's agency
through a sub-select on `clients`, and that sub-select is itself filtered by `clients` RLS, which
hides other clients from a caregiver or client. M-SEC-1's change there is defense in depth.

### 11.2 Notes for review
- **Pair M-SEC-1 with M-SEC-3.** Once caregivers can no longer read other caregivers' rows, the
  "My trade requests" embed `new_caregiver:new_caregiver_id(first_name,last_name)` resolves to NULL.
  Recommendation: push M-SEC-3 (`get_my_trade_requests()` plus the `caregiverBoard.ts` switch)
  immediately after M-SEC-1 in the same session, or before it, so the name never disappears.
- **Q7 (open):** "Caregivers can manage their own skills" is kept. A caregiver can still add care
  types to their own profile (`CaregiverProfileSettings` → "Edit Skills"), and the eligibility
  engine's `skill` rule then treats them as qualified. Should skills become staff-managed, or
  caregiver-proposed and staff-approved? That is a product decision and is not part of M-SEC-1.
- **Staff paths checked in code:** Caregivers, Clients, ClientInquiries, FamilyDialog,
  ClientSchedulingDialog, ShiftTrades, TimeOffDecisionDialog, Reports, Dashboard and
  useMenuBadgeCounts. All run as staff and pass `is_agency_staff`. S7 and S8 prove the read and
  skill-write paths.
- **Non-staff paths checked in code:** caregiver own skills, availability and trades; client own
  care needs and inquiries (CareCircle). All are covered by self-policies, which are unchanged.

---

## 12. One batch: M-SEC-1 + skills (Q7) + M-SEC-3 + M-SEC-5 + frontend (DRAFT, not pushed)

### 12.1 Q7 — caregiver skills become staff-managed (owner decision, Oct 4)

**Who may write `caregiver_skills`:**
- staff in the same agency only, i.e. any `is_agency_staff` role: system_admin, agency_admin,
  manager, hr_staff, **and scheduler**;
- scheduler is included because it edits skills today. `/caregivers`' Edit dialog, which deletes
  and re-inserts skills (`Caregivers.tsx:256-312`), is shown to every staff role, scheduler included.

**What changes in the database (M-SEC-1, section 2):**
- "Caregivers can manage their own skills" (FOR ALL) is replaced by **"Caregivers view their own
  skills"** (SELECT only).

**What changes in the caregiver UI (`CaregiverProfileSettings.tsx`):**
- the Edit Skills button, the add-skill form and the remove (×) buttons are removed;
- skills are listed read-only with "To change your skills, contact your office.";
- `handleAddSkill` / `handleRemoveSkill` are deleted, so the caregiver side has no write call to
  `caregiver_skills`. Only the own-row SELECT remains.

**Every path that writes `caregiver_skills` today:**

| Path | Runs as | After the change |
|---|---|---|
| `Caregivers.tsx:256-312` (staff add/edit dialog: delete + insert) | authenticated staff | works (staff policy; S8 verifies) |
| `CaregiverProfileSettings.tsx` Edit Skills (caregiver Profile) | caregiver | would fail; **removed from the UI** |
| `approve-caregiver-registration` (skills from the screening answers) | service role | unaffected |
| `import-data` (bulk import) | service role | unaffected |
| `reset-database` (dev tool) | service role | unaffected |
| Public caregiver registration (`submit_caregiver_registration`) | anon RPC | writes `caregiver_registrations` only, never `caregiver_skills` |
| Any DB function | — | none writes `caregiver_skills` (checked in `pg_proc`) |

No other client-side caregiver write exists. "Caregiver proposes, staff approves" is logged in
known-issues as a later item.

### 12.2 Breakage sweep — every caregiver / client / family read or write of the 8 tables

Family users have **no login** in this app: family intake is anonymous, through the conversation
RPCs. So the rows below cover caregiver and client sessions. Every Edge Function except `mcp`
uses the service role and is unaffected.

| # | Screen / path (file) | Table / call | Today | After this batch | Covered by |
|---|---|---|---|---|---|
| 1 | Caregiver Today / Schedule / Shifts / Profile / Time Off, `useIsCaregiverRole` | `caregivers` own row | works | works (self policy) | — (S1) |
| 2 | `CaregiverProfileSettings` save | `caregivers` own update | works | works (self policy + M-SEC-2 allow-list) | — |
| 3 | `CaregiverProfileSettings` skills list | `caregiver_skills` own SELECT | works | works | Q7 SELECT policy (S2) |
| 4 | `CaregiverProfileSettings` Edit Skills | `caregiver_skills` own INSERT/DELETE | works | would fail | **UI made read-only** (Q7; K1/K2 prove the block) |
| 5 | `AvailabilityDialog` from caregiver Profile | `caregiver_availability` own select/delete/insert | works | works | — (S3) |
| 6 | Caregiver Today rating (`caregiverPerformance.ts`) | `caregiver_performance` view → `shift_ratings` | works (but sees all 8 caregivers) | works, own row only | new "Caregivers view ratings about themselves" (S4) |
| 7 | Available Shifts → My trade requests (`caregiverBoard.fetchMyTradeRequests`) | `shift_trades` own + embeds `new_caregiver`, `shifts` | works | trade row works; **taker's name → NULL**; shift embed already NULL after an accepted trade | **M-SEC-3** `get_my_trade_requests()` (R1) |
| 8 | Available Shifts: open/trade boards, pick-ups (`caregiverBoard`) | SECURITY DEFINER RPCs | works | works | — (`shiftEligibility` is imported only for its result mapper; its local fallback never runs on the caregiver side) |
| 9 | Client Care Team tab (`CareTeam.tsx`) | `shift_assignments` → `caregivers` → `caregiver_performance` | **already empty**: clients can't read `shift_assignments` | works | **M-SEC-5** `get_my_care_team()` (R2) |
| 10 | Client Care Circle tab (`CareCircle.tsx`) | `shift_assignments` + `caregivers` (+ own `care_requests`) | primary and backups **already empty** except the preferred caregiver | works | **M-SEC-5** `get_my_care_team()`; own `care_requests` stays on its self branch |
| 11 | Client Schedule tab (`MySchedule.tsx`) | `shifts` own → embed `caregivers(...)` | works (via the broad client policy) | caregiver name → NULL | **M-SEC-5** names from `get_my_care_team()` |
| 12 | Client Care Plans tab, "request a caregiver" picker (`OrdersManagement.tsx`) | `caregivers` + embedded `caregiver_availability` + `caregiver_performance` | works, but **exposes every caregiver's pay rate and zips, and prices the booking with the caregiver's pay rate** | would return nothing | **M-SEC-5** `get_bookable_caregivers(day)` (R3); the price stays the service price |
| 13 | Client Profile / dashboard (`ProfileSettings.tsx`, `ClientDashboard.tsx:170`) | `client_care_needs` own | works | works | — (S6) |
| 14 | `mcp` Edge Function `list-caregivers` tool | `caregivers` **as the calling user** | dev tooling for staff | a caregiver/client caller would get its own row only | — (intended) |

**Not covered by M-SEC-3/5, and not caused by this batch:**
- **(a)** The client "Care Plans" booking submit (`OrdersManagement.tsx`) inserts `client_orders`
  and `shifts`. Clients have **no INSERT policy on either table**, so a client booking already fails
  at submit, before and after this batch. The owner said clients book through this tab, so it needs
  its own decision: a SECURITY DEFINER "request care" RPC, or routing the request into
  `care_requests`. Logged in known-issues; not touched here.
- **(b)** Nothing else found. Every remaining read in the sweep is staff-only (Dashboard, Caregivers,
  Clients, Schedule, AssignShiftDialog, Reports, ShiftTrades, TimeOffRequests, ClientInquiries,
  FamilyDialog, ClientSchedulingDialog, useMenuBadgeCounts, SystemAdminDashboard/PlatformAnalytics),
  and all of those pass `is_agency_staff`.

### 12.3 M-SEC-3 — `get_my_trade_requests()` (`20261004120100_msec3_get_my_trade_requests.sql`)
- **Mechanics:** `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`.
- **Scope:** rows where `original_caregiver_id` is a caregivers row with `user_id = auth.uid()`.
- **Returns:** trade id, shift_id, status, reason, created_at, resolved_at, the shift's
  date/start/end/title, and the taker's **first name + last initial, only when status =
  'accepted'** (the only state AvailableShifts shows a name).
- **Grants:** `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated`.
- **Frontend:** `fetchMyTradeRequests()` calls the RPC and maps it to the unchanged `MyTradeRequest`
  shape (last name rendered as "G."), so `AvailableShifts.tsx` is untouched.

### 12.4 M-SEC-5 — client caregiver reads (`20261004120200_msec5_client_caregiver_reads.sql`)

**Columns returned and never returned:**
- **Display-safe columns only:** first name, last initial, employment role label
  (`full_time`/…), care-type codes, the aggregate rating shown today (avg + count). Plus, for the
  care team, shift count, last/next shift date and an `is_preferred` flag.
- **Never returned:** email, phone, address, zip codes, pay rate, emergency contacts, user_id.
  Caregivers have no photo column.
- **Phone and email are dropped on purpose,** although CareTeam/CareCircle rendered them. Those
  views were empty in practice (row 9/10), and the owner's Q3 rule was "no email/phone". The UI
  now says "To reach your caregiver, contact your office."

**`get_my_care_team()`**
- Scope: the caller's own client record(s) (`clients.user_id = auth.uid()`).
- Returns caregivers with a non-cancelled assignment on those clients' shifts dated
  **CURRENT_DATE − 180 days … CURRENT_DATE + 90 days**, plus the client's `preferred_caregiver_id`,
  in the same agency.
- **Window needed by the UI:**
  - CareTeam and CareCircle show the client's current team. Recent history and the near future
    covers it.
  - MySchedule names the caregiver on every listed shift. Shifts outside the window render with
    no name, which the existing `?.` rendering already handles.
  - **Accepted by the owner (Oct 4): 180 / 90.** It can be widened later if a client history view
    is needed (no client/family view in V1, Q6).

**`get_bookable_caregivers(_day_of_week)`**
- This is the booking picker. It is a different question from "assigned caregivers": the picker
  must offer caregivers *not yet* on the client's shifts.
- Returns active caregivers of the client's agency, and of the client's office if the client has
  one. That office filter is new; the old picker ignored offices.
- Filters: the caregiver lists the client's zip and has `is_available` slots that weekday. It
  returns only that day's time windows.
- **Decided (owner, Oct 4):** keep `get_bookable_caregivers`, with the new office filter and the
  active-only condition. A `_day_of_week` outside 0–6 returns an empty set (no error text).
- **Client booking submit** (no client INSERT on `client_orders`/`shifts`) stays a later decision in
  known-issues. Suggested direction: route client requests into `care_requests`, which staff turn
  into orders.

**Policy and UI changes:**
- **Dropped policies:** "Clients view caregivers (agency scope) 20251106" and "Clients view
  caregiver availability (agency scope) 20251106". `caregiver_performance` then returns nothing to
  clients, and the screens take ratings from the RPCs.
- **Grants:** both functions `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated`.
- **Frontend:**
  - new `src/lib/clientCareTeam.ts` (fetchMyCareTeam / fetchBookableCaregivers / displayName);
  - `CareTeam.tsx`, `CareCircle.tsx` and `MySchedule.tsx` use the care-team RPC;
  - the `OrdersManagement.tsx` picker uses the bookable RPC and **no longer overwrites the booking
    price with the caregiver's pay rate** (it was `rate: caregiver.hourly_rate`).

### 12.5 Tests (script `sec_tests_1.cjs`; before-run `before-mutxoprh`, 2026-10-04)

Fixtures in agency `56fbfe38`:
- logins for caregiver A, caregiver B, a client and a manager;
- caregiver A serves zip 49002 and is free on Tuesday; caregiver B serves no zip;
- a second client (no login) with a family, care need and inquiry;
- the client's own record with a shift assigned to caregiver A;
- shifts for the second client assigned to A and B through `assign_caregiver_to_shift()`;
- ratings, and trades by A (taken by B) and by B.

Teardown deleted every row and its audit `events`, and a re-query found none remaining.

| Check | Before | Must be after |
|---|---|---|
| 1.1–1.3, 1.5–1.8 caregiver reads others' caregiver row / skills / availability / family / inquiry / rating / trade | **OPEN** | closed |
| 2.1, 2.2, 2.4 caregiver adds a skill to / deletes availability of / cancels a trade of another caregiver | **OPEN** | closed |
| **K1** caregiver adds a skill to itself · **K2** caregiver removes its own skill | **OPEN** | closed (Q7) |
| 3.1, 3.3–3.6 client reads skills / other family / other inquiry / ratings / trades | **OPEN** | closed |
| **3.7 / 3.8** client reads caregiver rows / availability directly | **OPEN** | closed (M-SEC-5) |
| 1.4, 2.3, 3.2, 3.9 care needs of another client | closed\* | closed |
| **R1** `get_my_trade_requests` (caregiver A): A's trade yes, B's trade no; taker name only once accepted | N/A (not deployed) | must work |
| **R2** `get_my_care_team` (client): caregiver A yes, B no; no email/phone/address/zip/rate/user_id columns | N/A | must work |
| **R3** `get_bookable_caregivers(Tuesday)` (client): caregiver A yes, B no; display-safe columns | N/A | must work |
| **R4** caregiver calls `get_my_care_team` / client calls `get_my_trade_requests` | N/A | must return nothing |
| S1–S3 caregiver own row, skills, availability; replaces own availability | works | must work |
| S4 caregiver sees only its own `caregiver_performance` row (with its rating) | **fails** (8 rows) | must work (1 row) |
| S5 caregiver reads own trade row | works | must work (name via R1) |
| S6 client reads own care needs + own inquiry | works | must work |
| S7 manager reads all 8 fixture rows · S8 manager adds/removes a caregiver skill | works | must work |

\* already closed through `clients` RLS (§11.1).

**Screen smoke tests:** R1 is the exact call behind "My trade requests". R2 is the call behind
CareTeam, CareCircle and MySchedule names. R3 is the picker's call. After the push, a browser pass
of the client dashboard tabs (Care Team, Care Circle, Schedule, Care Plans → picker) and the
caregiver Profile / Shifts tabs will be done with the fixture logins and teardown.

### 12.6 Push plan (one push, after owner approval)
1. Commit the batch:
   - migrations `20261004120000` (M-SEC-1 + Q7 skills), `20261004120100` (M-SEC-3),
     `20261004120200` (M-SEC-5);
   - frontend: `CaregiverProfileSettings.tsx`, `caregiverBoard.ts`, `clientCareTeam.ts`,
     `CareTeam.tsx`, `CareCircle.tsx`, `MySchedule.tsx`, `OrdersManagement.tsx`;
   - the plan.
2. `supabase migration list`: confirm exactly these three are pending. Then `supabase db push`,
   which applies them in filename order: M-SEC-1 → M-SEC-3 → M-SEC-5.
3. Post-push verification (read-only):
   - `pg_policies` on the 8 tables (staff check present, self-policies intact, the two client
     policies gone);
   - `aclexplode` on the three new functions (postgres, authenticated, service_role; no
     PUBLIC/anon).
4. Run `sec_tests_1.cjs after`: every must-close closed, every must-work/R working, teardown clean.
5. Push the branch.

The frontend is served from this repo (dev server / Fly deploy), so the new client calls go live
with the next frontend run or deploy. Between `db push` and that, the old client bundle would show
no caregiver names or picker results, and the old caregiver bundle would show no taker name. Those
are display-only gaps on dev, with no data exposure.

M-SEC-4 (menu seeds) is **not** in this batch. It stays next in the run order, before RequireRole.

### 12.7 Pushed and verified (2026-10-04)
- **Commit:** single commit **`a7eb540`**, pushed to `origin/phase-3`. Earlier hashes `e3c01f1` and
  `bd883bd` were local amends that never left the machine. It was amended before push so it carries
  only this batch. The
  first version also swept in an unrelated, pre-existing uncommitted `fetchCaregiverOpenShifts`
  hunk in `caregiverBoard.ts` (caregiver app shell work). That hunk was removed from the commit and
  left in the working tree.
- **`supabase migration list`:** exactly `20261004120000`, `20261004120100` and `20261004120200`
  were pending. `db push` applied them in that order.
- **Read-only checks:**
  - every agency branch on the 8 tables carries `is_agency_staff` / `has_role`, and the self-policies
    are intact;
  - "Clients view caregivers (agency scope) 20251106", "Clients view caregiver availability (agency
    scope) 20251106" and "Caregivers can manage their own skills" are **gone**;
  - `get_my_trade_requests()`, `get_my_care_team()` and `get_bookable_caregivers(integer)` are each
    a single overload, `prosecdef = true`, `proconfig = {search_path=public}`, with EXECUTE for
    `postgres`, `authenticated` and `service_role` only. There is **no PUBLIC or anon**.

**After-tests** (run `after-muty3xab`):
- Fixtures were extended for the owner's checks: offices X and Y in agency A; a caregiver serving
  only office Y; and an agency-B caregiver matching the client's zip and Tuesday, also set as the
  client's `preferred_caregiver_id`.
- Teardown deleted every row, office, agency, auth user and audit event, verified by re-query.

| Check | Before | After |
|---|---|---|
| 1.1–1.3, 1.5–1.8, 2.1, 2.2, 2.4, K1, K2, 3.1, 3.3–3.8 (18 holes) | OPEN | **all CLOSED** |
| 1.4, 2.3, 3.2, 3.9 (care needs, already closed via `clients` RLS) | closed | closed |
| R1 `get_my_trade_requests`: own trade only; name hidden while pending, "C." initial once accepted | N/A | **works** |
| R2 `get_my_care_team`: own caregiver only; columns `caregiver_id, first_name, last_initial, employment_role, care_type_codes, avg_rating, rating_count, shift_count, last_shift_date, next_shift_date, is_preferred` (no email/phone/address/zip/rate/user_id) | N/A | **works** |
| R3 `get_bookable_caregivers(Tue)`: zip + availability match only; display-safe columns | N/A | **works** |
| R4 / C1 / C2: caregiver → care team or bookable; client → trades | N/A | **empty** |
| A1 anon calls each of the 3 RPCs | N/A | **refused** (42501 ×3) |
| O1 client in office X vs caregiver serving only office Y (picker) | N/A | **not listed**; the office-X caregiver is listed |
| O2 agency-A client vs agency-B caregiver (picker; care team via `preferred_caregiver_id`) | N/A | **not returned** in either |
| D1 `get_bookable_caregivers(7)` and `(-1)` | N/A | **empty, no error** |
| S4 caregiver sees only its own `caregiver_performance` row | failed (8–9 rows) | **1 row** (own rating) |
| S1–S3, S5–S8 working paths | work | **work** |

**Browser pass** (Playwright/Chromium against the local Vite dev server, real `/auth` logins,
disposable client and caregivers, teardown verified; screenshots in the session scratchpad):

| # | Screen | Result |
|---|---|---|
| B1 | Client → Care Team | **PASS.** "Zoe A.", role badge, 5.0 rating, "To reach your caregiver, contact your office."; no email or phone on the page |
| B2 | Client → Care Circle | **PASS.** "Zoe A." as primary caregiver; no email or phone |
| B3 | Client → Schedule | **PASS.** This week's shift names the caregiver |
| B4 | Client → Care Plans → booking picker | **NOT REACHABLE, pre-existing.** Step 1 lists no services for any client, because the form filters care types by three hard-coded category names that no longer exist in the data (known-issues). The picker's RPC is covered by R3, O1, O2 and D1 at the API level. |
| B5 | Caregiver → Profile | **PASS.** Skills listed; no "Edit Skills" button; "To change your skills, contact your office." |
| B6 | Caregiver → Shifts → My Trade Requests | **PASS.** The accepted trade shows "— Ben B." |

---

## 14. M-SEC-4 (menu seeds) + RequireRole — DRAFT (not committed, not pushed)

### 14.1 What is drafted
| Piece | File | What it does |
|---|---|---|
| Role helper | `src/lib/roleHome.ts` (new) | The role sets `STAFF`, `MANAGER_OR_ABOVE`, `ADMIN`, `SYSTEM_ADMIN`; `roleHome(role)` (the single role → landing mapping, moved out of Auth.tsx); `safeNextPath()` (absolute same-origin path only; rejects `//`, **any backslash** and control characters) |
| Route guard | `src/components/auth/RequireRole.tsx` (new) | `getSession()` + `get_user_role()`, the same mechanism as the pages, lifted to the router. No session → `/auth?next=<path>`. NULL role → `/auth` (Auth shows "pending approval"). Role not allowed → `roleHome(role)` plus a toast. Shows a spinner until resolved (no content flash). |
| Router | `src/App.tsx` | 27 routes wrapped. **STAFF:** dashboard, **schedule**, caregivers, clients, client-inquiries, time-off, shift-trades, flow-builder, caregiver-approvals, notifications-outbox, care-types, care-service-categories, order-management, virtual-offices (+`/:id`), knowledge-base, reports. **MANAGER_OR_ABOVE:** admin-user-management. **ADMIN:** users, users/add, users/edit/:id, user-roles, agency-settings. **SYSTEM_ADMIN:** system-roles, role-permissions, system-admin(-dashboard), admin-utilities. The `/live-operations`, `/quick-assign` and `/auto-schedule` aliases redirect into the guarded `/schedule`. Caregiver, client, public and OAuth routes are unwrapped (§1.2). |
| Auth | `src/pages/Auth.tsx` | Uses `roleHome()` and `safeNextPath()`. Post-login routing is unchanged; `?next=/\host` is no longer followed. |
| Delete-user for manager | `src/pages/AdminUserManagement.tsx` | The "Delete User" tab and its content render only for agency_admin / system_admin. Managers keep Create and Reset (both functions allow them, within rank). |
| Peer actions | `src/pages/Users.tsx` | Reset Password and Delete are enabled only when the target ranks **strictly below** the caller (the same ranks as `_shared/authz.ts`). Edit Role keeps its previous rule. |
| Menus | `supabase/migrations/20261004130000_msec4_menu_seeds.sql` | Sets all CRUD flags false for `caregiver.schedule`, `client.schedule` and `client.orders` (rows kept). Seeds `system_modules.client_dashboard` (category `client`) and grants the client role read on it. Rollback is in the file. |

**Decision taken in the draft (owner to confirm):**
- `/admin-user-management` is **MANAGER_OR_ABOVE**, not ADMIN as §1.1 first listed.
- Managers use it to create and reset accounts for roles below them; the Delete tab is hidden from them.
- `/users` stays ADMIN, as its own in-page check already requires.

**Found while drafting (fixed in the draft):** `Auth.tsx`'s `?next=` check accepted
`/\example.com`, which browsers normalise to `//example.com`. This is an **open redirect**, proven
by test U9 below. `RequireRole` starts generating `?next=` links, so it is fixed in the same step.

### 14.2 Tests (`sec_tests_ui.cjs`)
- Real Chromium (Playwright) against the local Vite dev server and real `/auth` logins.
- Disposable fixtures: a caregiver, a client, a manager, two agency_admins and one user with **no
  role**. Teardown is verified by re-query.
- **before** = the committed code. **draft** = the working tree with the §14.1 frontend changes;
  the menu migration is NOT applied.

| # | Check | Before (`ui-before-mutydkpt`) | Draft (`ui-draft-mutyod34`) | Must be after push |
|---|---|---|---|---|
| U1 | caregiver opens the 25 staff/admin routes | **OPEN.** 14/25 render (dashboard, schedule, caregivers, client-inquiries, time-off, flow-builder, caregiver-approvals, notifications-outbox, care-types, care-service-categories, order-management, knowledge-base, reports, admin-user-management) | **CLOSED.** All 25 → `/caregiver-dashboard` | closed |
| U2 | client opens the same 25 | **OPEN.** Same 14/25 | **CLOSED.** All 25 → `/client-dashboard` | closed |
| U3 | logged-out `/dashboard` | → `/auth` (no `next`) | → `/auth?next=%2Fdashboard` | ok |
| U4 | signed-in user with no role opens `/dashboard` | **OPEN** (renders) | **CLOSED** → `/auth` | closed |
| U5 | manager on `/admin-user-management` sees the Delete User tab | **OPEN** | **CLOSED** (Create + Reset still shown) | closed |
| U6 | manager opens dashboard, schedule, caregivers, clients, time-off, reports | ok | ok | ok |
| U8 | agency_admin: Reset/Delete enabled on a **peer** agency_admin row in `/users` | **OPEN** (3 enabled) | **CLOSED** (only Edit Role) | closed |
| U9 | `/auth?next=/\example.com` after login | **OPEN.** Left the app → `http://example.com/` | **CLOSED** → `/dashboard` | closed |
| U7 | client sidebar links to staff "Care Plan" / "Schedule"; no client-dashboard entry | **OPEN** | **OPEN** (needs the M-SEC-4 data migration) | closed + "My Dashboard" link |

To add in the after-run: agency_admin still sees the Delete tab and can open `/users`; scheduler and
hr_staff open the STAFF pages but are bounced from ADMIN pages; system_admin lands on and opens the
SYSTEM_ADMIN pages.

### 14.3 Push plan (after owner approval)
1. Commit **only** this step's hunks: the two new files, plus `App.tsx`, `Auth.tsx`,
   `AdminUserManagement.tsx`, `Users.tsx`, the migration and the plan. `App.tsx` also carries
   unrelated, pre-existing uncommitted caregiver-app-shell edits (the CaregiverToday / CaregiverSchedule
   routes). Those are left out of the commit the same way the `caregiverBoard.ts` hunk was (§12.7).
   This needs care: the guard edits sit next to those routes. If the owner prefers, the
   caregiver-app-shell work can be committed first as its own change.
2. `supabase migration list` → only `20261004130000` pending → `db push`.
3. Read-only checks:
   - `role_permissions` for caregiver/client (schedule and orders all false; client_dashboard read);
   - `system_modules.client_dashboard` present.
4. `sec_tests_ui.cjs after` (U1–U9 plus the additions above). Teardown verified.
5. Push the branch. The frontend goes live on the next dev-server run or deploy.

### 14.4 Rollback
Revert the commit (frontend). For the menus, run the UPDATE/DELETE block at the end of the
migration file.

### 14.5 Owner review (Oct 4) and what was done
- **`/admin-user-management`** = manager, agency_admin, system_admin. Scheduler and hr_staff are
  redirected (U12). Approved.
- **Commit:** only the guard hunks of `App.tsx` were committed (`1c28073`).

**Staged-only build proof:**
- `git stash push --keep-index --include-untracked`, then `tsc` and `vite build` on the staged-only
  tree. The build passed. `tsc` shows only the known stale-type errors plus 4 in the committed
  `CaregiverDashboard.tsx` (stale `shift_assignments` types; that page only exists because the
  app-shell work deletes it), none in the guard files.
- **Restoring was not clean the first time.** `git stash pop --index` stopped on a conflict in
  `App.tsx` and kept the stash. With `core.autocrlf=true` it also rewrote LF files with CRLF.
- **Recovery:** every file was restored byte-for-byte from SHA-1s recorded before the stash:
  - `App.tsx` from a saved copy;
  - the line-ending-only files back to LF;
  - `.gitignore`, which had mixed endings, rebuilt by hash (27 CRLF + 3 LF lines);
  - the index reset to the guard-only state.

  `git status` and all 22 modified/untracked files then matched the pre-stash state exactly, and
  only then was the stash dropped.
- **Lesson:** next time use `git stash push --keep-index` *without* `--index` on pop, or build from a
  `git worktree` of the staged tree instead of stashing.

**Role resolution (owner point 3):**
- `get_user_role()` orders system_admin(1) … caregiver(6). `client` has no CASE arm, so it gets NULL
  and sorts **last**: client is the lowest role, the same as `_shared/authz.ts` (client 10).
- A client-only user resolves to `client`; caregiver + client resolves to `caregiver`.
- The only difference from `authz.ts` is a scheduler/hr_staff tie, where `get_user_role` prefers
  scheduler while `authz.ts` ranks them equal. That's harmless for routing: both use the same routes.
- No multi-role users exist today; U11 created one.

**`?next=` (owner point 4):**
- `safeNextPath()` checks the value as received and after up to three rounds of decoding.
- It requires exactly one leading `/` (not `//`, not `/\`), no backslash and no control characters.
- Finally the value must resolve, against `window.location.origin`, to that same origin.

**M-SEC-4 rows (owner point 5):**
- `role_permissions` has **no agency column**; it is global, keyed by role and module. So no agency can
  have customised these rows.
- All three changed rows still had their seed timestamps (created = updated = 2026-08-25).
- Changed (count 3):
  - `caregiver.schedule` read true → false;
  - `client.schedule` read true → false;
  - `client.orders` read/create true → false.
- Inserted: `system_modules.client_dashboard` and `client.client_dashboard` read.

### 14.6 Pushed and verified (2026-10-04)
- `supabase migration list`: only `20261004130000` pending. `db push` applied it.
- Read-only check of the menu rows:
  - `caregiver.schedule` and `client.schedule`/`orders` have all CRUD false;
  - `client.client_dashboard` read is true;
  - the `system_modules` 'client_dashboard' row exists (category `client`, active).

**UI tests** (`sec_tests_ui.cjs`):
- **before** = committed `a7eb540`, run from a temporary `git worktree` of HEAD (run `ui-before-mutz5cgg`);
- **after** = with `1c28073` and the migration (run `ui-after-mutzlj1w`);
- disposable fixtures in both, teardown verified.

| # | Check | Before | After |
|---|---|---|---|
| U1 | caregiver opens the 25 staff/admin routes | **OPEN** (14 render) | **CLOSED** (all → `/caregiver-dashboard`) |
| U2 | client opens the same 25 | **OPEN** (14 render) | **CLOSED** (all → `/client-dashboard`) |
| U3 | logged-out `/dashboard` | `/auth` (no next) | `/auth?next=%2Fdashboard` |
| U4 | no-role user opens `/dashboard` | **OPEN** | **CLOSED** (→ `/auth`) |
| U5 | manager sees the Delete User tab | **OPEN** | **CLOSED** (Create + Reset kept) |
| U6 | manager opens staff pages | ok | ok |
| U8 | agency_admin Reset/Delete on a peer agency_admin | **OPEN** (3 enabled) | **CLOSED** (Edit Role only) |
| U9 | `?next=` variants: `/\example.com`, `//example.com`, `%2F%2Fexample.com`, `%2F%5Cexample.com`, `/%09/example.com`, `https://example.com`, `javascript:alert(1)`, `%252F%252Fexample.com` | **OPEN** (`/%5C…`, `%2F%5C…`, `/%09/…` → example.com) | **CLOSED** (all 8 stay in the app; no JS dialog) |
| U10 | client logs in → client home; `/client-dashboard` renders | ok | ok |
| U11 | caregiver + client user → higher role's home | ok (`/caregiver-dashboard`) | ok |
| U12 | scheduler / hr_staff open `/admin-user-management` | **OPEN** | **CLOSED** (→ `/dashboard`; `/schedule` still opens) |
| U13 | agency_admin: Delete tab + `/users` | ok | ok |
| U7 | client sidebar links to staff Care Plan / Schedule | **OPEN** | **CLOSED** (sidebar: "CLIENT · My Dashboard") |

**Sidebars after the push (U14):**

| Role | Sidebar entries |
|---|---|
| manager | Dashboard, Client Inquiries, Client Management, Caregiver Applications, Caregiver Management, Care Plan, Schedule, Time Off Requests, Shift Trades, Notification Outbox, Care Services, Care Service Categories, Conversation Builder, Virtual Offices, Knowledge Base, Reports |
| scheduler | Dashboard, Client Management, Caregiver Management, Care Plan, Schedule, Time Off Requests, Shift Trades |
| hr_staff | Dashboard, Client Inquiries, Caregiver Applications, Conversation Builder |
| agency_admin | as manager + Agency Settings |
| client | **My Dashboard** only |
| caregiver | CaregiverAppShell bottom tabs (Today, Schedule, Shifts, Profile) in the working tree. With the committed code (old CaregiverDashboard in AppLayout), the sidebar no longer lists the staff "Schedule" (before: OPERATIONS · Schedule). |

### 14.7 CLAUDE.md rule 15 — routes still to guard when the app-shell work is committed
The uncommitted caregiver-app-shell work adds or changes these routes. Each needs a RequireRole
role list in the commit that lands it:
- `/caregiver-dashboard` → `CaregiverToday` (replaces `CaregiverDashboard`);
- `/caregiver-schedule` → `CaregiverSchedule` (**new route**);
- `/available-shifts`, `/caregiver-time-off`, `/caregiver-settings`: dual-shell pages changed by
  that work (they pick `CaregiverAppShell` vs `AppLayout` via `useIsCaregiverRole`);
- `/client-dashboard` is also still session-only (it predates rule 15).

**Proposed lists:**
- `allow={["caregiver"]}` for the five caregiver routes, and `allow={["client"]}` for
  `/client-dashboard`.
- **Caveat to decide then:** `get_user_role` resolves a staff+caregiver user to the staff role, so
  such a user would be sent to `/dashboard` instead of the caregiver app. None exist today. The
  alternative is a caregiver-row check, which is what `useIsCaregiverRole` already does.

**Resolved (Ripple S7, Oct 5; owner decision 2).** The branch was archived as
`archive/caregiver-app-shell-2026-10` (9a83e24) and the shell salvaged into S7. Every caregiver route
is wrapped in **`RequireCaregiverRecord`** (`src/components/caregivers/RequireCaregiverRecord.tsx`): a
linked, active caregivers row with `user_id = auth.uid()` in the user's agency, not a role ranking, so
a dual-role user reaches both UIs. Routes: `/caregiver-dashboard` (Today), `/caregiver-schedule` (the
existing CaregiverDashboard page), `/caregiver/notes`, `/caregiver/notes/:shiftId`, `/available-shifts`,
`/caregiver-time-off`, `/caregiver-settings`. A user without a record goes to their role home; no
session goes to `/auth?next=`. `useIsCaregiverRole` and the dual-shell switching were not salvaged
(every guarded page renders the caregiver shell). On DEV only the caregiver role has the
`available_shifts` menu permission, so no staff menu link is affected. `/client-dashboard` is unchanged
(still session-only).

## 15. Issue 2 Mode B + 🟠 Edge Function fixes + Forgot password — DRAFT (not deployed, not committed)

### 15.1 What is drafted
**Backend:**
- **New `_shared/accountLinks.ts`:**
  - `findAuthUserIdByEmail` (exact match);
  - `checkExistingAccount`, the 🟠 rule: link only if the profile is already in the record's agency; a
    NULL/legacy profile only by a system_admin; never move an account between agencies;
  - `inviteNewUser` / `recoveryLink` via `auth.admin.generateLink`, which **sends no email**;
  - `setPasswordRedirect`;
  - an audit-only outbox text with no secret.
- **Functions:**

| Function | Mode B | 🟠 / other |
|---|---|---|
| `enable-client-login`, `enable-caregiver-login` | New account → one-time **invite** link in the response (`setPasswordLink`), never stored. The outbox row has no password, no link and no `temp_password` key. | Caller gate uses `_shared/authz.ts` ranking. The agency comes from the **record**, fixing the system_admin cross-agency stamping. The `email` override is **refused** (400). An existing account is linked only under the agency rule above, and its agency is never overwritten. |
| `approve-caregiver-registration` | Same (invite link; no temp password; clean outbox) | The registration must already be in the reviewer's agency; an **unassigned (NULL)** one is refused (403, "ask a system administrator to assign it"). Existing-account agency rule as above. Caregiver row matched by **exact** lower-cased email, not `.ilike()` wildcards. |
| `admin-reset-password` | A typed `newPassword` is **refused** (400). Returns a one-time **recovery** link (`resetLink`). By default the current password is first set to a random value nobody sees, so a leaked or temp password dies at once (`keepCurrentPassword: true` skips that). | M-SEC-2b rank and agency checks unchanged |
| `create-user` | A `password` field is **refused** (400). The account is created through an invite link (`setPasswordLink`); an existing email gets 409. | M-SEC-2b checks unchanged |

`deno check` passes on all six functions plus `_shared/*` (exit 0).

**Frontend:**
- **New `OneTimeLinkDialog`:** shows the link once with Copy, "not stored, single-use, expires (1 h
  by default)".
- **New `src/lib/accountLinks.ts`:** `requestResetLink`.
- **Every password field and password display is gone:**
  - `Clients.tsx` and `Caregivers.tsx`: enable-login result and both reset paths (Caregivers' inline
    edit-dialog reset now creates a link on Save);
  - `CaregiverApprovals.tsx`: approval result;
  - `Users.tsx`: reset;
  - `AdminUserManagement.tsx`: Create + Reset tabs;
  - `AddUser.tsx`: password field and the never-enforced "Require password change on first login"
    checkbox removed.
- **New public pages:**
  - `/auth/forgot` (`ForgotPassword.tsx`): `resetPasswordForEmail`; the same message whether or not the
    email exists;
  - `/auth/set-password` (`SetPassword.tsx`): invite/recovery session → choose an 8–72 char password →
    role home; an expired or used link says so.
- **`AuthLinkRouter` in `App.tsx`:** routes invite/recovery arrivals to `/auth/set-password` even if
  Supabase falls back to the Site URL.
- **Small additions:** "Forgot password?" link on `/auth`; outbox label `caregiver_login_created`.
- **Routes:** both new routes are **public by design**, marked in `App.tsx` as the CLAUDE.md rule 15
  exception.
- **Type check:** `tsc` clean apart from the 5 known stale-type errors.

### 15.2 Supabase Auth dependencies — nothing changed, owner to verify in the dashboard
- **Default mailer:**
  - Supabase's built-in email service is meant for development only. It delivers **only to
    addresses of the Supabase organization's team members** and is **rate-limited to a few emails
    per hour** (Auth → Rate limits; historically 2–4/h). Anything else is refused or silently
    dropped.
  - It only matters for **Forgot password** (Supabase sends the recovery email). **Mode B links are
    not affected**: `generateLink` sends nothing.
  - **S8 needs a test address that is a member of the Supabase org team**, or custom SMTP (Mode A).
  - `resetPasswordForEmail` is also throttled per address (about one request per 60 s).
- **Redirect URLs:**
  - Links redirect to `<app origin>/auth/set-password` only if that origin is on Auth → URL
    Configuration → Redirect URLs (for example `http://localhost:8080/**` and the deployed origin).
  - Otherwise Supabase falls back to the **Site URL**, and `AuthLinkRouter` still sends the user to
    `/auth/set-password`, provided the Site URL is this app.
- **Expiry:** links are single-use and expire after the project's email-link expiry (Supabase default
  1 h). An invited user who never sets a password can be sent a fresh link with "reset password"
  (to be confirmed by after-test P7).

### 15.3 Before-tests (`sec_tests_modeb.cjs`, run `mb-before-muu08le0`, deployed functions)
Disposable fixtures:
- a manager;
- a caregiver login;
- an auth user whose profile has **no agency**;
- 3 clients (one sharing that user's email), 1 caregiver;
- an **unassigned** registration;
- a registration whose email contains `_`, plus a decoy caregiver row matching it as a LIKE pattern.

Teardown covered auth users created by the functions, outbox rows and audit events; none remained.

| # | Check | Before | Must be after |
|---|---|---|---|
| P1 | enable-client-login returns or stores a password | **OPEN** (`tempPassword` in response + outbox) | closed; link works (P1L) |
| P2 | enable-caregiver-login returns or stores a password | **OPEN** | closed |
| P3 | admin-reset-password accepts a staff-typed password | **OPEN** (login with it works) | closed (400) |
| P4 | reset link: old password dies, link sets a new one | N/A (old function) | works |
| P5 | create-user accepts a staff-chosen password | **OPEN** | closed (400) |
| P6 | create-user invite link sets a password | N/A | works |
| O1 | manager links an existing **NULL-agency** account and moves it into its agency | **OPEN** | closed (409) |
| O2 | enable-client-login honours a body `email` override | **OPEN** | closed (400) |
| O3 | manager approves an **unassigned** registration | **OPEN** | closed (403) |
| O4 | approval links the account to a **different** caregiver row via `ILIKE` wildcard | **OPEN** | closed (new row; decoy untouched) |
| O4b | approval stores a password in the outbox | **OPEN** | closed |

To add after deploy: **P7** (fresh reset link for an invited-but-never-activated user); **S8**
(Forgot password with the owner's test address); **UI pass** (each dialog shows a link, never a
password; `/auth/forgot` and `/auth/set-password` work end to end).

### 15.4 E5 — redaction + forced reset (approved, runs after Mode B is deployed)
- **Redact** the 4 rows from §6.5 with the §2.5 UPDATE: body text → `[redacted 2026-10]`; drop the
  `temp_password` payload key. Re-query: 0 rows match.
- **Forced reset** of the 4 demo accounts (robert.miller, betty.baker.client, maria.brown and
  michael.gonzalez, all `@caremuch-demo.test`): set a random password nobody sees (the same mechanism
  `admin-reset-password` now uses by default).
- **Effect:** those 4 demo logins **stop working** until someone generates a reset link for them in the
  UI. The screenshot manager/caregiver accounts are not affected.
- Run as approved data statements (service role) with before/after counts shown.

### 15.5 Deploy / commit plan (after owner approval)
1. Commit only this step's files. `App.tsx` again gets just its hunks (AuthLinkRouter + 2 routes),
   leaving the app-shell work unstaged. Staged-only build proof, this time **from a `git worktree` of
   the staged tree, not a stash** (§14.5 lesson).
2. Deploy `create-user`, `admin-reset-password`, `enable-client-login`, `enable-caregiver-login` and
   `approve-caregiver-registration`. `verify_jwt` must stay unchanged (checked after deploy).
3. After-tests P1–P7, O1–O4b, UI pass, S8 with the owner's address. Then E5. Then push the branch.
4. **Rollback:** redeploy the five functions from the previous commit (`git checkout 419fed0 --
   supabase/functions/<fn>`, then `supabase functions deploy`) and revert the frontend commit.

**Decisions for the owner:**
- **(a)** Unassigned registrations (from `/caregiver-registration` and `/assistant`, which carry no agency)
  can no longer be approved by agency staff. Who assigns them? A system_admin action, or should
  public registration always carry an office?
- **(b)** The forced-reset default in `admin-reset-password` (invalidate current password) is on. Keep it?
- **(c)** `AdminUserManagement`'s Reset tab finds users by `profiles.email`. Managers can't read other
  users' profiles (RLS), so for them it reports "User not found". This is pre-existing and logged,
  not changed here.

### 15.6 Owner review (Oct 5): conditions A–F and how the draft meets them

| # | Condition | Status in the draft |
|---|---|---|
| A | Every generated invite/recovery link writes an audit event (actor, target, link type, time); the link is never written to audit, DB, logs or console | `auditLinkIssued()` inserts an `events` row: `event_type='account_link_issued'`, `actor_id`=staff, `subject_type='user'`, `subject_id`=account, `payload={link_type, function}`, `occurred_at`. It inserts **directly** (not via `log_event()`, which swallows errors) and **fails closed**: an invite whose audit fails deletes the just-created account; a reset whose audit fails discards the link. **Needs migration M-SEC-6** (below): `events.event_type` has a CHECK list without this value. A grep found no `console.*` of any success response; functions log only `error.message`. `approve-caregiver-registration` and `create-user` were changed to log messages, not error objects. |
| B | Link only in component state, cleared on close, never in URL/localStorage; shows expiry and "send this to the person; it works once" | `OneTimeLinkDialog` gets the link as a prop from the caller's `useState`. Every caller sets it to `null` in `onClose`. Nothing touches URL, local/session storage or the console. Text: "Send this to the person; it works once. It expires in 1 hour." |
| C | `/auth/forgot` gives the same message whether or not the email exists | Yes. It always shows the same confirmation, including on errors and rate limits. |
| D | Link router clears tokens from the URL after the session is established; `/auth/set-password` requires that session; password rules match Supabase's minimum | `AuthLinkRouter` forwards the token fragment to `/auth/set-password` and calls `history.replaceState` to strip it **as soon as a session exists**. An in-memory flag (`arrivedViaPasswordLink`) means `/auth/set-password` only works for a session that came from an invite/recovery link in this page load; an ordinary signed-in session gets "invalid or expired link". The app requires 8–72 chars. The server minimum can't be read without the dashboard, so after-test **PW** measures it by trying 6, 7 and 8 characters. The app's 8 is stricter than Supabase's default 6, and any extra server rule is shown as the server's own message. |
| E | `redirectTo` only uses the app's own origin | `setPasswordRedirect()` accepts the request Origin **only if it exactly equals** one of `APP_ORIGINS` (`http://localhost:8080`, `https://caremuch-platform.fly.dev`). Otherwise no `redirect_to` is sent and Supabase uses the Site URL. Supabase also enforces its own allow-list. `/auth/forgot` uses `window.location.origin`. |
| F | Link expiry = Supabase default 1 h; raising it is a later owner decision | Logged in known-issues; the UI states 1 hour. Not changed. |

**Decisions implemented:**
1. **Unassigned registrations: system_admin only.**
   - Agency staff already can't see them; RLS requires `agency_id` = their agency, which a NULL never
     matches, and that was verified on the live policy.
   - New `UnassignedRegistrations` section on Caregiver Applications, rendered only for system_admin:
     pending registrations with no agency, an **Agency** + **Office (optional)** picker, and **Assign**.
     The update runs through the existing system_admin RLS and only applies while `agency_id IS NULL`.
   - `approve-caregiver-registration` refuses unassigned rows until assigned.
   - Per-office registration links are logged in known-issues.
2. **Reset invalidates the current password by default:** kept. The opt-out `keepCurrentPassword: true`
   already existed in the draft and is kept, unchanged and not surfaced in any UI.
3. **Staff + caregiver resolving to staff:** accepted. The role switcher is logged in known-issues.

### 15.7 Blocker: migration M-SEC-6 must be pushed before the functions are deployed
`supabase/migrations/20261005120000_msec6_account_link_event_type.sql` re-creates
`events_event_type_check` with the exact current 17 values plus `account_link_issued`. There is no
data, function or grant change. Because the functions fail closed, deploying them without it would
make **every** link generation fail ("Could not record the audit event"). It isn't covered by "deploy
only the five functions", so per the standing rule it needs approval.

**Proposed order after approval:**
1. Commit the step (only its hunks; `App.tsx` again guard-only plus the 2 routes and `AuthLinkRouter`;
   staged-only build checked from a `git worktree`, not a stash).
2. Push M-SEC-6, then verify the constraint.
3. Deploy the five functions.
4. After-tests.
5. S8 (wait for the owner's team-member address).
6. Push the branch.

### 15.8 Redirect URLs to confirm in the Supabase dashboard (Auth → URL Configuration)
- **Site URL:** the app's main origin, e.g. `https://caremuch-platform.fly.dev`. Links fall back to it.
- **Redirect URLs:**
  - `http://localhost:8080/auth/set-password`
  - `https://caremuch-platform.fly.dev/auth/set-password`

  Or the wider `http://localhost:8080/**` and `https://caremuch-platform.fly.dev/**`.
- If the app is served from any other origin (a custom domain, a Lovable preview), it must be added
  both here **and** to `APP_ORIGINS` in `supabase/functions/_shared/accountLinks.ts`. Otherwise links
  land on the Site URL, which `AuthLinkRouter` still handles.

### 15.9 After-tests prepared (`sec_tests_modeb.cjs`, not yet run against the new code)
- **Closed:** P1–P3, P5, O1–O4b (the 9 holes); R1/R2 (manager → agency_admin / another agency's
  user: 403); P4b (a reset link's second use fails).
- **Work:** P1L/P4/P6 (invite and reset links set a password, the old password dies); AU (one audit
  row per generated link, no link/token in it).
- **Measured:** PW (server password minimum).
- **Not yet built:** P7 (fresh reset link for an invited-but-never-activated user); UI pass; S8.

---

## 16. Review packet — nothing here runs until the owner approves

### 16.1 E5 — redact stored temporary passwords + force-reset the 4 demo accounts
**Rows to redact:** `public.pending_notifications`, 4 rows, columns `body` and `payload`. Current
values are shown with the password masked.

| id | kind | recipient | delivered | body (current, masked) | payload (current, masked) |
|---|---|---|---|---|---|
| `bf56c29b-d234-4f29-936f-128778b7b1ef` | caregiver_login_created | robert.miller@caremuch-demo.test | no | "Hi Robert, an account was created for you. Temporary password: [MASKED, 15 chars]" | `{caregiver_id: a6fc562b-…, temp_password: [MASKED]}` |
| `a56fae11-d722-45fc-b28c-fea26e178bbf` | client_login_created | betty.baker.client@caremuch-demo.test | yes | "Hi Betty, … Temporary password: [MASKED, 15 chars]" | `{client_id: d9f62d86-…, temp_password: [MASKED]}` |
| `b77eb0e8-304e-4744-b367-158b8b935a02` | caregiver_login_created | maria.brown@caremuch-demo.test | no | "Hi Maria, … Temporary password: [MASKED, 15 chars]" | `{caregiver_id: cf949a04-…, temp_password: [MASKED]}` |
| `a549bb3f-e02c-4985-981e-5aca2417c4d2` | caregiver_login_created | michael.gonzalez@caremuch-demo.test | yes | "Hi Michael, … Temporary password: [MASKED, 15 chars]" | `{caregiver_id: 3ca0b84a-…, temp_password: [MASKED]}` |

```sql
-- E5a (one transaction, approved data statement; run with the service role)
UPDATE public.pending_notifications
SET body    = regexp_replace(body, '(temporary password)\s*:?\s*\S+', '\1: [redacted 2026-10]', 'gi'),
    payload = payload - 'temp_password'
WHERE id IN ('bf56c29b-d234-4f29-936f-128778b7b1ef','a56fae11-d722-45fc-b28c-fea26e178bbf',
             'b77eb0e8-304e-4744-b367-158b8b935a02','a549bb3f-e02c-4985-981e-5aca2417c4d2')
  AND (payload ? 'temp_password' OR body ~* 'temporary password');
-- expect: UPDATE 4.  Verify: the §2.5 count query returns 0 rows.
```

**Accounts to force-reset:** each password is set to a random value nobody sees.
- **Mechanism:** the same as `admin-reset-password` does by default; run once with the service role
  (`auth.admin.updateUserById`).
- **No link is generated** unless someone later uses "reset password" in the UI.
- **Effect:** these 4 demo logins **stop working** until then.

| auth user id | email | role | last sign-in |
|---|---|---|---|
| `3d801304-e277-474f-b346-9fa2e0c01072` | robert.miller@caremuch-demo.test | caregiver | 2026-09-16 |
| `6381919e-e94e-4bbf-be24-8c47657fcfef` | betty.baker.client@caremuch-demo.test | client | 2026-10-01 |
| `c38a9b6c-d8d0-4879-b6ae-05a377d06f92` | maria.brown@caremuch-demo.test | caregiver | 2026-10-01 |
| `d65d4ee5-e405-473f-af57-fabdbd7956f4` | michael.gonzalez@caremuch-demo.test | caregiver | never (temp password still valid) |

```text
-- E5b (service role, one call per id): auth.admin.updateUserById(<id>, { password: <32 random bytes, base64, discarded> })
-- Verify: signing in with the old temporary password fails for each (checked without printing it).
```

### 16.2 E7 — delete the 2 empty anonymous sessions
Both still exist, re-checked 2026-10-05 (read-only):

| id | user_id | agency_id | flow audience | status | created_at (UTC) | answers | care_requests | registration |
|---|---|---|---|---|---|---|---|---|
| `36757fa8-44e5-4dd0-aae8-760bf6907688` | NULL (anonymous) | NULL | caregiver_screening | in_progress | 2026-10-01 21:17:48 | 0 | 0 | none |
| `ea0877fd-b879-4d13-a6d5-460cc6cd6332` | NULL (anonymous) | NULL | caregiver_screening | in_progress | 2026-10-01 21:17:53 | 0 | 0 | none |

They belong to no user, agency or registration: they are the page-load writes from the Oct 1 capture
of `/caregiver-registration` (desktop and mobile). Foreign keys referencing them:
`conversation_answers` (ON DELETE CASCADE, 0 rows) and `care_requests` (SET NULL, 0 rows).

```sql
-- E7 (approved data statement)
DELETE FROM public.conversation_sessions s
WHERE s.id IN ('36757fa8-44e5-4dd0-aae8-760bf6907688','ea0877fd-b879-4d13-a6d5-460cc6cd6332')
  AND s.user_id IS NULL AND s.registration_id IS NULL AND s.completed_at IS NULL AND s.submitted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.conversation_answers a WHERE a.session_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM public.care_requests c WHERE c.session_id = s.id);
-- expect: DELETE 2.  Verify: SELECT count(*) FROM conversation_sessions WHERE id IN (...) = 0.
```

### 16.3 Write-on-load fix (drafted in the working tree; not committed, not run)
`src/hooks/useConversationFlow.ts` (the one hook every caller uses):
- **No `conversation_sessions` insert on mount.** The row is created by `ensureSession()` on the first
  answer, for every caller (`ChatWidget` on `/caregiver-registration`, `ConversationSurface` on
  `/a/:slug/apply` / `/` / `/assistant`, `FamilyIntakeSurface`).
- **Single-flight `ensureSession`:** the in-flight promise is kept in a ref, so a double-tap or
  multi-select Continue creates one row, not two. It is cleared on error so the next answer retries.
- **The deferred insert now includes `current_node_id`** (parity with the old mount insert).
- **`back`, `rewindTo`, `complete` and `linkRegistration` read `sessionRef`,** not possibly stale
  `sessionId`/`sessionToken` state.
- `options.deferSession` is still accepted (now always the behaviour).
- `tsc`: no new errors. eslint: no new errors or warnings.

**Test** `sec_tests_wol.cjs` (Chromium + dev server):
- **W1–W3:** loading `/caregiver-registration`, `/a/ripple-effects/apply` and `/assistant` makes 0
  POSTs to `conversation_sessions`.
- **W4:** the first answer makes exactly 1.
- **W5:** a double-tap on the first answer still makes ≤ 1.
- It deletes exactly the rows it created (ids taken from its own POST bodies) and re-queries.
- **Not run yet:** even the "before" half writes rows today, which is the bug itself.

## 17. Results — Issue 2 / M-SEC-6, E5, E7, write-on-load, done-tests (2026-10-04)

### 17.1 M-SEC-6 + Issue 2
- **Pre-check (read-only):** 0 `events` rows outside the 18-value list (present types: 4, all in it).
- **Migration:** drop + add are one `ALTER TABLE` statement (atomic on its own). Pushed as the only
  pending migration; the live constraint has 18 values and is validated.
- **Commit `2756b25`**, built from the staged tree alone in a `git worktree`:
  - vite build ok; tsc has only the pre-existing errors in untouched files;
  - no new lint errors (3 new `any` casts replaced by `AccountLinkResponse`);
  - `deno check` clean ×5.
- **Deployed:** create-user v15, admin-reset-password v14, enable-client-login v13,
  enable-caregiver-login v6, approve-caregiver-registration v13; all `verify_jwt=true`.
- **After-tests (`sec_tests_modeb.cjs after`):**
  - P1, P2, P3, P4b, P5, R1, R2, O1, O2, O3, O4, O4b: CLOSED;
  - P1L, P4, P6, AU: WORKS (5 audit events, no link or token stored);
  - teardown verified.
- **PW:** the server accepts 6 and 7 characters. Owner action logged in known-issues (minimum 8 +
  leaked-password protection).
- **S8: PASS.**
  - The reset email reached the owner's team address, and its link pointed to
    `http://localhost:8080/auth/set-password` (owner confirmed, 2026-10-04).
  - The disposable account `2aaeb094-788d-4030-95c0-91202b53176a` was deleted. Re-query: 0 in
    `auth.users`, `auth.identities`, `auth.one_time_tokens` (recovery token), `auth.sessions`,
    `profiles` and `user_roles`.
- **Branch pushed** after the after-tests.

### 17.2 E5
- **(a) Read-only search:** the 4 values were held in memory only and never printed. 235 text/json
  columns in 42 public tables were scanned. The only hits were `pending_notifications.body` and
  `.payload`, in exactly the 4 known rows, so the scope was unchanged.
- **Redaction:** one `DO` block that raises unless the count is exactly 4 (run via
  `supabase db query --linked`). It updated 4 rows. Re-query: 0 rows in the table still hold a
  password.
- **Forced reset:** each account's email was checked against the approved list first, then
  `updateUserById` set a 32-byte random password (discarded) on each: 4/4.
  - **Deviation:** the old values were removed by the redaction before the sign-in check, so "old
    password fails" was proven by the stored hash instead. All 4 `encrypted_password` fingerprints
    changed.
- **Session revocation:** one `DO` block with exact expected counts read just before it: 0 sessions,
  0 live refresh tokens. Re-query: 0 / 0 for all 4.

### 17.3 E7
One `DO` block (raises unless exactly 2) with every guard from §16.2. Re-query: 0 rows.

### 17.4 Write-on-load
- **Commit `72b6d3c`** (the hook alone).
- **`sec_tests_wol.cjs after`:** W1–W3 0 POSTs on load; W4 exactly 1; W5 (double-tap) exactly 1.
- **Rows created by the test:** `bd202cd9-0af8-4e9f-8acc-cf3c1ab01085` and
  `0e35bd6a-0549-4f4e-a41f-7237f626431d`, both deleted. Re-query: none.

### 17.5 Done-tests 1–9 (§4)
| # | Covered by | Result |
|---|---|---|
| 1 | `sec_tests_1` 1.1–1.8, 3.1–3.8, S1, S2, S4 | PASS (all CLOSED / WORKS) |
| 2 | `sec_tests_1` 2.1–2.4, K1, K2, 3.9; `sec_tests_0` 0a–0g | PASS |
| 3 | `sec_tests_0` (self-update scope freezes) + smoke S1–S3 | PASS |
| 4 | `sec_tests_1` S1–S5, R1; `browser_pass` B5, B6 | PASS. Today/Schedule are the separate caregiver-app-shell WIP, not in these commits |
| 5 | `sec_tests_1` S7, S8; UI U6, U13, sidebars U14 | PASS |
| 6 | `sec_tests_ui` U1–U13 | PASS |
| 7 | `sec_tests_modeb` (§17.1) + E5 count 0 + S8 | PASS |
| 8 | `sec_tests_wol` W1–W5 | PASS |
| 9 | Every suite's teardown re-query | PASS |

- **`browser_pass` B4** (client booking picker) **FAIL, expected:** the pre-existing, logged
  category filter makes step 1 empty. It is not a regression.
- **First run of the four suites stopped at the 600 s tool limit** during `sec_tests_ui`.
  - Its 9 users, 2 caregivers and 2 clients were found by run tag, deleted and verified gone.
  - The suite was then re-run to completion: all pass, teardown verified.

## 13. RequireRole step — task list (accumulated)
1. `RequireRole` wrapper plus `src/lib/roleHome.ts` (shared with `Auth.tsx`). Wrap every
   STAFF/ADMIN/SYSTEM_ADMIN route from §1.1, **including `/schedule`** (owner, Oct 1). A NULL role is
   denied.
2. **Hide the Delete-user button for manager** (owner, Oct 4). `admin-delete-user` now refuses
   managers (§10.4), so the button must not be shown to them. Places:
   - `Users.tsx` (row Delete);
   - `AdminUserManagement.tsx` ("Delete User" tab);
   - the Delete actions in `Caregivers.tsx` / `Clients.tsx` if they call `admin-delete-user`
     (check at implementation).

   Show it only for agency_admin / system_admin. Peer-admin rows should also hide Reset/Delete for
   agency_admin (target ranks are not below), so users don't click into a 403.
3. Caregiver/client/session-only routes stay unwrapped (§1.2).

# Caregiver Web App — Design Pass

**Status:** DESIGN ONLY — no code/schema changes made in this pass. For review before any build work starts.
**Scope:** the caregiver-facing surfaces only (`/caregiver-dashboard`, `/available-shifts`, `/caregiver-time-off`, `/caregiver-settings`, plus the shared `ShiftDetailsDialog`). Manager/Schedule Management tooling is out of scope and untouched — see CLAUDE.md's Smart Scheduling exclusion.
**Companion artifact:** phone-frame mockups of the key screens (see chat for the published link) — this document is the full reasoning; the artifact is the visual.

---

## 1. Audit — what exists today for a caregiver login

| Route | Layout shell | Caregiver-appropriate? | Mobile-usable? | Verdict |
|---|---|---|---|---|
| `/caregiver-dashboard` | `AppLayout` (manager's 256px desktop sidebar + hamburger) | Mostly — content is scoped to "my" data, but it's the **only** caregiver surface still wrapped in the manager chrome | Sidebar collapses behind a hamburger on mobile, but the page itself is built desktop-first: 3-column stat grid, 5-tab `TabsList` that has to squeeze `grid-cols-5` onto a phone, dense multi-column shift cards | **Leaked manager view** — right data, wrong shell |
| `/available-shifts` | `AppLayout` | Yes — this is the just-shipped two-section (Trade/Open) board, genuinely caregiver-scoped and already RLS/PHI-correct | Card layout adapts (`grid-cols-2 md:grid-cols-4` etc. collapse to 2 columns on phone, still cramped for a one-handed thumb reach), search+date filter are two full-width desktop inputs stacked, not a mobile filter pattern | **Good bones, needs mobile polish** — the newest, most caregiver-native surface in the app |
| `/caregiver-time-off` | **No shared layout at all** — its own bespoke header with a manual "Back to Dashboard" button | Yes, content-wise | Reasonably mobile-usable already (single column, `Dialog`-based form) but inconsistent — no bottom nav, no way back except that one button, doesn't feel like the same app as the dashboard | **Coherent screen, disconnected from the app shell** |
| `/caregiver-settings` | Also **no shared layout** — its own bespoke header + back button | Content in `CaregiverProfileSettings` is genuinely "my profile" (location, skills, availability, password) — no leaked manager fields | Long, ungrouped stack of 6 full cards (Personal Info → Location → Skills → Availability → Password) — a lot of vertical scroll and typing for a phone | **Right content, needs mobile restructuring (progressive disclosure)** |
| `ShiftDetailsDialog` (shared) | Modal, used by both manager and caregiver flows | Structurally safe already: it only renders `client.care_requirements`/notes if present on the object it's handed, and the caregiver-safe fetch path (`get_caregiver_visible_clients` → name/address/phone only) never attaches those fields — so PHI can't leak through this dialog on the caregiver path even though the component itself doesn't know who's viewing it | A centered desktop modal (`max-w-2xl`) on a phone is a full-screen-feeling dialog already, works, but isn't a bottom-sheet | **Reusable, needs mobile presentation, not new PHI logic** |

**Honest summary:** the *data layer* underneath the caregiver experience is in good shape — Phase 1B's eligibility engine, the office-scoped RLS, and `get_caregiver_visible_clients()`'s narrow non-PHI columns are all real, tested, and correct (see `[[smart_scheduling_progress]]`). The problem is entirely in the **presentation layer**: three different page shells (`AppLayout` sidebar / bespoke-header-with-back-button / bespoke-header-with-back-button, twice, slightly differently), a 5-tab bar that was clearly designed for desktop first, and profile settings built as one long form rather than a mobile-appropriate set of sections. There is no bottom tab bar anywhere in the codebase (`grep` for nav/layout components found only `AppLayout`, the shadcn `sidebar.tsx` primitive, and chat's `NavControls` — nothing caregiver-specific).

---

## 2. Caregiver needs → surface mapping

| Need | Exists today? | Where | Gap |
|---|---|---|---|
| See MY schedule (upcoming + past) | Yes | `CaregiverDashboard`'s "My Schedule" tab + Overview's Upcoming/Week/History tabs | Redundant — the same data is sliced two different ways in two different tabs of the same page. Needs one agenda view. |
| Find + pick up available shifts | Yes, well-built | `AvailableShifts` (Trade Shifts / Open Shifts, self-consent pickup) | Just needs mobile layout pass — the mechanism is done, see `[[smart_scheduling_progress]]`. |
| Request + track MY time off | Yes | `CaregiverTimeOff` | Needs to join the app shell (bottom nav) instead of standing alone. |
| View/manage MY profile | Yes | `CaregiverSettings` / `CaregiverProfileSettings` | Needs progressive disclosure for mobile; content itself is correct and already caregiver-scoped. |
| Know today's earnings/hours at a glance | Yes, but only inside a tab | `CaregiverDashboard` Overview stat cards | Should be the *default* glanceable view (a real field caregiver checks this first thing), not one of five equal tabs. |
| **MY visit — check-in/out + task checklist at the client** (EVV-style) | **No home at all** | — | Flagged explicitly by the brief as a real home-care/Medicaid billing pattern. Nothing today captures visit start/end or on-site tasks. **Not building now — see §4 — but the nav and data model below deliberately leave room for it.** |
| Give up (not just trade-accept) a shift I'm assigned | **No caregiver-facing UI** | Only staff-side automation creates `shift_trades` rows today (logged in `[[smart_scheduling_progress]]`) | Real gap, but out of scope for this pass — flagged for Phase 2 of Smart Scheduling, not this redesign. |

The EVV/visit-verification gap is the one genuinely **missing** surface; everything else exists and needs consolidation + mobile treatment, not invention.

---

## 3. Mobile-first design

### 3.1 Navigation model: bottom tab bar

Replace `AppLayout`'s desktop sidebar **for the caregiver role only** with a persistent bottom tab bar — the standard field-mobile-app pattern, thumb-reachable, always visible (no hamburger to discover). Four tabs, deliberately narrower than the manager's module list because a caregiver's world is "my" four things:

```
┌─────────────────────────────┐
│                              │
│         (screen content)    │
│                              │
├─────────────────────────────┤
│  🏠      📅      💼      👤  │
│ Today  Schedule Shifts Profile│
└─────────────────────────────┘
```

- **Today** — the glanceable landing screen (replaces the "Overview" tab as the default, not as an equal tab among five).
- **Schedule** — the full agenda (today's dashboard stat cards feed from the same data, but "Schedule" is the browse view).
- **Shifts** — the existing Available Shifts board (Trade + Open), unchanged mechanism.
- **Profile** — settings, time off, and account, consolidated (see §3.5) rather than Time Off getting its own top-level tab — it's a secondary action, not a daily-use surface, so it lives one level down inside Profile as a card, matching how often a caregiver actually touches it.

This is a **desktop-vs-mobile shell split**, not a rewrite: `AppLayout` keeps serving managers/admins exactly as-is (CLAUDE.md's Smart Scheduling/scheduling-preservation rule applies equally to "don't refactor working manager UI to build this"). A caregiver simply never mounts `AppLayout`; a new `CaregiverAppShell` (bottom tab bar, no sidebar, single-column) wraps the four caregiver routes instead.

### 3.2 "Today" — the new default landing screen

Today's `CaregiverDashboard` "Overview" tab tries to be a dashboard, a stat board, *and* a shift browser all at once. Split it:

```
┌─────────────────────────────┐
│  Good morning, Alicia        │
│  ─────────────────────────   │
│  ┌───────────┐ ┌───────────┐ │
│  │ 6.5h today│ │ 32/35h wk │ │
│  └───────────┘ └───────────┘ │
│                              │
│  TODAY                      │
│  ┌─────────────────────────┐ │
│  │ 🟢 In progress           │ │
│  │ 9:00–1:00  ·  Dorothy M. │ │
│  │ Personal Care            │ │
│  │ 412 Oak St, Kalamazoo    │ │
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │ ⏱ Upcoming               │ │
│  │ 3:00–7:00  ·  James R.   │ │
│  │ Companionship            │ │
│  └─────────────────────────┘ │
│                              │
│  💼 3 new shifts available  →│
└─────────────────────────────┘
```

One stat row (hours today / hours this week — earnings can be a tap-through, not always-on, since not every caregiver wants pay visible at a glance on a shared/family device), then *today's* shifts as the hero content, then a single lightweight nudge into Available Shifts (badge-style, not a whole card) rather than a full "Quick Actions" grid of three duplicate-navigation cards. This removes the 5-tab `TabsList`, the `overview`/`schedule` split, and the redundant Quick-Actions cards in the current `CaregiverDashboard` — one glanceable screen, no internal tabs.

### 3.3 Schedule — agenda, not a 3-way tab split

Today's Upcoming/This-Week/History tabs are really one continuous timeline. Mobile-first, that's a single scrollable **agenda list grouped by day**, with a lightweight segmented filter (not three separate data fetches):

```
┌─────────────────────────────┐
│  My Schedule        [Past ▾]│
│  ─────────────────────────   │
│  TODAY · Mon Sep 15          │
│  ┌─────────────────────────┐ │
│  │ 9:00–1:00 · Dorothy M.   │ │
│  └─────────────────────────┘ │
│                              │
│  TOMORROW · Tue Sep 16       │
│  ┌─────────────────────────┐ │
│  │ 2:00–6:00 · James R.     │ │
│  └─────────────────────────┘ │
│                              │
│  THU SEP 18                  │
│  ┌─────────────────────────┐ │
│  │ 9:00–1:00 · Dorothy M.   │ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

`[Past ▾]` toggles the same list into history mode instead of a separate tab — one query, one rendering path, one `ShiftList`-style card component reused.

### 3.4 The shift card — what a caregiver needs at a glance

One card design, reused across Today / Schedule / Available Shifts (the last already proved this pattern in the recent redesign). At-a-glance fields, top to bottom, biggest-to-smallest:

```
┌───────────────────────────────┐
│ 🟢 In progress      Personal  │  ← status chip (left) + care type (right)
│ 9:00 AM – 1:00 PM   (4h)       │  ← time, duration
│ Dorothy M.                     │  ← client first name + last initial (no PHI)
│ 📍 412 Oak St, Kalamazoo       │  ← address, only what get_caregiver_visible_clients returns
└───────────────────────────────┘
```

No client phone number until the shift is actually the caregiver's own (this rule already exists in `ShiftDetailsDialog` — `client.phone && !isOpenShift` — and must be preserved, not just visually reproduced). Tapping a card opens the existing `ShiftDetailsDialog`, presented as a bottom sheet on mobile widths rather than a centered modal (a CSS/breakpoint change to the existing `Dialog`, not new data logic).

### 3.5 Available Shifts on mobile

Keep the two-section Trade/Open structure exactly as built — it's correct and deliberately not merged (see `[[smart_scheduling_progress]]` on why a merged design was rejected). Mobile adaptation is layout-only:
- Search + date filter collapse into a single filter **pill/bottom-sheet** ("Filters ⚙") instead of two always-visible full-width inputs eating vertical space above the fold.
- Section headers (`Trade Shifts` / `Open Shifts`) become sticky mini-headers so a caregiver scrolling a long list always knows which section they're in.
- Cards go full single-column (already effectively true, just remove the `md:grid-cols-*` assumptions that don't apply below `md`).
- "My Trade Requests" moves to a badge/counter on the Shifts tab icon rather than always-rendered at the bottom of a long scroll — it's status information, not a browsing surface.

### 3.6 Time Off — inside Profile, not a top-level tab

```
┌─────────────────────────────┐
│  ← Profile                  │
│  Time Off              [+]  │
│  ─────────────────────────   │
│  Vacation                   │
│  Sep 20 – Sep 22   [Pending] │
│                              │
│  Sick Leave                  │
│  Aug 3 – Aug 3    [Approved] │
└─────────────────────────────┘
```

Same data and same request flow as today's `CaregiverTimeOff`, just reached via Profile instead of standing alone with a manual "Back to Dashboard" button. The `[+]` opens the existing form, presented as a bottom sheet.

### 3.7 Profile — progressive disclosure, not one long scroll

Today's `CaregiverProfileSettings` renders five full `Card`s stacked (Personal Info, Location, Skills, Availability, Password) all expanded at once — a lot of scroll and, in edit mode, a lot of typing exposed all at once. Mobile-first version: a list of tappable rows, each opening its own focused screen/sheet:

```
┌─────────────────────────────┐
│  Alicia Ramirez               │
│  ⭐ 4.8 · Personal Care       │
│  ─────────────────────────   │
│  👤 Personal Info          › │
│  📍 Service Area           › │
│  🛠  Skills & Certifications › │
│  🕐 Availability           › │
│  🏖  Time Off               › │
│  🔒 Password & Security    › │
│  ─────────────────────────   │
│  Sign Out                    │
└─────────────────────────────┘
```

Each `›` row opens exactly the existing form (Personal Info fields, the zip-code picker, skills list, `AvailabilityDialog`, password change) full-screen on mobile — no new fields, no new logic, just one focused task per screen instead of five competing for attention on one page.

### 3.8 Future, not built: My Visit (EVV-style check-in)

Flagging where this *will* go without building it, per the brief. Home-care EVV (Electronic Visit Verification) is a real, common Medicaid-billing requirement (verify caregiver, client, service type, and clock-in/out location and time) — CareMuch doesn't have a client-facing "visit" concept yet (`shift_assignments` has `clock_in_time`/`clock_out_time` columns already, per `CaregiverDashboard`'s `Assignment` interface, but no UI writes to them and no task-checklist model exists).

Room left for it in this design:
- The shift card's status chip (`🟢 In progress` / `⏱ Upcoming` / `✓ Completed`) is exactly the state machine a check-in flow would drive — today it's computed client-side from the current time; a future visit feature would replace that computation with real `clock_in_time`/`clock_out_time` writes plus a task checklist, without changing the card's visual contract.
- A "Today" screen showing one prioritized current/next shift is the natural landing spot for a "Check In" primary action — the layout in §3.2 has a clear slot (inside the current shift's card) for that button to appear later.
- No schema, RLS, or route work for this is proposed now — it needs its own PHI/data-flow review (task checklists likely *do* need to reference `care_requirements`, which is currently structurally excluded from every caregiver-visible path) and is explicitly a future phase, not part of this build.

---

## 4. Recommended scope and phased plan

| Surface | Recommendation | Why |
|---|---|---|
| App shell / navigation | **Build new** — `CaregiverAppShell` with bottom tab bar | Nothing like it exists; this is the structural fix that makes every other surface coherent. Manager `AppLayout` is untouched. |
| Today (dashboard landing) | **Rebuild** from `CaregiverDashboard`'s Overview tab | Same data, new glanceable single-purpose layout; removes the 5-tab bar and duplicate Quick Actions. |
| Schedule (agenda) | **Rebuild** from `CaregiverDashboard`'s Schedule tab + Upcoming/Week/History tabs | Collapsing three tabs into one agenda list is a real restructure, even though the underlying query is the same shape. |
| Available Shifts | **Polish** | Mechanism, RLS, and eligibility logic are correct and recent — only the layout/filter presentation needs a mobile pass. |
| Time Off | **Polish + relocate** | Content and form are fine; move it under Profile and drop the standalone header/back-button pattern. |
| Profile & Settings | **Rebuild** the shell (progressive disclosure), **reuse** every field/form inside it | No new data; restructuring five stacked cards into a navigable list of focused screens. |
| `ShiftDetailsDialog` | **Polish** (bottom-sheet presentation on mobile) | Already PHI-safe by construction; don't touch its data logic. |
| My Visit / EVV check-in | **Build new — future phase, not now** | Genuinely missing, but needs its own PHI-boundary review before any schema/RLS work; this pass only reserves the UI slot. |

### Phased build plan

1. **Phase A — shell + Today.** Build `CaregiverAppShell` (bottom tab bar), wire it in for the caregiver role only, rebuild the Today screen. This alone fixes the biggest "leaked manager view" problem and gives every subsequent screen somewhere coherent to live.
2. **Phase B — Schedule agenda.** Collapse the three schedule tabs into the single grouped agenda list; retire the duplicate Upcoming/Week/History queries in favor of one date-filtered fetch.
3. **Phase C — Available Shifts mobile polish + bottom-sheet dialog.** Lowest-risk phase — no logic changes, layout/breakpoint work only, on the newest and best-tested caregiver surface.
4. **Phase D — Profile restructure + Time Off relocation.** Split `CaregiverProfileSettings` into focused sub-screens; move Time Off under Profile; retire the two standalone bespoke-header pages.
5. **(Separate future phase, not scheduled here) — My Visit / EVV check-in.** Requires its own PHI/data-flow decision (task checklists touching `care_requirements`) before any schema work — do not start this opportunistically inside Phase A–D.

Each phase preserves all existing scheduling functionality exactly as CLAUDE.md requires (shift pickup, trades, eligibility, time-off approval) — this pass only changes how caregivers *see and navigate to* that functionality, never the underlying tables, RPCs, or RLS policies.

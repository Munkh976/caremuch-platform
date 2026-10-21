# Ripple demo office (DEV, persistent)

Owner-approved data write (Oct 6, 2026). Its own agency, **"Ripple Effects – Demo Agency"** (owner decision (b), Oct 6),
with one office, **"Ripple Effects – Demo"**, created only by these scripts — so agency-wide screens of the demo users
show only demo data and the shared DEV demo agency used by the test suites is untouched. The agency table has no
`is_demo` column (not added); the agency is found by its exact name and every row inside it is `is_demo = true`. The
agency gets the module's agency-level setup from the existing seed RPC (`seed_office_care_plan_defaults`: the default
credential catalog and office service types); the measure library, care types and menu permissions are global. All people, goals and objectives are
fictional and were written for this demo; nothing comes from Ripple's documents.

| Command | What it does |
|---|---|
| `node tests/ripple/demo/seed-demo.cjs` | Dry run (read-only): the plan and what exists now. |
| `node tests/ripple/demo/seed-demo.cjs --apply` | Creates the demo (refuses if it exists). |
| `node tests/ripple/demo/seed-demo.cjs --reset [--as-of YYYY-MM-DD]` | Removes the demo (count-checked transaction) and seeds it again for that demo day (default today): **run after every demo**. |
| `node tests/ripple/demo/verify-demo.cjs [--as-of YYYY-MM-DD]` | Read-only: every deliberate state, exact counts (overdue = 2, to review = 1, ...). |
| `node tests/ripple/demo/inventory-demo.cjs [--as-of YYYY-MM-DD]` | Read-only: counts and status breakdown per area. |
| `node tests/ripple/demo/rehearse.cjs [--as-of D] [--final-as-of D2]` | Seeds, runs the playbook through the UI (screenshots in `docs/screenshots/ripple-ui/demo/playbook/`), resets to D2. |
| `node tests/ripple/demo/login-check.cjs` | One login per role with `RIPPLE_DEMO_PASSWORD`: sign in, read one page's data, sign out; prints only "login ok". |
| `node tests/ripple/demo/teardown-demo.cjs [--apply]` | Dry run lists only demo rows; `--apply` deletes them (the agency, its credential catalog and everything in it) in one count-checked transaction, then the demo users. |
| `node tests/ripple/ui/demo-capture.cjs` | Read-only screenshots into `docs/screenshots/ripple-ui/demo/` (then run `--reset`). |

**Tag (never shown on screen):** office code `RPLDEMO`; login e-mails `<first>.<last>.rpldemo@example.com`. Caregiver
rows carry a plain fictional e-mail (shown on the caregiver profile). Test run tags (`ui3-…`, `ui-s9-…`, `phase-…`,
`done-…`, `sec-*@caremuch-sectest.test`) never match it.

**Passwords:** the scripts read `RIPPLE_DEMO_PASSWORD` (set by the owner as a user environment variable; a shell started
before it was set needs `$env:RIPPLE_DEMO_PASSWORD = [Environment]::GetEnvironmentVariable('RIPPLE_DEMO_PASSWORD','User')`)
and never print, log or write it. If it is not
set, the users are created and then left with a random password nobody knows; set the variable and run `--reset` to log in.

## Users

| Name | Role | Login e-mail |
|---|---|---|
| Pat Morgan | manager (program lead), demo office only | `pat.morgan.rpldemo@example.com` |
| Sam Rivera | agency admin | `sam.rivera.rpldemo@example.com` |
| Jordan Lee | HR (hr_staff) | `jordan.lee.rpldemo@example.com` |
| Casey Park | scheduler | `casey.park.rpldemo@example.com` |
| Ana Brooks, Ben Carter, Mia Lopez, Leo Grant, Ivy Chen | caregivers | `ana.brooks.rpldemo@example.com`, … |

## Scenario (Oct 19 rebuild for the Oct 20 demo; dates relative to `--as-of`, billing week Sunday–Saturday)

Every state is deliberate; `verify-demo.cjs --as-of <day>` checks each one with exact counts, and
`inventory-demo.cjs` prints the counts. Playbook: `docs/demo/playbook.md`; rehearsal: `rehearse.cjs`.

- **Setup:** module on (go-live 4 weeks back), enforcement **off**; office shells: IPOS, CLS note, respite note, 7 intake
  documents; the default credential catalog.
- **Clients:** Zoe Nguyen (DEMO-1001) onboarded, IPOS v1 superseded + **v2** active after a renewal; authorization A
  (90 units, expires 12 days after the demo day: **units at risk**) and B (400 units, cap 16 / week, healthy). Max Ortiz
  (DEMO-1002) respite. Lily Park (DEMO-1003) onboarding **5 of 8**, no visits. Background, fully green: Noah Kim
  (DEMO-1004, CLS, the group sessions with Zoe) and Ella Shaw (DEMO-1005, respite).
- **Caregivers:** Ana all green, trained on Zoe v2. Ben one red (20 days) and one yellow (45 days), trained on v2. Mia
  one **★ overdue** and **not** retrained on v2 (her Zoe visit next Wednesday needs retraining). Background: Leo Grant,
  Ivy Chen, all green.
- **The week before:** every visit has a reviewed note; main bill built, approved, **billed** (locked).
- **Last week:** reviewed notes (Tue 09:20 late arrival bills 2 of 4; Thu 09:50 departure bills 3 of 4; a CLS group
  session 1:2 Zoe + Noah on Wednesday), plus exactly: **1 submitted** (Mia, Wednesday), **1 returned** (Ben, Friday:
  overdue), **1 visit with no note** (Ana, Max respite Thursday: overdue). Not built.
- **This week:** visits before the demo day have reviewed notes; on the demo day only **Ana's Zoe CLS visit 08:00–09:00,
  no note** (written live). Overdue = exactly 2.
- **Next two weeks:** visits assigned, except **Zoe next Thursday (unassigned)**; a CLS group session 1:2 next Tuesday
  (Ana: Zoe + Noah).
- **Guards:** `--as-of` can't be earlier than today; every visit that gets a note must already be over; no seeding after
  8 pm office time.

Counts after `--reset --as-of 2026-10-20` (seeded Oct 19): events 313, shift_assignments 49, progress_notes 22,
billing_batches 1, plan_training_records 11, plan_training_forms 5, plan_inservice_forms 5, client_documents 35,
service_authorizations 6, care_plans 6, caregiver_certifications 100, caregiver_skills 10, shifts 50, group_sessions 2,
form_templates 10, office_service_types 2, clients 5, caregivers 5, user_roles 9, profiles 9, virtual_office 1,
credential_types 22, agency 1 (679 rows) + 9 auth users.

**Other menus (S14, Oct 21):** so those screens aren't empty, the seed also adds (fictitious, demo agency only, dates
after the seeded schedule so eligibility is unchanged):
- Client Inquiries: 3 families with an inquiry each (2 new, 1 reviewing);
- Caregiver Applications: 3 pending registrations;
- Time Off Requests: Ben (vacation, pending), Ivy (medical, pending), Leo (personal, approved);
- Shift Trades: Leo offers next Tuesday's Noah visit on the Trade Board (Ana sees it); Ivy asks for coverage of an Ella
  visit (manager approval);
- Notification Outbox: 3 messages, 1 marked sent.

`verify-demo` checks each screen (M1–M5); the reset removes them like everything else (17 rows + their events). Training
sessions carry the trainer "Pat Morgan" and a signature date (the S15 Training tab shows them).

## Effects on the regular suites

- None: the demo lives in its own agency. Rounds 1–9, NB1 and the orphan scans pass with the demo present (Oct 6).
- Mia's overdue credential also triggers the **existing** "Expired certification" rule, which blocks her for any later
  shift whatever the compliance switch (unchanged scheduling rule).

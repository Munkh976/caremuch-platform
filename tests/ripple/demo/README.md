# Ripple demo office (DEV, persistent)

Owner-approved data write (Oct 6, 2026). One office, **"Ripple Effects – Demo"**, in the existing DEV demo agency
(`56fbfe38…`), created only by these scripts. Every row is `is_demo = true`. All people, goals and objectives are
fictional and were written for this demo; nothing comes from Ripple's documents.

| Command | What it does |
|---|---|
| `node tests/ripple/demo/seed-demo.cjs` | Dry run (read-only): the plan and what exists now. |
| `node tests/ripple/demo/seed-demo.cjs --apply` | Creates the demo (refuses if it exists). |
| `node tests/ripple/demo/seed-demo.cjs --reset` | Removes the demo (count-checked transaction) and seeds it again: **run after every demo**. |
| `node tests/ripple/demo/verify-demo.cjs` | Read-only: every flow has its data (dashboard panels, Notes to Review, Weekly Billing preview). |
| `node tests/ripple/demo/teardown-demo.cjs [--apply]` | Dry run lists only demo rows; `--apply` deletes them in one count-checked transaction, then the demo users. |
| `node tests/ripple/ui/demo-capture.cjs` | Read-only screenshots into `docs/screenshots/ripple-ui/demo/` (then run `--reset`). |

**Tag (never shown on screen):** office code `RPLDEMO`; login e-mails `<first>.<last>.rpldemo@example.com`. Caregiver
rows carry a plain fictional e-mail (shown on the caregiver profile). Test run tags (`ui3-…`, `ui-s9-…`, `phase-…`,
`done-…`, `sec-*@caremuch-sectest.test`) never match it.

**Passwords:** the scripts read `RIPPLE_DEMO_PASSWORD` (set by the owner) and never print, log or write it. If it is not
set, the users are created and then left with a random password nobody knows; set the variable and run `--reset` to log in.

## Users

| Name | Role | Login e-mail |
|---|---|---|
| Pat Morgan | manager (program lead), demo office only | `pat.morgan.rpldemo@example.com` |
| Sam Rivera | agency admin | `sam.rivera.rpldemo@example.com` |
| Jordan Lee | HR (hr_staff) | `jordan.lee.rpldemo@example.com` |
| Casey Park | scheduler | `casey.park.rpldemo@example.com` |
| Ana Brooks, Ben Carter, Mia Lopez | caregivers | `ana.brooks.rpldemo@example.com`, … |

## Scenario (dates relative to the DB clock; office week Monday–Sunday)

- **Setup:** module on (go-live 4 weeks back), enforcement **off**; office shells: IPOS, CLS note, respite note, 7 intake
  documents; the default credential catalog.
- **Clients:** Zoe Nguyen (DEMO-1001) onboarded, IPOS **v2** after a renewal; 3 goals, data questions with 7 of the 8
  measure types; two CLS authorizations (A: 20 units, expires in ~3 weeks; B: 400 units, cap 16 / week) so FIFO shows.
  Max Ortiz (DEMO-1002) onboarded, respite only. Lily Park (DEMO-1003) onboarding **5 of 8** (in-service, training and
  note set-up missing).
- **Caregivers:** Ana all credentials current, retrained on Zoe v2. Ben one credential ≤ 60 days (yellow) and one
  ≤ 30 days (red), retrained. Mia one credential **★ overdue**, **not** retrained on Zoe v2 (her next Zoe visit is
  scheduled, so she needs retraining).
- **Week before last:** 4 notes reviewed, the main bill built, approved and **billed**.
- **Last week:** reviewed notes (one **late arrival**, 1 unit lost) + one **Submitted**, one **Returned** with a reason,
  one visit with **no note** (overdue); the bill is **not built** (build it live).
- **This week / next two weeks:** a draft note today (Ana, if seeded after 07:00 office time), upcoming visits for Zoe
  and Max, one Zoe visit left **unassigned** (next Thursday, live assign), and a **CLS group session 1:2** next Tuesday
  with Zoe and Lily (Max is respite only, so Lily is the second CLS client).

Counts after `--apply` / `--reset` (identical on two consecutive resets): events 187, shift_assignments 27,
progress_notes 11, billing_batches 1, plan_training_records 7, plan_training_forms 3, plan_inservice_forms 3,
client_documents 21, service_authorizations 4, care_plans 4, caregiver_certifications 60, caregiver_skills 6, shifts 28,
group_sessions 1, form_templates 10, office_service_types 2, clients 3, caregivers 3, user_roles 7, profiles 7,
virtual_office 1 (396 rows) + 7 auth users.

## Known effects on the regular suites

- `ui/round1.cjs` compares existing pages' text (Dashboard, Schedule, Clients, Caregivers) for an agency-wide admin with
  a saved baseline; the demo office's rows are agency-visible, so those comparisons differ while the demo exists
  (known-issues). Rounds 2–9 and the orphan scans are unaffected.
- Mia's overdue credential also triggers the **existing** "Expired certification" rule, which blocks her for any later
  shift whatever the compliance switch (unchanged scheduling rule).

# Ripple care-plan module — backend test suites

Tests for the Ripple care-plan backend (Phase A schema, B1/B2 RPCs, C eligibility and units).
Two kinds:

- **`pglite/`**: local only, no network. It applies the real migrations from
  `supabase/migrations/` to an in-memory Postgres 18 (PGlite). The database starts from small stubs
  of the live objects they reference, plus verbatim snapshots of the live scheduling functions.
  Safe to run any time.
- **`dev/`**: runs against the **linked Supabase project (DEV)** with real logins through PostgREST.
  Every run creates its own disposable agency, offices, users and rows, tagged with a run id. It
  deletes them at the end and re-queries to prove nothing is left.
  **DEV runs need the owner's approval before each run**, because they write fixtures to a shared
  database.

## Setup

```sh
npm install --prefix tests/ripple/pglite      # PGlite (its own package.json; the app's is untouched)
```

The DEV suites use the app's own dependencies (`@supabase/supabase-js`, `pg`). They read their
configuration the same way the app does: `process.env` first, then `.env` / `.env.local` at the
repo root.

| Variable | Used for |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` | the app's public config |
| `SUPABASE_SERVICE_ROLE_KEY` (optional) | fixture setup and teardown. If unset, it is fetched in memory with `npx supabase projects api-keys` (needs a linked, logged-in CLI). Never printed or written. |
| `SUPABASE_DB_PASSWORD` | **read-only** checks only: catalog, ACLs, DB clock, counts. Every connection runs `SET default_transaction_read_only = on`. Never printed or written. |
| `RIPPLE_TEST_AGENCY_ID` (optional) | the DEV demo agency the fixtures attach to (default: the seeded demo agency) |

**Rule: all times come from the database clock.** Every "now", deadline and date window is read
from the database (`dbNow`, `dbDay`), never from this machine's clock. Each run prints the measured
skew.

## Commands (one per suite)

### Local (PGlite)

| Command | Proves |
|---|---|
| `node tests/ripple/pglite/phase-a.cjs` | Phase A schema. Role-tiered read policies on all 26 tables. Non-staff and staff direct writes are refused. The derived-units cycle, including the 5-minute late boundary. One note per shift. Row scope, the admin-only office flags, ACLs, table grants, the reference seed. |
| `node tests/ripple/pglite/phase-b1.cjs` | B1 write RPCs. Module enable and defaults. Template drafts, publish and upgrade (published versions immutable; spine columns required). Care plan, goals and measures. Authorization, documents, credentials, in-service and training (training_version rules). Role and scope denials for every RPC. Exactly one audit event per write, and a forced audit failure aborts the write. ACLs. |
| `node tests/ripple/pglite/phase-b2.cjs` | B2 progress notes and billing. Create, draft, submit, return, review FIFO, void. The deadline and late-arrival boundaries. Weekly batch, approve and billed lock. Denials, audit, ACLs. |
| `node tests/ripple/pglite/phase-c.cjs` | Phase C, on top of verbatim snapshots of the live scheduling functions. **NB1:** with the flags off, results are identical to before Phase C. Signatures and grants are kept. Go-live stamp. Credential, training and authorization rules. Projected units: past demand, unplaced demand, cutover, opening balance, weekly cap, review cap. Bulk runs the client checks once per shift. R6 caregiver-safe text. Group sessions. Retraining list. Denials, audit, ACLs, the rule-13 drop. |
| `node tests/ripple/pglite/rollback-a.cjs` … `rollback-c.cjs` | Each phase's rollback in `docs/rollback/` restores the exact previous catalog: tables, columns, functions with body hashes and ACLs, triggers, policies, constraints, grants. Re-applying after a rollback equals the first apply. `rollback-c` also checks that the restored committed functions are byte-identical to DEV's stored bodies (md5). |

### DEV (owner approval needed for each run)

| Command | Proves |
|---|---|
| `node tests/ripple/dev/phase-a.cjs after` | Phase A on the real project: RLS composition through real JWTs, direct-write denial, units cycle, flag guard, ACLs, NB1 |
| `node tests/ripple/dev/phase-b1.cjs after` | B1 on the real project: the B1 checks above plus X1–X3, through PostgREST |
| `node tests/ripple/dev/phase-b2.cjs after` | B2 on the real project, including **C1**, a real concurrency race between two reviews on one authorization |
| `node tests/ripple/dev/phase-c.cjs after` | Phase C on the real project, including Smart assign through the `match-caregiver` edge function and **CC**, real concurrency (3 rounds): two managers assign at once and exactly one wins |

| `node tests/ripple/dev/phase-d2.cjs after` | D2 onboarding status: each of the 8 items flips on its own; onboarded only when all pass; renewal makes in-service and training expired; list shape; denials; ACLs; the scheduling and units functions untouched |
| `node tests/ripple/dev/done-test.cjs` | **D3 end-to-end done-test** (schema plan §8) in one scenario: onboarding; credentials and training; Manual, Smart and Auto with the three blocks; notes (on time, late, respite, returned) with FIFO reviews and the weekly cap; weekly batch to billed and locked; template versions; renewal and retraining; isolation; the rollout regression on real data (read-only) |

| `node tests/ripple/dev/nb1.cjs` | **Scheduling no-change check on its own** (NB1: Manual, Smart and Auto assign, single and bulk eligibility, caregiver side), run in every UI slice |
| `node tests/ripple/ui/round1.cjs <before\|after>` | **UI round 1 (S0 + S1) in a real browser** (Playwright + Vite on a free port; real logins). Checks menu gating per role (module-office manager and agency admin see the 3 items; Kind-Care-only manager, scheduler, caregiver and client don't), direct-URL redirects, existing pages' main content unchanged vs `before`, and the 390px sidebar and page scroll. Screenshots go to `docs/screenshots/ripple-ui/round1/`. Run `before` on the old code first; it keeps page text in the OS temp folder, never in the repo. |
| `node tests/ripple/dev/soff.cjs after` | S-OFF-1: an office-Y manager is refused on assign, release and compute earnings for office X, and gets 403 from `enable-caregiver-login`, `enable-client-login` and `admin-reset-password`; office-X and unrestricted managers and caregiver self pick-up still work; note shells per service with fallback; NB1 |
| `node tests/ripple/dev/ui-s2s3.cjs <before|after>` | UI S2 + S3 RPCs on the real project: `before` checks the four new functions are absent; `after` checks template list with usage and edit rights, measure-type upsert/active/delete-when-unused and refusals, credential expiration bands, caregiver compliance (incl. HR lock), office-scope denials, ACLs, NB1 |
| `node tests/ripple/ui/round2.cjs` | **UI round 2 (S2 + S3) in a real browser**: Form Templates list, field viewer, locked editor, draft diff, publish, measure library; credentials tab, HR entry and renewal, manager override and HR lock, expiration-panel bands at 61/60/30/29/0/-1 days, Kind-Care-only office shows no panel, role denials, 390px fit. Screenshots go to `docs/screenshots/ripple-ui/round2/`. |
| `node tests/ripple/dev/w1-audit.cjs <before|after>` | W1 audit: the events CHECK (44 types before, 50 after), each measure-library write records one event through real logins, refusals and ACLs unchanged, NB1 |
| `node tests/ripple/dev/ui-s4.cjs <before|after>` | UI S4 RPCs on the real project: units table (opening balance, FIFO pending), G2 bands, W2 correction refusals + audit, IPOS child rows, role denials, ACLs, NB1 |
| `node tests/ripple/ui/round3.cjs <s4|s5|all>` | **UI round 3 in a real browser**: care-plans list + risk panel, IPOS create from the shell, ProvenanceBadge header, authorization table + UnitsBar, correction refusals in the dialog, onboarding flips to onboarded, renewal confirmation then expired in-service/training, access (office-Y manager, scheduler, hr_staff, Kind-Care-only manager), 390px. Screenshots go to `docs/screenshots/ripple-ui/round3/`. |

| Command | Local (PGlite) |
|---|---|
| `node tests/ripple/pglite/phase-d.cjs` | D2 onboarding status on PGlite: item flips, expiry paths, list, denials, ACLs |
| `node tests/ripple/pglite/rollback-d.cjs` | Phase D rollback restores the exact post-C catalog |
| `node tests/ripple/pglite/soff.cjs` | S-OFF-1 + note shells: the gap reproduced before the migration, refused after; allowed paths, NB1, shell resolution and fallback, rule 13 and ACLs |
| `node tests/ripple/pglite/rollback-soff.cjs` | S-OFF-1 + shell rollback restores the exact post-D2 catalog; restored bodies byte-identical to DEV (md5) |
| `node tests/ripple/pglite/ui-s2s3.cjs` | UI S2 + S3 RPCs on PGlite: list/usage, measure library rules, expiration bands, compliance view, denials, ACLs |
| `node tests/ripple/pglite/rollback-ui-s2s3.cjs` | UI S2 + S3 rollback restores the exact post-S-OFF-1 catalog; re-apply equals the first apply |
| `node tests/ripple/pglite/harness.cjs` | (library) shared PGlite bootstrap for the round 3 suites: stubs, live scheduling definitions, care-plan migrations up to a cut-off, base fixtures |
| `node tests/ripple/pglite/w1-audit.cjs` | W1: the CHECK keeps the 44 types and adds 6; one event per measure-library write; fail closed (a failing audit insert rolls the write back); ACLs and refusals unchanged |
| `node tests/ripple/pglite/ui-s4.cjs` | UI S4: projection equals `cp_projected_units`, units table, G2 bands + units at risk, W2 refusals / audit / denials, `set_care_plan_rows`, ACLs |
| `node tests/ripple/pglite/rollback-round3.cjs` | Round 3 rollbacks (S5, S4, W1 in reverse) each restore the exact previous catalog; re-apply equals the first apply |

`before` mode is each phase's **pre-push** check: its objects are absent and its baseline is
recorded. It is only meaningful before that phase's migrations are applied. All four phases are
now live on DEV, so use `after`.

## NB1 no-break baseline (`dev/baseline/nobreak_before.json`)

Every DEV suite first runs today's assign paths on fresh fixtures with both care-plan flags off.
The paths are Manual, Smart (`match-caregiver`) and Auto assign, the single and bulk eligibility
checks, and the caregiver-side shift check. The results must match the saved baseline.

- **Behaviour keys** (eligibility codes, bulk size, caregiver side, Smart response, three assign
  results) must be identical. A difference is a regression.
- **`eligibility_fn`** holds the md5 of the eligibility function definitions. It is printed but not
  compared, because it changes by design whenever a phase replaces those functions. The saved
  value is from before Phase C.
- `RIPPLE_NB1_HASHES=1` also compares the hashes. Use it right before pushing a migration that must
  **not** touch the scheduling functions.

**Refreshing the baseline is a deliberate act, not a fix for a failing NB1.** Only refresh it
after an approved change that is *meant* to change one of the behaviour keys, and say so in the
commit:

```sh
RIPPLE_WRITE_NOBREAK_BASELINE=1 node tests/ripple/dev/phase-a.cjs after   # owner-approved DEV run
git diff tests/ripple/dev/baseline/nobreak_before.json                     # review, then commit with the reason
```

`dev/baseline/phase_c_sig_before.json` holds the signatures and EXECUTE grants the Phase C
`before` run recorded for the 10 functions Phase C replaced. The Phase C `after` run compares
against it.

## PGlite stubs and live snapshots

- `stub*.sql` are minimal stand-ins for the live objects the migrations reference. They copy the
  live roles, default privileges, tables and columns.
- `live_helpers.sql` holds verbatim copies of the live helpers (`current_agency_id`, `has_role`, …).
- `live/` holds verbatim definitions of the live scheduling functions Phase C changes, captured
  from DEV on 2026-10-04.
- `live/exact_definitions.json` covers the definitions that DEV stores **with carriage returns**
  (`assign_caregiver_to_shift`, `release_shift_assignments`). They are kept exact in JSON because
  `.gitattributes` normalizes `.sql` files to LF. The rollback proof depends on those bytes.

Refresh a snapshot when the live function changes outside this module. Use a read-only
`pg_get_functiondef` capture, and keep the CR-bearing ones in the JSON.

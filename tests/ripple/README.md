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

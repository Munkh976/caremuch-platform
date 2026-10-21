# S17 — IPOS effective date and revisions: design note

Status: **PLAN ONLY** (2026-10-21). No code or migration. Waiting for owner approval.

## 1. Today

- **`care_plans`:** one row per version. `status` is `active | superseded | expired`, and a unique index allows one
  `active` plan per client. `training_version` bumps on every new version.
- **`renew_care_plan`:** creates the new version as **active immediately** and supersedes the old one.
  - From that moment, notes use the new objectives.
  - Caregivers trained on the old version show "Needs retraining".
  - Eligibility (when enforcement is on) treats them as untrained.
- **In-place edits** keep the version number, with no history:
  - `update_care_plan_fields`;
  - `upsert_care_plan_goals` without a training bump;
  - `set_objective_measures`.
- **Readers that use `status = 'active'`:** onboarding, the eligibility training check, note creation (objectives),
  the training context, units projection and the dashboards.

## 2. Proposal

### 2a. A pending version (additive)
- `ALTER TYPE care_plan_status ADD VALUE 'pending'`. Additive; existing rows are unchanged.
- **Renewal from ISK** creates the new version as **pending**. The previous version stays **active**, so every
  reader above keeps using it unchanged:
  - notes use its objectives;
  - caregivers trained on it stay eligible.
  - Implementation: `renew_care_plan(..., _pending boolean DEFAULT false)`. A new parameter means DROP + recreate by
    pronargs and re-granting (rule 13). The alternative is a new `start_pending_plan_version`; **recommended**,
    because then nothing that exists changes.
- **Editing the pending version:** goals, measures and header, through the existing RPCs. They must accept
  `status IN ('active','pending')`, which changes existing functions (approval).
- **In-service and training sessions** are recorded **against the pending version**. `record_inservice_form`,
  `record_training_form` and `add_training_attendees` accept a pending plan (existing functions: approval).
- **Activation:** a new `cp_try_activate_plan(plan)` runs at the end of those two RPCs. When the pending version has
  a signed in-service AND at least one training session at its `training_version`, in one transaction:
  - the pending version becomes `active`, with `effective_date` = that day unless a later date was entered;
  - the old version becomes `superseded`;
  - one audit event `care_plan_activated` (events CHECK: approval).
- **Caregivers already trained in a session of the pending version** are trained-current the moment it activates.
  Nobody is "needs retraining" before then.

**UI:**
- The client header shows "IPOS v2 · Pending: In-service / training".
- The Training tab works on the pending version and shows "Becomes effective when the in-service and one training
  session are recorded".
- The IPOS tab shows v1 (in effect) and v2 (pending).

### 2b. Old version expires while the new one is pending
- When the active version's `expiration_date` is before today and a pending version exists:
  - a **red warning** on the client page and the dashboard: "IPOS v1 expired on …; v2 is waiting for its
    in-service / training";
  - shifts are **NOT blocked**. Today's eligibility rules don't change; **to confirm with Bren**.
- **Onboarding:** item 1 (IPOS) reports `expired` as today. It gets a new detail line "v2 pending", a reader change
  (approval).

### 2c. Ripple's own edits = revisions
- `care_plans.revision int NOT NULL DEFAULT 0` (additive).
- A new table `care_plan_revisions`:
  - columns: `care_plan_id`, `revision`, `snapshot jsonb` (header, goals, objectives, measures),
    `changed_by`, `changed_at`, `summary`;
  - unique `(care_plan_id, revision)`;
  - RLS and `cp_staff_in_scope` reads (manager / agency_admin).
- **Writers that edit in place** bump `revision` and store the new snapshot:
  - `update_care_plan_fields`, `upsert_care_plan_goals` (no training bump), `set_objective_measures`;
  - existing functions: approval;
  - shared helper `cp_record_revision(plan)`.
- **Display:** "IPOS v2, rev 3". A **"What changed"** view diffs two snapshots in the browser (fields, goals,
  objective text, Instructions, measures). It's display only.
- **Training records** get `plan_revision int` (nullable, additive), stored at record time. It is information only,
  never blocking: "Trained on v2 rev 1 (now rev 3)".

### 2d. The official ISK IPOS PDF
- Attached to its version through S4b (`parent_kind = 'care_plan'`). This needs S4b approved and built first.

## 3. Data model summary (all additive)

| Change | Kind |
|---|---|
| `care_plan_status` + `'pending'` | enum value |
| `care_plans.revision` | column |
| `care_plan_revisions` | table + RLS |
| `plan_training_records.plan_revision` | column |
| events CHECK + `care_plan_activated`, `care_plan_revised` | constraint (approval) |

## 4. Functions affected

| Function | Change | Approval |
|---|---|---|
| `start_pending_plan_version` | new | — |
| `cp_try_activate_plan` | new (internal) | — |
| `cp_record_revision` | new (internal) | — |
| `record_inservice_form`, `record_training_form`, `add_training_attendees` | accept pending; call activation; store revision | yes |
| `update_care_plan_fields`, `upsert_care_plan_goals`, `set_objective_measures` | accept pending; record a revision | yes |
| `get_client_training_context`, `list_clients_onboarding` / `cp_client_onboarding` | expose the pending version / its state | yes |
| `would_bump_training_version` | pending versions never bump | yes |

**Unchanged:** every reader of the active plan (eligibility, notes, projection, billing), the scheduling functions
and NB1.

## 5. Tests

- **PGlite:**
  - renewal creates a pending version and the old one stays active (the eligibility result is identical before and
    after);
  - edits to the pending version don't touch the active one;
  - in-service alone doesn't activate; in-service + 1 session does (old superseded, audit once);
  - concurrency: two sessions at once activate exactly once;
  - an expired active plan with a pending one: warning data and no block;
  - revisions: every in-place edit bumps once, the snapshot is complete, a no-change save doesn't bump;
  - the training record stores the revision;
  - rollback proof; ACLs; refusals.
- **DEV before / after:** NB1, plus a count of active plans that would change (must be 0).
- **Browser:** the pending badge, the Training tab on the pending version, activation, the expired warning, the
  "What changed" view, 1440 / 390. Rehearse and playbook updated.

## 6. Risks

- **Two plans at once:** readers that select by `client_id` without `status = 'active'` might show the pending
  version. Audit every reader (grep) before building.
- **Activation inside the training RPCs:** keep it in the same transaction, with the plan row locked `FOR UPDATE`.
- **Revisions on every autosave** would flood the history. Only explicit saves bump, and an identical snapshot
  doesn't.
- **"Shifts not blocked when expired"** depends on Bren's answer. If the answer is "block", that is an eligibility
  change and needs a separate approval and NB1 refresh.

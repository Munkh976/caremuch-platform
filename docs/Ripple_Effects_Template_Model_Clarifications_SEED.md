# Ripple Effects — Template Model Clarifications (SEED for next session)

> **Purpose.** Carry forward the unresolved design questions about templates, checklists,
> training, and intake documents into a fresh session. Start the new session by attaching:
> the project folder docs (especially the two `claude/Ripple_Effects_*` docs), Lauren's
> three hand-drawn screens (`IMG_1295/1296/1297.jpeg`), and the Ripple source files
> (`2025 IPOS TRAINING FORM.pdf`, `Redacted_IPOS_1.docx`, `Redacted_Authorization Form_1/2/3.docx`).
> These remain workflow models only — never seed real data from the redacted files.

> **OUTCOME (Oct 1, 2026 — session 2): all four "What to do" steps are DONE.**
> - The IPOS is mapped section by section to shell vs instance vs checklist — **arch doc
>   §11.2**. The two layers are named (**Layer A agency shells / Layer B instances**) —
>   arch §11.1, schema §3 / §3.1.
> - Checklist derivation settled — **arch §11.3**: primary source is the objective's
>   *Instructions for Staff*, plus treatment-need rows linked to that objective; only
>   objectives whose responsible party is this agency get a checklist; New Need is excluded.
>   Items are generated, manager-curated, then snapshotted into each service note.
> - Vocabulary settled — **"Instructions for Staff"** (arch §11.4).
> - Intake docs on their own track (`client_documents`), 6 types; **Summary page dropped**
>   (Lauren struck it on `IMG_1296`) — arch §11.5, schema §5.1.
> - Training form lifecycle confirmed against the ISK form — arch §11.6, schema §8.
> - Both `claude/Ripple_Effects_*` docs updated; prototype revised in place (v7).
> - **Corrections found in the sources:** (1) on the ISK training form the *trainer* is the
>   CM / Primary Clinician and the *staff* is the caregiver — so "trainer" is not a
>   caregiver label; (2) most IPOS objectives are addressed to the CM / evaluator / family,
>   so service + responsible party moved from goal to **objective**; (3) the prototype's
>   four "MichiCANS-identified" domains are actually the IPOS's **"Other needs NOT
>   identified by MichiCANS"**; (4) background checks (6) added to `credential_types`.
> - **Open for Bren / Lauren** (arch §11.8): sample service note; retraining on unchanged
>   annual renewal; dollar-allocation services; required intake types; BSP/Protocol gating.

> **UPDATE (Oct 1, 2026, evening) — Bren answered everything; see arch §12 (authoritative).**
> Respite has its own Respite Progress Note (narrative, no goals); "Additional observation"
> dropped; Bren enters ISK goals + data questions; retraining on every new IPOS version
> (`training_version`), via In-service form (CM → Bren) then Training form (Bren → staff);
> late = first unit lost (4 → 3); weekly billing reviewed by Bren (Weekly Billing screen);
> notes due day of / day after, printable; units only; onboarding = 8 items. Only
> e-signature acceptance remains, which Ripple will confirm. Prototype is **v9**.
> **UI spec for Ripple (Oct 1):** "CareMuch Screen Guide for Ripple Effects" (Claude Docs,
> https://claude.ai/artifact/WHkD1vV9Je4Ew1LaeKHapm) — 7 screens, today vs new, with a
> checklist for Ripple. Current-UI screenshots (80 screens) + `screen-inventory.md` are in the
> project. Open security items from the capture (not in the Ripple doc): caregiver role can open
> /dashboard, /schedule, /caregivers; /notifications-outbox shows temp passwords; the app's
> only Supabase project (`rgeldgztadebgvrdhaqa`) is the DEV project — no production project
> exists yet (corrected per `docs/Ripple_UI_Plan_Decisions_2026-10-01.md`).

> **UPDATE (Oct 1, 2026, afternoon) — Progress Notes.** Lauren sent three redacted CLS
> progress notes. The "service note + derived checklist" idea below is **superseded**: one
> **Progress Note per visit (shift)** with every Ripple objective inside (ISK Instructions
> for Staff shown from the IPOS; Notes; Data = per-objective questions from an agency
> **measure library**); caregivers may add an **"Additional observation"** that a manager can
> promote to a standard question; **Respite = no goals, no progress note** (skill-building in
> respite goes on the CLS note). See arch §1.5, §11.3; schema §3, §4, §5. Prototype is v8.
> A 19-question reply to Lauren (structure, respite, billing per note vs batched, earlier open
> items) is drafted — arch §11.8. Also open with Bren: late arrival = whole visit vs first
> unit non-billable.

> **UPDATE (Oct 1, 2026):** two decisions now settled — the system role name stays
> **Caregiver** (§ "Role naming"), and the Client Care Plan is a **new UX module that reuses
> the existing Schedule / Manual-Smart-Auto-Assign engine** rather than a new scheduler
> (§ "Build approach"). Also corrected the earlier "read-only" wording — the client's IPOS
> content is fully editable; only the *provenance badge* is read-only (§ "How a template
> fills an editable client record").

---

## 0. Where everything lives (how to pick this up)

**To continue in a new chat:** open a new chat **inside the CareMuch project** (no need to
copy any file — every project doc is automatically visible to every chat in the project).
First message can simply be: *"Continue the Ripple Effects care-plan template design. Read
`claude/Ripple_Effects_Template_Model_Clarifications_SEED.md` first, then the two
`claude/Ripple_Effects_*` docs, Lauren's three screens, and the Ripple source files."*

**Everything is in this CareMuch project (all chats in the project can read these):**
- `claude/Ripple_Effects_Care_Plan_and_Authorization_Module_Architecture.md` — the *why* (§11 = template model)
- `claude/Ripple_Effects_Care_Plan_and_Authorization_Schema_and_Migration_Plan.md` — the *what to build* (for Claude Code)
- `claude/Ripple_Effects_Template_Model_Clarifications_SEED.md` — this doc
- `Redacted_IPOS_1.docx`, `Redacted_Authorization Form_1/2/3.docx`, `2025 IPOS TRAINING FORM.pdf` — Ripple source forms (workflow models only)
- `IMG_1295.jpeg` (Caregiver), `IMG_1296.jpeg` (Client 1 Care Plan), `IMG_1297.jpeg` (Dashboard) — Lauren's hand-drawn screens
- Existing platform docs: `CLAUDE.md`, `m-office-scoping-plan.md`, the Smart Scheduling plans, etc.
- Note: un-prefixed copies of the two Ripple docs also sit at the project root (uploaded
  Oct 1, 04:07). The **`claude/` versions are authoritative**; the root copies predate the
  Oct 1 template-model pass.

**The interactive UX/UI prototype (the "Ripple Effects Console") is an Artifact, NOT a
project doc.** It lives at:
- **`https://claude.ai/artifact/C8hijFYNgQqQ2Y69mqVout`** (current version: v9, Oct 1)
- Screens: Dashboard · Client Care Plan (IPOS / Goals / Service Notes / Scheduling, with a
  document spine) · Caregiver · Form Templates (agency shells). Plus a Manager/Client-login
  toggle on the Client page.
- A new chat's Claude can open it with the Artifact tool's **read** action on that URL. To
  revise it, pass that URL to the Artifact tool so changes land on the same artifact.

**For Claude Code (the repo implementation agent):** everything it needs is in the **project
docs as text** — schema, RLS, triggers, migration order, tabs, rules. The prototype is a
**visual reference only**. Do **not** treat the prototype's HTML as the build target — the
authoritative spec is the two `Ripple_Effects_*` docs.

---

## The core correction: TWO kinds of template, which the prototype conflated

**(A) Agency-level templates — the blank shells (stable, version-controlled, shared).**
Managed in **Configuration → Form Templates**. These are the *structure*, not any client's
data. They change rarely. They are:
- Authorization form shell
- IPOS shell (the section layout: identifying info, outcomes, strengths, needs, abilities,
  preferences, MichiCANS blocks, treatment-needs grid, goals/objectives structure,
  authorizations, review schedule, static appeal/attestation text)
- Service Note shell (fields + the checklist rule)
- Training form shell (ISK 33.01_01F)
- Intake document types (consent, insurance, emergency contacts, allergies, assessment,
  release of information — 6 types; Summary page dropped)

**(B) Client-level instances — the filled records (one per client, re-versioned per client).**
Live on the **Client Care Plan page**:
- The filled IPOS: **DESIRED OUTCOMES OF SERVICE (Hopes & Dreams)**, **STRENGTHS**,
  **NEEDS**, **ABILITIES**, **PREFERENCES**, **MichiCANS DSM Service Recommendations**
  (Service → Outcome, e.g. "01 – aligns with needs; integrated" / "03 – recommended; guardian
  declined"), **Needs Identified by MichiCANS**, **Other Needs Not Identified by MichiCANS**,
  the treatment-needs grid, and **Goals → Objectives** (with Instructions for Staff).
- The filled authorizations and their services (units authorized/billed/remaining).
- The service notes + completed checklists.

**Rule:** Form Templates holds the *shells*; the Client page holds the *filled, client-
versioned instances*. Editing a shell makes a new shell version and never alters existing
client records (the snapshot rule, arch §4).

---

## How a template fills an editable client record

1. Manager starts a new IPOS for a client → the system **loads the current agency IPOS shell
   (e.g. v4)** as the blank structure.
2. Manager **fills and edits** this client's real content into that structure. **This
   content is fully editable**, on the Client Care Plan page.
3. On save, the client's IPOS record stores `template_id = IPOS`, `template_version = 4`, a
   `field_snapshot` of that structure, plus the client's values (`field_values` + spine
   columns + child rows).

The **only read-only element** is the provenance badge ("built from IPOS template v4").

---

## The version-drift-safe dynamic architecture — confirmed

Three storage rules (arch §4): templates append-only-versioned; every record stores its
`template_version`; every record snapshots the field structure. The engines read the
**fixed spine columns**, never the template; `publish_template_version` refuses a shell
that drops a required spine column (schema §3).

---

## ~~Checklist is DERIVED from the IPOS~~ — SUPERSEDED by Progress Notes (arch §11.3)

- Sources: the objective's **Instructions for Staff** (split per action) + **treatment-need
  rows linked to that objective** with a recommendation; optional scope header from the
  authorization's service description.
- Excluded: New Need, unlinked treatment needs, narratives, and objectives whose
  responsible party is not this agency.
- The **Service Note shell's `checklist_rule`** defines the mapping; IPOS shell fields carry
  `seeds_checklist`.
- Lifecycle: generated on objective save → manager curates → snapshotted into
  `service_notes.checklist_state` at delivery → objective/instruction change bumps
  `training_version` and regenerates.
- A delivery record = caregiver's **service note** (free text) **plus** the **completed
  checklist** (structured). Two separate fields.

---

## Role naming — SETTLED: the system role is "Caregiver"

The CareMuch system keeps **`caregiver`** as the schema role and general term throughout.
Ripple's "DSP / specialist" is a **per-office display label only**. The **service note is
written by the caregiver**. **Correction (Oct 1):** on the ISK training form the *trainer*
is the Case Manager / Primary Clinician who trains the caregiver; "trainer" is not a
caregiver label, and "trainer guidance" is retired in favor of "Instructions for Staff".

---

## Build approach — SETTLED: new Care Plan UX, reusing the existing Schedule engine

- The **Client Care Plan is a new UX module** (tabs: IPOS / Goals / Service Notes /
  Scheduling). In the data model it **ALTERs/extends the existing care-plan tables**
  (dev-rule 7) — Claude Code confirms the live `client_orders`/care-plan structure first.
- The **Scheduling tab is NOT a new scheduler.** It is a per-client summary that **links to
  and reuses the existing Schedule Management module and the Manual / Smart / Auto Assign
  engine.** The only engine change is the additive hard rules in `check_assignment_eligibility`.

---

## Where "edit template" belongs

- The **Client Care Plan page** shows a **read-only provenance badge** — no edit-template
  link.
- The **edit** action lives ONLY in **Configuration → Form Templates**.
- Done in prototype v7.

---

## Intake documents are SEPARATE from the IPOS-versioning cycle — SETTLED

Six types, stored in `client_documents`, no FK to the care plan; an intake update never bumps
the plan or `training_version`, and an IPOS renewal never re-versions intake documents. IPOS
and Training forms appear in the client's document list but sit on their own tracks.

---

## Training form — SETTLED (arch §11.6)

- Agency shell (ISK 33.01_01F); instance = `plan_training_forms` header + one
  `plan_training_records` row per trained caregiver.
- Filled (a) before a caregiver's first assignment to a client, (b) every time the IPOS goals
  version changes.
- Seen on the **Caregiver page** (per-client training) and **gates Scheduling**.

---

## What is already settled (do not re-litigate)

- **Role name = Caregiver** (schema); per-office display label optional.
- **Care Plan = new UX extending existing care-plan tables; Scheduling reuses the existing
  Schedule + Manual/Smart/Auto Assign engine** (only `check_assignment_eligibility` gains
  additive hard rules).
- **Client IPOS content is editable**; only the provenance badge is read-only.
- **Two layers:** Layer A agency shells (Form Templates) / Layer B instances (Client page).
- **Checklist derivation** as above; **"Instructions for Staff"** is the label.
- **Intake on its own track**, 6 types, no Summary page.
- Tabs: IPOS (auth + services inside) · Goals (grouped by objective service, sequence
  preserved, select-in-place) · Service Notes (checklist + note separate) · Scheduling
  (summary + link to the real Schedule Management module).
- Template versioning + snapshot (arch §4). Oldest-auth-first FIFO. Late = full unit
  non-billable. Training gates on IPOS training version. All authorizations via KARE;
  Authorization form is the official record. M-Office tenancy pattern; CLAUDE.md footguns.
- Backend build order: Phase A schema → B RPCs → C eligibility → D two tests. UI after.

## Next

Send the arch §11.8 questions to Bren / Lauren; when the sample service note arrives, check
the Service Note shell and `checklist_rule` against it. Then hand the schema plan to Claude
Code for Phase A.

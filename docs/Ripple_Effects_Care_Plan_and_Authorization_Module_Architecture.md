# Ripple Effects — Care-Plan & Authorization Module: Architecture Analysis

> **Status: PLAN ONLY. Nothing in this document has been applied.** Follows the same
> discipline as `m-office-scoping-plan.md` and `m1-security-gate-plan.md`: additive
> evolution over the existing schema, every new table/RPC/RLS change scoped through the
> tenancy helpers already proven (`current_agency_id()`, `is_agency_staff()`,
> `current_virtual_office_id()`), every new `SECURITY DEFINER` function REVOKE-before-GRANT
> per CLAUDE.md rule #14, and a two-part done-definition (an isolation test + a
> units-enforcement test) rather than a code review. STOP for review before any
> implementation.

> **Grounded in five real documents** Ripple Effects sent (Sep 23–25, 2026), read and
> analyzed for this plan: `Redacted_IPOS_1.docx` (a full redacted Individual Plan of
> Service), `Redacted_Authorization Form_1/2/3.docx` (three funder authorization forms),
> `2025 IPOS TRAINING FORM.pdf` (the blank ISK proof-of-training form), plus two emails
> from Lauren Williams (the ISK annual/in-person training checklist) and Elizabeth
> Houseman (redaction context), and Lauren's three hand-drawn screens
> (`IMG_1295/1296/1297.jpeg`). **These redacted documents are workflow models only. No
> content from them is to be seeded as real data.**

> **UPDATE (Sep 30, 2026):** §9.1 (late-arrival billability, oldest-auth-first) and §9.2
> (confirmed UX & structural decisions) added. Bren Mumbower's Sep 30 answers resolved the
> remaining §9 flags — all authorizations come through **KARE**, the **Authorization form**
> is the official record, oldest valid authorization is drawn first, 5-min-late loses the
> full 15-min unit, and the team is **retrained whenever the IPOS goals change**.

> **UPDATE (Oct 1, 2026) — template-model pass (§11, new).** Settles the questions carried
> in `claude/Ripple_Effects_Template_Model_Clarifications_SEED.md`:
> (a) the module has **two named layers** — **Layer A: agency shells** (Configuration →
> Form Templates, version-controlled) and **Layer B: client instances** (the Client Care
> Plan page, fully editable, each carrying `template_id` + `template_version` +
> `field_snapshot`); (b) a **section-by-section map of the IPOS** to shell vs instance
> (§11.2); (c) ~~checklist derived from Instructions for Staff~~ — **superseded the same
> afternoon by the Progress Note model** (see the update below and §11.3);
> (d) the single label is **"Instructions for Staff"** (§11.4); (e) **intake documents are
> their own track**, not IPOS-versioned, and Lauren struck "Summary page" from the list
> (§11.5); (f) the **training-form lifecycle** is confirmed against the ISK form, which
> shows the *trainer* is the Case Manager / Primary Clinician and the *staff* trainee is
> the caregiver (§11.6); (g) the Care Plan module **extends existing tables and reuses the
> existing Schedule + Manual/Smart/Auto Assign engine** (§11.7). Role name stays
> **Caregiver**. §1.1, §1.3, §1.4, §2, §9.2 corrected in place to match.

> **UPDATE (Oct 1, 2026, afternoon) — Progress Notes replace the "service note + derived
> checklist" model (§1.5, §11.3 rewritten).** Lauren sent three redacted CLS progress notes
> (`Progress Note Example.pdf`, `Progress_Note_2.pdf`, `Progress Note 3.pdf`). They show:
> **one progress note per visit (shift)**, covering **every Ripple objective** for the client
> (header → one block per objective with Goal, Objective, ISK Instructions for Staff, Notes,
> Data → optional billing footer). The caregiver's structured answers are **objective-specific
> data questions** (Yes/No/N/A, prompt level, graded exposure steps, frequency tallies,
> repeated trials, narrative prompts) — not items split out of the ISK instructions. So:
> `service_notes` → **`progress_notes`** (one per shift) + **`progress_note_entries`** (one per
> objective); the derived checklist → **`objective_measures`** chosen from an agency
> **measure library**; caregivers may add an **"Additional observation"** that a manager can
> promote to a standard measure. **Respite stays "no goals"** (user decision): respite can be
> booked any time without a goal-based note; skill-building seen during respite is recorded on
> the client's CLS progress note. Billing footer, respite records, and batching are **pending
> Lauren's answers** (§11.8).

> **UPDATE (Oct 1, 2026, evening) — Bren Mumbower's answers (§12, authoritative).** Overrides
> anything earlier that conflicts:
> - **Respite has its own note.** Respite is never recorded on the CLS note. Every respite visit
>   gets a **Respite Progress Note** (`Respite Note Template.pdf`): same header as CLS + one
>   **Session Narrative**, staff signs. No goals. Respite training also runs ISK → Ripple → staff.
> - **"Additional observation" is dropped** (user decision). No caregiver-added items in V1.
> - **Bren enters the ISK goals** into the system and sets each objective's data questions.
> - **Retraining on every new IPOS version** — annual renewal *and* goals change. The gate column
>   is renamed `training_version` (was `goals_version`). Two steps: the CM trains Ripple's
>   program lead (Bren), who signs the **IPOS In-service form**; then Bren trains each caregiver
>   (**IPOS Training form**).
> - **Late arrival loses only the first 15-minute unit** (4 scheduled → 3 billed). §9.1 corrected.
> - **Billing is weekly**, done by Bren and Lauren from a spreadsheet today; Bren reviews every
>   bill. → a **Weekly Billing** screen and `billing_batches`. Billing footer is being added to
>   all Ripple notes.
> - Notes are due **the day of the visit or the day after**; group sessions = one note per
>   client; notes stay at Ripple unless ISK requests them.
> - **Units only** (no dollar allocation). **E-signature: Ripple will confirm**; notes must be
>   **printable** (print / save as PDF) now; electronic archiving later.
> - **Onboarding = 8 required items** (§12).

> **UPDATE (Oct 4, 2026) — owner decisions applied (`docs/Ripple_UI_Plan_Decisions_2026-10-01.md`,
> authoritative over this doc where they conflict; §12 stays authoritative for workflow).**
> Corrected in place below:
> - **§2.2 / §11.7 (R4):** the IPOS is a **new `care_plans` table**. The existing `client_orders`
>   service schedule is not altered, apart from a nullable `care_plan_id` link.
> - **§2.4 / §6 / §7 (R3):** credentials **extend `caregiver_certifications`** (+ agency
>   `credential_types`). There is no `caregiver_credentials` table.
> - **§6 (R7):** RLS uses the live M-Office predicate.
> - **§6 (R2, R8/Q1, Q3):** an office-scoped `office_service_types` table, and two admin-only
>   `virtual_office` flags.
> - **§2.5 / §7 (R9):** the V1 dashboard shows computed status only. Sending notifications is a
>   later phase.
> - **§9.2 / §11.3 (Q9, Q10):** the caregiver records the client's arrival time, and a reviewer
>   returns a note, never edits it.
> - **§11.5 (Q7):** `safety_behavior_plan` with a not-applicable status.
> - **Caregiver data on the phone (R5):** own assigned shifts only, through one `SECURITY DEFINER`
>   read. It covers this agency's objectives, Instructions for Staff and measures. Never needs,
>   diagnoses or MichiCANS.
>
> The schema plan's §2.1 adds the security baseline. Its §13 lists every conflict found and how it
> was resolved.

---

## 0. The one-paragraph model

These five documents are not five unrelated forms. **They are one connected chain, and
the IPOS is the spine.** The IPOS (Individual Plan of Service) is the master record for a
client: it embeds the goals, objectives, staff instructions, the authorizations
(units authorized / claimed / paid / available, with effective and expiration dates), and
the periodic review schedule. The three standalone Authorization forms are the *funder's
billing-side view* of those same authorizations. The IPOS Training Form is the
*per-client competency gate* that says a specific staff member is allowed to work that
specific client's plan. Lauren Williams's email and her Caregiver screen are the
*agency-wide credential checklist* (trainings **and** background checks) every caregiver
must keep current regardless of client. So the module is **not a form builder**; it is a
**plan-of-service engine with a dynamic form layer on top**, and everything — smart
scheduling, notifications, the manager dashboard — hangs off the same spine.

The funding chain this enforces:
**Medicaid (pays) → ISK / CMH (assesses eligibility, issues authorizations) → Ripple
Effects (delivers the authorized service) → bills ISK → Medicaid pays.** A service
delivered without a current authorization and remaining units does not get paid. That
single fact is why authorization becomes a new **hard constraint** on scheduling, not a
back-office record.

---

## 1. What each document is, in data terms

### 1.1 The IPOS (`Redacted_IPOS_1.docx`) — the spine

Read through the redactions, the IPOS decomposes cleanly into nested entities. (The full
field-by-field shell-vs-instance map, including which fields appear on the progress note, is §11.2.)

| IPOS section | Maps to entity |
|---|---|
| Identifying info (name, DOB, case #, address) | the existing **client** record — not re-stored on the plan |
| Service, meeting date, **plan effective / expiration date**, facilitator, recorder | `care_plans` (versioned header) |
| Planning meeting attendees (name, relationship, attended, contributed) | `care_plan_attendees` |
| Desired outcomes (hopes & dreams), Strengths, Needs, Abilities, Preferences, Strengths that help / Barriers | `care_plans.field_values` (template-governed narrative) |
| MichiCANS DSM service recommendations (service → outcome code, notes, MichiCANS date) | `care_plan_dsm_recommendations` |
| Needs identified by MichiCANS (domain, level of need, centerpiece strengths / strengths present) | `care_plan_needs` (`source = michicans`) |
| Other needs **not** identified by MichiCANS (Life Functioning, Cultural Factors, Risk Factors & Behaviors, Caregiver Resources & Needs) | `care_plan_needs` (`source = other`) |
| Treatment-needs grid (Need to be addressed ☐ · New need ☐ · Treatment recommendation) | `care_plan_treatment_needs` |
| **Goals** (#, goal text, implementation target dates) | `care_plan_goals` |
| **Objectives** (A/B under each goal, *Instructions for Staff*, dates) | `care_plan_objectives` (+ objective-level service / responsible party, §11.3) |
| Natural supports (name, natural/professional, status, how they help) | `care_plan_natural_supports` |
| **Authorizations** (auth #, provider/program, service, units authorized / claimed / paid / available, effective–expiration) | this agency's lines → read-through of `service_authorizations`; other providers' lines → `care_plan_external_services` (reference only) |
| Adverse benefit determination type, crisis prevention plan choice | `care_plans.field_values` |
| Periodic review schedule, **next review date** | `care_plans.review_frequency`, `next_review_date` + `care_plan_reviews` |
| Transition / discharge criteria | `care_plans.discharge_criteria` (shell may supply ISK default text) |
| Estimated cost, appeal rights, signature attestation | static shell text + signature fields on `care_plans` |

The critical structural facts confirmed from the live document: the plan is **versioned**
(it carries an effective date, an expiration date, and a plan *type* — Initial / Annual /
Addendum), and the authorizations are **embedded inside the plan** while *also* existing
as standalone forms (see §1.2). That duplication is the single most important design
decision in this whole module, resolved in §3. Two further facts the Oct 1 pass surfaced:
**the IPOS authorization block lists every provider in the plan** (Case Management,
outpatient clinic, Ripple), not only Ripple — so only this agency's lines are units-bearing
(§11.2); and **most objectives' *Instructions for Staff* are addressed to someone other
than Ripple's caregiver** (the CM, an evaluator, the family) — so the progress note carries
only objectives this agency delivers (§11.3); Progress Note 2 confirms this (it lists only
Ripple's objectives). **The IPOS itself contains no progress note and no data questions** —
those belong to delivery (§1.5, §11.3).

### 1.2 The three Authorization forms — the funder's billing view

All three share an identical structure (the funder's template), which is exactly why this
can be modeled generically rather than per-form:

| Field | Form 1 | Form 2 | Form 3 |
|---|---|---|---|
| Authorization number | ✓ | ✓ | ✓ |
| Effective / Expiration date | ✓ | ✓ | ✓ |
| CPT / Revenue modifier + code | ✓ | ✓ | ✓ |
| Service description (CLS / Respite) | ✓ | ✓ | ✓ |
| **Units per period** | `20 Per Week` | `X Per Auth` | `X Per Week` |
| Total units, Unit type | `Per 15 Minutes` | `Up to X Minutes` | `Per 15 Minutes` |
| Rate, Amount | ✓ | ✓ | ✓ |
| Authorizing Agent Notes | ✓ | ✓ | ✓ |

**Note the period model differs across forms** (`Per Week`, `Per Auth`, and `Per Quarter`
in the IPOS). The units engine must handle multiple period types, not one — this is a
schema requirement, flagged here so it isn't discovered mid-build.

### 1.3 The IPOS Training Form (`2025 IPOS TRAINING FORM.pdf`) — the per-client gate

This is an **ISK form** (33.01_01F, effective 11/14/2023) that attests named staff
received training on a *specific client's plan*, tied to the plan's effective date and
type. Its fields, read from the blank form:

- **Header (once per form):** individual served, case number, effective date of plan,
  **type of plan** — Initial / Annual / Addendum / **Behavior Support Plan** / **Protocol**,
  provider agency, location.
- **Per staff row:** training/PCP meeting date, staff name + signature, **name of Primary
  Clinician**, and IPOS training method — *received during the PCP meeting* or *attests to
  receiving training outside the PCP meeting*.
- **Training information block (per training date, each completed separately):** date of
  training, **trainer** printed name + signature, then staff name / signature / signature
  date.

**Who is who (corrects earlier wording):** the form states IPOS training is given by the
**Case Manager or other qualified staff / independent facilitator** who monitors the IPOS
and is *not* a provider of any other service to that individual, or by the Primary
Clinician. So on this form the **trainer is the CM / clinician**, and the **staff trainee is
the caregiver**. The CareMuch role remains `caregiver`; `trainer_name` on the training
record is the CM/clinician, not a caregiver.

This is per-patient training. A caregiver cannot be matched to a client until a signed
record of this form exists **for that client's current IPOS training version** — which is why
plan versioning (§4) is load-bearing, not cosmetic. Bren confirmed (Sep 30) the trigger is a
**change to the IPOS goals**, not merely annual renewal — see §9.2 and §11.6.

### 1.4 Lauren Williams's email + Caregiver screen — the agency-wide credential checklist

Three groups of recurring, expiring credentials, seeded from the email and from Lauren's
Caregiver screen (`IMG_1295`, "Onboarding — background checks … done annually"):

- **Background checks (annual, from `IMG_1295`):** ICHAT, MDHHS Central Registry, OIG,
  Sanctioned Provider, MI Sex Offender Registry, National Sex Offender Registry.
- **Annual (online):** Basic First Aid, Bloodborne Pathogens, Corporate Compliance,
  Cultural Diversity, Customer Service, Emergency Preparedness, Grievances & Appeals,
  HIPAA, Limited English Proficiency.
- **Annual:** Person-Centered Planning for Direct Care Professionals, Recipient Rights,
  Trauma Informed Care.
- **In-person (recert):** CPR/First Aid Combined, Mandt Training, Medication Training (if
  applicable), Recipient Rights (initial only).

These gate whether a caregiver can work **at all**; the §1.3 form gates whether they can
work **this client**. Two layers, two gates — the matching engine checks both. Each item has
an effective and expiration date, and **both the supervisor and the caregiver are
notified** before expiration (`IMG_1295`); the dashboard lists them in order of expiration
with 60-day yellow / 30-day red / overdue ★ (`IMG_1297`).

### 1.5 The CLS Progress Notes (`Progress Note Example.pdf`, `Progress_Note_2.pdf`, `Progress Note 3.pdf`) — the delivery record

Three Ripple notes (redacted, workflow models only). Same layout in all three:

| Part | Fields | Notes |
|---|---|---|
| **Header** (once per note) | Client name, Date of service, Note completed on, Staff:Client ratio, Start time, End time, Location, Staff name (print), Staff signature | = one visit / shift |
| **Objective block** (repeated) | Goal heading → Objective (with service tag, e.g. "(CLS)") → **ISK Staff Instructions** → **Notes** (free text, "include reinforcers") → **Data** | Only Ripple's objectives appear |
| **Data** (per objective, custom) | Yes/No/N/A participation; highest prompt level (Gestural → Visual → Verbal → Modeling → Partial Physical); graded exposure steps ("circle all levels tolerated"); frequency tallies with totals; 3–5 repeated trials each with "Activity" / "Strategy identified"; narrative prompt ("describe 1–3 positive interactions"); short answers ("structured group activity") | Written per client by Ripple; ISK instructions are shown, not answered |
| **Staff notes inside Data** | Caution / definition text ("do NOT continue exposure if it causes notable distress"; "'participate' means active involvement…") | Display-only |
| **For Billing Only** (Example 1 only) | Client's case number, Units scheduled, Units billed, Biller's name + signature | Absent from Notes 2 and 3 — **open, §11.8** |

Facts this establishes:
- **One note = one visit (shift).** Date/start/end and units sit once in header/footer; units are
  counted per visit, not per objective.
- **Objectives carry their own frequency** ("once per session", "once per week", "2 activities per
  session", "whole 3-hour session"), so not every objective is worked every visit — hence N/A.
- **Service is on the objective** ("Objective 1A … (CLS)"). One CLS objective in Note 3 (Goal 4)
  is worded as center-based respite — Bren: disregard it. Respite has no goals and uses its own
  Respite Progress Note (§12).
- Some objectives have **no ISK Staff Instructions** (Note 3, 2A/3B) — the field is optional.

---

## 2. The five building blocks (all additive to the current schema)

Each maps to one of the six roadmap bullets and reuses infrastructure already built. The
blocks fall into the **two layers** named in §11.1: block 2.1 is **Layer A (agency
shells)**; blocks 2.2–2.4 hold **Layer B (client and caregiver instances)**.

### 2.1 Form template layer (Layer A) — `form_templates`, `form_template_versions`, `form_template_fields`
The agency-level **shells** the manager uses to define an IPOS / Authorization / Service
Note / Training / intake form once, and to support a different funder's form later
**without a migration**. Agency- and office-scoped, exactly the M-Office pattern. A shell
defines sections, fields, field types, option lists, static text, and — critically —
**where each field is stored** (a fixed spine column, a child row, or a template-governed
value; §11.2) and **whether it is shown on the progress note** (§11.3). Versioned (§4). Managed only
in **Configuration → Form Templates**. **Every client record is an instance of one of
these shells — nothing is hard-coded (§9.2), and nothing on the client page edits a
shell (§11.1).**

### 2.2 Care-plan spine (Layer B) — extends the existing Care Plan module
`care_plans` (versioned IPOS header), `care_plan_goals`, `care_plan_objectives` (with
*Instructions for Staff*, objective-level service + responsible party, target dates),
`care_plan_attendees`, `care_plan_needs`, `care_plan_treatment_needs`,
`care_plan_dsm_recommendations`, `care_plan_natural_supports`,
`care_plan_external_services`, `care_plan_reviews`, plus **`objective_measures`** (the data
questions chosen for each objective, §11.3).

**Corrected Oct 4 (owner decision R4/Q2):** the live `client_orders` (today's "Care Plan" menu) is a
recurring **service schedule** that generates shifts, several per client. It is not a plan of service.
- So `care_plans` is a **new** table, with versioning (`version`, `training_version`, `status`
  active/superseded/expired, `effective_date`, `expiration_date`, `next_review_date`) and the
  goal→objective nesting.
- `client_orders` is unchanged except a nullable `care_plan_id` link. The two tables have distinct
  jobs and no duplicated field, so dev rule 7 holds.
- The existing "Care Plan" menu is **not** relabeled (Q4). The new screen is **"Client Care Plans
  (IPOS)"**, visible only where the office's `care_plan_module_enabled` flag is on (Q3). One active plan per client; prior plans
retained as history. Per Bren (Sep 30), **old authorizations and IPOS plans are kept, not
deleted** — the "folder" of superseded records — which this versioning already provides.

### 2.3 Service authorizations (Layer B) — the single source of truth for units
`service_authorizations` (auth number, service code + modifier, CLS/Respite,
units_authorized / units_claimed / units_paid / units_available, period type,
effective/expiration, rate). **This is the spine's tie to money and the source of truth for
units.** Confirmed by Bren (Sep 30): the **Authorization form is the official record** (not
the IPOS), and all authorizations arrive through **KARE**. Plus **`progress_notes`** (one per
delivered shift) which decrement units against an authorization, with
**`progress_note_entries`** (one per objective: Notes + Data answers) — §11.3.

### 2.4 Credentialing layer (Layer B, caregiver side) — `credential_types` + extended `caregiver_certifications`, `plan_inservice_forms`, `plan_training_forms`, `plan_training_records`
`credential_types` (agency-scoped) is seeded from Lauren's checklist **including the six
background checks**.

**Corrected Oct 4 (R3):** there is no new `caregiver_credentials` table. The existing
`caregiver_certifications` (already hard-enforced: expired or unverified → blocked) is extended
additively with `credential_type_id`, `effective_date` and `entered_by`. This is the §1.4
agency-wide gate.
- Manual entry sets `is_verified = true`.
- Only the new "required credential missing" check sits behind the office's enforcement flag.
- Q17: `hr_staff` enters credentials and training forms; managers (Bren, Lauren) can do everything
  HR can and override it. `plan_training_forms` (one filled ISK training form: client, plan type,
plan effective date, goals version) with `plan_training_records` (one row per trained
caregiver: training date, method PCP/outside-PCP, primary clinician, trainer, signed date)
— the §1.3 per-client gate. **V1: agency manager enters both manually** (there is no
standard API from the online training platforms or from ISK; see §5). The per-client
training gate keys to the **IPOS training version**, not to individual services (§9.2, §11.6).

### 2.5 Notification + units-at-risk engine — one scheduled job, five sources
A single scheduled task reads expiration dates across **five** sources — caregiver
credentials (trainings and background checks), plan training records, service
authorizations, plan next-review dates, and expiring intake documents — and fires 60/30-day
alerts, plus a **units-at-risk** calculation (units_available ÷ days-to-expiration vs.
delivery pace). One engine because all five share the same shape: an effective date, an
expiration date, and a party to notify (supervisor **and** caregiver for credentials). This
is roadmap bullets 4 and 5. **Per §9.1, units-at-risk is a proactive booking prompt, not
just a passive warning** — Ripple actively calls families to use remaining hours before
they expire, so the alert should surface bookable remaining units, not merely flag risk.

**V1 scope (owner decision R9, Oct 4):** the dashboard shows these as **computed status**, with
expiry thresholds yellow ≤ 60 days, red ≤ 30 days, ★ overdue (Q16, fixed). **Sending**
notifications to supervisor and caregiver is a later phase, not part of Phases A–D.

### 2.6 The matching gate — extends `check_assignment_eligibility`, does not replace it
The eligibility engine we built for scheduling already returns hard/soft/advisory, and is
called by the existing **Manual / Smart / Auto Assign** paths. We add **hard** rules: (a)
the caregiver's required agency-wide credentials are current; (b) a signed
`plan_training_record` exists for this client's **current IPOS training version**; (c) the
client has an active authorization with **units remaining** for the service being
scheduled. Same mechanism as the office-scope Rule B already shipped — no parallel system.
Every assign path inherits the new rules for free because they all call the one engine.
This is roadmap bullet 3.

The **manager dashboard** (bullet 6, Lauren's three-panel command center) is then a *read
layer* over all of the above: one panel for caregiver credential expirations (trainings
and background checks), one for clients (pending/missing intake documentation +
authorization expirations with units at risk), one for scheduling (missing coverage). It
visualizes; it does not compute.

---

## 3. The duplication decision: authorization source of truth

The IPOS embeds authorizations **and** there are standalone Authorization forms for the
same services. If both write their own copy of "units authorized," the two drift and the
units engine can't trust either. Resolution, **confirmed by Bren (Sep 30)**:

**`service_authorizations` is the single source of truth. The standalone Authorization
form (received through KARE) is its authoritative origin; the IPOS *references* it, it does
not duplicate it.** Bren: "Authorization form" is the official record for authorized units.

Evidence for this direction from the documents: the standalone forms carry the auth number,
rate, amount, and *Authorizing Agent Notes* (e.g. "authorizing per plan approval") — i.e.
they are the funder's act of authorizing. The IPOS reflects the result. So an authorization
row is created/updated from the Authorization-form adapter (§5), and the IPOS's
authorization section is a read-through view keyed by auth number. **Lines in the IPOS
authorization block that belong to other providers** (Case Management, outpatient
assessment, etc.) are stored as reference-only `care_plan_external_services` and never touch
units or scheduling. In the UI, the authorization + its services live **inside the IPOS
tab** (§9.2), not on a separate tab — matching how Lauren drew it.

---

## 4. Template versioning & snapshot strategy — THE footgun for Claude Code

This section is called out separately because it is the one place a naive implementation
silently corrupts historical records. It answers the question raised directly: *if a
manager edits a template, does the template need versioning like Care Plan, and won't
version drift break authorizations already filled with the old template?*

**Two distinct kinds of versioning, which must not be conflated:**

- **Care Plan versioning = data versioning (Layer B).** A client's real IPOS history (v1
  last year, v2 this year). Different *values*.
- **Template versioning = structural versioning (Layer A).** The manager adds/removes/
  renames a field in a shell. Different *shape*, for no specific person.

**The drift failure, concretely:** manager fills Client A's authorization with template v1
(8 fields incl. `rate`). Manager then edits the template — removes `rate`, adds `modifier`
— now v2. Client B is filled with v2. If the template were overwritten in place, opening
Client A's *old* record would try to render it with v2's shape: `modifier` never existed
for A, `rate` is orphaned. The record appears broken or lossy. **This is exactly the
"version зөрөх" risk.**

**The fix — three rules, all mandatory:**

1. **Templates are append-only-versioned, never overwritten.** Editing a template creates a
   new `form_template_versions` row (v1, v2, v3…). Exactly one version is `is_current`
   (used for *new* records); older versions are retained, never deleted.

2. **Every filled record records the template version it was filled with** —
   `template_id` + `template_version` on every Layer B row (care plan, authorization,
   progress note, training form, client document). Client A's row says "filled with v1" and
   renders with v1's shape; Client B's says "v2." Two records, two versions, each renders
   correctly, no drift.

3. **Filled records snapshot the field definitions at fill time** (`field_snapshot` jsonb
   on the record, beside `field_values` jsonb holding the template-governed values). This
   is belt-and-suspenders over rule 2: even if a template version is later hard-deleted or
   the whole template is removed, the historical record keeps its own frozen structure.
   **Required for authorizations specifically** — a past authorization is an audit and
   billing artifact and must be immutable after the fact.

**Instance content stays fully editable.** The snapshot freezes the *shape*, not the
client's values: a manager edits this client's IPOS content freely on the Client Care Plan
page; only the provenance badge ("built from IPOS template v4") is read-only. A client
record can be re-shaped onto a newer shell only by an explicit "upgrade to template vN"
action that writes a new snapshot — never silently.

**Why this doesn't threaten the engine:** the smart-schedule and notification engines never
read the template. They read the **fixed spine columns** on `service_authorizations`
(`units_authorized`, `units_available`, `effective_date`, `expiration_date`),
`care_plans` (`training_version`, `next_review_date`, `status`), and the credential tables.
Those columns are template-independent and always present. The template governs only the
*manager-facing form and rendering*; the engine's inputs are stable by construction.
**This is the core safety: flexible form on top, fixed spine underneath, so template edits
can never break scheduling or alerts.**

---

## 5. Authorization input adapters — one spine, many intake routes

Confirmed by research and by Bren (Sep 30): ISK runs a provider system called **KARE**,
and **all Ripple authorizations come through KARE**; ISK also accepts electronic billing
via the **837 EDI** standard and maintains a SharePoint provider portal. There is **no open
public authorization API**, and CMH systems differ by county (ISK = KARE; others may use
PCE, Streamline, etc.). The only true industry-wide standard is **837/835 EDI** (claims /
remittance).

**Design principle: many intake routes, one canonical `service_authorizations` object.** An
input-adapter layer normalizes each route into the same spine row:

| Adapter | Route | Priority | Notes |
|---|---|---|---|
| **Manual smart form** | Manager reads the authorization (from KARE) and fills the template | **V1 — required** | How authorizations are worked today. Non-negotiable first build. |
| **Document upload + parse** | Upload PDF/DOCX → auto-extract auth #, units, dates → manager confirms | V2 | Speeds up manual entry; manager still verifies. |
| **837 / 835 EDI import** | Standard EDI file from a CMH | V3 | Standard, so one build serves many CMHs. |
| **KARE connector** | Direct ISK/KARE integration | Target | Now confirmed as Ripple's real source. Built when the volume and KARE's integration terms justify it; different per CMH, never built first. |

All four write the **same** spine row with the same validation. The engine is indifferent
to which adapter produced the row.

---

## 6. Schema sketch (indicative — exact DDL is Claude Code's build step)

All tables carry `agency_id` **and** `virtual_office_id`, or derive them through a parent helper.
**Corrected Oct 4 (R7):** RLS uses the **live** M-Office predicate,
`NOT is_office_restricted(auth.uid()) OR virtual_office_id = current_virtual_office_id()`, plus the
agency and M-SEC-1 staff checks. That differs from the earlier `current_virtual_office_id() IS NULL`
wording.
- Staff policies are SELECT-only; writes go through RPCs.
- Caregivers read only through scoped RPCs.
- Clients and anon get nothing.

See schema plan §2.1. All new `SECURITY DEFINER` functions: **REVOKE ALL FROM PUBLIC, anon before
GRANT** (CLAUDE.md #14), and no changed-signature `CREATE OR REPLACE` (the overload footgun
that reopened anon EXECUTE twice already this project). `LANGUAGE sql` bodies: column must
exist *before* the function in migration order (the Phase 0 ordering footgun).

```
-- ===== Office settings (Oct 4: R8/Q1, Q3, Q11) =====
virtual_office            + compliance_enforcement_enabled bool DEFAULT false   -- admin-only (guard trigger)
                          + care_plan_module_enabled bool DEFAULT false         -- menus/dashboard only
                          + billing_week_start smallint DEFAULT 1 (Monday)
office_service_types      (id, agency_id, virtual_office_id, care_type_code, service_type)  -- R2

-- ===== Layer A: agency shells (Configuration → Form Templates) =====
form_templates            (id, agency_id, virtual_office_id, name,
                           kind[ipos|authorization|progress_note|training|intake|credential],
                           intake_doc_type, is_active, created_by, ...)
form_template_versions    (id, template_id, version int, is_current bool, sections jsonb,
                           note_layout jsonb,      -- progress_note shells only: header/footer fields, billing footer on/off (§11.3)
                           created_by, created_at) -- append-only; exactly one is_current per template
form_template_fields      (id, template_version_id, field_key, section, label, field_type,
                           storage[spine_column|child_rows|field_value|static_text],
                           writes_to_entity, writes_to_column, shown_on_progress_note bool,
                           default_value, required, sort_order, options jsonb)

-- ===== Layer B: client instances (Client Care Plan page) =====
-- every instance row: template_id, template_version, field_snapshot jsonb, field_values jsonb
care_plans                (id, agency_id, virtual_office_id, client_id, version int,
                           status[active|superseded|expired], plan_type[initial|annual|addendum],
                           meeting_date, effective_date, expiration_date, next_review_date,
                           review_frequency, training_version int, michicans_date,
                           facilitator_name, recorder_name, discharge_criteria,
                           template_id, template_version, field_snapshot, field_values, ...)
care_plan_goals           (id, care_plan_id, seq, goal_text, target_start, target_end)
care_plan_objectives      (id, goal_id, letter, seq, objective_text, staff_instructions,
                           service_type, responsible_party, target_start, target_end)
care_plan_objective_needs (objective_id, treatment_need_id)            -- link (§11.3)
measure_types             (id, agency_id, key[yes_no_na|prompt_level|graded_steps|tally|trials|
                           short_answer|narrative|staff_note], label, default_options jsonb)  -- the measure library (Layer A)
objective_measures        (id, objective_id, seq, measure_type_id, prompt_text, options jsonb,
                           trial_count, is_active)                       -- per client objective; set by Bren
care_plan_attendees       (id, care_plan_id, name, relationship, attended, contributed)
care_plan_needs           (id, care_plan_id, source[michicans|other], item_kind[need|centerpiece_strength|strength_present],
                           domain, item_text, level_of_need, addressed bool, additional_info)
care_plan_treatment_needs (id, care_plan_id, domain, to_address bool, new_need bool,
                           treatment_recommendation)
care_plan_dsm_recommendations (id, care_plan_id, service, outcome_code, notes)
care_plan_natural_supports (id, care_plan_id, name, support_type[natural|professional],
                           status, how_they_help)
care_plan_external_services (id, care_plan_id, provider_program, auth_reference, service,
                           effective_date, expiration_date, units_text, description)  -- reference only
care_plan_reviews         (id, care_plan_id, review_date, next_review_date, notes)

service_authorizations    (id, agency_id, virtual_office_id, client_id, auth_number,
                           service_code, modifier, service_type[cls|respite|...],
                           units_authorized, units_claimed, units_paid, units_available,
                           period_type[per_week|per_auth|per_quarter|...], unit_minutes,
                           rate, amount, effective_date, expiration_date, service_description,
                           source_adapter[manual|doc|edi|connector], template_id,
                           template_version, field_snapshot, field_values)   -- SINGLE SOURCE OF TRUTH for units
progress_notes            (id, agency_id, virtual_office_id, client_id, shift_id, authorization_id, caregiver_id,
                           note_kind[cls|respite], narrative_text, billing_batch_id,
                           service_date, scheduled_start, scheduled_end, client_arrived_at, actual_end,
                           arrived_late (derived), staff_client_ratio, location, billable bool, units_scheduled,
                           units_used (derived), status[draft|submitted|returned|reviewed|billed],
                           completed_on, staff_signature_name, staff_signed_at, returned_reason/by/at,
                           reviewed_by, reviewed_at, biller_name, billed_at,
                           training_version, template_id, template_version, field_snapshot, voided bool)
progress_note_entries     (id, progress_note_id, objective_id, notes_text, data jsonb,   -- answers keyed by objective_measure
                           measures_snapshot jsonb)                                     -- questions as asked that visit
billing_batches           (id, agency_id, virtual_office_id, week_start, week_end,
                           status[open|reviewed|billed], reviewed_by, reviewed_at, billed_at, export_ref)
plan_inservice_forms      (id, agency_id, virtual_office_id, client_id, care_plan_id, training_version,
                           case_manager_name, ripple_trainer_id, trained_on, signed_at,
                           template_id, template_version, field_snapshot, field_values)   -- step 1 of training
client_documents          (id, agency_id, virtual_office_id, client_id, doc_type, version,
                           status[missing|pending|complete|expired|not_applicable], effective_date,
                           expiration_date, template_id, template_version, field_snapshot,
                           field_values, file_ref)                           -- intake track (§11.5)

-- ===== Layer B: caregiver instances =====
credential_types          (id, agency_id, name,
                           category[background_check|annual_online|annual|in_person_recert],
                           valid_months, required bool)
caregiver_certifications  EXISTING table, extended (R3): + credential_type_id, effective_date,
                           entered_by   -- expiry = existing expiry_date; manual entry sets is_verified
plan_training_forms       (id, agency_id, virtual_office_id, client_id, care_plan_id,
                           training_version, plan_document_type, plan_effective_date, location,
                           template_id, template_version, field_snapshot, field_values)
plan_training_records     (id, training_form_id, agency_id, virtual_office_id, caregiver_id,
                           client_id, care_plan_id, training_version, training_date,
                           training_method[pcp_meeting|outside_pcp], primary_clinician_name,
                           trainer_name, signed_date, entered_by)   -- gates matching per goals version
```

**Units-remaining is derived, not stored loosely:** `units_available` is maintained by the
`progress_notes` decrement path (a trigger or the note-write RPC), the same "derived value
enforced by one write path" discipline used for `shifts.caregiver_id`. Never let two code
paths write it.

---

## 7. Integration with smart scheduling & notifications

**Scheduling reuses the existing engine end to end.** The Manual / Smart / Auto Assign paths
and the Schedule Management module stay as they are; they already call
`check_assignment_eligibility`, so the only change is new rules inside that one function.
**New HARD rules — same jsonb hard/soft/advisory contract, no new mechanism:**
- Client has an active `service_authorization` (today within effective–expiration) for the
  service being scheduled — else hard block.
- `units_available` ≥ units this shift would consume — else hard block (delivering
  unauthorized units = unpaid work).
- A signed `plan_training_record` exists for this caregiver + client + the client's
  **current IPOS training version** — else hard block.
- Caregiver's `required` credentials (trainings and background checks, recorded in
  `caregiver_certifications` with a `credential_type_id`) are all present and current. Else hard
  block when the shift's office has `compliance_enforcement_enabled`; advisory otherwise. The
  existing expired/unverified certification rule is unchanged (R3).
- All four new rules are advisory while the office flag is false (R8/Q1). Caregiver-facing
  `detail` for these codes is caregiver-safe, with no authorization numbers or units (R6).

**The in-client Scheduling view is a summary, not a second scheduler.** The Client Care
Plan's Scheduling tab shows this client's upcoming shifts and the caregivers trained/
effective for this plan, and **links out to the existing Schedule Management module** for
the real gap-filling and workload balancing (§9.2). Its "Assign" buttons open the existing
assign flow pre-filtered to this client; they do not implement assignment themselves. It
must not duplicate that module (CLAUDE.md dev-rule 7).

**Notification engine — one scheduled task, five expiration sources + one at-risk metric:**
- 60/30-day alerts for: caregiver credentials (trainings + background checks), plan
  training records, authorizations, plan next-review dates, expiring client documents.
- Units-at-risk: `units_available` vs. days-to-`expiration_date` vs. recent delivery pace →
  "authorization will expire with N unused units" (the revenue-protection alert), surfaced
  as a **bookable-hours prompt** per §9.1.
- Reuses the existing `pending_notifications` / event infrastructure; office-scoped so a
  Tier-3 manager sees only their office's alerts. Credential alerts go to **both** the
  supervisor and the caregiver (`IMG_1295`).
- **V1 (R9, Oct 4):** computed status on the dashboard only. Sending is a later phase. Note:
  `pending_notifications` is agency-wide by design (M-Office §6.3), so office-scoped alerts need
  their own design then.

---

## 8. Done-definition (two tests, not a code review)

Mirrors M1/M-Office discipline — real accounts, real JWTs, real RLS through PostgREST,
disposable fixtures, teardown verified by re-query.

1. **Template-version isolation & no-drift test:** create template v1, fill Client A's
   authorization; edit template → v2, fill Client B; confirm A still renders with v1 shape
   and B with v2, both intact; hard-delete v1 and confirm A *still* renders from its
   `field_snapshot`. Proves §4. Extended (Oct 1) to: editing Client A's *values* never
   creates a template version, and editing an intake document never bumps the care plan.
2. **Units-enforcement test:** an authorization with N units remaining; schedule shifts
   consuming units; confirm the (N+1)th assignment is **hard-blocked** by
   `check_assignment_eligibility`, and that a progress note correctly decrements
   `units_available` via the single write path. Cross-office and cross-agency attempts
   rejected (M-Office regression). Proves §2.6 + §6's derived-units path.

Only once both pass is the module's core mechanism proven; the manager UI (template
builder, care-plan list, credential entry, three-panel dashboard) and Lauren's UX/UI models
build **on top of** proven mechanism, not before it — same sequencing lesson M1 taught.

---

## 9. Flagged decisions

**Resolved by Bren Mumbower (Sep 30, 2026):**
- **Authorization canonical source** → the **Authorization form** (not the IPOS) is the
  official record for authorized units.
- **How authorizations arrive** → **all through KARE** (the ISK provider portal). Orders
  the adapter roadmap (§5); the KARE connector is the eventual target, V1 stays manual.
- **Same-service multi-auth draw** → **oldest valid authorization first** (FIFO), kept as
  long as it is still valid for billing; old authorizations and IPOS are retained in a
  "folder" (§2.2).
- **Late-arrival billing** → 5 minutes late loses the full 15-minute unit (§9.1).
- **Training re-attestation** → the team is **retrained whenever the IPOS goals change**,
  not merely on annual renewal. Training keys to the **IPOS training version** (§9.2).

**Still open (none block design; the full Oct 1 list for Bren/Lauren is §11.8):**
- Whether an **IPOS-only authorization** (no standalone form) can ever exist; if so the
  IPOS adapter must be able to create an authorization row, not only reference one. Design
  already allows `service_authorizations` to be written from either adapter.

## 9.1 Confirmed operating rules (billing & draw — from Ripple)

1. **Late arrival loses the first 15-minute unit (corrected Oct 1 with Bren).** If the client
   arrives late (Bren: 5 minutes), the **first** scheduled 15-minute unit is not billable; the
   rest of the visit bills normally — e.g. 1:00–2:00 PM scheduled = 4 units, client late →
   **3 units billed**. The note captures `scheduled_start`, `client_arrived_at` (entered by the
   caregiver, Q9; late = more than 5 minutes), `actual_minutes`;
   the write path sets `units_used = units_scheduled − 1` when late. The lost unit is shown in
   the dashboard and Weekly Billing ("units lost to late arrival").

2. **Oldest-expiring authorization first (FIFO by expiration).** When a client has more than
   one authorization for the *same* service, units draw from the **oldest valid** one first
   — Ripple's active revenue-protection practice (they call families to use hours before
   they expire). The **CLS-vs-Respite** choice is *not* a draw-rule question — the scheduled
   service fixes which authorization type a session bills against; only the same-service
   multi-auth case needs FIFO.

## 9.2 Confirmed UX & structural decisions (Sep 30, 2026; corrected Oct 1)

These shape the Client Care Plan screen and the data model, confirmed with the user against
Lauren's hand-drawn mockups and Bren's answers.

1. **Everything is template-driven — nothing is hard-coded.** The IPOS, Goals, Service
   Notes, Training form, and intake documents the manager sees are all **instances of
   agency shells** from §2.1. A client's record renders from the **template version it was
   filled with**; editing a shell makes a new version and never alters existing records
   (§4). The prototype *shows* this with a **read-only provenance badge** on each section
   (e.g. "built from IPOS template v4 · filled for this client"). **Corrected Oct 1:** the
   badge is informational only — it does **not** link to editing the template. Editing
   shells happens only in Configuration → Form Templates (§11.1). Intake documents are
   **6 dynamic form types** on their own track (§11.5).

2. **Authorization is not its own tab — it lives inside the IPOS.** Matching Lauren's
   drawing, the **IPOS tab** holds the authorization list (effective/expiration) and the
   **Services** table (Service · Authorized · Billed · Remaining · At-risk), plus the
   MichiCANS recommendations, needs domains, and treatment needs. Clicking a service (e.g.
   CLS) opens its goals. Other providers' authorization lines appear as a collapsed
   reference list, never in the units table.

3. **Goals is its own tab, between IPOS and Progress Notes.** It lists goals **grouped by
   service** ("CLS — goals"; "Respite — no goals"), each goal with its objectives and
   *Instructions for Staff*, in **sequence order (1, 2, 3…) which is preserved**. Selecting
   a goal or objective does **not collapse the others** — the full list stays visible and
   the selected item is highlighted in place, loading that objective's data questions and recent visits beside
   it. Service naming is **generic (from data)**, not hard-coded "CLS Goals." **Corrected
   Oct 1:** the service/responsible party lives on the **objective**, not the goal (one IPOS
   goal mixes a CM objective with a respite objective). The tab groups by the objectives'
   service; objectives delivered by other providers show under "Other providers —
   reference", not on the progress note.

4. **One note per visit (shift).** CLS visit → **CLS Progress Note**: header, one block per
   Ripple objective (ISK Instructions for Staff shown from the IPOS; Notes; Data = the
   objective's questions), billing footer. Respite visit → **Respite Progress Note**: header,
   session narrative, billing footer. CLS and respite are never combined in one visit. Status:
   draft → submitted → reviewed → billed (weekly), plus **returned** (Q10). A reviewer never edits
   a submitted note; they return it with a reason, and the caregiver corrects and re-submits.
   - The caregiver records the **client's arrival time** on the note (Q9). Late = more than
     5 minutes, and the first 15-minute unit is not billed.
   - Due the day of or the day after.
   - Printable, always with a **wet-signature line** (Q5).
   - Group session = one shift per client in the same slot, so one note per client (R1).

5. **Per-client training gates on the IPOS version, not per service.** A caregiver is
   "trained for Client J.R. — IPOS v2." Every new IPOS version (annual renewal or goals change)
   bumps `training_version` and requires: (1) In-service form — CM trains Bren, Bren signs;
   (2) Training form — Bren trains each caregiver. Respite training follows the same two steps.

6. **The in-client Scheduling tab is a summary that links to the real module.** It shows
   this client's shifts and the caregivers who can deliver, with a **search + filter whose
   default is "Trained / effective"** (only caregivers trained on this IPOS training version
   with current credentials), and an "Open full Schedule Management →" link. It does not
   re-implement the existing Schedule Management module or the Manual/Smart/Auto Assign
   engine (dev-rule 7).

## 10. What this plan deliberately does not do

Apply any schema/RLS/RPC/data change. Seed any real content from the redacted documents.
Build the manager UI or dashboard (gated on §8 passing). Build any input adapter beyond the
V1 manual form. Decide §9's / §11.8's open flags. Touch Kind Care or any table already
confirmed correct in M1/M-Office beyond adding the new office-composition clause on the new
tables. Build a second scheduler.

**Next step, on approval:** (per the agreed order) this document → detailed schema/migration
set for Claude Code → UX/UI models for the manager surfaces → backend build, migrations
shown for review before push, then the two §8 tests.

---

## 11. Template model: agency shells vs client instances (added Oct 1, 2026)

### 11.1 The two layers, named

| | **Layer A — Agency shells** | **Layer B — Instances** |
|---|---|---|
| What | The blank structure: sections, fields, option lists, static text, storage mapping, progress-note layout, measure library | One filled record for one client (or one caregiver) |
| Tables | `form_templates`, `form_template_versions`, `form_template_fields` | `care_plans` + children, `service_authorizations`, `progress_notes` + entries, `objective_measures`, `client_documents`, `plan_training_forms`/`_records` |
| Where in the UI | **Configuration → Form Templates** only | **Client Care Plan page** (and the Caregiver page for training) |
| Who edits | Agency manager / admin, rarely | Manager per client, routinely |
| Versioning | Structural: v1, v2, v3 — append-only, one `is_current` | Data: plan version, `training_version`; each row carries `template_id` + `template_version` + `field_snapshot` |
| Editing effect | New shell version; **never** rewrites an instance | Changes this client's values; **never** touches a shell |

The kinds of shell: **IPOS**, **Authorization**, **Progress Note** (header, objective block, billing footer), **Measure library** (data question types),
**Training form**, **Intake** (one shell per intake document type). The Client Care Plan
page never shows an "edit template" action — only a read-only provenance badge.

**Flow.** Manager starts a new IPOS → the system loads the current IPOS shell (e.g. v4) →
the manager fills and edits this client's content in that shape → on save the record stores
`template_id = IPOS`, `template_version = 4`, the `field_snapshot`, and the values. Later
edits to that client's content are ordinary edits on the instance.

**Three storage kinds per field** (declared on the shell field as `storage`):
- `spine_column` — a fixed column the engines read (dates, units, goals version). Shell can
  relabel it, never remove it.
- `child_rows` — a repeating structure stored in a child table (goals, objectives, needs,
  attendees, supports).
- `field_value` — template-governed narrative or select value in `field_values` jsonb,
  rendered via `field_snapshot`.
- `static_text` — boilerplate that lives only on the shell (appeal rights, attestation,
  MichiCANS copyright notice). Copied into the snapshot so a printed historical IPOS shows
  the text that was in force.

### 11.2 IPOS section map — shell vs instance vs progress note

Legend: **S** = defined on the shell (structure, options, static text). **I** = this
client's value. ✔ = shown on the progress note.

| IPOS section | Shell (S) defines | Instance (I) stores | Storage | On progress note |
|---|---|---|---|---|
| Identifying information | Which client fields to show | — (read from the client record) | client record | — |
| Service, meeting date, time | Labels | Values | `care_plans` columns | — |
| Plan effective / expiration date | Labels, required | Dates | spine columns | — |
| Facilitator, recorder | Labels | Names | `care_plans` columns | — |
| Planning meeting attendees | Columns (name, relationship, attended, contributed) | Rows | `care_plan_attendees` | — |
| Desired outcomes (hopes & dreams) | Prompt text | Narrative | `field_values` | — |
| Strengths | Prompt | Narrative | `field_values` | — |
| Needs | Prompt | Narrative | `field_values` | — |
| Abilities | Prompt | Narrative | `field_values` | — |
| Preferences | Prompt | Narrative ("None reported" allowed) | `field_values` | — |
| MichiCANS DSM service recommendations | Outcome-code option list (01 aligns & integrated, 03 recommended & declined, …), staleness notice | MichiCANS date, service → outcome rows, notes | `michicans_date` + `care_plan_dsm_recommendations` | — |
| Needs identified by MichiCANS | Domain list, level-of-need options | Domain, level, items, centerpiece strengths / strengths present, addressed flag, additional info | `care_plan_needs` (`source=michicans`) | — |
| Other needs not identified by MichiCANS | Domain list (Life Functioning, Cultural Factors, Risk Factors & Behaviors, Caregiver Resources & Needs) | Action / additional info per domain | `care_plan_needs` (`source=other`) | — |
| Treatment-needs grid | The 18 domain rows (Relationships, Current Living Environment, … Safety/Risk Factors, Natural Supports) | To-address ☐, new-need ☐, treatment recommendation | `care_plan_treatment_needs` | — (reference; links needs to objectives) |
| Goals | Goal block structure, date labels | Seq, goal text, target dates | `care_plan_goals` | ✔ goal heading |
| Objectives | Letter scheme, date labels | Objective text, dates, **service**, **responsible party** | `care_plan_objectives` | ✔ block heading + service tag |
| **Instructions for Staff** | Label | Instruction text per objective | `care_plan_objectives.staff_instructions` | ✔ shown read-only as "ISK Instructions for Staff" |
| Strengths that help / barriers | Prompts | Narratives | `field_values` | — |
| Natural supports | Columns, type options | Rows | `care_plan_natural_supports` | — |
| Authorizations — this agency's lines | Columns | **Read-through** of `service_authorizations` (by auth #) | `service_authorizations` | units scheduled/billed (billing footer) |
| Authorizations — other providers' lines | Columns | Reference rows | `care_plan_external_services` | — |
| Adverse benefit determination type | Options (Medicaid / Non-Medicaid) | Choice | `field_values` | — |
| Crisis prevention plan | The three options | Choice | `field_values` | — |
| Periodic review schedule, next review date | Frequency options | Frequency, date | `review_frequency`, `next_review_date` (spine) | — |
| Transition / discharge criteria | ISK default text | Text (may keep default) | `discharge_criteria` | — |
| Estimated cost of services | Explanatory static text | Range (derived from authorizations when available) | `field_values` | — |
| Appeal rights, signature attestation | Static text | Signer, signed date | `static_text` + signature columns | — |

### 11.3 Progress Note model (settled Oct 1 pm; replaces the derived checklist)

**One note per visit (shift).** A `progress_notes` row is created from the shift (date,
scheduled start/end, units scheduled, caregiver, client, service = CLS). The caregiver fills
it; one `progress_note_entries` row per Ripple objective on the client's current plan.
Respite shifts create a **Respite Progress Note** instead (header + session narrative, no
entries). Respite is never recorded on the CLS note.

**What each objective block shows and collects:**
1. Goal heading, objective text, service tag — from the IPOS.
2. **ISK Instructions for Staff** — from the IPOS, read-only (may be empty).
3. **Notes** — free text ("include reinforcers").
4. **Data** — the objective's `objective_measures`, each an instance of a library
   `measure_type`:

| Measure type | Caregiver answers | Seen in |
|---|---|---|
| `yes_no_na` | Yes / No / N/A | all three notes |
| `prompt_level` | Gestural · Visual · Verbal · Modeling · Partial physical (highest used) | Note 2 |
| `graded_steps` | Tick every step tolerated without distress | Note 2 (nail clipping) |
| `tally` | Count + total | Note 2 (social interactions) |
| `trials` | n × Yes/No/N/A, each with a short answer (Activity / Strategy) | Note 3 |
| `short_answer` | One line (strategy used, activity, skill practiced) | Note 3 |
| `narrative` | Paragraph to a prompt | Note 2 |
| `staff_note` | Display-only caution/definition | Notes 2, 3 |

**Who sets the questions.** The manager / clinical lead picks measures per objective on the
Client Care Plan → Goals tab (Layer B). The **measure library** (Layer A, Form Templates) holds
the reusable types and the recurring ISK questions once. Changing an objective's measures does
**not** bump `training_version`; a new IPOS version (renewal or goals change) does.

**Snapshot.** At submit, each entry stores `measures_snapshot` (the questions as asked), so
later measure edits never rewrite a past note.

**Lifecycle.** draft (caregiver) → submitted (signed) → reviewed (manager) → billed. Units:
`units_scheduled` from the shift; `units_used` set by the late-arrival rule (§9.1); the
units trigger counts only billable, non-voided notes. Billing footer and batching **pending
Lauren** (§11.8).

**Retired:** the derived checklist (`care_plan_checklist_items`, `checklist_rule`,
`seeds_checklist`, `service_notes.checklist_state`). The progress-note data questions cover
the "repeated ISK questions" idea directly.

### 11.4 Vocabulary (settled)

- **"Instructions for Staff"** is the one label — it is the IPOS's own heading, so it
  matches what ISK, Ripple, and the caregiver already read. Column: `staff_instructions`.
  An office may change the word "Staff" via its display label, as with the role name.
- Retired: "trainer guidance", "clinical team guidance", "specialist guidance". "Trainer"
  is reserved for the person named on the ISK training form (CM / Primary Clinician).
- Role: **Caregiver** in schema and default UI (settled). Ripple may display "DSP" or
  "Specialist".

### 11.5 Intake documents — their own track

- **Types (6 + 1):** Consent for Treatment, Insurance form, Emergency contacts, Allergies,
  Assessment, Release of Information, plus (Q7, Oct 4) **Safety / behavior plan**
  (`safety_behavior_plan`). It may be marked **not applicable** with a reason, which counts as
  complete for onboarding item ⑤. Lauren's screen (`IMG_1296`) lists IPOS and the
  Training form in the same folder and **strikes "Summary page"** — so Summary page is
  dropped, and IPOS / Training form appear in the client's document list but are versioned
  on their own tracks.
- Stored in `client_documents` (one row per document version), each an instance of its own
  intake shell. **Updating an intake document never bumps the care plan's version or
  `training_version`, and an IPOS renewal never re-versions intake documents.**
- `status` (missing / pending / complete / expired) feeds the dashboard's "Clients pending —
  missing documentation" panel. Which types are required is set per agency on the shells.
- Claude Code checks for an existing client-document table first and extends it rather than
  adding a parallel one (dev-rule 7).

### 11.6 Training form — lifecycle (confirmed)

- **Shell:** the ISK 33.01_01F layout (Layer A, kind `training`).
- **Instance:** one `plan_training_forms` row per filled form (client, plan document type,
  plan effective date, goals version), with one `plan_training_records` row per trained
  caregiver (training date, PCP-meeting vs outside-PCP, primary clinician, trainer, signed
  date).
- **When filled:** (a) before a caregiver's first assignment to a client; (b) every time the
  IPOS **goals version** changes (Bren). A goals change invalidates prior records for that
  client and the eligibility engine hard-blocks until retraining is recorded.
- **Where seen:** Caregiver page → "Training for patient" (per client); Client Care Plan →
  Scheduling tab filter "Trained / effective"; dashboard training deadlines.
- **Plan types on the form** include Behavior Support Plan and Protocol — training can be
  recorded against those documents too (`plan_document_type`); only IPOS training gates
  scheduling in V1.

### 11.7 Build approach (settled)

- **Client Care Plan = new UX** (IPOS / Goals / Progress Notes / Scheduling tabs).
  - **Corrected Oct 4 (R4):** it sits over a **new `care_plans` spine**.
  - The existing `client_orders` service schedule is left as it is (linked by a nullable
    `care_plan_id`), because it is a shift generator, not a plan of service.
  - The two tables have different jobs and no shared field, so this is not a parallel system.
- **Scheduling = the existing Schedule Management module + Manual / Smart / Auto Assign
  engine**, unchanged except the additive hard rules inside `check_assignment_eligibility`
  (behind the rollout flag in the schema plan §7). Honors "Preserve ALL existing scheduling
  functionality" (CLAUDE.md).
- Backend order unchanged: Phase A schema → B RPCs → C eligibility → D tests; UI after.

### 11.8 Questions sent Oct 1 — answered by Bren the same day

All answers are recorded in §12. Nothing from that email remains open except **electronic
signature**, which Ripple will confirm itself.

## 12. Bren Mumbower's answers (Oct 1, 2026) — confirmed decisions

| Topic | Decision | Effect on the build |
|---|---|---|
| Note per visit | One note per session (shift); all of the client's objectives in it; goals the same every session until the IPOS changes | `progress_notes` 1:1 with shift × client |
| CLS vs respite | Never combined in one visit | a shift has exactly one service |
| Data questions | Keep Ripple's current questions; Bren enters ISK goals and sets the questions | Goals tab: Bren edits objectives + measures |
| Additional observation | Dropped (user decision) | no `progress_note_observations`, no promote flow |
| Retraining | Every new IPOS version, including annual renewal with unchanged goals; CM → Bren (In-service form, signed) → staff (Training form) | `training_version`; `plan_inservice_forms` + `plan_training_forms` |
| Respite | Own **Respite Progress Note** per visit: header + session narrative + staff signature; no goals; trained like CLS | `progress_notes.note_kind = 'respite'`, `narrative_text` |
| Billing footer | Being added to all notes | always on |
| Billing cadence | Weekly; Bren and Lauren bill; Bren reviews every bill; spreadsheet today | **Weekly Billing** screen + `billing_batches` |
| Late arrival | First 15-min unit lost (4 → 3) | `units_used = units_scheduled − 1` |
| Completion deadline | Day of the visit or the day after | overdue-note alert on dashboard |
| Group sessions | One note per client | unique (shift, client) |
| Where notes live | Kept at Ripple unless ISK requests | print / PDF export now; e-archive later |
| E-signature | Ripple will confirm | sign = typed name + timestamp for now; printable for wet signature |
| Dollar allocations | Units only | no `allocation_basis` |

**Build-detail notes added Oct 4 (owner decisions). The workflow decisions in the table above are
unchanged:**
- **Group sessions:** the build effect is one shift per client in the same slot, with a note unique
  **per shift** (R1). That still gives one note per client. No `shift_clients` junction.
- **E-signature:** typed name + timestamp, and every printout carries a wet-signature line (Q5).
- **Who records lateness:** the caregiver enters the client's arrival time on the note (Q9).
- **Review:** a reviewer cannot edit a submitted note and returns it instead (Q10).
- **Caregiver note screen (R5):** own assigned shifts only; this agency's objectives +
  Instructions for Staff + measures; no needs, diagnoses or MichiCANS; one SECURITY DEFINER read.
- **Client/family view:** none in V1 (Q6).
- **Onboarding ⑤** = `safety_behavior_plan` document or "not applicable" (Q7).
- **Onboarding ⑥** "Training forms" = complete when ≥ 1 caregiver is trained on the current
  `training_version`. Per-caregiver gating stays in the eligibility engine (Q8).

**Onboarding — the 8 required items (Bren):** IPOS · Assessment · In-service form signed ·
Client forms (consent, insurance, emergency contacts, allergies, release of information) ·
Safety plan or behavior plan (if applicable) · Training forms · Authorization · CLS progress
note set up. A client is "onboarded" only when all applicable items are complete; this list
drives the dashboard's "clients pending — missing documentation".

---

### Sources
- [Integrated Services of Kalamazoo — home](https://iskzoo.org/)
- [ISK Provider Manual (KARE, 837 EDI, provider portal)](https://iskzoo.org/providers/isk-provider-manual/)
- [ISK — Our Providers](https://iskzoo.org/our-services/our-providers/)
- [ISK on Kalamazoo County site](https://www.kalcounty.gov/601/Integrated-Services-of-Kalamazoo-ISK)
- Ripple Effects source documents (redacted, workflow-model only): `Redacted_IPOS_1.docx`, `Redacted_Authorization Form_1/2/3.docx`, `2025 IPOS TRAINING FORM.pdf`, `Progress Note Example.pdf`, `Progress_Note_2.pdf`, `Progress Note 3.pdf`, Lauren's three hand-drawn screens (`IMG_1295/1296/1297.jpeg`), and the Sep 23–30 2026 emails from Lauren Williams, Elizabeth Houseman, and Bren Mumbower.

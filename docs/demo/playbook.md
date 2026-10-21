# Ripple demo playbook — Tue Oct 20, 2026, 1:00 pm Eastern

Office **Ripple Effects – Demo** (DEV, its own agency). Every step below was run through the real UI by
`tests/ripple/demo/rehearse.cjs`, with the user shown. Its screenshot is `docs/screenshots/ripple-ui/demo/playbook/NN-*.png`
(Pat and Sam at 1440 px, Ana at 390 px). Data: `tests/ripple/demo/README.md`.

**Calendar (as of Tue Oct 20):**
- This billing week is Sun Oct 18 – Sat Oct 24.
- **Last week** is Oct 11–17. It is not built yet.
- **The week before** is Oct 4–10. It is billed and locked.
- **Next week** is Oct 25–31.

## Before the demo (morning of Oct 20)

1. Run the morning commands at the end of this file. They check the data; seeding was done the evening before.
2. Open three browser windows and sign in at `/auth`. The password is `RIPPLE_DEMO_PASSWORD`; it is never written here.
   - **Window P:** Pat Morgan, program lead (`pat.morgan.rpldemo@example.com`), 1440 wide. Pat lands on the **Dashboard**.
   - **Window S:** Sam Rivera, agency admin (`sam.rivera.rpldemo@example.com`).
   - **Window A:** Ana Brooks, caregiver (`ana.brooks.rpldemo@example.com`), phone-sized. Use DevTools device mode at 390 px,
     or a phone. Ana lands on **Today**.
3. In Window A, **do not open Zoe's CLS note before part 4.** Opening the note page creates the draft. It's harmless, but
   then the "written live" moment is gone.

**Undo for anything:** `node tests/ripple/demo/seed-demo.cjs --reset` puts every state back. It takes about 3 minutes;
don't run it after 8 pm Eastern.

---

## Part 0 — Dashboard (1 min) · Window P, Pat · start page: Dashboard

| # | Click (exact) | What appears | Say | Undo |
|---|---|---|---|---|
| 0.1 | Nothing: you're on **Dashboard**. Scroll to **Care plan compliance**. *(01)* | **Last week: not yet billed · not built yet**; **Notes to review 1**; **Overdue notes 2**; **Clients pending onboarding 1** (Lily Park, 5 of 8); **Expiring credentials 3** (Mia ★ Overdue 5 days, Ben 20 days red, Ben 45 days yellow); **Units at risk 1** (Zoe, 25 units, expires in 12 days); **Caregivers needing retraining 1** (Mia, Zoe v2, Wed Oct 28); **Enforcement readiness 1** (Advisory) | "Everything that needs attention in one place, and every row opens the record where it's fixed." | — |

Don't point at the older tiles further down (e.g. "Active Care Plans 0"). They belong to the older care-plan screen, not
this module.

## Part 1 — Client onboarding (4 min) · Window P, Pat

| # | Click (exact) | What appears | Say | Undo |
|---|---|---|---|---|
| 1.1 | Sidebar **Form Templates** *(02)* | Tab **Shells**: IPOS, CLS Progress Note, Respite Progress Note, 7 intake shells | "Your paper forms become versioned shells." | — |
| 1.2 | Tab **Measure library** *(03)* | The 8 kinds of data questions | "The 8 kinds of questions on your progress notes." | — |
| 1.3 | Sidebar **Client Care Plans (IPOS)** *(04)* | List: Ella, Lily (**5 of 8**), Max, Noah, Zoe (**Onboarded**) | "Onboarding status per client." | — |
| 1.4 | Row **Lily Park** → button **Open ›** (last column; clicking anywhere on the row does the same), then tab **Onboarding & Documents** *(05)* | Badge **Onboarding 5 of 8**; missing: In-service signed, Caregiver training, Progress note set up (measures). Each row has an arrow "Go to …" | "Until all 8 are done, Lily isn't ready to schedule." | — |
| 1.5 | Link **All clients** (top left), then row **Zoe Nguyen** → **Open ›**, then tab **Onboarding & Documents** *(06)* | Badge **Onboarded**, 8 of 8 complete. Under **Intake documents**, Consent shows **Files (1)**: click it for the signed consent (a generated, fictitious PDF) → **Preview** | "The signed papers live with the document version, in private storage; every view is logged." | — |

## Part 2 — IPOS, renewal and retraining (4 min) · Window P, Pat · on Zoe's page

| # | Click (exact) | What appears | Say | Undo |
|---|---|---|---|---|
| 2.1 | Tab **IPOS** *(07)* | Header **Plan v2 active**. Under **Version history**: v2 Annual · Active, v1 Initial · **Superseded** | "The annual renewal made v2; v1 is kept as history." | — |
| 2.2 | In Version history, button **View (read-only)** on v1 *(08)* | Side sheet **Plan v1 (read-only)**, no edit buttons | "Old versions can be read, never changed." | Esc / ✕ |
| 2.3 | Scroll to **Authorizations** *(09)* | A: DEMO-AUTH-1001-A, expires in 12 days, units left. B: DEMO-AUTH-1001-B, 400, period cap 16 per week | "Units come from the authorization that expires first, so A's hours are used before they lapse. B's weekly cap is enforced." | — |
| 2.4 | Tab **Goals** *(10)* | 3 goals, objectives A–D with Instructions for Staff; C (case manager) for reference only | "In ISK's order, with the staff instructions." | — |
| 2.5 | Click the objective **1A** in the goals list *(11)* | Right panel: measures "Highest prompt level used", "Steps completed", and the **Edit measures** button | "These are the questions the caregiver answers on the note." Don't save anything here (see the lists below). | — |
| 2.6 | Sidebar **Dashboard** → in **Caregivers needing retraining**, click **Mia Lopez** *(12)* | Zoe's **Training** tab: header **IPOS v2 (Annual) training · effective … · In-service signed … · 2 of 3 caregivers trained**; In-service row; Training sessions (date, type of plan, trainer, attendees, Print); **Caregivers** roster with chips All / Trained / Needs retraining: Ana and Ben **Trained**, Mia **Needs retraining (trained v1)** with **Add to a session**; History of every version | "Every new IPOS version starts retraining, even a renewal with the same goals." | — |
| 2.7 | Sidebar **Dashboard** → in **Expiring credentials**, click **Ben Carter** *(13)* | Caregiver Details → **Credentials & Training**: Bloodborne Pathogens "Expires in 20 days" (red), Basic First Aid "Expires in 45 days" (yellow) | "HR enters these; the colours show what's due." | Esc / ✕ |
| 2.8 | Same panel, click **Mia Lopez** *(14)* | Basic First Aid **★ Overdue 5 days** | — | Esc / ✕ |

## Part 3 — Who can be scheduled (4 min) · Window P (Pat), then Window S (Sam)

| # | Window / click (exact) | What appears | Say | Undo |
|---|---|---|---|---|
| 3.1 | **P:** sidebar **Schedule** → tab **Unassigned** → arrow button **Next** (›, top right) → row **Zoe Nguyen · Thu, Oct 29** → button **Assign** → type `Mia` in "Search caregivers..." → open "Select a caregiver" → **Mia Lopez • Not eligible** *(15)* | Care-plan checks: **Advisory** "Not trained on the current plan" (Fix → Training), and **Blocked** "Expired certification" (Fix → Credentials). "This caregiver cannot be assigned" | "With enforcement off, the training check is advice. The expired credential already blocks: that's the existing scheduling rule." | **Cancel** |
| 3.2 | **S:** sidebar (Configuration) **Virtual Offices** → button **Configure** on "Ripple Effects – Demo" → tab **Compliance** → switch **Compliance enforcement** *(16)* | Dialog **Turn on compliance enforcement for Ripple Effects – Demo?** with what changes. Read it aloud | "Ripple decides when to enforce." | **Cancel** |
| 3.3 | **S:** **Turn on enforcement** *(17)* | Badge **Enforced** | "Recorded in the audit log." | step 3.5 |
| 3.4 | **P:** repeat 3.1 (Assign → Mia) *(18)* | "Not trained on the current plan" is now **Blocked** (red); **Confirm Assignment** disabled | "Now it's a rule, not advice." | **Cancel** |
| 3.5 | **S:** switch **Compliance enforcement** again → **Turn off enforcement** *(19)* | Badge **Advisory** | "Until Ripple turns it on, the checks are advice." | — |

## Part 4 — Ana writes today's note (3 min) · Window A, Ana (phone) · start page: Today

| # | Click (exact) | What appears | Say | Undo |
|---|---|---|---|---|
| 4.1 | Nothing: **Today** *(20)* | "Tuesday, October 20"; Notes due **2 to write · 1 overdue**; today's shift CLS 8:00–9:00 AM, Zoe N., button **Write progress note** | "Her day on her phone." | — |
| 4.2 | Bottom nav **Notes** *(21)* | **To do**: Max O. · Respite Thu Oct 15 **Overdue**; Zoe N. · CLS today, Not started | "Overdue means not submitted by the end of the day after the visit." | — |
| 4.3 | Bottom nav **Today** → **Write progress note** *(22)* | The note opens as a draft: arrival / end times, Location, Staff : client ratio, one block per objective with Zoe's Instructions for Staff and questions | "The plan's goals and questions, with her instructions." | — |
| 4.4 | Type arrival **08:20**, end **09:00** *(23)* | **Units to bill: 2 of 4 (late arrival: only full 15-minute blocks are billed)** | "Only full 15-minute blocks the client attends are billed." | Put arrival back to 08:00 |
| 4.5 | Arrival **08:00**, end **09:00**, Location `Zoe's home`, ratio `1:1`. Answer: prompt level **Verbal**; steps **Get supplies, Brush, Rinse**; outing **Yes**; where `Public library`; how she chose (a sentence); 3 trials **Yes / No / Yes**; **Plus one** once. Tap **Save** *(24)* | **Units to bill: 4 of 4**; footer **Saved** (it also autosaves after 2 s) | — | — |
| 4.6 | **Submit** → in "Type your full name" type `Ana Brooks` *(25)* | Sheet **Sign and submit**, attestation, signed-at time, **Submit note** enabled | "Her typed name is her signature." | Esc closes it unsigned |
| 4.7 | **Submit note** *(26)* | Toast "Progress note submitted"; **Submitted — read only** | "Once submitted she can't change it unless the program lead returns it." | reset |

## Part 5 — Review, print, Weekly Billing (5 min) · Window P, Pat

| # | Click (exact) | What appears | Say | Undo |
|---|---|---|---|---|
| 5.1 | Sidebar **Notes to Review** *(27)* | Chip **Submitted (2)**: Mia Lopez (Zoe, Wed Oct 14) and Ana Brooks (Zoe, today, just sent) | "Ana's note just arrived." | — |
| 5.2 | Row with **Mia Lopez** → button **Open ›** *(28)* | Read-only note. Scroll to the end: the **Review** panel after the goals, signature and history, with the statement "I have read this note and it matches the client's plan" and **[Print] [Return to caregiver] [Mark reviewed]**; Mark reviewed is greyed out until the box is ticked | "The reviewer reads; only the caregiver edits." | — |
| 5.3 | In the Review panel: **Return to caregiver** (no tick needed) *(29a/29)* | Dialog **Return to caregiver**: Reason, "At least 10 characters (0/10)", **Return note** disabled. Click **Cancel** | "A reason is required, and it goes back to the caregiver." | (Cancel) |
| 5.4 | Tick **I have read this note and it matches the client's plan** → **Mark reviewed** → dialog **Mark this note reviewed?** → **Mark reviewed** *(30a/30)* | Toast "Note marked reviewed"; the panel shows **Reviewed by Pat Morgan · Tue, Oct 20, <time>** with **Print** and **Undo review** | "The reviewer confirms they read it. Reviewed one at a time; last week can only be approved once nothing is waiting for review." | **Undo review** (5.4b) |
| 5.4b | *Optional:* **Undo review** → dialog **Undo this review?** → **Undo review**; then tick the box → **Mark reviewed** → confirm again *(31a/31b/31)* | Note back to **Submitted** (the units go back on the authorization), then Reviewed again | "A mistake can be undone until the week is approved; after that, Undo is greyed out with the reason." | — (ends reviewed) |
| 5.5 | Sidebar **Notes to Review** → chip **Reviewed** → row **Max O.** (respite) → printer icon **Print note** *(32)* | Ripple's paper layout: RESPITE, narrative, billing footer, signature lines | "The same paper form, filled from the note." | Link **Back to the note** (the print page has no sidebar) |
| 5.6 | **Back to the note** → sidebar **Weekly Billing** *(33)* | **Sun, Oct 11 – Sat, Oct 17**, "Last complete week", **Not built** | — | — |
| 5.7 | **Build week** *(34)* | Main bill by client and authorization: Ella, Max, Noah, Zoe (#DEMO-AUTH-1001-A: Tue Oct 13 **(late)**, Thu Oct 15 **(left early)**, units not billed 3). **Not in this week's bills (2)**: Max O. "Visit with no note", Zoe N. Fri Oct 16 "Returned — waiting for the caregiver" | "Late and early visits lose only the partial blocks; the returned note and the missing note stay out." | **Build week again** rebuilds |
| 5.8 | **Approve week** *(35)* | Dialog **Approve this week?**: 4 clients, 11 notes, 56 scheduled, 53 billed, 3 not billed | — | **Cancel** |
| 5.9 | **Approve** *(36)* | Approved banner; **Mark billed** and **Export CSV** appear | — | reset |
| 5.10 | **Mark billed** → dialog **Mark main bill billed?** ("Billing locks this bill and its notes for good.") *(37)* → **Mark billed** | Billed banner: the bill is locked | "Billed means locked." | reset only |
| 5.11 | **Export CSV** *(38)* | Downloads `ripple-billing-rpldemo-2026-10-11.csv` (units only; no client names in the file name) | "Units only, ready for the billing system." | delete the file |
| 5.12 | Arrow button **Previous week** (‹) *(39)* | Oct 4–10: **Billed**, locked, no Build button | "A note reviewed after billing goes into a supplementary bill for the same week: never into two bills." | — |

---

## Where editing works, and the exact path (all Pat unless noted)

- **IPOS header and narrative:** Zoe → tab **IPOS** → **Edit header and narrative** → **Save**. Edits in place; never changes
  the plan version or training version.
- **IPOS section rows** (Meeting attendees, Needs and strengths, Treatment needs, Supports, Reviews…): the ghost **Edit**
  button on each section card → **Save**. In place, no retraining.
- **Goals / objectives / Instructions for Staff:** tab **Goals** → **Edit goals and objectives** → **Save**. Changing goal or
  objective text asks **Save and start retraining**: that sends Ana and Ben back to "needs retraining". Show the dialog,
  then **Back**.
- **Data questions (measures):** tab **Goals** → click the objective (e.g. **1A**) → **Edit measures** → **Save measures**.
  In place, never starts retraining.
- **Authorizations:** tab **IPOS** → Authorizations → pencil **Correct DEMO-AUTH-…** (needs "Reason for the correction")
  → **Save correction**. **Add authorization** adds a new one.
- **Case number:** client header → pencil **Edit case number** → **Save**.
- **Intake documents:** tab **Onboarding & Documents** → pencil **Update <document>** → status → **Save** (adds a new version).
- **Files (S4b):** the **Files** button on an intake document, an in-service or a training session (Training tab), or a credential
  (Caregivers → Credentials & Training) → **Add files** (PDF, JPEG, PNG, HEIC photo, Word; up to 20 MB; photos are compressed).
  **Add other document** (under the intake table) adds a custom-named document. A caregiver adds a scan of their own credential
  under Profile → **My credentials**; HR sees **New upload** until they renew the entry. Demo files: Zoe's Consent and the
  IPOS v2 sign-in sheet (Training tab → sessions). Use fictitious files only.
- **Credentials:** Caregiver Details → **Credentials & Training** → **Renew** / **Enter** → expiry → **Save**. As Pat (a
  manager) over an HR entry this shows an override warning and **Save override**. Jordan Lee (HR) can't change a manager's
  entry.
- **In-service and training:** the client's **Training** tab (Dashboard → Caregivers needing retraining → a name, or
  Onboarding → "Caregiver training" →) → **Record in-service** → **Record training session** (date, trainer, attendees), or
  **Add to a session** on a caregiver who needs retraining. HR uses the same screen at `/training/<client>`.
- **Progress note:** only the caregiver, only while Draft or Returned (Window A).
- **Enforcement switch:** only Sam (agency admin). For Pat the switch is disabled: "Only an agency admin can change these
  settings."

## Do not click / why it won't work

- **IPOS v1 → View (read-only):** a superseded version has no edit controls by design.
- **IPOS → Renew:** creates Zoe v3 and starts retraining for everyone. It can't be undone without a reset.
- **Form Templates → a shell → Edit (new draft):** it doesn't edit in place; it opens a new draft version ("Save draft vN" →
  "Publish vN"). Close it.
- **A submitted note as Pat:** the reviewer can't edit it; only Mark reviewed / Return.
- **Return note** (for real) on the wrong note: there is no un-return; reset afterwards. **Mark reviewed** on the wrong note can be undone with **Undo review** while its week isn't approved.
  A reviewed note can't be returned.
- **Mark billed:** locks the bill and its notes for good. Oct 4–10 is already locked: no Build button, notes show
  "Billed — locked".
- **Build week again (reopens the approved bill):** on an approved but not billed week, this reopens the approval.
- **Next week** in Weekly Billing: disabled at the current week.
- **Assign Mia → Confirm Assignment:** disabled even with enforcement off. Her ★ expired credential blocks (existing rule).
  Use **Cancel**.
- **Ana's Notes → the overdue Max respite visit:** opening it creates a draft (it stays overdue). Leave it for the overdue
  story.
- **Zoe's CLS note before part 4:** opening it creates the draft (see "Before the demo").
- **Sidebar "Care Plan"** and the "Active Care Plans 0" tile: the older care-plan screen, not this module.
- **Smart assign:** the ranking service has had intermittent errors (match-caregiver HTTP 500). Use **Assign**.
- **The Assign dialog on a phone (390 px)** sits partly off-screen (known issue). Do scheduling in Window P only.
- **After 8 pm Eastern** the dashboard's "today" uses the UTC date (known issue). Not a factor at 1 pm.
- **The office code "RPLDEMO"** is printed under the office name on Virtual Offices and in the CSV file name. It's the
  demo office's code, not an error.

## Commands (PowerShell)

Evening before (done Oct 19; must finish before 8 pm Eastern):
```powershell
$env:RIPPLE_DEMO_PASSWORD = [Environment]::GetEnvironmentVariable('RIPPLE_DEMO_PASSWORD','User')
node tests/ripple/demo/rehearse.cjs --as-of 2026-10-19 --final-as-of 2026-10-20 *> rehearse.log
```

Morning of Oct 20 (read-only checks; nothing to reseed):
```powershell
$env:RIPPLE_DEMO_PASSWORD = [Environment]::GetEnvironmentVariable('RIPPLE_DEMO_PASSWORD','User')
node tests/ripple/demo/verify-demo.cjs *> verify.log
node tests/ripple/demo/login-check.cjs *> login.log
node tests/ripple/demo/inventory-demo.cjs *> inventory.log
```

Optional full rehearsal in the morning: after 08:00, about 10 minutes, and it resets at the end.
```powershell
node tests/ripple/demo/rehearse.cjs *> rehearse.log
```

After the demo: `node tests/ripple/demo/seed-demo.cjs --reset *> reset.log`

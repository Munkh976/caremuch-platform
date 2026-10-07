# Ripple care-plan module — 20-minute demo script (v2)
 
Office: **Ripple Effects – Demo** (DEV, its own demo agency). Data: `tests/ripple/demo/README.md`. Screenshots of every
step: `docs/screenshots/ripple-ui/demo/` (1440 and 390).
 
**Before the demo**
- Run `node tests/ripple/demo/seed-demo.cjs --reset` so the office is at its starting state (dates follow today).
- Log-in e-mails are in `tests/ripple/demo/README.md`. The password is the owner's `RIPPLE_DEMO_PASSWORD`; it is not
  written here.
- Open three browser windows, already signed in: **Pat Morgan** (program lead), **Sam Rivera** (agency admin) and a
  phone-sized window for **Ana Brooks** (caregiver).
**After the demo:** `node tests/ripple/demo/seed-demo.cjs --reset` (puts back last week's unbuilt bill, the unreviewed
note, enforcement off, and so on).
 
The demo follows the five flows of *Ripple Care Plan Workflow & Requirements v1.2*:
 
| Demo part | Requirements flow |
|---|---|
| 1. Client onboarding | Flow 1 — Client onboarding |
| 2. IPOS, renewal and retraining | Flow 2 — IPOS, renewal and retraining |
| 3. Who can be scheduled | Flow 5 — Who can be scheduled |
| 4. Visit to progress note | Flow 3 — Visit to progress note |
| 5. Weekly billing | Flow 4 — Weekly billing and units |
 
---
 
## 0. The dashboard (1 min) — Pat Morgan, program lead
**Screen:** Dashboard → "Care plan compliance". *(dashboard)*
- Point at each panel: last week not billed yet; notes to review (1) and overdue (2); Lily Park pending onboarding
  (5 of 8, what's missing); expiring credentials (Mia ★ overdue, Ben red and yellow); Zoe's first authorization
  expiring with units at risk; caregivers needing retraining; enforcement readiness (what would be blocked).
- **Say:** "Everything that needs attention in one place. Every row opens the exact record or tab where it's fixed."
## 1. Client onboarding — Flow 1 (4 min) — Pat Morgan
1. **Form Templates → Shells**, then **Measure library**. *(form-templates, measure-library)* **Say:** "Ripple's paper
   forms become versioned shells; the 8 kinds of data questions come from your progress notes."
2. **Client Care Plans (IPOS).** *(care-plans)* Zoe and Max onboarded; Lily 5 of 8.
3. **Lily Park → Onboarding & Documents.** *(lily-onboarding)* In-service, caregiver training and note set-up still
   missing; each item links to where it's done. **Say:** "Until all 8 are done, Lily can't be scheduled."
4. **Zoe Nguyen → Onboarding.** *(zoe-onboarding)* All 8 complete.
## 2. IPOS, renewal and retraining — Flow 2 (4 min) — Pat Morgan
1. **Zoe → IPOS.** *(zoe-ipos)* Plan v2 after the annual renewal, v1 kept as read-only history. Two CLS
   authorizations: A (20 units, expires soon) and B (400 units, 16 per week). **Say:** "Units come from the
   authorization that expires first, so hours are used before they lapse; B's weekly cap is enforced."
2. **Goals tab.** *(zoe-goals)* Goals and objectives in ISK's order with Instructions for Staff; the case-manager
   objective shows for reference only.
3. **Client training (Training → Zoe).** *(training-zoe)* Step 1 In-service (case manager → program lead), step 2
   Training form (program lead → caregivers). Ana and Ben retrained on v2, Mia not. **Say:** "Every new IPOS version,
   even a renewal with the same goals, starts retraining."
4. **Caregiver Management → Ben Carter → Credentials & Training.** *(credentials-ben)* One red, one yellow. Then
   **Mia Lopez** *(credentials-mia)*: ★ overdue. **Say:** "HR enters these; a manager can override with a reason."
## 3. Who can be scheduled — Flow 5 (4 min) — Pat Morgan, then Sam Rivera
1. **Schedule → next week → Zoe Nguyen (Thursday, unassigned) → Assign**, search **Mia**. *(assign-mia-advisory)*
   - "Not trained on the current plan" and "Over the authorization's period cap" show as **Advisory** (amber), each
     with a **Fix →** link.
   - "Expired certification" is **Blocked** already: an expired credential always blocks (today's scheduling rule).
   - Cancel.
2. **Sam Rivera** → Virtual Offices → Ripple Effects – Demo → **Compliance** *(compliance-card)* → turn **Compliance
   enforcement** on. Read the confirm aloud (what changes; recorded) → **Turn on enforcement**.
3. **Pat:** open the same assign dialog — the care-plan lines are now **Blocked** (red) and Confirm is disabled;
   **Smart assign** no longer lists Mia; the dashboard's readiness panel says "Enforced".
4. **Sam:** switch it back **off**. **Say:** "Ripple decides when to enforce; until then the checks are advice."
## 4. Visit to progress note — Flow 3, caregiver part (3 min) — Ana Brooks (phone window)
1. **Today.** *(caregiver-ana-today)* Today's visit and notes due.
2. **Notes.** *(caregiver-ana-notes)* To do (one overdue) and history.
3. **Open today's CLS note.** *(caregiver-ana-cls-note)* One block per objective with Zoe's instructions and
   questions. **Say:** "The arrival time decides the units. For now any late arrival loses the first 15-minute unit;
   we've asked you to confirm the exact rule (open question 4)."
4. **Submit** → the sign sheet *(caregiver-ana-sign-sheet)* → **cancel**.
## 5. Review and weekly billing — Flow 3 review + Flow 4 (5 min) — Pat Morgan
1. **Notes to Review.** *(notes-to-review)* One note waiting: Mia's Wednesday visit.
2. **Open it** *(note-detail)* → show **Return to caregiver** *(return-dialog)*: a reason is required → **Cancel**.
   Then **Mark reviewed**. *(Important: last week can only be approved when no note is waiting for review.)*
3. **Print** a respite note *(print-respite)*: Ripple's paper layout with the billing footer and signature lines.
4. **Weekly Billing → last week.** *(billing-last-week)* Not built; everything left out is listed with its reason.
   - **Build week**: the bill groups by client and authorization (A before B), shows the late arrival's lost unit and
     the weekly cap left. The returned note and the visit with no note stay listed as left out.
   - **Approve week** (confirm with totals) → **Mark billed** → **Export CSV** (units only, no client names in the file
     name).
5. **The week before** *(billing-week-before)*: billed and locked. **Say:** "A note reviewed after billing goes into a
   supplementary bill for the same week: never into two bills, and its units are charged once."
---
 
**Reset after the demo:** `node tests/ripple/demo/seed-demo.cjs --reset`
 
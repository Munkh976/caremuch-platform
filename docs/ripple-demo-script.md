# Ripple care-plan module — 20-minute demo script

Office: **Ripple Effects – Demo** (DEV). Data: `tests/ripple/demo/README.md`. Screenshots of every step:
`docs/screenshots/ripple-ui/demo/` (1440 and 390).

**Before the demo**
- Run `node tests/ripple/demo/seed-demo.cjs --reset` so the office is at its starting state (dates follow today).
- Log-in e-mails are in `tests/ripple/demo/README.md`. The password is the owner's `RIPPLE_DEMO_PASSWORD`; it is not
  written here.
- Open two browser windows: staff (Pat Morgan) and a phone-sized one for the caregiver (Ana Brooks).

**After the demo:** `node tests/ripple/demo/seed-demo.cjs --reset` (puts back last week's unbuilt bill, enforcement off,
Mia's open visit, etc.).

The five flows below follow the module's design: (1) set up, (2) onboard a client, (3) schedule with the compliance
checks, (4) the caregiver's progress note, (5) review, print and weekly billing. *(The requirements document's own
"Flows 1–5" wording isn't in the repo; adjust the step titles to it if they differ.)*

---

## 0. The dashboard (1 min) — Pat Morgan, program lead (manager)
**Screen:** Dashboard → "Care plan compliance". *(dashboard-1440)*
- Point at each panel: Lily Park pending onboarding (5 of 8, what's missing); expiring credentials (Mia ★ overdue, Ben red
  and yellow); Zoe's first authorization expiring with units at risk; caregivers needing retraining; notes to review (1)
  and overdue (2); last week not billed yet; enforcement readiness (Advisory, what would be blocked).
- **Say:** "Everything that needs attention in one place. Every row opens the exact record or tab where it's fixed."

## 1. Setup (3 min) — Pat Morgan
1. **Form Templates → Shells.** *(form-templates)* The office's IPOS, CLS note, respite note and the seven intake
   documents. **Say:** "Ripple's paper forms become versioned shells. A client's plan keeps the version it was built
   from, so editing a shell never changes a signed plan."
2. **Measure library tab.** *(measure-library)* The 8 kinds of data questions (yes/no, prompt level, graded steps, tally,
   trials, short answer, narrative, staff note).
3. **Caregiver Management → Ben Carter → Credentials & Training** (or the dashboard's credential row). *(credentials-ben)*
   One credential red (≤ 30 days), one yellow (≤ 60). Then **Mia Lopez** *(credentials-mia)*: ★ overdue.
   **Say:** "HR (Jordan Lee) enters credentials; a manager can override with a reason, and it's recorded."
4. **Virtual Offices → Ripple Effects – Demo → Compliance** (log in as **Sam Rivera, agency admin** to show the editable
   card; Pat sees it read-only). *(compliance-card)* Module on, enforcement off. Don't switch yet.

## 2. Onboard a client (5 min) — Pat Morgan
1. **Client Care Plans (IPOS).** *(care-plans)* Zoe and Max onboarded; Lily 5 of 8.
2. **Zoe Nguyen → IPOS.** *(zoe-ipos)* Plan v2 after the annual renewal, case number DEMO-1001, two CLS authorizations:
   A (20 units, expires soon) and B (400 units, 16 per week). **Say:** "Notes draw units first-in-first-out: A until
   it runs out, then B — and B's weekly cap is enforced."
3. **Goals tab.** *(zoe-goals)* Three goals; objectives with Instructions for Staff and data questions (prompt level,
   graded steps, yes/no, short answer, narrative, trials, tally). The case-manager objective is reference only.
4. **Onboarding tab.** *(zoe-onboarding)* All 8 items complete. Then **Lily Park → Onboarding** *(lily-onboarding)*:
   in-service, caregiver training and note set-up still missing — each item links to where it's done.
5. **Client training (Training → Zoe).** *(training-zoe)* In-service and training forms per plan version; Ana and Ben
   retrained on v2, Mia not.

## 3. Schedule with the compliance checks (4 min) — Pat Morgan
1. **Schedule → Unassigned → next week → Zoe Nguyen (Thursday) → Assign**, search **Mia**. *(assign-mia-advisory)*
   - "Not trained on the current plan" and "Over the authorization's period cap" show as **Advisory** (amber) with a
     **Fix →** link each.
   - "Expired certification" is **Blocked** already: an expired credential always blocks (existing scheduling rule).
   - Cancel (don't assign).
2. **Switch enforcement on live:** log in as **Sam Rivera** → Virtual Offices → Ripple Effects – Demo → **Compliance**
   → turn **Compliance enforcement** on. Read the confirm aloud (what changes; audited) → **Turn on enforcement**.
3. Back as Pat: open the same assign dialog — the care-plan lines are now **Blocked** (red) and Confirm is disabled;
   **Smart assign** no longer lists Mia; the dashboard's readiness panel says "Enforced".
4. *(Optional, caregiver window as **Mia Lopez**: Available Shifts shows Zoe's visits as "Not bookable yet".)*
5. **Switch it back off** (Sam → Compliance → off → confirm). **Say:** "Ripple decides when to enforce; until then it's
   advice, and nothing about scheduling changes for the other offices."

## 4. The caregiver's progress note (3 min) — Ana Brooks, caregiver (phone window)
1. **Today.** *(caregiver-ana-today)* Today's visits and notes due.
2. **Notes.** *(caregiver-ana-notes)* Drafts, returned and submitted notes.
3. **Open today's CLS note** *(caregiver-ana-cls-note)*: one block per objective with Zoe's own instructions and
   questions. Arrival time decides the units (no grace period: one minute late bills one unit less).
4. **Submit** → the sign sheet *(caregiver-ana-sign-sheet)* — **cancel** for the demo (or submit it; `--reset` restores it).

## 5. Review, print and bill (4 min) — Pat Morgan
1. **Notes to Review.** *(notes-to-review)* Oldest first; Submitted / Returned / Reviewed / Overdue.
2. **Open Mia's Wednesday note** *(note-detail)* → **Return to caregiver** *(return-dialog)*: a reason is required.
   Cancel (or mark it reviewed live to show it joins the bill).
3. **Print** a reviewed CLS note *(print-cls)* and a respite note *(print-respite)*: Ripple's paper layout, no app chrome.
4. **Weekly Billing → last week.** *(billing-last-week)* Not built. Everything not in the bill is listed with its
   reason: submitted, returned, a visit with no note.
   - **Build week** live: the bill groups by client and authorization (FIFO A → B), shows the late arrival's lost unit
     and the weekly cap left.
   - **Approve** (one confirmed action for the bill's notes) → **Mark billed** → **Export CSV** (units only, no client
     names in the file name).
5. **The week before** *(billing-week-before)*: already billed and locked. **Say:** "A note reviewed after billing goes
   into a supplementary bill for the same week — never into two bills, units charged once."

---

**Reset after the demo:** `node tests/ripple/demo/seed-demo.cjs --reset`

// Ripple UI round 10 (demo UX, Oct 19) — browser acceptance on DEV with real logins, in a disposable tagged office
// of the test agency (never the demo office RPLDEMO).
// Usage: node tests/ripple/ui/round10.cjs [--undo] > some.log 2>&1   (never pipe a DEV suite; see README)
//   Part 1: clickable rows (Client Care Plans, Notes to Review table + cards, Virtual Offices cards, the client's
//           Progress Notes tab), the Review panel at the end of a note (statement, confirm, Return, reviewed state),
//           1440 and 390.
//   --undo (Part 2): Undo review in the Review panel: confirm, back to Submitted, units restored, the open bill
//           drops the note, disabled with the reason once the week is approved.
// Screenshots: docs/screenshots/ripple-ui/round10/.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round10");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const UNDO = process.argv.includes("--undo");
const RUN = `ui10-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], shifts: [], credTypes: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const { dbDay, dbNow, closeDb } = require("../dev/lib.cjs");
const REASON = "Please add which reinforcers worked best for Zoe today.";

async function ins(t, key, row) { const { data, error } = await admin.from(t).insert(row).select("id").single(); if (error) throw new Error(`${t}: ${error.message}`); ids[key].push(data.id); return data.id; }
async function mkUser(tag, roles, office, restricted, full) {
  const email = `sec-${tag}${SUFFIX}`, password = pw();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: full, agency_id: A } });
  if (error) throw new Error(`user ${tag}: ${error.message}`); ids.users.push(data.user.id);
  await admin.from("profiles").upsert({ id: data.user.id, email, full_name: full, agency_id: A, virtual_office_id: office, office_restricted: restricted });
  for (const role of roles) { const { error: re } = await admin.from("user_roles").insert({ user_id: data.user.id, role, agency_id: A }); if (re) throw new Error(`role ${tag}: ${re.message}`); }
  const c = createClient(URL_, ANON, opts); const { error: se } = await c.auth.signInWithPassword({ email, password }); if (se) throw new Error(`signIn ${tag}: ${se.message}`);
  return { id: data.user.id, email, password, c, full };
}
const must = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data; };
const addDays = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function setup() {
  const F = {};
  F.RX = await ins("virtual_office", "virtual_office", { agency_id: A, name: `Ripple Effects Portage ${RUN}`, is_demo: true });
  F.aa = await mkUser("aa", ["agency_admin"], null, false, "Pat Admin");
  F.mgr = await mkUser("mgr", ["manager"], F.RX, true, "Bren Miller");
  F.cgA = await mkUser("cga", ["caregiver"], F.RX, false, "Ana Rivera");
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aa.c, "seed_office_care_plan_defaults", { _office_id: F.RX });
  ids.credTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 20 * 864e5).toISOString() }).eq("id", F.RX);
  F.G1 = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, user_id: F.cgA.id, first_name: "Ana", last_name: "Rivera", email: `sec-ana${SUFFIX}`, phone: "555-0100", is_demo: true });
  await admin.from("caregiver_skills").insert([{ caregiver_id: F.G1, care_type_code: "CLS0001", is_demo: true }]);
  const cl = (first, last) => ins("clients", "clients", { agency_id: A, virtual_office_id: F.RX, first_name: first, last_name: `${last} ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.CX = await cl("Zoe", "Nolan"); F.CB = await cl("Ben", "Ash");
  F.plan = await must(F.mgr.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(330) } });
  await must(F.mgr.c, "upsert_care_plan_goals", { _care_plan_id: F.plan, _goals: [
    { seq: 1, goal_text: "Build daily living skills", objectives: [{ seq: 1, letter: "A", objective_text: "Prepare a simple meal", staff_instructions: "Lay out the ingredients first.", service_type: "cls", responsible_party: "this_agency" }] }] });
  const obj = (await admin.from("care_plan_objectives").select("id").in("goal_id", ((await admin.from("care_plan_goals").select("id").eq("care_plan_id", F.plan)).data || []).map((g) => g.id))).data[0].id;
  const mt = Object.fromEntries(((await admin.from("measure_types").select("id, kind").is("agency_id", null).eq("is_active", true)).data || []).map((m) => [m.kind, m.id]));
  await must(F.mgr.c, "set_objective_measures", { _objective_id: obj, _measures: [{ measure_type_id: mt.yes_no_na, prompt_text: "Did Zoe take part?" }] });
  const mid = (await admin.from("objective_measures").select("id").eq("objective_id", obj).single()).data.id;
  F.auth = await must(F.mgr.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: "ISK-2026-0417", _units_authorized: 400, _effective_date: await dbDay(-30), _expiration_date: await dbDay(60) });
  // visits in the last complete billing week of the office (so the week can be built and approved for --undo)
  const o = (await admin.from("virtual_office").select("billing_week_start").eq("id", F.RX).single()).data;
  const today = await dbDay(0), dow = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  F.week = addDays(today, -(((dow - o.billing_week_start + 7) % 7) + 7));
  const sh = async (day, start, end) => {
    const id = await ins("shifts", "shifts", { agency_id: A, virtual_office_id: F.RX, client_id: F.CX, order_title: `Visit ${RUN}`, care_type_code: "CLS0001", shift_date: day, start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
    const { error } = await F.mgr.c.rpc("assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G1, _method: "manual", _notes: "round10 fixture", _override_reason: "round10 fixture (disposable)" });
    if (error) throw new Error(`assign ${day} ${start}: ${error.message}`); return id; };
  const write = async (shift) => {
    const n = await must(F.cgA.c, "create_progress_note_for_shift", { _shift_id: shift });
    const row = (await admin.from("progress_notes").select("scheduled_start, scheduled_end").eq("id", n).single()).data;
    const ents = (await admin.from("progress_note_entries").select("id").eq("progress_note_id", n)).data || [];
    await must(F.cgA.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: row.scheduled_start, actual_end: row.scheduled_end, location: "Zoe's kitchen", staff_client_ratio: "1:1" },
      _entries: ents.map((e) => ({ entry_id: e.id, notes_text: "Zoe chopped carrots with light help.", data: { [mid]: { value: "Yes" } } })), _narrative_text: null });
    await must(F.cgA.c, "submit_progress_note", { _note_id: n, _typed_signature: "Ana Rivera" });
    return n; };
  F.S1 = await sh(addDays(F.week, 1), "09:00", "10:00"); F.S2 = await sh(addDays(F.week, 2), "09:00", "10:00");
  F.S3 = await sh(addDays(F.week, 3), "09:00", "10:00"); F.S4 = await sh(addDays(F.week, 4), "09:00", "10:00");
  F.N1 = await write(F.S1);   // reviewed in the Review panel (P4)
  F.N2 = await write(F.S2);   // returned from the Review panel (P5)
  F.N3 = await write(F.S3);   // stays submitted (390 panel, client tab)
  F.N4 = await write(F.S4);   // reviewed by the API (reviewed panel at 390; --undo)
  await must(F.mgr.c, "review_progress_note", { _note_id: F.N4, _billable: true, _non_billable_reason: null });
  return F;
}

async function teardown() {
  for (const id of ids.clients) {
    for (const { id: n } of (await admin.from("progress_notes").select("id").eq("client_id", id)).data || []) await admin.from("events").delete().eq("subject_id", n);
    await admin.from("progress_notes").delete().eq("client_id", id);
  }
  for (const o of ids.virtual_office) { for (const { id: b } of (await admin.from("billing_batches").select("id").eq("virtual_office_id", o)).data || []) await admin.from("events").delete().eq("subject_id", b);
    await admin.from("billing_batches").delete().eq("virtual_office_id", o); }
  for (const id of ids.shifts) { await admin.from("shift_assignments").delete().eq("shift_id", id); await admin.from("events").delete().eq("subject_id", id); await admin.from("shifts").delete().eq("id", id); }
  for (const id of ids.clients) {
    for (const { id: a } of (await admin.from("service_authorizations").select("id").eq("client_id", id)).data || []) await admin.from("events").delete().eq("subject_id", a);
    for (const t of ["plan_training_records", "plan_training_forms", "plan_inservice_forms", "client_documents", "service_authorizations", "care_plans"]) await admin.from(t).delete().eq("client_id", id);
  }
  for (const id of ids.caregivers) { await admin.from("caregiver_certifications").delete().eq("caregiver_id", id); await admin.from("caregiver_skills").delete().eq("caregiver_id", id); }
  for (const t of ["clients", "caregivers"]) for (const id of ids[t]) await admin.from(t).delete().eq("id", id);
  for (const id of ids.users) { await admin.from("user_roles").delete().eq("user_id", id); await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
  for (const id of ids.virtual_office) { await admin.from("events").delete().eq("virtual_office_id", id); await admin.from("office_service_types").delete().eq("virtual_office_id", id); await admin.from("virtual_office").delete().eq("id", id); }
  for (const id of ids.credTypes) await admin.from("credential_types").delete().eq("id", id);
  const left = [];
  for (const [t, key] of [["clients", "clients"], ["caregivers", "caregivers"], ["virtual_office", "virtual_office"], ["shifts", "shifts"], ["credential_types", "credTypes"]])
    for (const id of ids[key]) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  for (const id of ids.clients) { const { data } = await admin.from("progress_notes").select("id").eq("client_id", id); if (data && data.length) left.push(`progress_notes for ${id}`); }
  for (const id of ids.virtual_office) { const { data } = await admin.from("billing_batches").select("id").eq("virtual_office_id", id); if (data && data.length) left.push(`billing_batches for ${id}`); }
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} office, ${ids.caregivers.length} caregiver, ${ids.clients.length} clients, ${ids.shifts.length} shifts → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
}

async function login(page, base, u) {
  await page.goto(`${base}/auth`); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const ctxFor = (browser, w) => browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
const status = async (n) => (await admin.from("progress_notes").select("status").eq("id", n).single()).data.status;
const pathOf = (page) => new URL(page.url()).pathname;
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const openDetail = async (page, base, n) => { await page.goto(`${base}/progress-notes/${n}`); await page.locator('[data-testid="review-panel"], [data-testid="note-denied"]').first().waitFor({ timeout: 30000 }); await settle(page); };
const openQueue = async (page, base) => { await page.goto(`${base}/progress-notes`); await page.locator('[data-testid="notes-queue"]:visible, [data-testid="notes-queue-cards"]:visible, [data-testid="queue-empty"]:visible').first().waitFor({ timeout: 30000 }); await settle(page, 1200); };
const openCarePlans = async (page, base) => { await page.goto(`${base}/care-plans`); await page.locator("[data-client-row]").first().waitFor({ timeout: 30000 }); await settle(page); };
const cursorOf = (loc) => loc.evaluate((e) => getComputedStyle(e).cursor);

// =============================================================================================
async function part1(base, F, browser) {
  const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage();
  await login(page, base, F.mgr);

  // L1 Client Care Plans
  await openCarePlans(page, base);
  const row = page.locator(`[data-client-row="${F.CX}"]`);
  const head = await page.locator('[data-testid="care-plan-list"] thead').innerText();
  const nameCls = await row.locator("td").first().locator("a").getAttribute("class");
  const openBtn = await row.locator('[data-testid="row-open"]').innerText();
  const lastCellHasOpen = (await row.locator("td").last().locator('[data-testid="row-open"]').count()) === 1;
  await row.hover(); await shot(page, "care-plans-row-hover-1440");
  const cur = await cursorOf(row), bg = await row.evaluate((e) => getComputedStyle(e).backgroundColor);
  await row.locator("td").nth(2).click(); await page.waitForURL(`**/care-plans/${F.CX}`, { timeout: 15000 });
  const byCell = pathOf(page);
  await openCarePlans(page, base); await page.locator(`[data-client-row="${F.CX}"]`).focus(); await page.keyboard.press("Enter"); await page.waitForURL(`**/care-plans/${F.CX}`, { timeout: 15000 });
  const byEnter = pathOf(page);
  await openCarePlans(page, base); await page.locator(`[data-client-row="${F.CX}"] [data-testid="row-open"]`).click(); await page.waitForURL(`**/care-plans/${F.CX}`, { timeout: 15000 });
  const byBtn = pathOf(page);
  await openCarePlans(page, base); await page.locator(`[data-client-row="${F.CX}"] [data-testid="row-open"]`).focus(); await page.keyboard.press("Enter"); await page.waitForURL(`**/care-plans/${F.CX}`, { timeout: 15000 });
  const byBtnEnter = pathOf(page);
  rec("L1 Client Care Plans: last column 'Open ›'; the whole row opens the client (pointer, hover background), Enter on the focused row or on the button opens it; the client name is styled as a link",
    openBtn.trim() === "Open ›" && lastCellHasOpen && /text-primary/.test(nameCls) && cur === "pointer" && bg !== "rgba(0, 0, 0, 0)"
      && [byCell, byEnter, byBtn, byBtnEnter].every((p) => p === `/care-plans/${F.CX}`), `head "${head.replace(/\s+/g, " ")}"; cursor ${cur}; bg ${bg}; paths ${[byCell, byEnter, byBtn, byBtnEnter].join(" ")}`);
  await openCarePlans(page, base); await shot(page, "care-plans-1440");

  // L2 Notes to Review (table)
  await openQueue(page, base);
  const qrow = page.locator(`[data-testid="notes-queue"] [data-queue-row="${F.N3}"]`);
  await qrow.hover(); await shot(page, "notes-to-review-row-hover-1440");
  const qcur = await cursorOf(qrow), qOpen = (await qrow.locator('[data-testid="row-open"]').innerText()).trim();
  await qrow.locator("td").nth(2).click(); await page.waitForURL(`**/progress-notes/${F.N3}`, { timeout: 15000 });
  const qCell = pathOf(page);
  await openQueue(page, base); await page.locator(`[data-testid="notes-queue"] [data-queue-row="${F.N3}"] a[aria-label="Print note"]`).click(); await page.waitForURL(`**/progress-notes/${F.N3}/print`, { timeout: 15000 });
  const qPrint = pathOf(page);
  await openQueue(page, base); await page.locator(`[data-testid="notes-queue"] [data-queue-row="${F.N3}"]`).focus(); await page.keyboard.press("Enter"); await page.waitForURL(`**/progress-notes/${F.N3}`, { timeout: 15000 });
  const qEnter = pathOf(page);
  rec("L2 Notes to Review: the row opens the note (pointer, click on a cell, Enter); 'Open ›' button; the printer icon only prints (opens the print page, not the note)",
    qcur === "pointer" && qOpen === "Open ›" && qCell === `/progress-notes/${F.N3}` && qPrint === `/progress-notes/${F.N3}/print` && qEnter === `/progress-notes/${F.N3}`, `cursor ${qcur}; ${qCell} | ${qPrint} | ${qEnter}`);
  await openQueue(page, base); await shot(page, "notes-to-review-1440");

  // L3 the client's Progress Notes tab: row actions do only their job; a click inside the Return dialog (a portal) doesn't open the row
  await page.goto(`${base}/care-plans/${F.CX}?tab=notes`); await page.locator(`[data-testid="notes-queue"] [data-queue-row="${F.N3}"]`).waitFor({ timeout: 30000 }); await settle(page, 1200);
  await page.locator(`[data-testid="notes-queue"] [data-queue-row="${F.N3}"] [data-testid="open-return"]`).click(); await page.locator('[data-testid="return-dialog"]').waitFor();
  await page.locator('[data-testid="return-dialog"] h2').click(); await page.fill("#return-reason", "typing here"); await settle(page, 400);
  const stillTab = pathOf(page) === `/care-plans/${F.CX}`;
  await page.getByRole("button", { name: "Cancel" }).click(); await settle(page, 400);
  const tabRowCursor = await cursorOf(page.locator(`[data-testid="notes-queue"] [data-queue-row="${F.N3}"]`));
  rec("L3 client Progress Notes tab: 'Return to caregiver' opens its dialog without opening the row; clicks and typing in the dialog stay on the page; the note is unchanged",
    stillTab && (await status(F.N3)) === "submitted" && tabRowCursor === "pointer", `on tab ${stillTab}; status ${await status(F.N3)}`);

  // L4 Virtual Offices (agency admin)
  const c2 = await ctxFor(browser, 1440); const p2 = await c2.newPage(); await login(p2, base, F.aa);
  const openVO = async () => { await p2.goto(`${base}/virtual-offices`); await p2.locator(`[data-office-card="${F.RX}"]`).waitFor({ timeout: 30000 }); await settle(p2); };
  await openVO(); const card = p2.locator(`[data-office-card="${F.RX}"]`);
  await card.scrollIntoViewIfNeeded(); await card.hover(); await card.screenshot({ path: path.join(SHOTS, "virtual-office-card-hover-1440.png") });
  const vcur = await cursorOf(card), nameLink = await card.locator("a").first().getAttribute("class"), hasConfigure = (await card.getByRole("button", { name: /Configure/ }).count()) === 1;
  await card.locator(".text-sm.text-muted-foreground, p").first().click(); await p2.waitForURL(`**/virtual-offices/${F.RX}`, { timeout: 15000 }); const vCard = pathOf(p2);
  await openVO(); await p2.locator(`[data-office-card="${F.RX}"] a`).first().click(); await p2.waitForURL(`**/virtual-offices/${F.RX}`, { timeout: 15000 }); const vName = pathOf(p2);
  await openVO(); await p2.locator(`[data-office-card="${F.RX}"]`).focus(); await p2.keyboard.press("Enter"); await p2.waitForURL(`**/virtual-offices/${F.RX}`, { timeout: 15000 }); const vEnter = pathOf(p2);
  await openVO(); await p2.locator(`[data-office-card="${F.RX}"] [role="switch"]`).click(); await settle(p2, 1500);
  const vSwitchStay = pathOf(p2) === "/virtual-offices", active1 = (await admin.from("virtual_office").select("is_active").eq("id", F.RX).single()).data.is_active;
  await p2.locator(`[data-office-card="${F.RX}"] [role="switch"]`).click(); await settle(p2, 1500);
  const active2 = (await admin.from("virtual_office").select("is_active").eq("id", F.RX).single()).data.is_active;
  await p2.locator(`[data-office-card="${F.RX}"]`).getByRole("button", { name: /Configure/ }).click(); await p2.waitForURL(`**/virtual-offices/${F.RX}`, { timeout: 15000 }); const vConf = pathOf(p2);
  rec("L4 Virtual Offices: the card (and the office name, styled as a link) opens the office like Configure, Enter too; Configure kept; the Active switch only toggles (stays on the list; test office only, switched back)",
    vcur === "pointer" && /text-primary/.test(nameLink) && hasConfigure && [vCard, vName, vEnter, vConf].every((p) => p === `/virtual-offices/${F.RX}`) && vSwitchStay && active1 === false && active2 === true,
    `cursor ${vcur}; ${vCard} | ${vName} | ${vEnter} | ${vConf}; switch stays ${vSwitchStay}, active ${active1} → ${active2}`);
  await c2.close();

  // P1–P3 Review panel (1440)
  await openDetail(page, base, F.N1);
  const order = await page.evaluate(() => { const ids = ["signature", "note-history", "review-panel"]; const els = ids.map((i) => document.querySelector(`[data-testid="${i}"]`));
    const goal = document.querySelector("[data-goal]"); return { ok: els.every(Boolean) && !!goal && [goal, ...els].every((e, i, a) => i === 0 || (a[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)),
      topButtons: document.querySelector('[data-testid="staff-note"]').querySelectorAll('[data-testid="mark-reviewed"], [data-testid="open-return"], [data-testid="print-link"]').length }; });
  const btns = await page.locator('[data-testid="review-buttons"] a, [data-testid="review-buttons"] button').evaluateAll((els) => els.map((e) => ({ t: e.textContent.trim(), x: e.getBoundingClientRect().x, r: e.getBoundingClientRect().right })));
  const panelRight = await page.locator('[data-testid="review-buttons"]').evaluate((e) => e.getBoundingClientRect().right);
  const disabled0 = await page.locator('[data-testid="mark-reviewed"]').isDisabled(), returnEnabled = !(await page.locator('[data-testid="open-return"]').isDisabled());
  await page.locator('[data-testid="review-panel"]').scrollIntoViewIfNeeded(); await shot(page, "review-panel-submitted-1440");
  await shot(page, "note-detail-submitted-1440", true);
  rec("P1 the Review panel is at the END of the note (after the goals, signature and history); none of its buttons is in the top card; [Print] [Return to caregiver] [Mark reviewed] right-aligned in that order; Mark reviewed disabled until the box is ticked, Return enabled",
    order.ok && order.topButtons === 0 && btns.map((b) => b.t).join("|") === "Print|Return to caregiver|Mark reviewed" && btns[0].x < btns[1].x && btns[1].x < btns[2].x
      && Math.abs(btns[2].r - panelRight) < 2 && disabled0 && returnEnabled, `order ${order.ok}; top buttons ${order.topButtons}; ${btns.map((b) => b.t).join("|")}; disabled ${disabled0}`);
  await page.locator('[data-testid="review-ack"]').click(); await settle(page, 300);
  const enabled1 = !(await page.locator('[data-testid="mark-reviewed"]').isDisabled());
  await page.locator('[data-testid="mark-reviewed"]').click(); await page.locator('[data-testid="review-confirm"]').waitFor();
  const dlg = await page.locator('[data-testid="review-confirm"]').innerText();
  await shot(page, "review-confirm-1440");
  await page.locator('[data-testid="cancel-review"]').click(); await settle(page, 600);
  const afterCancel = await status(F.N1);
  await page.locator('[data-testid="mark-reviewed"]').click(); await page.locator('[data-testid="review-confirm"]').waitFor();
  await page.locator('[data-testid="confirm-review"]').click(); await page.locator('[data-testid="reviewed-by"]').waitFor({ timeout: 20000 }); await settle(page);
  const by = await page.locator('[data-testid="reviewed-by"]').innerText();
  const left = await page.locator('[data-testid="review-panel"] a, [data-testid="review-panel"] button').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  await page.locator('[data-testid="review-panel"]').scrollIntoViewIfNeeded(); await shot(page, "review-panel-reviewed-1440");
  rec("P2 tick → Mark reviewed enabled → 'Mark this note reviewed?' with Cancel / Mark reviewed; Cancel keeps it Submitted; confirm → Reviewed (DB); the panel shows 'Reviewed by Bren Miller · <date/time>' and Print only",
    enabled1 && /Mark this note reviewed\?/.test(dlg) && /Cancel/.test(dlg) && afterCancel === "submitted" && (await status(F.N1)) === "reviewed"
      && /^Reviewed by Bren Miller · \w{3}, \w{3} \d{1,2}, \d{1,2}:\d{2}\s?[AP]M$/.test(by.trim()) && left.join("|") === (UNDO ? "Print|Undo review" : "Print"), `"${by}"; buttons ${left.join("|")}`);

  await openDetail(page, base, F.N2);
  await page.locator('[data-testid="open-return"]').click(); await page.locator('[data-testid="return-dialog"]').waitFor();
  await page.fill("#return-reason", "Too short"); await settle(page, 200);
  const shortDisabled = await page.locator('[data-testid="confirm-return"]').isDisabled();
  await page.fill("#return-reason", REASON); await settle(page, 200); await shot(page, "review-panel-return-dialog-1440");
  await page.locator('[data-testid="confirm-return"]').click(); await page.locator('[data-testid="detail-returned"]').waitFor({ timeout: 20000 }); await settle(page);
  const retPanel = await page.locator('[data-testid="review-panel"]').innerText();
  rec("P3 Return to caregiver from the panel works as before without the box (reason of 10+ characters; 9 characters disabled) → Returned (DB); the panel then shows Print only",
    shortDisabled && (await status(F.N2)) === "returned" && /Returned to the caregiver/.test(retPanel) && (await page.locator('[data-testid="review-panel"] button').count()) === 0, retPanel.replace(/\s+/g, " ").slice(0, 120));
  await ctx.close();

  // M1 390
  const m = await ctxFor(browser, 390); const mp = await m.newPage(); await login(mp, base, F.mgr);
  await openDetail(mp, base, F.N3); await mp.locator('[data-testid="review-panel"]').scrollIntoViewIfNeeded(); await settle(mp, 400);
  await shot(mp, "review-panel-submitted-390");
  const mFit = await noHScroll(mp), mBtns = await mp.locator('[data-testid="review-buttons"] a, [data-testid="review-buttons"] button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  const mRow = Math.round(await mp.locator('[data-testid="review-buttons"]').evaluate((e) => e.getBoundingClientRect().width));
  await openDetail(mp, base, F.N4); await mp.locator('[data-testid="review-panel"]').scrollIntoViewIfNeeded(); await settle(mp, 400);
  await shot(mp, "review-panel-reviewed-390"); const mFit2 = await noHScroll(mp);
  await openQueue(mp, base); const mcard = mp.locator(`[data-testid="notes-queue-cards"] [data-queue-row="${F.N3}"]`);
  const ccur = await cursorOf(mcard); await shot(mp, "notes-to-review-390");
  await mcard.locator("p").nth(1).click(); await mp.waitForURL(`**/progress-notes/${F.N3}`, { timeout: 15000 }); const cPath = pathOf(mp);
  await openQueue(mp, base); await mp.locator(`[data-testid="notes-queue-cards"] [data-queue-row="${F.N3}"] a`, { hasText: "Print" }).click(); await mp.waitForURL(`**/progress-notes/${F.N3}/print`, { timeout: 15000 }); const cPrint = pathOf(mp);
  await openCarePlans(mp, base); await shot(mp, "care-plans-390"); const cpFit = await noHScroll(mp);
  rec("M1 390: Review panel buttons stacked full width, no horizontal scroll (submitted and reviewed); a Notes to Review card opens the note on a tap, its Print link only prints; Care Plans fits",
    mFit && mFit2 && cpFit && mBtns.length === 3 && mBtns.every((w) => w === mRow) && cPath === `/progress-notes/${F.N3}` && cPrint === `/progress-notes/${F.N3}/print` && ccur === "pointer",
    `fit ${mFit}/${mFit2}/${cpFit}; widths ${mBtns.join(",")} of ${mRow}; ${cPath} | ${cPrint}`);
  await m.close();
}

async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: office Portage (module on, go-live -20 d, week ${F.week}); Bren Miller (manager), Pat Admin (agency admin), Ana Rivera (caregiver); Zoe N. (plan, ISK-2026-0417, 400 units) and Ben A.; 4 submitted CLS notes, one reviewed by the API`);
    const browser = await chromium.launch();
    try { await part1(base, F, browser); if (UNDO) await require("./round10-undo.cjs")({ base, F, browser, rec, log, admin, must, shot, status, openDetail, settle, ctxFor, login, noHScroll }); } finally { await browser.close(); }
  } finally { await teardown(); await closeDb(); }
}

(async () => {
  const port = 8150 + Math.floor(Math.random() * 50);
  const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("vite did not start")), 90000);
      vite.stdout.on("data", (d) => { if (/Local:|ready in/i.test(d.toString())) { clearTimeout(to); res(); } }); });
    await run(`http://localhost:${port}`);
  } catch (e) { log("ERROR:", String(e.message).replace(/[[0-9;]*m/g, "").slice(0, 2000)); rows.push({ id: "ERROR", ok: false }); }
  finally { try { execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ } }
  log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok === "INFO" ? "INFO" : r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => r.ok === false)) process.exitCode = 1;
})();

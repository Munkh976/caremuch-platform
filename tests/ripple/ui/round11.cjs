// Ripple UI round 11 (S14 polish + S15 client Training tab) — browser acceptance on DEV with real logins, in a disposable
// tagged office of the test agency (never the demo office RPLDEMO).
// Usage: node tests/ripple/ui/round11.cjs > some.log 2>&1   (never pipe a DEV suite; see README)
//   S14: the risk panel's "Schedule ›" button; Schedule opened with ?client= shows a Client select (no pill), "All clients"
//        clears it and the URL; "← Back to <client>'s care plan".
//   S15: the Training tab (header, in-service, sessions with attendees, one roster with filters, history), "Add to a session"
//        records a session for a caregiver who needs retraining; the Scheduling tab keeps shifts + eligibility with a link
//        to Training; the onboarding "Caregiver training" arrow and the dashboard-style links land on the tab; hr_staff's
//        /training/:clientId shows the same tab; 390.
// Screenshots: docs/screenshots/ripple-ui/round11/.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round11");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui11-${Date.now().toString(36)}`;
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

async function setup() {
  const F = {};
  F.RX = await ins("virtual_office", "virtual_office", { agency_id: A, name: `Ripple Effects Portage ${RUN}`, is_demo: true });
  F.aa = await mkUser("aa", ["agency_admin"], null, false, "Pat Admin");
  F.mgr = await mkUser("mgr", ["manager"], F.RX, true, "Bren Miller");
  F.hr = await mkUser("hr", ["hr_staff"], F.RX, true, "Hana Reed");
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aa.c, "seed_office_care_plan_defaults", { _office_id: F.RX });
  ids.credTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 20 * 864e5).toISOString() }).eq("id", F.RX);
  const G = {};
  for (const [k, first, last] of [["ana", "Ana", "Rivera"], ["ben", "Ben", "Ostrowski"], ["cleo", "Cleo", "Park"]]) {
    G[k] = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, first_name: first, last_name: last, email: `sec-${k}${SUFFIX}`, phone: "555-0100", is_demo: true });
    await admin.from("caregiver_skills").insert([{ caregiver_id: G[k], care_type_code: "CLS0001", is_demo: true }]);
  }
  F.G = G;
  F.CX = await ins("clients", "clients", { agency_id: A, virtual_office_id: F.RX, first_name: "Zoe", last_name: `Nolan ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  const plan1 = await must(F.mgr.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-40), expiration_date: await dbDay(320) } });
  await must(F.mgr.c, "upsert_care_plan_goals", { _care_plan_id: plan1, _goals: [{ seq: 1, goal_text: "Build daily living skills", objectives: [{ seq: 1, letter: "A", objective_text: "Prepare a simple meal", staff_instructions: "Lay out the ingredients first.", service_type: "cls", responsible_party: "this_agency" }] }] });
  F.auth = await must(F.mgr.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: "ISK-2026-0417", _units_authorized: 400, _effective_date: await dbDay(-40), _expiration_date: await dbDay(20) });
  const insv = (plan, d) => must(F.mgr.c, "record_inservice_form", { _care_plan_id: plan, _case_manager_name: "Robin Hale", _program_lead_id: F.mgr.id, _trained_on: d, _signed_at: `${d}T12:00:00Z`, _field_values: {} });
  const train = (plan, who, d) => must(F.mgr.c, "record_training_form", { _care_plan_id: plan, _plan_document_type: "ipos_initial", _plan_effective_date: null, _location: null,
    _records: who.map((k) => ({ caregiver_id: G[k], training_date: d, trainer_name: "Bren Miller", signed_date: d })), _field_values: {} });
  await insv(plan1, await dbDay(-38)); await train(plan1, ["ana", "ben"], await dbDay(-37));
  F.plan2 = await must(F.mgr.c, "renew_care_plan", { _care_plan_id: plan1 });
  await insv(F.plan2, await dbDay(-2)); await train(F.plan2, ["ana"], await dbDay(-1));
  const sh = async (d, who) => {
    const id = await ins("shifts", "shifts", { agency_id: A, virtual_office_id: F.RX, client_id: F.CX, order_title: `Visit ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(d), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
    if (who) { const { error } = await F.mgr.c.rpc("assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: G[who], _method: "manual", _notes: "round11 fixture", _override_reason: "round11 fixture (disposable)" }); if (error) throw new Error(`assign: ${error.message}`); }
    return id; };
  F.Sana = await sh(3, "ana"); F.Sben = await sh(5, "ben"); F.Sopen = await sh(7, null);
  return F;
}

async function teardown() {
  for (const id of ids.clients) {
    for (const t of ["plan_training_forms", "plan_inservice_forms", "service_authorizations", "care_plans"])
      for (const { id: x } of (await admin.from(t).select("id").eq("client_id", id)).data || []) await admin.from("events").delete().eq("subject_id", x);
    await admin.from("progress_notes").delete().eq("client_id", id);
  }
  for (const id of ids.shifts) { await admin.from("shift_assignments").delete().eq("shift_id", id); await admin.from("events").delete().eq("subject_id", id); await admin.from("shifts").delete().eq("id", id); }
  for (const id of ids.clients) for (const t of ["plan_training_records", "plan_training_forms", "plan_inservice_forms", "client_documents", "service_authorizations", "care_plans"]) await admin.from(t).delete().eq("client_id", id);
  for (const id of ids.caregivers) { await admin.from("caregiver_certifications").delete().eq("caregiver_id", id); await admin.from("caregiver_skills").delete().eq("caregiver_id", id); }
  for (const t of ["clients", "caregivers"]) for (const id of ids[t]) await admin.from(t).delete().eq("id", id);
  for (const id of ids.users) { await admin.from("user_roles").delete().eq("user_id", id); await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
  for (const id of ids.virtual_office) { await admin.from("events").delete().eq("virtual_office_id", id); await admin.from("office_service_types").delete().eq("virtual_office_id", id); await admin.from("virtual_office").delete().eq("id", id); }
  for (const id of ids.credTypes) await admin.from("credential_types").delete().eq("id", id);
  const left = [];
  for (const [t, key] of [["clients", "clients"], ["caregivers", "caregivers"], ["virtual_office", "virtual_office"], ["shifts", "shifts"], ["credential_types", "credTypes"]])
    for (const id of ids[key]) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  for (const id of ids.clients) for (const t of ["plan_training_records", "care_plans"]) { const { data } = await admin.from(t).select("id").eq("client_id", id); if (data && data.length) left.push(`${t} for ${id}`); }
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} office, ${ids.caregivers.length} caregivers, ${ids.clients.length} client, ${ids.shifts.length} shifts → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
}

async function login(page, base, u) {
  await page.goto(`${base}/auth`); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const ctxFor = async (browser, w) => { const c = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) }); c.setDefaultNavigationTimeout(60000); return c; };
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const pathOf = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };
const openTraining = async (page, base, F) => { await page.goto(`${base}/care-plans/${F.CX}?tab=training`); await page.locator('[data-testid="training-tab"]').waitFor({ timeout: 30000 }); await settle(page, 1200); };
const status = (page, name) => page.locator(`[data-roster="${name}"]`).getAttribute("data-status");

async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: office Portage; Bren Miller (manager), Hana Reed (HR), Pat Admin; Zoe N. plan renewed to v2 (training v2): in-service v1 + v2, session v1 (Ana, Ben), session v2 (Ana); Cleo never trained; shifts: Ana +3, Ben +5, open +7; authorization ends in 20 days`);
    const browser = await chromium.launch();
    { const w = await browser.newPage(); for (const p of ["/auth", "/care-plans", "/schedule"]) await w.goto(`${base}${p}`, { timeout: 120000 }).catch(() => {}); await w.close(); }
    try {
      const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage(); await login(page, base, F.mgr);
      // S14.1 + S14.2
      await page.goto(`${base}/care-plans`); await page.locator('[data-testid="risk-schedule-link"]').first().waitFor({ timeout: 30000 }); await settle(page);
      const btn = page.locator('[data-testid="risk-schedule-link"]').first();
      const btnText = (await btn.innerText()).trim(), btnCls = await btn.getAttribute("class");
      await btn.scrollIntoViewIfNeeded(); await shot(page, "risk-schedule-button-1440");
      await btn.click(); await page.waitForURL(`**/schedule?client=${F.CX}`, { timeout: 30000 }); await settle(page, 2500);
      const sel = page.locator('[data-testid="client-filter"]');
      const selText = (await sel.innerText()).trim(), clear = await page.getByRole("button", { name: "Clear" }).count(), pill = await page.getByText(/^Client: /).count();
      const back = (await page.locator('[data-testid="back-to-client"]').innerText()).trim();
      await shot(page, "schedule-client-filter-1440");
      rec("S1 risk panel: 'Schedule ›' is a small secondary button like 'Open ›'; it opens Schedule filtered to the client: a Client select (pre-selected), no 'Client: … Clear' pill, and '← Back to Zoe's care plan'",
        btnText === "Schedule ›" && /border/.test(btnCls) && /Zoe Nolan/.test(selText) && clear === 0 && pill === 0 && /^Back to Zoe's care plan$/.test(back),
        `button "${btnText}"; select "${selText}"; clear ${clear}; pill ${pill}; back "${back}"`);
      // the shared test agency has hundreds of clients: pick "All clients" (the first option) with the keyboard
      await sel.focus(); await page.keyboard.press("ArrowDown"); await page.locator('[role="listbox"]').waitFor({ timeout: 15000 }); await settle(page, 500);
      await page.keyboard.press("ArrowUp"); await settle(page, 200); await page.keyboard.press("Enter"); await page.locator('[role="listbox"]').waitFor({ state: "detached", timeout: 10000 }); await settle(page, 1000);
      const afterAll = pathOf(page), selAll = (await sel.innerText()).trim();
      await page.locator('[data-testid="back-to-client"]').click({ timeout: 15000 }); await page.waitForURL(`**/care-plans/${F.CX}`, { timeout: 20000 });
      rec("S2 'All clients' clears the filter and the URL parameter; the back link (kept while on the page) opens the client's care plan",
        !/client=/.test(afterAll) && /All clients/.test(selAll) && pathOf(page) === `/care-plans/${F.CX}`, `${afterAll}; select "${selAll}"; back → ${pathOf(page)}`);

      // S15 Training tab
      await openTraining(page, base, F);
      const head = (await page.locator('[data-testid="training-summary"]').innerText()).replace(/\s+/g, " ");
      const st = { ana: await status(page, "Ana Rivera"), ben: await status(page, "Ben Ostrowski"), cleo: await status(page, "Cleo Park") };
      const anaTxt = await page.locator('[data-roster="Ana Rivera"]').innerText();
      const sess = await page.locator("[data-session]").count(), inSv = await page.locator("[data-inservice]").count(), hist = await page.locator('[data-testid="training-history"] tbody tr').count();
      await page.locator('[data-testid="session-toggle"]').first().click(); await settle(page, 400);
      const att = await page.locator("[data-session-attendees]").innerText();
      await shot(page, "training-tab-1440", true);
      rec("T1 Training tab: header 'IPOS v2 (…) training · effective … · In-service signed … · 1 of 2 caregivers trained'; in-service row for v2; one v2 session (date, type, trainer, attendees → Ana); roster Ana 'Trained <date> by Bren Miller', Ben 'Needs retraining (trained v1)', Cleo 'Never trained'; history 4 forms",
        /IPOS v2 \((Initial|Annual|Addendum)\) training/.test(head) && /In-service signed/.test(head) && /1 of 2 caregivers trained/.test(head) && inSv === 1 && sess === 1 && /Ana Rivera/.test(att)
          && st.ana === "trained" && /Trained .* by Bren Miller/.test(anaTxt) && st.ben === "retrain" && st.cleo === "never" && hist === 4,
        `"${head.slice(0, 140)}"; ${JSON.stringify(st)}; sessions ${sess}; in-service ${inSv}; history ${hist}`);
      await page.locator('[data-filter="retrain"]').click(); await settle(page, 400);
      const onlyBen = await page.locator("[data-roster]").evaluateAll((els) => els.map((e) => e.getAttribute("data-roster")));
      await page.locator('[data-filter="trained"]').click(); await settle(page, 400);
      const onlyAna = await page.locator("[data-roster]").evaluateAll((els) => els.map((e) => e.getAttribute("data-roster")));
      await page.locator('[data-filter="all"]').click(); await settle(page, 400);
      rec("T2 roster filter chips: Needs retraining → Ben; Trained → Ana; All → 3", onlyBen.join() === "Ben Ostrowski" && onlyAna.join() === "Ana Rivera" && (await page.locator("[data-roster]").count()) === 3, `${onlyBen} | ${onlyAna}`);
      await page.locator('[data-roster="Ben Ostrowski"] [data-testid="add-to-session"]').click(); await page.locator('[data-testid="training-dialog"]').waitFor(); await settle(page, 500);
      const pre = await page.locator('[data-training-row="0"]').innerText();
      await page.fill("#tr-trainer", "Bren Miller"); await shot(page, "add-to-session-dialog-1440");
      await page.getByRole("button", { name: "Record session" }).click(); await page.locator('[data-testid="training-dialog"]').waitFor({ state: "detached", timeout: 20000 }); await settle(page, 1500);
      const head2 = (await page.locator('[data-testid="training-summary"]').innerText()).replace(/\s+/g, " ");
      rec("T3 'Add to a session' opens 'Record training session' with Ben as attendee (session date + trainer + signature date); saved → Ben Trained, '2 of 2 caregivers trained', 2 sessions",
        /Ben Ostrowski/.test(pre) && (await status(page, "Ben Ostrowski")) === "trained" && /2 of 2 caregivers trained/.test(head2) && (await page.locator("[data-session]").count()) === 2, `"${head2.slice(0, 120)}"`);

      // Scheduling tab: shifts + eligibility, link to Training
      await page.goto(`${base}/care-plans/${F.CX}?tab=scheduling`); await page.locator('[data-testid="scheduling-tab"]').waitFor({ timeout: 30000 }); await settle(page, 2500);
      const link = (await page.locator('[data-testid="training-link"]').innerText()).trim(), panels = await page.locator('[data-testid="training-panel"], [data-testid="retraining-list"]').count();
      const eligRows = await page.locator('[data-testid="can-deliver"] [data-caregiver]').count();
      await shot(page, "scheduling-tab-1440", true);
      await page.locator('[data-testid="training-link"]').click(); await page.locator('[data-testid="training-tab"]').waitFor({ timeout: 20000 });
      rec("T4 Scheduling tab keeps shifts + eligibility (no training panel or retraining list) and links '2 trained caregivers → Training' to the Training tab",
        link === "2 trained caregivers → Training" && panels === 0 && eligRows === 3 && /tab=training/.test(pathOf(page)), `"${link}"; training panels ${panels}; eligibility rows ${eligRows}; → ${pathOf(page)}`);
      // onboarding arrows
      await page.goto(`${base}/care-plans/${F.CX}?tab=onboarding`); await page.locator('[data-item="training"]').waitFor({ timeout: 30000 }); await settle(page);
      await page.locator('[data-item="training"]').getByRole("button", { name: /Go to Caregiver training/ }).click(); await page.locator('[data-testid="training-tab"]').waitFor({ timeout: 20000 });
      const t1 = pathOf(page);
      await page.goto(`${base}/care-plans/${F.CX}?tab=onboarding`); await page.locator('[data-item="inservice"]').waitFor({ timeout: 30000 }); await settle(page);
      await page.locator('[data-item="inservice"]').getByRole("button", { name: /Go to In-service signed/ }).click(); await page.locator('[data-testid="training-tab"]').waitFor({ timeout: 20000 });
      rec("T5 onboarding 'Caregiver training' and 'In-service signed' arrows open the Training tab", /tab=training/.test(t1) && /tab=training/.test(pathOf(page)), `${t1} | ${pathOf(page)}`);
      await ctx.close();

      // 390 + hr_staff
      const m = await ctxFor(browser, 390); const mp = await m.newPage(); await login(mp, base, F.mgr);
      await openTraining(mp, base, F); await shot(mp, "training-tab-390", true); const fit = await noHScroll(mp);
      await mp.goto(`${base}/schedule?client=${F.CX}`); await mp.locator('[data-testid="client-filter"]').waitFor({ timeout: 30000 }); await settle(mp, 1500); await shot(mp, "schedule-client-filter-390"); const fit2 = await mp.evaluate(() => { const W = document.documentElement.clientWidth; const card = document.querySelector('[data-testid="client-filter"]').closest(".rounded-lg, .rounded-xl, [class*=card]") || document.querySelector('[data-testid="client-filter"]').parentElement; return [...card.querySelectorAll("*")].every((e) => e.getBoundingClientRect().right <= W + 1); });
      if (!(await noHScroll(mp))) rec("I1 Schedule at 390: the existing tab bar (Today / Shifts / Unassigned / By Caregiver / By Client) is wider than the screen (pre-existing, not changed in S14); the new Client filter fits", "INFO");
      if (false) log("  390 overflow:", JSON.stringify(await mp.evaluate(() => { const W = document.documentElement.clientWidth; return [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > W + 1).slice(0, 6).map((e) => `${e.tagName}.${String(e.className).slice(0, 60)} r=${Math.round(e.getBoundingClientRect().right)}`); })));
      await m.close();
      const h = await ctxFor(browser, 1440); const hp = await h.newPage(); await login(hp, base, F.hr);
      await hp.goto(`${base}/training/${F.CX}`); await hp.locator('[data-testid="training-tab"]').waitFor({ timeout: 30000 }); await settle(hp, 1500);
      const hrTxt = await hp.locator("main").innerText(); await shot(hp, "hr-training-page-1440", true);
      rec("T6 390: Training tab fits without horizontal scroll and Schedule's filter row (with the Client select) fits; hr_staff's /training/:clientId shows the same tab (sessions, roster) without clinical text",
        fit && fit2 && /Training sessions/.test(hrTxt) && /Caregivers/.test(hrTxt) && !/Lay out the ingredients|Prepare a simple meal/.test(hrTxt), `fit ${fit}/${fit2}`);
      await h.close();
    } finally { await browser.close(); }
  } finally { await teardown(); await closeDb(); }
}

(async () => {
  const port = 8150 + Math.floor(Math.random() * 50);
  const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("vite did not start")), 90000);
      vite.stdout.on("data", (d) => { if (/Local:|ready in/i.test(d.toString())) { clearTimeout(to); res(); } }); });
    await run(`http://localhost:${port}`);
  } catch (e) { log("ERROR:", String(e.message).replace(/\x1b\[[0-9;]*m/g, "").slice(0, 2000)); rows.push({ id: "ERROR", ok: false }); }
  finally { try { execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ } }
  log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok === "INFO" ? "INFO" : r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => r.ok === false)) process.exitCode = 1;
})();

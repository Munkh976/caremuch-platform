// Ripple UI round 9 (S11: dashboard "Care plan compliance" section) — browser acceptance on DEV with real logins.
// Usage: node tests/ripple/ui/round9.cjs > some.log 2>&1   (never pipe a DEV suite; see README)
// Disposable fixtures with readable on-screen names; the run tag stays in client last names, emails and the office names.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round9");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui9-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], shifts: [], credTypes: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const { closeDb, dbDay, dbNow } = require("../dev/lib.cjs");

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
  F.RX = await ins("virtual_office", "virtual_office", { agency_id: A, name: `Ripple Effects Portage ${RUN}`, code: "RE-PORTAGE", is_demo: true });
  F.KC = await ins("virtual_office", "virtual_office", { agency_id: A, name: `Kind Care Southside ${RUN}`, is_demo: true });
  F.aa = await mkUser("aa", ["agency_admin"], null, false, "Pat Admin");
  F.mgr = await mkUser("mgr", ["manager"], F.RX, true, "Dana Cole");
  F.mgrK = await mkUser("mgrk", ["manager"], F.KC, true, "Kim Young");
  F.hr = await mkUser("hr", ["hr_staff"], F.RX, true, "Hana Reed");
  F.sch = await mkUser("sch", ["scheduler"], F.RX, true, "Sam Cole");
  F.cgA = await mkUser("cga", ["caregiver"], F.RX, false, "Ana Rivera");
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aa.c, "seed_office_care_plan_defaults", { _office_id: F.RX });
  ids.credTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  const cg = (first, last, user = null) => ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, user_id: user, first_name: first, last_name: last, email: `sec-${first.toLowerCase()}${SUFFIX}`, phone: "555-0100", is_demo: true });
  F.G1 = await cg("Ana", "Rivera", F.cgA.id); F.G2 = await cg("Ben", "Hart");
  await admin.from("caregiver_skills").insert([F.G1, F.G2].map((g) => ({ caregiver_id: g, care_type_code: "CLS0001", is_demo: true })));
  const req = (await admin.from("credential_types").select("id, name").eq("agency_id", A).eq("required", true).eq("is_active", true).order("name")).data;
  // Ana: first required credential due in 20 days (red); Ben: first one 3 days overdue (★), second one due in 50 days (yellow)
  await must(F.hr.c, "enter_caregiver_credential", { _caregiver_id: F.G1, _credential_type_id: req[0].id, _effective_date: await dbDay(-300), _expiry_date: await dbDay(20), _certification_number: null });
  await must(F.hr.c, "enter_caregiver_credential", { _caregiver_id: F.G2, _credential_type_id: req[0].id, _effective_date: await dbDay(-400), _expiry_date: await dbDay(-3), _certification_number: null });
  await must(F.hr.c, "enter_caregiver_credential", { _caregiver_id: F.G2, _credential_type_id: req[1].id, _effective_date: await dbDay(-300), _expiry_date: await dbDay(50), _certification_number: null });
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 40 * 864e5).toISOString() }).eq("id", F.RX);   // go-live before the fixture's visits
  const cl = (first, last, office = F.RX) => ins("clients", "clients", { agency_id: A, virtual_office_id: office, first_name: first, last_name: `${last} ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.CX = await cl("Zoe", "Nolan"); F.CM = await cl("Max", "Ortiz"); F.CK = await cl("Omar", "Kent", F.KC);
  F.plan = await must(F.mgr.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(330) } });
  await must(F.mgr.c, "upsert_care_plan_goals", { _care_plan_id: F.plan, _goals: [{ seq: 1, goal_text: "CLINICAL-GOAL", objectives: [{ seq: 1, letter: "A", objective_text: "CLINICAL-OBJ", staff_instructions: "CLINICAL-INSTR", service_type: "cls", responsible_party: "this_agency" }] }] });
  // 40 units expiring in 20 days (units at risk, red)
  await must(F.mgr.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: "ISK-2026-0901", _units_authorized: 40, _effective_date: await dbDay(-30), _expiration_date: await dbDay(20) });
  await must(F.mgr.c, "record_inservice_form", { _care_plan_id: F.plan, _case_manager_name: "Casey Manager", _program_lead_id: F.mgr.id, _trained_on: await dbDay(-20), _signed_at: await dbNow() });
  await must(F.mgr.c, "record_training_form", { _care_plan_id: F.plan, _plan_document_type: "ipos_initial", _plan_effective_date: null, _location: null, _records: [{ caregiver_id: F.G1, training_date: await dbDay(-20) }] });
  const sh = async (client, k, start = "13:00") => ins("shifts", "shifts", { agency_id: A, virtual_office_id: F.RX, client_id: client, order_title: `Visit ${RUN}`, care_type_code: "CLS0001",
    shift_date: await dbDay(k), start_time: start, end_time: `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00`, duration_hours: 1, status: "open", is_demo: true });
  const assign = (s, g) => must(F.mgr.c, "assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: g, _method: "manual", _notes: "round9 fixture", _override_reason: "round9 fixture (disposable)" });
  // past: one submitted note (to review), one visit with no note (overdue)
  F.sSub = await sh(F.CX, -3, "09:00"); await assign(F.sSub, F.G1);
  F.sOver = await sh(F.CX, -4, "09:00"); await assign(F.sOver, F.G1);
  const n = await must(F.cgA.c, "create_progress_note_for_shift", { _shift_id: F.sSub });
  const row = (await admin.from("progress_notes").select("scheduled_start, scheduled_end").eq("id", n).single()).data;
  await must(F.cgA.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: row.scheduled_start, actual_end: row.scheduled_end }, _entries: [], _narrative_text: null });
  await must(F.cgA.c, "submit_progress_note", { _note_id: n, _typed_signature: "Ana Rivera" });
  // renewal -> v2: Ana needs retraining for her upcoming Zoe shifts; an unassigned Max shift with no authorization
  F.plan2 = await must(F.mgr.c, "renew_care_plan", { _care_plan_id: F.plan });
  F.sU1 = await sh(F.CX, 1); await assign(F.sU1, F.G1);
  F.sU2 = await sh(F.CX, 2); await assign(F.sU2, F.G1);
  F.sMax = await sh(F.CM, 3);
  F.sK = await ins("shifts", "shifts", { agency_id: A, virtual_office_id: F.KC, client_id: F.CK, order_title: `Visit ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(2), start_time: "10:00", end_time: "11:00", duration_hours: 1, status: "open", is_demo: true });
  return F;
}

async function teardown() {
  for (const id of ids.clients) {
    for (const { id: n } of (await admin.from("progress_notes").select("id").eq("client_id", id)).data || []) await admin.from("events").delete().eq("subject_id", n);
    await admin.from("progress_notes").delete().eq("client_id", id);
  }
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
  for (const id of ids.virtual_office) { const { data } = await admin.from("events").select("id").eq("virtual_office_id", id); if (data && data.length) left.push(`events for ${id}`); }
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} offices, ${ids.caregivers.length} caregivers, ${ids.clients.length} clients, ${ids.shifts.length} shifts → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
}

async function login(page, base, u) {
  await page.goto(`${base}/auth`, { timeout: 90000 }); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const ctxFor = (browser, w) => browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
const storage = (page) => page.evaluate(() => { const dump = (s) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => s.key(i)).map((k) => [k, s.getItem(k)])); return { local: dump(localStorage), session: dump(sessionStorage) }; });
async function openDashboard(page, base) {
  await page.goto(`${base}/dashboard`); await page.locator('[data-testid="compliance-section"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid^="cs-count-"]')].every((e) => e.textContent !== "–"), null, { timeout: 30000 });
  await page.locator('[data-testid="notes-review-panel"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
}
const count = async (page, id) => Number(await page.locator(`[data-testid="cs-count-${id}"]`).innerText());

// =============================================================================================
async function manager(base, F, browser) {
  const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage(); await login(page, base, F.mgr);
  const urls = []; page.on("framenavigated", (f) => { if (f === page.mainFrame()) urls.push(f.url()); });
  await openDashboard(page, base);
  await shot(page, "section-1440", true);
  for (const id of ["onboarding", "credentials", "units", "retraining", "readiness"]) await page.locator(`[data-testid="cs-${id}"]`).screenshot({ path: path.join(SHOTS, `panel-${id}-1440.png`) });
  await page.locator('[data-testid="notes-review-panel"]').screenshot({ path: path.join(SHOTS, "panel-notes-billing-1440.png") });
  // expected = the RPCs, called as the same manager
  const c = F.mgr.c;
  const onb = await must(c, "list_clients_onboarding", { _office_id: F.RX });
  const officeClients = new Set(((await c.from("clients").select("id").eq("virtual_office_id", F.RX)).data || []).map((x) => x.id));
  const exp = {
    onboarding: onb.filter((o) => !o.onboarded && officeClients.has(o.client_id)).length,
    credentials: (await must(c, "list_credential_expirations", { _office_id: F.RX, _within_days: 60 })).length,
    units: (await must(c, "list_authorization_risk", { _office_id: F.RX, _within_days: 60 })).length,
    retraining: new Set((await must(c, "list_caregivers_needing_retraining", { _office_id: F.RX })).map((r) => r.caregiver_id)).size,
    readiness: (await must(c, "get_enforcement_readiness", { _office_id: F.RX, _days: 14 })).would_block,
  };
  const counts = {}; for (const id of Object.keys(exp)) counts[id] = await count(page, id);
  const nc = await must(c, "get_notes_review_counts", {});
  const toReview = nc.reduce((n, x) => n + Number(x.to_review), 0), overdue = nc.reduce((n, x) => n + Number(x.overdue), 0);
  const panelNotes = { r: Number(await page.locator('[data-testid="panel-to-review"]').innerText()), o: Number(await page.locator('[data-testid="panel-overdue"]').innerText()) };
  rec("C1 every panel count equals its RPC on the fixture (onboarding pending, credentials ≤ 60 days incl. missing, units at risk, caregivers needing retraining, enforcement readiness); notes to review / overdue equal get_notes_review_counts",
    JSON.stringify(counts) === JSON.stringify(exp) && panelNotes.r === toReview && panelNotes.o === overdue && exp.onboarding === 2 && exp.retraining === 1 && exp.readiness >= 3 && exp.units === 1 && toReview === 1 && overdue >= 1,
    `ui ${JSON.stringify(counts)} rpc ${JSON.stringify(exp)}; notes ${JSON.stringify(panelNotes)} rpc ${toReview}/${overdue}`);
  const credTxt = await page.locator('[data-testid="cs-credentials"]').innerText();
  const firstBand = await page.locator('[data-testid="cs-credentials-row"]').first().getAttribute("data-band");
  const onbTxt = await page.locator('[data-testid="cs-onboarding"]').innerText();
  const retTxt = await page.locator('[data-testid="cs-retraining"]').innerText();
  const rdTxt = await page.locator('[data-testid="cs-readiness"]').innerText();
  rec("C2 rows: onboarding 'N of 8' + missing items; credentials ★ overdue first with the bands (1 overdue, 1 ≤ 30, 1 ≤ 60); retraining with the next shift; readiness 'Advisory' with reasons (training, credential, authorization)",
    /of 8/.test(onbTxt) && /Missing:/.test(onbTxt) && firstBand === "overdue" && /1 overdue/.test(credTxt) && /1 ≤ 30 days/.test(credTxt) && /1 ≤ 60 days/.test(credTxt) && /★ Overdue/.test(credTxt)
      && /Ana Rivera/.test(retTxt) && /next shift/.test(retTxt) && /Advisory/.test(rdTxt) && /Not trained on the current plan/.test(rdTxt) && /Required credential missing/.test(rdTxt) && /No authorization/.test(rdTxt),
    `${credTxt.replace(/\s+/g, " ").slice(0, 120)} | ${rdTxt.replace(/\s+/g, " ").slice(0, 160)}`);
  const all = await page.locator('[data-testid="compliance-section"]').innerText();
  rec("C3 no clinical text in the section (goal / objective / instructions never shown); billing line present", !/CLINICAL-/.test(all) && (await page.locator('[data-testid="billing-line"]').count()) >= 1, "");
  // deep links
  const links = [
    ["onboarding", '[data-testid="cs-onboarding-row"] a', (u) => /^\/care-plans\/[0-9a-f-]+$/.test(u.pathname) && u.searchParams.get("tab") === "onboarding", '[data-testid="onboarding-tab"], [role="tab"][data-state="active"]'],
    ["credentials", '[data-testid="cs-credentials-row"] a', (u) => u.pathname === "/caregivers", '[role="tab"][data-state="active"]:has-text("Credentials")'],
    ["units", '[data-testid="cs-units-row"] a', (u) => u.pathname === `/care-plans/${F.CX}` && u.searchParams.get("tab") === "ipos", '[data-testid="authorizations"]'],
    ["retraining", '[data-testid="cs-retraining-row"] a', (u) => u.pathname === `/training/${F.CX}`, "body"],
    ["readiness", '[data-testid="cs-readiness-row"] a', (u) => u.pathname === "/schedule" && officeClients.has(u.searchParams.get("client")), "body"],
    ["readiness-settings", '[data-testid="cs-all-readiness"]', (u) => u.pathname === `/virtual-offices/${F.RX}`, '[data-testid="compliance-card"]'],
    ["notes", '[data-testid="notes-review-panel"] a[href="/progress-notes?status=submitted"]', (u) => u.pathname === "/progress-notes" && u.searchParams.get("status") === "submitted", "body"],
    ["overdue", '[data-testid="notes-review-panel"] a[href="/progress-notes?status=overdue"]', (u) => u.pathname === "/progress-notes" && u.searchParams.get("status") === "overdue", "body"],
    ["billing", '[data-testid="billing-line"]', (u) => u.pathname === "/billing/weekly", '[data-testid="week-picker"]'],
  ];
  const res = {};
  for (const [name, sel, urlOk, landing] of links) {
    await openDashboard(page, base);
    await page.locator(sel).first().click(); await page.waitForTimeout(3500);
    const u = new URL(page.url());
    let landed = await page.locator(landing).first().isVisible().catch(() => false);
    if (name === "credentials") landed = (await page.locator('[role="tab"][data-state="active"]', { hasText: /Credentials/ }).count()) > 0 || landed;
    res[name] = urlOk(u) && landed;
    if (!res[name]) log(`  link ${name}: ${u.pathname}${u.search} landed ${landed}`);
    if (name === "credentials" || name === "readiness-settings") await shot(page, `link-${name}-1440`);
  }
  rec("L1 every row deep-links to the right record / tab: onboarding tab, Credentials tab, IPOS authorizations, client training, the client's schedule, compliance settings, notes to review, overdue notes, Weekly Billing",
    Object.values(res).length === 9 && Object.values(res).every(Boolean), JSON.stringify(res));
  const st = await storage(page);
  rec("P1 no PHI in URLs or browser storage (ids only)", !urls.some((x) => /Zoe|Nolan|Rivera|ISK-/.test(decodeURIComponent(x))) && !/Zoe|Nolan|ISK-2026/.test(JSON.stringify(st)), `${urls.length} URLs`);
  await ctx.close();
  // 390
  const m = await ctxFor(browser, 390); const mp = await m.newPage(); await login(mp, base, F.mgr); await openDashboard(mp, base);
  await mp.locator('[data-testid="compliance-section"]').scrollIntoViewIfNeeded(); await shot(mp, "section-390", true);
  for (const id of ["credentials", "readiness"]) { await mp.locator(`[data-testid="cs-${id}"]`).scrollIntoViewIfNeeded(); await mp.locator(`[data-testid="cs-${id}"]`).screenshot({ path: path.join(SHOTS, `panel-${id}-390.png`) }); }
  const wide = await mp.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1)
    .slice(0, 6).map((e) => `${e.tagName.toLowerCase()}${e.getAttribute("data-testid") ? "#" + e.getAttribute("data-testid") : ""}.${String(e.className).slice(0, 50)} r=${Math.round(e.getBoundingClientRect().right)}`); });
  const inSection = await mp.evaluate(() => { const w = document.documentElement.clientWidth; const s = document.querySelector('[data-testid="compliance-section"]');
    return [...s.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > w + 1).length; });
  rec("M1 the section at 390: one column, nothing in it wider than the screen", inSection === 0, `page h-scroll ${!(await noHScroll(mp))}; wide: ${wide.join(" | ")}`); await m.close();
}

async function others(base, F, browser) {
  // agency admin (unrestricted): sees the section for the module office
  { const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, F.aa); await openDashboard(p, base);
    rec("A1 agency admin sees the section with the same readiness count", (await count(p, "readiness")) === (await must(F.aa.c, "get_enforcement_readiness", { _office_id: F.RX, _days: 14 })).would_block, ""); await c.close(); }
  // hr_staff / scheduler: dashboard without the section (clinical tier only)
  const out = [];
  for (const [u, label] of [[F.hr, "hr_staff"], [F.sch, "scheduler"]]) {
    const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, u);
    await p.goto(`${base}/dashboard`); await p.waitForTimeout(5000);
    out.push({ label, section: await p.locator('[data-testid="compliance-section"]').count() }); await c.close(); }
  rec("R1 hr_staff and scheduler see no compliance section", out.every((x) => x.section === 0), JSON.stringify(out));
  // Kind Care office manager: dashboard exactly as before (no section, no notes / billing panel)
  const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, F.mgrK);
  await p.goto(`${base}/dashboard`); await p.getByRole("heading", { name: "Dashboard" }).waitFor({ timeout: 30000 }); await p.waitForTimeout(5000);
  const kc = { section: await p.locator('[data-testid="compliance-section"]').count(), notes: await p.locator('[data-testid="notes-review-panel"]').count(), text: /Care plan compliance/.test(await p.locator("body").innerText()) };
  await shot(p, "kindcare-dashboard-1440");
  { const m = await ctxFor(browser, 390); const mp = await m.newPage(); await login(mp, base, F.mgrK); await mp.goto(`${base}/dashboard`); await mp.waitForTimeout(5000);
    rec("K0 baseline: the Kind Care dashboard at 390 (no S11 section) — page horizontal scroll as before S11", "INFO", `h-scroll ${!(await noHScroll(mp))}`); await m.close(); }
  rec("K1 a Kind-Care-only manager's dashboard is unchanged: no compliance section, no notes / billing panel", kc.section === 0 && kc.notes === 0 && !kc.text, JSON.stringify(kc));
  await c.close();
}

async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: Ripple Effects Portage (module on, enforcement off) + Kind Care Southside; Dana Cole (manager), Pat Admin, Kim Young (Kind Care), Hana Reed (HR), Sam Cole (scheduler); Ana Rivera (red credential, trained v1, Zoe renewed to v2), Ben Hart (overdue + yellow); Zoe N. (authorization expiring in 20 days, a submitted note, an overdue visit), Max O. (no plan, no authorization)`);
    const browser = await chromium.launch();
    try { await manager(base, F, browser); await others(base, F, browser); } finally { await browser.close(); }
  } finally { await teardown(); await closeDb(); }
}

(async () => {
  const port = 8150 + Math.floor(Math.random() * 50);
  const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("vite did not start")), 90000);
      vite.stdout.on("data", (d) => { if (/Local:|ready in/i.test(d.toString())) { clearTimeout(to); res(); } }); });
    await run(`http://localhost:${port}`);
  } catch (e) { log("ERROR:", String(e.message).replace(/[[0-9;]*m/g, "").slice(0, 2000)); }
  finally { try { execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ } }
  log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok === "INFO" ? "INFO" : r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => r.ok === false)) process.exitCode = 1;
})();

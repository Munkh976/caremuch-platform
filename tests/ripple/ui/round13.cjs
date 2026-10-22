// Ripple UI round 13 (S17 IPOS versions) — browser acceptance on DEV with real logins, in a disposable tagged office of
// the test agency (never the demo office RPLDEMO).
// Usage: node tests/ripple/ui/round13.cjs > some.log 2>&1   (never pipe a DEV suite; see README)
//   V1 expiry warning on the client page (amber, 1c) with the visit already scheduled after the date and its Schedule
//      link; the dashboard's "IPOS expiring" panel.
//   V2 "Start new IPOS version (from ISK)" → v2 PENDING card + header badge; the action is hidden while pending; the
//      warning now says v2 is waiting for its in-service / training; 390 fit.
//   V3 Goals: version picker (v1 in effect / v2 pending) with the pending note. V4 the ISK IPOS PDF attached to v2.
//   V5 Training tab: pending banner; in-service + a session → v2 active, v1 superseded, banner and badge gone.
//   V6 an edit of the active version → "rev 1" and "What changed". V7 the order wizard stops a series at the IPOS and
//      authorization end dates and lists the skipped visits; saving creates only the kept visits.
// Screenshots: docs/screenshots/ripple-ui/round13/.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const { jsPDF } = require("jspdf");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round13");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui13-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], credTypes: [], orders: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const { dbDay, dbNow, closeDb, pgRead } = require("../dev/lib.cjs");
const BUCKET = "cp-attachments";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "round13-"));

async function ins(t, key, row) { const { data, error } = await admin.from(t).insert(row).select("id").single(); if (error) throw new Error(`${t}: ${error.message}`); if (key) ids[key].push(data.id); return data.id; }
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
  await admin.from("virtual_office").update({ care_plan_module_enabled: true, care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 20 * 864e5).toISOString() }).eq("id", F.RX);
  F.G = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, first_name: "Ana", last_name: `Rivera ${RUN}`, email: `sec-ana${SUFFIX}`, phone: "555-0100", is_demo: true });
  await admin.from("caregiver_skills").insert([{ caregiver_id: F.G, care_type_code: "CLS0001", is_demo: true }]);
  F.CX = await ins("clients", "clients", { agency_id: A, virtual_office_id: F.RX, first_name: "Zoe", last_name: `Nolan ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  // a visit dated after the IPOS end, created before the plan existed (e.g. the date was corrected later)
  F.late = await ins("shifts", null, { agency_id: A, virtual_office_id: F.RX, client_id: F.CX, order_title: `Visit ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(24), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
  F.plan = await must(F.mgr.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-60), expiration_date: await dbDay(20) } });
  await must(F.mgr.c, "upsert_care_plan_goals", { _care_plan_id: F.plan, _goals: [{ seq: 1, goal_text: "Build daily living skills", objectives: [{ seq: 1, letter: "A", objective_text: "Prepare a simple meal", staff_instructions: "Lay out the ingredients first.", service_type: "cls" }] }] });
  await must(F.mgr.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ISK-${RUN}`, _units_authorized: 400, _effective_date: await dbDay(-60), _expiration_date: await dbDay(15) });
  await must(F.mgr.c, "record_inservice_form", { _care_plan_id: F.plan, _case_manager_name: "Robin Hale", _program_lead_id: F.mgr.id, _trained_on: await dbDay(-55), _signed_at: `${await dbDay(-55)}T12:00:00Z`, _field_values: {} });
  await must(F.mgr.c, "record_training_form", { _care_plan_id: F.plan, _plan_document_type: "ipos_initial", _plan_effective_date: null, _location: null,
    _records: [{ caregiver_id: F.G, training_date: await dbDay(-54), trainer_name: "Bren Miller", signed_date: await dbDay(-54) }], _field_values: {} });
  // an order for Zoe (the wizard's edit mode): CLS Mon + Wed, 09:00-10:00, from today for 3 months
  F.orderNo = `ZZ-${RUN}`;
  const today = await dbDay(0);
  F.order = await ins("client_orders", "orders", { agency_id: A, client_id: F.CX, order_number: F.orderNo, start_date: today, end_date: await dbDay(90), duration_months: 3, frequency: "weekly", status: "submitted" });
  const { error: le } = await admin.from("order_services").insert({ order_id: F.order, care_type_code: "CLS0001", days_of_week: [1, 3], start_time: "09:00:00", end_time: "10:00:00", frequency: "weekly" });
  if (le) throw new Error(`order_services: ${le.message}`);
  return F;
}
async function teardown(F) {
  if (F) {
    const objs = ((await admin.storage.from(BUCKET).list(`${A}/${F.RX}`, { limit: 1000 })).data || []).map((o) => `${A}/${F.RX}/${o.name}`);
    if (objs.length) await admin.storage.from(BUCKET).remove(objs);
    await admin.from("cp_attachments").delete().eq("virtual_office_id", F.RX);
  }
  for (const id of ids.orders) { await admin.from("shifts").delete().eq("order_id", id); await admin.from("order_services").delete().eq("order_id", id); await admin.from("client_orders").delete().eq("id", id); }
  for (const id of ids.clients) {
    for (const { id: s } of (await admin.from("shifts").select("id").eq("client_id", id)).data || []) { await admin.from("shift_assignments").delete().eq("shift_id", s); await admin.from("events").delete().eq("subject_id", s); }
    await admin.from("shifts").delete().eq("client_id", id);
    for (const t of ["plan_training_forms", "plan_inservice_forms", "client_documents", "care_plans", "service_authorizations"])
      for (const { id: x } of (await admin.from(t).select("id").eq("client_id", id)).data || []) await admin.from("events").delete().eq("subject_id", x);
    for (const t of ["care_plan_revisions", "plan_training_records", "plan_training_forms", "plan_inservice_forms", "client_documents", "service_authorizations"]) await admin.from(t).delete().eq("client_id", id);
    await admin.from("care_plans").update({ status: "superseded" }).eq("client_id", id).eq("status", "pending");
    await admin.from("care_plans").delete().eq("client_id", id);
  }
  for (const id of ids.caregivers) { await admin.from("caregiver_certifications").delete().eq("caregiver_id", id); await admin.from("caregiver_skills").delete().eq("caregiver_id", id); }
  for (const t of ["clients", "caregivers"]) for (const id of ids[t]) await admin.from(t).delete().eq("id", id);
  for (const id of ids.users) { await admin.from("user_roles").delete().eq("user_id", id); await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
  for (const id of ids.virtual_office) { await admin.from("events").delete().eq("virtual_office_id", id); await admin.from("office_service_types").delete().eq("virtual_office_id", id); await admin.from("virtual_office").delete().eq("id", id); }
  for (const id of ids.credTypes) await admin.from("credential_types").delete().eq("id", id);
  const left = [];
  for (const [t, key] of [["clients", "clients"], ["caregivers", "caregivers"], ["virtual_office", "virtual_office"], ["credential_types", "credTypes"], ["client_orders", "orders"]])
    for (const id of ids[key]) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  if (F) { const q = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM storage.objects WHERE bucket_id = $1 AND name LIKE $2)::int o, (SELECT count(*) FROM public.care_plans WHERE client_id = $3)::int p, (SELECT count(*) FROM public.shifts WHERE client_id = $3)::int s`, [BUCKET, `${A}/${F.RX}/%`, F.CX])).rows[0]);
    if (q.o || q.p || q.s) left.push(`left ${JSON.stringify(q)}`); }
  fs.rmSync(TMP, { recursive: true, force: true });
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} office, ${ids.clients.length} client, ${ids.orders.length} order → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query, incl. storage objects)"}`);
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
const openClient = async (page, base, F, tab = "ipos") => { await page.goto(`${base}/care-plans/${F.CX}?tab=${tab}`); await page.locator('[data-testid="client-header"]').waitFor({ timeout: 30000 }); await settle(page, 1500); };

async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: Zoe N. IPOS v1 until +20 (Ana trained), CLS authorization until +15, a visit already at +24, an order Mon/Wed for 3 months`);
    const browser = await chromium.launch();
    { const w = await browser.newPage(); for (const p of ["/auth", "/care-plans", "/dashboard", "/order-management"]) await w.goto(`${base}${p}`, { timeout: 120000 }).catch(() => {}); await w.close(); }
    try {
      const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage(); await login(page, base, F.mgr);
      // V1
      await openClient(page, base, F);
      const ban = page.locator('[data-testid="ipos-expiry-banner"]');
      const banTxt = (await ban.innerText()).replace(/\s+/g, " "), band = await ban.getAttribute("data-band");
      const href = await ban.locator('[data-testid="shifts-after"] a').getAttribute("href");
      await shot(page, "expiry-warning-1440");
      await page.goto(`${base}/dashboard`); await page.locator('[data-testid="cs-ipos-row"]').first().waitFor({ timeout: 30000 }); await settle(page, 800);
      const dash = (await page.locator('[data-testid="cs-ipos-row"]').first().innerText()).replace(/\s+/g, " ");
      await page.locator('[data-testid="cs-ipos-row"]').first().scrollIntoViewIfNeeded(); await shot(page, "dashboard-ipos-expiring-1440");
      rec("V1 client page: amber warning 'IPOS v1 expires in 20 days; no new version has been started', the visit already scheduled after the date with 'Open in Schedule' (?client=); the dashboard's IPOS expiring panel lists Zoe",
        band === "amber" && /IPOS v1 expires in 20 days; no new version has been started/.test(banTxt) && /1 visit is already scheduled after that date/.test(banTxt) && href === `/schedule?client=${F.CX}`
          && /Zoe Nolan/.test(dash) && /20 days/.test(dash), `"${banTxt.slice(0, 160)}"; dash "${dash.slice(0, 90)}"`);
      // V2
      await openClient(page, base, F);
      await page.locator('[data-testid="start-version"]').click(); await page.getByRole("button", { name: "Continue" }).click();
      await page.locator('[data-testid="renewal-confirm"]').waitFor(); await settle(page, 400); await shot(page, "start-version-confirm-1440");
      await page.locator('[data-testid="confirm-start-version"]').click(); await page.locator('[data-testid="pending-plan"]').waitFor({ timeout: 20000 }); await settle(page, 1500);
      const head = (await page.locator('[data-testid="client-header"]').innerText()).replace(/\s+/g, " ");
      const startCount = await page.locator('[data-testid="start-version"]').count();
      const ban2 = (await page.locator('[data-testid="ipos-expiry-banner"]').innerText()).replace(/\s+/g, " ");
      const st = (await admin.from("care_plans").select("version, status").eq("client_id", F.CX).order("version")).data;
      await shot(page, "pending-version-1440", true);
      rec("V2 'Start new IPOS version (from ISK)' → confirmation → v2 PENDING card; header 'Plan v1 active' + 'IPOS v2 · Pending: in-service / training'; the action is hidden; the warning: 'v2 is waiting for its in-service / training'",
        /Plan v1 active/.test(head) && /IPOS v2 · Pending: in-service \/ training/.test(head) && startCount === 0 && /v2 is waiting for its in-service \/ training/.test(ban2)
          && st.map((x) => `${x.version}:${x.status}`).join(" ") === "1:active 2:pending", `${st.map((x) => `${x.version}:${x.status}`).join(" ")}; start ${startCount}; "${head.slice(-90)}"; banner "${ban2.slice(0, 110)}"`);
      // V3
      await page.getByRole("tab", { name: "Goals" }).click(); await settle(page, 1000);
      const chips = await page.locator('[data-testid="goals-version"] button').allInnerTexts();
      await page.locator('[data-testid="goals-version"] button', { hasText: "pending" }).click(); await settle(page, 1200);
      const note = await page.locator("main").innerText();
      await shot(page, "goals-pending-1440");
      rec("V3 Goals: version picker 'v1 (in effect)' / 'v2 (pending)'; the pending version says changes don't start retraining and aren't revisions",
        chips.join("|") === "v1 (in effect)|v2 (pending)" && /Pending IPOS v2 .*don't start retraining and aren't revisions/.test(note.replace(/\s+/g, " ")), chips.join(" | "));
      // V4
      await page.getByRole("tab", { name: "IPOS" }).click(); await page.locator('[data-testid="pending-plan"]').waitFor(); await settle(page, 800);
      const d = new jsPDF(); d.text("ISK IPOS v2 (fictitious)", 20, 20); const pdf = path.join(TMP, "ISK IPOS v2.pdf"); fs.writeFileSync(pdf, Buffer.from(d.output("arraybuffer")));
      await page.locator('[data-testid="pending-plan"] [data-testid="files-button"]').click();
      const dlg = page.locator('[role="dialog"]').filter({ has: page.locator('[data-testid="attachments-block"]') }).first(); await dlg.waitFor();
      await dlg.locator('[data-testid="attachment-input"]').setInputFiles(pdf);
      await page.waitForFunction(() => document.querySelectorAll('[role="dialog"] [data-testid="attachment-row"]').length >= 1, null, { timeout: 60000 }); await settle(page, 800);
      await page.keyboard.press("Escape"); await settle(page, 600);
      const fb = (await page.locator('[data-testid="pending-plan"] [data-testid="files-button"]').innerText()).trim();
      rec("V4 the ISK IPOS PDF is attached to the pending v2 (Files (1))", fb === "Files (1)", fb);
      // 390 while pending
      { const m = await ctxFor(browser, 390); const mp = await m.newPage(); await login(mp, base, F.mgr); await openClient(mp, base, F);
        await mp.locator('[data-testid="pending-plan"]').scrollIntoViewIfNeeded(); await shot(mp, "pending-version-390", true); F.fit390 = await noHScroll(mp); await m.close(); }
      // V5
      await openClient(page, base, F, "training"); await page.locator('[data-testid="training-tab"]').waitFor({ timeout: 20000 }); await settle(page, 800);
      const pb = (await page.locator('[data-testid="pending-training"]').innerText()).replace(/\s+/g, " ");
      await shot(page, "training-pending-1440");
      const p2 = st[1] && (await admin.from("care_plans").select("id").eq("client_id", F.CX).eq("version", 2).single()).data.id;
      await must(F.hr.c, "record_inservice_form", { _care_plan_id: p2, _case_manager_name: "Robin Hale", _program_lead_id: F.mgr.id, _trained_on: await dbDay(0), _signed_at: new Date(Date.parse(await dbNow()) - 6e4).toISOString(), _field_values: {} });
      await must(F.hr.c, "record_training_form", { _care_plan_id: p2, _plan_document_type: "ipos_annual", _plan_effective_date: null, _location: null,
        _records: [{ caregiver_id: F.G, training_date: await dbDay(0), trainer_name: "Bren Miller", signed_date: await dbDay(0) }], _field_values: {} });
      await openClient(page, base, F);
      const head2 = (await page.locator('[data-testid="client-header"]').innerText()).replace(/\s+/g, " ");
      const pend2 = await page.locator('[data-testid="pending-plan"]').count();
      const hist = (await page.locator('[data-testid="plan-history"]').innerText()).replace(/\s+/g, " ");
      rec("V5 Training tab shows 'IPOS v2 is pending … v1 stays in effect'; after the in-service and one session v2 is active: header 'Plan v2 active', no pending card or badge, v1 superseded",
        /IPOS v2 is pending/.test(pb) && /IPOS v1 stays in effect/.test(pb) && /Plan v2 active/.test(head2) && !/Pending/.test(head2) && pend2 === 0 && /v1 .*Superseded/.test(hist),
        `"${pb.slice(0, 80)}"; "${head2.slice(0, 60)}"`);
      // V6
      await must(F.mgr.c, "update_care_plan_fields", { _care_plan_id: p2, _header: { recorder_name: "Sam Recorder" }, _field_values: null });
      await openClient(page, base, F);
      const title = (await page.locator('[data-testid="active-plan"]').innerText()).split("\n")[0];
      await page.locator('[data-testid="what-changed-button"]').click(); await page.locator('[data-testid="revisions-dialog"]').waitFor(); await settle(page, 1000);
      const wc = (await page.locator('[data-testid="revisions-dialog"]').innerText()).replace(/\s+/g, " ");
      await shot(page, "what-changed-1440"); await page.keyboard.press("Escape"); await settle(page, 400);
      rec("V6 an edit of the version in effect → '… v2 · rev 1'; What changed: 'Rev 1 … Recorder: — → Sam Recorder', 'Rev 0 … Became effective.'", /v2 · rev 1/.test(title) && /Rev 1/.test(wc) && /Recorder: — → Sam Recorder/.test(wc) && /Rev 0.*Became effective/.test(wc),
        `"${title}"; "${wc.slice(0, 140)}"`);
      // V7 order wizard (v2 copied v1's dates: IPOS until +20, CLS authorization until +15)
      await page.goto(`${base}/order-management`); await page.getByPlaceholder("Search by plan # or client name...").fill(F.orderNo); await settle(page, 1500);
      const row = page.locator("tr", { hasText: F.orderNo }).first(); await row.waitFor({ timeout: 30000 });
      await row.locator("button").nth(2).click();   // chevron, details, edit
      const wiz = page.locator('[role="dialog"]').last(); await wiz.waitFor({ timeout: 20000 }); await settle(page, 1500);
      for (let i = 0; i < 3; i++) { await wiz.getByRole("button", { name: "Next" }).click(); await settle(page, 700); }
      await page.locator('[data-testid="skipped-visits"]').waitFor({ timeout: 20000 }).catch(async () => { await shot(page, "debug-wizard"); log("  wizard:", (await page.locator('[role="dialog"]').last().innerText()).replace(/\s+/g, " ").slice(0, 400)); });
      const sk = (await page.locator('[data-testid="skipped-visits"]').innerText()).replace(/\s+/g, " ");
      const kept = Number((await page.locator('[role="dialog"] .text-2xl').first().innerText()).trim());
      await shot(page, "order-wizard-skipped-1440");
      await page.getByRole("button", { name: /Submit|Save care plan|Update/ }).last().click(); await settle(page, 3000);
      const made = (await admin.from("shifts").select("shift_date").eq("order_id", F.order)).data || [];
      const lim = { auth: await dbDay(15), ipos: await dbDay(20) };
      rec("V7 order wizard (edit): the series stops at the dates and lists the skipped visits ('… won't be created', 'no CLS authorization after …', 'after IPOS v2 expires (…)'); saving creates exactly the kept visits, none after the authorization end",
        /won't be created/.test(sk) && /no CLS authorization after/.test(sk) && kept > 0 && made.length === kept && made.every((s) => s.shift_date <= lim.auth),
        `"${sk.slice(0, 160)}"; kept ${kept}; created ${made.length}`);
      rec("V8 390: the client page with the pending version and the warning fits without horizontal page scroll", !!F.fit390, `${F.fit390}`);
      await ctx.close();
    } finally { await browser.close(); }
  } finally { await teardown(F); await closeDb(); }
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

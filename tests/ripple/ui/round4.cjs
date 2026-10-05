// Ripple UI round 4 (round-3 polish + W2 void UI + S6 Scheduling tab and training workflow) — browser
// acceptance on DEV with real logins. Usage: node tests/ripple/ui/round4.cjs
// Disposable fixtures (three offices, six users, three caregivers), random passwords in memory only,
// fixture writes through the real RPCs (as the fixture users), verified teardown.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round4");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui4-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], templates: [], shifts: [], credTypes: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const { dbDay, dbNow, closeDb } = require("../dev/lib.cjs");
const CLINICAL = /CLINICAL-GOAL|CLINICAL-OBJ|CLINICAL-INSTR|CLINICAL-HOPES/;

async function ins(t, key, row) { const { data, error } = await admin.from(t).insert(row).select("id").single(); if (error) throw new Error(`${t}: ${error.message}`); ids[key].push(data.id); return data.id; }
async function mkUser(tag, role, office, restricted, full) {
  const email = `sec-${tag}${SUFFIX}`, password = pw();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: full, agency_id: A } });
  if (error) throw new Error(`user ${tag}: ${error.message}`); ids.users.push(data.user.id);
  await admin.from("profiles").upsert({ id: data.user.id, email, full_name: full, agency_id: A, virtual_office_id: office, office_restricted: restricted });
  const { error: re } = await admin.from("user_roles").insert({ user_id: data.user.id, role, agency_id: A }); if (re) throw new Error(`role ${tag}: ${re.message}`);
  const c = createClient(URL_, ANON, opts); const { error: se } = await c.auth.signInWithPassword({ email, password }); if (se) throw new Error(`signIn ${tag}: ${se.message}`);
  return { id: data.user.id, email, password, c, full };
}
const must = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data; };

async function setup() {
  const F = {};
  F.RX = await ins("virtual_office", "virtual_office", { agency_id: A, name: `ZZ Ripple-X ${RUN}`, is_demo: true });
  F.RY = await ins("virtual_office", "virtual_office", { agency_id: A, name: `ZZ Ripple-Y ${RUN}`, is_demo: true });
  F.KY = await ins("virtual_office", "virtual_office", { agency_id: A, name: `ZZ KindCare-K ${RUN}`, is_demo: true });
  F.mgrRX = await mkUser("mgrrx", "manager", F.RX, true, "ZZ Manager RX");
  F.mgrRY = await mkUser("mgrry", "manager", F.RY, true, "ZZ Manager RY");
  F.schRX = await mkUser("schrx", "scheduler", F.RX, true, "ZZ Scheduler RX");
  F.hrRX = await mkUser("hrrx", "hr_staff", F.RX, true, "ZZ HR RX");
  F.mgrKY = await mkUser("mgrky", "manager", F.KY, true, "ZZ Manager KY");
  F.aa = await mkUser("aa", "agency_admin", null, false, "ZZ Agency Admin");
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  for (const o of [F.RX, F.RY]) await must(F.aa.c, "seed_office_care_plan_defaults", { _office_id: o });
  ids.credTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  // an IPOS office shell (for the Required switch check)
  const v = await must(F.mgrRX.c, "save_template_draft", { _template_id: null, _office_id: F.RX, _kind: "ipos", _name: `ZZ IPOS ${RUN}`, _intake_doc_type: null, _is_required_for_client: null,
    _sections: [], _note_layout: null, _service_type: null, _fields: [
      { field_key: "effective_date", label: "Plan effective", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "effective_date" },
      { field_key: "expiration_date", label: "Plan expires", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "expiration_date" },
      { field_key: "hopes", label: "Hopes and dreams", field_type: "longtext", storage: "field_value" }] });
  F.shell = (await admin.from("form_template_versions").select("template_id").eq("id", v).single()).data.template_id; ids.templates.push(F.shell);
  await must(F.mgrRX.c, "publish_template_version", { _template_id: F.shell });
  F.CX = await ins("clients", "clients", { agency_id: A, virtual_office_id: F.RX, first_name: "ZZ", last_name: `Training Client ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.plan = await must(F.mgrRX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(330) }, _field_values: { hopes: "CLINICAL-HOPES" } });
  await must(F.mgrRX.c, "upsert_care_plan_goals", { _care_plan_id: F.plan, _goals: [{ seq: 1, goal_text: "CLINICAL-GOAL", objectives: [{ seq: 1, letter: "A", objective_text: "CLINICAL-OBJ", staff_instructions: "CLINICAL-INSTR", service_type: "cls", responsible_party: "this_agency" }] }] });
  // caregivers: Gail and Hank with current credentials (Hank's first one due in 20 days, so he shows on the panel), Ivy with none
  const cgv = (first) => ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, first_name: first, last_name: `Caregiver ${RUN}`, email: `sec-${first.toLowerCase()}${SUFFIX}`, phone: "555-0100", is_demo: true });
  F.G1 = await cgv("Gail"); F.G2 = await cgv("Hank"); F.G3 = await cgv("Ivy");
  await admin.from("caregiver_skills").insert([F.G1, F.G2, F.G3].map((g) => ({ caregiver_id: g, care_type_code: "CLS0001", is_demo: true })));
  F.req = (await admin.from("credential_types").select("id, name").eq("agency_id", A).eq("required", true).eq("is_active", true).order("name")).data;
  for (const g of [F.G1, F.G2]) for (const [i, t] of F.req.entries())
    await must(F.hrRX.c, "enter_caregiver_credential", { _caregiver_id: g, _credential_type_id: t.id, _effective_date: await dbDay(-300), _expiry_date: await dbDay(g === F.G2 && i === 0 ? 20 : 300), _certification_number: null });
  // shifts: Hank assigned on day +5, one unassigned on day +7
  const sh = async (off) => ins("shifts", "shifts", { agency_id: A, virtual_office_id: F.RX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(off), start_time: "13:00", end_time: "14:00", duration_hours: 1, status: "open", is_demo: true });
  F.s1 = await sh(5); F.s2 = await sh(7);
  await must(F.mgrRX.c, "assign_caregiver_to_shift", { _shift_id: F.s1, _caregiver_id: F.G2, _method: "manual", _notes: "round4 fixture", _override_reason: "round4 fixture (disposable)" });
  // authorizations: one used by the projection (shift +5/+7 fall inside), one later-starting unused one to void, and one expiring in 30 days (risk panel)
  F.authUsed = await must(F.mgrRX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-USED-${RUN}`, _units_authorized: 40, _effective_date: await dbDay(-30), _expiration_date: await dbDay(30) });
  F.authVoid = await must(F.mgrRX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-VOID-${RUN}`, _units_authorized: 40, _effective_date: await dbDay(100), _expiration_date: await dbDay(200) });
  return F;
}

async function teardown(F) {
  for (const id of ids.shifts) { await admin.from("shift_assignments").delete().eq("shift_id", id); await admin.from("events").delete().eq("subject_id", id); await admin.from("shifts").delete().eq("id", id); }
  for (const id of ids.clients) {
    await admin.from("progress_notes").delete().eq("client_id", id);
    for (const { id: a } of (await admin.from("service_authorizations").select("id").eq("client_id", id)).data || []) await admin.from("events").delete().eq("subject_id", a);
    for (const t of ["plan_training_records", "plan_training_forms", "plan_inservice_forms", "client_documents", "service_authorizations", "care_plans"]) await admin.from(t).delete().eq("client_id", id);
  }
  for (const id of ids.caregivers) { await admin.from("caregiver_certifications").delete().eq("caregiver_id", id); await admin.from("caregiver_skills").delete().eq("caregiver_id", id); }
  for (const t of ["clients", "caregivers"]) for (const id of ids[t]) await admin.from(t).delete().eq("id", id);
  for (const id of ids.templates) { await admin.from("events").delete().eq("subject_id", id); await admin.from("form_templates").delete().eq("id", id); }
  for (const id of ids.users) { await admin.from("user_roles").delete().eq("user_id", id); await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
  for (const id of ids.virtual_office) { await admin.from("events").delete().eq("virtual_office_id", id); await admin.from("office_service_types").delete().eq("virtual_office_id", id); await admin.from("virtual_office").delete().eq("id", id); }
  for (const id of ids.credTypes) await admin.from("credential_types").delete().eq("id", id);
  const left = [];
  for (const [t, key] of [["clients", "clients"], ["caregivers", "caregivers"], ["virtual_office", "virtual_office"], ["form_templates", "templates"], ["shifts", "shifts"], ["credential_types", "credTypes"]])
    for (const id of ids[key]) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} offices, ${ids.caregivers.length} caregivers, ${ids.clients.length} client, ${ids.shifts.length} shifts → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
}

async function login(page, base, u) {
  await page.goto(`${base}/auth`); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const wideEls = (page) => page.evaluate(() => { const w = document.documentElement.clientWidth;
  return ["sw=" + document.documentElement.scrollWidth, ...[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== "fixed")
    .slice(0, 6).map((e) => e.tagName.toLowerCase() + "." + String(e.className).split(" ").slice(0, 3).join(".") + " right=" + Math.round(e.getBoundingClientRect().right))]; });
const fits = async (page, id, label) => { const ok = await noHScroll(page); rec(id, ok, ok ? `${label}: no horizontal page scroll` : (await wideEls(page)).join(" | ")); };
const pick = async (page, trigger, option) => { await page.locator(trigger).click(); await page.getByRole("option", { name: option, exact: true }).click(); };
const ctxFor = (browser, w) => browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
const closeDialogs = async (page) => { for (let i = 0; i < 3 && await page.locator('[role="dialog"]').count(); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); } };
const shown = (page) => page.locator('[data-testid="can-deliver"] tr[data-caregiver]').evaluateAll((els) => els.map((e) => e.getAttribute("data-caregiver").split(" ")[0]));
const setFilter = async (page, f) => { await page.locator(`[data-filter="${f}"]`).click(); await page.waitForTimeout(500); };
const openScheduling = async (page, base, F) => { await page.goto(`${base}/care-plans/${F.CX}?tab=scheduling`); await page.locator('[data-testid="scheduling-tab"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500); };

// =============================================================================================
async function polish(base, F, browser) {
  // 1 + 2: stacked authorization cards and the sticky top bar at 390
  { const c = await ctxFor(browser, 390); const p = await c.newPage();
    await login(p, base, F.mgrRX); await p.goto(`${base}/care-plans/${F.CX}?tab=ipos`);
    await p.locator('[data-testid="authorization-cards"] [data-auth-card]').first().waitFor({ timeout: 30000 }); await p.waitForTimeout(800);
    const cards = await p.locator("[data-auth-card]").count(), tableVisible = await p.locator('[data-testid="authorizations"] table').isVisible();
    await p.locator(`[data-auth-card="ZZ-USED-${RUN}"]`).scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
    const bar = await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Open menu"); const h = b?.closest("header");
      return b && h ? { pos: getComputedStyle(b).position, hpos: getComputedStyle(h).position, top: Math.round(h.getBoundingClientRect().top), bottom: Math.round(h.getBoundingClientRect().bottom) } : null; });
    const cardText = await p.locator(`[data-auth-card="ZZ-USED-${RUN}"]`).innerText();
    await shot(p, "polish-1-2-auth-cards-and-topbar-390");
    rec("P1 below sm the authorizations render as stacked cards (service · # · pill, the four numbers, UnitsBar, actions); the table is hidden",
      cards === 2 && !tableVisible && /Authorized/.test(cardText) && /Pending/.test(cardText) && /units left/.test(cardText) && /Correct/.test(cardText), `cards ${cards}; table visible ${tableVisible}`);
    rec("P2 the menu button sits in a sticky top bar (not floating): after scrolling the bar stays at the top and the content scrolls under it",
      !!bar && bar.pos !== "fixed" && bar.hpos === "sticky" && bar.top === 0 && bar.bottom <= 64, JSON.stringify(bar));
    await fits(p, "P1-390 IPOS tab with stacked cards fits at 390px", "IPOS");
    await c.close(); }
  // 3: risk panel full name + Schedule link (filtered Schedule)
  { const c = await ctxFor(browser, 1440); const p = await c.newPage();
    await login(p, base, F.mgrRX); await p.goto(`${base}/care-plans`);
    const li = p.locator(`[data-testid="risk-panel"] li[data-auth="ZZ-USED-${RUN}"]`); await li.waitFor({ timeout: 30000 }); await p.waitForTimeout(600);
    const txt = await li.innerText(), href = await li.locator('[data-testid="risk-schedule-link"]').getAttribute("href");
    await shot(p, "polish-3-risk-panel-1440");
    await li.locator('[data-testid="risk-schedule-link"]').click(); await p.locator('[data-testid="client-filter"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(1500);
    const chip = await p.locator('[data-testid="client-filter"]').innerText();
    await shot(p, "polish-3-schedule-filtered-1440");
    rec("P3 risk panel shows the client's full name and a 'Schedule ->' link; it opens the Schedule screen filtered to that client",
      txt.includes(`ZZ Training Client ${RUN}`) && href === `/schedule?client=${F.CX}` && chip.includes(`Training Client ${RUN}`), `"${txt.replace(/\s+/g, " ").slice(0, 90)}"; href ${href}; chip "${chip.replace(/\s+/g, " ")}"`);
    // 4: Required is a switch
    await p.goto(`${base}/form-templates`); await p.locator(`[data-shell="ZZ IPOS ${RUN}"]`).click();
    await p.getByRole("button", { name: /Edit \(new draft\)/ }).click(); await p.locator("[data-locked]").first().waitFor({ timeout: 15000 }); await p.waitForTimeout(500);
    const sw = await p.locator('[role="switch"][aria-label^="Required:"]').count(), cb = await p.locator('[role="checkbox"]').count();
    await p.locator('[role="switch"][aria-label^="Required:"]').first().scrollIntoViewIfNeeded(); await shot(p, "polish-4-required-switch-1440");
    rec("P4 the template editor's 'Required' is a switch (no radio-looking checkbox left)", sw >= 1 && cb === 0, `switches ${sw}; checkboxes ${cb}`);
    await closeDialogs(p);
    // W2 void in the UI
    await p.goto(`${base}/care-plans/${F.CX}?tab=ipos`); await p.locator(`[data-testid="authorizations"] tr[data-auth="ZZ-VOID-${RUN}"]`).waitFor({ timeout: 30000 });
    const usedVoid = await p.getByRole("button", { name: `Void ZZ-USED-${RUN}` }).count();
    await p.getByRole("button", { name: `Void ZZ-VOID-${RUN}` }).click(); await p.locator('[data-testid="void-dialog"]').waitFor();
    await p.getByRole("button", { name: "Void", exact: true }).click(); await p.waitForTimeout(500);
    const noReason = await p.locator('[data-testid="void-error"]').innerText().catch(() => "");
    await p.locator("#void-reason").fill("Entered twice by mistake"); await shot(p, "void-dialog-1440");
    await p.getByRole("button", { name: "Void", exact: true }).click(); await p.waitForTimeout(2000);
    const gone = await p.locator(`tr[data-auth="ZZ-VOID-${RUN}"]`).count();
    const row = (await admin.from("service_authorizations").select("voided_at, void_reason").eq("id", F.authVoid).single()).data;
    rec("W2-ui Void shows only where allowed (not on the authorization the schedule uses); reason required; voided rows leave the table and stay on record",
      usedVoid === 0 && /reason/i.test(noReason) && gone === 0 && !!row.voided_at && row.void_reason === "Entered twice by mistake", `void on used ${usedVoid}; no-reason "${noReason}"; row gone ${gone === 0}`);
    await c.close(); }
}

// =============================================================================================
async function s6(base, F, browser) {
  const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage();
  await login(page, base, F.mgrRX); await openScheduling(page, base, F);
  const shiftsTxt = await page.locator('[data-testid="client-shifts"]').innerText();
  const unitsTxt = await page.locator('[data-testid="units-by-service"]').innerText();
  const t0 = await shown(page);
  await shot(page, "s6-scheduling-tab-1440");
  rec("S6-tab Scheduling tab: this client's shifts (assigned + unassigned), units per service with the UnitsBar, 'Open full Schedule' link; default filter shows nobody before any training",
    /Hank/.test(shiftsTxt) && /Unassigned/.test(shiftsTxt) && /CLS/.test(unitsTxt) && /units left/.test(unitsTxt) && t0.length === 0
      && (await page.locator('[data-testid="open-schedule"]').getAttribute("href")) === `/schedule?client=${F.CX}`, `trained filter ${t0.join(",") || "empty"}`);
  // training form refused before the in-service
  await page.getByRole("button", { name: "Record training form" }).click(); await page.locator('[data-testid="training-refused"]').waitFor({ timeout: 10000 }); await page.waitForTimeout(400);
  const refusedTxt = await page.locator('[data-testid="training-refused"]').innerText();
  const submit = await page.locator('[data-testid="training-dialog"]').getByRole("button", { name: "Record training" }).count();
  await shot(page, "s6-training-refused-1440");
  await page.getByRole("button", { name: "Go to the in-service step" }).click(); await page.locator('[data-testid="inservice-dialog"]').waitFor({ timeout: 10000 });
  const { error: rpcEarly } = await F.mgrRX.c.rpc("record_training_form", { _care_plan_id: F.plan, _plan_document_type: "ipos_initial", _plan_effective_date: null, _location: null, _records: [{ caregiver_id: F.G1, training_date: await dbDay(0) }] });
  rec("S6-refused before the in-service the training form explains it (no submit) and links to the in-service step; the RPC refuses too",
    /in-service form for training version 1 isn't recorded yet/.test(refusedTxt) && submit === 0 && /in-service form for this plan version first/.test(rpcEarly ? rpcEarly.message : ""), `"${refusedTxt.replace(/\s+/g, " ").slice(0, 80)}"; RPC "${rpcEarly ? rpcEarly.message.slice(0, 50) : "ACCEPTED"}"`);
  // in-service (UI)
  await page.locator("#in-cm").fill("Casey Manager"); await pick(page, "#in-lead", "ZZ Manager RX");
  await shot(page, "s6-inservice-dialog-1440");
  await page.getByRole("button", { name: "Record in-service" }).last().click(); await page.waitForTimeout(2000);
  // training form (UI): Gail + Hank
  await page.getByRole("button", { name: "Record training form" }).click(); await page.locator("#tr-type").waitFor({ timeout: 10000 });
  for (const [i, name] of [[0, "Gail"], [1, "Hank"]]) {
    await page.getByRole("button", { name: "Add caregiver" }).click();
    await page.locator(`#tr-${i}-cg`).click(); await page.getByRole("option", { name: new RegExp(`^${name} `) }).click();
    await pick(page, `#tr-${i}-method`, i === 0 ? "Received during the PCP meeting" : "Received outside the PCP meeting");
    await page.locator(`#tr-${i}-clin`).fill("Dr. Primary"); await page.locator(`#tr-${i}-trainer`).fill("ZZ Manager RX");
  }
  await page.locator("#tr-loc").fill("Ripple office");
  await shot(page, "s6-training-form-1440");
  await page.getByRole("button", { name: "Record training", exact: true }).click(); await page.waitForTimeout(2500);
  const t1 = await shown(page);
  await setFilter(page, "all"); const all1 = await shown(page);
  const eligTxt = await page.locator('[data-testid="can-deliver"] tr[data-caregiver^="Gail"] [data-eligibility]').innerText();
  await shot(page, "s6-filter-all-1440");
  await setFilter(page, "trained"); await shot(page, "s6-filter-trained-1440");
  rec("S6-trained after in-service + training: 'Trained / effective' shows Gail and Hank (Ivy: no credentials, not trained); 'All in office' shows all three with the engine's eligibility for the next unassigned shift",
    t1.join(",") === "Gail,Hank" && all1.join(",") === "Gail,Hank,Ivy" && /Eligible|Needs approval|Blocked/.test(eligTxt), `trained ${t1.join(",")}; all ${all1.join(",")}; Gail elig "${eligTxt.replace(/\s+/g, " ").slice(0, 80)}"`);
  // renewal -> everyone needs retraining
  F.plan2 = await must(F.mgrRX.c, "renew_care_plan", { _care_plan_id: F.plan });
  await openScheduling(page, base, F);
  const t2 = await shown(page); await setFilter(page, "retrain"); const r2 = await shown(page);
  await shot(page, "s6-filter-retrain-1440");
  const retrainTxt = await page.locator('[data-testid="retraining-list"]').innerText();
  await page.locator('[data-testid="retraining-list"]').scrollIntoViewIfNeeded(); await shot(page, "s6-retraining-list-1440");
  rec("S6-renewal after a renewal nobody is 'Trained / effective'; Gail and Hank move to 'Needs retraining'; the retraining list shows Hank (assigned shift) at version 2",
    t2.length === 0 && r2.join(",") === "Gail,Hank" && /Hank/.test(retrainTxt) && /version 2/.test(retrainTxt), `trained ${t2.join(",") || "empty"}; retrain ${r2.join(",")}; list "${retrainTxt.replace(/\s+/g, " ").slice(0, 100)}"`);
  // retrained at v2 (RPC) -> back
  await must(F.mgrRX.c, "record_inservice_form", { _care_plan_id: F.plan2, _case_manager_name: "Casey Manager", _program_lead_id: F.mgrRX.id, _trained_on: await dbDay(0), _signed_at: await dbNow() });
  await must(F.mgrRX.c, "record_training_form", { _care_plan_id: F.plan2, _plan_document_type: "ipos_annual", _plan_effective_date: null, _location: null,
    _records: [{ caregiver_id: F.G1, training_date: await dbDay(0) }, { caregiver_id: F.G2, training_date: await dbDay(0) }] });
  await openScheduling(page, base, F); const t3 = await shown(page);
  rec("S6-back after in-service + training at version 2 they return to 'Trained / effective'", t3.join(",") === "Gail,Hank", `trained ${t3.join(",")}`);
  // print previews
  const tctx = await must(F.mgrRX.c, "get_client_training_context", { _client_id: F.CX });
  const inId = tctx.inservice_forms.find((f) => f.training_version === 1).id, trId = tctx.training_forms.find((f) => f.training_version === 1).id;
  await page.goto(`${base}/training/${F.CX}/print/inservice/${inId}`); await page.locator('[data-print="inservice"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
  const inSections = await page.locator("[data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
  const inSig = await page.getByText(/signature/i).count(), chrome1 = await page.locator("aside, header.sticky").count();
  await shot(page, "s6-print-inservice-1440", true);
  await page.emulateMedia({ media: "print" }); const toolbarPrint = await page.locator('[data-testid="print-toolbar"]').isVisible(); await page.emulateMedia({ media: "screen" });
  await page.goto(`${base}/training/${F.CX}/print/training/${trId}`); await page.locator('[data-print="training"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
  const trSections = await page.locator("[data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
  const trText = await page.locator('[data-print="training"]').innerText(), chrome2 = await page.locator("aside, header.sticky").count();
  await shot(page, "s6-print-training-1440", true);
  rec("S6-print both forms print without app chrome (no sidebar / top bar; the toolbar hides in print). Training (33.01_01F): header (individual, case #, effective date, 5 plan types, agency, location), staff rows (date, name, signature line, clinician, method), training-information block with trainer + staff signature lines. In-service: header + case manager and program lead signature lines",
    JSON.stringify(trSections) === '["header","staff","training-information"]' && JSON.stringify(inSections) === '["header","signatures"]' && chrome1 === 0 && chrome2 === 0 && !toolbarPrint
      && /Initial/.test(trText) && /Behavior Support Plan/.test(trText) && /Protocol/.test(trText) && /Received during the PCP meeting/.test(trText) && /Trainer signature/i.test(trText) && /Staff signature/i.test(trText) && inSig >= 2,
    `training ${trSections.join(",")}; in-service ${inSections.join(",")}; chrome ${chrome1}/${chrome2}; toolbar in print ${toolbarPrint}`);
  await ctx.close();

  // 390
  { const c = await ctxFor(browser, 390); const p = await c.newPage();
    await login(p, base, F.mgrRX); await openScheduling(p, base, F);
    await shot(p, "s6-scheduling-tab-390"); await fits(p, "S6-390a Scheduling tab fits at 390px", "scheduling");
    await setFilter(p, "retrain"); await p.locator('[data-testid="can-deliver"]').scrollIntoViewIfNeeded(); await shot(p, "s6-filter-retrain-390");
    await p.locator('[data-testid="retraining-list"]').scrollIntoViewIfNeeded(); await shot(p, "s6-retraining-list-390");
    await p.getByRole("button", { name: "Record in-service" }).click(); await p.locator('[data-testid="inservice-dialog"]').waitFor(); await p.waitForTimeout(400); await shot(p, "s6-inservice-dialog-390"); await closeDialogs(p);
    await p.getByRole("button", { name: "Record training form" }).click(); await p.locator("#tr-type").waitFor(); await p.getByRole("button", { name: "Add caregiver" }).click(); await p.waitForTimeout(400);
    await shot(p, "s6-training-form-390"); await closeDialogs(p);
    await p.goto(`${base}/training/${F.CX}/print/training/${trId}`); await p.locator('[data-print="training"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(400);
    await shot(p, "s6-print-training-390", true);
    await p.goto(`${base}/training/${F.CX}/print/inservice/${inId}`); await p.locator('[data-print="inservice"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(400);
    await shot(p, "s6-print-inservice-390", true);
    await c.close(); }
  // refusal screen at 390 (a fresh renewal so the in-service is missing again)
  F.plan3 = await must(F.mgrRX.c, "renew_care_plan", { _care_plan_id: F.plan2 });
  { const c = await ctxFor(browser, 390); const p = await c.newPage();
    await login(p, base, F.mgrRX); await openScheduling(p, base, F);
    await p.getByRole("button", { name: "Record training form" }).click(); await p.locator('[data-testid="training-refused"]').waitFor(); await p.waitForTimeout(400);
    await shot(p, "s6-training-refused-390"); await c.close(); }
  // put the in-service back so hr_staff can record a training form at v3
  await must(F.mgrRX.c, "record_inservice_form", { _care_plan_id: F.plan3, _case_manager_name: "Casey Manager", _program_lead_id: F.aa.id, _trained_on: await dbDay(0), _signed_at: await dbNow() });

  // ---------- hr_staff: from the Caregiver tab and the training page, no clinical content ----------
  { const c = await ctxFor(browser, 1440); const p = await c.newPage();
    await login(p, base, F.hrRX); await p.goto(`${base}/caregivers`);
    await p.locator('[data-testid="expirations-panel"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(1500);
    const btn = p.locator('[data-testid="expirations-panel"] button', { hasText: "Hank" }).first(); await btn.waitFor({ timeout: 30000 }); await btn.evaluate((el) => el.click());
    await p.locator('[data-testid="credentials-tab"]').waitFor({ timeout: 20000 }); await p.waitForTimeout(800);
    const link = p.locator('[data-testid="record-training-link"]').first(); const linkHref = await link.getAttribute("href");
    await link.scrollIntoViewIfNeeded(); await shot(p, "s6-hr-caregiver-tab-link-1440");
    await link.evaluate((el) => el.click()); await p.locator('[data-testid="training-panel"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(800);
    await p.getByRole("button", { name: "Record training form" }).click(); await p.locator("#tr-type").waitFor({ timeout: 10000 });
    await p.getByRole("button", { name: "Add caregiver" }).click(); await p.locator("#tr-0-cg").click(); await p.getByRole("option", { name: /^Ivy / }).click();
    await p.getByRole("button", { name: "Record training", exact: true }).click(); await p.waitForTimeout(2500);
    const body = await p.locator("body").innerText();
    await shot(p, "s6-hr-training-page-1440");
    const ivy = (await admin.from("plan_training_records").select("id, entered_by").eq("caregiver_id", F.G3).eq("care_plan_id", F.plan3)).data;
    await p.goto(`${base}/training`); await p.locator('[data-testid="training-list"] [data-training-client]').first().waitFor({ timeout: 30000 }); const listBody = await p.locator("body").innerText();
    await shot(p, "s6-hr-training-list-1440");
    await p.goto(`${base}/care-plans/${F.CX}`); await p.waitForTimeout(4000); const cpPath = new URL(p.url()).pathname;
    rec("S6-hr hr_staff opens the training form from the Caregiver tab ('Record training ->') and the training page, records a training form, and sees no clinical text anywhere; the client care-plan page stays closed",
      linkHref === `/training/${F.CX}` && ivy.length === 1 && ivy[0].entered_by === F.hrRX.id && !CLINICAL.test(body) && !CLINICAL.test(listBody) && cpPath !== `/care-plans/${F.CX}`,
      `link ${linkHref}; recorded ${ivy.length}; clinical ${CLINICAL.test(body + listBody) ? "LEAKED" : "none"}; /care-plans -> ${cpPath}`);
    await c.close(); }
  // ---------- refusals ----------
  for (const [u, label, url, expect] of [[F.mgrRY, "office-Y manager", `/training/${F.CX}`, "denied"], [F.schRX, "scheduler", `/training/${F.CX}`, "redirect"],
    [F.schRX, "scheduler (client Scheduling tab)", `/care-plans/${F.CX}?tab=scheduling`, "redirect"], [F.mgrKY, "Kind-Care-only manager", `/training/${F.CX}`, "redirect"]]) {
    const c = await ctxFor(browser, 1440); const p = await c.newPage();
    await login(p, base, u); await p.goto(`${base}${url}`); await p.waitForTimeout(5000);
    const pth = new URL(p.url()).pathname, denied = await p.locator('[data-testid="training-denied"], [data-testid="client-denied"]').count(), body = await p.locator("body").innerText();
    const ok = (expect === "denied" ? denied === 1 : pth !== url.split("?")[0]) && !CLINICAL.test(body) && !body.includes(`Training Client ${RUN}`);
    rec(`S6-deny-${label.replace(/[^a-z]+/gi, "-").toLowerCase()} ${label} is refused`, ok, `${pth}; denied card ${denied}; client data ${body.includes(`Training Client ${RUN}`) ? "SHOWN" : "none"}`);
    await c.close();
  }
}

async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: Ripple-X + Ripple-Y (module on), KindCare-K (off); manager RX/RY/KY, scheduler RX, hr RX, agency admin; client with plan + goals; Gail/Hank (credentials current), Ivy (none); Hank assigned day +5, open shift day +7`);
    const browser = await chromium.launch();
    try { await polish(base, F, browser); await s6(base, F, browser); } finally { await browser.close(); }
  } finally { await teardown(F); await closeDb(); }
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

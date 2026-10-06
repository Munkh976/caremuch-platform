// Ripple UI round 8 (S10: eligibility display + the compliance enforcement switch) — browser acceptance on DEV with real logins.
// Usage: node tests/ripple/ui/round8.cjs > some.log 2>&1   (never pipe a DEV suite; see README)
// Disposable fixtures with readable on-screen names ("Ana Rivera", "Zoe N."); the run tag stays in client last
// names, emails and the office names, where cleanup-orphans finds it.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round8");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui8-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], shifts: [], credTypes: [], groups: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const { closeDb, pgRead } = require("../dev/lib.cjs");

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
  F.mgr = await mkUser("mgr", ["manager"], F.RX, true, "Bren Miller");
  F.mgrK = await mkUser("mgrk", ["manager"], F.KC, true, "Kim Young");
  F.cgA = await mkUser("cga", ["caregiver"], F.RX, false, "Ana Rivera");
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aa.c, "seed_office_care_plan_defaults", { _office_id: F.RX });     // Portage uses the module; Kind Care does not
  ids.credTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  // next week (Sunday-start, as the Schedule page shows it), from the DB clock
  F.nextSun = await pgRead(async (c) => (await c.query(`SELECT (d + (7 - extract(dow FROM d)::int))::text s FROM (SELECT (now() AT TIME ZONE 'America/New_York')::date d) x`)).rows[0].s);
  F.at = async (k) => pgRead(async (c) => (await c.query(`SELECT ($1::date + $2::int)::text d`, [F.nextSun, k])).rows[0].d);
  F.G1 = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, user_id: F.cgA.id, first_name: "Ana", last_name: "Rivera", email: `sec-ana${SUFFIX}`, phone: "555-0100", is_demo: true });
  F.GK = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.KC, first_name: "Kara", last_name: "Diaz", email: `sec-kara${SUFFIX}`, phone: "555-0102", is_demo: true });
  await admin.from("caregiver_skills").insert([{ caregiver_id: F.G1, care_type_code: "CLS0001", is_demo: true }, { caregiver_id: F.GK, care_type_code: "CLS0001", is_demo: true }]);
  const cl = (office, first, last) => ins("clients", "clients", { agency_id: A, virtual_office_id: office, first_name: first, last_name: `${last} ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.CX = await cl(F.RX, "Zoe", "Nolan"); F.CK = await cl(F.KC, "Omar", "Kent");
  F.CG = [await cl(F.RX, "Max", "Ortiz"), await cl(F.RX, "Lea", "Park"), await cl(F.RX, "Ivy", "Shaw"), await cl(F.RX, "Ray", "Cole")];
  const today = await pgRead(async (c) => (await c.query(`SELECT (now() AT TIME ZONE 'America/New_York')::date::text d`)).rows[0].d);
  await must(F.mgr.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: today, expiration_date: await F.at(300) } });
  // 2 units authorized; a one-hour visit needs 4 -> units short
  await must(F.mgr.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: "ISK-2026-0801", _units_authorized: 2, _effective_date: today, _expiration_date: await F.at(90), _service_code: "H2015" });
  const sh = async (office, client, k, start, end) => ins("shifts", "shifts", { agency_id: A, virtual_office_id: office, client_id: client, order_title: `Visit ${RUN}`, care_type_code: "CLS0001",
    shift_date: await F.at(k), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
  F.SZ = await sh(F.RX, F.CX, 2, "13:00", "14:00"); F.SK = await sh(F.KC, F.CK, 2, "13:00", "14:00");
  // a group session (1:3 by the office default): Ana already has Max, Lea and Ivy; Ray's shift would be her 4th client
  F.GS = await must(F.mgr.c, "create_group_session", { _office_id: F.RX, _session_date: await F.at(1), _start_time: "09:00", _end_time: "10:00", _staff_client_ratio: "1:3", _max_clients: null });
  ids.groups.push(F.GS);
  F.SG = [];
  for (const c of F.CG) { const s = await sh(F.RX, c, 1, "09:00", "10:00"); await must(F.mgr.c, "set_shift_group_session", { _shift_id: s, _group_session_id: F.GS }); F.SG.push(s); }
  for (const s of F.SG.slice(0, 3)) await must(F.mgr.c, "assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: F.G1, _method: "manual", _notes: "round8 fixture", _override_reason: "round8 fixture (disposable)" });
  return F;
}

async function teardown() {
  for (const id of ids.shifts) { await admin.from("shift_assignments").delete().eq("shift_id", id); await admin.from("events").delete().eq("subject_id", id); }
  for (const id of ids.shifts) await admin.from("shifts").delete().eq("id", id);
  for (const id of ids.groups) { await admin.from("events").delete().eq("subject_id", id); await admin.from("group_sessions").delete().eq("id", id); }
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
  for (const [t, key] of [["clients", "clients"], ["caregivers", "caregivers"], ["virtual_office", "virtual_office"], ["shifts", "shifts"], ["credential_types", "credTypes"], ["group_sessions", "groups"]])
    for (const id of ids[key]) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  for (const id of ids.virtual_office) { const { data } = await admin.from("events").select("id").eq("virtual_office_id", id); if (data && data.length) left.push(`events for ${id}`); }
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} offices, ${ids.caregivers.length} caregivers, ${ids.clients.length} clients, ${ids.shifts.length} shifts, ${ids.groups.length} group session → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
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
const flag = async (o) => (await admin.from("virtual_office").select("compliance_enforcement_enabled").eq("id", o).single()).data.compliance_enforcement_enabled;

// Schedule → Unassigned → next week; the row of a client
async function openUnassigned(page, base) {
  await page.goto(`${base}/schedule?tab=unassigned`); await page.getByRole("button", { name: "Next" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(2500);
}
const rowOf = (page, first) => page.locator("tr", { hasText: new RegExp(`${first} [A-Z][a-z]+ ${RUN}`) }).first();
const waitRow = async (page, first) => { const r = rowOf(page, first);
  try { await r.waitFor({ timeout: 20000 }); } catch {
    await page.screenshot({ path: path.join(require("os").tmpdir(), `round8-debug-${first}.png`), fullPage: true });
    await page.reload(); await page.getByRole("button", { name: "Next" }).click(); await r.waitFor({ timeout: 30000 }); }
  return r; };
async function openAssign(page, first, caregiver, { dispatch = false } = {}) {
  // dispatch: at 390 the existing Schedule table clips its Actions column (pre-existing layout, not changed in S10)
  const btn = (await waitRow(page, first)).getByRole("button", { name: /^Assign$/ });
  if (dispatch) await btn.dispatchEvent("click"); else await btn.click();
  const dlg = page.locator('[role="dialog"]').last(); await dlg.waitFor(); await page.waitForTimeout(2500);
  await dlg.getByPlaceholder("Search caregivers...").fill(caregiver.split(" ")[0]); await page.waitForTimeout(300);
  await dlg.locator('button[role="combobox"]').first().click();
  await page.getByRole("option", { name: new RegExp(caregiver) }).first().click(); await page.waitForTimeout(800);
  return dlg;
}
// Escape until no dialog / listbox is open (Radix keeps pointer events off the page while one is)
const closeAll = async (page) => { for (let i = 0; i < 4 && (await page.locator('[role="dialog"], [role="listbox"]').count()) > 0; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); } };
const confirmBtn = (dlg) => dlg.getByRole("button", { name: /Confirm Assignment/ });
async function smartNames(page, first) {
  await (await waitRow(page, first)).getByRole("button", { name: /Smart assign/ }).click();
  const sheet = page.locator('[role="dialog"]').last(); await sheet.waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("Ranking caregivers..."), null, { timeout: 60000 }); await page.waitForTimeout(500);
  return { sheet, text: await sheet.innerText() };
}

// =============================================================================================
async function offPhase(base, F, browser) {
  const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage(); await login(page, base, F.mgr);
  await openUnassigned(page, base);
  let dlg = await openAssign(page, "Zoe", "Ana Rivera");
  const panel = dlg.locator('[data-testid="elig-compliance"]');
  await panel.waitFor({ timeout: 15000 });
  const lines = await panel.locator('[data-testid^="elig-line-"]').evaluateAll((els) => els.map((e) => [e.getAttribute("data-testid").replace("elig-line-", ""), e.getAttribute("data-blocked")]));
  const hrefs = await panel.locator('a[data-testid^="elig-fix-"]').evaluateAll((els) => els.map((e) => [e.getAttribute("data-testid").replace("elig-fix-", ""), e.getAttribute("href"), e.getAttribute("target")]));
  const ptext = await panel.innerText();
  const confirmDisabled = await confirmBtn(dlg).isDisabled();
  await panel.scrollIntoViewIfNeeded(); await shot(page, "assign-advisory-1440");
  const want = { credential_missing: `/caregivers?caregiver=${F.G1}&tab=credentials`, training_missing: `/training/${F.CX}`, units_short: `/care-plans/${F.CX}?tab=ipos` };
  rec("O1 enforcement OFF: the assign dialog shows the care-plan checks as amber Advisory lines with the server text (credential, training on the current plan, units) and a Fix → link each; Confirm stays enabled",
    ["credential_missing", "training_missing", "units_short"].every((c) => lines.some(([k, b]) => k === c && b === "false")) && lines.every(([, b]) => b === "false")
      && Object.entries(want).every(([c, h]) => hrefs.some(([k, href, t]) => k === c && href === h && t === "_blank")) && /needs 4 units; 2 projected units remain/.test(ptext) && !confirmDisabled,
    `${JSON.stringify(lines)}; confirm disabled ${confirmDisabled}`);
  await closeAll(page);
  // group_full (hard on the server whatever the switch): "Group is full (1:3)"
  dlg = await openAssign(page, "Ray", "Ana Rivera");
  const gl = dlg.locator('[data-testid="elig-line-group_full"]'); await gl.waitFor({ timeout: 15000 });
  const gtext = await gl.innerText(); const gDisabled = await confirmBtn(dlg).isDisabled();
  await gl.scrollIntoViewIfNeeded(); await shot(page, "assign-group-full-1440");
  rec("O2 a 4th client in Ana's group session: 'Group is full (1:3)' with the server text, Blocked (the server blocks group_full whatever the switch), Confirm disabled",
    /Group is full \(1:3\)/.test(gtext) && /already has 3 of 3 clients/.test(gtext) && (await gl.getAttribute("data-blocked")) === "true" && gDisabled, gtext.replace(/\s+/g, " "));
  await closeAll(page);
  const sm = await smartNames(page, "Zoe"); await shot(page, "smart-off-1440");
  rec("O3 enforcement OFF: Smart assign keeps Ana (advisory checks don't filter)", /Ana Rivera/.test(sm.text), sm.text.replace(/\s+/g, " ").slice(0, 160));
  await closeAll(page);
  await ctx.close();
  // caregiver side, OFF: Zoe's shift is bookable (advisories aren't shown to caregivers)
  const c2 = await ctxFor(browser, 1440); const p2 = await c2.newPage(); await login(p2, base, F.cgA);
  await p2.goto(`${base}/available-shifts`); await p2.waitForTimeout(4000);
  const card = p2.locator("div.rounded-lg, [class*='card']", { hasText: /Zoe/ }).filter({ has: p2.getByRole("button") }).first();
  const ctext = await card.innerText().catch(() => "");
  rec("O4 enforcement OFF: on Available Shifts Zoe's shift is not 'Not bookable yet' (unchanged behaviour)", ctext !== "" && !/Not bookable yet/.test(ctext), ctext.replace(/\s+/g, " ").slice(0, 160));
  await c2.close();
}

async function switchOn(base, F, browser) {
  // manager: read-only card
  { const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, F.mgr);
    await p.goto(`${base}/virtual-offices/${F.RX}`); await p.locator('[data-testid="tab-compliance"]').click(); await p.locator('[data-testid="compliance-card"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(800);
    const dis = await p.locator('[data-testid="enforcement-switch"]').isDisabled(); const txt = await p.locator('[data-testid="compliance-card"]').innerText();
    await shot(p, "compliance-card-manager-1440");
    rec("C1 manager: the Compliance card is read-only (switch disabled, 'Only an agency admin can change these settings'); module On, enforcement Advisory",
      dis && /Only an agency admin can change/.test(txt) && /Advisory/.test(txt) && (await p.locator('[data-testid="module-status"]').innerText()) === "On", txt.replace(/\s+/g, " ").slice(0, 200));
    await c.close(); }
  const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, F.aa);
  await p.goto(`${base}/virtual-offices/${F.RX}`); await p.locator('[data-testid="tab-compliance"]').click(); await p.locator('[data-testid="compliance-card"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(800);
  await shot(p, "compliance-card-admin-1440");
  await p.locator('[data-testid="enforcement-switch"]').click(); await p.locator('[data-testid="compliance-confirm"]').waitFor(); await p.waitForTimeout(400);
  const ctext = await p.locator('[data-testid="compliance-confirm-changes"]').innerText();
  await shot(p, "switch-confirm-1440");
  rec("C2 agency admin: turning enforcement on asks to confirm and states what changes (block new assignments, Smart / Auto-fill leave out, caregivers 'Not bookable yet', already-assigned stay, audited); nothing changes before Confirm",
    /block/i.test(ctext) && /Smart assign and Auto-fill/.test(ctext) && /Not bookable yet/.test(ctext) && /already assigned stay assigned/.test(ctext) && /audited/.test(ctext) && (await flag(F.RX)) === false, ctext.replace(/\s+/g, " ").slice(0, 220));
  const t0 = new Date().toISOString();
  await p.locator('[data-testid="compliance-confirm-ok"]').click(); await p.waitForFunction(() => document.querySelector('[data-testid="enforcement-status"]')?.textContent === "Enforced", null, { timeout: 20000 });
  await p.waitForTimeout(800); await shot(p, "compliance-card-on-1440");
  const ev = (await admin.from("events").select("payload, actor_id").eq("event_type", "compliance_enforcement_changed").eq("virtual_office_id", F.RX)).data || [];
  rec("C3 Confirm: the switch is on (Enforced) through set_compliance_enforcement, audited once {enabled:true, was_enabled:false} by the admin",
    (await flag(F.RX)) === true && ev.length === 1 && JSON.stringify(ev[0].payload) === '{"enabled":true,"was_enabled":false}' && ev[0].actor_id === F.aa.id, JSON.stringify(ev));
  await c.close();
  // admin at 390
  const m = await ctxFor(browser, 390); const mp = await m.newPage(); await login(mp, base, F.aa);
  await mp.goto(`${base}/virtual-offices/${F.RX}`); await mp.locator('[data-testid="tab-compliance"]').click(); await mp.locator('[data-testid="compliance-card"]').waitFor({ timeout: 30000 }); await mp.waitForTimeout(800);
  await mp.locator('[data-testid="compliance-card"]').scrollIntoViewIfNeeded(); await shot(mp, "compliance-card-390");
  rec("C4 the Compliance card at 390: no horizontal scroll", await noHScroll(mp), ""); await m.close();
}

async function onPhase(base, F, browser) {
  const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage(); await login(page, base, F.mgr);
  const urls = []; page.on("framenavigated", (f) => { if (f === page.mainFrame()) urls.push(f.url()); });
  await openUnassigned(page, base);
  // default list (no search) omits Ana now
  await (await waitRow(page, "Zoe")).getByRole("button", { name: /^Assign$/ }).click();
  let dlg = page.locator('[role="dialog"]').last(); await dlg.waitFor(); await page.waitForTimeout(2500);
  await dlg.locator('button[role="combobox"]').first().click(); await page.waitForTimeout(400);
  const defaultList = await page.locator('[role="listbox"]').innerText().catch(() => "");
  await closeAll(page);
  dlg = await openAssign(page, "Zoe", "Ana Rivera");
  const panel = dlg.locator('[data-testid="elig-compliance"]'); await panel.waitFor({ timeout: 15000 });
  const lines = await panel.locator('[data-testid^="elig-line-"]').evaluateAll((els) => els.map((e) => [e.getAttribute("data-testid").replace("elig-line-", ""), e.getAttribute("data-blocked")]));
  const confirmDisabled = await confirmBtn(dlg).isDisabled(); const dtext = await dlg.innerText();
  await panel.scrollIntoViewIfNeeded(); await shot(page, "assign-blocked-1440");
  rec("B1 enforcement ON: Ana is no longer in the default list; found by search she shows red Blocked lines (same server text, Fix → links) and Confirm is disabled",
    !/Ana Rivera/.test(defaultList) && ["credential_missing", "training_missing", "units_short"].every((c) => lines.some(([k, b]) => k === c && b === "true")) && /Blocked/.test(dtext) && confirmDisabled,
    `${JSON.stringify(lines)}; confirm disabled ${confirmDisabled}`);
  const fixes = await panel.locator('a[data-testid^="elig-fix-"]').evaluateAll((els) => els.map((e) => [e.getAttribute("data-testid").replace("elig-fix-", ""), e.getAttribute("href")]));
  await closeAll(page);
  const sm = await smartNames(page, "Zoe"); await shot(page, "smart-on-1440");
  rec("B2 enforcement ON: Smart assign omits Ana", !/Ana Rivera/.test(sm.text), sm.text.replace(/\s+/g, " ").slice(0, 160));
  await closeAll(page);
  await page.getByRole("button", { name: /Auto-fill this period/ }).click(); const af = page.locator('[role="dialog"]').last(); await af.waitFor();
  await page.waitForTimeout(1500); await page.waitForFunction(() => !/Analy[sz]ing|%/.test(document.querySelector('[role="dialog"]:last-of-type')?.innerText || "") || true, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  const afText = await af.innerText(); await shot(page, "autofill-on-1440");
  const zoeLine = afText.split("\n").filter((l) => /Zoe/.test(l)).join(" ");
  rec("B3 enforcement ON: Auto-fill doesn't propose Ana for Zoe's visit (it takes Smart's best match); nothing committed", !/Ana Rivera/.test(afText.slice(afText.indexOf("Zoe"), afText.indexOf("Zoe") + 200)) && (await admin.from("shift_assignments").select("id").eq("shift_id", F.SZ)).data.length === 0,
    zoeLine.slice(0, 160) || afText.replace(/\s+/g, " ").slice(0, 160));
  await closeAll(page);
  // Fix → links land on the right page / tab
  const land = {};
  for (const [code, href] of fixes) {
    await page.goto(`${base}${href}`); await page.waitForTimeout(4500);
    const u = new URL(page.url());
    if (code === "credential_missing") land[code] = /\/caregivers/.test(u.pathname) && (await page.locator('[role="tab"][data-state="active"]', { hasText: /Credentials/ }).count()) > 0;
    if (code === "training_missing") land[code] = u.pathname === `/training/${F.CX}` && /Zoe/.test(await page.locator("body").innerText());
    if (code === "units_short") land[code] = u.pathname === `/care-plans/${F.CX}` && (await page.locator('[data-testid="authorizations"]').count()) > 0;
    if (code === "credential_missing") await shot(page, "fix-credentials-1440");
  }
  rec("B4 Fix → links land where each is fixed: Ana's Credentials tab, Zoe's training page, Zoe's IPOS / Authorizations", Object.keys(land).length === 3 && Object.values(land).every(Boolean), JSON.stringify(land));
  const st = await storage(page);
  rec("P1 no PHI in URLs or browser storage (ids only)", !urls.some((u) => /Zoe|Nolan|Rivera|ISK-/.test(decodeURIComponent(u))) && !/Zoe|Nolan|ISK-2026/.test(JSON.stringify(st)), `${urls.length} URLs`);
  await ctx.close();
  // 390
  const m = await ctxFor(browser, 390); const mp = await m.newPage(); await login(mp, base, F.mgr); await openUnassigned(mp, base);
  const mdlg = await openAssign(mp, "Zoe", "Ana Rivera", { dispatch: true }); await mdlg.locator('[data-testid="elig-compliance"]').scrollIntoViewIfNeeded(); await mp.waitForTimeout(400);
  await shot(mp, "assign-blocked-390");
  rec("B5 the blocked lines at 390 (dialog fits)", (await mdlg.locator('[data-testid="elig-line-training_missing"]').isVisible()), ""); await m.close();
}

async function caregiverSide(base, F, browser) {
  const res = [];
  for (const w of [1440, 390]) {
    const c = await ctxFor(browser, w); const p = await c.newPage(); await login(p, base, F.cgA);
    await p.goto(`${base}/available-shifts`); await p.waitForTimeout(5000);
    const card = p.locator("div.bg-card", { hasText: /Zoe Nolan/ }).first();
    const txt = await card.innerText().catch(() => "");
    const nb = (txt.match(/can't be booked yet/g) || []).length;
    await card.scrollIntoViewIfNeeded().catch(() => {}); await shot(p, `caregiver-not-bookable-${w}`);
    res.push({ w, badge: /Not bookable yet/.test(txt), once: nb === 1, leak: /plan|authoriz|units|ISK-|training/i.test(txt), hs: w === 390 ? await noHScroll(p) : true });
    await c.close();
  }
  rec("G1 caregiver Available Shifts with enforcement ON: Zoe's shift reads 'Not bookable yet' with the generic line once, no plan / authorization / units detail (1440 and 390)",
    res.every((r) => r.badge && r.once && !r.leak && r.hs), JSON.stringify(res));
}

async function kindCare(base, F, browser) {
  const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, F.mgrK);
  await openUnassigned(p, base);
  const dlg = await openAssign(p, "Omar", "Kara Diaz");
  const comp = await dlg.locator('[data-testid="elig-compliance"], [data-testid^="elig-fix-"]').count();
  const blockedPanel = await dlg.getByText("This caregiver cannot be assigned").count();
  await shot(p, "kindcare-assign-1440");
  rec("K1 Kind Care office (no module) with enforcement on elsewhere: the assign dialog is unchanged (no care-plan lines, no Fix links, Kara not blocked)", comp === 0 && blockedPanel === 0, `compliance ${comp}; blocked ${blockedPanel}`);
  await closeAll(p);
  const sm = await smartNames(p, "Omar");
  rec("K2 Kind Care: Smart assign lists Kara as before", /Kara Diaz/.test(sm.text), sm.text.replace(/\s+/g, " ").slice(0, 120));
  await c.close();
}

async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: Ripple Effects Portage (module on, enforcement off) + Kind Care Southside (no module); Pat Admin, Bren Miller (Portage manager), Kim Young (Kind Care manager), Ana Rivera (Portage caregiver, no credentials, not trained), Kara Diaz (Kind Care); Zoe N. (plan, 2 units authorized), group session 1:3 with Max, Lea, Ivy assigned to Ana + Ray; next week from ${F.nextSun}`);
    const browser = await chromium.launch();
    try { await offPhase(base, F, browser); await switchOn(base, F, browser); await onPhase(base, F, browser); await caregiverSide(base, F, browser); await kindCare(base, F, browser); } finally { await browser.close(); }
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

// Ripple UI round 2 (S2 Form Templates + measure library, S3 credentials + training) — browser acceptance
// on DEV with real logins. Usage: node tests/ripple/ui/round2.cjs
// Disposable fixtures (three offices, seven users), random passwords in memory only, fixture writes
// through the real RPCs (signed in as the fixture users), verified teardown. DEV run: needs owner approval.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round2");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui2-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], templates: [], measures: [], credTypes: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
// dates come from the DATABASE clock (owner rule), via the shared read-only helper
const { dbDay, closeDb } = require("../dev/lib.cjs");
const dayIso = (n) => dbDay(n);

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
  F.RZ = await ins("virtual_office", "virtual_office", { agency_id: A, name: `ZZ Ripple-Z ${RUN}`, is_demo: true });
  F.KY = await ins("virtual_office", "virtual_office", { agency_id: A, name: `ZZ KindCare-Y ${RUN}`, is_demo: true });
  F.mgrRX = await mkUser("mgrrx", "manager", F.RX, true, "ZZ Manager RX");
  F.mgrKY = await mkUser("mgrky", "manager", F.KY, true, "ZZ Manager KY");
  F.hrRX = await mkUser("hrrx", "hr_staff", F.RX, true, "ZZ HR RX");
  F.aa = await mkUser("aa", "agency_admin", null, false, "ZZ Agency Admin");
  F.cg = await mkUser("cg", "caregiver", F.RX, false, "ZZ Caregiver Login");
  F.cl = await mkUser("cl", "client", F.RX, false, "ZZ Client Login");
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  for (const o of [F.RX, F.RZ]) await must(F.aa.c, "seed_office_care_plan_defaults", { _office_id: o });
  ids.credTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  // shells (through the RPCs, as their editors)
  const ipos = [
    { field_key: "effective_date", label: "Plan effective", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "effective_date" },
    { field_key: "expiration_date", label: "Plan expires", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "expiration_date" },
    { field_key: "goals", label: "Goals", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_goal" },
    { field_key: "hopes", label: "Hopes and dreams", field_type: "longtext", storage: "field_value" },
    { field_key: "abd_type", label: "ABD type", field_type: "select", storage: "field_value", options: ["Medicaid", "Non-Medicaid"] }];
  const shell = async (c, office, name) => { const v = await must(c, "save_template_draft", { _template_id: null, _office_id: office, _kind: "ipos", _name: name, _intake_doc_type: null,
    _is_required_for_client: null, _sections: [], _note_layout: null, _fields: ipos, _service_type: null });
    const t = (await admin.from("form_template_versions").select("template_id").eq("id", v).single()).data.template_id; ids.templates.push(t);
    await must(c, "publish_template_version", { _template_id: t }); return t; };
  F.names = { office: `ZZ IPOS Ripple-X ${RUN}`, agency: `ZZ IPOS agency ${RUN}`, other: `ZZ IPOS Ripple-Z ${RUN}` };
  F.tOffice = await shell(F.mgrRX.c, F.RX, F.names.office);
  F.tAgency = await shell(F.aa.c, null, F.names.agency);
  F.tOther = await shell(F.aa.c, F.RZ, F.names.other);
  // a client with a plan built from the office shell v1
  F.CX = await ins("clients", "clients", { agency_id: A, virtual_office_id: F.RX, first_name: "ZZ", last_name: "Fixture Client", phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.plan = await must(F.mgrRX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dayIso(-60), expiration_date: await dayIso(300) } });
  await must(F.mgrRX.c, "upsert_care_plan_goals", { _care_plan_id: F.plan, _goals: [{ seq: 1, goal_text: "Goal", objectives: [{ letter: "A", seq: 1, objective_text: "Obj", service_type: "cls", responsible_party: "this_agency" }] }] });
  // caregivers: G with a login, GRX without; GRX gets six required credentials at 61/60/30/29/0/-1 days (entered by HR)
  F.G = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, user_id: F.cg.id, first_name: "ZZ", last_name: "Fixture Caregiver", email: F.cg.email, phone: "555-0100", is_demo: true });
  F.GRX = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, first_name: "ZZ Grx", last_name: "Credentials", email: `sec-grx${SUFFIX}`, phone: "555-0102", is_demo: true });
  F.req = (await admin.from("credential_types").select("id, name").eq("agency_id", A).eq("required", true).eq("is_active", true).order("name")).data;
  F.offsets = [61, 60, 30, 29, 0, -1];
  for (let i = 0; i < 6; i++) await must(F.hrRX.c, "enter_caregiver_credential", { _caregiver_id: F.GRX, _credential_type_id: F.req[i].id, _effective_date: await dayIso(-300), _expiry_date: await dayIso(F.offsets[i]), _certification_number: null });
  return F;
}
async function teardown(F) {
  for (const id of ids.measures) { await admin.from("objective_measures").delete().eq("measure_type_id", id); await admin.from("measure_types").delete().eq("id", id); }
  await admin.from("measure_types").delete().like("label", `%${RUN}%`);
  for (const id of ids.clients) for (const t of ["plan_training_forms", "plan_inservice_forms", "care_plans"]) await admin.from(t).delete().eq("client_id", id);
  for (const id of ids.caregivers) { await admin.from("plan_training_records").delete().eq("caregiver_id", id); await admin.from("caregiver_certifications").delete().eq("caregiver_id", id); }
  for (const t of ["clients", "caregivers"]) for (const id of ids[t]) await admin.from(t).delete().eq("id", id);
  for (const id of ids.templates) { await admin.from("events").delete().eq("subject_id", id); await admin.from("form_templates").delete().eq("id", id); }
  for (const id of ids.users) { await admin.from("user_roles").delete().eq("user_id", id); await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
  for (const id of ids.virtual_office) { await admin.from("events").delete().eq("virtual_office_id", id); await admin.from("office_service_types").delete().eq("virtual_office_id", id); await admin.from("virtual_office").delete().eq("id", id); }
  for (const id of ids.credTypes) await admin.from("credential_types").delete().eq("id", id);
  const left = [];
  for (const [t, key] of [["clients", "clients"], ["caregivers", "caregivers"], ["virtual_office", "virtual_office"], ["form_templates", "templates"], ["credential_types", "credTypes"]])
    for (const id of ids[key]) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  const { data: mts } = await admin.from("measure_types").select("id").like("label", `%${RUN}%`); if (mts && mts.length) left.push(`${mts.length} measure types`);
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} offices, ${ids.templates.length} shells, ${ids.caregivers.length} caregivers, ${ids.clients.length} client, ${ids.credTypes.length} new credential types → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
}

async function login(page, base, u) {
  await page.goto(`${base}/auth`); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
// what sticks out past the viewport (deepest few), for a failing 390px check
const wideEls = (page) => page.evaluate(() => { const w = document.documentElement.clientWidth; const d = document.querySelector('[role="dialog"]'); const r = d && d.getBoundingClientRect();
  const head = "cw=" + w + " sw=" + document.documentElement.scrollWidth + " iw=" + innerWidth + (r ? " dialog=" + Math.round(r.left) + ".." + Math.round(r.right) + " cs.w=" + getComputedStyle(d).width : "");
  const inner = d ? [...d.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().width > w).slice(0, 6).map((e) => e.tagName.toLowerCase() + "." + String(e.className).split(" ").slice(0, 4).join(".") + " w=" + Math.round(e.getBoundingClientRect().width)) : [];
  const outside = [...document.querySelectorAll("body *")].filter((e) => !(d && d.contains(e)) && e.getBoundingClientRect().right > w + 1).slice(0, 8).map((e) => "OUT " + e.tagName.toLowerCase() + "." + String(e.className).split(" ").slice(0, 4).join(".") + " right=" + Math.round(e.getBoundingClientRect().right));
  return [head, ...outside, ...inner, ...[...document.querySelectorAll("body *")]
  .filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== "fixed").slice(-5)
  .map((e) => e.tagName.toLowerCase() + "." + String(e.className).split(" ").slice(0, 3).join(".") + " right=" + Math.round(e.getBoundingClientRect().right))]; });

async function run(base) {
  let F;
  try { F = await setup(); await flows(base, F); }
  finally { await teardown(F); await closeDb(); }
}

async function flows(base, F) {
  log(`fixtures [${RUN}]: Ripple-X + Ripple-Z (module on), KindCare-Y (module off); manager RX, manager KY, hr RX, agency admin, caregiver, client; 3 shells, plan on the office shell v1, credentials at 61/60/30/29/0/-1 days`);
  const browser = await chromium.launch();
  try {
    // ================= S2 (manager RX) =================
    for (const [vw, w, h] of [["1440", 1440, 900], ["390", 390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) }); const page = await ctx.newPage();
      await login(page, base, F.mgrRX);
      await page.goto(`${base}/form-templates`);
      await page.locator(`[data-shell="${F.names.office}"]`).first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(800);
      const names = await page.locator("[data-shell]").evaluateAll((els) => els.map((e) => e.getAttribute("data-shell")));
      const officeRow = await page.locator(`[data-shell="${F.names.office}"]`).innerText(), agencyRow = await page.locator(`[data-shell="${F.names.agency}"]`).innerText();
      await shot(page, `s2-template-list-${vw}`);
      if (vw === "1440") {
        rec("S2-list office manager sees its office shell and the agency-wide shell, not office Z's", names.includes(F.names.office) && names.includes(F.names.agency) && !names.includes(F.names.other)
          && /This office/.test(officeRow) && /Agency-wide/.test(agencyRow), `${names.filter((n) => n.includes(RUN)).length} fixture shells; office row "${officeRow.replace(/\s+/g, " ").slice(0, 80)}"`);
        await page.locator(`[data-shell="${F.names.agency}"]`).click();
        const agencyNote = await page.getByText("Agency-wide shell: only an agency admin can change it").count(), agencyEdit = await page.getByRole("button", { name: /Edit \(new draft\)/ }).count();
        rec("S2-agency agency-wide shell: read only for an office manager (no edit button, explanation shown)", agencyNote === 1 && agencyEdit === 0, `note ${agencyNote}, edit buttons ${agencyEdit}`);
        await page.keyboard.press("Escape"); await page.waitForTimeout(500);
      }
      await page.locator(`[data-shell="${F.names.office}"]`).click();
      await page.getByText(/Fields of v[0-9]/).waitFor({ timeout: 15000 }); await page.waitForTimeout(800);
      const tags = await page.locator('[role="dialog"] table').last().innerText();
      await shot(page, `s2-field-viewer-${vw}`);
      if (vw === "1440") rec("S2-fields field viewer shows a storage tag per field", /Spine/.test(tags) && /Child rows/.test(tags) && /Field value/.test(tags), tags.replace(/\s+/g, " ").slice(0, 120));
      await page.getByRole("button", { name: /Edit \(new draft\)/ }).click();
      await page.locator("[data-locked]").first().waitFor({ timeout: 15000 }); await page.waitForTimeout(500);
      const lockedRows = await page.locator('[data-locked="true"]').count(), lockedInputs = await page.locator('[data-locked="true"] input').count(), openInputs = await page.locator('[data-locked="false"] input').count();
      await shot(page, `s2-editor-locked-${vw}`);
      if (vw === "1440") {
        rec("S2-locked spine and child-row fields are locked in the editor (no inputs); field values are editable", lockedRows === 3 && lockedInputs === 0 && openInputs >= 2,
          `locked rows ${lockedRows} with ${lockedInputs} inputs; editable inputs ${openInputs}`);
        await page.locator("#label-hopes").fill("Hopes and dreams (edited)");
        await page.locator("#new-field").fill("ZZ Strengths"); await page.getByRole("button", { name: /^Add$/ }).click();
        await page.getByRole("button", { name: /Save draft v2/ }).click();
        await page.locator('[data-testid="draft-diff"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
        const diff = await page.locator('[data-testid="draft-diff"]').innerText();
        await shot(page, `s2-diff-publish-${vw}`);
        rec("S2-diff save draft shows the diff vs the current version", /changed/.test(diff) && /Hopes and dreams \(edited\)/.test(diff) && /added/.test(diff) && /ZZ Strengths/.test(diff), diff.replace(/\s+/g, " ").slice(0, 140));
        await page.getByRole("button", { name: /Publish v2/ }).click();
        await page.getByText(/Existing records stay on v1/).waitFor({ timeout: 20000 });
        await shot(page, `s2-published-${vw}`);
        const planV = (await admin.from("care_plans").select("template_version").eq("id", F.plan).single()).data.template_version;
        const vers = (await admin.from("form_template_versions").select("version, is_current").eq("template_id", F.tOffice)).data;
        rec("S2-publish publishing creates v2 and the existing plan stays on v1 (message shown)", planV === 1 && vers.length === 2 && vers.find((v) => v.is_current).version === 2,
          `plan on v${planV}; versions ${vers.map((v) => `v${v.version}${v.is_current ? "*" : ""}`).join(" ")}`);
        await page.getByRole("button", { name: "Close", exact: true }).first().click();
      } else {
        // phone: the editor and the diff dialog fit (re-open the diff of a fresh draft)
        { const ok = await noHScroll(page); rec("S2-390 editor fits at 390px (no horizontal page scroll)", ok, ok ? "editor open" : (await wideEls(page)).join(" | ")); }
        await page.keyboard.press("Escape");
      }
      // close every open dialog / sheet (the shell sheet is modal and hides the tabs)
      for (let i = 0; i < 4 && (await page.locator('[role="dialog"]').count()) > 0; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(500); }
      // measure library
      await page.getByRole("tab", { name: "Measure library" }).click();
      await page.locator("[data-measure]").first().waitFor({ timeout: 20000 });
      if (vw === "1440") {
        await page.getByRole("button", { name: /New measure type/ }).click();
        await page.locator("#mt-label").fill(`ZZ Mood ${RUN}`); await page.locator("#mt-opts").fill("Calm, Upset");
        await page.getByRole("button", { name: "Save" }).click();
        await page.locator(`[data-measure="ZZ Mood ${RUN}"]`).waitFor({ timeout: 20000 });
        const mt = (await admin.from("measure_types").select("id").eq("label", `ZZ Mood ${RUN}`).single()).data.id; ids.measures.push(mt);
        const obj = (await admin.from("care_plan_objectives").select("id, care_plan_goals!inner(care_plan_id)").eq("care_plan_goals.care_plan_id", F.plan).single()).data.id;
        const { error: useErr } = await F.mgrRX.c.rpc("set_objective_measures", { _objective_id: obj, _measures: [{ measure_type_id: mt, prompt_text: "Mood?" }] });
        await page.reload(); await page.getByRole("tab", { name: "Measure library" }).click(); await page.locator(`[data-measure="ZZ Mood ${RUN}"]`).waitFor({ timeout: 20000 });
        const row = page.locator(`[data-measure="ZZ Mood ${RUN}"]`);
        const delDisabled = await row.getByRole("button", { name: /Delete/ }).isDisabled(), sysRows = await page.locator("[data-measure]").filter({ hasText: "System" }).count();
        const sysEditable = await page.locator("[data-measure]").filter({ hasText: "System" }).getByRole("button").count();
        await shot(page, "s2-measure-library-1440");
        rec("S2-measures a new measure type is created in the UI and used by set_objective_measures; once used its Delete is disabled; the 8 system types are read-only",
          !useErr && delDisabled && sysRows === 8 && sysEditable === 0, `use ${useErr ? useErr.message : "ok"}; delete disabled ${delDisabled}; system rows ${sysRows} with ${sysEditable} buttons`);
      } else await shot(page, "s2-measure-library-390");
      if (vw === "390") { const ok = await noHScroll(page); rec("S2-390b template list / measure library fit at 390px", ok, ok ? "no horizontal page scroll" : (await wideEls(page)).join(" | ")); }
      await ctx.close();
    }

    // ================= S3 =================
    const openGrx = async (page) => {
      const btn = page.locator('[data-testid="expirations-panel"] button', { hasText: "ZZ Grx" }).first();
      // the row sits in the panel's own scroll area; click it directly (a pointer click can land on what overlaps the clipped area)
      await btn.waitFor({ timeout: 30000 }); await btn.evaluate((el) => el.click());
      await page.locator('[data-testid="credentials-tab"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    };
    for (const [vw, w, h] of [["1440", 1440, 900], ["390", 390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) }); const page = await ctx.newPage();
      await login(page, base, F.hrRX);
      await page.goto(`${base}/caregivers`);
      await page.locator('[data-testid="expirations-panel"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
      const bands = {}; for (let i = 0; i < 6; i++) bands[F.offsets[i]] = await page.locator(`[data-testid="expirations-panel"] li[data-credential="${F.req[i].name}"]`).filter({ hasText: "ZZ Grx" }).getAttribute("data-band").catch(() => null);
      await shot(page, `s3-expirations-panel-${vw}`);
      if (vw === "1440") rec("S3-bands panel bands at 61/60/30/29/0/-1 days: not listed / yellow / red / red / red / overdue", bands[61] === null && bands[60] === "yellow" && bands[30] === "red" && bands[29] === "red" && bands[0] === "red" && bands[-1] === "overdue",
        JSON.stringify(bands));
      await openGrx(page); await page.waitForTimeout(700);
      await shot(page, `s3-credentials-tab-${vw}`);
      if (vw === "390") { const ok = await noHScroll(page); rec("S3-390 Caregiver Management with the panel and the credentials tab fits at 390px", ok, ok ? "no horizontal page scroll" : (await wideEls(page)).join(" | ")); }
      if (vw === "1440") {
        // HR enters a missing required type, then renews it
        const missingRow = page.locator('[data-testid="credentials-tab"] tr', { has: page.locator('[data-band="missing"]') }).first();
        const missingName = await missingRow.getAttribute("data-credential");
        await missingRow.getByRole("button", { name: "Enter" }).click();
        if (!(await page.locator("#cred-exp").inputValue())) await page.locator("#cred-exp").fill(await dayIso(365));
        await page.getByRole("button", { name: /^Save$/ }).click(); await page.waitForTimeout(2500);
        const entered = await page.locator(`[data-testid="credentials-tab"] tr[data-credential="${missingName}"] [data-band]`).getAttribute("data-band");
        await page.locator(`[data-testid="credentials-tab"] tr[data-credential="${missingName}"]`).getByRole("button", { name: "Renew" }).click();
        await page.locator("#cred-exp").fill(await dayIso(400)); await page.getByRole("button", { name: /^Save$/ }).click(); await page.waitForTimeout(2500);
        const hist = await page.locator(`[data-testid="credentials-tab"] tr[data-credential="${missingName}"]`).getByRole("button", { name: /History/ }).count();
        rec("S3-hr hr_staff enters a missing required credential and renews it (history kept)", entered === "ok" && hist === 1, `"${missingName}" entered -> band ${entered}; history button ${hist}`);
        F.hrEntered = missingName;
        // hr can't open clinical pages
        const blocked = [];
        for (const r of ["/care-plans", "/billing/weekly", "/form-templates"]) { await page.goto(`${base}${r}`); await page.waitForTimeout(2500); if (new URL(page.url()).pathname === r) blocked.push(r); }
        rec("S3-hr-clinical hr_staff can't open any clinical page (care plans, billing, form templates)", blocked.length === 0, blocked.length ? `opened ${blocked.join(", ")}` : "all three redirected");
      }
      await ctx.close();
    }
    // manager override, then HR locked out
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
      await login(page, base, F.mgrRX); await page.goto(`${base}/caregivers`);
      await page.locator('[data-testid="expirations-panel"]').waitFor({ timeout: 30000 }); await openGrx(page);
      const row = page.locator(`[data-testid="credentials-tab"] tr[data-credential="${F.hrEntered}"]`);
      await row.getByRole("button", { name: "Renew" }).click();
      await page.locator('[data-testid="override-warning"]').waitFor({ timeout: 10000 }).catch(() => {}); await page.waitForTimeout(700);   // let the open animation finish
      const warn = await page.locator('[data-testid="override-warning"]').count();
      await shot(page, "s3-override-dialog-1440");
      await page.getByRole("button", { name: /Save override/ }).click(); await page.waitForTimeout(2500);
      const marked = await row.innerText();
      rec("S3-override the manager's renewal of an HR entry is marked as an override in the dialog and on the row", warn === 1 && /Override: ZZ Manager RX/.test(marked), `warning ${warn}; row "${marked.replace(/\s+/g, " ").slice(0, 120)}"`);
      await ctx.close();
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p2 = await ctx2.newPage();
      await login(p2, base, F.hrRX); await p2.goto(`${base}/caregivers`); await p2.locator('[data-testid="expirations-panel"]').waitFor({ timeout: 30000 }); await openGrx(p2);
      const btn = p2.locator(`[data-testid="credentials-tab"] tr[data-credential="${F.hrEntered}"]`).getByRole("button", { name: "Renew" });
      const disabled = await btn.isDisabled(), why = await btn.getAttribute("title");
      const { error: rpcErr } = await F.hrRX.c.rpc("enter_caregiver_credential", { _caregiver_id: F.GRX, _credential_type_id: F.req.find((t) => t.name === F.hrEntered)?.id
        || (await admin.from("credential_types").select("id").eq("agency_id", A).eq("name", F.hrEntered).single()).data.id, _effective_date: await dayIso(-1), _expiry_date: await dayIso(200), _certification_number: null });
      rec("S3-locked after the override HR can no longer change that row (button disabled with the reason; the RPC refuses too)", disabled && /only a manager/.test(why || "") && /only a manager can change it/.test(rpcErr ? rpcErr.message : ""),
        `disabled ${disabled}; title "${why}"; RPC "${rpcErr ? rpcErr.message.slice(0, 60) : "ACCEPTED"}"`);
      await ctx2.close();
    }
    // Kind-Care-only manager: no panel; caregiver / client: no access to /caregivers
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
      await login(page, base, F.mgrKY); await page.goto(`${base}/caregivers`); await page.waitForTimeout(5000);
      const panel = await page.locator('[data-testid="expirations-panel"]').count();
      await shot(page, "s3-kindcare-no-panel-1440");
      rec("S3-kindcare a Kind-Care-only office shows no expirations panel", panel === 0 && /\/caregivers/.test(page.url()), `panel ${panel}`);
      await ctx.close();
      for (const u of [F.cg, F.cl]) {
        const c = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage();
        await login(p, base, u); await p.goto(`${base}/caregivers`); await p.waitForTimeout(3500);
        rec(`S3-noaccess-${u === F.cg ? "caregiver" : "client"} ${u === F.cg ? "caregiver" : "client"} has no access to Caregiver Management`, new URL(p.url()).pathname !== "/caregivers", `redirected to ${new URL(p.url()).pathname}`);
        await c.close();
      }
    }
  } finally { await browser.close(); }
}

(async () => {
  const port = 8150 + Math.floor(Math.random() * 50);
  const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("vite did not start")), 90000);
      vite.stdout.on("data", (d) => { if (/Local:|ready in/i.test(d.toString())) { clearTimeout(to); res(); } }); });
    await run(`http://localhost:${port}`);
  } catch (e) { log("ERROR:", String(e.message).replace(/[[0-9;]*m/g, "").slice(0, 2000)); }
  finally { try { execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ } }
  log("summary: " + rows.map((r) => `${r.id}=${r.ok === "INFO" ? "INFO" : r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => r.ok === false)) process.exitCode = 1;
})();

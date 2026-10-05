// Ripple UI round 3 (S4 client care plans + IPOS + authorizations + onboarding; S5 goals + measures)
// — browser acceptance on DEV with real logins. Usage: node tests/ripple/ui/round3.cjs [s4|s5|all]
// Disposable fixtures (three offices, seven users), random passwords in memory only, fixture writes
// through the real RPCs (signed in as the fixture users) except the one reviewed progress note the
// correction refusals need (inserted with the service key, as the DEV suites do), verified teardown.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round3");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui3-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const WHICH = process.argv[2] || "all";
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], templates: [], notes: [], credTypes: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
// dates come from the DATABASE clock (owner rule), via the shared read-only helper
const { dbDay, dbNow, closeDb } = require("../dev/lib.cjs");

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
const client = (office, last) => ins("clients", "clients", { agency_id: A, virtual_office_id: office, first_name: "ZZ", last_name: last, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });

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
  // IPOS shell for Ripple-X: spine dates + meeting date, goals (Goals tab), attendees + other providers (rows), two field values
  const ipos = [
    { field_key: "meeting_date", label: "Meeting date", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "meeting_date", section: "Header" },
    { field_key: "effective_date", label: "Plan effective", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "effective_date", section: "Header" },
    { field_key: "expiration_date", label: "Plan expires", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "expiration_date", section: "Header" },
    { field_key: "hopes", label: "Hopes and dreams", field_type: "longtext", storage: "field_value", required: true, section: "Person-centred" },
    { field_key: "abd_type", label: "ABD type", field_type: "select", storage: "field_value", options: ["Medicaid", "Non-Medicaid"], section: "Person-centred" },
    { field_key: "goals", label: "Goals", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_goal", section: "Goals" },
    { field_key: "objectives", label: "Objectives", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_objective", section: "Goals" },
    { field_key: "attendees", label: "Meeting attendees", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_attendee", section: "Meeting" },
    { field_key: "external", label: "Other providers' services", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_external_service", section: "Services" }];
  const v = await must(F.mgrRX.c, "save_template_draft", { _template_id: null, _office_id: F.RX, _kind: "ipos", _name: `ZZ IPOS Ripple-X ${RUN}`, _intake_doc_type: null,
    _is_required_for_client: null, _sections: [], _note_layout: null, _fields: ipos, _service_type: null });
  F.shell = (await admin.from("form_template_versions").select("template_id").eq("id", v).single()).data.template_id; ids.templates.push(F.shell);
  await must(F.mgrRX.c, "publish_template_version", { _template_id: F.shell });
  F.CX = await client(F.RX, `Plan Client ${RUN}`);
  F.CR = await client(F.RX, `Risk Client ${RUN}`);
  F.G = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, first_name: "ZZ", last_name: `Caregiver ${RUN}`, email: `sec-g${SUFFIX}`, phone: "555-0100", is_demo: true });
  // G2 fixture: three authorizations on the risk client expiring in 61 / 60 / 30 days
  F.risk = {};
  for (const o of [61, 60, 30]) F.risk[o] = await must(F.mgrRX.c, "create_service_authorization", { _client_id: F.CR, _service_type: "cls", _auth_number: `ZZ-R${o}-${RUN}`,
    _units_authorized: 20, _effective_date: await dbDay(-100), _expiration_date: await dbDay(o) });
  return F;
}

async function teardown(F) {
  for (const id of ids.clients) {
    await admin.from("progress_notes").delete().eq("client_id", id);
    for (const { id: a } of (await admin.from("service_authorizations").select("id").eq("client_id", id)).data || []) await admin.from("events").delete().eq("subject_id", a);
    for (const t of ["plan_training_records", "plan_training_forms", "plan_inservice_forms", "client_documents", "service_authorizations", "care_plans"]) await admin.from(t).delete().eq("client_id", id);
  }
  for (const t of ["clients", "caregivers"]) for (const id of ids[t]) await admin.from(t).delete().eq("id", id);
  for (const id of ids.templates) { await admin.from("events").delete().eq("subject_id", id); await admin.from("form_templates").delete().eq("id", id); }
  for (const id of ids.users) { await admin.from("user_roles").delete().eq("user_id", id); await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
  for (const id of ids.virtual_office) { await admin.from("events").delete().eq("virtual_office_id", id); await admin.from("office_service_types").delete().eq("virtual_office_id", id); await admin.from("virtual_office").delete().eq("id", id); }
  for (const id of ids.credTypes) await admin.from("credential_types").delete().eq("id", id);
  const left = [];
  for (const [t, key] of [["clients", "clients"], ["caregivers", "caregivers"], ["virtual_office", "virtual_office"], ["form_templates", "templates"], ["credential_types", "credTypes"]])
    for (const id of ids[key]) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  const { data: auths } = await admin.from("service_authorizations").select("id").like("auth_number", `%${RUN}%`); if (auths && auths.length) left.push(`${auths.length} authorizations`);
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} offices, ${ids.templates.length} shell, ${ids.caregivers.length} caregiver, ${ids.clients.length} clients → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
}

async function login(page, base, u) {
  await page.goto(`${base}/auth`); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const wideEls = (page) => page.evaluate(() => { const w = document.documentElement.clientWidth;
  return ["sw=" + document.documentElement.scrollWidth, ...[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== "fixed")
    .slice(0, 6).map((e) => e.tagName.toLowerCase() + "." + String(e.className).split(" ").slice(0, 3).join(".") + " right=" + Math.round(e.getBoundingClientRect().right))]; });
const fits = async (page, id, label) => { const ok = await noHScroll(page); rec(id, ok, ok ? `${label}: no horizontal page scroll` : (await wideEls(page)).join(" | ")); };
const pick = async (page, trigger, option) => { await page.locator(trigger).click(); await page.getByRole("option", { name: option, exact: true }).click(); };
const status = async (page, key) => page.locator(`[data-testid="onboarding"] li[data-item="${key}"]`).getAttribute("data-status");
const ctxFor = (browser, w) => browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
const closeDialogs = async (page) => { for (let i = 0; i < 3 && await page.locator('[role="dialog"]').count(); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); } };
const tab = async (page, name) => { await page.getByRole("tab", { name }).click(); await page.waitForTimeout(600); };
const onboardingNow = async (F) => (await must(F.mgrRX.c, "get_client_onboarding_status", { _client_id: F.CX })).items.map((i) => `${i.key}=${i.status}`).join(" ");

// =============================================================================================
// S4
// =============================================================================================
async function s4(base, F, browser) {
  // ---------- list + risk panel ----------
  for (const w of [1440, 390]) {
    const ctx = await ctxFor(browser, w); const page = await ctx.newPage();
    await login(page, base, F.mgrRX); await page.goto(`${base}/care-plans`);
    await page.locator('[data-testid="risk-panel"] li[data-auth]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
    if (w === 1440) {
      const b = async (o) => page.locator(`[data-testid="risk-panel"] li[data-auth="ZZ-R${o}-${RUN}"]`).getAttribute("data-band").catch(() => null);
      const at = await page.locator(`[data-testid="risk-panel"] li[data-auth="ZZ-R60-${RUN}"]`).innerText();
      rec("S4-risk G2 panel: 61 days not listed, 60 yellow, 30 red; units at risk shown in units and hours", (await page.locator(`li[data-auth="ZZ-R61-${RUN}"]`).count()) === 0
        && (await b(60)) === "yellow" && (await b(30)) === "red" && /20 units at risk \(5 h\)/.test(at), `60=${await b(60)} 30=${await b(30)}; "${at.replace(/\s+/g, " ")}"`);
      const row = await page.locator(`[data-client-row="${F.CX}"]`).innerText();
      rec("S4-list the client row shows onboarding n of 8 and no plan yet", /of 8/.test(row) && /No plan/.test(row), row.replace(/\s+/g, " "));
    }
    await shot(page, `s4-care-plans-list-${w}`);
    if (w === 390) await fits(page, "S4-390a care-plans list with the risk panel fits at 390px", "list");
    await ctx.close();
  }

  const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage();
  await login(page, base, F.mgrRX);
  await page.goto(`${base}/care-plans/${F.CX}`);
  await page.locator('[data-testid="client-header"]').waitFor({ timeout: 30000 }); await page.locator('[data-testid="no-plan"]').waitFor({ timeout: 20000 });
  const steps = [`start: ${await onboardingNow(F)}`];
  await shot(page, "s4-client-header-1440");

  // ---------- IPOS create (form rendered from the shell) ----------
  await page.getByRole("button", { name: "Create plan" }).click();
  await page.locator('[data-testid="plan-form"] #h-effective_date').waitFor({ timeout: 20000 }); await page.waitForTimeout(500);
  const formText = await page.locator('[data-testid="plan-form"]').innerText();
  await page.locator("#h-meeting_date").fill(await dbDay(-2));
  await page.locator("#h-effective_date").fill(await dbDay(-1));
  await page.locator("#h-expiration_date").fill(await dbDay(364));
  await pick(page, "#fv-abd_type", "Medicaid");
  await page.locator('[data-rows="care_plan_attendee"]').getByRole("button", { name: /Add/ }).click();
  await page.locator("#care_plan_attendee-0-name").fill("Ann (mother)");
  await shot(page, "s4-ipos-create-form-1440");
  await page.getByRole("button", { name: "Create plan", exact: true }).last().click();
  await page.waitForTimeout(1200);
  const reqMsg = await page.getByText("Hopes and dreams is required").count();
  await page.locator("#fv-hopes").fill("Live on my own; work at the library");
  await page.getByRole("button", { name: "Create plan", exact: true }).last().click();
  await page.locator('[data-testid="active-plan"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
  const plan = (await admin.from("care_plans").select("id, version, training_version, template_id, template_version, field_values").eq("client_id", F.CX).eq("status", "active").single()).data;
  F.plan = plan.id;
  const att = (await admin.from("care_plan_attendees").select("name").eq("care_plan_id", plan.id)).data;
  rec("S4-create the form is rendered from the shell (spine inputs locked, field values, rows; goals deferred to the Goals tab); required field enforced before the RPC; plan created from the shell v1 with its values and rows",
    /Meeting date/.test(formText) && /Hopes and dreams/.test(formText) && /Meeting attendees/.test(formText) && /Goals tab/.test(formText) && reqMsg >= 1
      && plan.template_id === F.shell && plan.template_version === 1 && plan.field_values.abd_type === "Medicaid" && att.length === 1,
    `required msg ${reqMsg}; plan v${plan.version} from shell v${plan.template_version}; attendees ${att.length}`);
  const header = await page.locator('[data-testid="client-header"]').innerText();
  rec("S4-header client name, office, read-only ProvenanceBadge and plan status", /ZZ Plan Client/.test(header) && /Ripple-X/.test(header) && /Built from ZZ IPOS Ripple-X .* v1/.test(header) && /Plan v1 active/.test(header)
    && (await page.locator('[data-testid="client-header"] a').count()) === 0, header.replace(/\s+/g, " ").slice(0, 160));
  steps.push(`plan: ${await onboardingNow(F)}`);

  // ---------- authorization (create with opening balance + weekly cap) ----------
  await page.getByRole("button", { name: "Add authorization" }).click();
  await page.locator("#auth-auth_number").waitFor();
  await pick(page, "#auth-service", "CLS");
  await page.locator("#auth-auth_number").fill(`ZZ-UI-${RUN}`); await page.locator("#auth-units_authorized").fill("40");
  await page.locator("#auth-effective_date").fill(await dbDay(-30)); await page.locator("#auth-expiration_date").fill(await dbDay(200));
  await pick(page, "#auth-period", "Per week"); await page.locator("#auth-units_per_period").fill("8");
  await page.locator("#auth-units_used_before_caremuch").fill("10");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator(`[data-testid="authorizations"] tr[data-auth="ZZ-UI-${RUN}"]`).waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
  const authRow = await page.locator(`tr[data-auth="ZZ-UI-${RUN}"]`).innerText();
  await page.locator('[data-testid="authorizations"]').scrollIntoViewIfNeeded(); await shot(page, "s4-authorization-table-1440");
  rec("S4-auth a 40-unit authorization with 10 used before CareMuch shows 30 left; the weekly cap shows 'N left this week' in the UnitsBar",
    /30 units left/.test(authRow) && /8 left this week \(cap 8\)/.test(authRow), authRow.replace(/\s+/g, " ").slice(0, 200));
  steps.push(`auth: ${await onboardingNow(F)}`);

  // ---------- correction refusals (W2) ----------
  F.corAuth = await must(F.mgrRX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-COR-${RUN}`, _units_authorized: 40,
    _effective_date: await dbDay(-30), _expiration_date: await dbDay(20), _units_used_before_caremuch: 10 });
  await ins("progress_notes", "notes", { agency_id: A, virtual_office_id: F.RX, client_id: F.CX, caregiver_id: F.G, authorization_id: F.corAuth, note_kind: "cls", service_type: "cls",
    service_date: await dbDay(-3), units_scheduled: 12, billable: true, status: "reviewed" });
  await page.reload(); await page.locator(`tr[data-auth="ZZ-COR-${RUN}"]`).waitFor({ timeout: 20000 });
  const tryCorrect = async (fill) => {
    await page.getByRole("button", { name: `Correct ZZ-COR-${RUN}` }).click(); await page.locator('[data-testid="correct-dialog"]').waitFor();
    await fill(); await page.locator("#auth-reason").fill("Matches the paper authorization");
    await page.getByRole("button", { name: "Save correction" }).click();
    await page.locator('[data-testid="correct-error"]').waitFor({ timeout: 15000 }).catch(() => {});
    const t = await page.locator('[data-testid="correct-error"]').innerText().catch(() => "");
    return t;
  };
  const r1 = await tryCorrect(async () => page.locator("#auth-units_authorized").fill("21"));
  await page.waitForTimeout(400); await shot(page, "s4-correct-refusal-1440"); await closeDialogs(page);
  const r2 = await tryCorrect(async () => page.locator("#auth-effective_date").fill(await dbDay(-2))); await closeDialogs(page);
  const r3 = await tryCorrect(async () => { await pick(page, "#auth-period", "Per week"); await page.locator("#auth-units_per_period").fill("8"); }); await closeDialogs(page);
  rec("S4-correct refusals shown in the dialog: units below charged + opening balance; dates leaving out a reviewed visit; a weekly cap the charged week already exceeds",
    /can't go below the 12 units already charged plus the 10/.test(r1) && /leave out a reviewed or billed visit/.test(r2) && /exceed this cap/.test(r3), [r1, r2, r3].map((x) => x.slice(0, 50)).join(" | "));
  await page.getByRole("button", { name: `Correct ZZ-COR-${RUN}` }).click(); await page.locator('[data-testid="correct-dialog"]').waitFor();
  await page.locator("#auth-units_authorized").fill("22"); await page.locator("#auth-reason").fill("Matches the paper authorization");
  await page.getByRole("button", { name: "Save correction" }).click(); await page.waitForTimeout(1500);
  const corrected = (await admin.from("service_authorizations").select("units_authorized").eq("id", F.corAuth).single()).data.units_authorized;
  const ev = (await admin.from("events").select("payload").eq("subject_id", F.corAuth).eq("event_type", "authorization_corrected")).data;
  rec("S4-correct-ok a valid correction is saved and audited with the reason", Number(corrected) === 22 && ev.length === 1 && ev[0].payload.reason === "Matches the paper authorization", `units ${corrected}; events ${ev.length}`);
  rec("S4-void void_service_authorization is not built: it changes existing readers (eligibility/review/onboarding) and waits for owner approval", "INFO", "no Void button rendered (void_available=false)");

  // ---------- onboarding flips to onboarded ----------
  await tab(page, "Onboarding & Documents");
  await page.locator('[data-testid="onboarding"] li[data-item="ipos"]').waitFor({ timeout: 20000 });
  const ipos0 = await status(page, "ipos"), auth0 = await status(page, "authorization");
  await page.getByRole("button", { name: "Update Assessment" }).click(); await pick(page, "#doc-status", "Complete");
  await page.locator("#doc-eff").fill(await dbDay(-5)); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.waitForTimeout(1500);
  const assess = await status(page, "assessment");
  await page.getByRole("button", { name: "Update Insurance" }).click(); await pick(page, "#doc-status", "Not applicable");
  await page.getByRole("button", { name: "Save", exact: true }).click(); await page.waitForTimeout(500);
  const naRefused = await page.locator('[role="dialog"]').count();
  await page.locator("#doc-reason").fill("Private pay; no insurance on file"); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.waitForTimeout(1500);
  const naRow = await page.locator('tr[data-doc="insurance"]').innerText();
  steps.push(`docs (UI): ${await onboardingNow(F)}`);
  for (const t of ["safety_behavior_plan", "consent", "emergency_contacts", "allergies", "release_of_information"])
    await must(F.mgrRX.c, "upsert_client_document", { _client_id: F.CX, _doc_type: t, _status: "complete", _effective_date: await dbDay(-5) });
  // goals + measures first: a goal change after training would (correctly) start retraining
  await must(F.mgrRX.c, "upsert_care_plan_goals", { _care_plan_id: F.plan, _goals: [{ seq: 1, goal_text: "Build community skills", objectives: [
    { seq: 1, letter: "A", objective_text: "Order at a cafe", staff_instructions: "Prompt once, then wait", service_type: "cls", responsible_party: "this_agency" },
    { seq: 2, letter: "B", objective_text: "Arrange transport", responsible_party: "case_management" }] }] });
  const objA = (await admin.from("care_plan_objectives").select("id, goal_id, objective_text").eq("objective_text", "Order at a cafe")).data
    .find(() => true);
  const yn = (await admin.from("measure_types").select("id").is("agency_id", null).eq("kind", "yes_no_na").limit(1)).data[0].id;
  await must(F.mgrRX.c, "set_objective_measures", { _objective_id: objA.id, _measures: [{ measure_type_id: yn, prompt_text: "Ordered without help?" }] });
  await must(F.hrRX.c, "record_inservice_form", { _care_plan_id: F.plan, _case_manager_name: "ZZ CM", _program_lead_id: F.mgrRX.id, _trained_on: await dbDay(0), _signed_at: await dbNow() });
  await must(F.hrRX.c, "record_training_form", { _care_plan_id: F.plan, _plan_document_type: "ipos_initial", _plan_effective_date: null, _location: null, _records: [{ caregiver_id: F.G, training_date: await dbDay(0) }] });
  steps.push(`all data: ${await onboardingNow(F)}`);
  await page.reload(); await page.locator('[data-testid="onboarding"] li[data-item="ipos"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
  const allStatuses = await page.locator('[data-testid="onboarding"] li[data-item]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-item")}=${e.getAttribute("data-status")}`));
  const headerOn = await page.locator('[data-testid="client-header"]').innerText();
  await shot(page, "s4-onboarding-tab-1440");
  rec("S4-onboarding items flip as the data is added (IPOS, authorization, assessment, N/A insurance with its reason) through to onboarded",
    ipos0 === "complete" && auth0 === "complete" && assess === "complete" && naRefused === 1 && /N\/A/.test(naRow) && /Private pay/.test(naRow)
      && allStatuses.length === 8 && allStatuses.every((s) => /=(complete|not_applicable)$/.test(s)) && /Onboarded/.test(headerOn),
    `${steps.join(" || ")} || UI now: ${allStatuses.join(" ")}`);
  const listOnb = await (async () => { await page.goto(`${base}/care-plans`); await page.locator(`[data-client-row="${F.CX}"]`).waitFor({ timeout: 20000 }); return page.locator(`[data-client-row="${F.CX}"] [data-onboarding]`).getAttribute("data-onboarding"); })();
  rec("S4-list-onboarded the list shows the client as onboarded", listOnb === "onboarded", `list badge ${listOnb}`);

  // ---------- renewal: confirmation, then in-service / training expire ----------
  await page.goto(`${base}/care-plans/${F.CX}?tab=ipos`); await page.locator('[data-testid="active-plan"]').waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Renew" }).click(); await pick(page, "#renew-type", "Annual");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('[data-testid="renewal-confirm"]').waitFor({ timeout: 10000 }); await page.waitForTimeout(400);
  const confirmText = await page.locator('[data-testid="renewal-confirm"]').innerText();
  await shot(page, "s4-renewal-confirm-1440");
  await page.getByRole("button", { name: "Renew and start retraining" }).click();
  await page.getByText("Plan v2 active").waitFor({ timeout: 20000 });
  await tab(page, "Onboarding & Documents"); await page.waitForTimeout(800);
  const ins2 = await status(page, "inservice"), tr2 = await status(page, "training");
  const redo = await page.locator('[data-testid="onboarding"] li[data-item="training"]').innerText();
  const hist = (await admin.from("care_plans").select("version, status, training_version").eq("client_id", F.CX).order("version")).data;
  rec("S4-renew the retraining confirmation appears before renewing; afterwards in-service and training read 'expired' (redo at version 2); v1 is superseded",
    /Renewal starts retraining for all caregivers/.test(confirmText) && ins2 === "expired" && tr2 === "expired" && /Redo at version 2/.test(redo) && hist[0].status === "superseded" && hist[1].training_version === 2,
    `confirm "${confirmText.replace(/\s+/g, " ").slice(0, 70)}"; inservice ${ins2}, training ${tr2}; ${hist.map((h) => `v${h.version} ${h.status}`).join(", ")}`);
  await ctx.close();

  // ---------- 390 ----------
  {
    const c = await ctxFor(browser, 390); const p = await c.newPage();
    await login(p, base, F.mgrRX); await p.goto(`${base}/care-plans/${F.CX}?tab=ipos`);
    await p.locator('[data-testid="active-plan"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(1000);
    await shot(p, "s4-client-header-390"); await fits(p, "S4-390b client page (IPOS tab) fits at 390px", "IPOS");
    await p.locator('[data-testid="authorizations"]').scrollIntoViewIfNeeded(); await shot(p, "s4-authorization-table-390");
    await p.getByRole("button", { name: "Renew" }).click(); await p.getByRole("button", { name: "Continue" }).click();
    await p.locator('[data-testid="renewal-confirm"]').waitFor(); await p.waitForTimeout(400); await shot(p, "s4-renewal-confirm-390"); await closeDialogs(p);
    await p.getByRole("button", { name: `Correct ZZ-COR-${RUN}` }).click(); await p.locator("#auth-units_authorized").fill("21"); await p.locator("#auth-reason").fill("x");
    await p.getByRole("button", { name: "Save correction" }).click(); await p.locator('[data-testid="correct-error"]').waitFor({ timeout: 15000 }); await p.waitForTimeout(400);
    await shot(p, "s4-correct-refusal-390"); await closeDialogs(p);
    await p.goto(`${base}/care-plans/${F.CX}?tab=onboarding`); await p.locator('[data-testid="onboarding"]').waitFor({ timeout: 20000 }); await p.waitForTimeout(800);
    await shot(p, "s4-onboarding-tab-390"); await fits(p, "S4-390c onboarding tab fits at 390px", "onboarding");
    // the create form at 390 on a client without a plan
    await p.goto(`${base}/care-plans/${F.CR}?tab=ipos`); await p.getByRole("button", { name: "Create plan" }).click();
    await p.locator('[data-testid="plan-form"] #h-effective_date').waitFor({ timeout: 20000 }); await p.waitForTimeout(500);
    await shot(p, "s4-ipos-create-form-390"); await closeDialogs(p);
    await c.close();
  }

  // ---------- access ----------
  for (const [u, label, expect] of [[F.mgrRY, "office-Y manager", "denied"], [F.schRX, "scheduler", "redirect"], [F.hrRX, "hr_staff", "redirect"], [F.mgrKY, "Kind-Care-only manager", "redirect"]]) {
    const c = await ctxFor(browser, 1440); const p = await c.newPage();
    await login(p, base, u); await p.goto(`${base}/care-plans/${F.CX}`); await p.waitForTimeout(5000);
    const path_ = new URL(p.url()).pathname, deniedCard = await p.locator('[data-testid="client-denied"]').count(), body = await p.locator("body").innerText();
    const leaked = /Plan Client|Hopes and dreams|Live on my own|Order at a cafe/.test(body);
    const ok = expect === "denied" ? deniedCard === 1 && !leaked : path_ !== `/care-plans/${F.CX}` && !leaked;
    rec(`S4-access-${label.replace(/[^a-z]+/gi, "-").toLowerCase()} ${label} can't open the client page${label === "hr_staff" ? " (no clinical content)" : ""}`, ok, `${path_}; denied card ${deniedCard}; clinical text ${leaked ? "LEAKED" : "none"}`);
    await c.close();
  }
}

// =============================================================================================
async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: Ripple-X + Ripple-Y (module on), KindCare-K (module off); manager RX / RY / KY, scheduler RX, hr RX, agency admin; IPOS shell for Ripple-X; plan client + risk client (auths at 61/60/30 days)`);
    const browser = await chromium.launch();
    try {
      if (WHICH === "s4" || WHICH === "all") await s4(base, F, browser);
      if ((WHICH === "s5" || WHICH === "all") && typeof s5 === "function") await s5(base, F, browser);
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
  } catch (e) { log("ERROR:", String(e.message).replace(/[[0-9;]*m/g, "").slice(0, 2000)); }
  finally { try { execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ } }
  log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok === "INFO" ? "INFO" : r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => r.ok === false)) process.exitCode = 1;
})();

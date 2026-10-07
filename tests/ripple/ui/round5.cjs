// Ripple UI round 5 (S7: caregiver app shell + progress note) — browser acceptance on DEV with real
// logins. Usage: node tests/ripple/ui/round5.cjs
// Disposable fixtures (one module office, six users, three caregivers, two clients), random passwords in
// memory only, fixture writes through the real RPCs, verified teardown. One browser, contexts closed in turn.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round5");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui5-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], shifts: [], credTypes: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const { dbDay, dbNow, closeDb, pgRead } = require("../dev/lib.cjs");
const MARK = `PHIMARK${RUN.replace(/-/g, "")}`;              // typed into the note; must never reach storage, URLs or the console
const NOTE_KEYS = "actual_end,arrived_late,client_arrived_at,client_first_name,client_last_initial,due_at,id,late_submitted,location,narrative_text,note_kind,returned_reason,scheduled_end,scheduled_start,service_date,staff_client_ratio,staff_signature_name,staff_signed_at,status";
const ENTRY_KEYS = "answers,entry_id,goal_text,measures,notes_text,objective_letter,objective_text,staff_instructions";
const MEASURE_KEYS = "kind,measure_id,options,prompt_text,trial_count";
const ITEM_KEYS = "client_first_name,client_last_initial,due_at,end_time,note_status,overdue,returned_reason,scheduled_end,scheduled_start,service_type,shift_date,shift_id,start_time";

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
  F.RX = await ins("virtual_office", "virtual_office", { agency_id: A, name: `ZZ Ripple-X ${RUN}`, is_demo: true });
  F.aa = await mkUser("aa", ["agency_admin"], null, false, "ZZ Agency Admin");
  F.mgr = await mkUser("mgr", ["manager"], F.RX, true, "ZZ Manager RX");
  F.hr = await mkUser("hr", ["hr_staff"], F.RX, true, "ZZ HR RX");
  F.cgA = await mkUser("cga", ["caregiver"], F.RX, false, "ZZ Ana Caregiver");
  F.cgB = await mkUser("cgb", ["caregiver"], F.RX, false, "ZZ Ben Caregiver");
  F.dual = await mkUser("dual", ["manager", "caregiver"], F.RX, true, "ZZ Dual Role");
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aa.c, "seed_office_care_plan_defaults", { _office_id: F.RX });
  ids.credTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 10 * 864e5).toISOString() }).eq("id", F.RX);
  const cg = (first, user) => ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, user_id: user, first_name: first, last_name: `Caregiver ${RUN}`, email: `sec-${first.toLowerCase()}${SUFFIX}`, phone: "555-0100", is_demo: true });
  F.G1 = await cg("Ana", F.cgA.id); F.G2 = await cg("Ben", F.cgB.id); F.G3 = await cg("Dual", F.dual.id);
  await admin.from("caregiver_skills").insert([{ caregiver_id: F.G1, care_type_code: "CLS0001", is_demo: true }, { caregiver_id: F.G1, care_type_code: "RESP0001", is_demo: true }, { caregiver_id: F.G2, care_type_code: "CLS0001", is_demo: true }]);
  const req = (await admin.from("credential_types").select("id").eq("agency_id", A).eq("required", true).eq("is_active", true)).data;
  for (const t of req) await must(F.hr.c, "enter_caregiver_credential", { _caregiver_id: F.G1, _credential_type_id: t.id, _effective_date: await dbDay(-100), _expiry_date: await dbDay(300), _certification_number: null });
  // clients: CX with a plan (two goals, a case-management objective) and an authorization; CB with neither
  const cl = (last) => ins("clients", "clients", { agency_id: A, virtual_office_id: F.RX, first_name: "Zoe", last_name: `${last} ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.CX = await cl("Notewriter"); F.CB = await cl("Unbooked");
  F.plan = await must(F.mgr.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(330) } });
  await must(F.mgr.c, "upsert_care_plan_goals", { _care_plan_id: F.plan, _goals: [
    { seq: 1, goal_text: "Build daily living skills", objectives: [
      { seq: 1, letter: "A", objective_text: "Prepare a simple meal", staff_instructions: "Lay out the ingredients first. Praise each step.", service_type: "cls", responsible_party: "this_agency" },
      { seq: 2, letter: "B", objective_text: "ZZ CM objective (not on the note)", responsible_party: "case_management" }] },
    { seq: 2, goal_text: "Take part in the community", objectives: [
      { seq: 1, letter: "A", objective_text: "Order at a cafe", staff_instructions: "Model once, then wait.", service_type: "cls", responsible_party: "this_agency" }] }] });
  const objs = (await admin.from("care_plan_objectives").select("id, objective_text, responsible_party, goal_id").in("goal_id",
    ((await admin.from("care_plan_goals").select("id").eq("care_plan_id", F.plan)).data || []).map((g) => g.id))).data;
  const objA = objs.find((o) => o.objective_text === "Prepare a simple meal"), objC = objs.find((o) => o.objective_text === "Order at a cafe");
  const mt = Object.fromEntries(((await admin.from("measure_types").select("id, kind").is("agency_id", null).eq("is_active", true)).data || []).map((m) => [m.kind, m.id]));
  await must(F.mgr.c, "set_objective_measures", { _objective_id: objA.id, _measures: [
    { measure_type_id: mt.yes_no_na, prompt_text: "Did Zoe take part?" },
    { measure_type_id: mt.prompt_level, prompt_text: "Highest prompt level used", options: ["Gestural", "Verbal", "Modeling", "Partial physical"] },
    { measure_type_id: mt.graded_steps, prompt_text: "Steps completed", options: ["Wash hands", "Gather ingredients", "Cook", "Clean up"] },
    { measure_type_id: mt.tally, prompt_text: "Times Zoe asked for help" },
    { measure_type_id: mt.trials, prompt_text: "Cut the vegetables", trial_count: 3 },
    { measure_type_id: mt.short_answer, prompt_text: "What did Zoe cook?" },
    { measure_type_id: mt.narrative, prompt_text: "How did the session go?" },
    { measure_type_id: mt.staff_note, prompt_text: "Remember: Zoe prefers quiet music while cooking." }] });
  await must(F.mgr.c, "set_objective_measures", { _objective_id: objC.id, _measures: [{ measure_type_id: mt.yes_no_na, prompt_text: "Did Zoe order on her own?" }] });
  F.measures = (await admin.from("objective_measures").select("id, prompt_text").eq("objective_id", objA.id)).data;
  F.objA = objA.id;
  F.auth = await must(F.mgr.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-AUTH-${RUN}`, _units_authorized: 400, _effective_date: await dbDay(-30), _expiration_date: await dbDay(60) });
  const tday = await dbDay(0);
  await must(F.mgr.c, "record_inservice_form", { _care_plan_id: F.plan, _case_manager_name: "Casey Manager", _program_lead_id: F.mgr.id, _trained_on: tday, _signed_at: await dbNow() });
  await must(F.mgr.c, "record_training_form", { _care_plan_id: F.plan, _plan_document_type: "ipos_initial", _plan_effective_date: null, _location: null, _records: [{ caregiver_id: F.G1, training_date: tday }] });
  // shifts (assigned through the real RPC; shifts.caregiver_id is derived)
  const sh = async (client, d, start, end, code, cgId) => {
    const id = await ins("shifts", "shifts", { agency_id: A, virtual_office_id: F.RX, client_id: client, order_title: `ZZ ${RUN}`, care_type_code: code, shift_date: await dbDay(d), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
    if (cgId) { const { error } = await F.mgr.c.rpc("assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: cgId, _method: "manual", _notes: "round5 fixture", _override_reason: "round5 fixture (disposable)" }); if (error) throw new Error(`assign ${d} ${start}: ${error.message}`); }
    return id; };
  F.S1 = await sh(F.CX, -1, "09:00", "10:00", "CLS0001", F.G1);            // CLS: write, save, late, submit, return, resubmit
  F.S2 = await sh(F.CX, -1, "11:00", "12:00", "RESP0001", F.G1);           // respite
  F.S3 = await sh(F.CX, 0, "00:15", "01:15", "CLS0001", F.G1);             // today, started
  F.S4 = await sh(F.CX, -3, "09:00", "10:00", "CLS0001", F.G1);            // overdue; 09:00 then 09:01 arrival in the UI
  F.S5 = await sh(F.CX, -1, "13:00", "14:00", "CLS0001", F.G2);            // another caregiver's
  F.S6 = await sh(F.CX, 9, "09:00", "10:00", "CLS0001", F.G1);             // assigned, then released (cancelled assignment)
  await must(F.mgr.c, "release_shift_assignments", { _shift_ids: [F.S6], _reason: "round5 fixture: released" });
  F.O1 = await sh(F.CX, 1, "15:00", "16:00", "CLS0001", null);             // open, bookable under enforcement
  F.O2 = await sh(F.CB, 1, "17:00", "18:00", "CLS0001", null);             // open, no authorization: not_bookable under enforcement
  return F;
}

async function teardown(F) {
  await admin.from("virtual_office").update({ compliance_enforcement_enabled: false }).in("id", ids.virtual_office);
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
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} office, ${ids.caregivers.length} caregivers, ${ids.clients.length} clients, ${ids.shifts.length} shifts → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
}

async function login(page, base, u) {
  await page.goto(`${base}/auth`); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const ctxFor = (browser, w) => browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
const storage = (page) => page.evaluate(() => { const dump = (s) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => s.key(i)).map((k) => [k, s.getItem(k)])); return { local: dump(localStorage), session: dump(sessionStorage) }; });
const openNote = async (page, base, shiftId) => { await page.goto(`${base}/caregiver/notes/${shiftId}`); await page.locator('[data-testid="caregiver-note"], [data-testid="note-refused"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(600); };
const measureBox = (page, id) => page.locator(`[data-measure="m-${id}"]`);
const noteRow = async (shiftId) => (await admin.from("progress_notes").select("id, status, units_scheduled, units_used, arrived_late, returned_reason").eq("shift_id", shiftId)).data || [];

// =============================================================================================
async function caregiverFlows(base, F, browser) {
  const ctx = await ctxFor(browser, 390); const page = await ctx.newPage();
  const consoleLines = []; page.on("console", (m) => consoleLines.push(m.text()));
  const urls = []; page.on("framenavigated", (f) => { if (f === page.mainFrame()) urls.push(f.url()); });
  const payloads = []; page.on("response", async (r) => { if (/rpc\/(get_progress_note_for_caregiver|list_my_notes_due)/.test(r.url()) && r.ok()) { try { payloads.push({ fn: r.url().split("/rpc/")[1], body: await r.json() }); } catch { /* empty */ } } });
  await login(page, base, F.cgA);
  const landing = new URL(page.url()).pathname;
  await page.locator('[data-testid="caregiver-today"]').waitFor({ timeout: 30000 }); await page.locator('[data-testid="notes-due-count"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
  const dueCount = (await page.locator('[data-testid="notes-due-count"]').innerText()).trim();
  const todayShift = await page.locator(`[data-shift="${F.S3}"]`).innerText().catch(() => "");
  const navTabs = await page.locator('[data-testid="caregiver-nav"] a').allInnerTexts();
  await shot(page, "today-notes-due-390"); await shot(page, "today-notes-due-390-full", true);
  rec("T1 caregiver lands on Today in the app shell (bottom nav Today · Schedule · Notes · Shifts · Profile); 'Notes due' shows the 4 open notes; today's started shift offers 'Write progress note'",
    landing === "/caregiver-dashboard" && navTabs.join(",") === "Today,Schedule,Notes,Shifts,Profile" && dueCount === "4" && /Write progress note/.test(todayShift),
    `landing ${landing}; tabs ${navTabs.join("/")}; due ${dueCount}; today's shift "${todayShift.replace(/\s+/g, " ").slice(0, 80)}"`);
  rec("T1-390 Today fits at 390px", await noHScroll(page), "no horizontal page scroll");

  // available count: eligibility-aware, enforcement off -> on
  // server truth over the same set the page uses: every open shift the caregiver can see from the DB's today (incl. the released S6) + trades
  const truth = async () => { const today = await dbDay(0);
    const open = ((await F.cgA.c.from("shifts").select("id").eq("status", "open").gte("shift_date", today)).data || []).map((x) => x.id);
    const trades = ((await F.cgA.c.rpc("get_caregiver_trade_shifts")).data || []).map((t) => t.shift_id);
    const r = (await must(F.cgA.c, "check_caregiver_shifts_eligibility", { _shift_ids: [...new Set([...open, ...trades])] })) || [];
    const name = (id) => Object.keys(F).find((k) => F[k] === id && /^[OS]\d$/.test(k)) || id.slice(0, 8);
    return Object.fromEntries(r.map((x) => [name(x.shift_id), { eligible: x.result.eligible, hard: (x.result.hard || []).map((h) => h.code) }])); };
  const uiCount = async () => { await page.reload(); await page.locator('[data-testid="available-count"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(2500); const t = await page.locator('[data-testid="available-count"]').innerText(); const m = t.match(/(\d+) shifts? you can pick up/); return m ? Number(m[1]) : 0; };
  const offTruth = await truth(); const offUi = await uiCount();
  await admin.from("virtual_office").update({ compliance_enforcement_enabled: true }).eq("id", F.RX);
  const onTruth = await truth(); const onUi = await uiCount();
  await shot(page, "today-available-enforcement-on-390");
  await admin.from("virtual_office").update({ compliance_enforcement_enabled: false }).eq("id", F.RX);
  const expect = (t) => Object.values(t).filter((x) => x.eligible === true).length;
  rec("T2 the Today count equals the server's caregiver-safe eligibility (bookable only); with enforcement on the shift without an authorization is not_bookable and is not counted",
    offUi === expect(offTruth) && onUi === expect(onTruth) && onTruth.O2.eligible === false && onTruth.O2.hard.includes("not_bookable") && onUi < offUi,
    `off: ui ${offUi} / server ${JSON.stringify(offTruth)}; on: ui ${onUi} / server ${JSON.stringify(onTruth)}`);

  // Notes tab
  await page.locator('[data-testid="caregiver-nav"] a', { hasText: "Notes" }).click(); await page.locator('[data-testid="notes-todo"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(600);
  const order = await page.locator('[data-testid="notes-todo"] [data-note-row]').evaluateAll((els) => els.map((e) => e.getAttribute("data-note-row")));
  await shot(page, "notes-tab-390", true);
  rec("T3 Notes tab lists the 4 open notes, the overdue one (3 days ago) first; another caregiver's shift is not listed",
    order.length === 4 && order[0] === F.S4 && !order.includes(F.S5), `order ${order.map((s) => Object.keys(F).find((k) => F[k] === s)).join(",")}`);
  rec("T3-390 Notes tab fits at 390px", await noHScroll(page), "no horizontal page scroll");

  // ---- CLS note ----
  const before = await storage(page);
  await openNote(page, base, F.S1);
  const blocks = await page.locator("[data-entry]").count(), pageText = await page.locator('[data-testid="caregiver-note"]').innerText();
  await shot(page, "cls-note-top-390");
  rec("N1 a CLS shift gives one block per this_agency objective (2), none for the case-management objective; goal headings, objective text and the CLS tag; Instructions for Staff collapsed",
    blocks === 2 && !/ZZ CM objective/.test(pageText) && /Goal 1: Build daily living skills/.test(pageText) && /Goal 2: Take part in the community/.test(pageText) && !/Lay out the ingredients/.test(pageText),
    `blocks ${blocks}; CM shown ${/ZZ CM objective/.test(pageText)}; instructions visible before opening ${/Lay out the ingredients/.test(pageText)}`);
  const firstEntry = page.locator("[data-entry]").first();
  await firstEntry.getByText("Instructions for Staff").click(); await page.waitForTimeout(300);
  const M = Object.fromEntries(F.measures.map((m) => [m.prompt_text, m.id]));
  await page.fill("#arrival", "09:06"); await page.fill("#location", "Zoe's kitchen"); await page.fill("#ratio", "1:1");
  await page.locator(`#notes-${(await firstEntry.getAttribute("data-entry"))}`).fill(`Used praise as reinforcer ${MARK}`);
  await measureBox(page, M["Did Zoe take part?"]).getByRole("radio", { name: "Yes" }).click();
  await measureBox(page, M["Highest prompt level used"]).locator("select").selectOption("Verbal");
  for (const s of ["1. Wash hands", "3. Cook"]) await measureBox(page, M["Steps completed"]).getByRole("checkbox", { name: s }).click();
  for (let i = 0; i < 3; i++) await measureBox(page, M["Times Zoe asked for help"]).getByRole("button", { name: "Plus one" }).click();
  await measureBox(page, M["Times Zoe asked for help"]).scrollIntoViewIfNeeded(); await shot(page, "cls-note-measure-block-390");
  const trials = measureBox(page, M["Cut the vegetables"]);
  for (const [i, v] of [[1, "Yes"], [2, "No"], [3, "N/A"]]) await trials.getByRole("radiogroup", { name: `Cut the vegetables trial ${i}` }).getByRole("radio", { name: v }).click();
  await trials.getByRole("textbox", { name: "Trial 2 note" }).fill("needed a hand");
  await trials.scrollIntoViewIfNeeded(); await shot(page, "cls-note-trials-390");
  await measureBox(page, M["Times Zoe asked for help"]).scrollIntoViewIfNeeded(); await shot(page, "cls-note-tally-390");
  await measureBox(page, M["What did Zoe cook?"]).locator("input").fill("Pasta");
  await measureBox(page, M["How did the session go?"]).locator("textarea").fill("Calm and focused.");
  await page.locator("[data-entry]").nth(1).getByRole("radio", { name: "Yes" }).click();          // Goal 2's question
  // footer above the nav; keyboard
  const geo = await page.evaluate(() => { const f = document.querySelector('[data-testid="note-footer"]')?.getBoundingClientRect(); const n = document.querySelector('[data-testid="caregiver-nav"]')?.getBoundingClientRect();
    return { footerBottom: f && Math.round(f.bottom), navTop: n && Math.round(n.top), vh: window.innerHeight, footerTop: f && Math.round(f.top) }; });
  rec("F1-390 the Save / Submit footer is visible and sits right above the bottom nav", !!geo.footerBottom && geo.footerBottom <= geo.navTop + 1 && geo.footerTop > 0 && geo.navTop <= geo.vh, JSON.stringify(geo));
  await page.getByRole("button", { name: "Save", exact: true }).click(); await page.waitForTimeout(2500);
  const n1 = await noteRow(F.S1);
  const ent = (await admin.from("progress_note_entries").select("data, notes_text, objective_id").eq("progress_note_id", n1[0].id)).data.find((e) => e.objective_id === F.objA);
  const late = await page.locator('[data-testid="late-arrival"]').isVisible().catch(() => false);
  const bodyNow = await page.locator("body").innerText();
  rec("N2 explicit Save stores header + every answer shape the server accepts (yes/no, prompt level, steps, tally 3, trials, short, narrative; staff note not answerable); arrival 09:06 is late: 'Late arrival recorded' shows, and (S12) 'Units to bill: N of M (late arrival ...)' equals the stored units",
    n1.length === 1 && ent.data[M["Did Zoe take part?"]]?.value === "Yes" && ent.data[M["Highest prompt level used"]]?.value === "Verbal" && JSON.stringify(ent.data[M["Steps completed"]]?.steps) === "[0,2]"
      && ent.data[M["Times Zoe asked for help"]]?.count === 3 && ent.data[M["Cut the vegetables"]]?.trials?.length === 3 && ent.data[M["What did Zoe cook?"]]?.value === "Pasta"
      && !(M["Remember: Zoe prefers quiet music while cooking."] in ent.data) && n1[0].arrived_late && late && new RegExp(`Units to bill: ${n1[0].units_used} of ${n1[0].units_scheduled} \\(late arrival`).test(bodyNow),
    `notes ${n1.length}; answers ${Object.keys(ent.data).length}; late ${n1[0].arrived_late} (UI ${late}); units ${n1[0].units_scheduled} -> ${n1[0].units_used}; "unit" on page ${/\bunits?\b/i.test(bodyNow)}`);
  // autosave
  await page.fill("#location", "Zoe's kitchen (autosaved)"); await page.waitForTimeout(4500);
  const auto = (await admin.from("progress_notes").select("location").eq("id", n1[0].id).single()).data.location;
  rec("N3 debounced autosave writes the change without pressing Save", auto === "Zoe's kitchen (autosaved)", `location "${auto}"`);
  // network failure -> Not saved — retry
  await page.route("**/rest/v1/rpc/save_progress_note_draft", (r) => r.abort("failed"));
  await page.getByRole("button", { name: "Save", exact: true }).click(); await page.locator('[data-testid="not-saved-banner"]').waitFor({ timeout: 10000 });
  const banner = await page.locator('[data-testid="not-saved-banner"]').innerText();
  await page.locator('[data-testid="not-saved-banner"]').scrollIntoViewIfNeeded(); await shot(page, "cls-note-not-saved-390");
  await page.unroute("**/rest/v1/rpc/save_progress_note_draft");
  await page.getByRole("button", { name: "Retry" }).click(); await page.waitForTimeout(2500);
  const bannerGone = (await page.locator('[data-testid="not-saved-banner"]').count()) === 0;
  rec("N4 a network failure shows 'Not saved — retry'; Retry saves and clears it", /Not saved — retry/.test(banner) && bannerGone, `banner "${banner.replace(/\s+/g, " ").slice(0, 60)}"; cleared ${bannerGone}`);
  // keyboard: focus a field, shrink the viewport like an on-screen keyboard, Submit must stay visible
  await page.locator("#location").focus(); await page.setViewportSize({ width: 390, height: 480 }); await page.waitForTimeout(500);
  const kb = await page.evaluate(() => { const b = document.querySelector('[data-testid="open-submit"]')?.getBoundingClientRect(); return b ? { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight } : null; });
  await shot(page, "cls-note-keyboard-390");
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  rec("F2-390 with a field focused and the viewport reduced to 480px (on-screen keyboard), Submit stays inside the visible area", !!kb && kb.top >= 0 && kb.bottom <= kb.vh, JSON.stringify(kb));
  rec("N-390 note page fits at 390px", await noHScroll(page), "no horizontal page scroll");
  // submit
  await page.locator('[data-testid="open-submit"]').click(); await page.locator('[data-testid="submit-sheet"]').waitFor(); await page.waitForTimeout(500);
  await page.fill("#sig", "Ana Caregiver"); await shot(page, "submit-sheet-390");
  await page.locator('[data-testid="confirm-submit"]').click(); await page.locator('[data-testid="readonly-banner"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
  const disabledInputs = await page.locator("#arrival").isDisabled();
  await shot(page, "read-only-submitted-390");
  await openNote(page, base, F.S1);
  const n2 = await noteRow(F.S1); const stillRo = await page.locator('[data-testid="readonly-banner"]').isVisible();
  rec("N5 submit (typed name, attestation, server time) -> read only; opening again shows the same note read only and creates no second note",
    n2.length === 1 && n2[0].status === "submitted" && disabledInputs && stillRo && (await page.locator('[data-testid="note-footer"]').count()) === 0, `notes ${n2.length} ${n2[0].status}; inputs disabled ${disabledInputs}; read only on reopen ${stillRo}`);
  // returned -> edit -> resubmit
  await must(F.mgr.c, "return_progress_note", { _note_id: n2[0].id, _reason: "Please add which reinforcers worked best." });
  await openNote(page, base, F.S1);
  const rb = await page.locator('[data-testid="returned-banner"]').innerText();
  await shot(page, "returned-banner-390");
  await page.locator("[data-entry] textarea").first().fill(`Praise and a sticker worked best ${MARK}`);
  await page.locator('[data-testid="open-submit"]').click(); await page.locator('[data-testid="submit-sheet"]').waitFor(); await page.fill("#sig", "Ana Caregiver");
  await page.locator('[data-testid="confirm-submit"]').click(); await page.locator('[data-testid="readonly-banner"]').waitFor({ timeout: 20000 });
  const n3 = await noteRow(F.S1);
  rec("N6 a returned note shows the reviewer's reason, is editable again and resubmits", /Please add which reinforcers worked best/.test(rb) && n3[0].status === "submitted", `banner "${rb.replace(/\s+/g, " ").slice(0, 70)}"; status ${n3[0].status}`);

  // ---- respite ----
  await openNote(page, base, F.S2);
  const kind = await page.locator('[data-testid="caregiver-note"]').getAttribute("data-note-kind"), respBlocks = await page.locator("[data-entry]").count();
  await shot(page, "respite-note-390");
  await page.locator('[data-testid="open-submit"]').click(); await page.locator('[data-testid="submit-sheet"]').waitFor(); await page.fill("#sig", "Ana Caregiver");
  const blocked = await page.locator('[data-testid="confirm-submit"]').isDisabled(), missing = await page.locator('[data-testid="submit-missing"]').innerText().catch(() => "");
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Save", exact: true }).click(); await page.waitForTimeout(2000);   // arrival saved, narrative still empty
  const emptyRpc = await F.cgA.c.rpc("submit_progress_note", { _note_id: (await noteRow(F.S2))[0].id, _typed_signature: "Ana Caregiver" });
  await page.fill("#narrative", "We baked bread and went for a short walk.");
  await page.locator('[data-testid="open-submit"]').click(); await page.locator('[data-testid="submit-sheet"]').waitFor(); await page.fill("#sig", "Ana Caregiver");
  await page.locator('[data-testid="confirm-submit"]').click(); await page.locator('[data-testid="readonly-banner"]').waitFor({ timeout: 20000 });
  rec("N7 respite: narrative only (no objective blocks); it can't submit empty (UI blocks, the server refuses too); with the narrative it submits",
    kind === "respite" && respBlocks === 0 && blocked && /session narrative/.test(missing) && /session narrative/.test(emptyRpc.error?.message || "") && (await noteRow(F.S2))[0].status === "submitted",
    `kind ${kind}; blocks ${respBlocks}; UI blocked ${blocked}; server "${(emptyRpc.error?.message || "ACCEPTED").slice(0, 50)}"`);

  // ---- 09:01 arrival (no grace period, Oct 6: one minute late loses the first unit), typed in the UI ----
  await openNote(page, base, F.S4);
  await page.fill("#arrival", "09:00"); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.waitForTimeout(2500);
  const s4on = (await noteRow(F.S4))[0]; const s4onLate = await page.locator('[data-testid="late-arrival"]').count();
  await page.fill("#arrival", "09:01"); await page.getByRole("button", { name: "Save", exact: true }).click(); await page.waitForTimeout(2500);
  const s4n = (await noteRow(F.S4))[0]; const s4late = await page.locator('[data-testid="late-arrival"]').isVisible(); const s4text = await page.locator("body").innerText();
  rec("N8 no grace period: arrival 09:00 bills in full with no late notice; 09:01 (typed in the time field) gives units_used = scheduled - 1 in the DB; the UI shows 'Late arrival recorded' and (S12) 'Units to bill: N-1 of N (late arrival ...)'",
    !s4on.arrived_late && s4on.units_used === s4on.units_scheduled && s4onLate === 0 && s4n.arrived_late && s4n.units_used === s4n.units_scheduled - 1 && s4late && new RegExp(`Units to bill: ${s4n.units_used} of ${s4n.units_scheduled} \\(late arrival`).test(s4text),
    `09:00 ${s4on.units_scheduled} -> ${s4on.units_used}; 09:01 ${s4n.units_scheduled} -> ${s4n.units_used}; UI late ${s4late}`);

  // ---- another caregiver's shift ----
  await openNote(page, base, F.S5);
  const refused = await page.locator('[data-testid="note-refused"]').innerText().catch(() => "");
  rec("N9 another caregiver's shift URL shows the generic refusal and creates nothing", /can't open this note, or it wasn't found/.test(refused) && (await noteRow(F.S5)).length === 0, `"${refused.trim()}"`);

  // ---- payload keys (R5) ----
  const notePayloads = payloads.filter((p) => p.fn.startsWith("get_progress_note_for_caregiver")).map((p) => p.body);
  const keysOk = notePayloads.length > 0 && notePayloads.every((v) => Object.keys(v).sort().join(",") === "entries,note" && Object.keys(v.note).sort().join(",") === NOTE_KEYS
    && v.entries.every((e) => Object.keys(e).sort().join(",") === ENTRY_KEYS && e.measures.every((m) => Object.keys(m).sort().join(",") === MEASURE_KEYS)));
  const listPayloads = payloads.filter((p) => p.fn.startsWith("list_my_notes_due")).map((p) => p.body);
  const listOk = listPayloads.length > 0 && listPayloads.every((l) => l.every((x) => Object.keys(x).sort().join(",") === ITEM_KEYS));
  rec("P1 every note payload the page received has exactly the R5 keys (note / entries / measures); every notes-due payload has exactly its 13 keys", keysOk && listOk, `${notePayloads.length} note payloads, ${listPayloads.length} list payloads; note keys ${keysOk}; list keys ${listOk}`);

  // ---- no PHI in storage, URLs, console ----
  const afterSt = await storage(page);
  const newKeys = [...Object.keys(afterSt.local).filter((k) => !(k in before.local)), ...Object.keys(afterSt.session).filter((k) => !(k in before.session))];
  const values = JSON.stringify(afterSt);
  const urlLeak = urls.filter((u) => u.includes(MARK) || /Notewriter|Zoe/.test(decodeURIComponent(u)));
  const consoleLeak = consoleLines.filter((l) => l.includes(MARK) || /Notewriter|reinforcer/i.test(l));
  rec("S1 nothing written to localStorage / sessionStorage by the note (no new keys; no stored value contains the typed note text or the client's name); URLs carry only ids; nothing in the console",
    newKeys.length === 0 && !values.includes(MARK) && !/Notewriter/.test(values) && urlLeak.length === 0 && consoleLeak.length === 0,
    `new keys ${JSON.stringify(newKeys)} (existing keys: ${Object.keys(before.local).map((k) => k.replace(/^sb-[a-z0-9]+-/, "sb-…-")).join(", ")}); mark in storage ${values.includes(MARK)}; url leaks ${urlLeak.length}; console leaks ${consoleLeak.length}`);

  // ---- Notes tab after the flows (history) ----
  await page.goto(`${base}/caregiver/notes`); await page.locator('[data-testid="notes-history"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
  await shot(page, "notes-tab-history-390", true);
  await ctx.close();

  // ---- Schedule (existing page in the shell): released shift hidden; no Assign in the shift dialog ----
  { const c = await ctxFor(browser, 390); const p = await c.newPage();
    await login(p, base, F.cgA); await p.goto(`${base}/caregiver-schedule`); await p.getByText("Your Shifts").waitFor({ timeout: 30000 }); await p.waitForTimeout(1500);
    const upcoming = await p.getByRole("tab", { name: /Upcoming/ }).innerText();
    await p.getByRole("tab", { name: /History/ }).click(); await p.waitForTimeout(500);
    const cards = p.locator('[role="tabpanel"] .cursor-pointer'); let assignBtn = -1;
    if (await cards.count()) { await cards.first().click(); await p.locator('[role="dialog"]').waitFor({ timeout: 10000 }); assignBtn = await p.locator('[role="dialog"]').getByRole("button", { name: /Assign Caregiver/ }).count(); }
    await shot(p, "schedule-shift-dialog-390");
    rec("D1 Schedule (existing page, now in the shell): the released (cancelled) assignment is not listed; a caregiver's shift dialog has no 'Assign Caregiver' button",
      /Upcoming \(0\)/.test(upcoming) && assignBtn === 0, `"${upcoming.trim()}"; assign buttons in dialog ${assignBtn}`);
    const wide = await p.evaluate(() => { const w = document.documentElement.clientWidth;
      return ["sw=" + document.documentElement.scrollWidth, ...[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== "fixed")
        .slice(0, 5).map((e) => e.tagName.toLowerCase() + "." + String(e.className).split(" ").slice(0, 3).join(".") + " right=" + Math.round(e.getBoundingClientRect().right))]; });
    const fit = await noHScroll(p);
    rec("D1-390 Schedule page fits at 390px", fit, fit ? "no horizontal page scroll" : wide.join(" | "));
    await c.close(); }
}

async function desktop(base, F, browser) {
  const c = await ctxFor(browser, 1440); const p = await c.newPage();
  await login(p, base, F.cgA); await p.locator('[data-testid="notes-due-count"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(1500);
  await shot(p, "today-notes-due-1440");
  await p.goto(`${base}/caregiver/notes`); await p.locator('[data-testid="caregiver-notes"]').waitFor(); await p.waitForTimeout(800); await shot(p, "notes-tab-1440", true);
  await openNote(p, base, F.S3); await shot(p, "cls-note-top-1440");
  const n = (await noteRow(F.S1))[0];
  await must(F.mgr.c, "return_progress_note", { _note_id: n.id, _reason: "One more detail on the trials, please." });
  await openNote(p, base, F.S1); await shot(p, "returned-banner-1440");
  const ok1440 = await noHScroll(p) && (await p.locator('[data-testid="returned-banner"]').isVisible());
  rec("W-1440 the caregiver app works at 1440 (Today, Notes, note page, returned banner; no horizontal scroll)", ok1440, "");
  await c.close();
}

async function access(base, F, browser) {
  // dual role: staff UI + caregiver app
  { const c = await ctxFor(browser, 1440); const p = await c.newPage();
    await login(p, base, F.dual); const landing = new URL(p.url()).pathname;
    await p.goto(`${base}/schedule`); await p.waitForTimeout(4000); const staffPath = new URL(p.url()).pathname;
    await p.goto(`${base}/caregiver-dashboard`); await p.locator('[data-testid="caregiver-today"]').waitFor({ timeout: 30000 }).catch(() => {}); const today = await p.locator('[data-testid="caregiver-today"]').count();
    await p.goto(`${base}/caregiver/notes`); await p.locator('[data-testid="caregiver-notes"]').waitFor({ timeout: 30000 }).catch(() => {}); const notes = await p.locator('[data-testid="caregiver-notes"]').count();
    await shot(p, "dual-role-caregiver-app-1440");
    rec("R1 the dual-role user (manager + linked caregiver record) reaches the staff UI and the caregiver app", landing === "/dashboard" && staffPath === "/schedule" && today === 1 && notes === 1, `landing ${landing}; /schedule -> ${staffPath}; Today ${today}; Notes ${notes}`);
    await c.close(); }
  // manager without a caregiver record: every caregiver route sends them home
  { const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, F.mgr); const out = [];
    for (const r of ["/caregiver-dashboard", "/caregiver-schedule", "/caregiver/notes", `/caregiver/notes/${F.S1}`, "/available-shifts", "/caregiver-time-off", "/caregiver-settings"]) {
      await p.goto(`${base}${r}`); await p.waitForTimeout(3500); out.push(`${r} -> ${new URL(p.url()).pathname}`); }
    rec("R2 a manager without a caregiver record is sent to /dashboard from all 7 caregiver routes (RequireCaregiverRecord)", out.every((x) => x.endsWith("-> /dashboard")), out.join("; "));
    await c.close(); }
  // logged out -> /auth?next=
  { const c = await ctxFor(browser, 1440); const p = await c.newPage(); await p.goto(`${base}/caregiver/notes/${F.S1}`); await p.waitForTimeout(3000);
    const u = new URL(p.url()); rec("R3 logged out: a note URL goes to /auth?next=<that path>", u.pathname === "/auth" && u.searchParams.get("next") === `/caregiver/notes/${F.S1}`, `${u.pathname}${u.search}`); await c.close(); }
  // sign out from Profile
  { const c = await ctxFor(browser, 390); const p = await c.newPage(); await login(p, base, F.cgB);
    await p.locator('[data-testid="caregiver-nav"] a', { hasText: "Profile" }).click(); await p.locator('[data-testid="caregiver-sign-out"]').waitFor({ timeout: 30000 });
    await shot(p, "profile-sign-out-390", true); await p.locator('[data-testid="caregiver-sign-out"]').click(); await p.waitForURL(/\/auth/, { timeout: 15000 });
    rec("R4 Profile has Time off and Sign out; Sign out returns to /auth", /\/auth/.test(p.url()), new URL(p.url()).pathname); await c.close(); }
}

async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: Ripple-X (module on, go-live -10 d); aa, manager, hr, caregivers Ana (record) / Ben (record), dual manager+caregiver (record); client Zoe with a 2-goal plan (+ CM objective), 8 measure kinds, authorization; shifts S1-S6 assigned (S6 released), open O1 (bookable) / O2 (no authorization)`);
    const browser = await chromium.launch();
    try { await caregiverFlows(base, F, browser); await desktop(base, F, browser); await access(base, F, browser); } finally { await browser.close(); }
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

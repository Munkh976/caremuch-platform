// Ripple UI round 6 (S8: staff note review + print) — browser acceptance on DEV with real logins.
// Usage: node tests/ripple/ui/round6.cjs > some.log 2>&1   (never pipe a DEV suite; see README)
// Disposable fixtures. Screenshots go to Ripple, so on-screen names are readable ("Zoe N.", "Ana Rivera",
// "Bren Miller"): the run tag is kept where cleanup-orphans looks for it but S8 screens don't show it
// (client last names: S8 shows first name + last initial; user / caregiver emails; the office name).
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round6");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui6-${Date.now().toString(36)}`;
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

async function setup() {
  const F = {};
  F.RX = await ins("virtual_office", "virtual_office", { agency_id: A, name: `Ripple Effects Portage ${RUN}`, is_demo: true });
  F.RY = await ins("virtual_office", "virtual_office", { agency_id: A, name: `Ripple Effects Kalamazoo ${RUN}`, is_demo: true });
  F.aa = await mkUser("aa", ["agency_admin"], null, false, "Pat Admin");
  F.mgr = await mkUser("mgr", ["manager"], F.RX, true, "Bren Miller");
  F.mgrY = await mkUser("mgry", ["manager"], F.RY, true, "Kim Young");
  F.hr = await mkUser("hr", ["hr_staff"], F.RX, true, "Hana Reed");
  F.sch = await mkUser("sch", ["scheduler"], F.RX, true, "Sam Cole");
  F.cgA = await mkUser("cga", ["caregiver"], F.RX, false, "Ana Rivera");
  F.cl = await mkUser("cl", ["client"], F.RX, false, "Zoe Client");
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  for (const o of [F.RX, F.RY]) await must(F.aa.c, "seed_office_care_plan_defaults", { _office_id: o });
  ids.credTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 10 * 864e5).toISOString() }).in("id", [F.RX, F.RY]);
  F.G1 = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, user_id: F.cgA.id, first_name: "Ana", last_name: "Rivera", email: `sec-ana${SUFFIX}`, phone: "555-0100", is_demo: true });
  await admin.from("caregiver_skills").insert([{ caregiver_id: F.G1, care_type_code: "CLS0001", is_demo: true }, { caregiver_id: F.G1, care_type_code: "RESP0001", is_demo: true }]);
  const cl = (first, last, user = null) => ins("clients", "clients", { agency_id: A, virtual_office_id: F.RX, user_id: user, first_name: first, last_name: `${last} ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.CX = await cl("Zoe", "Nolan", F.cl.id); F.CR = await cl("Max", "Ortiz");
  await admin.from("clients").update({ case_number: "ISK-00123" }).eq("id", F.CX);
  F.plan = await must(F.mgr.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(330) } });
  await must(F.mgr.c, "upsert_care_plan_goals", { _care_plan_id: F.plan, _goals: [
    { seq: 1, goal_text: "Build daily living skills", objectives: [{ seq: 1, letter: "A", objective_text: "Prepare a simple meal", staff_instructions: "Lay out the ingredients first. Praise each step.", service_type: "cls", responsible_party: "this_agency" }] },
    { seq: 2, goal_text: "Take part in the community", objectives: [{ seq: 1, letter: "A", objective_text: "Order at a cafe", staff_instructions: "Model once, then wait.", service_type: "cls", responsible_party: "this_agency" }] }] });
  const objs = (await admin.from("care_plan_objectives").select("id, objective_text").in("goal_id", ((await admin.from("care_plan_goals").select("id").eq("care_plan_id", F.plan)).data || []).map((g) => g.id))).data;
  const mt = Object.fromEntries(((await admin.from("measure_types").select("id, kind").is("agency_id", null).eq("is_active", true)).data || []).map((m) => [m.kind, m.id]));
  F.objA = objs.find((o) => o.objective_text === "Prepare a simple meal").id; F.objC = objs.find((o) => o.objective_text === "Order at a cafe").id;
  await must(F.mgr.c, "set_objective_measures", { _objective_id: F.objA, _measures: [
    { measure_type_id: mt.yes_no_na, prompt_text: "Did Zoe take part?" },
    { measure_type_id: mt.prompt_level, prompt_text: "Highest prompt level used", options: ["Gestural", "Verbal", "Modeling", "Partial physical"] },
    { measure_type_id: mt.tally, prompt_text: "Times Zoe asked for help" },
    { measure_type_id: mt.trials, prompt_text: "Cut the vegetables", trial_count: 2 },
    { measure_type_id: mt.staff_note, prompt_text: "Zoe prefers quiet music while cooking." }] });
  await must(F.mgr.c, "set_objective_measures", { _objective_id: F.objC, _measures: [{ measure_type_id: mt.yes_no_na, prompt_text: "Did Zoe order on her own?" }] });
  F.auth = await must(F.mgr.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: "ISK-2026-0417", _units_authorized: 400, _effective_date: await dbDay(-30), _expiration_date: await dbDay(60) });
  const sh = async (client, d, start, end, code) => {
    const id = await ins("shifts", "shifts", { agency_id: A, virtual_office_id: F.RX, client_id: client, order_title: `Visit ${RUN}`, care_type_code: code, shift_date: await dbDay(d), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
    const { error } = await F.mgr.c.rpc("assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G1, _method: "manual", _notes: "round6 fixture", _override_reason: "round6 fixture (disposable)" });
    if (error) throw new Error(`assign ${d} ${start}: ${error.message}`); return id; };
  F.S1 = await sh(F.CX, -1, "09:00", "10:00", "CLS0001");     // CLS: return -> resubmit -> reviewed -> billed
  F.S2 = await sh(F.CR, -1, "11:00", "12:00", "RESP0001");    // respite
  F.S3 = await sh(F.CX, -1, "14:00", "15:00", "CLS0001");     // group session 1:3
  F.S4 = await sh(F.CX, -3, "09:00", "10:00", "CLS0001");     // no note: overdue, not started
  F.S5 = await sh(F.CX, -4, "09:00", "10:00", "CLS0001");     // draft past its deadline: overdue
  const gs = await must(F.mgr.c, "create_group_session", { _office_id: F.RX, _session_date: await dbDay(-1), _start_time: "14:00", _end_time: "15:00", _staff_client_ratio: "1:3", _max_clients: 3 });
  await must(F.mgr.c, "set_shift_group_session", { _shift_id: F.S3, _group_session_id: gs });
  const M = Object.fromEntries(((await admin.from("objective_measures").select("id, prompt_text").in("objective_id", [F.objA, F.objC])).data || []).map((m) => [m.prompt_text, m.id]));
  const write = async (shift, { narrative = null, ratio = "1:1", submit = true, late = false } = {}) => {
    const n = await must(F.cgA.c, "create_progress_note_for_shift", { _shift_id: shift });
    const row = (await admin.from("progress_notes").select("scheduled_start, scheduled_end").eq("id", n).single()).data;
    const ents = (await admin.from("progress_note_entries").select("id, objective_id").eq("progress_note_id", n)).data || [];
    const data = (o) => o === F.objA ? { [M["Did Zoe take part?"]]: { value: "Yes" }, [M["Highest prompt level used"]]: { value: "Verbal" }, [M["Times Zoe asked for help"]]: { count: 2 },
      [M["Cut the vegetables"]]: { trials: [{ value: "Yes" }, { value: "No", text: "needed a hand" }] } } : { [M["Did Zoe order on her own?"]]: { value: "Yes" } };
    await must(F.cgA.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: new Date(Date.parse(row.scheduled_start) + (late ? 420000 : 0)).toISOString(), actual_end: row.scheduled_end, location: "Zoe's kitchen", staff_client_ratio: ratio },
      _entries: ents.map((e) => ({ entry_id: e.id, notes_text: e.objective_id === F.objA ? "Zoe chopped carrots with light help. Praise and a sticker worked." : "Ordered a hot chocolate.", data: data(e.objective_id) })), _narrative_text: narrative });
    if (submit) await must(F.cgA.c, "submit_progress_note", { _note_id: n, _typed_signature: "Ana Rivera" });
    return n; };
  F.N1 = await write(F.S1, { late: true }); F.N2 = await write(F.S2, { narrative: "Max and I baked bread, then took a short walk to the park. He was relaxed and chatty." });
  F.N3 = await write(F.S3, { ratio: "1:3" }); F.N5 = await write(F.S5, { submit: false });
  return F;
}

async function teardown(F) {
  for (const id of ids.clients) {
    for (const { id: n } of (await admin.from("progress_notes").select("id").eq("client_id", id)).data || []) await admin.from("events").delete().eq("subject_id", n);
    await admin.from("progress_notes").delete().eq("client_id", id);
  }
  for (const o of ids.virtual_office) { for (const { id: b } of (await admin.from("billing_batches").select("id").eq("virtual_office_id", o)).data || []) await admin.from("events").delete().eq("subject_id", b);
    await admin.from("billing_batches").delete().eq("virtual_office_id", o); }
  for (const id of ids.shifts) { await admin.from("shift_assignments").delete().eq("shift_id", id); await admin.from("events").delete().eq("subject_id", id); await admin.from("shifts").delete().eq("id", id); }
  for (const o of ids.virtual_office) await admin.from("group_sessions").delete().eq("virtual_office_id", o);
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
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} offices, ${ids.caregivers.length} caregiver, ${ids.clients.length} clients, ${ids.shifts.length} shifts → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
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
const status = async (n) => (await admin.from("progress_notes").select("status").eq("id", n).single()).data.status;
const openDetail = async (page, base, n) => { await page.goto(`${base}/progress-notes/${n}`); await page.locator('[data-testid="staff-note"], [data-testid="note-denied"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(800); };
const openQueue = async (page, base, q = "") => { await page.goto(`${base}/progress-notes${q}`); await page.locator('[data-testid="notes-queue"]:visible, [data-testid="notes-queue-cards"]:visible, [data-testid="queue-empty"]:visible').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1200); };
const queueIds = (page, mobile) => page.locator(`[data-testid="${mobile ? "notes-queue-cards" : "notes-queue"}"] [data-queue-row]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-queue-row")));

// =============================================================================================
async function managerFlows(base, F, browser) {
  const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage();
  const urls = []; page.on("framenavigated", (f) => { if (f === page.mainFrame()) urls.push(f.url()); });
  await login(page, base, F.mgr);
  await page.locator('[data-testid="notes-review-panel"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
  const panel = { review: (await page.locator('[data-testid="panel-to-review"]').innerText()).trim(), overdue: (await page.locator('[data-testid="panel-overdue"]').innerText()).trim() };
  const menu = await page.locator("aside a", { hasText: "Notes to Review" }).first().innerText().catch(() => "");
  await shot(page, "dashboard-panel-1440");
  rec("P1 manager dashboard: 'Notes to review' 3 and 'Overdue notes' 2; the menu has 'Notes to Review' under Client Care Plans with a badge of 3",
    panel.review === "3" && panel.overdue === "2" && /Notes to Review/.test(menu) && /3/.test(menu), `panel ${JSON.stringify(panel)}; menu "${menu.replace(/\s+/g, " ")}"`);
  // queue
  await openQueue(page, base);
  const q0 = await queueIds(page, false);
  const qText = await page.locator('[data-testid="notes-queue"]').innerText();
  await shot(page, "queue-1440");
  rec("Q1 queue (default Submitted): the 3 submitted notes oldest first (CLS 9:00, respite 11:00, group 2:00); client 'Zoe N.' / 'Max O.', caregiver, late flag, units 4 → 3 on the late visit",
    q0.join(",") === [F.N1, F.N2, F.N3].join(",") && /Zoe N\./.test(qText) && /Max O\./.test(qText) && /Ana Rivera/.test(qText) && /Late/.test(qText) && /4 → 3/.test(qText) && !new RegExp(RUN).test(qText),
    `order ${q0.map((x) => Object.keys(F).find((k) => F[k] === x)).join(",")}; tag on screen ${new RegExp(RUN).test(qText)}`);
  await page.locator('[data-filter="overdue"]').click(); await page.waitForTimeout(600);
  const q1 = await queueIds(page, false), q1Text = await page.locator('[data-testid="notes-queue"]').innerText();
  await shot(page, "queue-overdue-1440");
  rec("Q2 Overdue filter: the visit without a note (3 days ago) and the draft past its deadline (4 days ago), both marked Overdue",
    q1.length === 2 && q1.includes(`shift:${F.S4}`) && q1.includes(F.N5) && (q1Text.match(/Overdue/g) || []).length >= 2 && /Not started/.test(q1Text) && /No note yet/.test(q1Text), q1.join(", "));
  await page.locator('[data-filter="submitted"]').click(); await page.waitForTimeout(500);
  // detail (CLS) -> return
  await page.locator(`[data-testid="notes-queue"] [data-queue-row="${F.N1}"] a`, { hasText: "Open" }).click(); await page.locator('[data-testid="staff-note"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
  const det = await page.locator("main").innerText();
  await shot(page, "detail-cls-1440", true);
  rec("D1 CLS detail: header (client, service, visit, caregiver, arrival with Late, end, location, ratio, case number), units 4 / 3 and the FIFO authorization, goals and objectives in IPOS order with Instructions, Notes and every answer; read only (no inputs)",
    /Zoe N\./.test(det) && /Late arrival/.test(det) && /Zoe's kitchen/.test(det) && /ISK-00123/.test(det) && /ISK-2026-0417/.test(det) && /Authorization \(FIFO, at review\)/i.test(det)
      && det.indexOf("Goal 1: Build daily living skills") < det.indexOf("Goal 2: Take part in the community") && /Lay out the ingredients/.test(det) && /Praise and a sticker/.test(det)
      && /1: Yes; 2: No \(needed a hand\)/.test(det) && /Verbal/.test(det) && (await page.locator('[data-testid="staff-note"] input, [data-testid="staff-note"] textarea, [data-entry] input, [data-entry] textarea').count()) === 0,
    `auth ${/ISK-2026-0417/.test(det)}; trials ${/1: Yes; 2: No/.test(det)}`);
  await page.locator('[data-testid="open-return"]').click(); await page.locator('[data-testid="return-dialog"]').waitFor();
  await page.fill("#return-reason", "Too short"); await page.waitForTimeout(200);
  const shortDisabled = await page.locator('[data-testid="confirm-return"]').isDisabled(), hint = await page.locator('[data-testid="return-hint"]').innerText();
  await shot(page, "return-dialog-short-1440");
  await page.fill("#return-reason", REASON); await page.waitForTimeout(200);
  await shot(page, "return-dialog-1440");
  await page.locator('[data-testid="confirm-return"]').click(); await page.waitForTimeout(3000);
  if (!(await page.locator('[data-testid="detail-returned"]').count())) {
    const dlg = await page.locator('[data-testid="return-dialog"]').innerText().catch(() => "(dialog closed)");
    await shot(page, "debug-after-return-1440");
    log(`DEBUG after Return: DB status ${await status(F.N1)}; dialog "${dlg.replace(/\s+/g, " ").slice(0, 200)}"`);
  }
  await page.locator('[data-testid="detail-returned"]').waitFor({ timeout: 15000 }); await page.waitForTimeout(600);
  rec("A1 Return: the reason needs 10+ characters (button disabled, hint '9/10'); with the reason the note is Returned (DB) and the detail shows the reason",
    shortDisabled && /\(9\/10\)/.test(hint) && (await status(F.N1)) === "returned" && /reinforcers worked best/.test(await page.locator('[data-testid="detail-returned"]').innerText()), `disabled ${shortDisabled}; hint "${hint}"`);
  await ctx.close();

  // caregiver: Returned banner -> edit -> resubmit (S7 page)
  { const c = await ctxFor(browser, 390); const p = await c.newPage();
    await login(p, base, F.cgA); await p.goto(`${base}/caregiver/notes/${F.S1}`); await p.locator('[data-testid="returned-banner"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(600);
    const banner = await p.locator('[data-testid="returned-banner"]').innerText();
    await shot(p, "caregiver-returned-banner-390");
    await p.locator("[data-entry] textarea").first().fill("Zoe chopped carrots with light help. Praise and a sticker worked best; music helped her focus.");
    await p.locator('[data-testid="open-submit"]').click(); await p.locator('[data-testid="submit-sheet"]').waitFor(); await p.fill("#sig", "Ana Rivera");
    await p.locator('[data-testid="confirm-submit"]').click(); await p.locator('[data-testid="readonly-banner"]').waitFor({ timeout: 20000 });
    rec("C1 the caregiver sees the reason on the Returned banner, edits and resubmits", /reinforcers worked best/.test(banner) && (await status(F.N1)) === "submitted", `banner "${banner.replace(/\s+/g, " ").slice(0, 70)}"`);
    await c.close(); }

  // manager: history, Mark reviewed, respite, group, print, client tab
  const ctx2 = await ctxFor(browser, 1440); const p2 = await ctx2.newPage();
  p2.on("framenavigated", (f) => { if (f === p2.mainFrame()) urls.push(f.url()); });
  await login(p2, base, F.mgr); await openDetail(p2, base, F.N1);
  const hist = await p2.locator('[data-testid="note-history"]').innerText();
  await p2.locator('[data-testid="mark-reviewed"]').click(); await p2.waitForTimeout(2500);
  const afterRev = await p2.locator('[data-testid="staff-note"]').innerText(), actionsLeft = await p2.locator('[data-testid="note-actions"]').count();
  await shot(p2, "reviewed-1440", true);
  rec("R1 history: Started, Submitted, Returned (reason, Bren Miller), Resubmitted; Mark reviewed → Reviewed, the authorization is now the one drawn from, and no actions remain (a Reviewed note is never returned)",
    /Submitted/.test(hist) && /Returned.*Bren Miller/s.test(hist) && /Reason: Please add which reinforcers/.test(hist) && /Resubmitted/.test(hist)
      && (await status(F.N1)) === "reviewed" && /Reviewed/.test(afterRev) && !/FIFO, at review/i.test(afterRev) && /ISK-2026-0417/.test(afterRev) && actionsLeft === 0,
    `history "${hist.replace(/\s+/g, " ").slice(0, 160)}"; actions left ${actionsLeft}`);
  await openDetail(p2, base, F.N2);
  const resp = await p2.locator("main").innerText(), respBlocks = await p2.locator("[data-entry]").count();
  await shot(p2, "detail-respite-1440", true);
  await openDetail(p2, base, F.N3);
  const ratio = await p2.locator('[data-testid="ratio"]').innerText();
  await shot(p2, "detail-group-1440");
  rec("D2 respite detail shows the session narrative and no objectives; the group-session note shows the ratio 1:3 (group) in the header",
    /Respite progress note/.test(resp) && /baked bread/.test(resp) && respBlocks === 0 && /1:3/.test(ratio) && /group/.test(ratio), `ratio "${ratio.replace(/\s+/g, " ")}"`);
  // print
  for (const [n, name] of [[F.N1, "print-cls-1440"], [F.N2, "print-respite-1440"]]) {
    await p2.goto(`${base}/progress-notes/${n}/print`); await p2.locator('[data-print="note"]').waitFor({ timeout: 30000 }); await p2.waitForTimeout(600);
    await shot(p2, name, true);
  }
  await p2.goto(`${base}/progress-notes/${F.N1}/print`); await p2.locator('[data-print="note"]').waitFor({ timeout: 30000 }); await p2.waitForTimeout(500);
  const secs = await p2.locator("[data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
  const pt = await p2.locator('[data-print="note"]').innerText(), chrome = await p2.locator("aside, header.sticky").count();
  await p2.emulateMedia({ media: "print" }); const toolbar = await p2.locator('[data-testid="print-toolbar"]').isVisible(); await p2.emulateMedia({ media: "screen" });
  await p2.goto(`${base}/progress-notes/${F.N2}/print`); await p2.locator('[data-print="note"]').waitFor({ timeout: 30000 });
  const secsR = await p2.locator("[data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-section"))), ptR = await p2.locator('[data-print="note"]').innerText();
  rec("PR1 print (CLS and respite): no app chrome, toolbar hidden in print; header, objectives with Instructions / Notes / Data (CLS) or the narrative (respite), billing footer (case number, units scheduled 4 / billed 3, S12 'Units not billed: 1 (late arrival)', auth number), typed signature with time, wet-signature line, program-lead review line",
    JSON.stringify(secs) === '["header","objectives","billing","signatures"]' && JSON.stringify(secsR) === '["header","narrative","billing","signatures"]' && chrome === 0 && !toolbar
      && /Instructions for Staff/i.test(pt) && /Notes \(include reinforcers\)/i.test(pt) && /ISK-00123/.test(pt) && /ISK-2026-0417/.test(pt) && /Units not billed\s+1 \(late arrival\)/i.test(pt)
      && /Signed electronically by Ana Rivera/.test(pt) && /Staff signature/i.test(pt) && /Program lead review/i.test(pt) && /baked bread/.test(ptR),
    `CLS ${secs.join(",")}; respite ${secsR.join(",")}; chrome ${chrome}; toolbar in print ${toolbar}`);
  // client care plan -> Progress Notes tab (same actions)
  await p2.goto(`${base}/care-plans/${F.CX}?tab=notes`); await p2.locator('[data-testid="client-notes-tab"]').waitFor({ timeout: 30000 }); await p2.waitForTimeout(1500);
  const tabRows = await p2.locator('[data-testid="client-notes-tab"] [data-testid="notes-queue"] [data-queue-row]').evaluateAll((els) => els.map((e) => e.getAttribute("data-queue-row")));
  await shot(p2, "client-progress-notes-tab-1440");
  await p2.locator(`[data-testid="client-notes-tab"] [data-testid="notes-queue"] [data-queue-row="${F.N3}"] [data-testid="mark-reviewed"]`).click(); await p2.waitForTimeout(2500);
  rec("T1 client care plan → Progress Notes tab lists Zoe's notes and visits (not Max's) with the same actions: Mark reviewed works from the tab",
    tabRows.includes(F.N1) && tabRows.includes(F.N3) && tabRows.includes(`shift:${F.S4}`) && !tabRows.includes(F.N2) && (await status(F.N3)) === "reviewed", `rows ${tabRows.length}`);
  // billed: locked in the UI
  const wk = await pgRead(async (c) => (await c.query(`SELECT date_trunc('week', $1::date)::date::text w`, [await dbDay(-1)])).rows[0].w);
  const bb = await must(F.mgr.c, "build_billing_batch", { _office_id: F.RX, _week_start: wk });
  await must(F.mgr.c, "approve_batch_notes", { _batch_id: bb.batch_id, _note_ids: [F.N1, F.N3] });
  await must(F.mgr.c, "mark_batch_billed", { _batch_id: bb.batch_id });
  await openDetail(p2, base, F.N1);
  const locked = await p2.locator('[data-testid="note-locked"]').count(), btns = await p2.locator('[data-testid="mark-reviewed"], [data-testid="open-return"]').count();
  await shot(p2, "billed-locked-1440");
  rec("B1 a billed note (real batch: build, approve, mark billed) shows 'Billed — locked' and no action buttons", locked === 1 && btns === 0, `locked ${locked}; buttons ${btns}`);
  const st = await storage(p2);
  await ctx2.close();
  // no PHI in URLs or storage
  const leak = urls.filter((u) => /Zoe|Nolan|Max|Ortiz|reinforcer/i.test(decodeURIComponent(u)));
  const vals = JSON.stringify(st);
  rec("S1 URLs carry only ids and filter names; browser storage holds only the auth token (no note text, names or reasons)",
    leak.length === 0 && Object.keys(st.local).every((k) => /^sb-.*-auth-token$/.test(k)) && Object.keys(st.session).length === 0 && !/reinforcers|baked bread|Nolan/.test(vals),
    `url leaks ${leak.length}; local keys ${Object.keys(st.local).map((k) => k.replace(/^sb-[a-z0-9]+-/, "sb-…-")).join(",")}; session keys ${Object.keys(st.session).length}`);
}

async function mobile(base, F, browser) {
  const c = await ctxFor(browser, 390); const p = await c.newPage();
  await login(p, base, F.mgr);
  await p.locator('[data-testid="notes-review-panel"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(1200);
  await shot(p, "dashboard-panel-390");
  await openQueue(p, base, "?status=all"); await shot(p, "queue-390", true);
  const fitQ = await noHScroll(p);
  await openDetail(p, base, F.N1); await shot(p, "detail-cls-390", true); const fitD = await noHScroll(p);
  await openDetail(p, base, F.N2); await shot(p, "detail-respite-390", true);
  await openDetail(p, base, F.N3); await shot(p, "reviewed-390", true);
  await p.goto(`${base}/progress-notes/${F.N1}/print`); await p.locator('[data-print="note"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(500);
  await shot(p, "print-cls-390", true);
  await p.goto(`${base}/progress-notes/${F.N2}/print`); await p.locator('[data-print="note"]').waitFor({ timeout: 30000 }); await p.waitForTimeout(500);
  await shot(p, "print-respite-390", true);
  rec("M1 390px: dashboard panel, queue (cards), detail and print render without horizontal page scroll", fitQ && fitD, `queue ${fitQ}; detail ${fitD}`);
  await c.close();
  // return dialog at 390 (on the respite note, cancelled: nothing changes)
  { const c2 = await ctxFor(browser, 390); const p2 = await c2.newPage(); await login(p2, base, F.mgr); await openDetail(p2, base, F.N2);
    await p2.locator('[data-testid="open-return"]').click(); await p2.locator('[data-testid="return-dialog"]').waitFor(); await p2.fill("#return-reason", REASON); await p2.waitForTimeout(300);
    await shot(p2, "return-dialog-390"); await p2.keyboard.press("Escape"); await p2.waitForTimeout(300);
    rec("M2 return dialog at 390 (cancelled: the respite note stays submitted)", (await status(F.N2)) === "submitted", "");
    await c2.close(); }
}

async function access(base, F, browser) {
  const out = [];
  for (const [u, label] of [[F.hr, "hr_staff"], [F.sch, "scheduler"], [F.cgA, "caregiver"], [F.cl, "client"]]) {
    const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, u);
    for (const r of ["/progress-notes", `/progress-notes/${F.N2}`, `/progress-notes/${F.N2}/print`]) {
      await p.goto(`${base}${r}`); await p.waitForTimeout(3500); const at = new URL(p.url()).pathname; const body = await p.locator("body").innerText();
      out.push({ label, r, at, ok: at !== r && !/baked bread/.test(body) }); }
    await c.close(); }
  rec("X1 hr_staff, scheduler, caregiver and client are redirected away from the queue, the detail and the print (RequireRole); no note content shown",
    out.every((x) => x.ok), out.filter((x) => !x.ok).map((x) => `${x.label} ${x.r} -> ${x.at}`).join("; ") || `${out.length} redirects`);
  const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, F.mgrY);
  await openDetail(p, base, F.N2); const denied = await p.locator('[data-testid="note-denied"]').count(); const body = await p.locator("body").innerText();
  rec("X2 the other office's manager gets the generic refusal on this office's note (RPC office scope)", denied === 1 && !/baked bread/.test(body), `denied card ${denied}`);
  await c.close();
}

async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: offices Portage (notes) + Kalamazoo (module on, go-live -10 d); Bren Miller (manager), Kim Young (other office), HR, scheduler, Ana Rivera (caregiver), client user; Zoe N. (2-goal plan, 5 measure kinds, ISK-2026-0417, case ISK-00123), Max O. (respite); notes: CLS late, respite, group 1:3, overdue draft, overdue no note`);
    const browser = await chromium.launch();
    try { await managerFlows(base, F, browser); await mobile(base, F, browser); await access(base, F, browser); } finally { await browser.close(); }
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

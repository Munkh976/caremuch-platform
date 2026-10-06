// Ripple UI round 7 (S9 + S9b: Weekly Billing, reopen after approval, supplementary bills) — browser acceptance on DEV with real logins.
// Usage: node tests/ripple/ui/round7.cjs > some.log 2>&1   (never pipe a DEV suite; see README)
// Disposable fixtures with readable on-screen names ("Zoe N.", "Ana Rivera"); the run tag stays in client last
// names (shown as an initial), emails and the office name, where cleanup-orphans finds it.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round7");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui7-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], shifts: [], credTypes: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const { dbNow, closeDb, pgRead } = require("../dev/lib.cjs");

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
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 40 * 864e5).toISOString() }).in("id", [F.RX, F.RY]);
  F.ws = await pgRead(async (c) => (await c.query(`SELECT (d - ((extract(isodow FROM d)::int - 1 + 7) % 7) - 7)::text ws FROM (SELECT (now() AT TIME ZONE 'America/New_York')::date d) x`)).rows[0].ws);
  F.at = async (k) => pgRead(async (c) => (await c.query(`SELECT ($1::date + $2::int)::text d`, [F.ws, k])).rows[0].d);
  F.G1 = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, user_id: F.cgA.id, first_name: "Ana", last_name: "Rivera", email: `sec-ana${SUFFIX}`, phone: "555-0100", is_demo: true });
  await admin.from("caregiver_skills").insert([{ caregiver_id: F.G1, care_type_code: "CLS0001", is_demo: true }, { caregiver_id: F.G1, care_type_code: "RESP0001", is_demo: true }]);
  const cl = (first, last, user = null) => ins("clients", "clients", { agency_id: A, virtual_office_id: F.RX, user_id: user, first_name: first, last_name: `${last} ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.CX = await cl("Zoe", "Nolan", F.cl.id); F.CR = await cl("Max", "Ortiz");
  await admin.from("clients").update({ case_number: "ISK-00123" }).eq("id", F.CX); await admin.from("clients").update({ case_number: "ISK-00456" }).eq("id", F.CR);
  await must(F.mgr.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await F.at(-30), expiration_date: await F.at(330) } });
  const authFrom = await F.at(-14);
  const auth = (client, svc, num, units, exp, period = null, cap = null) => must(F.mgr.c, "create_service_authorization", { _client_id: client, _service_type: svc, _auth_number: num, _units_authorized: units,
    _effective_date: authFrom, _expiration_date: exp, _service_code: svc === "cls" ? "H2015" : "T1005", _period_type: period, _units_per_period: cap });
  await auth(F.CX, "cls", "ISK-2026-0410", 8, await F.at(20));
  await auth(F.CX, "cls", "ISK-2026-0417", 40, await F.at(90), "per_week", 16);
  await auth(F.CR, "respite", "ISK-2026-0502", 20, await F.at(90));
  const sh = async (client, k, code, start = "09:00", end = "10:00") => {
    const id = await ins("shifts", "shifts", { agency_id: A, virtual_office_id: F.RX, client_id: client, order_title: `Visit ${RUN}`, care_type_code: code, shift_date: await F.at(k), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
    const { error } = await F.mgr.c.rpc("assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G1, _method: "manual", _notes: "round7 fixture", _override_reason: "round7 fixture (disposable)" });
    if (error) throw new Error(`assign ${k}: ${error.message}`); return id; };
  const note = async (shift, { off = 0, submit = true, narrative = null } = {}) => {
    const n = await must(F.cgA.c, "create_progress_note_for_shift", { _shift_id: shift });
    const row = (await admin.from("progress_notes").select("scheduled_start, scheduled_end").eq("id", n).single()).data;
    await must(F.cgA.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: new Date(Date.parse(row.scheduled_start) + off * 1000).toISOString(), actual_end: row.scheduled_end, location: "Zoe's kitchen", staff_client_ratio: "1:1" }, _entries: [], _narrative_text: narrative });
    if (submit) await must(F.cgA.c, "submit_progress_note", { _note_id: n, _typed_signature: "Ana Rivera" });
    return n; };
  const review = (n) => must(F.mgr.c, "review_progress_note", { _note_id: n, _billable: true, _non_billable_reason: null });
  F.S = { s1: await sh(F.CX, 0, "CLS0001"), s2: await sh(F.CX, 1, "CLS0001"), s3: await sh(F.CX, 2, "CLS0001"), s4: await sh(F.CR, 3, "RESP0001", "11:00", "12:00"),
    s5: await sh(F.CX, 4, "CLS0001"), s6: await sh(F.CX, 5, "CLS0001") };
  F.N = { n1: await note(F.S.s1), n2: await note(F.S.s2, { off: 60 }), n3: await note(F.S.s3), n4: await note(F.S.s4, { narrative: "Max and I baked bread." }), n5: await note(F.S.s5) };
  for (const k of ["n1", "n2", "n4"]) await review(F.N[k]);
  await must(F.mgr.c, "return_progress_note", { _note_id: F.N.n5, _reason: "Please add which reinforcers worked best." });
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
const ctxFor = (browser, w) => browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}), acceptDownloads: true });
const storage = (page) => page.evaluate(() => { const dump = (s) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => s.key(i)).map((k) => [k, s.getItem(k)])); return { local: dump(localStorage), session: dump(sessionStorage) }; });
const openBilling = async (page, base, q = "") => { await page.goto(`${base}/billing/weekly${q}`); await page.locator('[data-testid="week-picker"], [data-testid="billing-denied"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1200); };
const reasonOf = (page, key) => page.locator(`[data-excluded="${key}"]`).getAttribute("data-reason").catch(() => null);
const status = async (n) => (await admin.from("progress_notes").select("status").eq("id", n).single()).data.status;

// =============================================================================================
async function managerFlows(base, F, browser) {
  const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage();
  const urls = []; page.on("framenavigated", (f) => { if (f === page.mainFrame()) urls.push(f.url()); });
  const review = (n) => must(F.mgr.c, "review_progress_note", { _note_id: n, _billable: true, _non_billable_reason: null });
  await login(page, base, F.mgr);
  await page.locator('[data-testid="billing-line"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1000);
  const dash0 = await page.locator('[data-testid="billing-line"]').first().innerText();
  await shot(page, "dashboard-line-not-billed-1440");
  rec("D1 dashboard compliance area: 'Last week: not yet billed' (not built) linking to Weekly Billing", /Last week: not yet billed/.test(dash0) && /not built yet/.test(dash0), dash0.replace(/\s+/g, " "));
  await openBilling(page, base);
  const label0 = await page.locator('[data-testid="week-label"]').innerText(), st0 = await page.locator('[data-testid="batch-status"]').innerText();
  const r0 = await reasonOf(page, F.N.n1);
  rec("W0 default = the last complete week (Mon–Sun, office zone), not built; the reviewed notes show 'build the week to add it'",
    /Last complete week/.test(await page.locator('[data-testid="week-picker"]').innerText()) && /Not built/.test(st0) && r0 === "not_in_bill_yet", `${label0}; ${st0}; n1 ${r0}`);
  // build
  await page.locator('[data-testid="build-week"]').click(); await page.locator('[data-testid="batch-0-table"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1200);
  const table = await page.locator('[data-testid="batch-0-table"]').innerText();
  const approveDisabled = await page.locator('[data-testid="batch-0-approve"]').isDisabled(), blockers = await page.locator('[data-testid="batch-0-blockers"]').innerText().catch(() => "");
  await shot(page, "week-built-1440", true);
  await page.locator('[data-testid="exclusions"]').scrollIntoViewIfNeeded(); await shot(page, "exclusions-1440");
  const ex = { n3: await reasonOf(page, F.N.n3), n5: await reasonOf(page, F.N.n5), s6: await reasonOf(page, `shift:${F.S.s6}`) };
  rec("B1 Build week: the main bill groups by client then authorization (FIFO: ISK-2026-0410 takes the 09:00 + 09:01 notes, 8 / 7 / 1 lost to late arrival; respite for Max), client and bill totals; nothing unreviewed is in it",
    /Zoe N\./.test(table) && /Max O\./.test(table) && /#ISK-2026-0410/.test(table) && /#ISK-2026-0502/.test(table) && /Main bill total \(3 notes\)\s*12\s*11\s*1/.test(table) && !/ISK-2026-0417/.test(table) && !new RegExp(RUN).test(table) && /Units left now/.test(table),
    table.replace(/\s+/g, " ").slice(0, 260));
  rec("X1 Not in this week's bills: submitted (not reviewed), returned (waiting for the caregiver), a visit with no note; Approve week is disabled while a note waits for review",
    ex.n3 === "not_reviewed" && ex.n5 === "returned" && ex.s6 === "no_note" && approveDisabled && /submitted but not reviewed/.test(blockers), `${JSON.stringify(ex)}; approve disabled ${approveDisabled}; "${blockers.replace(/\s+/g, " ")}"`);
  { const c390 = await ctxFor(browser, 390); const p390 = await c390.newPage(); await login(p390, base, F.mgr); await openBilling(p390, base);
    await p390.locator('[data-testid="exclusions"]').scrollIntoViewIfNeeded(); await p390.waitForTimeout(400); await shot(p390, "exclusions-390"); await c390.close(); }
  // fix one in S8, then rebuild
  await page.locator(`[data-excluded="${F.N.n3}"] a`).click(); await page.locator('[data-testid="staff-note"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
  await page.locator('[data-testid="mark-reviewed"]').click(); await page.waitForTimeout(2500);
  await openBilling(page, base);
  const rAfterReview = await reasonOf(page, F.N.n3), disabledBeforeRebuild = await page.locator('[data-testid="batch-0-approve"]').isDisabled();
  await page.locator('[data-testid="build-week"]').click(); await page.waitForTimeout(2500);
  const table2 = await page.locator('[data-testid="batch-0-table"]').innerText();
  rec("F1 fix it in S8 (Mark reviewed) → 'build the week to add it' (Approve still disabled) → Build week again adds it on the next authorization (FIFO rollover to ISK-2026-0417, weekly cap 16)",
    rAfterReview === "not_in_bill_yet" && disabledBeforeRebuild && /#ISK-2026-0417/.test(table2) && /16 \/ week · 12 left/.test(table2) && /Main bill total \(4 notes\)\s*16\s*15\s*1/.test(table2),
    `${rAfterReview}; disabled ${disabledBeforeRebuild}; ${table2.replace(/\s+/g, " ").slice(0, 200)}`);
  // approve (confirm with totals)
  await page.locator('[data-testid="batch-0-approve"]').click(); await page.locator('[data-testid="approve-confirm"]').waitFor(); await page.waitForTimeout(400);
  const confirmText = await page.locator('[data-testid="confirm-totals"]').innerText();
  await shot(page, "approve-confirm-1440");
  await page.locator('[data-testid="confirm-approve"]').click(); await page.locator('[data-testid="batch-0-approved-banner"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(5000);
  rec("A1 Approve week: one action with a confirm showing the totals (4 notes, 16 scheduled, 15 billed, 1 lost); afterwards 'Approved … by Bren Miller'",
    /Notes\s*4/.test(confirmText) && /Units billed\s*15/.test(confirmText) && /Units lost to late arrival\s*1/.test(confirmText) && /Bren Miller/.test(await page.locator('[data-testid="batch-0-approved-banner"]').innerText()),
    confirmText.replace(/\s+/g, " "));
  // S9b (a): a note reviewed after approval -> Build week again reopens -> approve again
  await must(F.cgA.c, "submit_progress_note", { _note_id: F.N.n5, _typed_signature: "Ana Rivera" }); await review(F.N.n5);
  await openBilling(page, base);
  const rReopen = await reasonOf(page, F.N.n5), reopenLabel = await page.locator('[data-testid="build-week"]').innerText();
  await page.locator('[data-testid="build-week"]').click(); await page.waitForTimeout(2500);
  const st1 = await page.locator('[data-testid="batch-0-status"]').innerText(), table3 = await page.locator('[data-testid="batch-0-table"]').innerText();
  await shot(page, "reopened-1440", true);
  rec("S9b-A a note reviewed after approval: 'Reviewed after approval: build the week again to reopen it'; 'Build week again (reopens the approved bill)' → the main bill is open again with the note (5 notes) and must be approved again",
    rReopen === "reviewed_after_approval" && /reopens the approved bill/.test(reopenLabel) && /Built — not approved/.test(st1) && /Main bill total \(5 notes\)\s*20\s*19\s*1/.test(table3),
    `${rReopen}; "${reopenLabel}"; ${st1}; ${table3.replace(/\s+/g, " ").slice(-60)}`);
  await page.locator('[data-testid="batch-0-approve"]').click(); await page.locator('[data-testid="approve-confirm"]').waitFor(); await page.locator('[data-testid="confirm-approve"]').click();
  await page.locator('[data-testid="batch-0-approved-banner"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1500);
  // mark billed
  await page.locator('[data-testid="batch-0-mark-billed"]').click(); await page.locator('[data-testid="bill-confirm"]').waitFor(); await page.locator('[data-testid="confirm-bill"]').click();
  await page.locator('[data-testid="batch-0-billed-banner"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(5000);
  const banner = await page.locator('[data-testid="batch-0-billed-banner"]').innerText();
  const btns = await page.locator('[data-testid="batch-0"] button').allInnerTexts(), buildLeft = await page.locator('[data-testid="billing-actions"]').count();
  await shot(page, "billed-banner-1440", true);
  rec("BL1 Mark billed → 'Billed on … by Bren Miller'; the bill is read-only (only Export CSV remains; no Build while nothing waits); every note billed",
    /Billed on .* by Bren Miller/.test(banner) && btns.join(",") === "Export CSV" && buildLeft === 0 && (await status(F.N.n1)) === "billed" && (await status(F.N.n5)) === "billed", `buttons ${btns.join(",")}; build area ${buildLeft}`);
  // CSV (main)
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-testid="batch-0-export"]').click()]);
  const csv = fs.readFileSync(await dl.path(), "utf8"); const name = dl.suggestedFilename(); const lines = csv.trim().split(/\r?\n/), total = lines[lines.length - 1].split(",");
  rec("C1 Export CSV (main bill): ripple-billing-<office code>-<week start>.csv (no client names); one row per client x authorization + TOTAL equal to the table (5 notes, 20 / 19 / 1); units only",
    name === `ripple-billing-re-portage-${F.ws}.csv` && lines.length === 5 && total[4] === "TOTAL" && total.slice(-4).join(",") === "5,20,19,1" && !/Nolan|Ortiz|\$/.test(csv + name), `${name}; ${lines.length} lines; total ${total.slice(-4).join(",")}`);
  // S8 lock
  await page.goto(`${base}/progress-notes/${F.N.n1}`); await page.locator('[data-testid="staff-note"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
  const locked = await page.locator('[data-testid="note-locked"]').count(), sButtons = await page.locator('[data-testid="mark-reviewed"], [data-testid="open-return"]').count();
  rec("L1 the S8 note detail shows 'Billed — locked' and no actions", locked === 1 && sButtons === 0, `locked ${locked}; buttons ${sButtons}`);
  // S9b (b): a note reviewed after billing -> Build supplement 1 -> approve -> billed -> CSV -s1
  const n6 = await must(F.cgA.c, "create_progress_note_for_shift", { _shift_id: F.S.s6 });
  const st6 = (await admin.from("progress_notes").select("scheduled_start").eq("id", n6).single()).data.scheduled_start;
  await must(F.cgA.c, "save_progress_note_draft", { _note_id: n6, _header: { client_arrived_at: st6 }, _entries: [], _narrative_text: null });
  await must(F.cgA.c, "submit_progress_note", { _note_id: n6, _typed_signature: "Ana Rivera" }); await review(n6);
  await openBilling(page, base, `?week=${F.ws}`);
  const rSup = await reasonOf(page, n6), supLabel = await page.locator('[data-testid="build-supplement"]').innerText();
  await page.locator('[data-testid="build-supplement"]').click(); await page.locator('[data-testid="batch-1-table"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(5000);
  const sup = await page.locator('[data-testid="batch-1"]').innerText(), mainStill = await page.locator('[data-testid="batch-0-status"]').innerText();
  await shot(page, "supplement-built-1440", true);
  rec("S9b-B1 a note reviewed after billing: 'Reviewed after billing: build a supplement' + 'Build supplement 1' → Supplement 1 holds only that note (4 / 4), the main bill stays billed",
    rSup === "reviewed_after_billing" && /Build supplement 1/.test(supLabel) && /Supplement 1/.test(sup) && /Supplement 1 total \(1 note\)\s*4\s*4\s*0/.test(sup) && /Billed/.test(mainStill), `${rSup}; "${supLabel}"; main ${mainStill}`);
  await page.locator('[data-testid="batch-1-approve"]').click(); await page.locator('[data-testid="approve-confirm"]').waitFor(); await page.waitForTimeout(300);
  const supConfirm = await page.locator('[data-testid="confirm-totals"]').innerText();
  await page.locator('[data-testid="confirm-approve"]').click(); await page.locator('[data-testid="batch-1-approved-banner"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1200);
  await page.locator('[data-testid="batch-1-mark-billed"]').click(); await page.locator('[data-testid="bill-confirm"]').waitFor(); await page.locator('[data-testid="confirm-bill"]').click();
  await page.locator('[data-testid="batch-1-billed-banner"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(5000);
  const weekBadge = await page.locator('[data-testid="batch-status"]').innerText();
  await shot(page, "supplement-billed-1440", true);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.locator('[data-testid="batch-1-export"]').click()]);
  const csv2 = fs.readFileSync(await dl2.path(), "utf8"); const name2 = dl2.suggestedFilename(); const l2 = csv2.trim().split(/\r?\n/), t2 = l2[l2.length - 1].split(",");
  rec("S9b-B2 Supplement 1: approve (confirm shows Bill: Supplement 1 and its totals) → Mark billed → locked; the week reads 'Billed (main + 1 supplement)'; its CSV is …-s1.csv with its own totals (1 note, 4 / 4 / 0)",
    /Bill\s*Supplement 1/.test(supConfirm) && (await status(n6)) === "billed" && /Billed \(main \+ 1 supplement\)/.test(weekBadge) && name2 === `ripple-billing-re-portage-${F.ws}-s1.csv` && t2.slice(-4).join(",") === "1,4,4,0" && /supplement 1/.test(csv2),
    `${weekBadge}; ${name2}; total ${t2.slice(-4).join(",")}`);
  // week picker across a month boundary
  const prev = await page.locator('[data-testid="week-label"]').innerText();
  await page.getByRole("button", { name: "Previous week" }).click(); await page.waitForTimeout(1500);
  const prevLabel = await page.locator('[data-testid="week-label"]').innerText(); const prevUrl = new URL(page.url()).search;
  await page.getByRole("button", { name: "Next week" }).click(); await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Next week" }).click(); await page.waitForTimeout(1200);
  const curLabel = await page.locator('[data-testid="week-label"]').innerText(), nextDisabled = await page.getByRole("button", { name: "Next week" }).isDisabled();
  await shot(page, "week-picker-current-1440");
  rec("P1 week picker: previous / next by 7 days across the Sep/Oct boundary (office week start); the URL holds only the week date; the current week is the last one",
    prevLabel !== prev && /^\?week=\d{4}-\d{2}-\d{2}$/.test(prevUrl) && nextDisabled && curLabel !== prev, `${prev} ← ${prevLabel}; current ${curLabel}; next disabled ${nextDisabled}`);
  // dashboard after billing (main + supplement)
  await page.goto(`${base}/dashboard`); await page.locator('[data-testid="billing-line"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
  const dash1 = await page.locator('[data-testid="billing-line"]').first().innerText();
  await shot(page, "dashboard-line-billed-1440");
  rec("D2 dashboard line after the main bill and its supplement are billed: 'Last week: billed · locked (main + 1 supplement)'", /Last week: billed/.test(dash1) && /main \+ 1 supplement/.test(dash1), dash1.replace(/\s+/g, " "));
  const st = await storage(page);
  rec("S1 URLs carry only ids and the week date; storage holds only the auth token (the CSV is never stored)",
    urls.every((u) => !/Zoe|Nolan|Max|Ortiz/.test(decodeURIComponent(u))) && Object.keys(st.local).every((k) => /^sb-.*-auth-token$/.test(k)) && Object.keys(st.session).length === 0 && !/ISK-|total|csv/i.test(JSON.stringify(st)),
    `local ${Object.keys(st.local).map((k) => k.replace(/^sb-[a-z0-9]+-/, "sb-…-")).join(",")}; session ${Object.keys(st.session).length}`);
  await ctx.close();
}

async function mobile(base, F, browser) {
  const c = await ctxFor(browser, 390); const p = await c.newPage(); await login(p, base, F.mgr);
  await p.locator('[data-testid="billing-line"]').first().waitFor({ timeout: 30000 }); await p.waitForTimeout(800); await shot(p, "dashboard-line-390");
  await openBilling(p, base, `?week=${F.ws}`); await shot(p, "billed-banner-390"); await shot(p, "week-built-390", true); await shot(p, "supplement-billed-390", true);
  const fit = await noHScroll(p);
  // (exclusions-390 is taken right after the first build, while the list is populated)
  rec("M1 390px: the billed week (cards), exclusions and dashboard line render without horizontal page scroll", fit && (await p.locator('[data-testid="batch-0-cards"]').isVisible()), `fits ${fit}`);
  await c.close();
}

async function approveMobile(base, F, browser) {
  // a second, open week (the previous one) at 390 for the approve confirm: one reviewed note
  const n = await pgRead(async (c) => (await c.query(`SELECT ($1::date - 7)::text d`, [F.ws])).rows[0].d);
  const id = await ins("shifts", "shifts", { agency_id: A, virtual_office_id: F.RX, client_id: F.CR, order_title: `Visit ${RUN}`, care_type_code: "RESP0001", shift_date: n, start_time: "11:00", end_time: "12:00", duration_hours: 1, status: "open", is_demo: true });
  await must(F.mgr.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G1, _method: "manual", _notes: "round7 fixture", _override_reason: "round7 fixture (disposable)" });
  const note = await must(F.cgA.c, "create_progress_note_for_shift", { _shift_id: id });
  const st = (await admin.from("progress_notes").select("scheduled_start").eq("id", note).single()).data.scheduled_start;
  await must(F.cgA.c, "save_progress_note_draft", { _note_id: note, _header: { client_arrived_at: st }, _entries: [], _narrative_text: "Park visit." });
  await must(F.cgA.c, "submit_progress_note", { _note_id: note, _typed_signature: "Ana Rivera" });
  await must(F.mgr.c, "review_progress_note", { _note_id: note, _billable: true, _non_billable_reason: null });
  const c = await ctxFor(browser, 390); const p = await c.newPage(); await login(p, base, F.mgr);
  await openBilling(p, base, `?week=${n}`); await p.locator('[data-testid="build-week"]').click(); await p.waitForTimeout(2500);
  await p.locator('[data-testid="batch-0-approve"]').click(); await p.locator('[data-testid="approve-confirm"]').waitFor(); await p.waitForTimeout(400);
  await shot(p, "approve-confirm-390"); await p.keyboard.press("Escape");
  rec("M2 approve confirm at 390 (cancelled: the week stays open)", (await p.locator('[data-testid="batch-status"]').innerText()).includes("Built"), "");
  await c.close();
}

async function access(base, F, browser) {
  const out = [];
  for (const [u, label] of [[F.hr, "hr_staff"], [F.sch, "scheduler"], [F.cgA, "caregiver"], [F.cl, "client"]]) {
    const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, u);
    await p.goto(`${base}/billing/weekly`); await p.waitForTimeout(3500); const at = new URL(p.url()).pathname; const body = await p.locator("body").innerText();
    out.push({ label, at, ok: at !== "/billing/weekly" && !/ISK-2026/.test(body) }); await c.close(); }
  rec("R1 hr_staff, scheduler, caregiver and client are redirected away from Weekly Billing (RequireRole)", out.every((x) => x.ok), out.map((x) => `${x.label} -> ${x.at}`).join("; "));
  const c = await ctxFor(browser, 1440); const p = await c.newPage(); await login(p, base, F.mgrY); await openBilling(p, base, `?week=${F.ws}`);
  const body = await p.locator("body").innerText();
  rec("R2 the other office's manager sees only their own office's week (no Portage bill, no Zoe / Max)", !/ISK-2026-0410|Zoe N\.|Max O\./.test(body), "");
  await c.close();
}

async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: Portage (code RE-PORTAGE, module on) + Kalamazoo; Bren Miller (manager), Kim Young (other office), HR, scheduler, Ana Rivera, client user; Zoe N. (ISK-2026-0410 8 units, ISK-2026-0417 40 units cap 16/week), Max O. (respite ISK-2026-0502); last complete week ${F.ws}: 09:00, 09:01 (late), submitted, respite, returned, visit without note`);
    const browser = await chromium.launch();
    try { await managerFlows(base, F, browser); await mobile(base, F, browser); await approveMobile(base, F, browser); await access(base, F, browser); } finally { await browser.close(); }
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

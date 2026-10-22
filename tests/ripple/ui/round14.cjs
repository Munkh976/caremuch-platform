// Ripple UI round 14 (Auto-assign + office match weights, owner decision 4) — browser acceptance on DEV with real logins,
// in a disposable tagged office WITHOUT the care-plan module (never the demo office RPLDEMO).
// Usage: node tests/ripple/ui/round14.cjs > some.log 2>&1   (never pipe a DEV suite; see README)
//   A1 Unassigned → "Auto-assign…" (always visible) → its own Day / Week / Month picker → Preview: proposals with score
//      and reasons; overlapping visits on one day go to different caregivers; a visit nobody has the skill for is listed
//      under "Can't be filled" with the reason. A2 uncheck one, Assign: exactly the checked ones (auto_assigned), one
//      auto_assign_run. A3 Smart assign: ranked suggestions. W1 Virtual Offices → Scheduling: weights (total 100) saved by
//      the agency admin (audited), read-only for the manager. A4 390.
// Screenshots: docs/screenshots/ripple-ui/round14/.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round14");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui14-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], shifts: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const { dbDay, dbNow, closeDb, pgRead } = require("../dev/lib.cjs");

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
  F.KC = await ins("virtual_office", "virtual_office", { agency_id: A, name: `Kind Care Lakeside ${RUN}`, is_demo: true });
  F.aa = await mkUser("aa", ["agency_admin"], null, false, "Pat Admin");
  F.mgr = await mkUser("mgr", ["manager"], F.KC, true, "Kim Lopez");
  F.G = {};
  for (const [k, first, last, rel] of [["ana", "Ana", "Rivera", 95], ["ben", "Ben", "Ostrowski", 70]]) {
    F.G[k] = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.KC, first_name: first, last_name: `${last} ${RUN}`, email: `sec-${k}${SUFFIX}`, phone: "555-0100", reliability_score: rel, is_demo: true });
    await admin.from("caregiver_skills").insert([{ caregiver_id: F.G[k], care_type_code: "CLS0001", is_demo: true }]);
  }
  F.CX = await ins("clients", "clients", { agency_id: A, virtual_office_id: F.KC, first_name: "Omar", last_name: `Kent ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  const sh = async (k, s, e, code = "CLS0001") => ins("shifts", "shifts", { agency_id: A, virtual_office_id: F.KC, client_id: F.CX, order_title: `Visit ${RUN}`, care_type_code: code, shift_date: await dbDay(k), start_time: s, end_time: e, duration_hours: 1, status: "open", is_demo: true });
  F.d1 = await dbDay(1);
  F.sA = await sh(1, "09:00", "10:00"); F.sB = await sh(1, "09:30", "10:30"); F.sC = await sh(1, "13:00", "14:00"); F.sR = await sh(1, "15:00", "16:00", "RESP0001");
  return F;
}
async function teardown(F) {
  for (const id of ids.shifts) { await admin.from("shift_assignments").delete().eq("shift_id", id); await admin.from("events").delete().eq("subject_id", id); await admin.from("shifts").delete().eq("id", id); }
  for (const id of ids.caregivers) await admin.from("caregiver_skills").delete().eq("caregiver_id", id);
  for (const t of ["clients", "caregivers"]) for (const id of ids[t]) await admin.from(t).delete().eq("id", id);
  for (const id of ids.users) { await admin.from("user_roles").delete().eq("user_id", id); await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
  for (const id of ids.virtual_office) { await admin.from("events").delete().eq("virtual_office_id", id); await admin.from("events").delete().eq("subject_id", id); await admin.from("virtual_office").delete().eq("id", id); }
  const left = [];
  for (const [t, key] of [["clients", "clients"], ["caregivers", "caregivers"], ["virtual_office", "virtual_office"], ["shifts", "shifts"]])
    for (const id of ids[key]) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} office, ${ids.caregivers.length} caregivers, ${ids.shifts.length} shifts → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
}
async function login(page, base, u) {
  await page.goto(`${base}/auth`); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const ctxFor = async (browser, w) => { const c = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) }); c.setDefaultNavigationTimeout(60000); return c; };
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const waitPreview = (page) => page.waitForFunction(() => !!document.querySelector('[data-testid="aa-proposals"], [data-testid="aa-blocked"], [data-testid="aa-empty"]'), null, { timeout: 90000 });

async function run(base) {
  let F;
  try {
    F = await setup();
    log(`fixtures [${RUN}]: office Kind Care Lakeside (no module); Kim Lopez (manager), Pat Admin; Ana (reliability 95) and Ben (70), CLS; Omar K.: 3 CLS visits tomorrow (09:00, 09:30 overlapping, 13:00) + 1 respite nobody has the skill for`);
    const browser = await chromium.launch();
    { const w = await browser.newPage(); for (const p of ["/auth", "/schedule", "/virtual-offices"]) await w.goto(`${base}${p}`, { timeout: 120000 }).catch(() => {}); await w.close(); }
    try {
      const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage(); await login(page, base, F.mgr);
      await page.goto(`${base}/schedule?tab=unassigned`); await page.locator('[data-testid="auto-assign-button"]').waitFor({ timeout: 30000 }); await settle(page, 1500);
      await page.locator('[data-testid="auto-assign-button"]').click(); const dlg = page.locator('[data-testid="auto-assign-dialog"]'); await dlg.waitFor();
      await dlg.locator('[data-testid="aa-period"] button', { hasText: "Day" }).click(); await settle(page, 300);
      const want = new Date(`${F.d1}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      let lbl = await dlg.locator('[data-testid="aa-label"]').innerText();
      for (let i = 0; i < 3 && !lbl.includes(want); i++) { await dlg.getByRole("button", { name: "Next period" }).click(); await settle(page, 200); lbl = await dlg.locator('[data-testid="aa-label"]').innerText(); }
      await dlg.locator('[data-testid="aa-preview"]').click(); await waitPreview(page); await settle(page, 800);
      const rows = await dlg.locator('[data-testid="aa-proposal"]').evaluateAll((els) => els.map((e) => ({ shift: e.getAttribute("data-shift"), text: e.innerText.replace(/\s+/g, " ") })));
      const by = Object.fromEntries(rows.map((r) => [r.shift, r.text]));
      const who = (t) => (/Ana Rivera/.test(t || "") ? "Ana" : /Ben Ostrowski/.test(t || "") ? "Ben" : null);
      const blocked = (await dlg.locator('[data-testid="aa-blocked-row"]').allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
      await shot(page, "auto-assign-preview-1440", true);
      rec("A1 Unassigned → 'Auto-assign…' → Day picker → Preview: 3 proposals with score and reasons; the overlapping 09:00 / 09:30 visits go to different caregivers, 13:00 the same day is fine; the respite visit is under 'Can't be filled' with 'Missing care service skill'",
        rows.length === 3 && !!who(by[F.sA]) && !!who(by[F.sB]) && who(by[F.sA]) !== who(by[F.sB]) && !!who(by[F.sC]) && /%/.test(by[F.sA]) && /required care skills|Rated|New caregiver/.test(by[F.sA])
          && blocked.length === 1 && /Missing care service skill/.test(blocked[0]),
        `label "${lbl}"; ${rows.map((r) => r.text.slice(0, 70)).join(" | ")}; blocked ${blocked.join(" | ").slice(0, 120)}`);
      await dlg.locator(`[data-testid="aa-proposal"][data-shift="${F.sC}"] button[role="checkbox"]`).click(); await settle(page, 200);
      const btn = (await dlg.locator('[data-testid="aa-commit"]').innerText()).trim();
      await dlg.locator('[data-testid="aa-commit"]').click(); await dlg.waitFor({ state: "detached", timeout: 30000 }); await settle(page, 1500);
      const made = (await admin.from("shift_assignments").select("shift_id, assignment_method").in("shift_id", [F.sA, F.sB, F.sC, F.sR]).neq("status", "cancelled")).data || [];
      const runEv = ((await admin.from("events").select("payload").eq("event_type", "auto_assign_run").eq("subject_id", F.KC)).data || []);
      rec("A2 unchecking the 13:00 proposal → 'Assign 2 selected' → exactly the 09:00 and 09:30 visits are assigned (auto_assigned); one auto_assign_run (2 assigned)",
        btn === "Assign 2 selected" && made.length === 2 && made.every((m) => m.assignment_method === "auto_assigned") && made.every((m) => [F.sA, F.sB].includes(m.shift_id)) && runEv.length === 1 && runEv[0].payload.assigned === 2,
        `"${btn}"; made ${made.length}; run ${JSON.stringify(runEv[0] && runEv[0].payload).slice(0, 100)}`);
      await page.goto(`${base}/schedule?tab=unassigned`); await settle(page, 2500);
      await page.getByRole("button", { name: /Smart assign/ }).first().click(); const sheet = page.locator('[role="dialog"]').last(); await sheet.waitFor();
      await page.waitForFunction(() => !document.body.innerText.includes("Ranking caregivers..."), null, { timeout: 60000 }); await settle(page, 600);
      const st = (await sheet.innerText()).replace(/\s+/g, " "); await shot(page, "smart-assign-1440");
      rec("A3 Smart assign on a remaining visit: ranked suggestions with score and reasons (the same scoring)", /#1/.test(st) && /%/.test(st) && /(Ana Rivera|Ben Ostrowski)/.test(st), st.slice(0, 160));
      await ctx.close();
      // weights
      const a = await ctxFor(browser, 1440); const ap = await a.newPage(); await login(ap, base, F.aa);
      await ap.goto(`${base}/virtual-offices/${F.KC}`); await ap.getByRole("tab", { name: "Scheduling" }).click(); await ap.locator('[data-testid="match-weights"]').waitFor({ timeout: 30000 }); await settle(ap, 800);
      for (const [k, v] of [["skills", 0], ["service_area", 0], ["availability", 30], ["reliability", 20], ["performance", 20], ["continuity", 25]]) await ap.fill(`#w-${k}`, String(v));
      const t1 = (await ap.locator('[data-testid="weights-total"]').innerText()).trim(), dis = await ap.locator('[data-testid="save-weights"]').isDisabled();
      await ap.fill("#w-continuity", "30"); await settle(ap, 200);
      await ap.locator('[data-testid="save-weights"]').click(); await settle(ap, 2500);
      const stored = (await admin.from("virtual_office").select("smart_match_weights").eq("id", F.KC).single()).data.smart_match_weights;
      const wev = ((await admin.from("events").select("payload").eq("event_type", "office_match_weights_changed").eq("subject_id", F.KC)).data || []);
      await ap.locator('[data-testid="match-weights"]').scrollIntoViewIfNeeded(); await shot(ap, "match-weights-1440");
      await a.close();
      const m2 = await ctxFor(browser, 1440); const mp2 = await m2.newPage(); await login(mp2, base, F.mgr);
      await mp2.goto(`${base}/virtual-offices/${F.KC}`); await mp2.getByRole("tab", { name: "Scheduling" }).click(); await mp2.locator('[data-testid="match-weights"]').waitFor({ timeout: 30000 }); await settle(mp2, 800);
      const roTxt = await mp2.locator('[data-testid="match-weights"]').innerText(); const roDis = await mp2.locator("#w-continuity").isDisabled();
      await m2.close();
      rec("W1 Virtual Offices → Scheduling: the agency admin's weights must total 100 (Save disabled at 95), saved and audited; the office manager sees them read-only",
        /Total 95 of 100/.test(t1) && dis && !!stored && stored.continuity === 30 && stored.skills === 0 && wev.length === 1 && /Only an agency admin/.test(roTxt) && roDis,
        `"${t1}" disabled ${dis}; stored ${JSON.stringify(stored)}; events ${wev.length}; manager read-only ${roDis}`);
      // 390
      const m = await ctxFor(browser, 390); const mp = await m.newPage(); await login(mp, base, F.mgr);
      await mp.goto(`${base}/schedule?tab=unassigned`); await mp.locator('[data-testid="auto-assign-button"]').waitFor({ timeout: 30000 }); await settle(mp, 1500);
      await mp.locator('[data-testid="auto-assign-button"]').evaluate((el) => el.click()); await mp.locator('[data-testid="auto-assign-dialog"]').waitFor();
      await mp.locator('[data-testid="aa-period"] button', { hasText: "Month" }).click(); await settle(mp, 300);
      log("  390 dialog box:", JSON.stringify(await mp.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; return { dlg: r('[data-testid="auto-assign-dialog"]'), btn: r('[data-testid="aa-preview"]'), vw: innerWidth, vh: innerHeight }; })));
      await mp.locator('[data-testid="aa-preview"]').click(); await waitPreview(mp); await settle(mp, 800);
      const fit = await mp.evaluate(() => { const d = document.querySelector('[data-testid="auto-assign-dialog"]'); const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= document.documentElement.clientWidth + 1; });
      await shot(mp, "auto-assign-390"); await m.close();
      rec("A4 390: the Auto-assign dialog (Month, preview) fits the screen", fit, `${fit}`);
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

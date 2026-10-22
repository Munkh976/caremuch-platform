// Ripple UI round 15 (visit actions + visit location, owner Oct 22 A / B) — browser acceptance on DEV with real logins,
// in a disposable tagged office WITHOUT the care-plan module (never the demo office RPLDEMO).
// Usage: node tests/ripple/ui/round15.cjs > some.log 2>&1   (never pipe a DEV suite; see README)
//   V1 the scheduler unassigns from the Shifts list (reason required; Outbox row). V2 the shift detail's More → Cancel visit
//   (client request); the row and the detail show the office (visits at the office). V3 the manager records yesterday's
//   client no-show. V4 390: the dialog fits.
// Screenshots: docs/screenshots/ripple-ui/round15/.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round15");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui15-${Date.now().toString(36)}`;
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
  F.sch = await mkUser("sch", ["scheduler"], F.KC, true, "Sam Park");
  await admin.from("virtual_office").update({ address: "200 Fixture Center Rd", city: "Portage", state: "MI", zip_code: "49002", visit_location: "office" }).eq("id", F.KC);
  F.s1 = await sh(3, "09:00", "10:00"); F.s2 = await sh(4, "09:00", "10:00"); F.s3 = await sh(-1, "09:00", "10:00"); F.s4 = await sh(5, "09:00", "10:00");   // s4: the 390 check
  for (const s of [F.s1, F.s2, F.s3, F.s4]) await must(F.mgr.c, "assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: F.G.ana, _method: "manual", _notes: null, _override_reason: "round15 fixture (disposable)" });
  const lbl = async (k) => new Date(`${await dbDay(k)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });   // the list's day heading
  F.l1 = await lbl(3); F.l2 = await lbl(4); F.l3 = await lbl(-1);
  return F;
}
async function teardown(F) {
  for (const id of ids.shifts) await admin.from("pending_notifications").delete().contains("payload", { shift_id: id });
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
    log(`fixtures [${RUN}]: office Kind Care Lakeside (no module, visits at the office: 200 Fixture Center Rd); Kim Lopez (manager), Sam Park (scheduler); Ana; Omar K.: visits in 3 and 4 days 09:00 (Ana), yesterday 09:00 (Ana)`);
    const browser = await chromium.launch();
    { const w = await browser.newPage(); for (const p of ["/auth", "/schedule"]) await w.goto(`${base}${p}`, { timeout: 120000 }).catch(() => {}); await w.close(); }
    try {
      const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage(); await login(page, base, F.sch);
      const openList = async (p) => { await p.goto(`${base}/schedule`); await p.getByRole("button", { name: /^month$/i }).click(); await settle(p, 1500); await p.getByRole("tab", { name: /Shifts/ }).click(); await settle(p, 2500); };
      const rowOf = (p, d) => p.locator(`xpath=//*[normalize-space(text())='${d}']/following::tbody[1]/tr[1]`);
      const dlgDone = (p) => p.locator('[data-testid="visit-action-dialog"]').waitFor({ state: "detached", timeout: 30000 });
      // V1 unassign from the Shifts list (as the scheduler)
      await openList(page);
      await rowOf(page, F.l1).locator('[data-testid="visit-actions"]').click();
      await page.locator('[data-testid="visit-action-unassign"]').click();
      const d1 = page.locator('[data-testid="visit-action-dialog"]'); await d1.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid="visit-action-preview"]')?.getAttribute("data-visits") !== null, null, { timeout: 30000 }); await settle(page, 500);
      const disabledFirst = await d1.locator('[data-testid="visit-action-confirm"]').isDisabled();
      await d1.locator('[data-testid="visit-action-reason"]').click(); await page.getByRole("option", { name: "Caregiver sick / unavailable" }).click();
      await d1.locator('[data-testid="visit-action-text"]').fill("Ana is sick this week");
      await shot(page, "unassign-dialog-1440");
      await d1.locator('[data-testid="visit-action-confirm"]').click(); await dlgDone(page); await settle(page, 1500);
      const s1 = (await admin.from("shifts").select("status, caregiver_id").eq("id", F.s1).single()).data;
      const ob = ((await admin.from("pending_notifications").select("kind, body, payload")).data || []).filter((o) => o.payload && o.payload.shift_id === F.s1);
      rec("V1 scheduler: Shifts list row ⋯ → Unassign caregiver → Save disabled until a reason → visit open, no caregiver; Outbox row for Ana (date and time only)",
        disabledFirst && s1.status === "open" && s1.caregiver_id === null && ob.length === 1 && / at 9:00 AM/.test(ob[0].body) && !/Omar|Kent/.test(ob[0].body), `${s1.status}; outbox "${ob[0] && ob[0].body}"`);
      // V2 cancel from the shift detail (next to Assign Caregiver), client request; place = the office
      await openList(page);
      const place = (await rowOf(page, F.l2).locator('[data-testid="visit-place"]').innerText().catch(() => "")).trim();
      await rowOf(page, F.l2).locator("td").first().click(); const det = page.locator('[role="dialog"]').last(); await det.waitFor(); await settle(page, 800);
      const detPlace = (await det.locator('[data-testid="visit-place"]').innerText().catch(() => "")).trim();
      await det.locator('[data-testid="shift-detail-actions"] [data-testid="visit-actions"]').click(); await page.locator('[data-testid="visit-action-cancel"]').click();
      const d2 = page.locator('[data-testid="visit-action-dialog"]'); await d2.waitFor(); await settle(page, 800);
      await d2.getByLabel("The client / family").click();
      await d2.locator('[data-testid="visit-action-reason"]').click(); await page.getByRole("option", { name: "Client request" }).click();
      await shot(page, "cancel-dialog-1440");
      await d2.locator('[data-testid="visit-action-confirm"]').click(); await dlgDone(page); await settle(page, 1500);
      const s2 = (await admin.from("shifts").select("status, visit_outcome, cancel_requested_by, late_cancel").eq("id", F.s2).single()).data;
      rec("V2 shift detail → More (next to Assign Caregiver) → Cancel visit, the client asked, Client request → cancelled (requested by client, not late); the row and the detail show the office, not the client's home",
        s2.status === "cancelled" && s2.visit_outcome === "cancelled" && s2.cancel_requested_by === "client" && s2.late_cancel === false && /Fixture Center|Portage/.test(detPlace) && !/1 Fixture St/.test(detPlace + place),
        `${JSON.stringify(s2)}; row "${place}"; detail "${detPlace}"`);
      // V3 client no-show yesterday (manager), Shifts list
      await ctx.close(); const mctx = await ctxFor(browser, 1440); const mp = await mctx.newPage(); await login(mp, base, F.mgr);
      await openList(mp);
      await rowOf(mp, F.l3).locator('[data-testid="visit-actions"]').click(); await mp.locator('[data-testid="visit-action-no_show"]').click();
      const d3 = mp.locator('[data-testid="visit-action-dialog"]'); await d3.waitFor(); await settle(mp, 800);
      await d3.locator('[data-testid="visit-action-text"]').fill("Nobody answered the door");
      await d3.locator('[data-testid="visit-action-confirm"]').click(); await dlgDone(mp); await settle(mp, 1500);
      const s3 = (await admin.from("shifts").select("status, visit_outcome").eq("id", F.s3).single()).data;
      const a3 = ((await admin.from("shift_assignments").select("status").eq("shift_id", F.s3)).data || []).map((a) => a.status);
      rec("V3 manager: yesterday's visit ⋯ → Client no-show → cancelled with outcome client_no_show; the assignment cancelled, not no_show",
        s3.status === "cancelled" && s3.visit_outcome === "client_no_show" && !a3.includes("no_show"), `${JSON.stringify(s3)}; ${a3}`);
      await mctx.close();
      // V4 390: the menu and the dialog fit the phone screen
      const p3 = await ctxFor(browser, 390); const pp = await p3.newPage(); await login(pp, base, F.mgr);
      await pp.goto(`${base}/schedule`); await settle(pp, 2500);
      await pp.getByRole("button", { name: /^month$/i }).click().catch(() => {}); await settle(pp, 1500);
      await pp.getByRole("tab", { name: /Shifts/ }).click().catch(() => {}); await settle(pp, 2000);
      let fit = false, info = "no row with actions";
      if (await pp.locator('[data-testid="visit-actions"]').count()) {
        await pp.locator('[data-testid="visit-actions"]').first().click(); await pp.locator('[data-testid="visit-action-cancel"]').click();
        const d4 = pp.locator('[data-testid="visit-action-dialog"]'); await d4.waitFor(); await settle(pp, 800);
        const r = await d4.evaluate((e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), vw: window.innerWidth, sw: document.documentElement.scrollWidth }; });
        fit = r.l >= 0 && r.r <= r.vw; info = JSON.stringify(r);
        await shot(pp, "cancel-dialog-390"); await pp.keyboard.press("Escape");
      }
      rec("V4 390: the action dialog fits the screen", fit, info);
      await p3.close();
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

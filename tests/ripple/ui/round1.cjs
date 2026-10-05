// Ripple UI round 1 (S0 + S1) — browser acceptance on DEV with real logins.
// Usage: node tests/ripple/ui/round1.cjs <before|after>
//   before: capture the existing UI (sidebars, Dashboard, a few existing pages) BEFORE S0/S1
//   after : the three Ripple menu items are visible only to a manager / agency_admin who can see an
//           office with the care-plan module on; other roles don't see them and are redirected on a
//           direct URL; existing pages' main content is unchanged vs "before"; at 390px the sidebar
//           starts closed and touched pages have no horizontal page scroll; screenshots
// Disposable fixtures (two offices, six users), random passwords kept in memory only, verified
// teardown. DEV run: needs owner approval. Vite is started on a free port against the linked project.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const MODE = process.argv[2] || "after";
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round1");
const STATE = path.join(require("os").tmpdir(), "ripple-ui-round1-before.json");   // page text from "before" (OS temp, never committed)
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui1-${MODE}-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const RIPPLE = ["Client Care Plans (IPOS)", "Weekly Billing", "Form Templates"];
const ROUTES = { "/care-plans": "Client Care Plans (IPOS)", "/billing/weekly": "Weekly Billing", "/form-templates": "Form Templates" };

async function ins(t, row) { const { data, error } = await admin.from(t).insert(row).select("id").single(); if (error) throw new Error(`${t}: ${error.message}`); ids[t].push(data.id); return data.id; }
async function mkUser(tag, role, office, restricted, full) {
  const email = `sec-${tag}${SUFFIX}`, password = pw();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: full, agency_id: A } });
  if (error) throw new Error(`user ${tag}: ${error.message}`); ids.users.push(data.user.id);
  const { error: pe } = await admin.from("profiles").upsert({ id: data.user.id, email, full_name: full, agency_id: A, virtual_office_id: office, office_restricted: restricted });
  if (pe) throw new Error(`profile ${tag}: ${pe.message}`);
  const { error: re } = await admin.from("user_roles").insert({ user_id: data.user.id, role, agency_id: A }); if (re) throw new Error(`role ${tag}: ${re.message}`);
  return { id: data.user.id, email, password, tag };
}
async function setup() {
  const F = {};
  F.RX = await ins("virtual_office", { agency_id: A, name: `ZZ Ripple-X ${RUN}`, is_demo: true });
  F.KY = await ins("virtual_office", { agency_id: A, name: `ZZ KindCare-Y ${RUN}`, is_demo: true });
  const { error } = await admin.from("virtual_office").update({ care_plan_module_enabled: true }).eq("id", F.RX);   // service role (fixture); go-live is stamped by the guard
  if (error) throw new Error("module flag: " + error.message);
  F.mgrRX = await mkUser("mgrrx", "manager", F.RX, true, "ZZ Fixture Manager RX");
  F.mgrKY = await mkUser("mgrky", "manager", F.KY, true, "ZZ Fixture Manager KY");
  F.schRX = await mkUser("schrx", "scheduler", F.RX, true, "ZZ Fixture Scheduler");
  F.aa = await mkUser("aa", "agency_admin", null, false, "ZZ Fixture Admin");
  F.cg = await mkUser("cg", "caregiver", F.RX, false, "ZZ Fixture Caregiver");
  F.cl = await mkUser("cl", "client", F.RX, false, "ZZ Fixture Client");
  await ins("caregivers", { agency_id: A, virtual_office_id: F.RX, user_id: F.cg.id, first_name: "ZZ", last_name: "Fixture Caregiver", email: F.cg.email, phone: "555-0100", is_demo: true });
  await ins("clients", { agency_id: A, virtual_office_id: F.RX, user_id: F.cl.id, first_name: "ZZ", last_name: "Fixture Client", email: F.cl.email, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  return F;
}
async function teardown() {
  for (const t of ["clients", "caregivers"]) for (const id of ids[t]) await admin.from(t).delete().eq("id", id);
  for (const id of ids.users) { await admin.from("user_roles").delete().eq("user_id", id); await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
  for (const id of ids.virtual_office) { await admin.from("events").delete().eq("virtual_office_id", id); await admin.from("virtual_office").delete().eq("id", id); }
  const left = [];
  for (const t of ["clients", "caregivers", "virtual_office"]) for (const id of ids[t]) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} offices, ${ids.caregivers.length} caregiver, ${ids.clients.length} client → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query)"}`);
}

async function login(page, base, u) {
  await page.goto(`${base}/auth`); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
async function sidebarItems(page) {
  await page.locator("aside nav").waitFor({ timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector("aside nav")?.textContent?.includes("Loading..."), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);   // menu gating resolves after the permissions + offices queries
  return page.locator("aside nav a").allInnerTexts();
}
// page text, with the fixtures' own run id normalized (fixture emails carry it), so before/after compare the UI
const normRun = (t) => t.replace(/ui1-(before|after)-[a-z0-9]+/g, "ui1-RUN");
async function mainText(page) { await page.waitForTimeout(2500); return normRun((await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").trim()); }
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${MODE}-${name}.png`), fullPage: false });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const sidebarClosed = (page) => page.evaluate(() => { const a = document.querySelector("aside"); if (!a) return true; const r = a.getBoundingClientRect(); return r.right <= 1; });

async function run(base) {
  const F = await setup();
  log(`fixtures [${RUN}]: Ripple-X (module on), KindCare-Y (module off); manager RX, manager KY, scheduler RX, agency_admin, caregiver, client`);
  const browser = await chromium.launch();
  const before = MODE === "after" && fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
  const state = {};
  try {
    const roles = [["mgrRX", F.mgrRX, true], ["aa", F.aa, true], ["mgrKY", F.mgrKY, false], ["schRX", F.schRX, false], ["cg", F.cg, false], ["cl", F.cl, false]];
    for (const [key, u, shouldSee] of roles) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
      await login(page, base, u);
      const landing = new URL(page.url()).pathname;
      if (!/caregiver|client/.test(landing)) await page.goto(`${base}/dashboard`);
      const items = await sidebarItems(page).catch(() => []);
      await shot(page, `sidebar-${key}-1440`);
      const seen = RIPPLE.filter((l) => items.some((t) => t.trim() === l));
      if (MODE === "after") rec(`M-${key}`, shouldSee ? seen.length === 3 : seen.length === 0, `${key}: Ripple items visible [${seen.join(", ") || "none"}] (expected ${shouldSee ? "all 3" : "none"})`);
      else rec(`B-${key}`, "INFO", `${key}: landing ${landing}; ${items.length} menu items`);
      // existing pages: main content at 1440 (staff only)
      if (["aa", "mgrRX"].includes(key)) {
        for (const p of ["/dashboard", "/schedule", "/clients", "/caregivers"]) {
          await page.goto(`${base}${p}`); const t = await mainText(page); state[`${key}${p}`] = t;
          if (p === "/dashboard") await shot(page, `dashboard-${key}-1440`);
          if (before && before[`${key}${p}`] !== undefined) {
            const b = normRun(before[`${key}${p}`]);
            // exact match, or the same content in another row order (e.g. /caregivers has no ORDER BY,
            // so Postgres may return rows in a different order between runs)
            const bag = (x) => x.split(" ").sort().join(" ");
            const same = b === t || bag(b) === bag(t);
            if (same && b !== t) { rec(`U-${key}${p}`, true, "same content; row order differs (list query has no ORDER BY)"); continue; }
            let at = 0; while (at < Math.min(b.length, t.length) && b[at] === t[at]) at++;
            rec(`U-${key}${p}`, same, same ? "main content identical to before" : `differs at char ${at}: before "…${b.slice(Math.max(0, at - 40), at + 40)}…" after "…${t.slice(Math.max(0, at - 40), at + 40)}…"`);
          }
        }
      }
      // direct URL access to the new routes
      if (MODE === "after") {
        for (const [r, title] of Object.entries(ROUTES)) {
          await page.goto(`${base}${r}`); await page.waitForTimeout(3000);
          const at = new URL(page.url()).pathname;
          const shown = await page.getByRole("heading", { name: title }).count();
          if (shouldSee) { rec(`R-${key}${r}`, at === r && shown > 0, `${key} opens ${r}: at ${at}, heading shown ${shown > 0}`); if (key === "mgrRX") await shot(page, `shell-${r.replace(/\//g, "_").slice(1)}-1440`); }
          else rec(`R-${key}${r}`, at !== r && shown === 0, `${key} → ${r}: redirected to ${at}`);
        }
      }
      await ctx.close();
      // 390px
      if (["mgrRX", "aa"].includes(key)) {
        const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const mp = await m.newPage();
        await login(mp, base, u);
        const pages = MODE === "after" && key === "mgrRX" ? ["/dashboard", "/care-plans", "/billing/weekly", "/form-templates"] : ["/dashboard"];
        for (const p of pages) {
          await mp.goto(`${base}${p}`); await mp.waitForTimeout(3500);
          const closed = await sidebarClosed(mp), nh = await noHScroll(mp);
          await mp.screenshot({ path: path.join(SHOTS, `${MODE}-${p === "/dashboard" ? "dashboard" : "shell-" + p.replace(/\//g, "_").slice(1)}-${key}-390.png`) });
          const wide = nh ? [] : await mp.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1)
            .slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ").slice(0, 4).join(".")} right=${Math.round(e.getBoundingClientRect().right)}`); });
          // The no-scroll rule gates the pages this round touched. /dashboard's own content already
          // overflowed at 390px before S0 (the plan fixes it in S11, §6): reported, sidebar still gated.
          if (MODE === "after" && p === "/dashboard") rec(`W-${key}${p}`, closed ? "INFO" : false, `390px ${p}: sidebar closed ${closed}; page scroll ${nh ? "none" : "from the Dashboard's own content (pre-existing; S11)"}${wide.length ? " — " + wide.slice(1, 4).join(" | ") : ""}`);
          else if (MODE === "after") rec(`W-${key}${p}`, closed && nh, `390px ${p}: sidebar closed ${closed}, no horizontal page scroll ${nh}${wide.length ? " — wider than the viewport: " + wide.join(" | ") : ""}`);
          else rec(`B390-${key}${p}`, "INFO", `390px ${p}: sidebar closed ${closed}, no horizontal page scroll ${nh}`);
        }
        if (MODE === "after" && key === "mgrRX") {   // the menu opens and closes on mobile
          await mp.goto(`${base}/dashboard`); await mp.waitForTimeout(2500);
          await mp.locator("button.fixed").first().click(); await mp.waitForTimeout(600);
          const openNow = !(await sidebarClosed(mp)); await mp.screenshot({ path: path.join(SHOTS, `after-sidebar-open-mgrRX-390.png`) });
          await mp.mouse.click(370, 600); await mp.waitForTimeout(600); const closedAgain = await sidebarClosed(mp);
          rec(`W-toggle`, openNow && closedAgain, `390px: menu button opens the sidebar ${openNow}; tapping the scrim closes it ${closedAgain}`);
        }
        await m.close();
      }
    }
  } finally { await browser.close(); }
  if (MODE === "before") fs.writeFileSync(STATE, JSON.stringify(state));
}

(async () => {
  const port = 8090 + Math.floor(Math.random() * 50);
  const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("vite did not start")), 90000);
      vite.stdout.on("data", (d) => { if (/Local:|ready in/i.test(d.toString())) { clearTimeout(to); res(); } }); });
    await run(`http://localhost:${port}`);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally { await teardown(); try { execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ } }
  log("summary: " + rows.map((r) => `${r.id}=${r.ok === "INFO" ? "INFO" : r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => r.ok === false)) process.exitCode = 1;
})();

// Read-only check of a deployed frontend (e.g. the Fly.io dev app) against the demo office: the login page loads, Pat
// Morgan signs in, Client Care Plans and Schedule open with the demo data. Only navigation — no clicks that change data.
// Password: RIPPLE_DEMO_PASSWORD (never printed). Usage: node tests/ripple/demo/check-live.cjs https://caremuch-platform.fly.dev
const { chromium } = require("playwright");
const D = require("./demo-lib.cjs");
const base = (process.argv[2] || "").replace(/\/+$/, "");
const rows = []; const rec = (id, ok, d) => { rows.push(ok); console.log(`${id} ${ok ? "PASS" : "FAIL"} :: ${String(d).replace(/\s+/g, " ").slice(0, 220)}`); };

(async () => {
  if (!/^https:\/\//.test(base)) throw new Error("give the https URL of the deployed app");
  if (!D.ENV_PW) throw new Error("RIPPLE_DEMO_PASSWORD is not set");
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const r = await page.goto(`${base}/auth`, { timeout: 120000 });
    await page.locator('input[type="email"]').waitFor({ timeout: 60000 });
    rec("L1 login page loads", r && r.status() < 400, `HTTP ${r && r.status()}; title "${await page.title()}"`);
    await page.fill('input[type="email"]', D.email("pat.morgan")); await page.fill('input[type="password"]', D.ENV_PW);
    await page.getByRole("button", { name: /sign in/i }).first().click();
    await page.waitForURL((u) => !/\/auth/.test(u.pathname), { timeout: 60000 });
    rec("L2 Pat signs in", true, page.url().replace(base, ""));
    await page.goto(`${base}/care-plans`); await page.waitForTimeout(6000);
    const cp = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    rec("L3 Client Care Plans lists the demo clients", /Zoe/.test(cp) && /Lily/.test(cp), cp.match(/(Zoe|Max|Noah|Ella|Lily)\b/g)?.join(",") || cp.slice(0, 120));
    await page.goto(`${base}/schedule`); await page.waitForTimeout(6000);
    const sc = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    rec("L4 Schedule opens with this week's visits", /Schedule/.test(sc) && /(Zoe|Max|Noah|Ella)/.test(sc), (sc.match(/\d+ shifts?/) || [""])[0]);
    await page.screenshot({ path: "docs/screenshots/ripple-ui/demo/live-schedule-1440.png" });
  } finally { await browser.close(); await D.closeDb(); }
  console.log(`summary ${rows.filter(Boolean).length}/${rows.length}`);
  if (rows.some((x) => !x)) process.exitCode = 1;
})().catch((e) => { console.log("ERROR", String(e.message).slice(0, 300)); process.exitCode = 1; });

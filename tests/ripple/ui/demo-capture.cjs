// Demo screenshots of the persistent Ripple demo office (tests/ripple/demo), at 1440 and 390, into
// docs/screenshots/ripple-ui/demo/. READ-ONLY: no click that writes (dialogs and sheets are opened, then cancelled);
// states that need a write (a billed week, a returned note) come from the seeded data. Every screen's text is checked
// for test tags, "ZZ" and real (Ripple staff) names.
// Usage: node tests/ripple/ui/demo-capture.cjs > some.log 2>&1   then   node tests/ripple/demo/seed-demo.cjs --reset
// Passwords: RIPPLE_DEMO_PASSWORD if set (never printed); else a random in-memory one per user, locked again at the end.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const D = require("../demo/demo-lib.cjs");
const { admin, pgRead } = D;

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/demo");
fs.mkdirSync(SHOTS, { recursive: true });
const BAD = /\bZZ\b|ui\d+-[a-z0-9]{6,}|ui-s\d|phase-[a-z]|done-test|sec-[a-z]+-|caremuch-sectest|rpldemo|RPLDEMO|Bren|Lauren|Mumbower|Williams|Houseman/;
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const shots = [];

async function ids() {
  const [off] = await D.findOffice(); if (!off) throw new Error("no demo office: run seed-demo --apply");
  return pgRead(async (c) => {
    const q = async (sql, p) => (await c.query(sql, p)).rows;
    const cl = Object.fromEntries((await q(`SELECT lower(first_name) k, id FROM public.clients WHERE virtual_office_id = $1`, [off.id])).map((r) => [r.k, r.id]));
    const cg = Object.fromEntries((await q(`SELECT lower(first_name) k, id FROM public.caregivers WHERE virtual_office_id = $1`, [off.id])).map((r) => [r.k, r.id]));
    const users = Object.fromEntries((await q(`SELECT email, id FROM public.profiles WHERE email LIKE $1`, [`%${D.EMAIL_TAG}`])).map((r) => [r.email, r.id]));
    const note = async (status, kind) => (await q(`SELECT n.id, n.shift_id FROM public.progress_notes n JOIN public.clients c ON c.id = n.client_id WHERE c.virtual_office_id = $1 AND n.status = $2 AND n.note_kind = $3 ORDER BY n.service_date LIMIT 1`, [off.id, status, kind]))[0];
    const clock = (await q(`SELECT (d - (extract(isodow FROM d)::int - 1))::text w0 FROM (SELECT (now() AT TIME ZONE 'America/New_York')::date d) x`))[0];
    const wk = (await q(`SELECT ($1::date - 7)::text a, ($1::date - 14)::text b`, [clock.w0]))[0];
    return { off: off.id, cl, cg, users, submitted: await note("submitted", "cls"), reviewedCls: await note("reviewed", "cls"), billedResp: await note("billed", "respite"),
      draft: await note("draft", "cls"), lastWeek: wk.a, weekBefore: wk.b };
  });
}

const pw = {};
async function password(email, id) {
  if (D.ENV_PW) return D.ENV_PW;
  if (!pw[email]) { pw[email] = "Dm!" + crypto.randomBytes(18).toString("base64url"); const { error } = await admin.auth.admin.updateUserById(id, { password: pw[email] }); if (error) throw new Error(error.message); }
  return pw[email];
}
async function login(page, base, email, id) {
  await page.goto(`${base}/auth`, { timeout: 90000 }); await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', await password(email, id));
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
const ctxFor = (browser, w) => browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
// What each data screen must show (DOM text at capture time), so a screen of the wrong office / note can't pass.
const EXPECT = {
  dashboard: /Pat Morgan[\s\S]*Care plan compliance[\s\S]*Ripple Effects – Demo/, "care-plans": /Zoe Nguyen[\s\S]*Lily Park/, "zoe-ipos": /DEMO-1001/, "zoe-goals": /morning routine/,
  "zoe-scheduling": /Zoe/, "zoe-onboarding": /Zoe/, "lily-onboarding": /Lily/, "credentials-ben": /Ben Carter/, "credentials-mia": /Mia Lopez/, "training-zoe": /Zoe/,
  "notes-to-review": /Zoe N\.|Max O\./, "note-detail": /Zoe N\.[\s\S]*Mia Lopez/, "print-cls": /CLS PROGRESS NOTE[\s\S]*Ripple Effects – Demo[\s\S]*Zoe N\.[\s\S]*DEMO-1001[\s\S]*Pat Morgan/i,
  "print-respite": /RESPITE[\s\S]*Ripple Effects – Demo[\s\S]*Max O\.[\s\S]*DEMO-1002/i, "billing-last-week": /Ripple Effects – Demo[\s\S]*Zoe N\./, "billing-week-before": /Ripple Effects – Demo[\s\S]*Billed/i,
  "assign-mia-advisory": /Zoe Nguyen[\s\S]*Mia Lopez/, "compliance-card": /Ripple Effects – Demo/, "caregiver-ana-today": /Ana|Zoe|Max/, "caregiver-ana-cls-note": /Zoe/,
};
async function shot(page, name, w, full = true) {
  await page.waitForTimeout(600);
  const want = EXPECT[name];
  // wait (up to 30 s) until the page shows what it should and nothing is still "Loading…"
  let text = "";
  for (let i = 0; i < 60; i++) {
    text = await page.locator("body").innerText().catch(() => "");
    if ((!want || want.test(text)) && !/Loading(…|\.\.\.)/.test(text)) break;
    await page.waitForTimeout(500);
  }
  const m = text.match(BAD);
  const file = `${name}-${w}.png`;
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: full });
  shots.push({ file, clean: !m, hit: m ? m[0] : "", expected: !want || want.test(text) });
}
const go = async (page, base, url, wait) => { await page.goto(`${base}${url}`); if (wait) await page.locator(wait).first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2500); };

async function staff(base, I, browser, w) {
  const pat = D.email("pat.morgan"), sam = D.email("sam.rivera");
  const ctx = await ctxFor(browser, w); const page = await ctx.newPage(); await login(page, base, pat, I.users[pat]);
  await go(page, base, "/dashboard", '[data-testid="compliance-section"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid^="cs-count-"]')].every((e) => e.textContent !== "–"), null, { timeout: 30000 }); await shot(page, "dashboard", w);
  await go(page, base, "/form-templates"); await shot(page, "form-templates", w);
  await page.getByRole("tab", { name: "Measure library" }).click(); await page.waitForTimeout(1500); await shot(page, "measure-library", w);
  await go(page, base, "/care-plans", '[data-testid="care-plan-list"]'); await shot(page, "care-plans", w);
  for (const t of ["ipos", "goals", "scheduling", "onboarding"]) { await go(page, base, `/care-plans/${I.cl.zoe}?tab=${t}`); await shot(page, `zoe-${t}`, w); }
  await go(page, base, `/care-plans/${I.cl.lily}?tab=onboarding`); await shot(page, "lily-onboarding", w);
  for (const k of ["ben", "mia"]) { await go(page, base, `/caregivers?caregiver=${I.cg[k]}&tab=credentials`); await page.waitForTimeout(1500); await shot(page, `credentials-${k}`, w, false); }
  await go(page, base, `/training/${I.cl.zoe}`); await shot(page, "training-zoe", w);
  await go(page, base, "/progress-notes"); await shot(page, "notes-to-review", w);
  await go(page, base, `/progress-notes/${I.submitted.id}`, '[data-testid="note-actions"]'); await shot(page, "note-detail", w);
  await page.getByRole("button", { name: /Return to caregiver/ }).click(); await page.locator('[data-testid="return-dialog"]').waitFor(); await shot(page, "return-dialog", w, false);
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  rec(`RO-${w} return dialog cancelled: the note is still submitted`, (await admin.from("progress_notes").select("status").eq("id", I.submitted.id).single()).data.status === "submitted", "");
  await go(page, base, `/progress-notes/${I.reviewedCls.id}/print`); await shot(page, "print-cls", w);
  await go(page, base, `/progress-notes/${I.billedResp.id}/print`); await shot(page, "print-respite", w);
  await go(page, base, `/billing/weekly?week=${I.lastWeek}`, '[data-testid="week-picker"]'); await shot(page, "billing-last-week", w);
  await go(page, base, `/billing/weekly?week=${I.weekBefore}`, '[data-testid="week-picker"]'); await shot(page, "billing-week-before", w);
  // assign dialog (advisory) for Mia on Zoe's open visit next week; cancelled
  await go(page, base, "/schedule?tab=unassigned"); await page.getByRole("button", { name: "Next" }).click(); await page.waitForTimeout(2500);
  const row = page.locator("tr", { hasText: /Zoe Nguyen/ }).first(); await row.waitFor({ timeout: 20000 });
  const btn = row.getByRole("button", { name: /^Assign$/ }); if (w < 500) await btn.dispatchEvent("click"); else await btn.click();
  const dlg = page.locator('[role="dialog"]').last(); await dlg.waitFor(); await page.waitForTimeout(2500);
  await dlg.getByPlaceholder("Search caregivers...").fill("Mia"); await dlg.locator('button[role="combobox"]').first().click();
  await page.getByRole("option", { name: /Mia Lopez/ }).first().click(); await page.waitForTimeout(1000);
  await dlg.locator('[data-testid="elig-compliance"]').scrollIntoViewIfNeeded().catch(() => {}); await shot(page, "assign-mia-advisory", w, false);
  for (let i = 0; i < 4 && (await page.locator('[role="dialog"], [role="listbox"]').count()) > 0; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
  await ctx.close();
  // compliance card (agency admin's view; the switch is not touched)
  const c2 = await ctxFor(browser, w); const p2 = await c2.newPage(); await login(p2, base, sam, I.users[sam]);
  await go(p2, base, `/virtual-offices/${I.off}?tab=compliance`, '[data-testid="compliance-card"]'); await shot(p2, "compliance-card", w);
  await c2.close();
}

async function caregiver(base, I, browser, w) {
  const ana = D.email("ana.brooks");
  const ctx = await ctxFor(browser, w); const page = await ctx.newPage(); await login(page, base, ana, I.users[ana]);
  await go(page, base, "/caregiver-dashboard", '[data-testid="caregiver-today"]'); await shot(page, "caregiver-ana-today", w);
  await go(page, base, "/caregiver/notes"); await shot(page, "caregiver-ana-notes", w);
  if (I.draft) {
    await go(page, base, `/caregiver/notes/${I.draft.shift_id}`, '[data-testid="open-submit"]'); await shot(page, "caregiver-ana-cls-note", w);
    await page.locator('[data-testid="open-submit"]').click(); await page.locator('[data-testid="submit-sheet"]').waitFor(); await shot(page, "caregiver-ana-sign-sheet", w, false);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    rec(`RO-${w} sign sheet cancelled: the note is still a draft`, (await admin.from("progress_notes").select("status").eq("id", I.draft.id).single()).data.status === "draft", "");
  } else rec(`CG-${w} no draft note today (seeded before 07:00 office time)`, "INFO", "");
  await ctx.close();
}

(async () => {
  const port = 8150 + Math.floor(Math.random() * 50);
  const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  let I;
  try {
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("vite did not start")), 90000);
      vite.stdout.on("data", (d) => { if (/Local:|ready in/i.test(d.toString())) { clearTimeout(to); res(); } }); });
    const base = `http://localhost:${port}`;
    I = await ids();
    const browser = await chromium.launch();
    try { for (const w of [1440, 390]) { await staff(base, I, browser, w); await caregiver(base, I, browser, w); } } finally { await browser.close(); }
    const dirty = shots.filter((s) => !s.clean);
    rec("C1 every screenshot's text is free of test tags, 'ZZ', the demo tag and Ripple staff names", dirty.length === 0, dirty.length ? dirty.map((s) => `${s.file}: ${s.hit}`).join("; ") : `${shots.length} screenshots`);
    const off = shots.filter((s) => !s.expected);
    rec("C2 every data screen shows its expected demo content (office, client, note, case number) in the DOM at capture time", off.length === 0, off.length ? off.map((s) => s.file).join(", ") : `${shots.filter((s) => EXPECT[s.file.replace(/-\d+\.png$/, "")]).length} data screens checked`);
    log("screenshots: " + shots.map((s) => s.file).join(", "));
  } catch (e) { log("ERROR:", String(e.message).replace(/[[0-9;]*m/g, "").slice(0, 1500)); rows.push({ id: "ERROR", ok: false }); }
  finally {
    try { execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ }
    if (I) log(await D.lockPasswords(Object.values(I.users)));
    await D.closeDb();
  }
  log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok === "INFO" ? "INFO" : r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => r.ok === false)) process.exitCode = 1;
})();

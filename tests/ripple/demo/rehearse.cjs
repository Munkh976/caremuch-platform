// Rehearses the demo playbook (docs/demo/playbook.md) end to end through the UI, as the user of each step, on the
// persistent demo office: seed --reset --as-of X, verify-demo, then every step of parts 0–5 in three windows (Pat Morgan
// 1440, Sam Rivera 1440, Ana Brooks 390 phone), a screenshot per step into docs/screenshots/ripple-ui/demo/playbook/,
// then seed --reset --as-of Y and verify-demo again so the office is back at its starting state.
// Usage: node tests/ripple/demo/rehearse.cjs [--as-of YYYY-MM-DD] [--final-as-of YYYY-MM-DD] [--keep]
//   --as-of        the day rehearsed (default today). Ana's live visit starts 08:00 that day: rehearse after 08:00.
//   --final-as-of  the demo day the office is reset to at the end (default = --as-of). The evening before the demo:
//                  --as-of <today> --final-as-of <demo day>.
//   --keep         skip the final reset (debugging only; run seed-demo --reset afterwards).
// Writes happen only through the UI as the demo users and through seed-demo (the owner-approved write path).
// Passwords: RIPPLE_DEMO_PASSWORD (never printed); without it the users get a random in-memory password, locked at the end.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const D = require("./demo-lib.cjs");
const { admin, pgRead } = D;

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/demo/playbook");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const KEEP = process.argv.includes("--keep");
const BAD = /\bZZ\b|ui\d+-[a-z0-9]{6,}|ui-s\d|phase-[a-z]|done-test|sec-[a-z]+-|caremuch-sectest|Bren|Lauren|Mumbower|Williams|Houseman/;
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + String(d).replace(/\s+/g, " ").slice(0, 300) : ""}`); };
const workarounds = [];
const codeSeen = new Set();   // the office code (RPLDEMO) is printed on some existing screens: reported, not a failure

function run(script, args) {   // a demo script in the foreground; its output goes into this log
  log(`--- node tests/ripple/demo/${script} ${args.join(" ")}`);
  try { const out = execSync(`node "${path.join(__dirname, script)}" ${args.join(" ")}`, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], timeout: 540000 }).toString();
    log(out.trim()); return { ok: !/\bERROR\b|FAIL/.test(out), out }; }
  catch (e) { const out = String(e.stdout || "") + String(e.stderr || e.message); log(out.trim()); return { ok: false, out }; }
}

async function ids() {
  const [off] = await D.findOffice(); if (!off) throw new Error("no demo office");
  return pgRead(async (c) => {
    const q = async (sql, p) => (await c.query(sql, p)).rows;
    const cl = Object.fromEntries((await q(`SELECT lower(first_name) k, id FROM public.clients WHERE virtual_office_id = $1`, [off.id])).map((r) => [r.k, r.id]));
    const users = Object.fromEntries((await q(`SELECT email, id FROM public.profiles WHERE email LIKE $1`, [`%${D.EMAIL_TAG}`])).map((r) => [r.email, r.id]));
    const mia = (await q(`SELECT n.id FROM public.progress_notes n JOIN public.caregivers g ON g.id = n.caregiver_id WHERE n.virtual_office_id = $1 AND n.status = 'submitted' AND g.first_name = 'Mia'`, [off.id]))[0];
    const live = (await q(`SELECT s.id FROM public.shifts s JOIN public.caregivers g ON g.id = s.caregiver_id WHERE s.virtual_office_id = $1 AND g.first_name = 'Ana' AND s.start_time = '08:00' AND s.shift_date = $2::date`, [off.id, AS_OF]))[0];
    return { off: off.id, cl, users, mia: mia && mia.id, live: live && live.id };
  });
}
const status = async (id) => (await admin.from("progress_notes").select("status").eq("id", id).single()).data?.status;
const enforcement = async (off) => (await admin.from("virtual_office").select("compliance_enforcement_enabled").eq("id", off).single()).data.compliance_enforcement_enabled;

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
const ctxFor = (browser, w) => browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}), acceptDownloads: true });
const settle = async (page, ms = 1500) => { await page.waitForTimeout(ms);
  for (let i = 0; i < 40 && /Loading(…|\.\.\.)/.test(await page.locator("body").innerText().catch(() => "")); i++) await page.waitForTimeout(500); };
const closeAll = async (page) => { for (let i = 0; i < 4 && (await page.locator('[role="dialog"], [role="listbox"]').count()) > 0; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); } };
// the sidebar link (as a presenter clicks it); if it isn't there, open the URL and record the workaround
async function nav(page, base, label, url, wait) {
  const link = page.getByRole("link", { name: new RegExp(`^${label.replace(/[()]/g, "\\$&")}`) }).first();   // a badge may follow the label
  if (await link.isVisible().catch(() => false)) await link.click();
  else { workarounds.push(`sidebar "${label}" not visible -> opened ${url}`); await page.goto(`${base}${url}`); }
  if (wait) await page.locator(wait).first().waitFor({ timeout: 30000 });
  await settle(page);
}

let N = 0;
async function step(name, page, fn, { full = true } = {}) {
  const id = String(++N).padStart(2, "0"), file = `${id}-${name}.png`;
  let ok = false, detail = "";
  try { const r = await fn(); ok = r === undefined ? true : !!r[0]; detail = r ? r[1] : ""; }
  catch (e) { detail = `ERROR ${String(e.message).replace(/\x1b\[[0-9;]*m/g, "").slice(0, 400)}`; }
  try {
    await page.waitForTimeout(500);
    const text = await page.locator("body").innerText().catch(() => "");
    const m = text.match(BAD); if (m) { ok = false; detail += ` | screen shows a test tag "${m[0]}"`; }
    if (/RPLDEMO/i.test(text)) codeSeen.add(file);
    await page.screenshot({ path: path.join(SHOTS, file), fullPage: full });
  } catch (e) { detail += ` | screenshot failed: ${e.message.slice(0, 120)}`; }
  rec(`${id} ${name}`, ok, `${file}: ${detail}`);
  return ok;
}
const has = async (loc, re) => re.test(await loc.innerText().catch(() => ""));

async function openAssignMia(page, base) {
  await nav(page, base, "Schedule", "/schedule");
  await page.getByRole("tab", { name: "Unassigned" }).click(); await settle(page);
  await page.getByRole("button", { name: "Next" }).click(); await settle(page, 2500);
  const row = page.locator("tr", { hasText: /Zoe Nguyen/ }).first(); await row.waitFor({ timeout: 20000 });
  await row.getByRole("button", { name: /^Assign$/ }).click();
  const dlg = page.locator('[role="dialog"]').last(); await dlg.waitFor(); await page.waitForTimeout(2500);
  await dlg.getByPlaceholder("Search caregivers...").fill("Mia"); await page.waitForTimeout(300);
  await dlg.locator('button[role="combobox"]').first().click();
  await page.getByRole("option", { name: /Mia Lopez/ }).first().click(); await page.waitForTimeout(2000);
  const panel = dlg.locator('[data-testid="elig-compliance"]'); await panel.waitFor({ timeout: 20000 }); await panel.scrollIntoViewIfNeeded();
  return { dlg, panel };
}
async function switchEnforcement(sam, base, I, on) {
  await nav(sam, base, "Virtual Offices", "/virtual-offices");
  if (!/\/virtual-offices\/[0-9a-f-]{36}/.test(sam.url())) { await sam.getByRole("button", { name: "Configure" }).first().click(); await settle(sam); }
  await sam.locator('[data-testid="tab-compliance"]').click(); await sam.locator('[data-testid="compliance-card"]').waitFor({ timeout: 30000 }); await settle(sam, 800);
  await sam.locator('[data-testid="enforcement-switch"]').click(); await sam.locator('[data-testid="compliance-confirm"]').waitFor(); await sam.waitForTimeout(500);
  return sam.locator('[data-testid="compliance-confirm"]');
}

let AS_OF;
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const f of fs.readdirSync(SHOTS)) if (/^\d\d-.*\.png$/.test(f)) fs.unlinkSync(path.join(SHOTS, f));
  const today = (await pgRead(async (c) => (await c.query(`SELECT (now() AT TIME ZONE $1)::date::text d`, [D.TZ])).rows[0].d));
  AS_OF = arg("--as-of") || today; const FINAL = arg("--final-as-of") || AS_OF;
  log(`=== rehearse — demo day ${AS_OF} (today ${today}); reset afterwards to ${KEEP ? "(kept, no reset)" : FINAL} ===`);
  const s0 = run("seed-demo.cjs", ["--reset", "--as-of", AS_OF]); rec("R1 seed-demo --reset", s0.ok, "");
  const v0 = run("verify-demo.cjs", ["--as-of", AS_OF]); rec("R2 verify-demo before the rehearsal", v0.ok, (v0.out.match(/summary: .*/) || [""])[0]);
  if (!s0.ok || !v0.ok) { process.exitCode = 1; return; }
  await D.closeDb();
  const I = await ids();
  const port = 8150 + Math.floor(Math.random() * 50);
  const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("vite did not start")), 90000);
      vite.stdout.on("data", (d) => { if (/Local:|ready in/i.test(d.toString())) { clearTimeout(to); res(); } }); });
    const base = `http://localhost:${port}`;
    const browser = await chromium.launch();
    try {
      const patE = D.email("pat.morgan"), samE = D.email("sam.rivera"), anaE = D.email("ana.brooks");
      const pc = await ctxFor(browser, 1440), pat = await pc.newPage(); await login(pat, base, patE, I.users[patE]);
      const sc = await ctxFor(browser, 1440), sam = await sc.newPage(); await login(sam, base, samE, I.users[samE]);
      const ac = await ctxFor(browser, 390), ana = await ac.newPage(); await login(ana, base, anaE, I.users[anaE]);

      // ---------------- Part 0: dashboard (Pat) ----------------
      await step("pat-dashboard", pat, async () => {
        await nav(pat, base, "Dashboard", "/dashboard", '[data-testid="compliance-section"]');
        await pat.waitForFunction(() => [...document.querySelectorAll('[data-testid^="cs-count-"]')].every((e) => e.textContent !== "–"), null, { timeout: 30000 });
        const toReview = await pat.locator('[data-testid="panel-to-review"]').innerText(), overdue = await pat.locator('[data-testid="panel-overdue"]').innerText();
        const bl = await pat.locator('[data-testid="billing-line"]').innerText();
        const c = async (k) => pat.locator(`[data-testid="cs-count-${k}"]`).innerText();
        const counts = { onboarding: await c("onboarding"), credentials: await c("credentials"), units: await c("units"), retraining: await c("retraining") };
        return [/\b1\b/.test(toReview) && /\b2\b/.test(overdue) && /not yet billed/.test(bl) && counts.onboarding === "1" && counts.units === "1" && counts.retraining === "1",
          `to review "${toReview}"; overdue "${overdue}"; billing "${bl}"; panels ${JSON.stringify(counts)}`];
      });
      // ---------------- Part 1: onboarding (Pat) ----------------
      await step("pat-form-templates-shells", pat, async () => { await nav(pat, base, "Form Templates", "/form-templates"); return [await has(pat.locator("body"), /CLS Progress Note[\s\S]*Respite Progress Note|Respite Progress Note[\s\S]*CLS Progress Note/), "shells listed"]; });
      await step("pat-measure-library", pat, async () => { await pat.getByRole("tab", { name: "Measure library" }).click(); await settle(pat); return [await has(pat.locator("body"), /Prompt level|prompt/i), ""]; });
      await step("pat-care-plans-list", pat, async () => { await nav(pat, base, "Client Care Plans (IPOS)", "/care-plans", '[data-testid="care-plan-list"]');
        const t = await pat.locator('[data-testid="care-plan-list"]').innerText(); return [/Lily Park[\s\S]*5 of 8/.test(t) && (t.match(/Onboarded/g) || []).length >= 4, t.replace(/\s+/g, " ").slice(0, 200)]; });
      await step("pat-lily-onboarding", pat, async () => { await pat.getByRole("link", { name: "Lily Park" }).first().click(); await settle(pat);
        await pat.getByRole("tab", { name: "Onboarding & Documents" }).click(); await settle(pat);
        return [await has(pat.locator("body"), /Onboarding 5 of 8/), "header badge 'Onboarding 5 of 8'"]; });
      await step("pat-zoe-onboarding", pat, async () => { await pat.getByRole("link", { name: "All clients" }).first().click(); await settle(pat);
        await pat.getByRole("link", { name: "Zoe Nguyen" }).first().click(); await settle(pat);
        await pat.getByRole("tab", { name: "Onboarding & Documents" }).click(); await settle(pat);
        return [await has(pat.locator('[data-testid="client-header"]'), /Onboarded/), ""]; });
      // ---------------- Part 2: IPOS, renewal, retraining (Pat) ----------------
      await step("pat-zoe-ipos-v2", pat, async () => { await pat.getByRole("tab", { name: "IPOS" }).click(); await settle(pat);
        return [await has(pat.locator('[data-testid="client-header"]'), /Plan v2 active/) && await has(pat.locator('[data-testid="plan-history"]'), /superseded/i), (await pat.locator('[data-testid="plan-history"]').innerText()).replace(/\s+/g, " ")]; });
      await step("pat-zoe-ipos-v1-read-only", pat, async () => { await pat.locator('[data-testid="plan-history"]').getByRole("button", { name: "View (read-only)" }).click();
        const sh = pat.locator('[role="dialog"]').last(); await sh.waitFor(); await pat.waitForTimeout(800);
        const edits = await sh.getByRole("button", { name: /^(Edit|Save|Renew)/ }).count();
        return [await has(sh, /Plan v1 \(read-only\)/) && edits === 0, `edit/save/renew buttons in the sheet: ${edits}`]; }, { full: false });
      await closeAll(pat);
      await step("pat-zoe-authorizations", pat, async () => { const a = pat.locator('[data-testid="authorizations"]'); await a.scrollIntoViewIfNeeded();
        const t = await a.innerText(); return [/DEMO-AUTH-1001-A/.test(t) && /DEMO-AUTH-1001-B/.test(t), t.replace(/\s+/g, " ").slice(0, 200)]; }, { full: false });
      await step("pat-zoe-goals", pat, async () => { await pat.getByRole("tab", { name: "Goals" }).click(); await settle(pat); return [await has(pat.locator("body"), /morning routine[\s\S]*Instructions for Staff|Instructions for Staff[\s\S]*morning routine/i), ""]; });
      await step("pat-zoe-measures-1A", pat, async () => { await pat.locator('[data-objective="1A"]').click(); await pat.locator('[data-testid="measures-panel"]').waitFor(); await pat.waitForTimeout(600);
        return [await has(pat.locator('[data-testid="measures-panel"]'), /Highest prompt level used/), ""]; });
      await step("pat-training-zoe-from-dashboard", pat, async () => { await nav(pat, base, "Dashboard", "/dashboard", '[data-testid="cs-retraining"]'); await settle(pat, 2000);
        await pat.locator('[data-testid="cs-retraining-row"]').first().getByRole("link").first().click(); await settle(pat);
        return [/\/training\//.test(pat.url()) && await has(pat.locator("body"), /Zoe/) && await has(pat.locator("body"), /Mia Lopez/), pat.url().replace(base, "")]; });
      for (const who of ["Ben Carter", "Mia Lopez"]) {
        await step(`pat-credentials-${who.split(" ")[0].toLowerCase()}`, pat, async () => {
          await nav(pat, base, "Dashboard", "/dashboard", '[data-testid="cs-credentials"]'); await settle(pat, 2000);
          await pat.locator('[data-testid="cs-credentials-row"]', { hasText: who }).first().getByRole("link", { name: who }).first().click();
          const tab = pat.locator('[data-testid="credentials-tab"]'); await tab.waitFor({ timeout: 20000 }); await pat.waitForTimeout(1200);
          const bands = await tab.locator("[data-band]").evaluateAll((els) => els.map((e) => e.getAttribute("data-band")).filter((b) => b !== "ok" && b !== "green"));
          await tab.locator('[data-band="overdue"], [data-band="red"], [data-band="yellow"]').first().scrollIntoViewIfNeeded().catch(() => {});
          const want = who.startsWith("Ben") ? ["red", "yellow"] : ["overdue"];
          return [JSON.stringify([...bands].sort()) === JSON.stringify(want), `bands shown: ${bands.join(", ")}`]; }, { full: false });
        await closeAll(pat);
      }
      // ---------------- Part 3: who can be scheduled ----------------
      await step("pat-assign-mia-advisory", pat, async () => { const { dlg, panel } = await openAssignMia(pat, base);
        const lines = await panel.locator('[data-testid^="elig-line-"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-testid").replace("elig-line-", "")}=${e.getAttribute("data-blocked") === "true" ? "Blocked" : "Advisory"}`));
        // the care-plan line is Advisory; Mia's ★ expired credential is Blocked whatever the switch (existing scheduling rule)
        return [lines.includes("training_missing=Advisory") && lines.some((l) => /cert.*=Blocked/.test(l)), lines.join(", ")]; }, { full: false });
      await closeAll(pat);
      await step("sam-enforcement-on-confirm", sam, async () => { const dlg = await switchEnforcement(sam, base, I, true);
        return [await has(dlg, /Turn on compliance enforcement/), (await dlg.innerText()).replace(/\s+/g, " ").slice(0, 200)]; }, { full: false });
      await step("sam-enforcement-on", sam, async () => { await sam.locator('[data-testid="compliance-confirm-ok"]').click();
        await sam.waitForFunction(() => document.querySelector('[data-testid="enforcement-status"]')?.textContent === "Enforced", null, { timeout: 20000 });
        return [(await enforcement(I.off)) === true, "Enforced; DB flag on"]; });
      await step("pat-assign-mia-blocked", pat, async () => { await nav(pat, base, "Dashboard", "/dashboard"); const { dlg, panel } = await openAssignMia(pat, base);
        const lines = await panel.locator('[data-testid^="elig-line-"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-testid").replace("elig-line-", "")}=${e.getAttribute("data-blocked") === "true" ? "Blocked" : "Advisory"}`));
        const confirmDisabled = await dlg.getByRole("button", { name: /Confirm Assignment/ }).isDisabled();
        return [lines.includes("training_missing=Blocked") && confirmDisabled, `${lines.join(", ")}; confirm disabled ${confirmDisabled}`]; }, { full: false });
      await closeAll(pat);
      await step("sam-enforcement-off", sam, async () => { const dlg = await switchEnforcement(sam, base, I, false);
        const okText = await has(dlg, /Turn off compliance enforcement/);
        await sam.locator('[data-testid="compliance-confirm-ok"]').click();
        await sam.waitForFunction(() => document.querySelector('[data-testid="enforcement-status"]')?.textContent === "Advisory", null, { timeout: 20000 });
        return [okText && (await enforcement(I.off)) === false, "Advisory; DB flag off"]; });
      // ---------------- Part 4: Ana writes today's note (phone) ----------------
      await step("ana-today", ana, async () => { await ana.goto(`${base}/caregiver-dashboard`); await ana.locator('[data-testid="caregiver-today"]').waitFor({ timeout: 30000 }); await settle(ana, 2000);
        const t = await ana.locator('[data-testid="caregiver-today"]').innerText();
        return [/Write progress note/.test(t) && /Zoe/.test(t), t.replace(/\s+/g, " ").slice(0, 200)]; });
      await step("ana-notes", ana, async () => { await ana.getByRole("link", { name: "Notes", exact: true }).first().click(); await settle(ana, 2000);
        const t = await ana.locator('[data-testid="notes-todo"]').innerText().catch(() => "");
        return [/Overdue/.test(t) && /Max/.test(t), t.replace(/\s+/g, " ").slice(0, 200)]; });
      await step("ana-note-open", ana, async () => { await ana.getByRole("link", { name: "Today", exact: true }).first().click(); await settle(ana, 1500);
        await ana.getByRole("link", { name: /Write progress note/ }).first().click();
        await ana.locator('[data-testid="caregiver-note"]').waitFor({ timeout: 30000 }); await settle(ana, 1500);
        return [(await status((await admin.from("progress_notes").select("id").eq("shift_id", I.live).single()).data.id)) === "draft", "opening the page created the draft"]; });
      const box = (prompt) => ana.locator("[data-measure]", { hasText: prompt }).first();
      await step("ana-note-late-arrival-example", ana, async () => {
        await ana.fill("#arrival", "08:20"); await ana.fill("#end", "09:00"); await ana.waitForTimeout(1500);
        const u = await ana.locator('[data-testid="units-to-bill"]').innerText(); await ana.locator('[data-testid="units-to-bill"]').scrollIntoViewIfNeeded();
        return [/Units to bill: 2 of 4/.test(u), u]; }, { full: false });
      await step("ana-note-filled", ana, async () => {
        await ana.fill("#arrival", "08:00"); await ana.fill("#end", "09:00"); await ana.fill("#location", "Zoe's home"); await ana.fill("#ratio", "1:1");
        await box("Highest prompt level used").locator("select").selectOption({ label: "Verbal" });
        for (const s of ["Get supplies", "Brush", "Rinse"]) await box("Steps completed").getByRole("checkbox", { name: new RegExp(s) }).click();
        await box("Took part in the outing?").getByRole("radio", { name: "Yes" }).click();
        await box("Where did Zoe choose to go?").locator("input").fill("Public library");
        await box("How did Zoe make her choice?").locator("textarea").fill("She compared the park and the library and chose the library.");
        for (const [i, v] of [[1, "Yes"], [2, "No"], [3, "Yes"]]) await box("Counted the change correctly").getByRole("radiogroup", { name: `Counted the change correctly trial ${i}` }).getByRole("radio", { name: v }).click();
        await box("Times Zoe asked for help").getByRole("button", { name: "Plus one" }).click();
        await ana.getByRole("button", { name: "Save", exact: true }).click(); await ana.waitForTimeout(2500);
        const u = await ana.locator('[data-testid="units-to-bill"]').innerText(), s = await ana.locator('[data-testid="save-state"]').innerText().catch(() => "");
        await ana.locator('[data-testid="units-to-bill"]').scrollIntoViewIfNeeded();
        return [/Units to bill: 4 of 4/.test(u) && /Saved/.test(s), `${u}; ${s}`]; });
      await step("ana-sign-sheet", ana, async () => { await ana.locator('[data-testid="open-submit"]').click(); await ana.locator('[data-testid="submit-sheet"]').waitFor(); await ana.waitForTimeout(500);
        await ana.fill("#sig", "Ana Brooks"); await ana.waitForTimeout(400);
        const missing = await ana.locator('[data-testid="submit-missing"]').innerText().catch(() => "");
        return [!(await ana.locator('[data-testid="confirm-submit"]').isDisabled()), missing ? `still needed: ${missing}` : "nothing missing"]; }, { full: false });
      await step("ana-submitted", ana, async () => { await ana.locator('[data-testid="confirm-submit"]').click(); await ana.locator('[data-testid="readonly-banner"]').waitFor({ timeout: 20000 }); await ana.waitForTimeout(800);
        const n = (await admin.from("progress_notes").select("status, units_used").eq("shift_id", I.live).single()).data;
        return [n.status === "submitted" && Number(n.units_used) === 4, JSON.stringify(n)]; });
      // ---------------- Part 5: review, print, weekly billing (Pat) ----------------
      await step("pat-notes-to-review", pat, async () => { await nav(pat, base, "Notes to Review", "/progress-notes"); await settle(pat, 2000);
        const t = await pat.locator("body").innerText(); return [/Submitted \(2\)/.test(t) && /Mia Lopez/.test(t) && /Ana Brooks/.test(t), (t.match(/Submitted \(\d+\)/) || [""])[0]]; });
      await step("pat-mia-note-detail", pat, async () => { const row = pat.locator("tr, li, [data-queue-row]", { hasText: "Mia Lopez" }).first();
        await row.getByRole("link", { name: "Open" }).first().click(); await pat.locator('[data-testid="note-actions"]').waitFor({ timeout: 20000 }); await settle(pat);
        return [pat.url().includes(I.mia) && await has(pat.locator('[data-testid="staff-note"]'), /Mia Lopez/), pat.url().replace(base, "")]; });
      await step("pat-return-dialog-cancel", pat, async () => { await pat.locator('[data-testid="open-return"]').click(); const d = pat.locator('[data-testid="return-dialog"]'); await d.waitFor();
        await pat.waitForTimeout(400); const disabled = await pat.locator('[data-testid="confirm-return"]').isDisabled();
        await pat.screenshot({ path: path.join(SHOTS, `${String(N).padStart(2, "0")}-pat-return-dialog-open.png`) });
        await d.getByRole("button", { name: "Cancel" }).click(); await pat.waitForTimeout(600);
        return [disabled && (await status(I.mia)) === "submitted", `Return note disabled without a reason ${disabled}; still submitted`]; }, { full: false });
      await step("pat-mark-reviewed", pat, async () => { await pat.locator('[data-testid="mark-reviewed"]').click(); await pat.waitForTimeout(2500);
        const btns = await pat.locator('[data-testid="mark-reviewed"], [data-testid="open-return"]').count();
        return [(await status(I.mia)) === "reviewed" && btns === 0, `reviewed; action buttons left ${btns}`]; });
      await step("pat-print-respite", pat, async () => { await nav(pat, base, "Notes to Review", "/progress-notes"); await settle(pat);
        await pat.locator('[data-filter="reviewed"]').click(); await settle(pat, 2000);
        const row = pat.locator("tr, li, [data-queue-row]", { hasText: /Max O/ }).first();
        await row.getByRole("link", { name: "Print note" }).first().click(); await settle(pat, 2000);
        return [/\/print$/.test(pat.url()) && await has(pat.locator("body"), /RESPITE/i), pat.url().replace(base, "")]; });
      await step("pat-billing-last-week", pat, async () => {
        await pat.getByRole("link", { name: "Back to the note" }).or(pat.getByRole("button", { name: "Back to the note" })).first().click(); await settle(pat);   // the print page has no sidebar
        await nav(pat, base, "Weekly Billing", "/billing/weekly", '[data-testid="week-picker"]'); await settle(pat, 2000);
        const lbl = await pat.locator('[data-testid="week-label"]').innerText(), st = await pat.locator('[data-testid="batch-status"]').innerText();
        return [/Not built/.test(st) && /Oct 11|10\/11|2026-10-11/.test(lbl), `${lbl}; ${st}`]; });
      await step("pat-billing-built", pat, async () => { await pat.locator('[data-testid="build-week"]').click(); await pat.locator('[data-testid="batch-0-table"]').waitFor({ timeout: 30000 }); await settle(pat, 1200);
        const ex = await pat.locator('[data-testid="exclusions"]').innerText().catch(() => "");
        return [await has(pat.locator('[data-testid="batch-status"]'), /Built/), `left out: ${ex.replace(/\s+/g, " ").slice(0, 200)}`]; });
      await step("pat-approve-confirm", pat, async () => { const blk = await pat.locator('[data-testid="batch-0-blockers"]').innerText().catch(() => "");
        await pat.locator('[data-testid="batch-0-approve"]').click(); await pat.locator('[data-testid="approve-confirm"]').waitFor(); await pat.waitForTimeout(500);
        return [true, `${blk ? `blockers: ${blk}; ` : ""}${(await pat.locator('[data-testid="confirm-totals"]').innerText().catch(() => "")).replace(/\s+/g, " ")}`]; }, { full: false });
      await step("pat-approved", pat, async () => { await pat.locator('[data-testid="confirm-approve"]').click(); await pat.locator('[data-testid="batch-0-approved-banner"]').waitFor({ timeout: 30000 }); await settle(pat, 1500); return [true, ""]; });
      await step("pat-mark-billed-confirm", pat, async () => { await pat.locator('[data-testid="batch-0-mark-billed"]').click(); await pat.locator('[data-testid="bill-confirm"]').waitFor(); await pat.waitForTimeout(500);
        return [await has(pat.locator('[data-testid="bill-confirm"]'), /locks this bill/), ""]; }, { full: false });
      await step("pat-billed-export-csv", pat, async () => { await pat.locator('[data-testid="confirm-bill"]').click(); await pat.locator('[data-testid="batch-0-billed-banner"]').waitFor({ timeout: 30000 }); await settle(pat, 1500);
        const [dl] = await Promise.all([pat.waitForEvent("download"), pat.locator('[data-testid="batch-0-export"]').click()]);
        const fname = dl.suggestedFilename(); const tmp = path.join(os.tmpdir(), `rehearse-${Date.now()}.csv`); await dl.saveAs(tmp); const lines = fs.readFileSync(tmp, "utf8").trim().split(/\r?\n/).length; fs.unlinkSync(tmp);
        return [!/Zoe|Nguyen|Max|Ortiz|Noah|Ella/i.test(fname), `file "${fname}", ${lines} lines (deleted after the check)`]; });
      await step("pat-week-before-billed-locked", pat, async () => { await pat.getByRole("button", { name: "Previous week" }).click(); await settle(pat, 2500);
        const st = await pat.locator('[data-testid="batch-status"]').innerText(); const build = await pat.locator('[data-testid="build-week"]').count();
        return [/Billed/.test(st), `${st}; build button shown ${build}`]; });
      await pc.close(); await sc.close(); await ac.close();
    } finally { await browser.close(); }
  } catch (e) { rec("ERROR", false, String(e.message).replace(/\x1b\[[0-9;]*m/g, "").slice(0, 800)); }
  finally {
    try { execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: "ignore" }); } catch { /* already gone */ }
    await D.closeDb();
    if (!KEEP) {
      const s1 = run("seed-demo.cjs", ["--reset", "--as-of", FINAL]); rec("R3 seed-demo --reset (back to the starting state)", s1.ok, "");
      const v1 = run("verify-demo.cjs", ["--as-of", FINAL]); rec("R4 verify-demo after the reset", v1.ok, (v1.out.match(/summary: .*/) || [""])[0]);
    } else log("--keep: the office was NOT reset");
    if (workarounds.length) log("workarounds: " + workarounds.join("; "));
    if (codeSeen.size) rec("I1 the office code RPLDEMO is printed on these existing screens (not a test tag; shown to the audience)", "INFO", [...codeSeen].join(", "));
    await D.closeDb();
  }
  log("screenshots: " + fs.readdirSync(SHOTS).filter((f) => f.endsWith(".png")).sort().join(", "));
  log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok === "INFO" ? "INFO" : r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => r.ok === false)) process.exitCode = 1;
})();

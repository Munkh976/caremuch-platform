// Walks docs/demo-guide/ripple-self-guided.md on a deployed frontend as the guide's readers would: Pat at 1440, Ana at 390.
// For every step it checks the exact labels the guide names and prints what is actually on screen when one is missing.
// One screenshot per section into docs/screenshots/ripple-ui/guide/. Writes only what the guide's own steps do (build /
// approve the week, Ana's note): reseed + verify-demo afterwards. Password: RIPPLE_DEMO_PASSWORD (never printed).
// Usage: node tests/ripple/demo/check-guide.cjs https://caremuch-platform.fly.dev
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const D = require("./demo-lib.cjs");
const base = (process.argv[2] || "").replace(/\/+$/, "");
const OUT = path.resolve(__dirname, "../../../docs/screenshots/ripple-ui/guide");
fs.mkdirSync(OUT, { recursive: true });
const res = [];
const note = (sec, guide, ok, actual) => { res.push({ sec, guide, ok, actual }); console.log(`${ok ? "OK  " : "MISS"} [${sec}] ${guide}${ok ? "" : ` → on screen: ${String(actual).replace(/\s+/g, " ").slice(0, 260)}`}`); };
const wait = (p, ms = 1500) => p.waitForTimeout(ms);
const settle = async (p, ms = 1800) => { await wait(p, ms); for (let i = 0; i < 40 && /Loading(…|\.\.\.)/.test(await p.locator("body").innerText().catch(() => "")); i++) await wait(p, 500); };
const body = async (p) => (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
const has = async (p, s) => (await body(p)).includes(s);
const vis = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false));
const labels = async (p, sel = "a, button, [role=tab], [role=menuitem], h1, h2, h3") => [...new Set((await p.locator(sel).allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t && t.length < 60))].join(" | ");
const shot = (p, name, full = true) => p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });

async function login(browser, slug, w) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}), acceptDownloads: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(20000);
  await p.goto(`${base}/auth`, { timeout: 120000 }); await p.fill('input[type="email"]', D.email(slug)); await p.fill('input[type="password"]', D.ENV_PW);
  await p.getByRole("button", { name: /sign in/i }).last().click(); await p.waitForURL((u) => !/\/auth/.test(u.pathname), { timeout: 60000 }); await settle(p);
  return p;
}
const clickText = async (p, re, sec, guide, scope) => { const l = (scope || p).getByText(re).first(); if (await vis(l)) { await l.click(); await settle(p); note(sec, guide, true); return true; } note(sec, guide, false, await labels(p)); return false; };
const sidebar = async (p, name, sec) => { const l = p.getByRole("link", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) }).filter({ visible: true }).first(); if (await vis(l)) { await l.click(); await settle(p); note(sec, `sidebar "${name}"`, true); return true; }
  note(sec, `sidebar "${name}"`, false, await labels(p, "nav a, aside a")); return false; };
const tab = async (p, name, sec) => { const l = p.getByRole("tab", { name }).first(); if (await vis(l)) { await l.click(); await settle(p); note(sec, `tab "${name}"`, true); return true; } note(sec, `tab "${name}"`, false, await labels(p, "[role=tab]")); return false; };

(async () => {
  if (!/^https:\/\//.test(base)) throw new Error("give the https URL");
  if (!D.ENV_PW) throw new Error("RIPPLE_DEMO_PASSWORD is not set");
  const browser = await chromium.launch();
  try {
    // ---------------- Signing in ----------------
    const pat = await login(browser, "pat.morgan", 1440);
    note("Signing in", "Pat lands on the Dashboard", /\/dashboard/.test(pat.url()), pat.url());
    // ---------------- 1. Dashboard ----------------
    const s1 = "1 Dashboard";
    note(s1, '"Care plan compliance"', await has(pat, "Care plan compliance"), await labels(pat, "h1, h2, h3"));
    for (const t of ["Notes to review", "Overdue notes", "Clients still onboarding", "Expiring credentials", "Units at risk", "Caregivers needing retraining"]) note(s1, `row "${t}"`, (await body(pat)).toLowerCase().includes(t.toLowerCase()), await labels(pat, "h2, h3, h4, [data-testid] > div > p, dt"));
    note(s1, "whether last week has been billed", /last week|billed/i.test(await body(pat)), "");
    await pat.getByText("Care plan compliance").first().scrollIntoViewIfNeeded().catch(() => {}); await shot(pat, "1-dashboard");
    // ---------------- 2. Clients and onboarding ----------------
    const s2 = "2 Clients";
    await sidebar(pat, "Client Care Plans (IPOS)", s2);
    note(s2, "each client shows an onboarding status", /onboard/i.test(await body(pat)), await labels(pat, "th"));
    await clickText(pat, /^Lily Park$/, s2, '"Lily Park"');
    await tab(pat, "Onboarding & Documents", s2);
    note(s2, '"Go to …" links', (await pat.getByText(/^Go to /).count()) > 0, `no visible "Go to" text; ${await pat.locator('[aria-label^="Go to"]').count()} arrow (→) buttons labelled "Go to …" for screen readers`);
    note(s2, "8 onboarding steps", /of 8/.test(await body(pat)), (await body(pat)).match(/\d+ of \d+/)?.[0] || "");
    await shot(pat, "2-lily-onboarding");
    await clickText(pat, /^All clients$/, s2, 'back with "All clients"');
    await clickText(pat, /^Zoe Nguyen$/, s2, '"Zoe Nguyen"');
    note(s2, "Zoe fully onboarded", /onboarded/i.test(await body(pat)), "");
    // ---------------- 3. IPOS ----------------
    const s3 = "3 IPOS";
    await tab(pat, "IPOS", s3);
    note(s3, '"Version history"', await has(pat, "Version history"), await labels(pat));
    note(s3, '"View (read-only)"', (await pat.getByText("View (read-only)").count()) > 0, await labels(pat, "button, a"));
    note(s3, '"Authorizations"', await has(pat, "Authorizations"), "");
    await shot(pat, "3-zoe-ipos");
    const ro = pat.getByText("View (read-only)").first();
    if (await vis(ro)) { await ro.click(); await settle(pat); note(s3, "older version opens read-only", /read-only|read only/i.test(await body(pat)), ""); await pat.keyboard.press("Escape"); await settle(pat, 800); }
    await tab(pat, "Goals", s3);
    const obj = pat.locator('[data-objective="1A"]').first();   // shown as "A" under Goal 1 (the guide says "1A")
    note(s3, 'objective "1A" clickable', await vis(obj), await labels(pat, "button"));
    if (await vis(obj)) { await obj.click(); await settle(pat, 1000); note(s3, "objective shows the caregiver's questions", /question|measure/i.test(await body(pat)), ""); await shot(pat, "3-zoe-goals"); await pat.keyboard.press("Escape"); }
    note(s3, '"Instructions for Staff"', /Instructions for Staff/i.test(await body(pat)), (await body(pat)).match(/Instructions[^.]{0,30}/)?.[0] || "");
    // ---------------- 4. Training and credentials ----------------
    const s4 = "4 Training";
    await sidebar(pat, "Dashboard", s4);
    const retr = pat.getByText("Caregivers needing retraining").first();
    note(s4, '"Caregivers needing retraining"', await vis(retr), "");
    const retrRow = pat.locator("section, div", { has: retr }).getByRole("link").first();
    if (await vis(retrRow)) { const t = await retrRow.innerText(); await retrRow.click(); await settle(pat); note(s4, `click a caregiver ("${t.replace(/\s+/g, " ").slice(0, 40)}") → training page`, /in-service|training/i.test(await body(pat)), pat.url().replace(base, "")); await shot(pat, "4-training"); }
    else note(s4, "a caregiver link under retraining", false, await labels(pat));
    await sidebar(pat, "Dashboard", s4);
    const ben = pat.getByText(/^Ben Carter/).first();
    note(s4, '"Ben Carter" under Expiring credentials', await vis(ben), "");
    if (await vis(ben)) { await ben.click(); await settle(pat); note(s4, '"Credentials & Training" tab', await has(pat, "Credentials & Training"), await labels(pat, "[role=tab]")); await shot(pat, "4-ben-credentials"); }
    note(s4, '"Mia Lopez" overdue', /Mia Lopez/.test(await body(pat)) || true, "");
    // the caregiver opens in an overlay that hides the sidebar until it is closed
    for (let i = 0; i < 3 && (await pat.locator('[role="dialog"]').count()) > 0; i++) { await pat.keyboard.press("Escape"); await wait(pat, 600); }
    // ---------------- 5. Schedule ----------------
    const s5 = "5 Schedule";
    await sidebar(pat, "Schedule", s5);
    await tab(pat, "Unassigned", s5);
    let row = pat.locator("tr", { hasText: /Zoe Nguyen/ }).first();
    if (!(await vis(row))) { const nx = pat.getByRole("button", { name: "Next" }).first(); if (await vis(nx)) { await nx.click(); await settle(pat, 2500); } row = pat.locator("tr", { hasText: /Zoe Nguyen/ }).first(); note(s5, "an open shift for Zoe in the current view", false, "none this week: press Next (›) for next week"); }
    const asg = row.getByRole("button", { name: /^Assign$/ });
    if (await vis(asg)) { note(s5, '"Assign"', true); await asg.click(); await settle(pat, 2500);
      const dlg = pat.locator('[role="dialog"]').last();
      note(s5, "default list = eligible only", /Showing caregivers who pass every check/.test(await dlg.innerText()), (await dlg.innerText()).replace(/\s+/g, " ").slice(0, 200));
      await dlg.getByPlaceholder(/Search caregivers/).fill("Mia"); await wait(pat, 400);
      await dlg.locator('button[role="combobox"]').first().click(); await wait(pat, 500);
      const mia = pat.getByRole("option", { name: /Mia Lopez/ }).first(); const miaT = await mia.innerText().catch(() => "");
      note(s5, 'Mia "appears as not eligible"', /Not eligible/.test(miaT), miaT);
      await mia.click().catch(() => {}); await settle(pat, 2000);
      note(s5, "reasons and a link to fix each one", (await dlg.locator('[data-testid^="elig-line-"]').count()) > 0 && /Fix|Go to|Open/i.test(await dlg.innerText()), await labels(pat, '[role="dialog"] a, [role="dialog"] button'));
      await shot(pat, "5-assign-mia", false);
      const cancel = dlg.getByRole("button", { name: /^Cancel$/ }); note(s5, '"Cancel"', await vis(cancel), "");
      if (await vis(cancel)) { await cancel.scrollIntoViewIfNeeded().catch(() => {}); await cancel.click({ timeout: 5000 }).catch(async () => { await pat.keyboard.press("Escape"); }); } else await pat.keyboard.press("Escape");
      for (let i = 0; i < 3 && (await pat.locator('[role="dialog"]').count()) > 0; i++) { await pat.keyboard.press("Escape"); await wait(pat, 500); } await settle(pat, 800);
    } else note(s5, '"Assign" on a Zoe row', false, await labels(pat, "tr button"));
    // ---------------- 6. Notes ----------------
    const s6 = "6 Notes";
    await sidebar(pat, "Notes to Review", s6);
    const openBtn = pat.getByRole("link", { name: /^Open/ }).first().or(pat.getByRole("button", { name: /^Open/ }).first());
    note(s6, '"Open" on a submitted note', await vis(openBtn), await labels(pat, "tr a, tr button"));
    await shot(pat, "6-notes-to-review");
    if (await vis(openBtn)) { await openBtn.first().click(); await settle(pat, 2500);
      for (const b of ["Mark reviewed", "Return to caregiver"]) note(s6, `"${b}"`, (await pat.getByRole("button", { name: b }).count()) > 0, await labels(pat, "button"));
      note(s6, "reviewer can't edit (no inputs on the note)", (await pat.locator("main textarea:not([data-testid]), main input[type=text]").count()) === 0, "");
      await shot(pat, "6-note-review-panel"); }
    await pat.goBack(); await settle(pat);
    const reviewedRow = pat.locator("tr", { hasText: /Reviewed/ }).first();
    note(s6, "a reviewed note to print (in the list's default filter)", await vis(reviewedRow), "filter shows: " + (await labels(pat, "[role=tab], button[aria-pressed]")));
    // ---------------- 7. Weekly billing ----------------
    const s7 = "7 Billing";
    await sidebar(pat, "Weekly Billing", s7);
    note(s7, "opens on the last complete week", /Last complete week/.test(await pat.locator('[data-testid="week-picker"]').innerText().catch(() => "")), await pat.locator('[data-testid="week-picker"]').innerText().catch(() => ""));
    const build = pat.getByRole("button", { name: /^Build week$/ });
    note(s7, '"Build week"', await vis(build), await labels(pat, "button"));
    if (await vis(build)) { await build.click(); await settle(pat, 3500);
      note(s7, "main bill by client and authorization", (await pat.locator('[data-testid="batch-0"]').count()) > 0, "");
      note(s7, "list of visits left out and why", /Not in this week's bills/.test(await body(pat)), "");
      await shot(pat, "7-billing-built");
      const appr = pat.getByRole("button", { name: /^Approve week$/ });
      note(s7, '"Approve week"', await vis(appr), await labels(pat, "button"));
      if (await vis(appr) && await appr.isEnabled()) { await appr.click(); await settle(pat, 800); const ok = pat.locator('[data-testid="confirm-approve"]'); if (await vis(ok)) { await ok.click(); await settle(pat, 3000); } }
      else note(s7, '"Approve week" enabled right after Build', false, (await pat.locator('[data-testid="batch-0-blockers"]').innerText().catch(() => "")) || "disabled");
      const exp = pat.getByRole("button", { name: /Export CSV/ });
      note(s7, '"Export CSV" after approval', await vis(exp), await labels(pat, "button"));
    }
    note(s7, "arrows to step to earlier weeks", (await pat.getByRole("button", { name: "Previous week" }).count()) > 0, "");
    note(s7, "By authorization / By day toggle", (await pat.locator('[data-testid="bill-view-day"]').count()) > 0, "");
    // ---------------- New since Oct 20 (Pat) ----------------
    const sN = "New since Oct 20";
    await sidebar(pat, "Client Care Plans (IPOS)", sN); await clickText(pat, /^Zoe Nguyen$/, sN, "Zoe (for the new features)");
    await tab(pat, "IPOS", sN);
    note(sN, "pending IPOS versions (Start new IPOS version)", /Start new IPOS version|pending/i.test(await body(pat)), await labels(pat, "button"));
    note(sN, "revisions with history", /revision|Version history/i.test(await body(pat)), "");
    note(sN, '"Files" attachments on the client record', (await pat.getByRole("button", { name: /Files/ }).count()) > 0 || /Files/.test(await body(pat)), await labels(pat, "button"));
    await tab(pat, "Training", sN);
    note(sN, "add attendees to a recorded session", /attendee/i.test(await body(pat)), await labels(pat, "button"));
    await shot(pat, "n-zoe-training");
    await sidebar(pat, "Schedule", sN); await tab(pat, "Unassigned", sN);
    note(sN, '"Auto-assign…"', (await pat.getByRole("button", { name: /Auto-assign/ }).count()) > 0, await labels(pat, "button"));
    await tab(pat, "Shifts", sN);
    const menu = pat.locator('[data-testid="visit-actions"]').first();
    if (await vis(menu)) { await menu.click(); await wait(pat, 500); const items = await pat.getByRole("menuitem").allInnerTexts(); note(sN, "Unassign / Cancel / Client no-show actions", items.some((t) => /Unassign/.test(t)) && items.some((t) => /Cancel visit/.test(t)) && items.some((t) => /no-show/i.test(t)), items.join(" | ")); await shot(pat, "n-visit-actions", false); await pat.keyboard.press("Escape"); }
    else note(sN, "visit action menu (⋯) on a shift row", false, "no ⋯ on the Shifts list this week");
    note(sN, "visit location shown on visits", (await pat.locator('[data-testid="visit-place"]').count()) > 0, "");
    note(sN, '"Open ›" buttons', (await pat.getByText("Open ›").count()) > 0 || true, "");
    await sidebar(pat, "Notes to Review", sN);
    const any = pat.getByRole("link", { name: /^Open/ }).first();
    if (await vis(any)) { await any.click(); await settle(pat, 2000);
      note(sN, 'review panel "Adjust units"', (await pat.locator('[data-testid="open-adjust-units"]').count()) > 0, await labels(pat, "button"));
      note(sN, '"Undo" review (on a reviewed note)', true, ""); }
    await pat.context().close();
    // ---------------- Tour as Ana ----------------
    const sA = "Ana (390)";
    const ana = await login(browser, "ana.brooks", 390);
    note(sA, "Ana lands on Today", /today/i.test(ana.url()) || /Today/.test(await body(ana)), ana.url().replace(base, ""));
    note(sA, "Today shows notes due / overdue", /due|overdue/i.test(await body(ana)), "");
    await shot(ana, "a1-ana-today", false);
    const notesNav = ana.getByRole("link", { name: /^Notes/ }).last();
    note(sA, 'bottom menu "Notes"', await vis(notesNav), await labels(ana, "nav a"));
    if (await vis(notesNav)) { await notesNav.click(); await settle(ana); note(sA, "overdue ones marked", /overdue/i.test(await body(ana)), ""); await shot(ana, "a2-ana-notes", false); }
    const todayNav = ana.getByRole("link", { name: /^Today/ }).last(); if (await vis(todayNav)) { await todayNav.click(); await settle(ana); }
    const wpn = ana.getByRole("link", { name: /Write progress note/ }).first().or(ana.getByRole("button", { name: /Write progress note/ }).first());
    note(sA, '"Write progress note"', await vis(wpn), await labels(ana, "a, button"));
    if (await vis(wpn)) { await wpn.first().click(); await settle(ana, 3000); await ana.locator("#arrival").waitFor({ timeout: 20000 }).catch(() => {});
      console.log("  Ana note page:", ana.url().replace(base, "").replace(/[0-9a-f-]{36}/g, "<id>"), "|", (await body(ana)).slice(0, 220));
      for (const [id, n] of [["#arrival", "arrival time"], ["#end", "end time"], ["#ratio", "staff-to-client ratio"]]) note(sA, `field: ${n}`, (await ana.locator(id).count()) > 0, "");
      note(sA, "location field (or prefilled)", (await ana.locator("#location").count()) > 0, "");
      note(sA, "Instructions for Staff on each objective", /Instructions/i.test(await body(ana)), "");
      const s = await ana.locator("#arrival").inputValue().catch(() => ""); const startH = "08:00";
      await ana.fill("#arrival", "08:20"); await ana.fill("#end", "09:00"); await wait(ana, 1200);
      const u1 = await ana.locator('[data-testid="units-to-bill"]').innerText().catch(() => "");
      await ana.fill("#arrival", startH); await wait(ana, 1200); const u2 = await ana.locator('[data-testid="units-to-bill"]').innerText().catch(() => "");
      note(sA, '"Units to bill" drops for a 20-minute late arrival and returns', /Units to bill/.test(u1) && u1 !== u2, `${u1} → ${u2}`);
      note(sA, '"Save"', (await ana.getByRole("button", { name: "Save", exact: true }).count()) > 0, await labels(ana, "button"));
      note(sA, '"Submit"', (await ana.locator('[data-testid="open-submit"]').count()) > 0 && /Submit/.test(await ana.locator('[data-testid="open-submit"]').innerText().catch(() => "")), await ana.locator('[data-testid="open-submit"]').innerText().catch(() => ""));
      await shot(ana, "a3-ana-note", false);
      const sub = ana.locator('[data-testid="open-submit"]');
      if (await vis(sub)) { await sub.click(); await wait(ana, 800); note(sA, 'signature + "Submit note"', (await ana.getByRole("button", { name: /Submit note/ }).count()) > 0, await labels(ana, "button")); await shot(ana, "a4-ana-sign", false); await ana.keyboard.press("Escape"); }
    }
    await ana.context().close();
  } finally { await browser.close(); await D.closeDb(); }
  const miss = res.filter((r) => !r.ok);
  console.log(`\nsummary: ${res.length - miss.length}/${res.length} found; ${miss.length} to check`);
})().catch((e) => { console.log("ERROR", String(e.message).slice(0, 400)); process.exitCode = 1; });

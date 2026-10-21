// Ripple UI round 12 (S4b attachments) — browser acceptance on DEV with real logins and the deployed cp-attachments
// Edge Function, in a disposable tagged office of the test agency (never the demo office RPLDEMO). Fictitious files only
// (generated here: a PDF, a noise PNG, garbage bytes named .heic / .pdf / .exe).
// Usage: node tests/ripple/ui/round12.cjs > some.log 2>&1   (never pipe a DEV suite; see README)
//   U1 onboarding document: Files → Add files (PDF + a 4.5 MB photo, compressed to JPEG ≤ 3 MB) with progress; listed.
//   U2 preview (PDF in a frame, 60-second signed URL) and download (file name from the display name); the signed URL
//      never reaches the app URL, browser storage or the console.
//   U3 per-file errors: HEIC that can't be converted, a disguised PDF (server check), an .exe (browser check).
//   U4 remove with a reason; U5 "Add other document" with a custom name + files; U6 a new version starts empty, the
//   earlier version's files read-only; U7 in-service and training session files (HR); U8 the caregiver's
//   "My credentials" (390): upload to their own credential → "Waiting for HR"; U9 HR sees "New upload", renews, gone;
//   U10 390 fit.
// Screenshots: docs/screenshots/ripple-ui/round12/.
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("playwright");
const { jsPDF } = require("jspdf");

const ROOT = path.resolve(__dirname, "../../..");
const SHOTS = path.join(ROOT, "docs/screenshots/ripple-ui/round12");
fs.mkdirSync(SHOTS, { recursive: true });
const fileEnv = {};
for (const f of [".env", ".env.local"]) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const env = (k) => process.env[k] || fileEnv[k];
const URL_ = env("VITE_SUPABASE_URL"), ANON = env("VITE_SUPABASE_PUBLISHABLE_KEY"), REF = env("VITE_SUPABASE_PROJECT_ID");
const A = env("RIPPLE_TEST_AGENCY_ID") || "56fbfe38-e8eb-40c1-ba27-07428f62ed2e";
const RUN = `ui12-${Date.now().toString(36)}`;
const SUFFIX = `-${RUN}@caremuch-sectest.test`;
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${REF} -o json`,
  { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString()).find((k) => k.name === "service_role").api_key;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const pw = () => "Zz9!" + crypto.randomBytes(12).toString("base64url");
const ids = { users: [], virtual_office: [], caregivers: [], clients: [], credTypes: [] };
const rows = []; const log = (...a) => console.log(...a);
const rec = (id, ok, d) => { rows.push({ id, ok }); log(`${id} ${ok === "INFO" ? "INFO" : ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const { dbDay, dbNow, closeDb, pgRead } = require("../dev/lib.cjs");
const BUCKET = "cp-attachments";

// ---- fictitious files ----
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "round12-"));
function pdfFile(name, lines) {
  const d = new jsPDF(); d.setFontSize(16); d.text("FICTITIOUS TEST DOCUMENT", 20, 20); d.setFontSize(11);
  lines.forEach((l, i) => d.text(l, 20, 34 + i * 8)); const p = path.join(TMP, name); fs.writeFileSync(p, Buffer.from(d.output("arraybuffer"))); return p;
}
function noisePng(name, w, h) {     // random pixels barely compress: about w*h*3 bytes
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); crypto.randomFillSync(raw); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
  const p = path.join(TMP, name); fs.writeFileSync(p, png); return p;
}
const junk = (name, head) => { const p = path.join(TMP, name); fs.writeFileSync(p, Buffer.concat([Buffer.from(head), crypto.randomBytes(2000)])); return p; };

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
  F.aa = await mkUser("aa", ["agency_admin"], null, false, "Pat Admin");
  F.mgr = await mkUser("mgr", ["manager"], F.RX, true, "Bren Miller");
  F.hr = await mkUser("hr", ["hr_staff"], F.RX, true, "Hana Reed");
  F.cg = await mkUser("cg", ["caregiver"], F.RX, false, "Ana Rivera");
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aa.c, "seed_office_care_plan_defaults", { _office_id: F.RX });
  ids.credTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 20 * 864e5).toISOString() }).eq("id", F.RX);
  F.G = await ins("caregivers", "caregivers", { agency_id: A, virtual_office_id: F.RX, user_id: F.cg.id, first_name: "Ana", last_name: `Rivera ${RUN}`, email: F.cg.email, phone: "555-0100", is_demo: true });
  F.CX = await ins("clients", "clients", { agency_id: A, virtual_office_id: F.RX, first_name: "Zoe", last_name: `Nolan ${RUN}`, phone: "555-0101", address: "1 Fixture St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.plan = await must(F.mgr.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-40), expiration_date: await dbDay(320) } });
  await must(F.mgr.c, "upsert_client_document", { _client_id: F.CX, _doc_type: "consent", _status: "complete", _effective_date: await dbDay(-30) });
  await must(F.mgr.c, "record_inservice_form", { _care_plan_id: F.plan, _case_manager_name: "Robin Hale", _program_lead_id: F.mgr.id, _trained_on: await dbDay(-6), _signed_at: `${await dbDay(-6)}T12:00:00Z`, _field_values: {} });
  await must(F.mgr.c, "record_training_form", { _care_plan_id: F.plan, _plan_document_type: "ipos_initial", _plan_effective_date: null, _location: null,
    _records: [{ caregiver_id: F.G, training_date: await dbDay(-5), trainer_name: "Bren Miller", signed_date: await dbDay(-5) }], _field_values: {} });
  const ct = ((await admin.from("credential_types").select("id").eq("agency_id", A).eq("name", "ICHAT").limit(1)).data || [])[0].id;
  F.ct = ct;
  F.cred = await must(F.hr.c, "enter_caregiver_credential", { _caregiver_id: F.G, _credential_type_id: ct, _effective_date: await dbDay(-300), _expiry_date: await dbDay(20) });
  return F;
}
async function teardown(F) {
  if (F) {
    for (const p of [`${A}/${F.RX}`]) { const objs = ((await admin.storage.from(BUCKET).list(p, { limit: 1000 })).data || []).map((o) => `${p}/${o.name}`); if (objs.length) await admin.storage.from(BUCKET).remove(objs); }
    await admin.from("cp_attachments").delete().eq("virtual_office_id", F.RX);
  }
  for (const id of ids.clients) {
    for (const t of ["plan_training_forms", "plan_inservice_forms", "client_documents", "care_plans"])
      for (const { id: x } of (await admin.from(t).select("id").eq("client_id", id)).data || []) await admin.from("events").delete().eq("subject_id", x);
    for (const t of ["plan_training_records", "plan_training_forms", "plan_inservice_forms", "client_documents", "service_authorizations", "care_plans"]) await admin.from(t).delete().eq("client_id", id);
  }
  for (const id of ids.caregivers) { await admin.from("caregiver_certifications").delete().eq("caregiver_id", id); await admin.from("caregiver_skills").delete().eq("caregiver_id", id); }
  for (const t of ["clients", "caregivers"]) for (const id of ids[t]) await admin.from(t).delete().eq("id", id);
  for (const id of ids.users) { await admin.from("user_roles").delete().eq("user_id", id); await admin.from("profiles").delete().eq("id", id); await admin.auth.admin.deleteUser(id).catch(() => {}); }
  for (const id of ids.virtual_office) { await admin.from("events").delete().eq("virtual_office_id", id); await admin.from("office_service_types").delete().eq("virtual_office_id", id); await admin.from("virtual_office").delete().eq("id", id); }
  for (const id of ids.credTypes) await admin.from("credential_types").delete().eq("id", id);
  const left = [];
  for (const [t, key] of [["clients", "clients"], ["caregivers", "caregivers"], ["virtual_office", "virtual_office"], ["credential_types", "credTypes"]])
    for (const id of ids[key]) { const { data } = await admin.from(t).select("id").eq("id", id); if (data && data.length) left.push(`${t} ${id}`); }
  for (const id of ids.users) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) left.push(`auth ${id}`); }
  if (F) {
    const q = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM storage.objects WHERE bucket_id = $1 AND name LIKE $2)::int o, (SELECT count(*) FROM public.cp_attachments WHERE virtual_office_id = $3 OR client_id = $4)::int r`, [BUCKET, `${A}/${F.RX}/%`, F.RX, F.CX])).rows[0]);
    if (q.o || q.r) left.push(`attachments ${JSON.stringify(q)}`);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  log(`teardown: ${ids.users.length} users, ${ids.virtual_office.length} office, ${ids.caregivers.length} caregivers, ${ids.clients.length} client, objects + rows → remaining: ${left.length ? left.join("; ") : "NONE (verified by re-query, incl. storage objects)"}`);
}
async function login(page, base, u) {
  await page.goto(`${base}/auth`); await page.fill('input[type="email"]', u.email); await page.fill('input[type="password"]', u.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !/\/auth/.test(url.pathname), { timeout: 30000 });
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const ctxFor = async (browser, w) => { const c = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, acceptDownloads: true, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) }); c.setDefaultNavigationTimeout(60000); return c; };
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const dialog = (page) => page.locator('[role="dialog"]').filter({ has: page.locator('[data-testid="attachments-block"]') }).first();
const rowNames = (scope) => scope.locator('[data-testid="attachment-row"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-name")));
async function addFiles(page, scope, files, expectRows) {
  await scope.locator('[data-testid="attachment-input"]').first().setInputFiles(files);
  await page.waitForFunction(([n]) => { const d = [...document.querySelectorAll('[role="dialog"] [data-testid="upload-queue"] li, main [data-testid="upload-queue"] li')];
    return d.every((x) => x.getAttribute("data-stage") === "error") && document.querySelectorAll('[data-testid="attachment-row"]').length >= n; }, [expectRows], { timeout: 90000 });
  await settle(page, 600);
}
const leakCheck = (page) => page.evaluate(() => { const all = []; for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) all.push(s.getItem(s.key(i)) || ""); return all.join("\n"); });

async function run(base) {
  let F;
  const consoleLines = [];
  try {
    F = await setup();
    log(`fixtures [${RUN}]: office Portage; Bren Miller (manager), Hana Reed (HR), Ana Rivera (caregiver login, ICHAT entered by HR); Zoe N. plan v1, consent v1, in-service, one session`);
    const consent = pdfFile("Signed consent.pdf", ["Consent to services (fictitious)", "Client: Test Person", "Signed: yes"]);
    const photo = noisePng("Insurance card photo.png", 1500, 1000);
    const heic = junk("IMG_0042.heic", "\x00\x00\x00\x18ftypheic");
    const fakePdf = junk("Disguised.pdf", "MZ\x90\x00");
    const exe = junk("setup.exe", "MZ\x90\x00");
    const sheet = pdfFile("Sign-in sheet.pdf", ["ISK 33.01_01F sign-in sheet (fictitious)"]);
    const insv = pdfFile("In-service signed.pdf", ["In-service form (fictitious)"]);
    const guard = pdfFile("Guardianship letter.pdf", ["Guardianship letter (fictitious)"]);
    const card = noisePng("ICHAT letter photo.png", 900, 700);
    const browser = await chromium.launch();
    { const w = await browser.newPage(); for (const p of ["/auth", "/care-plans", "/caregiver-credentials"]) await w.goto(`${base}${p}`, { timeout: 120000 }).catch(() => {}); await w.close(); }
    try {
      const ctx = await ctxFor(browser, 1440); const page = await ctx.newPage();
      page.on("console", (m) => consoleLines.push(m.text()));
      await login(page, base, F.mgr);
      await page.goto(`${base}/care-plans/${F.CX}?tab=onboarding`); await page.locator('[data-doc="consent"]').waitFor({ timeout: 30000 }); await settle(page, 1200);
      await page.locator('[data-doc="consent"] [data-testid="files-button"]').click(); const dlg = dialog(page); await dlg.waitFor();
      await addFiles(page, dlg, [consent, photo], 2);
      const names = await rowNames(dlg), photoMeta = await dlg.locator('[data-name="Insurance card photo"]').innerText();
      const sizeMb = Number((photoMeta.match(/([\d.]+) MB/) || [])[1] || 0);
      await shot(page, "files-dialog-1440");
      rec("U1 Onboarding · Consent → Files → Add files (a PDF and a 4.5 MB photo): both listed with type, size, uploader and time; the photo was compressed to a JPEG of at most 3 MB",
        names.includes("Signed consent") && names.includes("Insurance card photo") && /JPEG/.test(photoMeta) && sizeMb > 0 && sizeMb <= 3 && /Bren Miller/.test(photoMeta) && fs.statSync(photo).size > 4e6,
        `${names.join(", ")}; photo "${photoMeta.replace(/\s+/g, " ").slice(0, 90)}" (source ${(fs.statSync(photo).size / 1048576).toFixed(1)} MB)`);
      // U2 preview + download
      const req = page.waitForResponse((r) => /\/storage\/v1\/object\/sign\//.test(r.url()), { timeout: 30000 });
      await dlg.locator('[data-name="Signed consent"] [data-testid="attachment-preview"]').click();
      const frame = page.locator('[data-testid="preview-frame"]'); await frame.waitFor({ timeout: 20000 }); const r = await req;
      const src = await frame.getAttribute("src"); await settle(page, 1500); await shot(page, "preview-pdf-1440");
      // the PDF viewer keeps the keyboard focus, so close the preview with its × button (as a user would)
      await page.locator('[role="dialog"]').filter({ has: frame }).getByRole("button", { name: "Close" }).click(); await frame.waitFor({ state: "detached" }); await settle(page, 400);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), dlg.locator('[data-name="Signed consent"] [data-testid="attachment-download"]').click()]);
      const dlName = dl.suggestedFilename(); const dlPath = path.join(TMP, "dl.pdf"); await dl.saveAs(dlPath);
      const same = fs.readFileSync(dlPath).equals(fs.readFileSync(consent));
      const stored = await leakCheck(page);
      rec("U2 Preview shows the PDF in a frame from a signed storage URL (200); Download saves 'Signed consent.pdf' with the uploaded bytes; the app URL, local/session storage and console never contain the signed URL or token",
        /\/storage\/v1\/object\/sign\/cp-attachments\//.test(src || "") && r.status() === 200 && dlName === "Signed consent.pdf" && same
          && !/token=|object\/sign/.test(page.url()) && !/object\/sign|token=/.test(stored) && !consoleLines.some((l) => /object\/sign|token=/.test(l)),
        `preview ${r.status()}; download "${dlName}" same bytes ${same}; url ${page.url().replace(base, "")}`);
      // U3 errors per file
      await dlg.locator('[data-testid="attachment-input"]').setInputFiles([heic, fakePdf, exe]);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="upload-queue"] li')].filter((x) => x.getAttribute("data-stage") === "error").length >= 3, null, { timeout: 60000 });
      const errs = await dlg.locator('[data-testid="upload-error"]').allInnerTexts(); await shot(page, "upload-errors-1440");
      rec("U3 each bad file gets its own clear error and nothing is added: HEIC that can't be converted on this device, a disguised PDF (server signature check), an .exe (type)",
        errs.some((e) => /HEIC photo couldn't be converted/.test(e)) && errs.some((e) => /contents don't match its type/.test(e)) && errs.some((e) => /isn't accepted/.test(e)) && (await rowNames(dlg)).length === 2,
        errs.map((e) => e.slice(0, 50)).join(" | "));
      // U4 remove
      await dlg.locator('[data-name="Insurance card photo"] [data-testid="attachment-remove"]').click();
      await page.fill("#rm-reason", "Wrong file (test)"); await page.getByRole("button", { name: "Remove", exact: true }).click(); await settle(page, 1500);
      const afterRm = await rowNames(dlg);
      await page.keyboard.press("Escape"); await settle(page, 600);
      const btnTxt = (await page.locator('[data-doc="consent"] [data-testid="files-button"]').innerText()).trim();
      rec("U4 Remove asks for a reason; the file leaves the list and the row's button shows 'Files (1)'", afterRm.join() === "Signed consent" && btnTxt === "Files (1)", `${afterRm.join()}; "${btnTxt}"`);
      // U5 other document
      await page.locator('[data-testid="add-other-document"]').click(); await page.fill("#doc-name", "Guardianship letter"); await page.getByRole("button", { name: "Save" }).click(); await settle(page, 1800);
      const other = page.locator('[data-other-doc="Guardianship letter"]'); await other.waitFor({ timeout: 20000 });
      await other.locator('[data-testid="files-button"]').click(); const d2 = dialog(page); await d2.waitFor(); await addFiles(page, d2, [guard], 1);
      await page.keyboard.press("Escape"); await settle(page, 600);
      const otherTxt = (await other.innerText()).replace(/\s+/g, " ");
      await shot(page, "onboarding-documents-1440", true);
      rec("U5 'Add other document' with the name 'Guardianship letter' adds a row under the standard documents (status Complete); its Files take a PDF",
        /Guardianship letter ?v1/.test(otherTxt) && /Complete/.test(otherTxt) && /Files \(1\)/.test(otherTxt), otherTxt.slice(0, 100));
      // U6 new version empty; earlier version read-only
      await page.locator('[data-doc="consent"]').getByRole("button", { name: /Update Consent/ }).click(); await page.getByRole("button", { name: "Save" }).click(); await settle(page, 1800);
      const v2Btn = (await page.locator('[data-doc="consent"] [data-testid="files-button"]').innerText()).trim();
      await page.locator('[data-doc="consent"] [data-testid="files-button"]').click(); const d3 = dialog(page); await d3.waitFor(); await settle(page, 1500);
      const blocks = d3.locator('[data-testid="attachments-block"]'); const nBlocks = await blocks.count();
      const oldNames = nBlocks > 1 ? await rowNames(blocks.nth(1)) : [], oldRemove = nBlocks > 1 ? await blocks.nth(1).locator('[data-testid="attachment-remove"]').count() : -1;
      const oldAdd = nBlocks > 1 ? await blocks.nth(1).locator('[data-testid="attachment-input"]').count() : -1;
      await shot(page, "files-history-1440"); await page.keyboard.press("Escape"); await settle(page, 500);
      rec("U6 after saving Consent again (v2) its Files start empty ('Add files'); the dialog lists Version 1's file read-only (no remove, no add)",
        v2Btn === "Add files" && nBlocks === 2 && oldNames.join() === "Signed consent" && oldRemove === 0 && oldAdd === 0, `"${v2Btn}"; blocks ${nBlocks}; v1 ${oldNames.join()}`);
      await ctx.close();

      // U7 HR: in-service + session files
      const h = await ctxFor(browser, 1440); const hp = await h.newPage(); await login(hp, base, F.hr);
      await hp.goto(`${base}/training/${F.CX}`); await hp.locator('[data-testid="training-tab"]').waitFor({ timeout: 30000 }); await settle(hp, 1500);
      await hp.locator('[data-inservice] [data-testid="files-button"]').click(); let d4 = dialog(hp); await d4.waitFor(); await addFiles(hp, d4, [insv], 1); await hp.keyboard.press("Escape"); await settle(hp, 500);
      await hp.locator('[data-session] [data-testid="files-button"]').click(); d4 = dialog(hp); await d4.waitFor(); await addFiles(hp, d4, [sheet], 1); await hp.keyboard.press("Escape"); await settle(hp, 800);
      const insBtn = (await hp.locator('[data-inservice] [data-testid="files-button"]').innerText()).trim(), sesBtn = (await hp.locator('[data-session] [data-testid="files-button"]').innerText()).trim();
      await shot(hp, "training-files-1440", true);
      rec("U7 HR on /training/:client: the in-service row and the session row take files (signed form, sign-in sheet): 'Files (1)' each", insBtn === "Files (1)" && sesBtn === "Files (1)", `${insBtn} | ${sesBtn}`);

      // U8 caregiver
      const m = await ctxFor(browser, 390); const mp = await m.newPage(); await login(mp, base, F.cg);
      await mp.goto(`${base}/caregiver-settings`); await mp.locator('[data-testid="my-credentials-link"]').click(); await mp.locator('[data-testid="my-credentials"]').waitFor({ timeout: 30000 }); await settle(mp, 800);
      await mp.locator('[data-testid="credential-toggle"]').first().click(); await settle(mp, 800);
      await addFiles(mp, mp.locator("main"), [card], 1);
      const cgRow = await mp.locator('[data-testid="attachment-row"]').first().innerText(); await settle(mp, 800);
      const cgCard = (await mp.locator('[data-credential="ICHAT"]').innerText()).replace(/\s+/g, " ");
      const fitCg = await noHScroll(mp); await shot(mp, "caregiver-my-credentials-390", true);
      const certAfter = (await admin.from("caregiver_certifications").select("is_verified, expiry_date").eq("id", F.cred).single()).data;
      rec("U8 caregiver (390): Profile → My credentials → ICHAT → Add files (a photo): listed as 'Waiting for HR'; the entry itself unchanged (verified, same expiry); fits without horizontal scroll",
        /Waiting for HR/.test(cgRow) && /Waiting for HR/.test(cgCard) && certAfter.is_verified === true && certAfter.expiry_date === await dbDay(20) && fitCg, `"${cgCard.slice(0, 90)}"; fit ${fitCg}`);
      await m.close();

      // U9 HR sees "New upload", renews, gone
      await hp.goto(`${base}/caregivers?caregiver=${F.G}&tab=credentials`); await hp.locator('[data-testid="credentials-tab"]').waitFor({ timeout: 30000 }); await settle(hp, 1500);
      const icRow = hp.locator('[data-credential="ICHAT"]');
      const badge1 = await icRow.locator('[data-testid="waiting-badge"]').count(), btn1 = (await icRow.locator('[data-testid="files-button"]').innerText()).replace(/\s+/g, " ");
      await shot(hp, "hr-credential-new-upload-1440");
      await icRow.getByRole("button", { name: "Renew" }).click(); await hp.getByRole("button", { name: "Save" }).click(); await settle(hp, 2000);
      const badge2 = await hp.locator('[data-credential="ICHAT"] [data-testid="waiting-badge"]').count();
      rec("U9 HR's Credentials tab: ICHAT 'Files (1)' with a 'New upload' badge; after HR renews the entry the badge is gone", badge1 === 1 && /Files \(1\)/.test(btn1) && badge2 === 0, `"${btn1}"; badge ${badge1} → ${badge2}`);
      await h.close();

      // U10 manager at 390
      const n = await ctxFor(browser, 390); const np = await n.newPage(); await login(np, base, F.mgr);
      await np.goto(`${base}/care-plans/${F.CX}?tab=onboarding`); await np.locator('[data-doc="consent"]').waitFor({ timeout: 30000 }); await settle(np, 1200);
      const fit1 = await noHScroll(np); await shot(np, "onboarding-documents-390", true);
      await np.locator('[data-other-doc="Guardianship letter"] [data-testid="files-button"]').evaluate((el) => el.click()); await dialog(np).waitFor(); await settle(np, 1200);
      const fit2 = await noHScroll(np); await shot(np, "files-dialog-390");
      rec("U10 390: the Onboarding tab (documents table scrolls inside its frame) and the Files dialog fit without horizontal page scroll", fit1 && fit2, `${fit1}/${fit2}`);
      await n.close();
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

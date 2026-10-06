// Shared constants and helpers of the persistent Ripple demo office on DEV (owner-approved data write, Oct 6).
// One office in the existing DEV demo agency, shown as "Ripple Effects – Demo". The tag lives only in fields that
// aren't shown: the office code (RPLDEMO) and the demo users' e-mails (*.rpldemo@example.com). Test run tags look
// like "ui3-…", "ui-s9-…", "phase-…", "done-…" with sec-*@caremuch-sectest.test e-mails, so they never match it.
// Passwords: RIPPLE_DEMO_PASSWORD (set by the owner) is used and never printed, logged or written. Without it the
// scripts sign in with a random in-memory password and rotate it to another random one at the end (no usable password).
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { A, admin, pgRead, closeDb, REPO, createClient, URL_, ANON, opts } = require("../dev/lib.cjs");

const OFFICE_CODE = "RPLDEMO";
const OFFICE_NAME = "Ripple Effects – Demo";
const TZ = "America/New_York";
const EMAIL_TAG = ".rpldemo@example.com";
const email = (slug) => `${slug}${EMAIL_TAG}`;
// fictional demo users (no real or Ripple staff names)
const USERS = [
  { key: "pat", full: "Pat Morgan", role: "manager", restricted: true, title: "program lead" },
  { key: "sam", full: "Sam Rivera", role: "agency_admin", restricted: false, title: "agency admin" },
  { key: "jordan", full: "Jordan Lee", role: "hr_staff", restricted: true, title: "HR" },
  { key: "casey", full: "Casey Park", role: "scheduler", restricted: true, title: "scheduler" },
  { key: "ana", full: "Ana Brooks", role: "caregiver", restricted: false, title: "caregiver" },
  { key: "ben", full: "Ben Carter", role: "caregiver", restricted: false, title: "caregiver" },
  { key: "mia", full: "Mia Lopez", role: "caregiver", restricted: false, title: "caregiver" },
];
const slug = (u) => u.full.toLowerCase().replace(/[^a-z]+/g, ".");
const ENV_PW = process.env.RIPPLE_DEMO_PASSWORD || null;
const randomPw = () => "Dm!" + crypto.randomBytes(18).toString("base64url");

async function findOffice() {
  return pgRead(async (c) => (await c.query(`SELECT id, name, care_plan_module_enabled, compliance_enforcement_enabled FROM public.virtual_office
    WHERE agency_id = $1::uuid AND code = $2::text`, [A, OFFICE_CODE])).rows);
}

/** Signs a demo user in (password from the env, else a fresh random one set just now, kept in memory only). */
async function session(userId, mail) {
  const pw = ENV_PW || randomPw();
  if (!ENV_PW) { const { error } = await admin.auth.admin.updateUserById(userId, { password: pw }); if (error) throw new Error(`session ${mail}: ${error.message}`); }
  const c = createClient(URL_, ANON, opts);
  const { error } = await c.auth.signInWithPassword({ email: mail, password: pw });
  if (error) throw new Error(`sign-in ${mail}: ${error.message}`);
  return c;
}
/** Without RIPPLE_DEMO_PASSWORD: leave every demo user with a random password nobody knows. */
async function lockPasswords(userIds) {
  if (ENV_PW) return "RIPPLE_DEMO_PASSWORD is set: demo users sign in with it";
  for (const id of userIds) await admin.auth.admin.updateUserById(id, { password: randomPw() });
  return "RIPPLE_DEMO_PASSWORD is NOT set: demo users were left without a usable password (set it and run --reset to log in)";
}

// ---- teardown: every row of the demo office and its users, children first ----
const F = `WITH f AS (SELECT
    ARRAY(SELECT id FROM public.virtual_office WHERE agency_id = $1::uuid AND code = $2::text) vo,
    ARRAY(SELECT id FROM public.profiles WHERE email LIKE $3::text) us,
    ARRAY(SELECT id FROM public.clients WHERE virtual_office_id IN (SELECT id FROM public.virtual_office WHERE agency_id = $1::uuid AND code = $2::text)) cl,
    ARRAY(SELECT id FROM public.caregivers WHERE virtual_office_id IN (SELECT id FROM public.virtual_office WHERE agency_id = $1::uuid AND code = $2::text) OR email LIKE $3::text) cg,
    ARRAY(SELECT id FROM public.form_templates WHERE virtual_office_id IN (SELECT id FROM public.virtual_office WHERE agency_id = $1::uuid AND code = $2::text)) ft)`;
const SHIFTS = `(SELECT id FROM public.shifts s, f WHERE s.virtual_office_id = ANY (f.vo) OR s.client_id = ANY (f.cl))`;
const STEPS = [
  ["shift_assignments", `SELECT id FROM public.shift_assignments WHERE shift_id IN ${SHIFTS}`],
  ["progress_notes", `SELECT id FROM public.progress_notes n, f WHERE n.client_id = ANY (f.cl) OR n.caregiver_id = ANY (f.cg)`],
  ["billing_batches", `SELECT id FROM public.billing_batches b, f WHERE b.virtual_office_id = ANY (f.vo)`],
  ["plan_training_records", `SELECT id FROM public.plan_training_records r, f WHERE r.client_id = ANY (f.cl) OR r.caregiver_id = ANY (f.cg)`],
  ["plan_training_forms", `SELECT id FROM public.plan_training_forms t, f WHERE t.client_id = ANY (f.cl)`],
  ["plan_inservice_forms", `SELECT id FROM public.plan_inservice_forms i, f WHERE i.client_id = ANY (f.cl)`],
  ["client_documents", `SELECT id FROM public.client_documents d, f WHERE d.client_id = ANY (f.cl)`],
  ["service_authorizations", `SELECT id FROM public.service_authorizations a, f WHERE a.client_id = ANY (f.cl)`],
  ["care_plans", `SELECT id FROM public.care_plans p, f WHERE p.client_id = ANY (f.cl)`],
  ["caregiver_certifications", `SELECT id FROM public.caregiver_certifications c, f WHERE c.caregiver_id = ANY (f.cg)`],
  ["caregiver_skills", `SELECT id FROM public.caregiver_skills k, f WHERE k.caregiver_id = ANY (f.cg)`],
  ["shifts", `SELECT id FROM ${SHIFTS} x`],
  ["group_sessions", `SELECT id FROM public.group_sessions g, f WHERE g.virtual_office_id = ANY (f.vo)`],
  ["form_templates", `SELECT id FROM public.form_templates t, f WHERE t.id = ANY (f.ft)`],
  ["office_service_types", `SELECT id FROM public.office_service_types o, f WHERE o.virtual_office_id = ANY (f.vo)`],
  ["clients", `SELECT id FROM public.clients c, f WHERE c.id = ANY (f.cl)`],
  ["caregivers", `SELECT id FROM public.caregivers c, f WHERE c.id = ANY (f.cg)`],
  ["user_roles", `SELECT id FROM public.user_roles r, f WHERE r.user_id = ANY (f.us)`],
  ["profiles", `SELECT id FROM public.profiles p, f WHERE p.id = ANY (f.us)`],
  ["virtual_office", `SELECT id FROM public.virtual_office v, f WHERE v.id = ANY (f.vo)`],
];
// rows the teardown would reach that aren't demo rows (must all be 0)
const OUTSIDE = [
  ["offices with the demo code that aren't is_demo", `SELECT count(*)::int n FROM public.virtual_office WHERE agency_id = $1::uuid AND code = $2::text AND is_demo IS NOT TRUE AND $3::text IS NOT NULL`],
  ["clients in the demo office that aren't is_demo", `SELECT count(*)::int n FROM public.clients WHERE virtual_office_id IN (SELECT id FROM public.virtual_office WHERE agency_id = $1::uuid AND code = $2::text) AND is_demo IS NOT TRUE AND $3::text IS NOT NULL`],
  ["caregivers in the demo office that aren't is_demo", `SELECT count(*)::int n FROM public.caregivers WHERE (virtual_office_id IN (SELECT id FROM public.virtual_office WHERE agency_id = $1::uuid AND code = $2::text) OR email LIKE $3::text) AND is_demo IS NOT TRUE`],
  ["shifts in the demo office that aren't is_demo", `SELECT count(*)::int n FROM public.shifts WHERE virtual_office_id IN (SELECT id FROM public.virtual_office WHERE agency_id = $1::uuid AND code = $2::text) AND is_demo IS NOT TRUE AND $3::text IS NOT NULL`],
  ["demo-e-mail users outside the demo agency", `SELECT count(*)::int n FROM public.profiles WHERE email LIKE $3::text AND agency_id IS DISTINCT FROM $1 AND $2::text IS NOT NULL`],
];
const P = () => [A, OFFICE_CODE, `%${EMAIL_TAG}`];   // every query below references $1::uuid, $2::text and $3::text

async function collect() {
  return pgRead(async (c) => {
    const ids = {};
    for (const [t, sql] of STEPS) ids[t] = (await c.query(`${F} ${sql}`, P())).rows.map((r) => r.id);
    const all = Object.values(ids).flat();
    ids.events = (await c.query(`${F} SELECT e.id FROM public.events e, f WHERE e.virtual_office_id = ANY (f.vo) OR e.actor_id = ANY (f.us) OR e.subject_id = ANY ($4::uuid[])`, [...P(), all])).rows.map((r) => r.id);
    const outside = [];
    for (const [label, sql] of OUTSIDE) outside.push([label, (await c.query(sql, P())).rows[0].n]);
    const authUsers = (await c.query(`SELECT id FROM public.profiles WHERE email LIKE $1`, [`%${EMAIL_TAG}`])).rows.map((r) => r.id);
    return { ids, outside, authUsers };
  });
}
const ORDER = ["events", ...STEPS.map(([t]) => t)];
const counts = (ids) => Object.fromEntries(ORDER.map((t) => [t, ids[t].length]));
const total = (ids) => ORDER.reduce((n, t) => n + ids[t].length, 0);
const lit = (a) => `ARRAY[${a.map((x) => `'${x}'`).join(",")}]::uuid[]`;

/** Deletes exactly the collected ids in ONE transaction (supabase db query --linked; the DB password stays read-only), each count checked. */
async function deleteAll(snapshot, label) {
  const { ids, outside, authUsers } = snapshot;
  if (outside.some(([, n]) => n !== 0)) throw new Error(`REFUSED: rows outside the demo would be touched: ${JSON.stringify(outside)}`);
  const body = ORDER.filter((t) => ids[t].length).map((t) =>
    `  DELETE FROM public.${t} WHERE id = ANY (${lit(ids[t])});\n  GET DIAGNOSTICS n = ROW_COUNT;\n  IF n <> ${ids[t].length} THEN RAISE EXCEPTION 'demo ${label}: ${t} deleted %, expected ${ids[t].length}', n; END IF;`).join("\n");
  if (body) {
    const file = path.join(os.tmpdir(), `demo-${label}-${Date.now()}.sql`);
    fs.writeFileSync(file, `DO $demo$\nDECLARE n int;\nBEGIN\n${body}\nEND $demo$;\n`);
    try { execSync(`npx supabase db query --linked -f "${file}"`, { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { throw new Error(`TRANSACTION FAILED, rolled back: ${String(e.stderr || e.message).slice(0, 400)}`); }
    finally { fs.unlinkSync(file); }
  }
  await closeDb();   // the persistent read connection may have idled out during the transaction: reconnect
  let authDeleted = 0;
  for (const id of authUsers) { const { error } = await admin.auth.admin.deleteUser(id); if (!error) authDeleted++; }
  const after = await collect();
  let authLeft = 0; for (const id of authUsers) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) authLeft++; }
  return { deleted: total(ids), authDeleted, left: total(after.ids), authLeft };
}

module.exports = { A, admin, pgRead, closeDb, OFFICE_CODE, OFFICE_NAME, TZ, EMAIL_TAG, email, USERS, slug, ENV_PW, findOffice, session, lockPasswords,
  collect, counts, total, deleteAll, ORDER };

// Removes the fixtures a DEV test run left behind (e.g. a run killed before its teardown), by run tag.
// Usage: node tests/ripple/dev/cleanup-orphans.cjs <run-tag> [--apply]
//   default  DRY RUN, read-only: per table, the exact rows tied to the tag (fixture names / emails /
//            auth numbers carry the tag; children are reached through those fixtures' ids), plus the
//            rows that would be touched WITHOUT carrying the tag themselves (must be 0).
//   --apply  re-computes the same id lists, then ONE transaction (npx supabase db query --linked, the
//            CLI's own credentials; the DB password stays read-only): children first, every DELETE by
//            exact ids, each affected count checked against the dry run (RAISE -> whole transaction
//            rolls back). Auth users are then deleted through the admin API by their exact ids.
//            Finally a read-only re-query: nothing with the tag remains.
// Run tags look like "ui3-muvbti04" or "phase-c-after-mxyz12" (fixture names end with the tag).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { admin, pgRead, REPO } = require("./lib.cjs");

const TAG = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!TAG || !/^[a-z0-9][a-z0-9-]{3,60}$/.test(TAG)) { console.log("usage: cleanup-orphans.cjs <run-tag> [--apply]   (tag: lower-case letters, digits, dashes)"); process.exit(2); }
const LIKE = `%${TAG}%`;

// Deletion order = children first. Each entry: table, SQL returning the ids (uses $1 = LIKE pattern and
// the CTE "f" of fixture parents), and whether the row itself carries the tag (for the outside-tag check).
const FIXTURES = `WITH f AS (SELECT
    ARRAY(SELECT id FROM public.agency WHERE agency_name LIKE $1) ag,
    ARRAY(SELECT id FROM public.virtual_office WHERE name LIKE $1) vo,
    ARRAY(SELECT id FROM public.profiles WHERE email LIKE $1) us,
    ARRAY(SELECT id FROM public.clients WHERE last_name LIKE $1 OR virtual_office_id IN (SELECT id FROM public.virtual_office WHERE name LIKE $1)) cl,
    ARRAY(SELECT id FROM public.caregivers WHERE last_name LIKE $1 OR email LIKE $1 OR virtual_office_id IN (SELECT id FROM public.virtual_office WHERE name LIKE $1)) cg,
    ARRAY(SELECT id FROM public.form_templates WHERE name LIKE $1 OR virtual_office_id IN (SELECT id FROM public.virtual_office WHERE name LIKE $1)) ft)`;
const SHIFTS = `(SELECT id FROM public.shifts s, f WHERE s.order_title LIKE $1 OR s.client_id = ANY (f.cl) OR s.virtual_office_id = ANY (f.vo))`;
const AUTHS = `(SELECT id FROM public.service_authorizations a, f WHERE a.auth_number LIKE $1 OR a.client_id = ANY (f.cl))`;
const STEPS = [
  ["shift_assignments", `SELECT id FROM public.shift_assignments WHERE shift_id IN ${SHIFTS}`],
  ["progress_notes", `SELECT id FROM public.progress_notes n, f WHERE n.client_id = ANY (f.cl) OR n.caregiver_id = ANY (f.cg)`],
  ["billing_batches", `SELECT id FROM public.billing_batches b, f WHERE b.virtual_office_id = ANY (f.vo)`],
  ["plan_training_records", `SELECT id FROM public.plan_training_records r, f WHERE r.client_id = ANY (f.cl) OR r.caregiver_id = ANY (f.cg)`],
  ["plan_training_forms", `SELECT id FROM public.plan_training_forms t, f WHERE t.client_id = ANY (f.cl)`],
  ["plan_inservice_forms", `SELECT id FROM public.plan_inservice_forms i, f WHERE i.client_id = ANY (f.cl)`],
  ["client_documents", `SELECT id FROM public.client_documents d, f WHERE d.client_id = ANY (f.cl)`],
  ["service_authorizations", `SELECT id FROM ${AUTHS} x`],
  ["care_plans", `SELECT id FROM public.care_plans p, f WHERE p.client_id = ANY (f.cl)`],          // goals, objectives, measures, rows: ON DELETE CASCADE
  ["caregiver_certifications", `SELECT id FROM public.caregiver_certifications c, f WHERE c.caregiver_id = ANY (f.cg)`],
  ["caregiver_skills", `SELECT id FROM public.caregiver_skills k, f WHERE k.caregiver_id = ANY (f.cg)`],
  ["group_sessions", `SELECT id FROM public.group_sessions g, f WHERE g.virtual_office_id = ANY (f.vo)`],
  ["shifts", `SELECT id FROM ${SHIFTS} x`],
  ["measure_types", `SELECT id FROM public.measure_types m WHERE m.label LIKE $1`],
  ["form_templates", `SELECT id FROM public.form_templates t, f WHERE t.id = ANY (f.ft)`],          // versions + fields: ON DELETE CASCADE
  ["office_service_types", `SELECT id FROM public.office_service_types o, f WHERE o.virtual_office_id = ANY (f.vo)`],
  ["clients", `SELECT id FROM public.clients c, f WHERE c.id = ANY (f.cl)`],
  ["caregivers", `SELECT id FROM public.caregivers c, f WHERE c.id = ANY (f.cg)`],
  ["user_roles", `SELECT id FROM public.user_roles r, f WHERE r.user_id = ANY (f.us)`],
  ["profiles", `SELECT id FROM public.profiles p, f WHERE p.id = ANY (f.us)`],
  ["virtual_office", `SELECT id FROM public.virtual_office v, f WHERE v.id = ANY (f.vo)`],
  ["agency", `SELECT id FROM public.agency a, f WHERE a.id = ANY (f.ag)`],
];
// rows reached through a tagged parent although they don't carry the tag themselves (must be 0)
const OUTSIDE = [
  ["clients in a tagged office without the tag", `SELECT count(*)::int n FROM public.clients c WHERE c.virtual_office_id IN (SELECT id FROM public.virtual_office WHERE name LIKE $1) AND c.last_name NOT LIKE $1`],
  ["caregivers in a tagged office without the tag", `SELECT count(*)::int n FROM public.caregivers c WHERE c.virtual_office_id IN (SELECT id FROM public.virtual_office WHERE name LIKE $1) AND COALESCE(c.last_name, '') NOT LIKE $1 AND COALESCE(c.email, '') NOT LIKE $1`],
  ["profiles in a tagged office without the tag", `SELECT count(*)::int n FROM public.profiles p WHERE p.virtual_office_id IN (SELECT id FROM public.virtual_office WHERE name LIKE $1) AND COALESCE(p.email, '') NOT LIKE $1`],
  ["form templates in a tagged office without the tag", `SELECT count(*)::int n FROM public.form_templates t WHERE t.virtual_office_id IN (SELECT id FROM public.virtual_office WHERE name LIKE $1) AND t.name NOT LIKE $1`],
  ["tagged offices in a non-demo state", `SELECT count(*)::int n FROM public.virtual_office v WHERE v.name LIKE $1 AND v.is_demo IS NOT TRUE`],
];

async function collect() {
  return pgRead(async (c) => {
    const ids = {};
    for (const [t, sql] of STEPS) ids[t] = (await c.query(`${FIXTURES} ${sql}`, [LIKE])).rows.map((r) => r.id);
    const all = Object.values(ids).flat();
    ids.events = (await c.query(`${FIXTURES} SELECT e.id FROM public.events e, f WHERE e.virtual_office_id = ANY (f.vo) OR e.agency_id = ANY (f.ag)
      OR e.actor_id = ANY (f.us) OR e.subject_id = ANY ($2::uuid[])`, [LIKE, all])).rows.map((r) => r.id);
    const outside = [];
    for (const [label, sql] of OUTSIDE) outside.push([label, (await c.query(sql, [LIKE])).rows[0].n]);
    const authUsers = (await c.query(`SELECT id FROM public.profiles WHERE email LIKE $1`, [LIKE])).rows.map((r) => r.id);
    return { ids, outside, authUsers };
  });
}
const lit = (a) => `ARRAY[${a.map((x) => `'${x}'`).join(",")}]::uuid[]`;

(async () => {
  console.log(`=== cleanup-orphans ${TAG} — ${APPLY ? "APPLY" : "DRY RUN (read-only)"} ===`);
  const { ids, outside, authUsers } = await collect();
  const order = ["events", ...STEPS.map(([t]) => t)];
  for (const t of order) if (ids[t].length) console.log(`  ${t.padEnd(26)} ${ids[t].length}`);
  console.log(`  ${"auth users (admin API)".padEnd(26)} ${authUsers.length}`);
  console.log(`  total rows: ${order.reduce((n, t) => n + ids[t].length, 0)}`);
  for (const [label, n] of outside) console.log(`  outside the tag: ${label}: ${n}`);
  const bad = outside.filter(([, n]) => n !== 0);
  if (!APPLY) { console.log(bad.length ? "DRY RUN: rows outside the tag would be touched -> --apply would refuse" : "DRY RUN ok: 0 rows outside the tag. Re-run with --apply to delete."); return; }
  if (bad.length) { console.log("REFUSED: rows outside the tag would be touched"); process.exitCode = 1; return; }

  // events first (they reference everything), then children before parents
  const body = order.filter((t) => ids[t].length).map((t) =>
    `  DELETE FROM public.${t} WHERE id = ANY (${lit(ids[t])});\n  GET DIAGNOSTICS n = ROW_COUNT;\n  IF n <> ${ids[t].length} THEN RAISE EXCEPTION 'cleanup ${TAG}: ${t} deleted %, expected ${ids[t].length}', n; END IF;`).join("\n");
  const sql = `DO $cleanup$\nDECLARE n int;\nBEGIN\n${body}\nEND $cleanup$;\n`;
  const file = path.join(os.tmpdir(), `cleanup-${TAG}.sql`);
  fs.writeFileSync(file, sql);
  try { execSync(`npx supabase db query --linked -f "${file}"`, { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { console.log("TRANSACTION FAILED, rolled back:", String(e.stderr || e.message).slice(0, 400)); process.exitCode = 1; return; }
  finally { fs.unlinkSync(file); }
  console.log("transaction committed: every count matched the dry run");
  let authDeleted = 0;
  for (const id of authUsers) { const { error } = await admin.auth.admin.deleteUser(id); if (!error) authDeleted++; else console.log(`  auth ${id}: ${error.message}`); }
  console.log(`auth users deleted: ${authDeleted}/${authUsers.length}`);
  const after = await collect();
  const left = order.filter((t) => after.ids[t].length).map((t) => `${t} ${after.ids[t].length}`);
  let authLeft = 0; for (const id of authUsers) { const { data } = await admin.auth.admin.getUserById(id); if (data && data.user) authLeft++; }
  console.log(`re-query: ${left.length || authLeft ? `LEFT ${left.join(", ")}${authLeft ? `, auth ${authLeft}` : ""}` : "NOTHING with the tag remains"}`);
  if (left.length || authLeft) process.exitCode = 1;
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });

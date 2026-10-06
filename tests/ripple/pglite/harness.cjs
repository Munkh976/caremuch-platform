// Shared PGlite bootstrap for the UI round 3+ suites (W1 audit, S4, S5): stubs, live scheduling
// definitions, every care-plan migration up to a cut-off, and the base fixtures (agencies A/B,
// offices X/Y in A with the module on, Z in B; one user per role; caregiver G and client CX in X).
// Local only, no network.
const path = require("path");
const fs = require("fs");
const { PGlite } = require("@electric-sql/pglite");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/";
const ROLLBACK = path.resolve(__dirname, "../../../docs/rollback") + "/";
const LIVE = __dirname + "/live/";
const EXACT = JSON.parse(fs.readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : fs.readFileSync(LIVE + n + ".sql", "utf8");
const STUBS = ["stub.sql", "live_helpers.sql", "stub_b1.sql", "stub_b2.sql", "stub_c.sql", "stub_d.sql", "stub_soff.sql", "stub_ui.sql"];
const SCHED = ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "check_caregiver_shifts_eligibility", "assign_caregiver_to_shift",
  "caregiver_pick_up_shift", "caregiver_pickup_trade_shift", "release_shift_assignments", "compute_earnings_for_time_entry"];
// care-plan migrations (Phase A .. UI); the S1 menu seed is data for menu tables PGlite doesn't stub
const migrations = () => fs.readdirSync(MIG).filter((f) => /^2026(10(0[6-9]|[12][0-9])|1[12])\d{6}_/.test(f) && !/ripple_ui_menu_seeds/.test(f)).sort();

const A = "56fbfe38-e8eb-40c1-ba27-07428f62ed2e", OX = "12faa863-017e-438c-966c-f67be9b726e7", OY = "56785edd-ce66-4bf0-a487-abb628f21fef";
const B = "bbbbbbbb-0000-0000-0000-000000000001", OZ = "bbbbbbbb-0000-0000-0000-0000000000a1", TZ = "America/New_York";
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const users = { aaA: U(1), mgrA: U(2), mgrY: U(3), mgrX: U(4), schX: U(5), hrX: U(6), cg: U(7), cl: U(8), aaB: U(9), sysA: U(10) };
const DENY = /Not found or not allowed|permission denied/;
const G = U(310), CX = U(401);

const snapSql = `
  SELECT 'rel:'||c.relname||':'||c.relkind::text x FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'')||':'||is_nullable FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'fn:'||p.oid::regprocedure::text||':'||md5(p.prosrc)||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'') FROM pg_proc p WHERE pronamespace='public'::regnamespace
  UNION ALL SELECT 'type:'||typname FROM pg_type WHERE typnamespace='public'::regnamespace
  UNION ALL SELECT 'trg:'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'pol:'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') FROM pg_policies WHERE schemaname='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'grant:'||table_name||':'||grantee||':'||privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated')
  ORDER BY 1`;
const snap = async (db) => (await db.query(snapSql)).rows.map((r) => r.x);

/** Fresh database with every care-plan migration whose file name sorts before `cut` (all when null). */
async function bootSchema(cut = null) {
  const db = new PGlite();
  for (const f of STUBS) await db.exec(fs.readFileSync(path.join(__dirname, f), "utf8"));
  await db.exec(fs.readFileSync(LIVE + "assignment_machinery.sql", "utf8"));
  for (const f of SCHED) await db.exec(liveDef(f) + ";");
  await db.exec(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    INSERT INTO agency (id, agency_name) VALUES ('${A}','A'),('${B}','B');
    INSERT INTO virtual_office (id, agency_id, name, timezone) VALUES ('${OX}','${A}','X','${TZ}'),('${OY}','${A}','Y','${TZ}'),('${OZ}','${B}','Z','${TZ}');
    INSERT INTO care_types (code, name) VALUES ('CLS0001','CLS'),('RESP0001','Respite');`);
  const files = migrations().filter((f) => cut === null || f < cut);
  for (const f of files) { try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { throw new Error(`APPLY FAILED ${f}: ${e.message}`); } }
  return { db, files };
}
const applyFiles = async (db, files) => { for (const f of files) await db.exec(fs.readFileSync(MIG + f, "utf8")); };
const applyRollback = async (db, name) => db.exec(fs.readFileSync(ROLLBACK + name, "utf8"));

/** Schema + base fixtures + call helpers. */
async function boot(cut = null) {
  const { db, files } = await bootSchema(cut);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const day = async (n) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [n]))[0].d;
  await db.exec(`
    INSERT INTO profiles (id, agency_id, virtual_office_id, office_restricted, full_name) VALUES
      ('${users.aaA}','${A}',NULL,false,'Admin A'),('${users.mgrA}','${A}',NULL,false,'Manager All'),('${users.mgrY}','${A}','${OY}',true,'Manager Y'),
      ('${users.mgrX}','${A}','${OX}',true,'Manager X'),('${users.schX}','${A}','${OX}',true,'Scheduler X'),('${users.hrX}','${A}','${OX}',true,'HR X'),
      ('${users.cg}','${A}','${OX}',false,'CG'),('${users.cl}','${A}',NULL,false,'CL'),('${users.aaB}','${B}',NULL,false,'Admin B'),('${users.sysA}','${A}',NULL,false,'Sys');
    INSERT INTO user_roles (user_id, role, agency_id) VALUES ('${users.aaA}','agency_admin','${A}'),('${users.mgrA}','manager','${A}'),('${users.mgrY}','manager','${A}'),
      ('${users.mgrX}','manager','${A}'),('${users.schX}','scheduler','${A}'),('${users.hrX}','hr_staff','${A}'),('${users.cg}','caregiver','${A}'),
      ('${users.cl}','client','${A}'),('${users.aaB}','agency_admin','${B}'),('${users.sysA}','system_admin','${A}');
    INSERT INTO cp_default_credential_types (name, category, valid_months, required) VALUES
      ('ICHAT','background_check',12,true),('HIPAA','annual_online',12,true);
    INSERT INTO cp_default_service_types (care_type_code, service_type) VALUES ('CLS0001','cls'),('RESP0001','respite');`);
  const call = async (who, sql, params = []) => {
    await db.exec("BEGIN");
    try {
      if (who === "anon") await db.exec("SET LOCAL ROLE anon");
      else { await db.exec("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users[who]]); }
      const r = await db.query(sql, params); await db.exec("COMMIT"); return { v: r.rows[0] && Object.values(r.rows[0])[0], rows: r.rows };
    } catch (e) { await db.exec("ROLLBACK"); return { err: e.message }; }
  };
  const must = async (who, sql, p) => { const r = await call(who, sql, p); if (r.err) throw new Error(`${sql.slice(0, 70)}: ${r.err}`); return r.v; };
  await must("aaA", "SELECT seed_office_care_plan_defaults($1)", [OX]); await must("aaA", "SELECT seed_office_care_plan_defaults($1)", [OY]);
  await db.query(`INSERT INTO caregivers (id, agency_id, user_id, first_name, virtual_office_id, is_active) VALUES ($1,$2,$3,'Gina',$4,true)`, [G, A, users.cg, OX]);
  await db.query(`UPDATE caregivers SET last_name = 'Test' WHERE id = $1`, [G]);
  await db.query(`INSERT INTO clients (id, agency_id, user_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,$3,'Carla','Fixture',$4)`, [CX, A, users.cl, OX]);
  return { db, files, q, day, call, must };
}

function recorder() {
  const rows = [];
  const rec = (id, ok, d) => { rows.push({ id, ok }); console.log(`${id} ${ok ? "PASS" : "FAIL"} :: ${d}`); };
  const done = () => { console.log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok ? "PASS" : "FAIL"}`).join(" ")); if (rows.some((r) => !r.ok)) process.exitCode = 1; };
  return { rec, done };
}
// SECURITY DEFINER + authenticated EXECUTE, no PUBLIC/anon (internal cp_ helpers: no API role at all)
async function aclCheck(q, names) {
  const acl = await q(`SELECT p.proname, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [names]);
  const bad = acl.filter((f) => /(^|[{,])=X|anon=X/.test(f.acl) || (f.proname.startsWith("cp_") ? /authenticated=X/.test(f.acl) : !(f.d && /authenticated=X/.test(f.acl))));
  return { ok: acl.length === names.length && bad.length === 0, detail: `${acl.length}/${names.length} found` + (bad.length ? `; OFFENDING ${bad.map((f) => `${f.proname} ${f.acl}`).join(", ")}` : "") };
}

module.exports = { boot, bootSchema, applyFiles, applyRollback, snap, migrations, recorder, aclCheck, A, B, OX, OY, OZ, TZ, U, users, DENY, G, CX };

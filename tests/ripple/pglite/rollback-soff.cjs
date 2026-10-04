// S-OFF-1 + note-shell service_type rollback proof (exact post-D2 catalog; restored bodies md5-checked against DEV).
// Usage: node tests/ripple/pglite/rollback-soff.cjs   (local PGlite, no network)
const path = require("path");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/", ROLLBACK = path.resolve(__dirname, "../../../docs/rollback") + "/";
const LIVE = __dirname + "/live/";
// live definitions: .sql snapshots, except those stored on DEV with carriage returns (kept exact in JSON)
const EXACT = JSON.parse(require("fs").readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : require("fs").readFileSync(LIVE + n + ".sql", "utf8");
const { PGlite } = require("@electric-sql/pglite"); const fs = require("fs");
const ALL = fs.readdirSync(MIG).filter((f) => /^202610(0612|0712|0812|0912|1012|1112)/.test(f)).sort();
const PRE = ALL.filter((f) => !/^20261011/.test(f)), PC = ALL.filter((f) => /^20261011/.test(f));
const snap = async (db) => JSON.stringify((await db.query(`
  SELECT 'rel:'||c.relname||':'||c.relkind::text x FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'') FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'fn:'||p.oid::regprocedure::text||':'||md5(p.prosrc)||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'') FROM pg_proc p WHERE pronamespace='public'::regnamespace
  UNION ALL SELECT 'type:'||typname FROM pg_type WHERE typnamespace='public'::regnamespace
  UNION ALL SELECT 'trg:'||pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'pol:'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') FROM pg_policies WHERE schemaname='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'grant:'||table_name||':'||grantee||':'||privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated')
  ORDER BY 1`)).rows.map((r) => r.x));
(async () => {
  const db = new PGlite();
  for (const f of ["stub.sql", "live_helpers.sql", "stub_b1.sql", "stub_b2.sql", "stub_c.sql", "stub_d.sql", "stub_soff.sql"]) await db.exec(fs.readFileSync(__dirname + "/" + f, "utf8"));
  await db.exec(fs.readFileSync(LIVE + "assignment_machinery.sql", "utf8"));
  for (const f of ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "check_caregiver_shifts_eligibility", "assign_caregiver_to_shift", "caregiver_pick_up_shift", "caregiver_pickup_trade_shift", "release_shift_assignments", "compute_earnings_for_time_entry"]) await db.exec(liveDef(f) + ";");
  await db.exec(`INSERT INTO agency (id, agency_name) VALUES ('56fbfe38-e8eb-40c1-ba27-07428f62ed2e','A'); INSERT INTO virtual_office (id, agency_id, name) VALUES ('12faa863-017e-438c-966c-f67be9b726e7','56fbfe38-e8eb-40c1-ba27-07428f62ed2e','X'); INSERT INTO care_types (code) VALUES ('CLS0001'),('RESP0001');`);
  for (const f of PRE) await db.exec(fs.readFileSync(MIG + f, "utf8"));
  const before = await snap(db);
  for (const f of PC) await db.exec(fs.readFileSync(MIG + f, "utf8"));
  const mid = await snap(db);
  await db.exec(fs.readFileSync(ROLLBACK + "mcpd_02_note_shell_service_rollback.sql", "utf8"));
  await db.exec(fs.readFileSync(ROLLBACK + "soff_01_rollback.sql", "utf8"));
  const after = await snap(db);
  const b = JSON.parse(before), a = JSON.parse(after);
  console.log(`files ${PC.length}; catalog entries post-D2 ${b.length}, with S-OFF-1 + shells ${JSON.parse(mid).length}, after rollback ${a.length}`);
  console.log("rollback restores the exact post-D2 catalog (incl. function bodies + ACLs, triggers, policies, constraints, grants):", before === after);
  if (before !== after) { const sb = new Set(b), sa = new Set(a); console.log("left:", a.filter((x) => !sb.has(x)).slice(0, 8), "\nmissing:", b.filter((x) => !sa.has(x)).slice(0, 8)); }
  const DEVMD5 = { assign_caregiver_to_shift: "107ced93f55510fd7bac043acdb1d08a", release_shift_assignments: "e23ab249a49e892c588d75c0c7a29175",
    compute_earnings_for_time_entry: "ce7e2ade73511ad840b705514b7444cf", save_template_draft: "f5c9fb3c7067a3acc0a9e5a42a9755ce", create_progress_note_for_shift: "2dc46dc6583b6931e98834d19df0279f" };
  const got = Object.fromEntries((await db.query("SELECT proname, md5(prosrc) m FROM pg_proc WHERE proname = ANY($1)", [Object.keys(DEVMD5)])).rows.map((r) => [r.proname, r.m]));
  const mism = Object.keys(DEVMD5).filter((k) => got[k] !== DEVMD5[k]);
  console.log("restored bodies byte-identical to DEV (md5, captured read-only 2026-10-04) for 5 functions:", mism.length === 0, mism.length ? mism : "");
  for (const f of PC) await db.exec(fs.readFileSync(MIG + f, "utf8"));
  console.log("re-apply after rollback equals first apply:", (await snap(db)) === mid);
})().catch((e) => console.log("FAILED", e.message));

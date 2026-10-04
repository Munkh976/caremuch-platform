// Phase B2 rollback proof (exact post-B1 catalog).
// Usage: node tests/ripple/pglite/rollback-b2.cjs   (local PGlite, no network)
const path = require("path");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/", ROLLBACK = path.resolve(__dirname, "../../../docs/rollback") + "/";
const LIVE = __dirname + "/live/";
// live definitions: .sql snapshots, except those stored on DEV with carriage returns (kept exact in JSON)
const EXACT = JSON.parse(require("fs").readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : require("fs").readFileSync(LIVE + n + ".sql", "utf8");
const { PGlite } = require("@electric-sql/pglite"); const fs = require("fs");
const PA = fs.readdirSync(MIG).filter((f) => /^202610(0612|0712)/.test(f)).sort(), B1 = fs.readdirSync(MIG).filter((f) => /^2026100812/.test(f)).sort();
const snap = async (db) => JSON.stringify((await db.query(`
  SELECT 'rel:'||c.relname||':'||c.relkind::text x FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'') FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'fn:'||p.oid::regprocedure::text FROM pg_proc p WHERE pronamespace='public'::regnamespace
  UNION ALL SELECT 'type:'||typname FROM pg_type WHERE typnamespace='public'::regnamespace
  UNION ALL SELECT 'trg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'pol:'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') FROM pg_policies WHERE schemaname='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'grant:'||table_name||':'||grantee||':'||privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated')
  ORDER BY 1`)).rows.map((r) => r.x));
(async () => {
  const db = new PGlite();
  for (const f of ["stub.sql", "live_helpers.sql", "stub_b1.sql", "stub_b2.sql"]) await db.exec(fs.readFileSync(__dirname + "/" + f, "utf8"));
  await db.exec(`INSERT INTO agency VALUES ('56fbfe38-e8eb-40c1-ba27-07428f62ed2e','A'); INSERT INTO virtual_office (id, agency_id, name) VALUES ('12faa863-017e-438c-966c-f67be9b726e7','56fbfe38-e8eb-40c1-ba27-07428f62ed2e','X'); INSERT INTO care_types (code) VALUES ('CLS0001'),('RESP0001');`);
  for (const f of PA) await db.exec(fs.readFileSync(MIG + f, "utf8"));
  const before = await snap(db);
  for (const f of B1) await db.exec(fs.readFileSync(MIG + f, "utf8"));
  const mid = await snap(db);
  await db.exec(`SELECT 1`);
  await db.exec(fs.readFileSync(ROLLBACK + "ripple_phase_b2_rollback.sql", "utf8"));
  const after = await snap(db);
  const b = JSON.parse(before), a = JSON.parse(after);
  console.log(`B2 files: ${B1.length}; catalog entries after B1 ${b.length}, after B2 ${JSON.parse(mid).length}, after rollback ${a.length}`);
  console.log("rollback restores the exact post-B1 catalog (incl. policies, constraints, grants):", before === after);
  if (before !== after) { const sb = new Set(b), sa = new Set(a); console.log("left:", a.filter((x) => !sb.has(x)).slice(0, 10), "missing:", b.filter((x) => !sa.has(x)).slice(0, 10)); }
  for (const f of B1) await db.exec(fs.readFileSync(MIG + f, "utf8"));
  console.log("re-apply after rollback: ok; equals first apply:", (await snap(db)) === mid);
})().catch((e) => console.log("FAILED", e.message));

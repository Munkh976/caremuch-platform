// Phase A rollback proof: apply, roll back (docs/rollback), compare the catalog, re-apply.
// Usage: node tests/ripple/pglite/rollback-a.cjs   (local PGlite, no network)
const path = require("path");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/", ROLLBACK = path.resolve(__dirname, "../../../docs/rollback") + "/";
const LIVE = __dirname + "/live/";
// live definitions: .sql snapshots, except those stored on DEV with carriage returns (kept exact in JSON)
const EXACT = JSON.parse(require("fs").readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : require("fs").readFileSync(LIVE + n + ".sql", "utf8");
const { PGlite } = require("@electric-sql/pglite"); const fs = require("fs");
const FILES = fs.readdirSync(MIG).filter((f) => /^2026100612/.test(f)).sort();
const snap = async (db) => JSON.stringify((await db.query(`
  SELECT 'rel:'||c.relname||':'||c.relkind::text x FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'fn:'||proname FROM pg_proc WHERE pronamespace='public'::regnamespace
  UNION ALL SELECT 'type:'||typname FROM pg_type WHERE typnamespace='public'::regnamespace
  UNION ALL SELECT 'trg:'||tgname FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'pol:'||tablename||'.'||policyname FROM pg_policies WHERE schemaname='public' ORDER BY 1`)).rows.map((r) => r.x));
(async () => {
  const db = new PGlite();
  await db.exec(fs.readFileSync(__dirname + "/stub.sql", "utf8")); await db.exec(fs.readFileSync(__dirname + "/live_helpers.sql", "utf8"));
  await db.exec(`INSERT INTO agency VALUES ('56fbfe38-e8eb-40c1-ba27-07428f62ed2e','A'); INSERT INTO virtual_office (id, agency_id, name) VALUES ('12faa863-017e-438c-966c-f67be9b726e7','56fbfe38-e8eb-40c1-ba27-07428f62ed2e','R'); INSERT INTO care_types (code) VALUES ('CLS0001'),('RESP0001');`);
  const before = await snap(db);
  for (const f of FILES) await db.exec(fs.readFileSync(MIG + f, "utf8"));
  const mid = await snap(db);
  await db.exec(fs.readFileSync(ROLLBACK + "ripple_phase_a_rollback.sql", "utf8"));
  const after = await snap(db);
  console.log(`files applied: ${FILES.length}; catalog objects before ${JSON.parse(before).length}, after apply ${JSON.parse(mid).length}, after rollback ${JSON.parse(after).length}`);
  console.log("rollback restores the exact pre-migration catalog:", before === after);
  if (before !== after) { const b = new Set(JSON.parse(before)), a = new Set(JSON.parse(after)); console.log("left:", [...a].filter((x) => !b.has(x)), "missing:", [...b].filter((x) => !a.has(x))); }
  for (const f of FILES) await db.exec(fs.readFileSync(MIG + f, "utf8"));
  console.log("re-apply after rollback: ok; catalog equals first apply:", (await snap(db)) === mid);
})().catch((e) => console.log("FAILED", e.message));

// Rollback proof for 20261031150000 (caregiver units rule): caregiver_units_rule_rollback.sql restores
// get_progress_note_for_caregiver byte-identical to DEV before the push (md5 of pg_get_functiondef); catalog = before;
// re-apply = first apply. Usage: node tests/ripple/pglite/rollback-caregiver-units-rule.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031150000_caregiver_units_rule.sql", RB = "caregiver_units_rule_rollback.sql";
const DEV = { get_progress_note_for_caregiver: "2c445b7e0a5e1be7ae03026219f630a0" };   // DEV, Oct 22, before the push

(async () => {
  const { rec, done } = H.recorder();
  const { db } = await H.bootSchema(MIG);
  const defs = async () => Object.fromEntries((await db.query(`SELECT proname n, md5(pg_get_functiondef(oid)) h FROM pg_proc WHERE proname = ANY($1)`, [Object.keys(DEV)])).rows.map((r) => [r.n, r.h]));
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  const s0 = await H.snap(db), d0 = await defs();
  await H.applyFiles(db, [MIG]); const s1 = await H.snap(db);
  await H.applyRollback(db, RB);
  const s2 = await H.snap(db), d2 = await defs();
  rec("RB1 after the rollback the catalog equals the one before the migration", diff(s0, s2).length === 0, diff(s0, s2).slice(0, 2).join(" ; ") || "identical");
  rec("RB2 the existing function is byte-identical to before and to DEV before the push (md5 of pg_get_functiondef)",
    Object.keys(DEV).every((k) => d2[k] === d0[k] && d2[k] === DEV[k]), Object.keys(DEV).map((k) => `${k} ${d2[k].slice(0, 8)} (DEV ${DEV[k].slice(0, 8)})`).join("; "));
  await H.applyFiles(db, [MIG]); const s3 = await H.snap(db);
  rec("RB3 re-applying after the rollback equals the first apply", diff(s1, s3).length === 0, `diff ${diff(s1, s3).slice(0, 2).join(" ; ") || "none"}`);
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });

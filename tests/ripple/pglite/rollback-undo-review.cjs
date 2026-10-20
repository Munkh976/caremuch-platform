// Rollback proof for 20261026120000_undo_note_review.sql (docs/rollback/undo_note_review_rollback.sql): the rollback
// restores the exact previous catalog (tables, columns, functions with body hashes and ACLs, triggers, policies,
// constraints, grants); the restored events CHECK is byte-identical to DEV's before the push (md5); re-applying after
// the rollback equals the first apply.
// Usage: node tests/ripple/pglite/rollback-undo-review.cjs   (local, no network)
const H = require("./harness.cjs");
const UNDO = "20261026120000_undo_note_review.sql";
const DEV_CHECK_BEFORE = "87db9d7dcd873069f5a9d6e4acc47bc5";   // md5(pg_get_constraintdef(events_event_type_check)) on DEV before the push (Oct 19, 51 values)

(async () => {
  const { rec, done } = H.recorder();
  const { db } = await H.bootSchema(UNDO);
  const checkMd5 = async () => (await db.query(`SELECT md5(pg_get_constraintdef(oid)) h FROM pg_constraint WHERE conname = 'events_event_type_check'`)).rows[0].h;
  const s0 = await H.snap(db); const c0 = await checkMd5();
  await H.applyFiles(db, [UNDO]); const s1 = await H.snap(db);
  await H.applyRollback(db, "undo_note_review_rollback.sql"); const s2 = await H.snap(db); const c2 = await checkMd5();
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  rec("RB1 the rollback restores the exact catalog before the migration (function dropped, 51-value CHECK back)", diff(s0, s2).length === 0 && diff(s0, s1).length === 3,
    `${s0.length} items before, ${s1.length} after apply, ${s2.length} after rollback; diff ${diff(s0, s2).slice(0, 3).join(" ; ") || "none"}`);
  rec("RB2 the restored events CHECK is byte-identical to DEV's before the push (md5)", c2 === DEV_CHECK_BEFORE && c0 === DEV_CHECK_BEFORE, `pglite before ${c0}; restored ${c2}; DEV ${DEV_CHECK_BEFORE}`);
  await H.applyFiles(db, [UNDO]); const s3 = await H.snap(db);
  rec("RB3 re-applying after the rollback equals the first apply", diff(s1, s3).length === 0, `diff ${diff(s1, s3).slice(0, 3).join(" ; ") || "none"}`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

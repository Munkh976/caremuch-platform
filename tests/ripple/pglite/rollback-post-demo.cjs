// Rollback proof for the post-demo migrations: add_training_attendees_rollback.sql then note_history_undo_rollback.sql
// restore the exact catalog before them; the restored get_progress_note_for_staff is byte-identical to DEV's body before
// the push (md5, carriage returns included); re-applying equals the first apply.
// Usage: node tests/ripple/pglite/rollback-post-demo.cjs   (local, no network)
const H = require("./harness.cjs");
const FILES = ["20261027120000_note_history_undo.sql", "20261027120100_add_training_attendees.sql"];
const DEV_READER_BEFORE = "460b892b716df06cd8e1190ab84ad80e";   // md5(prosrc) of get_progress_note_for_staff on DEV before the push (Oct 21)

(async () => {
  const { rec, done } = H.recorder();
  const { db } = await H.bootSchema(FILES[0]);
  const md5 = async () => (await db.query(`SELECT md5(prosrc) h FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = 'get_progress_note_for_staff'`)).rows[0].h;
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  const s0 = await H.snap(db);
  await H.applyFiles(db, FILES); const s1 = await H.snap(db);
  await H.applyRollback(db, "add_training_attendees_rollback.sql"); await H.applyRollback(db, "note_history_undo_rollback.sql");
  const s2 = await H.snap(db), m2 = await md5();
  // the reader line in s0 comes from the repo file (PGlite); DEV's stored body is the reference for the restored one
  const d = diff(s0, s2);
  rec("RB1 after both rollbacks the catalog equals the one before the migrations (function dropped, reader restored, grants as before)",
    d.length === 0 || (d.length === 2 && d.every((x) => x.slice(1).startsWith("fn:get_progress_note_for_staff(uuid):"))), d.length ? d.map((x) => x.slice(0, 70)).join(" ; ") : "identical");
  rec("RB2 the restored get_progress_note_for_staff is byte-identical to DEV's body before the push (md5, carriage returns included)", m2 === DEV_READER_BEFORE, `restored ${m2}; DEV ${DEV_READER_BEFORE}`);
  await H.applyFiles(db, FILES); const s3 = await H.snap(db);
  rec("RB3 re-applying after the rollbacks equals the first apply", diff(s1, s3).length === 0, `diff ${diff(s1, s3).slice(0, 2).join(" ; ") || "none"}`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

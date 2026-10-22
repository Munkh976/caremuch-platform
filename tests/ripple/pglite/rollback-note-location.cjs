// Rollback proof for 20261031130000 (note Location office setting): note_location_setting_rollback.sql stops while
// office_note_location_changed events exist, then restores the catalog before the migration; the two existing functions
// come back byte-identical to DEV before the push (md5 of pg_get_functiondef); re-apply = first apply.
// Usage: node tests/ripple/pglite/rollback-note-location.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031130000_note_location_setting.sql", RB = "note_location_setting_rollback.sql";
const DEV = { create_progress_note_for_shift: "8c3a18364ff2197ed8a26092dcc1ba2d", get_progress_note_for_caregiver: "ea842bdc09c2e18a46d1b22a82d37771" };   // DEV, Oct 22, before the push

(async () => {
  const { rec, done } = H.recorder();
  const { db } = await H.bootSchema(MIG);
  const defs = async () => Object.fromEntries((await db.query(`SELECT proname n, md5(pg_get_functiondef(oid)) h FROM pg_proc WHERE proname = ANY($1)`, [Object.keys(DEV)])).rows.map((r) => [r.n, r.h]));
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  const s0 = await H.snap(db), d0 = await defs();
  await H.applyFiles(db, [MIG]); const s1 = await H.snap(db);
  await db.query(`INSERT INTO events (agency_id, event_type, actor_type, subject_type, payload) VALUES ($1,'office_note_location_changed','staff','virtual_office','{}')`, [H.A]);
  let blocked = null; try { await H.applyRollback(db, RB); } catch (e) { blocked = e.message; }
  const sB = await H.snap(db);
  await db.query(`DELETE FROM events WHERE event_type = 'office_note_location_changed'`);
  rec("RB0 while note location events exist the rollback stops with the reason and changes nothing", /note location events exist/.test(blocked || "") && diff(s1, sB).length === 0, (blocked || "NOT BLOCKED").slice(0, 60));
  await H.applyRollback(db, RB);
  const s2 = await H.snap(db), d2 = await defs();
  rec("RB1 after the rollback the catalog equals the one before the migration", diff(s0, s2).length === 0, diff(s0, s2).slice(0, 2).join(" ; ") || "identical");
  rec("RB2 the two existing functions are byte-identical to before and to DEV before the push (md5 of pg_get_functiondef)",
    Object.keys(DEV).every((k) => d2[k] === d0[k] && d2[k] === DEV[k]), Object.keys(DEV).map((k) => `${k} ${d2[k].slice(0, 8)} (DEV ${DEV[k].slice(0, 8)})`).join("; "));
  await H.applyFiles(db, [MIG]); const s3 = await H.snap(db);
  rec("RB3 re-applying after the rollback equals the first apply", diff(s1, s3).length === 0, `diff ${diff(s1, s3).slice(0, 2).join(" ; ") || "none"}`);
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });

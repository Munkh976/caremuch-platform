// Rollback proof for 20261030130000 (auto-assign): auto_assign_rollback.sql stops while auto-assign events exist, then
// restores the catalog before the migration; the events CHECK equals DEV's before the push (md5); re-apply = first apply.
// Usage: node tests/ripple/pglite/rollback-auto-assign.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261030130000_auto_assign.sql", RB = "auto_assign_rollback.sql";
const DEV_EVENTS = process.argv[2] || "8509d41e5a1980bbd73df19e7a9e4a6a";   // md5(pg_get_constraintdef) of events_event_type_check on DEV before the push (Oct 21)

(async () => {
  const { rec, done } = H.recorder();
  const { db } = await H.bootSchema(MIG);
  const ev = async () => (await db.query(`SELECT md5(pg_get_constraintdef(oid)) h FROM pg_constraint WHERE conname='events_event_type_check'`)).rows[0].h;
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  const s0 = await H.snap(db), e0 = await ev();
  await H.applyFiles(db, [MIG]); const s1 = await H.snap(db);
  await db.query(`INSERT INTO events (agency_id, event_type, actor_type, subject_type, payload) VALUES ($1,'auto_assign_run','staff','virtual_office','{}')`, [H.A]);
  let blocked = null; try { await H.applyRollback(db, RB); } catch (e) { blocked = e.message; }
  const sB = await H.snap(db);
  await db.query(`DELETE FROM events WHERE event_type = 'auto_assign_run'`);
  rec("RB0 while auto-assign events exist the rollback stops with the reason and changes nothing", /auto-assign events exist/.test(blocked || "") && diff(s1, sB).length === 0, (blocked || "NOT BLOCKED").slice(0, 60));
  await H.applyRollback(db, RB);
  const s2 = await H.snap(db), e2 = await ev();
  rec("RB1 after the rollback the catalog equals the one before the migration", diff(s0, s2).length === 0, diff(s0, s2).slice(0, 2).join(" ; ") || "identical");
  rec("RB2 the restored events CHECK equals the one before (and DEV's when given)", e2 === e0 && (!DEV_EVENTS || e2 === DEV_EVENTS), `restored ${e2}; DEV ${DEV_EVENTS || "(not given)"}`);
  await H.applyFiles(db, [MIG]); const s3 = await H.snap(db);
  rec("RB3 re-applying after the rollback equals the first apply", diff(s1, s3).length === 0, `diff ${diff(s1, s3).slice(0, 2).join(" ; ") || "none"}`);
  // the rule-16 fix 20261030130100: its rollback restores the body pushed in 20261030130000 byte-identically
  const md5c = async () => (await db.query(`SELECT md5(prosrc) h FROM pg_proc WHERE proname = 'commit_auto_assignments'`)).rows[0].h;
  const pushed = await md5c();
  await H.applyFiles(db, ["20261030130100_auto_assign_commit_events.sql"]); const fixed = await md5c();
  await H.applyRollback(db, "auto_assign_commit_events_rollback.sql"); const back = await md5c(); const s4 = await H.snap(db);
  rec("RB4 the commit fix changes only that body; its rollback restores the body pushed on DEV (md5 5c35a9b9…) and the catalog",
    pushed === "5c35a9b942e24daf5db14b6316de1aca" && fixed !== pushed && back === pushed && diff(s3, s4).length === 0, `pushed ${pushed}; fixed ${fixed}; back ${back}`);
  // the rule-16 fix 20261030130200 (propose_auto_assignments): its rollback restores the pushed body byte-identically
  const md5p = async () => (await db.query(`SELECT md5(prosrc) h FROM pg_proc WHERE proname = 'propose_auto_assignments'`)).rows[0].h;
  const p0 = await md5p();
  await H.applyFiles(db, ["20261030130200_auto_assign_propose_fix.sql"]); const p1 = await md5p();
  await H.applyRollback(db, "auto_assign_propose_fix_rollback.sql"); const p2 = await md5p();
  rec("RB5 the propose fix's rollback restores the body pushed on DEV (md5 9e18f5f2…)", p0 === "9e18f5f2bc6bb5cf0408b906740886e7" && p1 !== p0 && p2 === p0, `pushed ${p0}; fixed ${p1}; back ${p2}`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

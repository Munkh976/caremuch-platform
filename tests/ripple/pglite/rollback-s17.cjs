// Rollback proof for 20261029120100 (S17): s17_ipos_versions_rollback.sql stops (nothing changed) while a pending
// version exists, then restores the catalog before the migration; the 10 restored function bodies are byte-identical to
// DEV's before the push (md5) and the events CHECK equals DEV's; re-applying equals the first apply. The enum value of
// 20261029120000 stays (documented).
// Usage: node tests/ripple/pglite/rollback-s17.cjs   (local, no network)
const H = require("./harness.cjs");
const ENUM = "20261029120000_s17_pending_status.sql", MIG = "20261029120100_s17_ipos_versions.sql", RB = "s17_ipos_versions_rollback.sql";
const DEV = {   // md5(prosrc) on DEV before the push (Oct 21)
  update_care_plan_fields: "ea047e956fc78b1824150cb13273c1c4", upsert_care_plan_goals: "70273f101e0ca99aa4a19c6f086ec91c",
  set_objective_measures: "32ee8d25e89a9901eeae3ec344f82295", set_care_plan_rows: "6fd9e8d3386855dd5e92d1ce91a5310c",
  would_bump_training_version: "2cab99f675a9a8864928f0425321c3e1", record_inservice_form: "a1670f358e309987a07f4224b832c9ac",
  record_training_form: "a41b516fb8cd6db9bc0b9426824832ff", add_training_attendees: "6ea1a7942d5281bf0e65326a4d21170b",
  get_client_training_context: "d98e059eab3dea5e3c8bafbed92becf5", cp_attachment_parent: "3c2aad5a800e715e23a22262badaa0e2",
};
const DEV_EVENTS = "620506cd07306c21bbec1900dd7aeb05";

(async () => {
  const { rec, done } = H.recorder();
  const { db } = await H.bootSchema(ENUM);
  await H.applyFiles(db, [ENUM]);
  const md5s = async () => Object.fromEntries((await db.query(`SELECT proname n, md5(prosrc) h FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)`, [Object.keys(DEV)])).rows.map((r) => [r.n, r.h]));
  const ev = async () => (await db.query(`SELECT md5(pg_get_constraintdef(oid)) h FROM pg_constraint WHERE conname = 'events_event_type_check'`)).rows[0].h;
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  const s0 = await H.snap(db);
  await H.applyFiles(db, [MIG]); const s1 = await H.snap(db);
  // a pending version blocks the rollback
  await db.query(`INSERT INTO clients (id, agency_id, first_name) VALUES ($1,$2,'C')`, [H.CX, H.A]);
  await db.query(`INSERT INTO care_plans (agency_id, client_id, version, training_version, status, plan_type) VALUES ($1,$2,1,1,'pending','initial')`, [H.A, H.CX]);
  let blocked = null; try { await H.applyRollback(db, RB); } catch (e) { blocked = e.message; }
  const sB = await H.snap(db);
  await db.query(`DELETE FROM care_plans`);
  rec("RB0 while a pending version exists the rollback stops with the reason and changes nothing", /pending plan version exists/.test(blocked || "") && diff(s1, sB).length === 0, `${(blocked || "NOT BLOCKED").slice(0, 60)}`);
  await H.applyRollback(db, RB);
  const s2 = await H.snap(db), m2 = await md5s(), e2 = await ev();
  // the 10 bodies come from the repo in s0 (PGlite) and from DEV after the rollback: compare the rest exactly
  const d = diff(s0, s2).filter((x) => !Object.keys(DEV).some((n) => x.slice(1).startsWith(`fn:${n}(`)));
  rec("RB1 after the rollback the catalog equals the one before the migration (apart from the 10 bodies, checked against DEV next)", d.length === 0, d.length ? d.slice(0, 4).map((x) => x.slice(0, 80)).join(" ; ") : "identical");
  const bad = Object.keys(DEV).filter((n) => m2[n] !== DEV[n]);
  rec("RB2 the 10 restored function bodies are byte-identical to DEV's before the push (md5); the events CHECK equals DEV's", bad.length === 0 && e2 === DEV_EVENTS, bad.length ? `differ: ${bad.join(", ")}` : `10/10; events ${e2}`);
  await H.applyFiles(db, [MIG]); const s3 = await H.snap(db);
  const d3 = diff(s1, s3);
  rec("RB3 re-applying after the rollback equals the first apply", d3.length === 0, `diff ${d3.slice(0, 2).join(" ; ") || "none"}`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

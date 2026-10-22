// "Visits take place at" office setting on PGlite: 20261031160000 (owner, Oct 22, A). Catalog additive (only the events
// CHECK replaced: 62 + 1), ACL, every existing office 'client_home', the setter (agency admin only, validation, needs the
// office's street address for 'office', audited before / after), and the rollback proof (catalog = before; events CHECK =
// before; re-apply = first apply).
// Usage: node tests/ripple/pglite/visit-location.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031160000_visit_location.sql", RB = "visit_location_rollback.sql";

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(MIG); const { db, q, call } = t;
  const { OX, DENY } = H;
  const evVals = async () => [...(await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='events_event_type_check'`))[0].d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  const before = await H.snap(db), ev0 = await evVals();
  await H.applyFiles(db, [MIG]);
  const after = await H.snap(db), ev1 = await evVals();
  const removed = before.filter((x) => !after.includes(x));
  rec("F0 catalog additive: only the events CHECK replaced (62 kept + office_visit_location_changed)",
    removed.length === 1 && removed[0].startsWith("con:events.events_event_type_check") && ev0.length === 62 && ev1.length === 63 && ev0.every((v) => ev1.includes(v)), `-${removed.length}; events ${ev0.length} -> ${ev1.length}`);
  const acl = await H.aclCheck(q, ["set_office_visit_location"]);
  rec("ACL set_office_visit_location SECURITY DEFINER, authenticated only", acl.ok, acl.detail);
  const offs = await q(`SELECT visit_location v FROM virtual_office`);
  rec("D0 every existing office: client_home", offs.every((o) => o.v === "client_home"), JSON.stringify(offs));
  const SET = "SELECT set_office_visit_location($1,$2)";
  const deny = [];
  for (const who of ["mgrX", "schX", "hrX", "cg", "aaB", "anon"]) { const r = await call(who, SET, [OX, "office"]); if (r.err && DENY.test(r.err)) deny.push(who); else console.log(`  not refused: ${who} ${r.err || "ok"}`); }
  const noAddr = await call("aaA", SET, [OX, "office"]), bad = await call("aaA", SET, [OX, "clinic"]);
  await db.query(`UPDATE virtual_office SET address = '100 Fictitious Way' WHERE id = $1`, [OX]);
  const ok = await call("aaA", SET, [OX, "office"]);
  const ev = await q(`SELECT payload FROM events WHERE event_type = 'office_visit_location_changed' AND subject_id = $1`, [OX]);
  rec("S1 only the agency admin sets it; unknown mode refused; 'office' needs the street address; audited before / after",
    deny.length === 6 && /client's home or the office/.test(bad.err || "") && /street address/.test(noAddr.err || "") && !ok.err && ev.length === 1 && ev[0].payload.before === "client_home" && ev[0].payload.after === "office",
    `refused ${deny.join(",")}; ${(noAddr.err || "ALLOWED").slice(0, 40)}; ${ok.err || "set"}; events ${ev.length}`);
  // rollback proof (fresh database)
  const { db: d2 } = await H.bootSchema(MIG);
  const ck = async () => (await d2.query(`SELECT md5(pg_get_constraintdef(oid)) h FROM pg_constraint WHERE conname='events_event_type_check'`)).rows[0].h;
  const s0 = await H.snap(d2), c0 = await ck();
  await H.applyFiles(d2, [MIG]); const s1 = await H.snap(d2);
  await d2.query(`INSERT INTO events (agency_id, event_type, actor_type, subject_type, payload) VALUES ($1,'office_visit_location_changed','staff','virtual_office','{}')`, [H.A]);
  let blocked = null; try { await H.applyRollback(d2, RB); } catch (e) { blocked = e.message; }
  const sB = await H.snap(d2);
  await d2.query(`DELETE FROM events WHERE event_type = 'office_visit_location_changed'`);
  await H.applyRollback(d2, RB); const s2 = await H.snap(d2), c2 = await ck();
  await H.applyFiles(d2, [MIG]); const s3 = await H.snap(d2);
  rec("RB rollback stops while events exist (nothing changed); then catalog = before, events CHECK = before; re-apply = first apply",
    /visit location events exist/.test(blocked || "") && diff(s1, sB).length === 0 && diff(s0, s2).length === 0 && c2 === c0 && diff(s1, s3).length === 0,
    `${(blocked || "NOT BLOCKED").slice(0, 40)}; ${diff(s0, s2).slice(0, 2).join(" ; ") || "identical"}`);
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });

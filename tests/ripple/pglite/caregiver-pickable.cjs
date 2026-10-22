// caregiver_pickable_shifts on PGlite: 20261031180000 (owner, Oct 22 evening, follow-ups a / c). Catalog additive (one
// function), ACL; a non-module office: every visit pickable (incl. one with a soft issue); a care-plan office: a visit of
// a client not onboarded is not pickable (the client-gate part the caregiver-safe eligibility doesn't carry); only
// (shift_id, pickable) is returned; a non-caregiver gets nothing; another agency's visit isn't returned; rollback proof.
// Usage: node tests/ripple/pglite/caregiver-pickable.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031180000_caregiver_pickable.sql", RB = "caregiver_pickable_rollback.sql";
let seq = 0;

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(MIG); const { db, q, day, call } = t;
  const { A, B, OX, OY, OZ, CX, G } = H;
  await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1, 'CLS0001')`, [G]);
  await db.query(`UPDATE virtual_office SET care_plan_module_enabled = false WHERE id = $1`, [OY]);
  const CY = H.U(412), CZ = H.U(413);
  await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Yara','Fixture',$3), ($4,$5,'Zed','Fixture',$6)`, [CY, A, OY, CZ, B, OZ]);
  const sh = async (agency, office, client, k, start = "09:00") => { const id = H.U(9500 + ++seq);
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
      VALUES ($1,$2,$3,'CLS0001',$4::date,$5,($5::time + interval '1 hour')::time,$6,'open',1)`, [id, agency, client, await day(k), start, office]); return id; };
  const before = await H.snap(db);
  await H.applyFiles(db, [MIG]);
  const after = await H.snap(db);
  const removed = before.filter((x) => !after.includes(x)), added = after.filter((x) => !before.includes(x));
  rec("F0 catalog additive: one new function, nothing removed", removed.length === 0 && added.length === 1 && added[0].startsWith("fn:caregiver_pickable_shifts(uuid[])"), `+${added.map((x) => x.slice(0, 40))} -${removed.length}`);
  const acl = await H.aclCheck(q, ["caregiver_pickable_shifts"]);
  rec("ACL SECURITY DEFINER, authenticated only", acl.ok, acl.detail);
  // G's office X has the module; Y has none (G may still be asked about it: the list is agency-wide on the caller side)
  const xNotOnboarded = await sh(A, OX, CX, 4), yOpen = await sh(A, OY, CY, 5), zOther = await sh(B, OZ, CZ, 5);
  await db.query(`INSERT INTO caregiver_availability (caregiver_id, day_of_week, start_time, end_time, is_available) VALUES ($1, 0, '06:00', '07:00', true)`, [G]);   // soft issues elsewhere
  const r = await call("cg", "SELECT json_agg(x ORDER BY x.shift_id) v FROM caregiver_pickable_shifts($1::uuid[]) x", [[xNotOnboarded, yOpen, zOther]]);
  const by = Object.fromEntries((r.v || []).map((x) => [x.shift_id, x.pickable]));
  rec("P1 care-plan office, client not onboarded: not pickable; non-module office: pickable (today's rule); another agency's visit not returned; only shift_id + pickable",
    !r.err && by[xNotOnboarded] === false && by[yOpen] === true && !(zOther in by) && (r.v || []).every((x) => Object.keys(x).sort().join() === "pickable,shift_id"),
    `${r.err || JSON.stringify(r.v)}`);
  const mgr = await call("mgrX", "SELECT count(*)::int v FROM caregiver_pickable_shifts($1::uuid[])", [[xNotOnboarded]]);
  const anon = await call("anon", "SELECT count(*)::int v FROM caregiver_pickable_shifts($1::uuid[])", [[xNotOnboarded]]);
  rec("R1 a non-caregiver gets an empty set; anon refused", !mgr.err && mgr.v === 0 && !!anon.err, `mgr ${mgr.err || mgr.v}; anon ${(anon.err || "ALLOWED").slice(0, 30)}`);
  const { db: d2 } = await H.bootSchema(MIG);
  const s0 = await H.snap(d2); await H.applyFiles(d2, [MIG]); const s1 = await H.snap(d2);
  await H.applyRollback(d2, RB); const s2 = await H.snap(d2); await H.applyFiles(d2, [MIG]); const s3 = await H.snap(d2);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  rec("RB rollback: catalog = before; re-apply = first apply", same(s0, s2) && same(s1, s3), `${same(s0, s2)} / ${same(s1, s3)}`);
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });

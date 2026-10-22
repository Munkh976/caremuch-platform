// S18 follow-up on PGlite: 20261031150000 (owner, Oct 22, decision 2). get_progress_note_for_caregiver returns
// note.units_rule: the office's current rule while draft / returned, the rule stored on the note once submitted.
// Catalog: only that function's body changed (same signature, SECURITY DEFINER, ACL); everything else in the payload equal.
// Usage: node tests/ripple/pglite/caregiver-units-rule.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031150000_caregiver_units_rule.sql";
let seq = 0; const nid = () => H.U(9700 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(MIG); const { db, q, day, call, must } = t;
  const { CX, G, OX, A } = H;
  await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await day(-30), expiration_date: await day(330) }), "{}"]);
  const mk = async (k) => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
      VALUES ($1,$2,$3,'CLS0001',$4::date,'09:00','10:00',$5,'assigned',1,$6)`, [id, A, CX, await day(-k), OX, G]);
    const n = await must("cg", "SELECT create_progress_note_for_shift($1)", [id]);
    const r = (await q("SELECT scheduled_start, scheduled_end FROM progress_notes WHERE id = $1", [n]))[0];
    await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [n, JSON.stringify({ client_arrived_at: new Date(r.scheduled_start).toISOString(), actual_end: new Date(r.scheduled_end).toISOString() })]);
    return n; };
  const view = async (n) => (await call("cg", "SELECT get_progress_note_for_caregiver($1)", [n])).v;
  const draft = await mk(1), sub = await mk(2);
  await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [sub]);
  const b0 = { d: await view(draft), s: await view(sub) };
  const meta = async () => (await q(`SELECT p.oid::regprocedure::text sig, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE proname = 'get_progress_note_for_caregiver'`));
  const before = await H.snap(db), m0 = await meta();
  await H.applyFiles(db, [MIG]);
  const after = await H.snap(db), m1 = await meta();
  const removed = before.filter((x) => !after.includes(x)).map((x) => x.split(":").slice(0, 2).join(":"));
  rec("F0 catalog: only the body of get_progress_note_for_caregiver changed; one overload, same signature, SECURITY DEFINER, same ACL",
    removed.length === 1 && removed[0] === "fn:get_progress_note_for_caregiver(uuid)" && m1.length === 1 && m1[0].sig === m0[0].sig && m1[0].d && m1[0].acl === m0[0].acl,
    `-${removed.join(", ")}; ${m1[0].acl}`);
  const acl = (await q(`SELECT a.grantee::regrole::text g, a.privilege_type p FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname = 'get_progress_note_for_caregiver' ORDER BY 1`)).map((r) => `${r.g}:${r.p}`);
  rec("ACL (aclexplode): authenticated EXECUTE, no PUBLIC / anon", acl.includes("authenticated:EXECUTE") && !acl.some((x) => /^(-|anon|public):/i.test(x)), acl.join(","));
  const a0 = { d: await view(draft), s: await view(sub) };
  const strip = (v) => { const c = JSON.parse(JSON.stringify(v)); delete c.note.units_rule; return JSON.stringify(c); };
  rec("P1 the rest of the payload is unchanged (draft and submitted)", strip(a0.d) === JSON.stringify(b0.d) && strip(a0.s) === JSON.stringify(b0.s), "compared");
  rec("P2 defaults: full_blocks / 0 for both", a0.d.note.units_rule.rule === "full_blocks" && a0.d.note.units_rule.grace_minutes === 0 && a0.s.note.units_rule.rule === "full_blocks",
    JSON.stringify([a0.d.note.units_rule, a0.s.note.units_rule]));
  await must("aaA", "SELECT set_office_units_rule($1,'grace',7,15)", [OX]);
  const a1 = { d: await view(draft), s: await view(sub) };
  rec("P3 office on grace 7: the draft shows the office rule (grace / 7); the submitted note keeps the rule it was counted with (full_blocks / 0)",
    a1.d.note.units_rule.rule === "grace" && a1.d.note.units_rule.grace_minutes === 7 && a1.s.note.units_rule.rule === "full_blocks" && a1.s.note.units_rule.grace_minutes === 0,
    JSON.stringify([a1.d.note.units_rule, a1.s.note.units_rule]));
  const other = await call("cl", "SELECT get_progress_note_for_caregiver($1)", [draft]);
  rec("R1 another user (the client) is still refused", !!other.err, (other.err || "ALLOWED").slice(0, 40));
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });

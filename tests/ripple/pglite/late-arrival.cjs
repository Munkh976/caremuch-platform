// Late arrival, no grace period (20261020120000, owner-approved Oct 6) on PGlite: boundary cases at minute
// precision for CLS and respite (09:00 -> 4, 09:00:59 -> 4, 09:01 / 09:05 / 09:06 -> 3), the derived columns
// stay unsettable, a note submitted under the old rule keeps its stored units through review (no backfill),
// a note still with the caregiver follows the new rule on its next save, and the trigger function's
// signature / security / ACL are unchanged. Usage: node tests/ripple/pglite/late-arrival.cjs
const H = require("./harness.cjs");
const LATE = "20261020120000_late_arrival_no_grace.sql";
let seq = 0; const nid = () => H.U(9950 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(LATE); const { db, q, day, call, must } = t;
  const { CX, G, OX, A } = H;
  const fnMeta = async () => (await q(`SELECT p.oid::regprocedure::text sig, p.prosecdef d, COALESCE(p.proacl::text,'') acl, md5(prosrc) h FROM pg_proc p WHERE proname = 'cp_derive_progress_note_units'`))[0];
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await day(-30), expiration_date: await day(330) }), "{}"]);
  await must("mgrX", "SELECT create_service_authorization($1,$2,$3,$4,$5::date,$6::date)", [CX, "cls", "AUTH-LATE", 400, await day(-30), await day(60)]);
  const sh = async (code) => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
      VALUES ($1,$2,$3,$4,$5::date,'09:00','10:00',$6,'assigned',1,$7)`, [id, A, CX, code, await day(-1), OX, G]); return id; };
  const note = async (code, offsetSec, { narrative = null, submit = true } = {}) => {
    const n = await must("cg", "SELECT create_progress_note_for_shift($1)", [await sh(code)]);
    const st = (await q("SELECT scheduled_start FROM progress_notes WHERE id = $1", [n]))[0].scheduled_start;
    await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,$3)", [n, JSON.stringify({ client_arrived_at: new Date(new Date(st).getTime() + offsetSec * 1000).toISOString() }), narrative]);
    const draft = (await q("SELECT units_used, arrived_late FROM progress_notes WHERE id = $1", [n]))[0];
    if (submit) await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [n]);
    const row = (await q("SELECT units_scheduled, units_used, arrived_late, status FROM progress_notes WHERE id = $1", [n]))[0];
    return { n, draft, ...row, units_used: Number(row.units_used), units_scheduled: Number(row.units_scheduled) }; };

  // under the OLD rule: one submitted note 3 minutes late (not late then: 4 units), one draft 3 minutes late
  const legacy = await note("CLS0001", 180), legacyDraft = await note("CLS0001", 180, { submit: false });
  const before = await fnMeta();
  await H.applyFiles(db, [LATE]);
  const after = await fnMeta();
  rec("F0 same signature, SECURITY INVOKER, ACL (no API role); only the body changed",
    before.sig === after.sig && before.d === false && after.d === false && before.acl === after.acl && before.h !== after.h, `${after.sig}; acl "${after.acl}"; md5 ${before.h.slice(0, 8)} -> ${after.h.slice(0, 8)}`);

  const cases = [["09:00", 0, 4, false], ["09:00:59", 59, 4, false], ["09:01", 60, 3, true], ["09:05", 300, 3, true], ["09:06", 360, 3, true]];
  const out = [];
  for (const [label, off, units, late] of cases) {
    const c = await note("CLS0001", off); const r = await note("RESP0001", off, { narrative: "We went to the park." });
    out.push({ label, ok: c.units_used === units && c.arrived_late === late && r.units_used === units && r.arrived_late === late && Number(c.draft.units_used) === units,
      d: `${label}: CLS ${c.units_scheduled}->${c.units_used}${c.arrived_late ? " late" : ""}, respite ${r.units_scheduled}->${r.units_used}${r.arrived_late ? " late" : ""}` }); }
  rec("L1 any arrival after the start, at minute precision, loses the first unit (CLS and respite, at save and at submit): 09:00 -> 4, 09:00:59 -> 4, 09:01 / 09:05 / 09:06 -> 3",
    out.every((x) => x.ok), out.map((x) => x.d).join("; "));

  // no backfill: the legacy note keeps 4 units through review; a draft follows the new rule on its next save
  const rv = await call("mgrX", "SELECT review_progress_note($1,true,NULL)", [legacy.n]);
  const lg = (await q("SELECT units_used, arrived_late, status FROM progress_notes WHERE id = $1", [legacy.n]))[0];
  await must("cg", "SELECT save_progress_note_draft($1,'{}'::jsonb,'[]'::jsonb,NULL)", [legacyDraft.n]);
  const ld = (await q("SELECT units_used, arrived_late FROM progress_notes WHERE id = $1", [legacyDraft.n]))[0];
  rec("L2 no backfill: a note submitted under the old rule (3 minutes late, 4 units) keeps 4 units and 'not late' through review; a draft still with the caregiver follows the new rule on its next save (3 units, late)",
    legacy.units_used === 4 && !legacy.arrived_late && !rv.err && lg.status === "reviewed" && Number(lg.units_used) === 4 && lg.arrived_late === false && Number(ld.units_used) === 3 && ld.arrived_late === true,
    `legacy ${legacy.units_used} -> reviewed ${lg.units_used} late=${lg.arrived_late} (${rv.err || "ok"}); draft ${legacyDraft.draft.units_used} -> ${ld.units_used} late=${ld.arrived_late}`);

  // derived columns stay unsettable, both while drafting and after submit
  const sub = await note("CLS0001", 0); const dr = await note("CLS0001", 0, { submit: false });
  await db.query("UPDATE progress_notes SET arrived_late = true, units_used = 1 WHERE id = ANY($1::uuid[])", [[sub.n, dr.n]]);
  const set = await q("SELECT id, arrived_late, units_used FROM progress_notes WHERE id = ANY($1::uuid[])", [[sub.n, dr.n]]);
  rec("L3 a writer can't set arrived_late or units_used (submitted and draft notes keep the derived values)",
    set.every((r) => r.arrived_late === false && Number(r.units_used) === 4), set.map((r) => `${r.arrived_late}/${r.units_used}`).join(", "));
  done();
})().catch((e) => { console.log("HARNESS ERROR", e.message, e.stack); process.exit(1); });

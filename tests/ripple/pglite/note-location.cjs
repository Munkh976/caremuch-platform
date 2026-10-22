// Progress note "Location" office setting on PGlite: 20261031130000 (owner, Oct 22; docs/design/note-location-setting.md).
// Catalog (additive; only the events CHECK and the two approved existing functions changed), ACL, the setter (agency admin
// only, validation, audited before / after), creation prefills only in 'default', 'free' / 'hidden' leave it empty,
// existing notes untouched (no backfill, a later mode change doesn't rewrite them), the caregiver payload carries
// location_mode and the caregiver can still change the prefilled value.
// Usage: node tests/ripple/pglite/note-location.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031130000_note_location_setting.sql";
const DEMO = "Ripple Effects Community Inclusion Center";
let seq = 0; const nid = () => H.U(9970 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(MIG); const { db, q, day, call, must } = t;
  const { CX, G, OX, A, DENY } = H;
  const evVals = async () => [...(await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='events_event_type_check'`))[0].d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await day(-30), expiration_date: await day(330) }), "{}"]);
  const sh = async () => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
      VALUES ($1,$2,$3,'CLS0001',$4::date,'09:00','10:00',$5,'assigned',1,$6)`, [id, A, CX, await day(-1 - seq), OX, G]); return id; };
  const loc = async (n) => (await q("SELECT location FROM progress_notes WHERE id = $1", [n]))[0].location;

  // a note created before the migration, with a typed location, and one without
  const old1 = await must("cg", "SELECT create_progress_note_for_shift($1)", [await sh()]);
  await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [old1, JSON.stringify({ location: "Library" })]);
  const old2 = await must("cg", "SELECT create_progress_note_for_shift($1)", [await sh()]);

  const before = await H.snap(db), ev0 = await evVals();
  await H.applyFiles(db, [MIG]);
  const after = await H.snap(db), ev1 = await evVals();
  const removed = before.filter((x) => !after.includes(x)).map((x) => x.split(":").slice(0, 2).join(":"));
  const added = after.filter((x) => !before.includes(x)).map((x) => x.split(":").slice(0, 2).join(":"));
  rec("F0 catalog: additive except the events CHECK (59 kept + office_note_location_changed) and the bodies of create_progress_note_for_shift / get_progress_note_for_caregiver (same signature, security, ACL)",
    removed.length === 3 && removed.includes("con:events.events_event_type_check") && removed.includes("fn:create_progress_note_for_shift(uuid)") && removed.includes("fn:get_progress_note_for_caregiver(uuid)")
      && ev0.length === 59 && ev1.length === 60 && ev0.every((v) => ev1.includes(v)) && ev1.includes("office_note_location_changed")
      && after.some((x) => x.startsWith("fn:create_progress_note_for_shift(uuid):") && x.endsWith(before.find((y) => y.startsWith("fn:create_progress_note_for_shift(uuid):")).split(":").slice(2).slice(-2).join(":"))),
    `-${removed.join(", ")} | +${added.join(", ")}; events ${ev0.length} -> ${ev1.length}`);
  const acl = await H.aclCheck(q, ["set_office_note_location"]);
  rec("ACL set_office_note_location SECURITY DEFINER, authenticated only", acl.ok, acl.detail);
  const cols = (await q(`SELECT note_location_mode m, note_location_default d FROM virtual_office ORDER BY name`));
  rec("D0 every existing office is 'free' with no default (today's behaviour)", cols.every((r) => r.m === "free" && r.d === null), JSON.stringify(cols));
  rec("D1 existing notes untouched (no backfill)", (await loc(old1)) === "Library" && (await loc(old2)) === null, `${await loc(old1)} / ${await loc(old2)}`);

  // setter
  const SET = "SELECT set_office_note_location($1,$2,$3)";
  const deny = [];
  for (const who of ["mgrX", "schX", "hrX", "cg", "aaB", "anon"]) { const r = await call(who, SET, [OX, "default", DEMO]); if (r.err && DENY.test(r.err)) deny.push(who); else console.log(`  not refused: ${who} ${r.err || "ok"}`); }
  rec("R1 only the agency admin of the office may set it: manager, scheduler, HR, caregiver, other agency, anon refused", deny.length === 6, deny.join(","));
  const bad = [await call("aaA", SET, [OX, "sometimes", null]), await call("aaA", SET, [OX, "default", "  "]), await call("aaA", SET, [OX, "default", "x".repeat(201)])];
  rec("V1 validation: unknown mode, 'default' without a value, more than 200 characters refused", bad.every((r) => r.err && !DENY.test(r.err)), bad.map((r) => (r.err || "ALLOWED").slice(0, 40)).join(" | "));
  const set = await call("aaA", SET, [OX, "default", `  ${DEMO} `]);
  const ev = await q(`SELECT payload FROM events WHERE event_type = 'office_note_location_changed' AND subject_id = $1`, [OX]);
  rec("S1 the agency admin sets 'default' (trimmed); audited with before / after",
    !set.err && ev.length === 1 && ev[0].payload.before.mode === "free" && ev[0].payload.after.mode === "default" && ev[0].payload.after.default === DEMO,
    `${set.err || JSON.stringify(set.v)}; events ${ev.length}`);

  // creation
  const n1 = await must("cg", "SELECT create_progress_note_for_shift($1)", [await sh()]);
  const view = (await call("cg", "SELECT get_progress_note_for_caregiver($1)", [n1])).v.note;
  await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [n1, JSON.stringify({ location: "Kalamazoo Public Library" })]);
  rec("C1 'default': a new note is prefilled with the office value; the caregiver sees location_mode 'default' and can change it",
    view.location === DEMO && view.location_mode === "default" && (await loc(n1)) === "Kalamazoo Public Library", `${view.location} / ${view.location_mode} -> ${await loc(n1)}`);
  rec("C2 a mode change doesn't rewrite existing notes", (await loc(old1)) === "Library" && (await loc(old2)) === null, `${await loc(old1)} / ${await loc(old2)}`);
  await must("aaA", SET, [OX, "hidden", null]);
  const n2 = await must("cg", "SELECT create_progress_note_for_shift($1)", [await sh()]);
  const v2 = (await call("cg", "SELECT get_progress_note_for_caregiver($1)", [n2])).v.note;
  await must("aaA", SET, [OX, "free", "kept? no"]);
  const n3 = await must("cg", "SELECT create_progress_note_for_shift($1)", [await sh()]);
  const v3 = (await call("cg", "SELECT get_progress_note_for_caregiver($1)", [n3])).v.note;
  const offs = (await q(`SELECT note_location_mode m, note_location_default d FROM virtual_office WHERE id = $1`, [OX]))[0];
  rec("C3 'hidden': empty, location_mode 'hidden'; 'free': empty, location_mode 'free' (a default given with 'free' is stored but not used)",
    v2.location === null && v2.location_mode === "hidden" && v3.location === null && v3.location_mode === "free" && offs.d === "kept? no",
    `${v2.location}/${v2.location_mode}; ${v3.location}/${v3.location_mode}`);
  const evN = (await q(`SELECT count(*)::int n FROM events WHERE event_type = 'office_note_location_changed'`))[0].n;
  rec("A1 one audit event per change (3)", evN === 3, `${evN}`);
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });

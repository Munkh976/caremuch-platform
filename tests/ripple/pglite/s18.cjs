// S18 billing flexibility on PGlite: 20261031140000 (owner, Oct 22). Catalog (additive except the events CHECK and the
// three approved existing functions), ACLs; E1 old vs new trigger on the same inputs (a matrix of arrivals / ends saved
// under the old trigger, re-saved under the new one: identical units and late flags with the defaults); the rule used is
// stored per note; rules grace / nearest at their boundaries; the setter (agency admin, 15-minute units only, grace 1-14,
// audited); adjust (submitted only, bounds, reason, roles, audit without the reason text, a note from before S18);
// review charges the adjusted units; undo keeps the adjustment; clear restores the calculation; the per-day bill equals
// the per-authorization bill in totals.
// Usage: node tests/ripple/pglite/s18.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261031140000_s18_billing_units.sql";
let seq = 0; const nid = () => H.U(9800 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(MIG); const { db, q, call, must } = t;
  const { CX, G, OX, A, TZ, DENY } = H;
  const evVals = async () => [...(await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='events_event_type_check'`))[0].d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);

  // fixtures in the office's last complete billing week
  await db.query("UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '60 days' WHERE id = $1", [OX]);
  const wks = (await q("SELECT billing_week_start w FROM virtual_office WHERE id = $1", [OX]))[0].w;
  const ws = (await q(`SELECT (d - ((extract(isodow FROM d)::int - $1 + 7) % 7) - 7)::text ws FROM (SELECT (now() AT TIME ZONE '${TZ}')::date d) x`, [wks]))[0].ws;
  const at = async (k) => (await q(`SELECT ($1::date + $2::int)::text d`, [ws, k]))[0].d;
  await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await at(-40), expiration_date: await at(300) }), "{}"]);
  const auth = await must("mgrX", "SELECT create_service_authorization($1,'cls','AUTH-S18',2000,$2::date,$3::date)", [CX, await at(-40), await at(90)]);
  const sh = async (k, start = "09:00", end = "11:00") => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
      VALUES ($1,$2,$3,'CLS0001',$4::date,$5,$6,$7,'assigned',2,$8)`, [id, A, CX, await at(k), start, end, OX, G]); return id; };
  const times = async (n) => (await q("SELECT scheduled_start, scheduled_end FROM progress_notes WHERE id = $1", [n]))[0];
  const save = async (n, arrSec, endSec) => { const r = await times(n);
    await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [n, JSON.stringify({
      client_arrived_at: new Date(Date.parse(r.scheduled_start) + arrSec * 1000).toISOString(), actual_end: new Date(Date.parse(r.scheduled_end) + endSec * 1000).toISOString() })]); };
  const note = async (k, arrSec = 0, endSec = 0, { submit = false } = {}) => {
    const n = await must("cg", "SELECT create_progress_note_for_shift($1)", [await sh(k)]); await save(n, arrSec, endSec);
    if (submit) await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [n]); return n; };
  const row = async (n) => { const j = (await q(`SELECT to_jsonb(p) j FROM progress_notes p WHERE id = $1`, [n]))[0].j;   // works before the new columns exist
    const num = (v) => (v === undefined || v === null ? null : Number(v));
    return { status: j.status, u: num(j.units_used), c: num(j.units_calculated), a: num(j.units_adjusted), r: j.units_rule ?? null, m: num(j.units_minutes), g: num(j.units_grace_minutes), l: j.arrived_late }; };

  // E1 setup: the matrix under the OLD trigger (2-hour visit, 8 units)
  const ARR = [-600, 0, 59, 60, 300, 360, 420, 899, 900, 1500], END = [600, 0, -59, -60, -480, -900, -1000];
  const matrix = [];
  for (const a of ARR) for (const e of END) { const n = await note(0, a, e); matrix.push({ n, a, e, old: await row(n) }); }
  const legacy = await note(1, 600, 0, { submit: true });   // submitted before S18: 20 minutes late... 10 minutes: 7 of 8
  const legacyRow = await row(legacy);

  const before = await H.snap(db), ev0 = await evVals();
  await H.applyFiles(db, [MIG]);
  const after = await H.snap(db), ev1 = await evVals();
  const removed = before.filter((x) => !after.includes(x)).map((x) => x.split(":").slice(0, 2).join(":"));
  rec("F0 catalog: additive except the events CHECK (60 kept + 2) and the bodies of cp_derive_progress_note_units, get_progress_note_for_staff, list_notes_for_review",
    removed.length === 4 && ["con:events.events_event_type_check", "fn:cp_derive_progress_note_units()", "fn:get_progress_note_for_staff(uuid)", "fn:list_notes_for_review(uuid)"].every((x) => removed.includes(x))
      && ev0.length === 60 && ev1.length === 62 && ev0.every((v) => ev1.includes(v)), `-${removed.join(", ")}; events ${ev0.length} -> ${ev1.length}`);
  const acl = await H.aclCheck(q, ["adjust_note_units", "get_billing_week_days", "set_office_units_rule", "cp_units_for"]);
  rec("ACL 3 API functions SECURITY DEFINER, authenticated only; cp_units_for no API role", acl.ok, acl.detail);
  rec("D0 existing notes untouched: units and flags as before, rule columns empty (no backfill)",
    (await row(legacy)).u === legacyRow.u && (await row(legacy)).r === null && (await row(matrix[0].n)).r === null, `legacy ${legacyRow.u}`);

  // E1: re-save every matrix note with the same times under the NEW trigger (defaults)
  const diff = [];
  for (const m of matrix) { await save(m.n, m.a, m.e); const r = await row(m.n);
    if (r.u !== m.old.u || r.l !== m.old.l || r.r !== "full_blocks" || r.m !== 15 || r.g !== 0 || r.c !== m.old.u) diff.push(`${m.a}/${m.e}: ${m.old.u}->${r.u}`); }
  rec(`E1 old vs new trigger on the same ${matrix.length} inputs: identical units and late flags with the defaults; the rule used (full_blocks / 15 / 0) and the calculation stored`,
    diff.length === 0 && matrix.length === 70, diff.slice(0, 4).join("; ") || `${matrix.length} identical; units seen ${[...new Set(matrix.map((m) => m.old.u))].sort((x, y) => x - y).join(",")}`);

  // setter
  const SET = "SELECT set_office_units_rule($1,$2,$3,$4)";
  const deny = [];
  for (const who of ["mgrX", "schX", "hrX", "cg", "aaB", "anon"]) { const r = await call(who, SET, [OX, "grace", 7, 15]); if (r.err && DENY.test(r.err)) deny.push(who); else console.log(`  not refused: ${who} ${r.err || "ok"}`); }
  const bad = [await call("aaA", SET, [OX, "rounded", 0, 15]), await call("aaA", SET, [OX, "grace", 0, 15]), await call("aaA", SET, [OX, "grace", 15, 15]), await call("aaA", SET, [OX, "nearest", 0, 30])];
  rec("S1 only the agency admin sets the rule; unknown rule, grace 0 / 15, 30-minute units refused",
    deny.length === 6 && bad.every((r) => r.err && !DENY.test(r.err)), `refused ${deny.join(",")}; ${bad.map((r) => (r.err || "ALLOWED").slice(0, 30)).join(" | ")}`);

  // grace 7
  await must("aaA", SET, [OX, "grace", 7, 15]);
  const g = [];
  for (const [a, e] of [[420, 0], [479, 0], [480, 0], [0, -420], [0, -480], [420, -420]]) { const n = await note(2, a, e); g.push((await row(n))); }
  rec("R1 grace 7: arrival up to 7:59 late and an end up to 7 minutes early count as on time (8 of 8); 8 minutes late / early lose a block; stored grace / 7",
    g.map((r) => r.u).join(",") === "8,8,7,8,7,8" && g.every((r) => r.r === "grace" && r.g === 7 && r.m === 15), g.map((r) => `${r.u}${r.l ? "L" : ""}`).join(","));
  // nearest
  await must("aaA", SET, [OX, "nearest", 0, 15]);
  const nr = [];
  for (const [a, e] of [[420, 0], [480, 0], [0, -420], [0, -480], [1500, -60], [0, 600]]) { const n = await note(2, a, e); nr.push((await row(n))); }
  rec("R2 nearest: served minutes / 15 rounded half up (113 -> 8, 112 -> 7, 113 -> 8, 112 -> 7, 94 -> 6), never above the 8 scheduled; stored nearest / 0",
    nr.map((r) => r.u).join(",") === "8,7,8,7,6,8" && nr.every((r) => r.r === "nearest" && r.g === 0), nr.map((r) => r.u).join(","));
  const evR = (await q(`SELECT payload FROM events WHERE event_type = 'office_units_rule_changed' AND subject_id = $1 ORDER BY occurred_at`, [OX]));
  rec("A1 rule changes audited with before / after (2)", evR.length === 2 && evR[0].payload.before.rule === "full_blocks" && evR[1].payload.after.rule === "nearest", JSON.stringify(evR.map((e) => e.payload.after)));
  await must("aaA", SET, [OX, "full_blocks", 0, 15]);
  const draftAfter = await row(nr[1] && matrix[3].n);
  rec("R3 a rule change applies from the next draft save; submitted notes keep theirs", (await row(legacy)).u === legacyRow.u && draftAfter.r === "full_blocks", `legacy ${(await row(legacy)).u}`);

  // adjust
  const ADJ = "SELECT adjust_note_units($1,$2,$3)";
  const draft = await note(3, 1500, 0);                         // 25 minutes late: 6 of 8
  const sub = await note(3, 1500, 0, { submit: true });
  const rDraft = await call("mgrX", ADJ, [draft, 8, "Caregiver entered the wrong arrival"]);
  const rBad = [await call("mgrX", ADJ, [sub, 9, "Caregiver entered the wrong arrival"]), await call("mgrX", ADJ, [sub, -1, "Caregiver entered the wrong arrival"]), await call("mgrX", ADJ, [sub, 8, "too short"]), await call("mgrX", ADJ, [sub, null, null])];
  const denyA = [];
  for (const who of ["cg", "hrX", "schX", "mgrY", "aaB", "anon"]) { const r = await call(who, ADJ, [sub, 8, "Caregiver entered the wrong arrival"]); if (r.err && DENY.test(r.err)) denyA.push(who); else console.log(`  adjust not refused: ${who} ${r.err || "ok"}`); }
  rec("J1 adjust refused on a draft, above the scheduled units, below 0, with a short reason, clearing nothing; caregiver, HR, scheduler, other office, other agency, anon refused",
    /submitted note/.test(rDraft.err || "") && rBad.every((r) => r.err && !DENY.test(r.err)) && denyA.length === 6, `${(rDraft.err || "ALLOWED").slice(0, 30)}; ${rBad.map((r) => (r.err || "ALLOWED").slice(0, 25)).join(" | ")}; refused ${denyA.join(",")}`);
  const ok = await call("mgrX", ADJ, [sub, 8, "  Caregiver entered the wrong arrival  "]);
  const rs = await row(sub);
  const evA = (await q(`SELECT payload FROM events WHERE event_type = 'progress_note_units_adjusted' AND subject_id = $1`, [sub]));
  rec("J2 the manager adjusts a submitted note: units to bill 8, calculated 6 kept; audited before / after / calculated without the reason text",
    !ok.err && rs.u === 8 && rs.c === 6 && rs.a === 8 && evA.length === 1 && evA[0].payload.before === 6 && evA[0].payload.after === 8 && evA[0].payload.calculated === 6
      && !JSON.stringify(evA[0].payload).includes("wrong arrival"), `${ok.err || JSON.stringify(ok.v)}; event ${JSON.stringify(evA[0] && evA[0].payload)}`);
  const staff = (await call("mgrX", "SELECT get_progress_note_for_staff($1)", [sub])).v;
  const queue = (await call("mgrX", "SELECT list_notes_for_review($1)", [OX])).v.rows.find((r) => r.note_id === sub);
  rec("J3 staff note shows calculated 6 / adjusted 8 / reason / by / rule; the history has the adjustment; the queue marks the note adjusted",
    staff.note.units_to_bill === 8 && staff.note.units_calculated === 6 && staff.note.units_adjusted === 8 && staff.note.units_adjust_reason === "Caregiver entered the wrong arrival"
      && staff.note.units_adjusted_by_name === "Manager X" && staff.note.units_rule === "full_blocks" && staff.history.some((h) => h.event === "progress_note_units_adjusted" && h.units_after === 8)
      && queue && queue.units_adjusted === true, `${staff.note.units_calculated}/${staff.note.units_adjusted}/${staff.note.units_adjusted_by_name}; queue ${queue && queue.units_adjusted}`);
  // review charges the adjusted units; undo keeps the adjustment; reviewed notes can't be adjusted
  const avail = async () => Number((await q("SELECT units_available FROM service_authorizations WHERE id = $1", [auth]))[0].units_available);
  const av0 = await avail(); await must("mgrX", "SELECT review_progress_note($1,true,NULL)", [sub]); const av1 = await avail();
  const onReviewed = await call("mgrX", ADJ, [sub, 7, "Caregiver entered the wrong arrival"]);
  await must("mgrX", "SELECT undo_progress_note_review($1)", [sub]); const rU = await row(sub); const av2 = await avail();
  rec("J4 review charges the 8 adjusted units; a reviewed note can't be adjusted; undo puts the 8 back and keeps the adjustment",
    av1 === av0 - 8 && /submitted note/.test(onReviewed.err || "") && rU.status === "submitted" && rU.u === 8 && rU.a === 8 && av2 === av0, `avail ${av0} -> ${av1} -> ${av2}; ${rU.status} ${rU.u}`);
  const clr = await call("mgrX", ADJ, [sub, null, null]); const rC = await row(sub);
  rec("J5 clearing the adjustment restores the calculated units (6), audited", !clr.err && rC.u === 6 && rC.a === null && rC.c === 6
    && (await q(`SELECT count(*)::int n FROM events WHERE event_type = 'progress_note_units_adjusted' AND subject_id = $1`, [sub]))[0].n === 2, `${clr.err || rC.u}`);
  const lg = await call("mgrX", ADJ, [legacy, 8, "Late arrival was a typing error"]); const rL = await row(legacy);
  const lg2 = await call("mgrX", ADJ, [legacy, null, null]); const rL2 = await row(legacy);
  rec("J6 a note submitted before S18: the first adjustment keeps its units as the calculation; clearing returns to them", !lg.err && rL.u === 8 && rL.c === legacyRow.u && !lg2.err && rL2.u === legacyRow.u,
    `${legacyRow.u} -> ${rL.u} (calc ${rL.c}) -> ${rL2.u}`);

  // per-day bill
  await must("mgrX", ADJ, [sub, 7, "Caregiver entered the wrong arrival"]);
  for (const m of matrix.slice(0, 6)) await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [m.n]);
  const toReview = [sub, legacy, ...matrix.slice(0, 6).map((m) => m.n)];
  for (const n of toReview) await must("mgrX", "SELECT review_progress_note($1,true,NULL)", [n]);
  await must("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, ws]);
  const wk = (await call("mgrX", "SELECT get_billing_week($1,$2::date)", [OX, ws])).v;
  const dy = (await call("mgrX", "SELECT get_billing_week_days($1,$2::date)", [OX, ws])).v;
  const sumL = (lines, k) => lines.reduce((s, l) => s + Number(l[k]), 0);
  const b0 = wk.batches[0], d0 = dy.batches[0];
  const dates = d0.lines.map((l) => l.service_date);
  rec("B1 per-day bill: one line per day (3 days), totals equal the per-authorization bill; the adjusted day is marked",
    d0 && b0 && d0.lines.length === 3 && new Set(dates).size === 3 && sumL(d0.lines, "units_billed") === sumL(b0.lines, "units_billed") && sumL(d0.lines, "units_scheduled") === sumL(b0.lines, "units_scheduled")
      && Number(d0.totals.units_billed) === Number(b0.totals.units_billed) && d0.lines.filter((l) => l.adjusted).length === 1 && d0.lines.find((l) => l.adjusted).service_date === (b0.lines[0].notes.find((n) => n.note_id === sub) || {}).service_date,
    `${d0 && d0.lines.map((l) => `${l.service_date} ${l.units_billed}/${l.units_scheduled}${l.adjusted ? "*" : ""}`).join(", ")}; week total ${b0 && b0.totals.units_billed}`);
  const adjBilled = await call("mgrX", ADJ, [sub, 8, "Caregiver entered the wrong arrival"]);
  const dDeny = [];
  for (const who of ["hrX", "mgrY", "cg", "aaB", "anon"]) { const r = await call(who, "SELECT get_billing_week_days($1,$2::date)", [OX, ws]); if (r.err && DENY.test(r.err)) dDeny.push(who); }
  rec("B2 a note in a bill can't be adjusted; the per-day read is refused to HR, another office, caregiver, other agency, anon",
    /submitted note/.test(adjBilled.err || "") && dDeny.length === 5, `${(adjBilled.err || "ALLOWED").slice(0, 40)}; refused ${dDeny.join(",")}`);
  done();
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; });

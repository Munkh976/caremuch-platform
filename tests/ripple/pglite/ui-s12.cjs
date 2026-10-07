// S12 on PGlite (20261025120000): units = the shift's scheduled 15-minute blocks completely inside [arrival, end],
// minute precision (late arrival AND early departure), every case Ripple listed for a 9:00–10:00 visit; respite and
// group-session notes alike; no backfill (a note submitted under the old rule keeps its units through review); a returned
// note is recalculated on resubmit; no end time -> submit refused with a clear message; the billing reads count units not
// billed for late AND early; signatures / ACLs unchanged.
// Usage: node tests/ripple/pglite/ui-s12.cjs   (local, no network)
const H = require("./harness.cjs");
const S12 = "20261025120000_s12_units_full_blocks.sql", FIX = "20261025120100_s12_units_no_schedule_fix.sql";
let seq = 0; const nid = () => H.U(9600 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(S12); const { db, q, call, must } = t;
  const { A, OX, CX, G, TZ } = H;
  const sig = async () => (await q(`SELECT string_agg(p.oid::regprocedure::text || ' ' || COALESCE(p.proacl::text,''), ' | ' ORDER BY 1) s FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('cp_derive_progress_note_units','get_billing_week','get_billing_batch')`))[0].s;
  const day = async (k) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [k]))[0].d;
  const at = async (d, hhmm) => (await q(`SELECT (($1::date + $2::time) AT TIME ZONE '${TZ}')::text t`, [d, hhmm]))[0].t;
  await db.query("UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '40 days' WHERE id = $1", [OX]);
  // a second client for the group session
  const C2 = H.U(402);
  await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Lena','Group',$3)`, [C2, A, OX]);
  for (const c of [CX, C2]) {
    await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [c, JSON.stringify({ effective_date: await day(-40), expiration_date: await day(300) }), "{}"]);
    await must("mgrX", "SELECT create_service_authorization($1,'cls',$2,400,$3::date,$4::date)", [c, `AUTH-S12-${c.slice(-3)}`, await day(-40), await day(90)]);
  }
  await must("mgrX", "SELECT create_service_authorization($1,'respite','AUTH-S12-R',400,$2::date,$3::date)", [CX, await day(-40), await day(90)]);
  const shift = async (k, client = CX, code = "CLS0001", gs = null) => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id, group_session_id)
      VALUES ($1,$2,$3,$4,$5::date,'09:00','10:00',$6,'assigned',1,$7,$8)`, [id, A, client, code, await day(k), OX, G, gs]); return id; };
  const note = async (s, arr, end, { submit = true, narrative = null } = {}) => {
    const n = await must("cg", "SELECT create_progress_note_for_shift($1)", [s]);
    const d = (await q("SELECT service_date::text d FROM progress_notes WHERE id = $1", [n]))[0].d;
    const h = { client_arrived_at: await at(d, arr) }; if (end) h.actual_end = await at(d, end);
    await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,$3)", [n, JSON.stringify(h), narrative]);
    if (submit) await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [n]); return n; };
  const units = async (n) => Number((await q("SELECT units_used u FROM progress_notes WHERE id = $1", [n]))[0].u);

  // before S12: one submitted at 09:20 (old rule: 3), one draft at 09:20 (old: 3)
  const preSub = await note(await shift(-20), "09:20", "10:00");
  const preDraft = await note(await shift(-19), "09:20", "10:00", { submit: false });
  const pre = { sub: await units(preSub), draft: await units(preDraft) };
  const sigBefore = await sig();
  await H.applyFiles(db, [S12, FIX]);
  rec("F0 same signatures and ACLs for the units trigger function and the two billing reads", (await sig()) === sigBefore, (await sig()).slice(0, 140));

  const CASES = [["09:00", "10:00", 4], ["09:01", "10:00", 3], ["09:15", "10:00", 3], ["09:20", "10:00", 2], ["09:35", "10:00", 1], ["09:50", "10:00", 0],
    ["09:00", "09:50", 3], ["09:00", "09:44", 2], ["09:20", "09:50", 1], ["08:50", "10:10", 4]];
  const got = [];
  for (const [i, [a, e, want]] of CASES.entries()) { const n = await note(await shift(-15 + i), a, e); got.push([`${a}-${e}`, await units(n), want]); }
  rec("A1 a 9:00–10:00 visit bills only full 15-minute blocks: 09:00–10:00 → 4, 09:01 → 3, 09:15 → 3, 09:20 → 2, 09:35 → 1, 09:50 → 0, 09:00–09:50 → 3, 09:00–09:44 → 2, 09:20–09:50 → 1; early arrival / late end count as the start / end (never more than 4)",
    got.every(([, u, w]) => u === w), got.map(([k, u, w]) => `${k}=${u}${u === w ? "" : `(want ${w})`}`).join(", "));
  const resp = await note(await shift(-4, CX, "RESP0001"), "09:20", "09:50", { narrative: "Board games." });
  rec("A2 respite uses the same rule (09:20–09:50 → 1)", (await units(resp)) === 1, `${await units(resp)}`);
  const gs = await must("mgrX", "SELECT create_group_session($1,$2::date,'09:00','10:00','1:3',3::smallint)", [OX, await day(-3)]);
  const gA = await shift(-3, CX, "CLS0001", gs), gB = await shift(-3, C2, "CLS0001", gs);
  const nA = await note(gA, "09:00", "10:00"), nB = await note(gB, "09:35", "10:00");
  rec("A3 group session: each client's note by its own times (09:00 → 4, 09:35 → 1)", (await units(nA)) === 4 && (await units(nB)) === 1, `${await units(nA)} / ${await units(nB)}`);
  // a note row with no scheduled times (no real note; a direct insert) keeps the earlier rule: units_scheduled
  const authId = (await q("SELECT id FROM service_authorizations WHERE client_id = $1 AND service_type = 'cls' ORDER BY created_at LIMIT 1", [CX]))[0].id;
  const raw = H.U(9690);
  await db.query(`INSERT INTO progress_notes (id, agency_id, virtual_office_id, client_id, caregiver_id, authorization_id, note_kind, service_type, service_date, units_scheduled, billable, status)
    VALUES ($1,$2,$3,$4,$5,$6,'cls','cls',$7::date,12,true,'reviewed')`, [raw, A, OX, CX, G, authId, await day(-30)]);
  rec("A4 a note row without scheduled times keeps the earlier rule (12 scheduled -> 12), not 0 (fix 20261025120100)", (await units(raw)) === 12, `${await units(raw)}`);
  // no backfill
  await must("mgrX", "SELECT review_progress_note($1,true,NULL)", [preSub]);
  await must("cg", "SELECT save_progress_note_draft($1,'{}'::jsonb,'[]'::jsonb,NULL)", [preDraft]);
  rec("N1 no backfill: the note submitted under the old rule keeps 3 through review; a draft is recalculated on its next save (3 → 2)",
    pre.sub === 3 && (await units(preSub)) === 3 && pre.draft === 3 && (await units(preDraft)) === 2, `submitted ${pre.sub} → ${await units(preSub)}; draft ${pre.draft} → ${await units(preDraft)}`);
  // returned -> recalculated on resubmit
  const rN = await note(await shift(-2), "09:00", "10:00");
  await must("mgrX", "SELECT return_progress_note($1,'Please add the reinforcers used.')", [rN]);
  const afterReturn = await units(rN);
  await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [rN, JSON.stringify({ actual_end: await at(await day(-2), "09:44") })]);
  await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [rN]);
  rec("N2 a returned note keeps its units until the caregiver edits it; resubmitted with an earlier end it is recalculated (4 → 2)", afterReturn === 4 && (await units(rN)) === 2, `${afterReturn} → ${await units(rN)}`);
  // no end time -> submit refused
  const noEnd = await note(await shift(-1), "09:00", null, { submit: false });
  await db.query("UPDATE progress_notes SET actual_end = NULL WHERE id = $1", [noEnd]);
  const ref = await call("cg", "SELECT submit_progress_note($1,'Gina Test')", [noEnd]);
  rec("E1 no end time: submit is refused with a clear message (22023 'Enter the client's end time before submitting the note'); the note stays a draft",
    !!ref.err && /end time before submitting/.test(ref.err) && (await q("SELECT status::text s FROM progress_notes WHERE id = $1", [noEnd]))[0].s === "draft", ref.err);
  // billing reads: units not billed for late AND early
  for (const n of (await q(`SELECT id FROM progress_notes WHERE status = 'submitted' ORDER BY service_date, scheduled_start`)).map((r) => r.id)) await must("mgrX", "SELECT review_progress_note($1,true,NULL)", [n]);
  const ws = (await q(`SELECT (d - ((extract(isodow FROM d)::int - 1 + 7) % 7) - 7)::text ws FROM (SELECT (now() AT TIME ZONE '${TZ}')::date d) x`))[0].ws;
  await must("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, ws]);
  const w = (await call("mgrX", "SELECT get_billing_week($1,$2::date)", [OX, ws])).v;
  const b = w.batches[0]; const notes = b.lines.flatMap((l) => l.notes);
  const lost = Number(b.totals.units_lost_late), expected = notes.reduce((s, x) => s + Number(x.units_scheduled) - Number(x.units_billed), 0);
  const early = notes.filter((x) => x.left_early).length;
  const bb = (await call("mgrX", "SELECT get_billing_batch($1)", [b.id])).v;
  rec("B1 the week's 'units not billed' (key units_lost_late) = scheduled − billed over every note (late AND early); notes carry left_early; get_billing_batch agrees",
    lost === expected && lost > 0 && early > 0 && bb.lines.reduce((s2, l) => s2 + Number(l.units_lost_late), 0) === lost, `lost ${lost} (expected ${expected}); ${notes.length} notes, ${early} left early`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

// UI S9 backend on PGlite: get_billing_week (default = last complete week, office week start; lines by client
// x authorization with FIFO across two authorizations, a weekly cap's units left, units lost to late arrival
// under the no-grace rule; every exclusion reason; pending review), the live batch writes unchanged
// (build / rebuild while open, approve with the included notes, mark billed), the late-review behaviour
// before approval / after approval / after billing, the billed lock, list_billing_week_status, refusals, ACLs.
// Usage: node tests/ripple/pglite/ui-s9.cjs   (local, no network)
const H = require("./harness.cjs");
const S9 = "20261021120000_ui_s9_weekly_billing.sql";
let seq = 0; const nid = () => H.U(9970 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(S9); const { db, q, call, must } = t;
  await H.applyFiles(db, [S9]);
  const { CX, G, OX, A, TZ } = H;
  await db.query("UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '40 days' WHERE id = $1", [OX]);
  const ws = (await q(`SELECT (d - ((extract(isodow FROM d)::int - 1 + 7) % 7) - 7)::text ws FROM (SELECT (now() AT TIME ZONE '${TZ}')::date d) x`))[0].ws;
  const at = async (k) => (await q(`SELECT ($1::date + $2::int)::text d`, [ws, k]))[0].d;
  await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await at(-30), expiration_date: await at(300) }), "{}"]);
  const AUTH = "SELECT create_service_authorization(_client_id => $1, _service_type => 'cls', _auth_number => $2, _units_authorized => $3, _effective_date => $4::date, _expiration_date => $5::date, _period_type => $6::auth_period_type, _units_per_period => $7)";
  const early = await must("mgrX", AUTH, [CX, "AUTH-EARLY", 8, await at(-30), await at(20), null, null]);
  const late = await must("mgrX", AUTH, [CX, "AUTH-LATE", 40, await at(-30), await at(90), "per_week", 16]);
  const sh = async (k, code = "CLS0001") => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
      VALUES ($1,$2,$3,$4,$5::date,'09:00','10:00',$6,'assigned',1,$7)`, [id, A, CX, code, await at(k), OX, G]); return id; };
  const note = async (shift, { off = 0, submit = true, narrative = null } = {}) => {
    const n = await must("cg", "SELECT create_progress_note_for_shift($1)", [shift]);
    const st = (await q("SELECT scheduled_start FROM progress_notes WHERE id = $1", [n]))[0].scheduled_start;
    await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,$3)", [n, JSON.stringify({ client_arrived_at: new Date(new Date(st).getTime() + off * 1000).toISOString() }), narrative]);
    if (submit) await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [n]);
    return n; };
  const review = (n) => must("mgrX", "SELECT review_progress_note($1,true,NULL)", [n]);
  const S = { a: await sh(0), b: await sh(1), c: await sh(2), d: await sh(3), e: await sh(4), f: await sh(5), g: await sh(6), h: await sh(6, "RESP0001") };
  await db.query("UPDATE shifts SET start_time = '11:00', end_time = '12:00' WHERE id = $1", [S.h]);
  const N = { a: await note(S.a), b: await note(S.b, { off: 60 }), c: await note(S.c), d: await note(S.d), e: await note(S.e), f: await note(S.f, { submit: false }),
    h: await note(S.h, { narrative: "Park visit." }) };
  for (const k of ["a", "b", "c"]) await review(N[k]);
  await must("mgrX", "SELECT return_progress_note($1,'Please add the reinforcers.')", [N.e]);
  await db.query("UPDATE progress_notes SET due_at = now() - interval '1 hour' WHERE id = $1", [N.f]);
  const WEEK = "SELECT get_billing_week($1, $2::date)";
  const reasons = (w) => Object.fromEntries(w.excluded.map((x) => [Object.keys(S).find((k) => S[k] === x.shift_id), x.reason]));

  const w0r = await call("mgrX", "SELECT get_billing_week($1)", [OX]); if (w0r.err) console.log("W0 ERR", w0r.err); const w0 = w0r.v;
  rec("W0 default week = the last complete week (office week start, office zone); no batch yet: no lines; reviewed notes show 'not_in_bill_yet'",
    w0.week_start === ws && w0.complete && w0.batch === null && w0.lines.length === 0 && reasons(w0).a === "not_in_bill_yet" && w0.office.billing_week_start === 1,
    `week ${w0.week_start}..${w0.week_end}; reasons ${JSON.stringify(reasons(w0))}`);
  await must("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, ws]);
  const w1 = (await call("mgrX", WEEK, [OX, ws])).v;
  const line = (w, num) => w.lines.find((l) => l.authorization.auth_number === num);
  const E = line(w1, "AUTH-EARLY"), L = line(w1, "AUTH-LATE");
  rec("B1 bill = reviewed notes only, by client x authorization: FIFO across two authorizations (EARLY: 09:00 + 09:01 notes, 8 scheduled / 7 billed / 1 lost to late arrival; LATE: the rollover note), totals, the weekly cap's units left after this week",
    w1.batch.status === "open" && w1.lines.length === 2 && E && Number(E.units_scheduled) === 8 && Number(E.units_billed) === 7 && Number(E.units_lost_late) === 1 && E.notes.length === 2
      && L && L.notes.length === 1 && Number(L.units_billed) === 4 && Number(L.authorization.units_per_period) === 16 && Number(L.authorization.period_left) === 12
      && Number(w1.totals.units_scheduled) === 12 && Number(w1.totals.units_billed) === 11 && Number(w1.totals.units_lost_late) === 1 && w1.lines[0].client_last_initial === "F",
    `EARLY ${E && `${E.units_scheduled}/${E.units_billed}/${E.units_lost_late}`}; LATE ${L && `${L.units_billed} cap ${L.authorization.units_per_period} left ${L.authorization.period_left}`}; totals ${JSON.stringify(w1.totals)}`);
  const r1 = reasons(w1);
  rec("X1 exclusions with reasons: submitted -> not_reviewed, returned -> returned, draft past due -> overdue, visit without a note -> no_note, respite with no respite authorization -> no_authorization_fits; pending review counted",
    r1.d === "not_reviewed" && r1.e === "returned" && r1.f === "overdue" && r1.g === "no_note" && r1.h === "no_authorization_fits" && Number(w1.pending_review) === 2,
    `${JSON.stringify(r1)}; pending ${w1.pending_review}`);
  // late review before approval -> rebuild picks it up
  await review(N.d);
  const w2a = reasons((await call("mgrX", WEEK, [OX, ws])).v).d;
  await must("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, ws]);
  const w2 = (await call("mgrX", WEEK, [OX, ws])).v;
  rec("LR1 a note reviewed after the build but before approval: 'not_in_bill_yet', then the rebuild adds it to the bill",
    w2a === "not_in_bill_yet" && line(w2, "AUTH-LATE").notes.length === 2 && Number(w2.totals.notes) === 4, `before rebuild ${w2a}; LATE notes ${line(w2, "AUTH-LATE").notes.length}`);
  // approve: only notes in the batch; then approve the week (all included notes)
  const bad = await call("mgrX", "SELECT approve_batch_notes($1,$2::uuid[])", [w2.batch.id, `{${N.e}}`]);
  const ids = w2.lines.flatMap((l) => l.notes.map((n) => n.note_id));
  const ap = await must("mgrX", "SELECT approve_batch_notes($1,$2::uuid[])", [w2.batch.id, `{${ids.join(",")}}`]);
  const w3 = (await call("mgrX", WEEK, [OX, ws])).v;
  rec("A1 approving a note that isn't in the bill (unreviewed) is refused; 'Approve week' = approve_batch_notes with the bill's notes -> batch approved",
    /not in this batch/.test(bad.err || "") && ap.remaining === 0 && w3.batch.status === "approved" && w3.batch.approved_by_name === "Manager X", `refused "${(bad.err || "ACCEPTED").slice(0, 40)}"; status ${w3.batch.status}`);
  // late review after approval: the rebuild is refused (live), the note stays out
  await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [N.e]); await review(N.e);
  const rb = await call("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, ws]);
  const w4 = (await call("mgrX", WEEK, [OX, ws])).v;
  rec("LR2 (live behaviour) a note reviewed after the week was approved: build_billing_batch refuses to rebuild an approved batch; the note shows as 'reviewed_after_approval'",
    /already reviewed and can't be rebuilt/.test(rb.err || "") && reasons(w4).e === "reviewed_after_approval", `rebuild "${(rb.err || "ACCEPTED").slice(0, 50)}"; reason ${reasons(w4).e}`);
  // billed: lock + late review after billing
  await must("mgrX", "SELECT mark_batch_billed($1)", [w2.batch.id]);
  await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [N.f]); await review(N.f);
  const w5 = (await call("mgrX", WEEK, [OX, ws])).v;
  const lock = { ret: await call("mgrX", "SELECT return_progress_note($1,'Billed note try')", [N.a]), rev: await call("mgrX", "SELECT review_progress_note($1,true,NULL)", [N.a]),
    rebuild: await call("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, ws]) };
  rec("BL1 mark billed: batch billed (by, when), every bill note billed; S8 return / review and a rebuild are refused; a note reviewed after billing stays out as 'reviewed_after_billing'",
    w5.batch.status === "billed" && w5.batch.billed_by_name === "Manager X" && !!w5.batch.billed_at && Object.values(lock).every((x) => !!x.err)
      && (await q("SELECT count(*)::int n FROM progress_notes WHERE billing_batch_id = $1 AND status <> 'billed'", [w2.batch.id]))[0].n === 0 && reasons(w5).f === "reviewed_after_billing",
    `status ${w5.batch.status}; refusals ${Object.entries(lock).map(([k, v]) => `${k}:${v.err ? "refused" : "ACCEPTED"}`).join(",")}; f ${reasons(w5).f}`);
  const st = (await call("mgrX", "SELECT list_billing_week_status()")).v.find((x) => x.office_id === OX);
  const stY = (await call("mgrY", "SELECT list_billing_week_status()")).v, stHr = (await call("hrX", "SELECT list_billing_week_status()")).v;
  rec("D1 dashboard status: office X last week billed; the office-Y manager doesn't see X; hr_staff gets nothing",
    st && st.status === "billed" && st.week_start === ws && !stY.some((x) => x.office_id === OX) && stHr.length === 0, `${JSON.stringify(st)}; hr ${stHr.length}`);
  const raw = JSON.stringify(w5);
  const wrongDay = await call("mgrX", WEEK, [OX, await at(1)]);
  rec("N1 nothing clinical in the week read (no notes text, narrative, objectives); a week not starting on the office's day is refused", !/Park visit|reinforcers|Brush/.test(raw) && /starts on ISO day 1/.test(wrongDay.err || ""), wrongDay.err || "ACCEPTED");
  const dl = []; let dn = 0;
  for (const w of ["hrX", "schX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) { const r = await call(w, WEEK, [OX, ws]); dn++; if (!r.err || !H.DENY.test(r.err)) dl.push(`${w}: ${r.err || "ALLOWED"}`); }
  rec("R1 the week read is refused (generic) for hr_staff, scheduler, caregiver, client, anon, office-Y manager, agency-B admin, system_admin", dl.length === 0, dl.join("; ") || `${dn} refused`);
  const acl = await H.aclCheck(q, ["get_billing_week", "list_billing_week_status"]);
  rec("ACL SECURITY DEFINER + authenticated, no PUBLIC/anon", acl.ok, acl.detail);
  done();
})().catch((e) => { console.log("HARNESS ERROR", e.message, e.stack); process.exit(1); });

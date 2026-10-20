// Demo UX Part 2 on PGlite (20261026120000): undo a note review (owner decision, Oct 19).
// The migration adds only undo_progress_note_review + one events CHECK value (catalog diff); ACL; undo before approval
// (back to Submitted, units back on the authorization, the note keeps its units, one audit row without PHI), then
// review again or return; an OPEN bill drops the note at once (Approve blocked until it is reviewed again and the
// week rebuilt); refused once approved (also a partial approval) or billed; refused for draft / submitted / returned
// and a non-billable review; refused across office / agency / role and for anon; the caregiver still can't edit.
// Usage: node tests/ripple/pglite/undo-review.cjs   (local, no network)
const H = require("./harness.cjs");
const UNDO = "20261026120000_undo_note_review.sql";
let seq = 0; const nid = () => H.U(9700 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(UNDO); const { db, q, call, must } = t;
  const { CX, G, OX, OY, A, TZ, users } = H;
  const checkVals = async () => (await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'events_event_type_check'`))[0].d.match(/'[a-z_]+'/g).map((s) => s.slice(1, -1));
  const before = await H.snap(db), valsBefore = await checkVals();
  await H.applyFiles(db, [UNDO]);
  const after = await H.snap(db), valsAfter = await checkVals();
  const added = after.filter((x) => !before.includes(x)), removed = before.filter((x) => !after.includes(x));
  rec("F0 the migration only adds undo_progress_note_review and replaces the events CHECK with the 51 earlier values + 'progress_note_review_undone' (catalog diff: nothing else)",
    valsBefore.length === 51 && valsAfter.length === 52 && valsBefore.every((v) => valsAfter.includes(v)) && valsAfter.filter((v) => !valsBefore.includes(v)).join() === "progress_note_review_undone"
      && added.length === 2 && removed.length === 1 && added.some((x) => x.startsWith("fn:undo_progress_note_review(uuid):")) && added.some((x) => x.startsWith("con:events.events_event_type_check:"))
      && removed[0].startsWith("con:events.events_event_type_check:"), `+${added.map((x) => x.slice(0, 50)).join(" ; ")} / -${removed.map((x) => x.slice(0, 40)).join(" ; ")}`);
  const acl = await H.aclCheck(q, ["undo_progress_note_review"]);
  const raw = (await q(`SELECT a.grantee::regrole::text g, a.privilege_type p FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname = 'undo_progress_note_review' ORDER BY 1`)).map((r) => `${r.g}:${r.p}`);
  rec("ACL undo_progress_note_review: SECURITY DEFINER, EXECUTE for authenticated only (aclexplode: no PUBLIC, no anon), one overload", acl.ok && !raw.some((x) => /^(-|anon|public):/i.test(x)) && raw.includes("authenticated:EXECUTE"), `${acl.detail}; ${raw.join(", ")}`);

  // fixtures: plan + one authorization; visits in the office's last complete week
  await db.query("UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '40 days' WHERE id = $1", [OX]);
  const wks = (await q("SELECT billing_week_start w FROM virtual_office WHERE id = $1", [OX]))[0].w;
  const ws = (await q(`SELECT (d - ((extract(isodow FROM d)::int - $1 + 7) % 7) - 7)::text ws FROM (SELECT (now() AT TIME ZONE '${TZ}')::date d) x`, [wks]))[0].ws;
  const at = async (k) => (await q(`SELECT ($1::date + $2::int)::text d`, [ws, k]))[0].d;
  await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await at(-30), expiration_date: await at(300) }), "{}"]);
  const auth = await must("mgrX", "SELECT create_service_authorization($1,'cls','AUTH-UNDO',100,$2::date,$3::date)", [CX, await at(-30), await at(90)]);
  const sh = async (k, start = "09:00", end = "10:00") => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
      VALUES ($1,$2,$3,'CLS0001',$4::date,$5,$6,$7,'assigned',1,$8)`, [id, A, CX, await at(k), start, end, OX, G]); return id; };
  const note = async (k, { submit = true, late = 0, start, end } = {}) => { const n = await must("cg", "SELECT create_progress_note_for_shift($1)", [await sh(k, start, end)]);
    const r = (await q("SELECT scheduled_start, scheduled_end FROM progress_notes WHERE id = $1", [n]))[0];
    await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [n, JSON.stringify({ client_arrived_at: new Date(Date.parse(r.scheduled_start) + late * 60000).toISOString(), actual_end: new Date(r.scheduled_end).toISOString() })]);
    if (submit) await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [n]); return n; };
  const review = (n, who = "mgrX") => must(who, "SELECT review_progress_note($1,true,NULL)", [n]);
  const undo = (n, who = "mgrX") => call(who, "SELECT undo_progress_note_review($1)", [n]);
  const row = async (n) => (await q("SELECT status, authorization_id, reviewed_at, reviewed_by, units_used::int u, billing_batch_id, batch_approved_at FROM progress_notes WHERE id = $1", [n]))[0];
  const avail = async () => Number((await q("SELECT units_available FROM service_authorizations WHERE id = $1", [auth]))[0].units_available);
  const events = async (n) => (await q(`SELECT actor_id::text a, payload, agency_id, virtual_office_id o, subject_type st FROM events WHERE event_type = 'progress_note_review_undone' AND subject_id = $1 ORDER BY occurred_at`, [n]));
  const allUndoEvents = async () => (await q(`SELECT count(*)::int n FROM events WHERE event_type = 'progress_note_review_undone'`))[0].n;
  const build = () => must("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, ws]);
  const week = async () => (await call("mgrX", "SELECT get_billing_week($1,$2::date)", [OX, ws])).v;

  // U1 undo before any bill
  const N1 = await note(0, { late: 20 });              // 20 minutes late: 2 of 4 units (S12), kept through undo
  const av0 = await avail(); await review(N1); const r1 = await row(N1); const av1 = await avail();
  const u1 = await undo(N1); const r2 = await row(N1); const av2 = await avail(); const e1 = await events(N1);
  rec("U1 manager undoes a review before the week is built: Submitted, no authorization / reviewer / review time, units back on the authorization, the note keeps its stored units (S12, no recalculation); one audit row (actor, office, note id; ids and counts only)",
    !u1.err && u1.v.status === "submitted" && u1.v.units_restored === 2 && u1.v.removed_from_batch === null && r1.status === "reviewed" && r1.u === 2 && av1 === av0 - 2
      && r2.status === "submitted" && r2.authorization_id === null && r2.reviewed_at === null && r2.reviewed_by === null && r2.u === 2 && av2 === av0
      && e1.length === 1 && e1[0].a === users.mgrX && e1[0].o === OX && e1[0].agency_id === A && e1[0].st === "progress_note"
      && Object.keys(e1[0].payload).sort().join() === "authorization_id,note_id,removed_from_batch,units_restored" && e1[0].payload.authorization_id === auth && e1[0].payload.units_restored === 2,
    `${JSON.stringify(u1.v || u1.err)}; units ${av0} -> ${av1} -> ${av2}; note units ${r1.u}/${r2.u}; events ${e1.length} ${JSON.stringify(e1[0]?.payload)}`);
  const again = await undo(N1);
  await review(N1); const r3 = await row(N1);
  rec("U2 a second undo on the now Submitted note is refused (no new audit row); the manager can mark it reviewed again (FIFO, same units)",
    /Only a reviewed note/.test(again.err || "") && (await events(N1)).length === 1 && r3.status === "reviewed" && r3.authorization_id === auth && r3.u === 2 && (await avail()) === av0 - 2,
    `${again.err}; re-review ${r3.status} ${r3.u}`);
  const N2 = await note(1); await review(N2);
  const u2 = await undo(N2, "aaA"); const ret = await call("mgrX", "SELECT return_progress_note($1,'Please add which reinforcers worked')", [N2]);
  const cgSave = await call("cg", "SELECT save_progress_note_draft($1,'{}'::jsonb,'[]'::jsonb,NULL)", [N2]);
  rec("U3 the agency admin can undo too; from Submitted the manager can Return to caregiver; then (Returned) the caregiver edits as usual",
    !u2.err && (await row(N2)).status === "returned" && !ret.err && !cgSave.err, `${u2.err || "ok"}; return ${ret.err || "ok"}; caregiver save ${cgSave.err || "ok"}`);

  // U4 the caregiver never edits a reviewed or an undone (Submitted) note
  const N3 = await note(2); await review(N3);
  const cgRev = await call("cg", "SELECT save_progress_note_draft($1,'{}'::jsonb,'[]'::jsonb,NULL)", [N3]);
  await undo(N3);
  const cgSub = await call("cg", "SELECT save_progress_note_draft($1,'{}'::jsonb,'[]'::jsonb,NULL)", [N3]);
  const cgSubmit = await call("cg", "SELECT submit_progress_note($1,'Gina Test')", [N3]);
  const cgUndo = await call("cg", "SELECT undo_progress_note_review($1)", [N3]);
  const cgDirect = await call("cg", "UPDATE progress_notes SET narrative_text = 'x' WHERE id = $1 RETURNING id", [N3]);
  rec("U4 the caregiver can't edit the reviewed note, nor the note after the undo (Submitted): save, submit and undo refused; a direct UPDATE changes nothing",
    !!cgRev.err && !!cgSub.err && !!cgSubmit.err && !!cgUndo.err && (!!cgDirect.err || !(cgDirect.rows || []).length) && (await row(N3)).status === "submitted",
    `reviewed save: ${cgRev.err}; undone save: ${cgSub.err}; submit: ${cgSubmit.err}; undo: ${cgUndo.err}; direct: ${cgDirect.err || `${(cgDirect.rows || []).length} rows`}`);
  await review(N3);

  // U5 refusals by state
  const D = await note(3, { submit: false, start: "08:00", end: "08:30" }); const S = await note(3, { start: "13:00", end: "14:00" });
  const R = await note(4, { start: "13:00", end: "14:00" }); await must("mgrX", "SELECT return_progress_note($1,'Please add the data for objective A')", [R]);
  const NB = await note(4, { start: "15:00", end: "16:00" }); await must("mgrX", "SELECT review_progress_note($1,false,'Client cancelled on arrival')", [NB]);
  const st = { draft: await undo(D), submitted: await undo(S), returned: await undo(R), nonbillable: await undo(NB) };
  rec("U5 refused with the reason: draft, submitted and returned notes ('Only a reviewed note…'); a note reviewed as not billable; nothing changes, no audit row",
    ["draft", "submitted", "returned"].every((k) => /Only a reviewed note/.test(st[k].err || "")) && /not billable/.test(st.nonbillable.err || "")
      && (await row(NB)).status === "reviewed" && (await events(D)).length + (await events(S)).length + (await events(R)).length + (await events(NB)).length === 0,
    Object.entries(st).map(([k, v]) => `${k}: ${v.err || "ACCEPTED"}`).join("; "));

  // U6 an open (built, not approved) bill: the note leaves the bill at once; Approve is blocked until it is reviewed again and the week rebuilt
  await build(); const w0 = await week(); const inBill0 = Number(w0.batches[0].totals.notes);
  const u6 = await undo(N3); const w1 = await week(); const r6 = await row(N3);
  const ex1 = w1.excluded.find((x) => x.note_id === N3)?.reason;
  await review(N3); const w2 = await week(); const ex2 = w2.excluded.find((x) => x.note_id === N3)?.reason;
  await build(); const w3 = await week();
  rec("U6 week built, not approved: undo takes the note out of the open bill now (bill " + inBill0 + " -> " + (inBill0 - 1) + " notes; audit removed_from_batch = the bill); the week shows it 'not_reviewed' with pending_review +1 (Approve blocked); reviewed again -> 'not_in_bill_yet' (Approve blocked: build again); rebuilt -> back in the bill",
    !u6.err && u6.v.removed_from_batch === w0.batches[0].id && r6.billing_batch_id === null && Number(w1.batches[0].totals.notes) === inBill0 - 1 && ex1 === "not_reviewed" && w1.pending_review === w0.pending_review + 1
      && ex2 === "not_in_bill_yet" && w2.pending_review === w0.pending_review && Number(w3.batches[0].totals.notes) === inBill0 && (await row(N3)).billing_batch_id === w0.batches[0].id
      && (await events(N3)).slice(-1)[0].payload.removed_from_batch === w0.batches[0].id,
    `bill ${inBill0} -> ${w1.batches[0].totals.notes} -> ${w3.batches[0].totals.notes}; reasons ${ex1} / ${ex2}; pending ${w0.pending_review} -> ${w1.pending_review} -> ${w2.pending_review}`);

  // U7 partial approval, then approved, then billed
  const ids = w3.batches[0].lines.flatMap((l) => l.notes.map((n) => n.note_id));
  await must("mgrX", "SELECT approve_batch_notes($1,$2::uuid[])", [w3.batches[0].id, `{${N3}}`]);
  const part = await undo(N3);
  await must("mgrX", "SELECT approve_batch_notes($1,$2::uuid[])", [w3.batches[0].id, `{${ids.join(",")}}`]);
  const appr = await undo(N1);
  const avA = await avail();
  await must("mgrX", "SELECT mark_batch_billed($1)", [w3.batches[0].id]);
  const billed = await undo(N1);
  rec("U7 refused once the note is approved in an open bill, once the week's bill is approved ('…week is approved…'), and once billed ('…billed…'); notes, units and audit unchanged",
    /week is approved/.test(part.err || "") && /week is approved/.test(appr.err || "") && /billed/.test(billed.err || "") && (await row(N1)).status === "billed" && (await row(N3)).status === "billed"
      && (await avail()) === avA && (await events(N1)).length === 1,
    `partial: ${part.err}; approved: ${appr.err}; billed: ${billed.err}`);

  // U8 scope: other office, other agency, other roles, anon, unknown note
  const N9 = await note(5, { start: "17:00", end: "18:00" }); await review(N9);
  const n0 = await allUndoEvents(); const refused = [];
  for (const who of ["mgrY", "aaB", "schX", "hrX", "cg", "cl", "sysA", "anon"]) {
    const r = await undo(N9, who); if (r.err && H.DENY.test(r.err)) refused.push(who); else console.log("  not refused:", who, r.err || JSON.stringify(r.v));
  }
  const ghost = await undo(H.U(999999), "mgrX");
  const mgrAll = await undo(N9, "mgrA");
  rec("U8 refused (generic) for a manager of another office, the other agency's admin, scheduler, hr_staff, caregiver, client, system_admin, anon and an unknown note; no audit row; an unrestricted manager of the agency may undo",
    refused.length === 8 && H.DENY.test(ghost.err || "") && !mgrAll.err && (await allUndoEvents()) === n0 + 1, `${refused.length}/8 refused (${refused.join(",")}); ghost ${ghost.err}; mgrA ${mgrAll.err || "ok"}`);

  // U9 fail closed: an audit failure rolls the undo back
  await review(N9);
  await db.exec(`ALTER TABLE events ADD CONSTRAINT tmp_no_undo CHECK (event_type <> 'progress_note_review_undone') NOT VALID`);
  const fc = await undo(N9);
  await db.exec(`ALTER TABLE events DROP CONSTRAINT tmp_no_undo`);
  rec("U9 fail closed: when the audit insert fails, the undo fails and the note stays Reviewed with its authorization", !!fc.err && (await row(N9)).status === "reviewed" && (await row(N9)).authorization_id === auth, fc.err);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

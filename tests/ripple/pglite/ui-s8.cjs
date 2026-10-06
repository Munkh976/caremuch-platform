// UI S8 backend on PGlite: list_notes_for_review (queue rows, overdue incl. not-started visits, exact
// keys, nothing clinical), get_progress_note_for_staff (header, group ratio, FIFO preview then the
// reviewed authorization, entries in IPOS order with the questions as asked, history with who / when and
// the latest return reason), get_notes_review_counts, the workflow through the unchanged B2 RPCs
// (return Submitted only, resubmit, review, billed lock), audit payloads without PHI, refusals, ACLs.
// Usage: node tests/ripple/pglite/ui-s8.cjs   (local, no network)
const H = require("./harness.cjs");
const S8 = "20261019120000_ui_s8_note_review.sql";
let seq = 0; const nid = () => H.U(9900 + ++seq);
const ROW_KEYS = "arrived_late,caregiver_id,caregiver_name,client_first_name,client_id,client_last_initial,due_at,group_session,in_batch,note_id,overdue,returned_count,reviewed_at,scheduled_end,scheduled_start,service_date,service_type,shift_id,status,submitted_at,units_scheduled,units_to_bill";

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(S8); const { db, q, day, call, must } = t;
  await H.applyFiles(db, [S8]);
  const { CX, G, OX, A, users } = H;
  await db.query("UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '10 days' WHERE id = $1", [OX]);
  const mt = Object.fromEntries((await q(`SELECT kind, id FROM measure_types WHERE agency_id IS NULL`)).map((r) => [r.kind, r.id]));
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await day(-30), expiration_date: await day(330) }), "{}"]);
  await must("mgrX", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan, JSON.stringify([
    { seq: 1, goal_text: "Goal one", objectives: [{ seq: 1, letter: "A", objective_text: "Brush teeth", staff_instructions: "Model first", service_type: "cls", responsible_party: "this_agency" }] },
    { seq: 2, goal_text: "Goal two", objectives: [{ seq: 1, letter: "A", objective_text: "Order lunch", staff_instructions: "Wait", service_type: "cls", responsible_party: "this_agency" }] }])]);
  const objs = await q(`SELECT o.id, o.objective_text FROM care_plan_objectives o JOIN care_plan_goals g ON g.id = o.goal_id WHERE g.care_plan_id = $1`, [plan]);
  for (const o of objs) await must("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [o.id, JSON.stringify([{ measure_type_id: mt.yes_no_na, prompt_text: `Did it (${o.objective_text})?` }])]);
  const auth = await must("mgrX", "SELECT create_service_authorization($1,$2,$3,$4,$5::date,$6::date)", [CX, "cls", "AUTH-S8", 40, await day(-30), await day(60)]);
  const sh = async (d, start, end, code, extra = {}) => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
      VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,'assigned',1,$9)`, [id, A, CX, code, await day(d), start, end, OX, extra.cg === undefined ? G : extra.cg]); return id; };
  const S = { cls: await sh(-1, "09:00", "10:00", "CLS0001"), resp: await sh(-1, "11:00", "12:00", "RESP0001"), none: await sh(-3, "09:00", "10:00", "CLS0001"),
    draft: await sh(-4, "09:00", "10:00", "CLS0001"), group: await sh(-1, "14:00", "15:00", "CLS0001") };
  const gs = await must("mgrX", "SELECT create_group_session($1,$2::date,'14:00','15:00','1:3',NULL)", [OX, await day(-1)]);
  await must("mgrX", "SELECT set_shift_group_session($1,$2)", [S.group, gs]);
  const write = async (shift, { narrative = null, ratio = null, submit = true } = {}) => {
    const n = await must("cg", "SELECT create_progress_note_for_shift($1)", [shift]);
    const st = (await q("SELECT scheduled_start FROM progress_notes WHERE id = $1", [n]))[0].scheduled_start;
    const ents = await q("SELECT e.id, m.id mid FROM progress_note_entries e JOIN objective_measures m ON m.objective_id = e.objective_id WHERE e.progress_note_id = $1", [n]);
    await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,$3::jsonb,$4)", [n, JSON.stringify({ client_arrived_at: new Date(new Date(st).getTime() + 360000).toISOString(), ...(ratio ? { staff_client_ratio: ratio } : {}) }),
      JSON.stringify(ents.map((e) => ({ entry_id: e.id, notes_text: "Praise worked", data: { [e.mid]: { value: "Yes" } } }))), narrative]);
    if (submit) await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [n]);
    return n; };
  const nC = await write(S.cls), nR = await write(S.resp, { narrative: "We went to the park." }), nG = await write(S.group, { ratio: "1:3" }), nD = await write(S.draft, { submit: false });
  await db.query("UPDATE progress_notes SET due_at = now() - interval '1 hour' WHERE id = $1", [nD]);   // the draft's deadline is past (4 days ago anyway)

  // ---- queue ----
  const LIST = "SELECT list_notes_for_review($1)";
  const l0 = (await call("mgrX", LIST, [OX])).v; const row = (l, s) => l.rows.find((r) => r.shift_id === s);
  const keysOk = l0.rows.length > 0 && l0.rows.every((r) => Object.keys(r).sort().join(",") === ROW_KEYS);
  rec("Q1 queue: submitted CLS / respite / group notes, the overdue draft and the not-started overdue visit; exact keys; client first name + last initial; DB clock + office zone; nothing clinical",
    l0.rows.length === 5 && keysOk && row(l0, S.cls).status === "submitted" && row(l0, S.resp).service_type === "respite" && row(l0, S.group).group_session
      && row(l0, S.none).status === "not_started" && row(l0, S.none).overdue && row(l0, S.none).note_id === null && row(l0, S.draft).status === "draft" && row(l0, S.draft).overdue
      && row(l0, S.cls).client_last_initial === "F" && row(l0, S.cls).arrived_late && Number(row(l0, S.cls).units_to_bill) === Number(row(l0, S.cls).units_scheduled) - 1
      && l0.timezone === H.TZ && !/Brush teeth|Model first|Praise worked|park/.test(JSON.stringify(l0)),
    `${l0.rows.length} rows: ${l0.rows.map((r) => `${Object.keys(S).find((k) => S[k] === r.shift_id)}=${r.status}${r.overdue ? "(overdue)" : ""}`).join(", ")}; keys exact ${keysOk}`);

  // ---- detail ----
  const DET = "SELECT get_progress_note_for_staff($1)";
  const d0 = (await call("mgrX", DET, [nC])).v;
  rec("D1 detail: header, late flag, units, FIFO preview of the authorization review would use, entries in IPOS order with the questions as asked, history created + submitted",
    d0.note.status === "submitted" && d0.note.arrived_late && d0.authorization?.auth_number === "AUTH-S8" && d0.authorization.preview === true
      && d0.entries.map((e) => e.objective_text).join("|") === "Brush teeth|Order lunch" && d0.entries.every((e) => e.questions_as_asked && e.answers && Object.values(e.answers)[0].value === "Yes")
      && d0.history.map((h) => h.event).join(",") === "progress_note_created,progress_note_submitted" && d0.client.last_initial === "F" && d0.caregiver_name === "Gina Test",
    `auth ${d0.authorization && d0.authorization.auth_number} preview ${d0.authorization && d0.authorization.preview}; entries ${d0.entries.map((e) => e.objective_text)}; history ${d0.history.map((h) => h.event.replace("progress_note_", ""))}`);
  // ---- workflow: return (submitted only) -> resubmit -> review -> billed lock ----
  const ret = await call("mgrX", "SELECT return_progress_note($1,$2)", [nC, "Please add the reinforcers used."]);
  await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [nC]);
  const rv = await call("mgrX", "SELECT review_progress_note($1,true,NULL)", [nC]);
  const d2 = (await call("mgrX", DET, [nC])).v;
  const retReviewed = await call("mgrX", "SELECT return_progress_note($1,$2)", [nC, "Too late to return this one."]);
  const hist = d2.history.map((h) => `${h.event.replace("progress_note_", "")}${h.resubmission ? "(re)" : ""}`).join(",");
  rec("W1 return (Submitted) -> resubmit -> review: history submitted, returned (reason, who), resubmitted, reviewed (who); the reviewed authorization replaces the preview; a Reviewed note can't be returned (unchanged RPC, owner decision)",
    !ret.err && !rv.err && hist === "created,submitted,returned,submitted(re),reviewed" && d2.history.find((h) => h.event === "progress_note_returned").reason === "Please add the reinforcers used."
      && d2.history.find((h) => h.event === "progress_note_reviewed").by === "Manager X" && d2.authorization.preview === false && d2.authorization.auth_number === "AUTH-S8"
      && /Only a submitted note can be returned/.test(retReviewed.err || ""),
    `history ${hist}; auth preview ${d2.authorization.preview}; return reviewed "${(retReviewed.err || "ACCEPTED").slice(0, 45)}"`);
  const wk = (await q(`SELECT (date_trunc('week', $1::date)::date)::text w`, [await day(-1)]))[0].w;
  const bb = await must("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, wk]);
  await must("mgrX", "SELECT approve_batch_notes($1,$2::uuid[])", [bb.batch_id, `{${nC}}`]);
  await must("mgrX", "SELECT mark_batch_billed($1)", [bb.batch_id]);
  const lock = { ret: await call("mgrX", "SELECT return_progress_note($1,'Billed already, try')", [nC]), rev: await call("mgrX", "SELECT review_progress_note($1,true,NULL)", [nC]),
    void: await call("mgrX", "SELECT void_progress_note($1,'x')", [nC]) };
  const d3 = (await call("mgrX", DET, [nC])).v;
  rec("W2 billed notes are locked: return, review and void refused; the detail reports billed + in batch",
    Object.values(lock).every((x) => !!x.err) && d3.note.status === "billed" && d3.note.in_batch, Object.entries(lock).map(([k, v]) => `${k}: ${(v.err || "ACCEPTED").slice(0, 40)}`).join("; "));

  // ---- the questions as asked (after the workflow, so no later resubmit sees the changed questions) ----
  const objA = objs.find((o) => o.objective_text === "Brush teeth").id;
  await must("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [objA, JSON.stringify([{ measure_type_id: mt.yes_no_na, prompt_text: "A NEW QUESTION" }])]);
  const dG = (await call("mgrX", DET, [nG])).v, dR = (await call("mgrX", DET, [nR])).v;
  rec("D2 the questions shown are the ones asked on that visit (snapshot), not today's; respite shows the narrative and no entries; the group note shows the session ratio",
    dG.entries[0].measures[0].prompt_text === "Did it (Brush teeth)?" && dR.note.note_kind === "respite" && dR.note.narrative_text === "We went to the park." && dR.entries.length === 0
      && dG.group_session?.staff_client_ratio === "1:3" && dG.note.staff_client_ratio === "1:3",
    `prompt "${dG.entries[0].measures[0].prompt_text}"; respite entries ${dR.entries.length}; group ${JSON.stringify(dG.group_session)}`);

  // ---- counts, audit ----
  const C = "SELECT get_notes_review_counts()";
  const cX = (await call("mgrX", C)).v, cY = (await call("mgrY", C)).v, cHr = (await call("hrX", C)).v, cCg = (await call("cg", C)).v, cA = (await call("mgrA", C)).v;
  const ox = cX.find((x) => x.office_id === OX);
  rec("C1 counts: office X has 2 to review (respite, group) and 2 overdue (draft, not started); office-Y manager doesn't see X; hr_staff / caregiver get nothing",
    ox && Number(ox.to_review) === 2 && Number(ox.overdue) === 2 && !cY.some((x) => x.office_id === OX) && cHr.length === 0 && cCg.length === 0 && cA.some((x) => x.office_id === OX),
    `X ${JSON.stringify(ox)}; Y sees X ${cY.some((x) => x.office_id === OX)}; hr ${cHr.length}; cg ${cCg.length}`);
  const ev = await q(`SELECT event_type, payload FROM events WHERE subject_id = $1 AND event_type IN ('progress_note_returned','progress_note_reviewed')`, [nC]);
  const evText = JSON.stringify(ev);
  rec("A1 return and review each wrote one audit event (existing types); payloads hold ids / counts / flags only (no reason text, no names)",
    ev.filter((e) => e.event_type === "progress_note_returned").length === 1 && ev.filter((e) => e.event_type === "progress_note_reviewed").length === 1
      && !/reinforcers|Carla|Fixture|Gina/.test(evText) && ev.every((e) => Object.keys(e.payload).every((k) => ["note_id", "returned_count", "billable", "authorization_id", "units_used"].includes(k))),
    ev.map((e) => `${e.event_type}: ${Object.keys(e.payload)}`).join("; "));

  // ---- refusals, ACL ----
  const dl = []; let dn = 0;
  for (const w of ["hrX", "schX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) for (const [sql, p] of [[LIST, [OX]], [DET, [nR]]]) { const r = await call(w, sql, p); dn++; if (!r.err || !H.DENY.test(r.err)) dl.push(`${w}: ${r.err || "ALLOWED"}`); }
  const allowed = []; for (const w of ["mgrX", "mgrA", "aaA"]) allowed.push(!(await call(w, DET, [nR])).err);
  rec("R1 queue and detail refused (generic) for hr_staff, scheduler, caregiver, client, anon, office-Y manager, agency-B admin, system_admin; allowed for the office's manager, an unrestricted manager, the agency admin",
    dl.length === 0 && allowed.every(Boolean), dl.join("; ") || `${dn} refused; allowed ${allowed}`);
  const acl = await H.aclCheck(q, ["list_notes_for_review", "get_progress_note_for_staff", "get_notes_review_counts", "cp_office_note_queue"]);
  rec("ACL 3 reads SECURITY DEFINER + authenticated, no PUBLIC/anon; the cp_ queue helper has no API role", acl.ok, acl.detail);
  done();
})().catch((e) => { console.log("HARNESS ERROR", e.message, e.stack); process.exit(1); });

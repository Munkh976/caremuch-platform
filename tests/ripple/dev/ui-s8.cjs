// UI S8 backend on DEV through real logins (mirrors pglite/ui-s8.cjs): grants, the queue and the staff
// note detail, return (reason required, Submitted only) -> resubmit -> review through the unchanged B2
// RPCs, a real billed batch locks the note, audit rows without PHI, role and cross-office refusals, the
// menu seed, NB1. Usage: node tests/ripple/dev/ui-s8.cjs <before|after>
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, dbNow, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const NEW_FNS = ["list_notes_for_review", "get_progress_note_for_staff", "get_notes_review_counts"];

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`,
    [[...NEW_FNS, "cp_office_note_queue"]])).rows);
  const api = acl.filter((f) => NEW_FNS.includes(f.proname)), helper = acl.find((f) => f.proname === "cp_office_note_queue");
  rec("ACL 3 reads SECURITY DEFINER + authenticated only (no PUBLIC/anon), one overload each; the queue helper has no API role",
    pass(api.length === 3 && api.every((f) => f.d && /authenticated=X/.test(f.acl) && !/(^|[{,])=X|anon=X/.test(f.acl)) && helper && !/authenticated=X|anon=X|(^|[{,])=X/.test(helper.acl)),
    acl.map((f) => `${f.proname} ${f.acl}`).join(" | "));
  const menu = (await admin.from("role_permissions").select("role_code").eq("module_code", "progress_notes_review")).data.map((r) => r.role_code).sort();
  rec("M1 menu seed: 'Notes to Review' for agency_admin and manager only", pass(menu.join(",") === "agency_admin,manager"), menu.join(","));
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 10 * 864e5).toISOString() }).eq("id", F.OX);
  const plan = await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300) } });
  await must(F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: plan, _goals: [{ seq: 1, goal_text: "Goal one", objectives: [{ seq: 1, letter: "A", objective_text: "Brush teeth", staff_instructions: "Model first", service_type: "cls", responsible_party: "this_agency" }] }] });
  await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-S8-${RUN}`, _units_authorized: 40, _effective_date: await dbDay(-30), _expiration_date: await dbDay(60) });
  await ins("caregiver_skills", [{ caregiver_id: F.G, care_type_code: "RESP0001", is_demo: true }]);
  const sh = async (d, start, end, code) => {
    const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: code, shift_date: await dbDay(d), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: "S8 fixture", _override_reason: "S8 fixture (disposable)" });
    return id; };
  const S = { cls: await sh(-1, "09:00", "10:00", "CLS0001"), resp: await sh(-1, "11:00", "12:00", "RESP0001"), none: await sh(-3, "09:00", "10:00", "CLS0001") };
  const write = async (shift, narrative = null) => {
    const n = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: shift });
    const st = (await admin.from("progress_notes").select("scheduled_start").eq("id", n).single()).data.scheduled_start;
    await must(F.cg.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: new Date(Date.parse(st) + 360000).toISOString() }, _entries: [], _narrative_text: narrative });
    await must(F.cg.c, "submit_progress_note", { _note_id: n, _typed_signature: "ZZ Caregiver" });
    return n; };
  const nC = await write(S.cls), nR = await write(S.resp, "We went to the park.");
  const l0 = await must(F.mgrX.c, "list_notes_for_review", { _office_id: F.OX });
  const row = (s) => l0.rows.find((r) => r.shift_id === s);
  rec("Q1 queue: two submitted notes (CLS, respite) and the not-started visit past its deadline as overdue; late flag and units to bill; nothing clinical",
    pass(l0.rows.length === 3 && row(S.cls).status === "submitted" && row(S.resp).service_type === "respite" && row(S.none).status === "not_started" && row(S.none).overdue
      && row(S.cls).arrived_late && row(S.cls).units_to_bill === row(S.cls).units_scheduled - 1 && !/Brush teeth|Model first|park/.test(JSON.stringify(l0))),
    l0.rows.map((r) => `${Object.keys(S).find((k) => S[k] === r.shift_id)}=${r.status}${r.overdue ? "(overdue)" : ""}`).join(", "));
  const d0 = await must(F.mgrX.c, "get_progress_note_for_staff", { _note_id: nC });
  rec("D1 staff detail: late flag, FIFO preview of the authorization, the objective with its instructions, history created + submitted",
    pass(d0.note.arrived_late && d0.authorization?.preview === true && d0.authorization.auth_number === `ZZ-S8-${RUN}` && d0.entries[0].staff_instructions === "Model first"
      && d0.history.map((h) => h.event).join(",") === "progress_note_created,progress_note_submitted"), `auth ${JSON.stringify(d0.authorization)}; history ${d0.history.map((h) => h.event)}`);
  const empty = await rpc(F.mgrX.c, "return_progress_note", { _note_id: nC, _reason: "   " });
  await must(F.mgrX.c, "return_progress_note", { _note_id: nC, _reason: "Please add the reinforcers used." });
  const dRet = await rpc(F.mgrX.c, "get_progress_note_for_staff", { _note_id: nC });
  rec("W0 right after a return the staff detail reads (status returned; the reason on the latest return event)",
    pass(!dRet.err && dRet.v.note.status === "returned" && dRet.v.history.find((h) => h.event === "progress_note_returned")?.reason === "Please add the reinforcers used."), dRet.err || "ok");
  await must(F.cg.c, "submit_progress_note", { _note_id: nC, _typed_signature: "ZZ Caregiver" });
  await must(F.mgrX.c, "review_progress_note", { _note_id: nC, _billable: true, _non_billable_reason: null });
  const retRev = await rpc(F.mgrX.c, "return_progress_note", { _note_id: nC, _reason: "Too late to return this one." });
  const d1 = await must(F.mgrX.c, "get_progress_note_for_staff", { _note_id: nC });
  rec("W1 an empty reason is refused by the server; return -> resubmit -> review works; history has the reason and who; a Reviewed note can't be returned (unchanged RPC; the 10-character minimum is UI-only)",
    pass(/A reason is required/.test(empty.err || "") && d1.note.status === "reviewed" && d1.authorization.preview === false
      && d1.history.map((h) => h.event.replace("progress_note_", "")).join(",") === "created,submitted,returned,submitted,reviewed"
      && d1.history.find((h) => h.event === "progress_note_returned").reason === "Please add the reinforcers used." && /Only a submitted note can be returned/.test(retRev.err || "")),
    `empty "${(empty.err || "ACCEPTED").slice(0, 40)}"; history ${d1.history.map((h) => `${h.event.replace("progress_note_", "")}${h.by ? "/" + (h.by.startsWith("ZZ") ? "fixture user" : "?") : ""}`)}; return reviewed "${(retRev.err || "ACCEPTED").slice(0, 40)}"`);
  const wk = await pgRead(async (c) => (await c.query(`SELECT date_trunc('week', $1::date)::date::text w`, [await dbDay(-1)])).rows[0].w);
  const bb = await must(F.mgrX.c, "build_billing_batch", { _office_id: F.OX, _week_start: wk });
  await must(F.mgrX.c, "approve_batch_notes", { _batch_id: bb.batch_id, _note_ids: [nC] });
  await must(F.mgrX.c, "mark_batch_billed", { _batch_id: bb.batch_id });
  const lock = { ret: await rpc(F.mgrX.c, "return_progress_note", { _note_id: nC, _reason: "Billed already - try anyway" }), rev: await rpc(F.mgrX.c, "review_progress_note", { _note_id: nC, _billable: true, _non_billable_reason: null }),
    void: await rpc(F.mgrX.c, "void_progress_note", { _note_id: nC, _reason: "x" }), cgSave: await rpc(F.cg.c, "save_progress_note_draft", { _note_id: nC, _header: {}, _entries: [], _narrative_text: null }) };
  const d2 = await must(F.mgrX.c, "get_progress_note_for_staff", { _note_id: nC });
  rec("B1 a real billed batch (build, approve, mark billed) locks the note: return, review, void and the caregiver's save are refused; the detail says billed", pass(Object.values(lock).every((x) => !!x.err) && d2.note.status === "billed"),
    Object.entries(lock).map(([k, v]) => `${k}: ${(v.err || "ACCEPTED").slice(0, 38)}`).join("; "));
  const ev = (await admin.from("events").select("event_type, payload").eq("subject_id", nC).in("event_type", ["progress_note_returned", "progress_note_reviewed"])).data || [];
  rec("A1 return and review wrote one audit row each, payloads ids / counts / flags only (no reason text, no names)",
    pass(ev.length === 2 && !/reinforcers|ZZ|park/.test(JSON.stringify(ev)) && ev.every((e) => Object.keys(e.payload).every((k) => ["note_id", "returned_count", "billable", "authorization_id", "units_used"].includes(k)))),
    ev.map((e) => `${e.event_type}: ${Object.keys(e.payload)}`).join("; "));
  const cnt = (await must(F.mgrX.c, "get_notes_review_counts", {})).find((x) => x.office_id === F.OX);
  const cntY = await must(F.mgrY.c, "get_notes_review_counts", {});
  rec("C1 counts: office X has 1 to review (respite) and 1 overdue (not started); the office-Y manager doesn't see X", pass(cnt && cnt.to_review === 1 && cnt.overdue === 1 && !cntY.some((x) => x.office_id === F.OX)), JSON.stringify(cnt));
  const dl = []; let dn = 0;
  for (const [label, c] of [["hr_staff", F.hrX.c], ["scheduler", F.schX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]])
    for (const [fn, args] of [["list_notes_for_review", { _office_id: F.OX }], ["get_progress_note_for_staff", { _note_id: nR }], ["return_progress_note", { _note_id: nR, _reason: "Not my office or role" }], ["review_progress_note", { _note_id: nR, _billable: true, _non_billable_reason: null }]]) {
      const r = await rpc(c, fn, args); dn++; if (!r.err || !DENY.test(r.err)) dl.push(`${label}->${fn}: ${r.err || "ALLOWED"}`); }
  const still = (await admin.from("progress_notes").select("status").eq("id", nR).single()).data.status;
  rec("R1 queue, detail, return and review refused (generic) for hr_staff, scheduler, caregiver, client, anon, office-Y manager, agency-B admin, system_admin; the note is untouched",
    pass(dl.length === 0 && still === "submitted"), dl.join("; ") || `${dn} refused; note ${still}`);
}

(async () => {
  log(`=== UI S8 backend — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      // S8 itself is live (20261019120000/20261019120100); "before" now gates the same-slice detail fix
      // (20261019120200): the detail read must still be the body the fix's rollback restores.
      const s = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*)::int FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)) fns,
        (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = 'get_progress_note_for_staff') h`, [[...NEW_FNS, "cp_office_note_queue"]])).rows[0]);
      rec("B0 before the detail fix: the 4 S8 functions are live and get_progress_note_for_staff is still the pre-fix body (md5 the rollback restores)",
        pass(s.fns === 4 && s.h === "99fe3923e729f8ab0f3e6c3b97a6f3e8"), JSON.stringify(s));
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) {
      for (const { id } of (await admin.from("progress_notes").select("id").eq("client_id", F.CX)).data || []) await admin.from("events").delete().eq("subject_id", id);
      await teardownB2(F);
      for (const t of ["plan_training_records", "plan_training_forms", "plan_inservice_forms", "care_plans"]) await admin.from(t).delete().eq("client_id", F.CX);
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.progress_notes WHERE client_id = $1)::int notes,
        (SELECT count(*) FROM public.billing_batches WHERE virtual_office_id = ANY($2::uuid[]))::int batches,
        (SELECT count(*) FROM public.shifts WHERE id = ANY($3::uuid[]))::int shifts,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($2::uuid[]))::int ev`, [F.CX, [F.OX, F.OY, F.OZ], F.b2shifts || []])).rows[0]);
      log(`S8 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();

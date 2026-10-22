// S17 IPOS versions on DEV through real logins (mirrors pglite/s17.cjs).
// `before`: the 10 functions S17 changes as stored (md5), none of the new objects; NB1 (run with
//   RIPPLE_WRITE_NOBREAK_BASELINE=1 for the fresh baseline the owner asked for); the shift-creation probe: a manager's
//   direct insert (the order wizard's path) of a visit after the IPOS expiration and after the CLS authorization end is
//   ACCEPTED today (removed again).
// `after` (run with RIPPLE_NB1_HASHES=1: eligibility and assign functions must be byte-identical to the fresh baseline):
//   aclexplode, start pending (v1 stays in effect, eligibility identical), activation, a revision, the same probe now
//   REFUSED with the clear messages (insert and move), everything else on that path unchanged (inside the dates, no IPOS,
//   other updates of a late visit), get_shift_creation_limits, list_ipos_expiry.
// Usage: node tests/ripple/dev/s17.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, dbNow, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const BEFORE = { update_care_plan_fields: "ea047e956fc78b1824150cb13273c1c4", upsert_care_plan_goals: "70273f101e0ca99aa4a19c6f086ec91c",
  set_objective_measures: "32ee8d25e89a9901eeae3ec344f82295", set_care_plan_rows: "6fd9e8d3386855dd5e92d1ce91a5310c",
  would_bump_training_version: "2cab99f675a9a8864928f0425321c3e1", record_inservice_form: "a1670f358e309987a07f4224b832c9ac",
  record_training_form: "a41b516fb8cd6db9bc0b9426824832ff", add_training_attendees: "6ea1a7942d5281bf0e65326a4d21170b",
  get_client_training_context: "d98e059eab3dea5e3c8bafbed92becf5", cp_attachment_parent: "3c2aad5a800e715e23a22262badaa0e2" };
const NEW = ["start_pending_plan_version", "get_shift_creation_limits", "list_ipos_expiry", "cp_try_activate_plan", "cp_activate_due_plans",
  "cp_plan_snapshot", "cp_record_revision", "cp_revision_baseline", "cp_guard_shift_dates", "cp_shift_creation_limits"];
const cat = () => pgRead(async (c) => (await c.query(`SELECT p.proname n, pg_get_function_identity_arguments(p.oid) a, md5(p.prosrc) h, p.prosecdef d,
    (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY 1) FROM aclexplode(p.proacl) x) acl
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [[...Object.keys(BEFORE), ...NEW]])).rows);

async function fixtures(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled: true, care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 20 * 864e5).toISOString() }).eq("id", F.OX);
  F.plan = await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(25) } });
  await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-17-${RUN}`, _units_authorized: 40, _effective_date: await dbDay(-30), _expiration_date: await dbDay(15) });
  F.b2shifts = [];
  return must;
}
// the order wizard's path: a staff member's direct insert under RLS
async function insertShift(F, c, k, extra = {}) {
  const row = { agency_id: A, virtual_office_id: extra.office || F.OX, client_id: extra.client || F.CX, order_title: `ZZ ${RUN}`, care_type_code: extra.code || "CLS0001",
    shift_date: await dbDay(k), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true };
  const { data, error } = await c.from("shifts").insert(row).select("id").single();
  if (data) F.b2shifts.push(data.id);
  return { id: data && data.id, err: error && error.message };
}

async function before(F) {
  const f = await cat();
  const bad = Object.entries(BEFORE).filter(([n, h]) => !f.some((x) => x.n === n && x.h === h));
  rec("B0 before: the 10 functions S17 changes are stored as recorded (md5); none of the 10 new functions exist", pass(bad.length === 0 && !f.some((x) => NEW.includes(x.n))),
    bad.length ? `differ ${bad.map(([n]) => n).join(",")}` : "10/10, no new");
  await fixtures(F);
  const a = await insertShift(F, F.mgrX.c, 26), d = await insertShift(F, F.mgrX.c, 16), ok = await insertShift(F, F.mgrX.c, 10);
  rec("B1 today a manager's direct insert (the order wizard's path) of a visit after the IPOS expiration (+26) and after the CLS authorization end (+16) is ACCEPTED; inside the dates too",
    pass(!a.err && !d.err && !ok.err), `${a.err || "ok"} | ${d.err || "ok"} | ${ok.err || "ok"}`);
}

async function after(F) {
  const anon = createClient(URL_, ANON, opts);
  const f = await cat();
  const api = ["start_pending_plan_version", "get_shift_creation_limits", "list_ipos_expiry", ...Object.keys(BEFORE).filter((n) => n !== "cp_attachment_parent")];
  const internal = NEW.filter((n) => n.startsWith("cp_") && n !== "cp_activate_due_plans").concat("cp_attachment_parent");
  const okApi = api.every((n) => { const x = f.find((y) => y.n === n); return x && x.d && /authenticated:EXECUTE/.test(x.acl) && !/(^|,)(-|anon|public):/i.test(x.acl); });
  const okInt = internal.every((n) => { const x = f.find((y) => y.n === n); return x && !/(^|,)(-|anon|public|authenticated):/i.test(x.acl); });
  const due = f.find((y) => y.n === "cp_activate_due_plans");
  const sameArgs = Object.keys(BEFORE).every((n) => f.some((x) => x.n === n && x.h !== BEFORE[n]));
  rec("ACL (aclexplode): 13 API functions SECURITY DEFINER, authenticated only; 8 internal helpers no API role; cp_activate_due_plans service_role only; the 10 changed bodies are new",
    pass(okApi && okInt && due && /service_role:EXECUTE/.test(due.acl) && !/authenticated|anon|-:/.test(due.acl) && sameArgs), f.map((x) => `${x.n} ${x.acl}`).join(" | ").slice(0, 900));
  const must = await fixtures(F);
  const S0 = (await insertShift(F, F.mgrX.c, 3)).id;
  const e0 = JSON.stringify((await rpc(F.mgrX.c, "check_assignment_eligibility", { _shift_id: S0, _caregiver_id: F.G })).v);
  const p2 = await must(F.mgrX.c, "start_pending_plan_version", { _care_plan_id: F.plan, _plan_type: "annual", _header: { effective_date: await dbDay(-1), expiration_date: await dbDay(380) } });
  const st1 = (await admin.from("care_plans").select("version, status").eq("client_id", F.CX).order("version")).data;
  const e1 = JSON.stringify((await rpc(F.mgrX.c, "check_assignment_eligibility", { _shift_id: S0, _caregiver_id: F.G })).v);
  const again = await rpc(F.mgrX.c, "start_pending_plan_version", { _care_plan_id: F.plan });
  const hr = await rpc(F.hrX.c, "start_pending_plan_version", { _care_plan_id: F.plan });
  rec("P1 start a pending version: v1 active + v2 pending; eligibility for the same visit byte-identical; a second pending refused (reason); HR refused (generic)",
    pass(st1.map((x) => `${x.version}:${x.status}`).join(" ") === "1:active 2:pending" && e1 === e0 && /already pending/.test(again.err || "") && DENY.test(hr.err || "")), `${st1.map((x) => `${x.version}:${x.status}`).join(" ")}; same ${e1 === e0}`);
  await must(F.hrX.c, "record_inservice_form", { _care_plan_id: p2, _case_manager_name: "ZZ CM", _program_lead_id: F.mgrX.id, _trained_on: await dbDay(0), _signed_at: new Date(Date.parse(await dbNow()) - 6e4).toISOString(), _field_values: {} });
  const mid = (await admin.from("care_plans").select("status").eq("id", p2).single()).data.status;
  await must(F.hrX.c, "record_training_form", { _care_plan_id: p2, _plan_document_type: "ipos_annual", _plan_effective_date: null, _location: null,
    _records: [{ caregiver_id: F.G, training_date: await dbDay(0), trainer_name: "ZZ Trainer", signed_date: await dbDay(0) }], _field_values: {} });
  const st2 = (await admin.from("care_plans").select("version, status, revision").eq("client_id", F.CX).order("version")).data;
  const actEv = ((await admin.from("events").select("payload").eq("event_type", "care_plan_activated").eq("subject_id", p2)).data || []);
  rec("P2 the in-service alone keeps v2 pending; + a session activates it: v1 superseded, v2 active rev 0, one care_plan_activated (ids only)",
    pass(mid === "pending" && st2.map((x) => `${x.version}:${x.status}:${x.revision}`).join(" ") === "1:superseded:0 2:active:0" && actEv.length === 1 && !/ZZ/.test(JSON.stringify(actEv))),
    `${mid}; ${st2.map((x) => `${x.version}:${x.status}:${x.revision}`).join(" ")}; events ${actEv.length}`);
  await must(F.mgrX.c, "update_care_plan_fields", { _care_plan_id: p2, _header: { recorder_name: "ZZ Recorder" }, _field_values: null });
  await must(F.mgrX.c, "update_care_plan_fields", { _care_plan_id: p2, _header: { recorder_name: "ZZ Recorder" }, _field_values: null });
  const revs = (await F.mgrX.c.from("care_plan_revisions").select("revision, summary").eq("care_plan_id", p2).order("revision")).data || [];
  const hrRevs = (await F.hrX.c.from("care_plan_revisions").select("revision").eq("care_plan_id", p2)).data || [];
  rec("P3 an edit of the active version is revision 1 ('header'); the same save again doesn't bump; managers read revisions, HR doesn't",
    pass(revs.map((x) => `${x.revision}:${x.summary}`).join("|") === "0:activated|1:header" && hrRevs.length === 0), revs.map((x) => `${x.revision}:${x.summary}`).join(" | "));

  // creation limits through the same path as B1 (v2 now expires +380; set +25 again for the probe)
  await must(F.mgrX.c, "update_care_plan_fields", { _care_plan_id: p2, _header: { expiration_date: await dbDay(25) }, _field_values: null });
  const a = await insertShift(F, F.mgrX.c, 26), d = await insertShift(F, F.mgrX.c, 16), ok = await insertShift(F, F.mgrX.c, 10), ok2 = await insertShift(F, F.mgrX.c, 15);
  const resp = await insertShift(F, F.mgrX.c, 20, { code: "RESP0001" });
  let move = null; if (ok.id) { const r = await F.mgrX.c.from("shifts").update({ shift_date: await dbDay(30) }).eq("id", ok.id).select("id"); move = r.error && r.error.message; }
  rec("S1 the same inserts are now REFUSED with clear messages ('IPOS v2 expires on …', 'No authorization for CLS after …'); inside the dates fine; respite with no respite authorization: today's behaviour; moving a visit past the limit refused",
    pass(/^IPOS v2 expires on \w{3} \d{1,2}, \d{4}/.test(a.err || "") && /^No authorization for CLS after \w{3} \d{1,2}, \d{4}$/.test(d.err || "") && !ok.err && !ok2.err && !resp.err && /IPOS v2 expires|No authorization/.test(move || "")),
    `${(a.err || "ACCEPTED").slice(0, 50)} | ${d.err || "ACCEPTED"} | inside ${ok.err || "ok"} | respite ${resp.err || "ok"} | move ${(move || "ACCEPTED").slice(0, 40)}`);
  // a late visit that already exists (created before the limit, e.g. the date was corrected later): other updates still work
  const late = ok.id;
  const u1 = await F.mgrX.c.from("shifts").update({ start_time: "10:00", end_time: "11:00", duration_hours: 1 }).eq("id", late).select("id");
  await must(F.mgrX.c, "update_care_plan_fields", { _care_plan_id: p2, _header: { expiration_date: await dbDay(5) }, _field_values: null });
  const u2 = await F.mgrX.c.from("shifts").update({ special_instructions: "ZZ note" }).eq("id", late).select("id");
  const asg = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: late, _caregiver_id: F.G, _method: "manual", _notes: "s17", _override_reason: "s17 fixture (disposable)" });
  const noPlan = await insertShift(F, F.mgrY.c, 400, { client: F.CY, office: F.OY });
  rec("S2 nothing else on that path changes: updating times / notes of an existing visit now past the limit and assigning it work; a client with no IPOS (office Y) is unaffected",
    pass(!u1.error && !u2.error && !noPlan.err && (!asg.err || !/IPOS|authorization for/.test(asg.err))), `${u1.error ? u1.error.message : "ok"} | ${u2.error ? u2.error.message : "ok"} | assign ${asg.err ? asg.err.slice(0, 50) : "ok"} | no IPOS ${noPlan.err || "ok"}`);
  const lim = (await rpc(F.schX.c, "get_shift_creation_limits", { _client_id: F.CX })).v;
  const limAnon = await rpc(anon, "get_shift_creation_limits", { _client_id: F.CX });
  const w = (await rpc(F.mgrX.c, "list_ipos_expiry", { _office_id: F.OX, _client_id: F.CX })).v || [];
  const wHr = await rpc(F.hrX.c, "list_ipos_expiry", { _office_id: F.OX, _client_id: null });
  rec("S3 get_shift_creation_limits (scheduler: IPOS v2 + CLS until +15; anon refused); list_ipos_expiry: v2 expires in 5 days → red, with the visits dated after it; HR refused",
    pass(lim && lim.ipos.version === 2 && lim.services.some((s) => s.service_type === "cls" && s.authorized_until === null || s.authorized_until) && limAnon.err
      && w.length === 1 && w[0].band === "red" && w[0].days_left === 5 && Number(w[0].shifts_after_count) >= 1 && DENY.test(wHr.err || "")),
    `${JSON.stringify(lim).slice(0, 120)}; ${w[0] ? `${w[0].band} ${w[0].days_left}d after ${w[0].shifts_after_count}` : "none"}`);
}

(async () => {
  log(`=== S17 IPOS versions — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL === "before") await before(F); else await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) {
      for (const c of [F.CX, F.CY].filter(Boolean)) {
        for (const t of ["care_plans", "service_authorizations", "plan_inservice_forms", "plan_training_forms"]) for (const { id } of (await admin.from(t).select("id").eq("client_id", c)).data || []) await admin.from("events").delete().eq("subject_id", id);
        for (const t of ["care_plan_revisions", "plan_training_records", "plan_training_forms", "plan_inservice_forms", "client_documents", "service_authorizations"]) await admin.from(t).delete().eq("client_id", c);
        await admin.from("care_plans").update({ status: "superseded" }).eq("client_id", c).eq("status", "pending");
        await admin.from("care_plans").delete().eq("client_id", c);
      }
      for (const t of F.newCredTypes || []) { await admin.from("caregiver_certifications").delete().eq("credential_type_id", t); await admin.from("credential_types").delete().eq("id", t); }
      await teardownB2(F);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.care_plans WHERE client_id = ANY($1::uuid[]))::int plans,
        (SELECT count(*) FROM public.shifts WHERE client_id = ANY($1::uuid[]))::int shifts, (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($2::uuid[]))::int ev`,
        [[F.CX, F.CY, F.CZ].filter(Boolean), [F.OX, F.OY, F.OZ]])).rows[0]);
      log(`s17 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();

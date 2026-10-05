// UI S6 follow-ups (clients.case_number, training full names) + S7 caregiver reads on DEV through real
// logins (mirrors pglite/ui-s7.cjs): case-number CHECK, client self-update guard, training reads,
// get_caregiver_clock, list_my_notes_due, late-arrival units, returned reason, refusals, ACLs, NB1.
// Usage: node tests/ripple/dev/ui-s7.cjs <before|after>
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, dbNow, teardownB1, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const NEW_FNS = ["get_caregiver_clock", "list_my_notes_due"];
const DEV_BEFORE = { get_client_training_context: "787ab4c8d0b9f3541e3ede7a052bd667", list_client_training_status: "311cd150fa77ed11c12e363e75c7dbf5" };
const ITEM_KEYS = "client_first_name,client_last_initial,due_at,end_time,note_status,overdue,returned_reason,scheduled_end,scheduled_start,service_type,shift_date,shift_id,start_time";

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`,
    [[...NEW_FNS, ...Object.keys(DEV_BEFORE)]])).rows);
  rec("ACL new + changed reads SECURITY DEFINER + authenticated, no PUBLIC/anon, one overload each", pass(acl.length === 4 && acl.every((f) => f.d && /authenticated=X/.test(f.acl) && !/(^|[{,])=X|anon=X/.test(f.acl))), acl.map((f) => `${f.proname} ${f.acl}`).join(" | "));
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  // ---------- case number ----------
  const upd = async (c, patch) => { const { data, error } = await c.from("clients").update(patch).eq("id", F.CX).select("id"); return error ? error.message : (data || []).length ? "ok" : "0 rows"; };
  const r = { pad: await upd(F.mgrX.c, { case_number: " ISK-1 " }), long: await upd(F.mgrX.c, { case_number: "X".repeat(33) }), ok: await upd(F.mgrX.c, { case_number: "ISK-00777" }),
    clCase: await upd(F.cl.c, { case_number: "HACKED" }), clPhone: await upd(F.cl.c, { phone: "555-0179" }) };
  const stored = (await admin.from("clients").select("case_number, phone").eq("id", F.CX).single()).data;
  rec("C1 manager sets case_number through the existing staff policy; untrimmed / 33 characters refused by the CHECK; the client can't change it (M-SEC-2 guard) but can change the phone",
    pass(/clients_case_number_chk/.test(r.pad) && /clients_case_number_chk/.test(r.long) && r.ok === "ok" && /Only your contact details/.test(r.clCase) && r.clPhone === "ok" && stored.case_number === "ISK-00777"),
    JSON.stringify(r) + ` stored ${stored.case_number}`);
  const plan = await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300) } });
  await must(F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: plan, _goals: [{ seq: 1, goal_text: "Goal one", objectives: [
    { seq: 1, letter: "A", objective_text: "Brush teeth", staff_instructions: "Model first", service_type: "cls", responsible_party: "this_agency" },
    { seq: 2, letter: "B", objective_text: "CM follow-up", responsible_party: "case_management" }] }] });
  const ctx = await must(F.hrX.c, "get_client_training_context", { _client_id: F.CX });
  const st = (await must(F.hrX.c, "list_client_training_status", { _office_id: F.OX })).find((x) => x.client_id === F.CX);
  rec("C2 hr_staff: training context carries the case number; the office status list carries the full name (and still the short one)",
    pass(ctx.case_number === "ISK-00777" && st && st.client_name === `ZZ CX ${RUN}` && st.client_short === "ZZ C."), `case ${ctx.case_number}; name "${st && st.client_name}" / "${st && st.client_short}"`);

  // ---------- S7 ----------
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 10 * 864e5).toISOString() }).eq("id", F.OX);
  // shifts.caregiver_id is derived from shift_assignments (trigger): assign through the real RPC (as B2 does)
  await ins("caregiver_skills", [{ caregiver_id: F.G, care_type_code: "RESP0001", is_demo: true }, { caregiver_id: F.GX2, care_type_code: "CLS0001", is_demo: true }]);
  const sh = async (d, start, end, code, cg, status = "assigned") => {
    const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: code,
      shift_date: await dbDay(d), start_time: start, end_time: end, duration_hours: 1, status: "open", is_demo: true });
    F.s7shifts = (F.s7shifts || []).concat(id);
    const a = await rpc(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: cg, _method: "manual", _notes: "S7 fixture", _override_reason: "S7 fixture (disposable)" });
    if (a.err) throw new Error(`assign fixture ${d} ${start}: ${a.err}`);
    if (status === "cancelled") await admin.from("shifts").update({ status: "cancelled" }).eq("id", id);
    return id; };
  const S = { a: await sh(-1, "09:00", "10:00", "CLS0001", F.G), b: await sh(-3, "09:00", "10:00", "CLS0001", F.G), future: await sh(2, "09:00", "10:00", "CLS0001", F.G),
    preGoLive: await sh(-20, "09:00", "10:00", "CLS0001", F.G), cancelled: await sh(-2, "09:00", "10:00", "CLS0001", F.G, "cancelled"),
    r: await sh(-1, "11:00", "12:00", "RESP0001", F.G), other: await sh(-1, "13:00", "14:00", "CLS0001", F.GX2) };
  const by = (l, s) => l.find((x) => x.shift_id === s);
  const l0 = await must(F.cg.c, "list_my_notes_due", {});
  const keysOk = l0.length > 0 && l0.every((x) => Object.keys(x).sort().join(",") === ITEM_KEYS);
  rec("N1 notes due: own started shifts after go-live only (not future, pre-go-live, cancelled, another caregiver's); exact keys; CLS / respite; overdue for 3 days ago only",
    pass(l0.length === 3 && by(l0, S.a) && by(l0, S.b) && by(l0, S.r) && keysOk && by(l0, S.r).service_type === "respite" && by(l0, S.b).overdue && !by(l0, S.a).overdue && by(l0, S.a).client_last_initial === "C"),
    `listed ${l0.map((x) => `${Object.keys(S).find((k) => S[k] === x.shift_id)}=${x.note_status}${x.overdue ? "(overdue)" : ""}`).join(", ")}; keys exact ${keysOk}`);
  const nA = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: S.a });
  F.notes = [nA];
  const nA2 = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: S.a });
  const n0 = (await admin.from("progress_notes").select("scheduled_start, units_scheduled").eq("id", nA).single()).data;
  await must(F.cg.c, "save_progress_note_draft", { _note_id: nA, _header: { client_arrived_at: new Date(Date.parse(n0.scheduled_start) + 301000).toISOString() }, _entries: [], _narrative_text: null });
  const n1 = (await admin.from("progress_notes").select("units_used, arrived_late").eq("id", nA).single()).data;
  const notesForShift = ((await admin.from("progress_notes").select("id").eq("shift_id", S.a)).data || []).length;
  await must(F.cg.c, "submit_progress_note", { _note_id: nA, _typed_signature: "ZZ Caregiver" });
  await must(F.mgrX.c, "return_progress_note", { _note_id: nA, _reason: "Please add the reinforcers" });
  const l1 = await must(F.cg.c, "list_my_notes_due", {});
  rec("N2 one note per shift; arrival +5:01 is late (units_used = scheduled - 1); after a return the list shows 'returned' with the reviewer's reason",
    pass(nA === nA2 && notesForShift === 1 && n1.arrived_late && n1.units_used === n0.units_scheduled - 1 && by(l1, S.a).note_status === "returned" && by(l1, S.a).returned_reason === "Please add the reinforcers"),
    `same id ${nA === nA2}; notes ${notesForShift}; units ${n0.units_scheduled} -> ${n1.units_used} (late ${n1.arrived_late}); a ${by(l1, S.a).note_status} "${by(l1, S.a).returned_reason}"`);
  const other = await rpc(F.cg.c, "create_progress_note_for_shift", { _shift_id: S.other });
  rec("N3 another caregiver's shift is refused generically", pass(DENY.test(other.err || "")), other.err || "ALLOWED");
  const c1 = await must(F.cg.c, "get_caregiver_clock", {});
  const isodow = await pgRead(async (c) => (await c.query("SELECT extract(isodow FROM $1::date)::int n", [c1.week_start])).rows[0].n);
  rec("N4 caregiver clock = DB today in the office time zone; week starts Monday (office default)", pass(c1.today === await dbDay(0) && isodow === 1 && c1.week_end > c1.week_start), JSON.stringify(c1).replace(/"first_name":"[^"]*",?/, ""));
  const dl = []; let dn = 0;
  for (const [label, c] of [["manager", F.mgrX.c], ["hr_staff", F.hrX.c], ["scheduler", F.schX.c], ["client", F.cl.c], ["anon", anon], ["agency admin", F.aaA.c], ["system_admin", F.sysA.c]])
    for (const fn of NEW_FNS) { const x = await rpc(c, fn, {}); dn++; if (!x.err || !DENY.test(x.err)) dl.push(`${label}->${fn}: ${x.err || "ALLOWED"}`); }
  rec("N5 both reads refused (generic) for users without a caregiver row", pass(dl.length === 0), dl.join("; ") || `${dn} refused`);
}

(async () => {
  log(`=== UI S6 follow-ups + S7 backend — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const s = await pgRead(async (c) => (await c.query(`SELECT
          (SELECT count(*)::int FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)) fns,
          (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='clients' AND column_name='case_number') col,
          (SELECT json_object_agg(proname, md5(prosrc)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($2)) h`, [NEW_FNS, Object.keys(DEV_BEFORE)])).rows[0]);
      rec("B0 before the push: the 2 new reads and clients.case_number are absent; the two S6 training reads match the hashes the rollback restores",
        pass(s.fns === 0 && s.col === 0 && Object.entries(DEV_BEFORE).every(([k, v]) => s.h[k] === v)), JSON.stringify(s));
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) {
      for (const n of F.notes || []) await admin.from("events").delete().eq("subject_id", n);
      await admin.from("progress_notes").delete().eq("client_id", F.CX);
      for (const s of F.s7shifts || []) { await admin.from("shift_assignments").delete().eq("shift_id", s); await admin.from("events").delete().eq("subject_id", s); await admin.from("shifts").delete().eq("id", s); }
      for (const t of ["plan_training_records", "plan_training_forms", "plan_inservice_forms", "care_plans"]) await admin.from(t).delete().eq("client_id", F.CX);
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.progress_notes WHERE client_id = $1)::int notes,
        (SELECT count(*) FROM public.shifts WHERE id = ANY($3::uuid[]))::int shifts,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($2::uuid[]))::int ev`, [F.CX, [F.OX, F.OY, F.OZ], F.s7shifts || []])).rows[0]);
      log(`S7 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();

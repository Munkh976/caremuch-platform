// Post-demo 1a + 1b on DEV through real logins (mirrors pglite/post-demo.cjs).
// `before`: get_progress_note_for_staff as stored now (md5, identity arguments, ACL) and no add_training_attendees.
// `after`: same identity arguments and ACL with the new body; aclexplode for both; the history shows review -> review
// undone -> review; add_training_attendees adds to a session of the current version (session date + trainer, own
// signature date, audit) and refuses duplicates, a superseded version, other offices / agencies / roles and anon; NB1.
// Usage: node tests/ripple/dev/post-demo.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, dbNow, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts } = require("./lib.cjs");
const READER_BEFORE = "460b892b716df06cd8e1190ab84ad80e";   // md5(prosrc) on DEV before the push (Oct 21)
const fns = () => pgRead(async (c) => (await c.query(`SELECT p.proname n, pg_get_function_identity_arguments(p.oid) a, md5(p.prosrc) h, p.prosecdef d,
    (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY 1) FROM aclexplode(p.proacl) x) acl
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('get_progress_note_for_staff', 'add_training_attendees') ORDER BY 1`)).rows);

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const f = await fns(); const rd = f.find((x) => x.n === "get_progress_note_for_staff"), at = f.find((x) => x.n === "add_training_attendees");
  rec("ACL get_progress_note_for_staff: same identity arguments '_note_id uuid', new body, SECURITY DEFINER, authenticated only; add_training_attendees '_training_form_id uuid, _records jsonb', authenticated only (aclexplode: no PUBLIC / anon)",
    pass(rd && rd.a === "_note_id uuid" && rd.h !== READER_BEFORE && rd.d && at && at.a === "_training_form_id uuid, _records jsonb" && at.d
      && f.every((x) => /authenticated:EXECUTE/.test(x.acl) && !/(^|,)(-|anon|public):/i.test(x.acl))), f.map((x) => `${x.n}(${x.a}) ${x.acl}`).join(" | "));

  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 20 * 864e5).toISOString() }).eq("id", F.OX);
  const plan = await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300) } });
  await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-PD-${RUN}`, _units_authorized: 40, _effective_date: await dbDay(-30), _expiration_date: await dbDay(60) });
  // 1a: history through the reader
  const sid = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(-2), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
  F.b2shifts = [sid];
  await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: sid, _caregiver_id: F.G, _method: "manual", _notes: "post-demo fixture", _override_reason: "post-demo fixture (disposable)" });
  const n = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: sid }); F.notes = [n];
  const r = (await admin.from("progress_notes").select("scheduled_start, scheduled_end").eq("id", n).single()).data;
  await must(F.cg.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: r.scheduled_start, actual_end: r.scheduled_end }, _entries: [], _narrative_text: null });
  await must(F.cg.c, "submit_progress_note", { _note_id: n, _typed_signature: "ZZ Caregiver" });
  await must(F.mgrX.c, "review_progress_note", { _note_id: n, _billable: true, _non_billable_reason: null });
  await must(F.mgrX.c, "undo_progress_note_review", { _note_id: n });
  await must(F.aaA.c, "review_progress_note", { _note_id: n, _billable: true, _non_billable_reason: null });
  const h = (await must(F.mgrX.c, "get_progress_note_for_staff", { _note_id: n })).history;
  rec("H1 the staff history shows created, submitted, reviewed, review undone, reviewed, each with who and when",
    pass(h.map((x) => x.event.replace("progress_note_", "")).join(",") === "created,submitted,reviewed,review_undone,reviewed" && h.every((x) => x.at && x.by)), h.map((x) => x.event.replace("progress_note_", "")).join(","));

  // 1b: sessions
  F.GX3 = await ins("caregivers", { agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `GX3 ${RUN}`, email: `sec-gx3-${RUN}@caremuch-sectest.test`, phone: "555-0175", is_demo: true });
  await must(F.hrX.c, "record_inservice_form", { _care_plan_id: plan, _case_manager_name: "ZZ CM", _program_lead_id: F.mgrX.id, _trained_on: await dbDay(-5), _signed_at: new Date(Date.parse(await dbNow()) - 864e5).toISOString(), _field_values: {} });
  const S1 = await must(F.hrX.c, "record_training_form", { _care_plan_id: plan, _plan_document_type: "ipos_initial", _plan_effective_date: null, _location: null,
    _records: [{ caregiver_id: F.G, training_date: await dbDay(-4), trainer_name: "ZZ Trainer", signed_date: await dbDay(-4) }], _field_values: {} });
  F.forms = [S1];
  const add = await rpc(F.mgrX.c, "add_training_attendees", { _training_form_id: S1, _records: [{ caregiver_id: F.GX2, signed_date: await dbDay(-1) }] });
  const r2 = (await admin.from("plan_training_records").select("training_date, trainer_name, signed_date, training_version").eq("training_form_id", S1).eq("caregiver_id", F.GX2).single()).data;
  const ev = ((await admin.from("events").select("payload").eq("event_type", "training_recorded").eq("subject_id", S1)).data || []).map((e) => e.payload);
  rec("A1 manager adds a caregiver to the existing session: the session's date and trainer, their own signature date; audit training_recorded with added: true (ids and counts only)",
    pass(!add.err && add.v === 1 && r2.training_date === await dbDay(-4) && r2.trainer_name === "ZZ Trainer" && r2.signed_date === await dbDay(-1) && ev.some((p) => p.added === true && p.records === 1)
      && !/ZZ/.test(JSON.stringify(ev))), `${add.err || add.v}; ${JSON.stringify(r2)}`);
  const dup = await rpc(F.hrX.c, "add_training_attendees", { _training_form_id: S1, _records: [{ caregiver_id: F.GX2 }] });
  const cross = await rpc(F.mgrX.c, "add_training_attendees", { _training_form_id: S1, _records: [{ caregiver_id: F.GY }] });
  const refused = [];
  for (const [who, c] of [["mgrY", F.mgrY.c], ["aaB", F.aaB.c], ["schX", F.schX.c], ["cg", F.cg.c], ["cl", F.cl.c], ["anon", anon]]) {
    const x = await rpc(c, "add_training_attendees", { _training_form_id: S1, _records: [{ caregiver_id: F.GX3 }] });
    if (x.err && DENY.test(x.err)) refused.push(who); else log(`  not refused: ${who} ${x.err || JSON.stringify(x.v)}`);
  }
  await must(F.mgrX.c, "renew_care_plan", { _care_plan_id: plan });
  const old = await rpc(F.mgrX.c, "add_training_attendees", { _training_form_id: S1, _records: [{ caregiver_id: F.GX3 }] });
  rec("A2 refused: a caregiver already in the session (reason), a caregiver of another office (generic), 6 other callers (generic), a session of a superseded version after a renewal (reason)",
    pass(/already in this session/.test(dup.err || "") && DENY.test(cross.err || "") && refused.length === 6 && /earlier plan version/.test(old.err || "")),
    `dup ${dup.err}; cross ${cross.err}; ${refused.length}/6; old ${old.err}`);
}

(async () => {
  log(`=== Post-demo 1a + 1b — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const f = await fns(); const rd = f.find((x) => x.n === "get_progress_note_for_staff");
      rec("B0 before: get_progress_note_for_staff as stored (md5, '_note_id uuid', authenticated only); no add_training_attendees",
        pass(rd && rd.h === READER_BEFORE && rd.a === "_note_id uuid" && /authenticated:EXECUTE/.test(rd.acl) && !f.some((x) => x.n === "add_training_attendees")), f.map((x) => `${x.n} ${x.h} ${x.acl}`).join(" | "));
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) {
      for (const id of [...(F.notes || []), ...(F.forms || [])]) await admin.from("events").delete().eq("subject_id", id);
      for (const c of [F.CX].filter(Boolean)) {
        for (const t of ["care_plans", "service_authorizations", "plan_inservice_forms"]) for (const { id } of (await admin.from(t).select("id").eq("client_id", c)).data || []) await admin.from("events").delete().eq("subject_id", id);
        for (const t of ["plan_training_records", "plan_training_forms", "plan_inservice_forms", "client_documents", "service_authorizations", "care_plans"]) await admin.from(t).delete().eq("client_id", c);
      }
      if (F.GX3) { await admin.from("caregivers").delete().eq("id", F.GX3); }
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
      await teardownB2(F);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($1::uuid[]))::int ev,
        (SELECT count(*) FROM public.plan_training_records WHERE client_id = ANY($2::uuid[]))::int rec, (SELECT count(*) FROM public.care_plans WHERE client_id = ANY($2::uuid[]))::int plans,
        (SELECT count(*) FROM public.virtual_office WHERE id = ANY($1::uuid[]))::int offices`, [[F.OX, F.OY, F.OZ], [F.CX, F.CY, F.CZ].filter(Boolean)])).rows[0]);
      log(`post-demo teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();

// S18 follow-up (20261031150000) on DEV through real logins: get_progress_note_for_caregiver returns note.units_rule.
// `before` (RIPPLE_WRITE_NOBREAK_BASELINE=1): the body is the one the rollback restores (md5); NB1 baseline.
// `after` (RIPPLE_NB1_HASHES=1): one overload, SECURITY DEFINER, aclexplode authenticated only; the caregiver's draft shows
//   the office rule (grace 7 after the agency admin sets it), the submitted note keeps its stored rule; NB1 identical.
// Usage: node tests/ripple/dev/caregiver-units-rule.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew } = require("./lib.cjs");
const BEFORE = "2c445b7e0a5e1be7ae03026219f630a0";
const meta = () => pgRead(async (c) => (await c.query(`SELECT md5(pg_get_functiondef(p.oid)) h, p.prosecdef d, (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text) FROM aclexplode(p.proacl) x) acl
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_progress_note_for_caregiver'`)).rows);

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const m = await meta();
  rec("ACL (aclexplode): one overload, SECURITY DEFINER, authenticated only; new body",
    pass(m.length === 1 && m[0].d && /authenticated:EXECUTE/.test(m[0].acl) && !/(^|,)(-|anon):/.test(m[0].acl) && m[0].h !== BEFORE), `${m[0].acl}; md5 ${m[0].h.slice(0, 8)}`);
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300) } });
  const mk = async (k) => { const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: "CLS0001", shift_date: await dbDay(-1 - k), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: "rule fixture", _override_reason: "rule fixture (disposable)" });
    const n = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: id }); (F.notes = F.notes || []).push(n);
    const r = (await admin.from("progress_notes").select("scheduled_start, scheduled_end").eq("id", n).single()).data;
    await must(F.cg.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: r.scheduled_start, actual_end: r.scheduled_end }, _entries: [], _narrative_text: null });
    return n; };
  const draft = await mk(0), sub = await mk(1);
  await must(F.cg.c, "submit_progress_note", { _note_id: sub, _typed_signature: "ZZ Caregiver" });
  const v0 = (await must(F.cg.c, "get_progress_note_for_caregiver", { _note_id: draft })).note.units_rule;
  await must(F.aaA.c, "set_office_units_rule", { _office_id: F.OX, _rule: "grace", _grace_minutes: 7, _minutes: 15 });
  const v1 = (await must(F.cg.c, "get_progress_note_for_caregiver", { _note_id: draft })).note.units_rule;
  const s1 = (await must(F.cg.c, "get_progress_note_for_caregiver", { _note_id: sub })).note.units_rule;
  rec("P1 the caregiver's draft shows the office rule (full_blocks, then grace / 7 after the agency admin sets it); the submitted note keeps full_blocks / 0",
    pass(v0.rule === "full_blocks" && v1.rule === "grace" && v1.grace_minutes === 7 && s1.rule === "full_blocks" && s1.grace_minutes === 0), JSON.stringify([v0, v1, s1]));
}

(async () => {
  log(`=== Caregiver units rule — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") { const m = await meta(); rec("B0 before: the body is the one the rollback restores (md5)", pass(m.length === 1 && m[0].h === BEFORE), m.map((x) => x.h).join(",")); }
    F = await setup(); await setupB1(F);
    F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F) {
      for (const n of F.notes || []) await admin.from("events").delete().eq("subject_id", n);
      await admin.from("events").delete().eq("subject_id", F.OX);
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
      await teardownB2(F);
      await admin.from("care_plans").delete().eq("client_id", F.CX);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.progress_notes WHERE id = ANY($1::uuid[]))::int notes,
        (SELECT count(*) FROM public.shifts WHERE id = ANY($2::uuid[]))::int shifts, (SELECT count(*) FROM public.events WHERE subject_id = $3)::int ev`, [F.notes || [], F.b2shifts || [], F.OX])).rows[0]);
      log(`teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();

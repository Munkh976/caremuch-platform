// Late arrival, no grace period (20261020120000) on DEV through real logins: CLS and respite notes with arrivals
// at 09:00, 09:00:59, 09:01, 09:05 and 09:06 (DB-clock days), units read back after submit. `before` expects the
// old rule (late only after +5:00) and checks the function body is the one the rollback restores; `after`
// expects the new rule (any minute late loses the first unit) and an unchanged signature / ACL. NB1.
// Usage: node tests/ripple/dev/late-arrival.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew } = require("./lib.cjs");
const BEFORE_MD5 = "3982e57fcaac368e38dd480ab2a06d10";
const CASES = [["09:00", 0], ["09:00:59", 59], ["09:01", 60], ["09:05", 300], ["09:06", 360]];

async function run(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const meta = await pgRead(async (c) => (await c.query(`SELECT p.oid::regprocedure::text sig, p.prosecdef d, COALESCE(p.proacl::text,'') acl, md5(prosrc) h FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname='cp_derive_progress_note_units'`)).rows);
  const m = meta[0];
  rec(LABEL === "before" ? "F0 before: the units trigger function is the body the rollback restores (md5)" : "F0 after: one function, same signature, SECURITY INVOKER, no API role; new body",
    pass(meta.length === 1 && m.sig === "cp_derive_progress_note_units()" && !m.d && !/authenticated=|anon=|(^|[{,])=X/.test(m.acl) && (LABEL === "before" ? m.h === BEFORE_MD5 : m.h !== BEFORE_MD5)),
    `${m.sig} ${m.acl} md5 ${m.h}`);
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300) } });
  await ins("caregiver_skills", [{ caregiver_id: F.G, care_type_code: "RESP0001", is_demo: true }]);
  const out = [];
  for (const [i, [label, off]] of CASES.entries()) for (const [code, start] of [["CLS0001", "09:00"], ["RESP0001", "11:00"]]) {
    const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: code, shift_date: await dbDay(-1 - i), start_time: start, end_time: code === "CLS0001" ? "10:00" : "12:00", duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: "late fixture", _override_reason: "late fixture (disposable)" });
    const n = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: id });
    const st = (await admin.from("progress_notes").select("scheduled_start").eq("id", n).single()).data.scheduled_start;
    await must(F.cg.c, "save_progress_note_draft", { _note_id: n, _header: { client_arrived_at: new Date(Date.parse(st) + off * 1000).toISOString(), actual_end: (await admin.from("progress_notes").select("scheduled_end").eq("id", n).single()).data.scheduled_end }, _entries: [], _narrative_text: code === "RESP0001" ? "We went to the park." : null });
    await must(F.cg.c, "submit_progress_note", { _note_id: n, _typed_signature: "ZZ Caregiver" });
    const r = (await admin.from("progress_notes").select("units_scheduled, units_used, arrived_late").eq("id", n).single()).data;
    out.push({ label, kind: code === "CLS0001" ? "CLS" : "respite", used: Number(r.units_used), sched: Number(r.units_scheduled), late: r.arrived_late });
  }
  const expectLate = (label) => LABEL === "before" ? label === "09:06" : !["09:00", "09:00:59"].includes(label);
  const bad = out.filter((o) => o.late !== expectLate(o.label) || o.used !== o.sched - (o.late ? 1 : 0));
  rec(LABEL === "before" ? "L1 before (old rule): only 09:06 is late; 09:00 / 09:00:59 / 09:01 / 09:05 bill in full (CLS and respite)"
      : "L1 after (no grace period): 09:00 and 09:00:59 bill in full; 09:01, 09:05, 09:06 lose the first unit (CLS and respite)",
    pass(bad.length === 0 && out.length === 10), out.map((o) => `${o.kind} ${o.label} ${o.sched}->${o.used}${o.late ? " late" : ""}`).join("; "));
}

(async () => {
  log(`=== Late arrival (no grace period) — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F; const ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  try { F = await setup(); await setupB1(F); await checkNoBreak(F); await run(F); }
  catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) {
      for (const { id } of (await admin.from("progress_notes").select("id").eq("client_id", F.CX)).data || []) await admin.from("events").delete().eq("subject_id", id);
      await teardownB2(F);
      await admin.from("care_plans").delete().eq("client_id", F.CX);
      for (const { id } of (await admin.from("credential_types").select("id").eq("agency_id", A)).data || []) if (!ctBefore.has(id)) await admin.from("credential_types").delete().eq("id", id);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.progress_notes WHERE client_id = $1)::int notes,
        (SELECT count(*) FROM public.shifts WHERE id = ANY($2::uuid[]))::int shifts`, [F.CX, F.b2shifts || []])).rows[0]);
      log(`late teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();

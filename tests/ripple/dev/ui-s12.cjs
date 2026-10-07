// S12 on DEV through real logins (mirrors pglite/ui-s12.cjs): every units case Ripple listed for a 9:00–10:00 visit (full
// 15-minute blocks inside [arrival, end], late AND early), respite, the end-time requirement at submit, the billing week's
// units not billed; signatures / ACLs unchanged; NB1. `before` also prints how many unbilled submitted / reviewed notes on
// DEV would differ under the new rule (count only).
// Usage: node tests/ripple/dev/ui-s12.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, dbDay, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew } = require("./lib.cjs");
const FNS = ["cp_derive_progress_note_units", "get_billing_week", "get_billing_batch"];
const BEFORE = { cp_derive_progress_note_units: "e12266dfee9e132959f78d24e1a272da", get_billing_week: "d0997a1bd589352fa23ea3729f2a5952", get_billing_batch: "d173ba584832f9a951ede264a819c96d" };
const md5s = () => pgRead(async (c) => Object.fromEntries((await c.query(`SELECT proname, md5(prosrc) h FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [FNS])).rows.map((r) => [r.proname, r.h])));
const acls = () => pgRead(async (c) => (await c.query(`SELECT string_agg(p.oid::regprocedure::text || ' ' || COALESCE(p.proacl::text,''), ' | ' ORDER BY 1) s FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1)`, [FNS])).rows[0].s);
const ACLS = "cp_derive_progress_note_units() {postgres=X/postgres,service_role=X/postgres} | get_billing_batch(uuid) {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | get_billing_week(uuid,date) {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}";

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const m = await md5s(); const a = await acls();
  rec("F0 the three functions are the S12 bodies (md5 changed from before); signatures and ACLs unchanged", pass(FNS.every((f) => m[f] && m[f] !== BEFORE[f])),
    `${FNS.map((f) => `${f} ${BEFORE[f].slice(0, 8)}→${(m[f] || "").slice(0, 8)}`).join("; ")}; acl ${a === ACLS ? "same" : a}`);
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.now() - 40 * 864e5).toISOString() }).eq("id", F.OX);
  await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-40), expiration_date: await dbDay(300) } });
  await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "cls", _auth_number: `ZZ-S12-${RUN}`, _units_authorized: 400, _effective_date: await dbDay(-40), _expiration_date: await dbDay(90) });
  await must(F.mgrX.c, "create_service_authorization", { _client_id: F.CX, _service_type: "respite", _auth_number: `ZZ-S12R-${RUN}`, _units_authorized: 400, _effective_date: await dbDay(-40), _expiration_date: await dbDay(90) });
  await ins("caregiver_skills", [{ caregiver_id: F.G, care_type_code: "RESP0001", is_demo: true }]);
  const at = (d, hhmm) => pgRead(async (c) => (await c.query(`SELECT (($1::date + $2::time) AT TIME ZONE 'America/New_York') t`, [d, hhmm])).rows[0].t.toISOString());
  const shift = async (k, code = "CLS0001") => {
    const id = await ins("shifts", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, order_title: `ZZ ${RUN}`, care_type_code: code, shift_date: await dbDay(k), start_time: "09:00", end_time: "10:00", duration_hours: 1, status: "open", is_demo: true });
    F.b2shifts = (F.b2shifts || []).concat(id);
    await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: id, _caregiver_id: F.G, _method: "manual", _notes: "S12 test", _override_reason: "S12 test override" }); return id; };
  const note = async (s, arr, end, { submit = true, narrative = null } = {}) => {
    const n = await must(F.cg.c, "create_progress_note_for_shift", { _shift_id: s });
    const d = (await admin.from("progress_notes").select("service_date").eq("id", n).single()).data.service_date;
    const h = { client_arrived_at: await at(d, arr) }; if (end) h.actual_end = await at(d, end);
    await must(F.cg.c, "save_progress_note_draft", { _note_id: n, _header: h, _entries: [], _narrative_text: narrative });
    if (submit) await must(F.cg.c, "submit_progress_note", { _note_id: n, _typed_signature: "ZZ Caregiver" }); return n; };
  const units = async (n) => Number((await admin.from("progress_notes").select("units_used").eq("id", n).single()).data.units_used);
  const CASES = [["09:00", "10:00", 4], ["09:01", "10:00", 3], ["09:15", "10:00", 3], ["09:20", "10:00", 2], ["09:35", "10:00", 1], ["09:50", "10:00", 0],
    ["09:00", "09:50", 3], ["09:00", "09:44", 2], ["09:20", "09:50", 1]];
  const got = [];
  for (const [i, [a2, e, want]] of CASES.entries()) { const n = await note(await shift(-12 + i), a2, e); got.push([`${a2}-${e}`, await units(n), want]); }
  rec("A1 a 9:00–10:00 visit through the caregiver's real login: 09:00–10:00 → 4, 09:01 → 3, 09:15 → 3, 09:20 → 2, 09:35 → 1, 09:50 → 0, 09:00–09:50 → 3, 09:00–09:44 → 2, 09:20–09:50 → 1",
    pass(got.every(([, u, w]) => u === w)), got.map(([k, u, w]) => `${k}=${u}${u === w ? "" : `(want ${w})`}`).join(", "));
  const r = await note(await shift(-2, "RESP0001"), "09:20", "09:50", { narrative: "Board games and a walk." });
  rec("A2 respite: the same rule (09:20–09:50 → 1)", pass((await units(r)) === 1), `${await units(r)}`);
  // a note row without scheduled times (direct insert, like round3's fixture) keeps the earlier rule (fix 20261025120100)
  const authId = (await admin.from("service_authorizations").select("id").eq("client_id", F.CX).eq("service_type", "cls").limit(1).single()).data.id;
  const raw = await ins("progress_notes", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, caregiver_id: F.G, authorization_id: authId, note_kind: "cls", service_type: "cls",
    service_date: await dbDay(-30), units_scheduled: 12, billable: true, status: "reviewed" });
  rec("A4 a note row without scheduled times keeps the earlier rule (12 scheduled -> 12, not 0)", pass((await units(raw)) === 12), `${await units(raw)}`);
  const ne = await note(await shift(-1), "09:00", null, { submit: false });
  const ref = await rpc(F.cg.c, "submit_progress_note", { _note_id: ne, _typed_signature: "ZZ Caregiver" });
  rec("E1 no end time: submit refused with 'Enter the client's end time before submitting the note'; still a draft",
    pass(!!ref.err && /end time before submitting/.test(ref.err) && (await admin.from("progress_notes").select("status").eq("id", ne).single()).data.status === "draft"), ref.err);
}

(async () => {
  log(`=== UI S12 units (full 15-minute blocks) — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const m = await md5s(); const a = await acls();
      rec("B0 before S12: the three bodies the rollback restores (md5) and their ACLs", pass(FNS.every((f) => m[f] === BEFORE[f]) && a === ACLS), JSON.stringify(m));
      const n = await pgRead(async (c) => (await c.query(`WITH x AS (SELECT n.units_used, CASE WHEN NOT n.billable OR n.units_scheduled IS NULL THEN 0 ELSE LEAST(GREATEST(
          floor(extract(epoch FROM (LEAST(COALESCE(date_trunc('minute', n.actual_end), n.scheduled_end), n.scheduled_end) - n.scheduled_start)) / 900)
        - ceil(extract(epoch FROM (GREATEST(COALESCE(date_trunc('minute', n.client_arrived_at), n.scheduled_start), n.scheduled_start) - n.scheduled_start)) / 900), 0), n.units_scheduled) END u
        FROM public.progress_notes n WHERE n.status IN ('submitted','reviewed') AND n.voided IS NOT TRUE) SELECT count(*)::int t, count(*) FILTER (WHERE u <> units_used)::int d FROM x`)).rows[0]);
      rec("C0 unbilled submitted / reviewed notes on DEV that would differ under the new rule (count only; they keep their stored units)", "INFO", `${n.d} of ${n.t}`);
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) {
      for (const { id } of (await admin.from("progress_notes").select("id").eq("client_id", F.CX)).data || []) await admin.from("events").delete().eq("subject_id", id);
      await teardownB2(F);
      await admin.from("care_plans").delete().eq("client_id", F.CX);
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
    }
    await teardownB1(F); await teardown(F);
    await closeDb();
  }
  summary();
})();

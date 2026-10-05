// UI S4 backend on DEV: units table + projection, G2 risk, W2 correct_service_authorization,
// set_care_plan_rows, role denials, ACLs, NB1 (mirrors pglite/ui-s4.cjs through real logins).
// Usage: node tests/ripple/dev/ui-s4.cjs <before|after>
//   before: the 6 new functions are absent; NB1
//   after : behaviour + denials + ACLs; NB1
// DEV run: disposable fixtures, verified teardown (additive slice push rule, owner Oct 5).
const { A, REF, LABEL, RUN, admin, log, rec, pass, ins, rpc, pgRead, setup, setupB1, checkNoBreak, DENY, dbDay, teardownB1, teardown, closeDb, summary, reportSkew, createClient, URL_, ANON, opts, ids } = require("./lib.cjs");

const NEW_FNS = ["cp_authorization_projection", "get_client_authorizations", "list_authorization_risk", "correct_service_authorization", "cp_plan_row_spec", "set_care_plan_rows"];

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [NEW_FNS])).rows);
  const bad = acl.filter((f) => /(^|[{,])=X|anon=X/.test(f.acl) || (f.proname.startsWith("cp_") ? /authenticated=X/.test(f.acl) : !(f.d && /authenticated=X/.test(f.acl))));
  rec("ACL 4 RPCs SECURITY DEFINER + authenticated (no PUBLIC/anon); the 2 helpers have no API role", pass(acl.length === 6 && bad.length === 0), `${acl.length}/6; offending ${bad.map((f) => f.proname).join(", ") || "none"}`);
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OY });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  const auth = async (client, num, units, eff, exp, opening = 0, per = null, cap = null) => { const id = await must(F.mgrX.c, "create_service_authorization", {
    _client_id: client, _service_type: "cls", _auth_number: `${num}-${RUN}`, _units_authorized: units, _effective_date: eff, _expiration_date: exp,
    _period_type: per, _units_per_period: cap, _units_used_before_caremuch: opening }); return id; };

  // ---------- units table + projection ----------
  const a1 = await auth(F.CX, "ZZ-A1", 40, await dbDay(-30), "2026-11-04", 10);
  const a2 = await auth(F.CX, "ZZ-A2", 100, await dbDay(-30), await dbDay(200));
  // shifts 0-2 (Nov 2-4) were assigned to G by the NB1 step; assign shift 4 (Nov 6) through the real RPC
  await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: F.shifts[4], _caregiver_id: F.G, _method: "manual", _notes: "S4 test", _override_reason: "S4 test (disposable fixture)" });
  const tab = (await must(F.mgrX.c, "get_client_authorizations", { _client_id: F.CX })).authorizations;
  const r1 = tab.find((x) => x.id === a1), r2 = tab.find((x) => x.id === a2);
  rec("P1 units table: opening balance counts as used; assigned shifts on/before A1's expiry are pending on A1 (3 x 4), the later one on A2",
    pass(r1 && r1.units_used === 10 && r1.units_pending === 12 && r1.units_left === 18 && r2.units_pending === 4 && r2.units_left === 96),
    r1 ? `A1 used ${r1.units_used} pending ${r1.units_pending} left ${r1.units_left}; A2 pending ${r2.units_pending} left ${r2.units_left}` : "missing");
  const sch = await rpc(F.schX.c, "get_client_authorizations", { _client_id: F.CX });
  rec("P2 scheduler (authorization tier) can read the units table", pass(!sch.err), sch.err || "ok");

  // ---------- G2 ----------
  const CR = await ins("clients", { agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `Risk ${RUN}`, phone: "555-0175", address: "1 CP St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  F.extraClients = [CR];
  const ra = {}; for (const o of [61, 60, 30, 29, 0, -1]) ra[o] = await auth(CR, `ZZ-R${o}`, 20, await dbDay(-100), await dbDay(o));
  const risk = await must(F.mgrX.c, "list_authorization_risk", { _office_id: F.OX, _within_days: 60 });
  const band = (o) => (risk.find((x) => x.authorization_id === ra[o]) || {}).band;
  rec("G2 bands at 61/60/30/29/0/-1 days: not listed / yellow / red / red / red / not listed; units at risk = left (20, no shifts)",
    pass(band(61) === undefined && band(60) === "yellow" && band(30) === "red" && band(29) === "red" && band(0) === "red" && band(-1) === undefined
      && risk.find((x) => x.authorization_id === ra[60]).units_at_risk === 20), [61, 60, 30, 29, 0, -1].map((o) => `${o}=${band(o) || "-"}`).join(" "));

  // ---------- W2 ----------
  await ins("progress_notes", { agency_id: A, virtual_office_id: F.OX, client_id: F.CX, caregiver_id: F.G, authorization_id: a1, note_kind: "cls", service_type: "cls",
    service_date: await dbDay(-3), units_scheduled: 12, billable: true, status: "reviewed" });
  const cor = (c, changes, reason) => rpc(c, "correct_service_authorization", { _id: a1, _changes: changes, _reason: reason });
  const below = await cor(F.mgrX.c, { units_authorized: 21 }, "typo"), ok22 = await cor(F.mgrX.c, { units_authorized: 22 }, "corrected from the paper authorization");
  const dates = await cor(F.mgrX.c, { effective_date: await dbDay(-2) }, "dates");
  const capBad = await cor(F.mgrX.c, { period_type: "per_week", units_per_period: 8 }, "cap"), capOk = await cor(F.mgrX.c, { period_type: "per_week", units_per_period: 12 }, "cap letter");
  rec("W2 refusals: units below charged (12) + opening (10); dates leaving out a reviewed visit; a weekly cap below the week's charged units. Valid corrections accepted",
    pass(/can't go below/.test(below.err || "") && !ok22.err && /leave out a reviewed or billed visit/.test(dates.err || "") && /already charged exceed this cap/.test(capBad.err || "") && !capOk.err),
    [below, ok22, dates, capBad, capOk].map((x) => (x.err || "ok").slice(0, 45)).join(" | "));
  const ev = await pgRead(async (c) => (await c.query(`SELECT payload FROM public.events WHERE event_type = 'authorization_corrected' AND subject_id = $1 ORDER BY occurred_at`, [a1])).rows);
  rec("W2-audit two accepted corrections audited with changed fields + reason", pass(ev.length === 2 && ev[0].payload.reason === "corrected from the paper authorization"), ev.map((e) => JSON.stringify(e.payload.changed)).join(" "));
  const wl = []; let wn = 0;
  for (const [label, c] of [["scheduler", F.schX.c], ["hr_staff", F.hrX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]]) {
    const r = await rpc(c, "correct_service_authorization", { _id: a2, _changes: { units_authorized: 99 }, _reason: "x" }); wn++; if (!r.err || !DENY.test(r.err)) wl.push(`${label}: ${r.err || "ALLOWED"}`);
    for (const [fn, args] of [["list_authorization_risk", { _office_id: F.OX, _within_days: 60 }], ["get_client_authorizations", { _client_id: F.CX }]]) {
      if (label === "scheduler") continue;
      const x = await rpc(c, fn, args); wn++; if (!x.err || !DENY.test(x.err)) wl.push(`${label}->${fn}: ${x.err || "ALLOWED"}`); } }
  rec("W2-deny correction refused for 8 roles/scopes; both reads refused for hr_staff, caregiver, client, anon, office-Y manager, agency-B admin, system_admin", pass(wl.length === 0), wl.join("; ") || `${wn} refused`);

  // ---------- child rows ----------
  const plan = await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-30), expiration_date: await dbDay(300) } });
  F.planClients = [F.CX];
  await must(F.mgrX.c, "set_care_plan_rows", { _care_plan_id: plan, _entity: "care_plan_attendee", _rows: [{ name: "Ann", relationship: "Mother", attended: true }, { name: "Bo" }] });
  const att = (await admin.from("care_plan_attendees").select("id, name").eq("care_plan_id", plan).order("name")).data;
  await must(F.mgrX.c, "set_care_plan_rows", { _care_plan_id: plan, _entity: "care_plan_attendee", _rows: [{ id: att[0].id, name: "Ann B", attended: true }] });
  const att2 = (await admin.from("care_plan_attendees").select("id, name").eq("care_plan_id", plan)).data;
  const hr = await rpc(F.hrX.c, "set_care_plan_rows", { _care_plan_id: plan, _entity: "care_plan_attendee", _rows: [] });
  const my = await rpc(F.mgrY.c, "set_care_plan_rows", { _care_plan_id: plan, _entity: "care_plan_attendee", _rows: [] });
  rec("R child rows: added, updated by id, dropped when left out; hr_staff and office-Y manager refused",
    pass(att2.length === 1 && att2[0].id === att[0].id && att2[0].name === "Ann B" && DENY.test(hr.err || "") && DENY.test(my.err || "")), `${att2.map((a) => a.name)}; hr "${hr.err}"; Y "${my.err}"`);
}

(async () => {
  log(`=== UI S4 backend — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const n = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [NEW_FNS])).rows[0].n);
      rec("B0 the 6 new functions are absent before the push", pass(n === 0), `${n}/6 present`);
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) {
      for (const c of [F.CX, ...(F.extraClients || [])]) { await admin.from("progress_notes").delete().eq("client_id", c); await admin.from("care_plans").delete().eq("client_id", c);
        for (const { id } of (await admin.from("service_authorizations").select("id").eq("client_id", c)).data || []) await admin.from("events").delete().eq("subject_id", id);
        await admin.from("service_authorizations").delete().eq("client_id", c); }
      for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
    }
    await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.service_authorizations WHERE auth_number LIKE $1)::int auths,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($2::uuid[]))::int ev`, [`%${RUN}`, [F.OX, F.OY, F.OZ]])).rows[0]);
      log(`S4 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();

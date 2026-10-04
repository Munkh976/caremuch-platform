// S-OFF-1 (caller office scope) + note shells per service, on DEV.
// Usage: node tests/ripple/dev/soff.cjs <before|after>
//   before: the new objects are absent; the gap reproduces on disposable fixtures (office-Y manager
//           assigns / releases / computes earnings on office X; Edge Functions let it act on office X)
//   after : office-Y manager refused everywhere it should be; office-X and unrestricted managers and
//           caregiver self pick-up still work; NB1; note shells per service + fallback; ACLs
// DEV run: creates disposable fixtures on the linked project and deletes them (needs owner approval).
const { A, REF, LABEL, RUN, admin, ids, log, rec, pass, ins, reportSkew, pgRead, setup, checkNoBreak, DENY, setupB1, rpc,
  dbDay, teardownB1, teardown, closeDb, summary } = require("./lib.cjs");

const SOFF = ["assign_caregiver_to_shift", "release_shift_assignments", "compute_earnings_for_time_entry"];
async function catalog() {
  return pgRead(async (c) => ({
    resolver: (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='cp_resolve_note_template'`)).rows[0].n,
    col: (await c.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='form_templates' AND column_name='service_type'`)).rows[0].n,
    std: (await c.query(`SELECT p.pronargs n, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='save_template_draft'`)).rows,
    guards: (await c.query(`SELECT proname, position('is_office_restricted' in prosrc) > 0 g, COALESCE(proacl::text,'') acl FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1) ORDER BY 1`, [SOFF])).rows,
  }));
}

async function run(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const sh = async (office, client, off, start, end, code = "CLS0001") => { const id = await ins("shifts", { agency_id: A, virtual_office_id: office, client_id: client, order_title: `ZZ ${RUN}`,
    care_type_code: code, shift_date: await dbDay(off), start_time: start, end_time: end, duration_hours: 1, pay_rate: 20, status: "open", is_demo: true }); F.shifts.push(id); return id; };
  const ASSIGN = (c, s, g) => rpc(c, "assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: g, _method: "manual", _notes: "S-OFF", _override_reason: null });
  const RELEASE = (c, ss) => rpc(c, "release_shift_assignments", { _shift_ids: ss, _reason: "S-OFF test" });
  const active = async (s) => ((await admin.from("shift_assignments").select("id").eq("shift_id", s).neq("status", "cancelled")).data || []).length;
  const fn = async (c, name, body) => { const r = await c.functions.invoke(name, { body }); return { status: r.error ? (r.error.context && r.error.context.status) || "ERR" : 200, data: r.data, err: r.error }; };
  F.extraUsers = [];
  const cat = await catalog();
  if (LABEL === "before") {
    rec("B0 new objects absent; S-OFF functions have no office guard yet", pass(cat.resolver === 0 && cat.col === 0 && cat.std.length === 1 && cat.std[0].n === 9 && cat.guards.every((g) => !g.g)),
      `resolver ${cat.resolver}, service_type column ${cat.col}, save_template_draft args ${cat.std.map((x) => x.n)}, guards ${cat.guards.map((g) => `${g.proname}:${g.g}`).join(" ")}`);
  } else {
    const bad = cat.std.length !== 1 || cat.std[0].n !== 10 || !/authenticated=X/.test(cat.std[0].acl) || /(^|[{,])=X|anon=X/.test(cat.std[0].acl);
    rec("C0 S-OFF functions carry the guard and keep their ACLs (authenticated, no PUBLIC/anon); save_template_draft: one function, 10 args (rule 13); resolver + column present",
      pass(cat.guards.length === 3 && cat.guards.every((g) => g.g && /authenticated=X/.test(g.acl) && !/(^|[{,])=X|anon=X/.test(g.acl)) && !bad && cat.resolver === 1 && cat.col === 1),
      `${cat.guards.map((g) => `${g.proname} guard=${g.g} ${g.acl}`).join("; ")}; save_template_draft ${JSON.stringify(cat.std)}`);
  }
  // ---- database paths ----
  const s1 = await sh(F.OX, F.CX, 5, "07:00", "08:00"), s2 = await sh(F.OX, F.CX, 5, "09:00", "10:00");
  const yA = await ASSIGN(F.mgrY.c, s1, F.G);
  const xA = LABEL === "before" ? null : await ASSIGN(F.mgrX.c, s1, F.G);
  const aA = await ASSIGN(F.mgrAll.c, s2, F.G);
  const yR = await RELEASE(F.mgrY.c, [s2]); const keptAfterY = await active(s2);
  // a time entry on an office-X shift, approved by the office-X manager (real, RLS-scoped path)
  const s3 = await sh(F.OX, F.CX, -1, "13:00", "14:00"); await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: s3, _caregiver_id: F.G, _method: "manual", _notes: "S-OFF", _override_reason: null });
  const asg = (await admin.from("shift_assignments").select("id").eq("shift_id", s3).neq("status", "cancelled").single()).data.id;
  const yday = await dbDay(-1);
  const teId = await ins("time_entries", { agency_id: A, virtual_office_id: F.OX, shift_assignment_id: asg, shift_id: s3, caregiver_id: F.G,
    started_at: `${yday}T17:00:00Z`, ended_at: `${yday}T18:00:00Z`, hours_worked: 1, status: "submitted", source: "manual", is_demo: true });
  const { error: apErr } = await F.mgrX.c.from("time_entries").update({ status: "approved" }).eq("id", teId);
  const teSt = (await admin.from("time_entries").select("status").eq("id", teId).single()).data.status;
  const yE = await rpc(F.mgrY.c, "compute_earnings_for_time_entry", { _time_entry_id: teId, _recompute: false });
  if (LABEL === "before") {
    rec("B-GAP before S-OFF-1 (expected): an office-Y manager can assign, release and compute earnings on office X (disposable fixtures)",
      pass(!yA.err && !yR.err && yR.v === 1 && teSt === "approved" && !yE.err && yE.v && yE.v.ok === true),
      `assign ${yA.err || "ACCEPTED"}; release ${yR.err || yR.v + " row"}; time entry ${teSt}${apErr ? " (" + apErr.message + ")" : ""}; earnings ${yE.err || JSON.stringify(yE.v && yE.v.ok)}`);
  } else {
    const xR = await RELEASE(F.mgrX.c, [s1]); const aR = await RELEASE(F.mgrAll.c, [s2]);
    const xE = await rpc(F.mgrX.c, "compute_earnings_for_time_entry", { _time_entry_id: teId, _recompute: false });
    const aE = await rpc(F.mgrAll.c, "compute_earnings_for_time_entry", { _time_entry_id: teId, _recompute: true });
    rec("A/R/E office-Y manager refused (generic) on assign, release and compute earnings for office X; office-X and unrestricted managers succeed",
      pass(DENY.test(yA.err || "") && !xA.err && !aA.err && DENY.test(yR.err || "") && keptAfterY === 1 && xR.v === 1 && aR.v === 1 && teSt === "approved"
        && DENY.test(yE.err || "") && xE.v && xE.v.ok === true && aE.v && aE.v.ok === true),
      `assign Y "${yA.err || "ACCEPTED"}", X ${xA.err || "ok"}, all ${aA.err || "ok"}; release Y "${yR.err || "ACCEPTED"}" (kept ${keptAfterY}), X ${xR.err || xR.v}, all ${aR.err || aR.v}; earnings Y "${yE.err || "ACCEPTED"}", X ${xE.err || JSON.stringify(xE.v.ok)}, all ${aE.err || JSON.stringify(aE.v.ok)}`);
  }
  F.teIds = [teId];
  const op = await sh(F.OX, F.CX, 6, "09:00", "10:00"); const pick = await rpc(F.cg.c, "caregiver_pick_up_shift", { _shift_id: op });
  rec("P caregiver self pick-up works", pass(!pick.err && (await active(op)) === 1), pick.err || "picked up");

  // ---- Edge Functions ----
  const gx = await ins("caregivers", { agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `GX3 ${RUN}`, email: `sec-gx3-${RUN}@caremuch-sectest.test`.toLowerCase(), phone: "555-0195", is_demo: true });
  const cx = await ins("clients", { agency_id: A, virtual_office_id: F.OX, first_name: "ZZ", last_name: `CX3 ${RUN}`, email: `sec-cx3-${RUN}@caremuch-sectest.test`.toLowerCase(), phone: "555-0196", address: "6 CP St", city: "Portage", state: "MI", zip_code: "49002", is_demo: true });
  const eY = await fn(F.mgrY.c, "enable-caregiver-login", { caregiverId: gx }), cY = await fn(F.mgrY.c, "enable-client-login", { clientId: cx });
  const rY = await fn(F.mgrY.c, "admin-reset-password", { userId: F.schX.id });
  if (LABEL === "before") {
    rec("B-GAP-EF before (expected): office-Y manager passes the agency check of enable-caregiver-login / enable-client-login / admin-reset-password on office X",
      pass(eY.status !== 403 && cY.status !== 403 && rY.status !== 403), `caregiver login ${eY.status}; client login ${cY.status}; reset password ${rY.status}`);
  } else {
    const eX = await fn(F.mgrX.c, "enable-caregiver-login", { caregiverId: gx }), cX = await fn(F.mgrX.c, "enable-client-login", { clientId: cx });
    const rX = await fn(F.mgrX.c, "admin-reset-password", { userId: F.schX.id }), rA = await fn(F.mgrAll.c, "admin-reset-password", { userId: F.schX.id });
    rec("EF office-Y manager gets 403 from enable-caregiver-login, enable-client-login and admin-reset-password for office X; the office-X manager and the unrestricted manager are allowed",
      pass(eY.status === 403 && cY.status === 403 && rY.status === 403 && eX.status === 200 && cX.status === 200 && rX.status === 200 && rA.status === 200),
      `Y: caregiver login ${eY.status}, client login ${cY.status}, reset ${rY.status}; X: caregiver login ${eX.status}, client login ${cX.status}, reset ${rX.status}; unrestricted reset ${rA.status}`);
  }
  for (const [t, id] of [["caregivers", gx], ["clients", cx]]) { const u = (await admin.from(t).select("user_id").eq("id", id).single()).data.user_id; if (u) F.extraUsers.push(u); }

  // ---- note shells per service (after only) ----
  if (LABEL !== "before") {
    await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX }); await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OY });
    const noteFields = [{ field_key: "service_date", label: "Date", field_type: "date", storage: "spine_column", writes_to_entity: "progress_note", writes_to_column: "service_date" },
      { field_key: "objectives", label: "Objectives", field_type: "table", storage: "child_rows", writes_to_entity: "progress_note_entry" }];
    const shell = async (c, office, name, svc) => { const v = await must(c, "save_template_draft", { _template_id: null, _office_id: office, _kind: "progress_note", _name: `ZZ ${name} ${RUN}`,
      _intake_doc_type: null, _is_required_for_client: null, _sections: [], _note_layout: null, _fields: noteFields, _service_type: svc });
      const t = (await admin.from("form_template_versions").select("template_id").eq("id", v).single()).data.template_id; ids.form_templates = (ids.form_templates || []).concat(t);
      await must(c, "publish_template_version", { _template_id: t }); return t; };
    const tCls = await shell(F.mgrX.c, F.OX, "CLS note", "cls"), tResp = await shell(F.mgrX.c, F.OX, "Respite note", "respite"), tY = await shell(F.mgrY.c, F.OY, "Y CLS note", "cls");
    await ins("caregiver_skills", [{ caregiver_id: F.G, care_type_code: "RESP0001", is_demo: true }, { caregiver_id: F.GY, care_type_code: "RESP0001", is_demo: true }]);
    F.planClients = [F.CX];
    await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-60), expiration_date: await dbDay(300) } });
    const note = async (c, office, client, g, code, start, end) => { const s = await sh(office, client, -1, start, end, code); await must(F.mgrAll.c, "assign_caregiver_to_shift", { _shift_id: s, _caregiver_id: g, _method: "manual", _notes: "S-OFF", _override_reason: null });
      const n = await must(c, "create_progress_note_for_shift", { _shift_id: s }); ids.progress_notes = (ids.progress_notes || []).concat(n);
      return (await admin.from("progress_notes").select("template_id").eq("id", n).single()).data.template_id; };
    const nC = await note(F.mgrX.c, F.OX, F.CX, F.G, "CLS0001", "06:00", "07:00"), nR = await note(F.mgrX.c, F.OX, F.CX, F.G, "RESP0001", "15:00", "16:00");
    const nYr = await note(F.mgrY.c, F.OY, F.CY, F.GY, "RESP0001", "15:00", "16:00");
    rec("N1/N2 respite note -> respite shell, CLS note -> CLS shell; an office with only a CLS shell falls back to it for respite (today's behaviour)",
      pass(nC === tCls && nR === tResp && nYr === tY), `X CLS -> ${nC === tCls ? "CLS shell" : nC}; X respite -> ${nR === tResp ? "respite shell" : nR}; Y respite -> ${nYr === tY ? "Y CLS shell (fallback)" : nYr}`);
  }
}

async function teardownSoff(F) {
  if (!F) return;
  for (const t of F.teIds || []) { await admin.from("earnings_lines").delete().eq("time_entry_id", t); await admin.from("time_entries").delete().eq("id", t); await admin.from("events").delete().eq("subject_id", t); }
  for (const c of [F.CX, F.CY].filter(Boolean)) await admin.from("progress_notes").delete().eq("client_id", c);
  for (const c of F.planClients || []) await admin.from("care_plans").delete().eq("client_id", c);
  for (const u of F.extraUsers || []) { await admin.from("user_roles").delete().eq("user_id", u); await admin.from("profiles").delete().eq("id", u); await admin.auth.admin.deleteUser(u).catch(() => {}); }
  for (const t of ["caregivers", "clients"]) for (const id of ids[t] || []) await admin.from(t).update({ user_id: null }).eq("id", id);
  const left = [];
  for (const u of F.extraUsers || []) { const { data } = await admin.auth.admin.getUserById(u); if (data && data.user) left.push(`auth ${u}`); }
  for (const t of F.teIds || []) { const { data } = await admin.from("time_entries").select("id").eq("id", t); if (data && data.length) left.push(`time_entry ${t}`); }
  log(`teardown S-OFF: ${(F.teIds || []).length} time entries, ${(F.extraUsers || []).length} logins created by the Edge Functions → remaining: ${left.length ? left.join("; ") : "NONE"}`);
}

(async () => {
  log(`=== S-OFF-1 + note shells — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    F = await setup(); await setupB1(F);
    F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
    await checkNoBreak(F);
    await run(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    if (F) { const now = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
      for (const t of now) await admin.from("credential_types").delete().eq("id", t); }
    await teardownSoff(F); await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.shifts WHERE virtual_office_id = ANY($1::uuid[]))::int shifts,
        (SELECT count(*) FROM public.time_entries WHERE virtual_office_id = ANY($1::uuid[]))::int te,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($1::uuid[]) OR agency_id = $2::uuid)::int ev`, [[F.OX, F.OY, F.OZ], F.B])).rows[0]);
      log(`S-OFF teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();

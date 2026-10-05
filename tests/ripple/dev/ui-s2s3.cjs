// UI round 2 backend additions on DEV (S2: G3 + W1; S3: G1 + get_caregiver_compliance).
// Usage: node tests/ripple/dev/ui-s2s3.cjs <before|after>
//   before: the 7 new functions are absent; NB1
//   after : behaviour, office scope, role denials and ACLs through real logins (mirrors pglite/ui-s2s3.cjs)
// DEV run: creates disposable fixtures on the linked project and deletes them (needs owner approval;
// additive slice migrations may be pushed after this before-run is green, owner rule Oct 4).
const { A, REF, URL_, ANON, LABEL, RUN, admin, opts, createClient, ids, log, rec, pass, ins, mkUser, reportSkew, pgRead, setup, checkNoBreak,
  DENY, setupB1, rpc, dbDay, teardownB1, teardown, closeDb, summary } = require("./lib.cjs");

const NEW_FNS = ["list_templates_with_usage", "upsert_measure_type", "set_measure_type_active", "delete_measure_type", "cp_require_agency_measure_type",
  "list_credential_expirations", "get_caregiver_compliance"];

async function after(F) {
  const must = async (c, fn, args) => { const r = await rpc(c, fn, args); if (r.err) throw new Error(`${fn}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [NEW_FNS])).rows);
  const bad = acl.filter((f) => /(^|[{,])=X|anon=X/.test(f.acl) || (f.proname.startsWith("cp_") ? (f.d || /authenticated=X/.test(f.acl)) : !(f.d && /authenticated=X/.test(f.acl))));
  rec("ACL 6 RPCs SECURITY DEFINER + authenticated (no PUBLIC/anon); the helper has no API role", pass(acl.length === 7 && bad.length === 0), `${acl.length}/7; offending ${bad.map((f) => f.proname).join(", ") || "none"}`);
  // module on for office X (the seed copies credential types + service mappings)
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));

  // ---------- S2: G3 ----------
  const ipos = (extra = []) => [
    { field_key: "effective_date", label: "Plan effective", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "effective_date" },
    { field_key: "expiration_date", label: "Plan expires", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "expiration_date" },
    { field_key: "goals", label: "Goals", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_goal" },
    { field_key: "hopes", label: "Hopes", field_type: "longtext", storage: "field_value" }, ...extra];
  const tplOf = async (v) => { const t = (await admin.from("form_template_versions").select("template_id").eq("id", v).single()).data.template_id; ids.form_templates = (ids.form_templates || []).concat(t); return t; };
  const tX = await tplOf(await must(F.mgrX.c, "save_template_draft", { _template_id: null, _office_id: F.OX, _kind: "ipos", _name: `ZZ IPOS X ${RUN}`, _intake_doc_type: null,
    _is_required_for_client: null, _sections: [], _note_layout: null, _fields: ipos(), _service_type: null }));
  await must(F.mgrX.c, "publish_template_version", { _template_id: tX });
  const tAg = await tplOf(await must(F.aaA.c, "save_template_draft", { _template_id: null, _office_id: null, _kind: "ipos", _name: `ZZ IPOS agency ${RUN}`, _intake_doc_type: null,
    _is_required_for_client: null, _sections: [], _note_layout: null, _fields: ipos(), _service_type: null }));
  await must(F.aaA.c, "publish_template_version", { _template_id: tAg });
  const tY = await tplOf(await must(F.mgrY.c, "save_template_draft", { _template_id: null, _office_id: F.OY, _kind: "ipos", _name: `ZZ IPOS Y ${RUN}`, _intake_doc_type: null,
    _is_required_for_client: null, _sections: [], _note_layout: null, _fields: ipos(), _service_type: null }));
  await must(F.mgrY.c, "publish_template_version", { _template_id: tY });
  const plan = await must(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: { effective_date: await dbDay(-60), expiration_date: await dbDay(300) } });
  F.planClients = [F.CX];
  await must(F.mgrX.c, "save_template_draft", { _template_id: tX, _office_id: null, _kind: null, _name: null, _intake_doc_type: null, _is_required_for_client: null, _sections: [],
    _note_layout: null, _fields: ipos([{ field_key: "strengths", label: "Strengths", field_type: "longtext", storage: "field_value" }]), _service_type: null });
  await must(F.mgrX.c, "publish_template_version", { _template_id: tX });
  const list = await must(F.mgrX.c, "list_templates_with_usage", { _office_id: F.OX });
  const lx = list.find((t) => t.template_id === tX), la = list.find((t) => t.template_id === tAg);
  const planV = (await admin.from("care_plans").select("template_version").eq("id", plan).single()).data.template_version;
  rec("G3 office manager lists office + agency-wide shells (not office Y's); edits only the office shell; v2 published, the plan stays on v1; usage per version; publisher shown",
    pass(!!lx && !!la && !list.some((t) => t.template_id === tY) && lx.can_edit === true && la.can_edit === false && lx.current_version === 2 && planV === 1
      && lx.versions.find((v) => v.version === 1).usage === 1 && lx.versions.find((v) => v.version === 2).usage === 0 && /ZZ mgrx/.test(lx.versions[0].published_by || "")),
    `${list.filter((t) => [tX, tAg, tY].includes(t.template_id)).length} fixture shells listed; can_edit office ${lx && lx.can_edit}, agency ${la && la.can_edit}; current v${lx && lx.current_version}; plan on v${planV}; usage ${lx && lx.versions.map((v) => `v${v.version}=${v.usage}`).join(" ")}; by ${lx && lx.versions[0].published_by}`);
  const spine = await rpc(F.mgrX.c, "save_template_draft", { _template_id: tX, _office_id: null, _kind: null, _name: null, _intake_doc_type: null, _is_required_for_client: null, _sections: [],
    _note_layout: null, _fields: ipos().map((f) => f.field_key === "effective_date" ? { ...f, writes_to_column: "meeting_date" } : f), _service_type: null });
  rec("G3-spine the RPC refuses a change to a spine field", pass(/Spine and child-row fields are fixed/.test(spine.err || "")), (spine.err || "accepted").slice(0, 80));
  const gl = []; let gn = 0;
  for (const [label, c] of [["scheduler", F.schX.c], ["hr_staff", F.hrX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]]) {
    const r = await rpc(c, "list_templates_with_usage", { _office_id: F.OX }); gn++; if (!r.err || !DENY.test(r.err)) gl.push(`${label}: ${r.err || "ALLOWED"}`); }
  rec("G3-deny scheduler, hr_staff, caregiver, client, anon, office-Y manager, agency-B admin, system_admin refused", pass(gl.length === 0), gl.join("; ") || `${gn} refused`);

  // ---------- S2: W1 ----------
  const mt = await must(F.mgrX.c, "upsert_measure_type", { _id: null, _kind: "prompt_level", _label: `ZZ Mood ${RUN}`, _default_options: ["Calm", "Upset"] });
  F.measureTypes = [mt];
  await must(F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: plan, _goals: [{ seq: 1, goal_text: "Goal", objectives: [{ letter: "A", seq: 1, objective_text: "Obj", service_type: "cls", responsible_party: "this_agency" }] }] });
  const obj = (await admin.from("care_plan_objectives").select("id, care_plan_goals!inner(care_plan_id)").eq("care_plan_goals.care_plan_id", plan).single()).data.id;
  const useIt = await rpc(F.mgrX.c, "set_objective_measures", { _objective_id: obj, _measures: [{ measure_type_id: mt, prompt_text: "Mood?" }] });
  const delUsed = await rpc(F.mgrX.c, "delete_measure_type", { _id: mt });
  const deact = await rpc(F.mgrX.c, "set_measure_type_active", { _id: mt, _active: false });
  const unused = await must(F.mgrAll.c, "upsert_measure_type", { _id: null, _kind: "tally", _label: `ZZ Unused ${RUN}`, _default_options: null });
  const delUnused = await rpc(F.mgrAll.c, "delete_measure_type", { _id: unused });
  const sys = (await admin.from("measure_types").select("id").is("agency_id", null).limit(1).single()).data.id;
  const sysEdit = await rpc(F.aaA.c, "upsert_measure_type", { _id: sys, _kind: null, _label: "Hacked", _default_options: null });
  rec("W1 a new measure type works in set_objective_measures; used -> can't delete, can deactivate; unused -> delete; system types read-only",
    pass(!useIt.err && /in use; deactivate it instead/.test(delUsed.err || "") && !deact.err && !delUnused.err && DENY.test(sysEdit.err || "")),
    `use ${useIt.err || "ok"}; delete used "${(delUsed.err || "ACCEPTED").slice(0, 45)}"; deactivate ${deact.err || "ok"}; delete unused ${delUnused.err || "ok"}; system "${sysEdit.err || "ACCEPTED"}"`);
  const wl = []; let wn = 0;
  for (const [label, c] of [["scheduler", F.schX.c], ["hr_staff", F.hrX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["system_admin", F.sysA.c]]) {
    const r = await rpc(c, "upsert_measure_type", { _id: null, _kind: "tally", _label: `ZZ by ${label} ${RUN}`, _default_options: null }); wn++;
    if (!r.err || !DENY.test(r.err)) { wl.push(`${label}: ${r.err || "ALLOWED"}`); if (r.v) F.measureTypes.push(r.v); } }
  const bEdit = await rpc(F.aaB.c, "set_measure_type_active", { _id: mt, _active: true }); wn++; if (!bEdit.err || !DENY.test(bEdit.err)) wl.push(`agency-B admin: ${bEdit.err || "ALLOWED"}`);
  rec("W1-deny scheduler, hr_staff, caregiver, client, anon, system_admin can't create; agency-B admin can't change agency A's type", pass(wl.length === 0), wl.join("; ") || `${wn} refused`);

  // ---------- S3: G1 bands + compliance read ----------
  const types = (await admin.from("credential_types").select("id, name, required").eq("agency_id", A).eq("is_active", true).order("name")).data;
  const req = types.filter((t) => t.required).slice(0, 6);
  const offsets = [61, 60, 30, 29, 0, -1];
  for (let i = 0; i < req.length; i++) await must(F.hrX.c, "enter_caregiver_credential", { _caregiver_id: F.G, _credential_type_id: req[i].id, _effective_date: await dbDay(-300), _expiry_date: await dbDay(offsets[i]), _certification_number: null });
  const ex = await must(F.hrX.c, "list_credential_expirations", { _office_id: F.OX, _within_days: 60 });
  const band = (i) => (ex.find((r) => r.caregiver_id === F.G && r.credential_type_id === req[i].id) || {}).band;
  const got = offsets.map((o, i) => `${o}d=${band(i) || "-"}`).join(" ");
  const missingForG = ex.filter((r) => r.caregiver_id === F.G && r.band === "missing").length;
  rec("G1 bands at 61/60/30/29/0/-1 days (61 not listed, 60 yellow, 30/29/0 red, -1 overdue); the other required types show as missing",
    pass(band(0) === undefined && band(1) === "yellow" && band(2) === "red" && band(3) === "red" && band(4) === "red" && band(5) === "overdue" && missingForG === types.filter((t) => t.required).length - 6),
    `${got}; missing for this caregiver ${missingForG}`);
  await must(F.mgrX.c, "enter_caregiver_credential", { _caregiver_id: F.G, _credential_type_id: req[3].id, _effective_date: await dbDay(-10), _expiry_date: await dbDay(355), _certification_number: null });
  const hrAfter = await rpc(F.hrX.c, "enter_caregiver_credential", { _caregiver_id: F.G, _credential_type_id: req[3].id, _effective_date: await dbDay(-10), _expiry_date: await dbDay(300), _certification_number: null });
  const comp = await must(F.hrX.c, "get_caregiver_compliance", { _caregiver_id: F.G });
  const row = comp.credentials.find((c) => c.credential_type_id === req[3].id);
  rec("C-override a manager override is shown (overridden by, history) and HR can no longer change that row",
    pass(row.locked_for_hr === true && /ZZ mgrx/.test(row.overridden_by || "") && row.history.length === 1 && /only a manager can change it/.test(hrAfter.err || "")),
    `overridden by ${row.overridden_by}; history ${row.history.length}; HR retry "${(hrAfter.err || "ACCEPTED").slice(0, 60)}"`);
  await must(F.hrX.c, "record_inservice_form", { _care_plan_id: plan, _case_manager_name: "CM", _program_lead_id: F.mgrX.id, _trained_on: await dbDay(-1), _signed_at: (await pgRead(async (c) => (await c.query("SELECT now() t")).rows[0].t)).toISOString() });
  await must(F.hrX.c, "record_training_form", { _care_plan_id: plan, _plan_document_type: "ipos_initial", _plan_effective_date: await dbDay(-60), _location: "Office", _records: [{ caregiver_id: F.G, training_date: await dbDay(-1) }] });
  await must(F.mgrX.c, "renew_care_plan", { _care_plan_id: plan });
  const tr = (await must(F.hrX.c, "get_caregiver_compliance", { _caregiver_id: F.G })).training[0];
  const { data: hrPlans } = await F.hrX.c.from("care_plans").select("id").limit(5);
  rec("C-training after a renewal: needs retraining (trained v1, current v2), client as first name + initial; hr_staff reads no care plans",
    pass(tr && tr.needs_retraining === true && tr.trained_version === 1 && tr.current_version === 2 && /^ZZ [A-Z]\.$/.test(tr.client_name) && (hrPlans || []).length === 0),
    `${JSON.stringify(tr)}; hr care_plans rows ${(hrPlans || []).length}`);
  const cl = []; let cn = 0;
  for (const [label, c] of [["scheduler", F.schX.c], ["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c], ["system_admin", F.sysA.c]]) {
    for (const [fn, args] of [["list_credential_expirations", { _office_id: F.OX, _within_days: 60 }], ["get_caregiver_compliance", { _caregiver_id: F.G }]]) {
      const r = await rpc(c, fn, args); cn++; if (!r.err || !DENY.test(r.err)) cl.push(`${label}->${fn}: ${r.err || "ALLOWED"}`); } }
  rec("S3-deny both reads refused for scheduler, caregiver, client, anon, office-Y manager, agency-B admin, system_admin", pass(cl.length === 0), cl.join("; ") || `${cn} refused`);
}

async function teardownUi(F) {
  if (!F) return;
  for (const c of F.planClients || []) { for (const t of ["plan_training_forms", "plan_inservice_forms", "care_plans"]) await admin.from(t).delete().eq("client_id", c); }
  for (const g of [F.G].filter(Boolean)) { await admin.from("plan_training_records").delete().eq("caregiver_id", g); await admin.from("caregiver_certifications").delete().eq("caregiver_id", g); }
  for (const m of F.measureTypes || []) { await admin.from("objective_measures").delete().eq("measure_type_id", m); await admin.from("measure_types").delete().eq("id", m); }
  await admin.from("measure_types").delete().like("label", `ZZ %${RUN}`);
  for (const t of F.newCredTypes || []) await admin.from("credential_types").delete().eq("id", t);
  const left = [];
  const { data: mts } = await admin.from("measure_types").select("id").like("label", `%${RUN}`); if (mts && mts.length) left.push(`${mts.length} measure types`);
  for (const c of F.planClients || []) { const { data } = await admin.from("care_plans").select("id").eq("client_id", c); if (data && data.length) left.push(`care_plans ${c}`); }
  log(`teardown UI round 2: measure types, plans, certifications, ${(F.newCredTypes || []).length} new credential types → remaining: ${left.length ? left.join("; ") : "NONE"}`);
}

(async () => {
  log(`=== UI round 2 backend (S2 + S3) — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const n = await pgRead(async (c) => (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [NEW_FNS])).rows[0].n);
      rec("B0 the 7 new functions are absent before the push", pass(n === 0), `${n}/7 present`);
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    await teardownUi(F); await teardownB1(F); await teardown(F);
    if (F) { const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM public.form_templates WHERE name LIKE $1)::int shells,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($2::uuid[]) OR agency_id = $3::uuid)::int ev`, [`ZZ %${RUN}`, [F.OX, F.OY, F.OZ], F.B])).rows[0]);
      log(`UI round 2 teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`); }
    await closeDb();
  }
  summary();
})();

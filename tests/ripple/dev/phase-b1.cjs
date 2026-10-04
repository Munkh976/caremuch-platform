// Ripple care-plan module — Phase B1 (write RPCs: templates, care plan, authorization, documents, credentials, training).
// Usage: node tests/ripple/dev/phase-b1.cjs <after|before>
// DEV run: creates disposable fixtures on the linked project and deletes them (needs owner approval).
const { A, REF, URL_, ANON, LABEL, RUN, SUFFIX, admin, opts, createClient, fs, path, BASELINE, ids, rows, log, rec, pass, ins, mkUser,
  dbNow, reportSkew, pgRead, setup, noBreak, checkNoBreak, DENY, setupB1, rpc, evIds, eventsSince, dbDay, teardownB1, teardown,
  teardownB2, closeDb, summary } = require("./lib.cjs");

const B1_RPCS = ["seed_office_care_plan_defaults", "save_template_draft", "publish_template_version", "upgrade_instance_template",
  "create_care_plan", "renew_care_plan", "update_care_plan_fields", "upsert_care_plan_goals", "set_objective_measures",
  "create_service_authorization", "upsert_client_document", "enter_caregiver_credential", "record_inservice_form",
  "record_training_form", "override_training_record"];
const B1_INTERNAL = ["cp_require_scope", "cp_audit", "cp_template_snapshot", "cp_resolve_template", "cp_validate_field_values",
  "cp_spine_columns", "cp_validate_template_definition", "cp_check_constrained_edit", "cp_require_template_editor",
  "cp_guard_template_version", "cp_guard_template_field", "cp_validate_plan_header", "cp_goal_tree"];

async function beforeB1(F) {
  const st = await pgRead(async (c) => ({
    rpcs: (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [B1_RPCS])).rows[0].n,
    internal: (await c.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`, [B1_INTERNAL])).rows[0].n,
    defaults: (await c.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('cp_default_credential_types','cp_default_service_types')`)).rows[0].n,
    events: ((await c.query(`SELECT (SELECT count(*) FROM regexp_matches(pg_get_constraintdef(oid), '''[a-z_]+''', 'g'))::int n FROM pg_constraint WHERE conname='events_event_type_check'`)).rows[0].n),
    dupTyped: (await c.query(`SELECT count(*)::int n FROM (SELECT caregiver_id, credential_type_id FROM public.caregiver_certifications WHERE credential_type_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1) d`)).rows[0].n,
    certPolicy: (await c.query(`SELECT string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname) s FROM pg_policies WHERE tablename='caregiver_certifications'`)).rows[0].s,
  }));
  rec("B0 B1 objects absent before push", pass(st.rpcs === 0 && st.internal === 0 && st.defaults === 0 && st.events === 18),
    `RPCs ${st.rpcs}/15, internal helpers ${st.internal}/13, default tables ${st.defaults}/2, event types ${st.events} (exp 18)`);
  rec("B0b pre-flight: no duplicate typed certifications (new unique index can be created)", pass(st.dupTyped === 0), `duplicates ${st.dupTyped}`);
  // the certification write gap, before: an office-Y manager writes a certification for an office-X caregiver
  const ins1 = await F.mgrY.c.from("caregiver_certifications").insert({ caregiver_id: F.G, certification_name: `ZZ cert ${RUN}`, expiry_date: "2030-01-01", is_demo: true }).select("id");
  if (!ins1.error) (ids.caregiver_certifications = ids.caregiver_certifications || []).push(ins1.data[0].id);
  rec("B1c certification office gap for writes (expected OPEN before B1)", ins1.error ? "CLOSED" : "OPEN",
    `office-Y manager direct INSERT for an office-X caregiver: ${ins1.error ? "refused" : "accepted"}; policies: ${st.certPolicy}`);
  const r = await rpc(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  rec("B0c B1 RPCs not callable before push", pass(!!r.err), r.err || "callable");
}

async function afterB1(F) {
  const offices = [F.OX, F.OY, F.OZ];
  const audit = [];
  // A1 by correlation (owner fix after the clock-skew finding): every audited call's event is
  // matched by the entity ids the call touched (uuid args + returned id; for template drafts the
  // template of the returned version) and by event_type, and must be exactly one. The DB clock
  // (never the local one) gives only a secondary window: events created at or after the call start.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const audited = async (step, c, fn, args, expType) => {
    const callStart = await dbNow();
    const r = await rpc(c, fn, args);
    const subjects = new Set(Object.values(args).filter((v) => typeof v === "string" && uuidRe.test(v)));
    if (typeof r.v === "string" && uuidRe.test(r.v)) subjects.add(r.v);
    if (fn === "save_template_draft" && r.v) subjects.add((await admin.from("form_template_versions").select("template_id").eq("id", r.v).single()).data.template_id);
    const { data: evs } = await admin.from("events").select("id, event_type, payload, subject_id").in("subject_id", [...subjects]).gte("created_at", callStart);
    (evs || []).forEach((e) => evIds.add(e.id));
    const mine = (evs || []).filter((e) => e.event_type === expType);
    audit.push({ step, expType, matched: mine.length, other: (evs || []).length - mine.length, err: r.err,
      payloadOk: (evs || []).every((e) => Object.values(e.payload).every((x) => typeof x === "number" || typeof x === "boolean" || (typeof x === "string" && uuidRe.test(x)))) });
    return r;
  };
  // H1
  const s1 = await audited("enable module", F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX }, "care_plan_module_enabled");
  const s2 = await audited("enable again", F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX }, null);
  const mS = await rpc(F.mgrX.c, "seed_office_care_plan_defaults", { _office_id: F.OY });
  const { data: vo } = await admin.from("virtual_office").select("care_plan_module_enabled").eq("id", F.OX).single();
  rec("H1 module enable + defaults (idempotent); manager refused", pass(!s1.err && s1.v.service_types_added === 2 && vo.care_plan_module_enabled && !s2.err && s2.v.service_types_added === 0 && s2.v.credential_types_added === 0 && DENY.test(mS.err || "")),
    `first ${JSON.stringify(s1.v || s1.err)} (credential types already in the agency from the Phase A seed); second ${JSON.stringify(s2.v || s2.err)}; manager: ${mS.err ? "refused" : "accepted"}`);
  // H2 shells
  const ipos = (extra = []) => [
    { field_key: "effective_date", label: "Plan effective", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "effective_date" },
    { field_key: "expiration_date", label: "Plan expires", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "expiration_date" },
    { field_key: "goals", label: "Goals", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_goal" },
    { field_key: "hopes", label: "Hopes and dreams", field_type: "longtext", storage: "field_value", required: true },
    { field_key: "abd_type", label: "ABD type", field_type: "select", storage: "field_value", options: ["Medicaid", "Non-Medicaid"] }, ...extra];
  const draft = (c, tpl, office, kind, name, fields, layout) => rpc(c, "save_template_draft", { _template_id: tpl, _office_id: office, _kind: kind, _name: name,
    _intake_doc_type: null, _is_required_for_client: null, _sections: [], _note_layout: layout || null, _fields: fields });
  const noteFields = [{ field_key: "service_date", label: "Date", field_type: "date", storage: "spine_column", writes_to_entity: "progress_note", writes_to_column: "service_date" },
    { field_key: "objectives", label: "Objectives", field_type: "table", storage: "child_rows", writes_to_entity: "progress_note_entry" }];
  const tplOf = async (verId) => (await admin.from("form_template_versions").select("template_id").eq("id", verId).single()).data.template_id;
  const d1 = await audited("note draft", F.mgrX.c, "save_template_draft", { _template_id: null, _office_id: F.OX, _kind: "progress_note", _name: `ZZ CLS note ${RUN}`, _intake_doc_type: null, _is_required_for_client: null, _sections: [], _note_layout: { billing_footer: { enabled: true } }, _fields: noteFields }, "template_draft_saved");
  const noteTpl = d1.v && await tplOf(d1.v); (ids.form_templates = ids.form_templates || []).push(noteTpl);
  const p1 = await audited("note publish", F.mgrX.c, "publish_template_version", { _template_id: noteTpl }, "template_published");
  const d2 = await audited("ipos draft", F.mgrX.c, "save_template_draft", { _template_id: null, _office_id: F.OX, _kind: "ipos", _name: `ZZ IPOS X ${RUN}`, _intake_doc_type: null, _is_required_for_client: null, _sections: [], _note_layout: null, _fields: ipos() }, "template_draft_saved");
  const iposTpl = d2.v && await tplOf(d2.v); ids.form_templates.push(iposTpl);
  const p2 = await audited("ipos publish", F.mgrX.c, "publish_template_version", { _template_id: iposTpl }, "template_published");
  rec("H2 manager builds + publishes a CLS note shell and an IPOS shell", pass(!d1.err && !p1.err && !d2.err && !p2.err), [d1, p1, d2, p2].map((r) => r.err || "ok").join(" / "));
  // H3 plan + goals + measures
  const header = { effective_date: "2026-10-01", expiration_date: "2027-09-30" };
  const cp = await audited("create plan", F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: header, _field_values: { hopes: "Fixture narrative", abd_type: "Medicaid" } }, "care_plan_created");
  const plan = cp.v; (ids.care_plans = ids.care_plans || []).push(plan);
  const goals = [{ seq: 1, goal_text: "Goal one", objectives: [
      { letter: "A", seq: 1, objective_text: "Obj 1A", staff_instructions: "Fixture instructions", service_type: "cls", responsible_party: "this_agency" },
      { letter: "B", seq: 2, objective_text: "Obj 1B", responsible_party: "case_management" }] },
    { seq: 2, goal_text: "Goal two", objectives: [{ letter: "A", seq: 1, objective_text: "Obj 2A", service_type: "respite", responsible_party: "this_agency" }] }];
  const ug = await audited("goals", F.mgrX.c, "upsert_care_plan_goals", { _care_plan_id: plan, _goals: goals }, "care_plan_updated");
  const objs = (await admin.from("care_plan_objectives").select("id, responsible_party, care_plan_goals!inner(care_plan_id, seq), seq").eq("care_plan_goals.care_plan_id", plan)).data
    .sort((a, b) => a.care_plan_goals.seq - b.care_plan_goals.seq || a.seq - b.seq);
  const { data: mts } = await admin.from("measure_types").select("id, kind").is("agency_id", null);
  const yesno = mts.find((m) => m.kind === "yes_no_na").id, trials = mts.find((m) => m.kind === "trials").id;
  const sm = await audited("measures", F.mgrX.c, "set_objective_measures", { _objective_id: objs[0].id, _measures: [{ measure_type_id: yesno, prompt_text: "Did the client participate?" }, { measure_type_id: trials, prompt_text: "Trials", trial_count: 3 }] }, "objective_measures_set");
  const smCM = await rpc(F.mgrX.c, "set_objective_measures", { _objective_id: objs.find((o) => o.responsible_party === "case_management").id, _measures: [{ measure_type_id: yesno, prompt_text: "x" }] });
  const tv1 = (await admin.from("care_plans").select("training_version").eq("id", plan).single()).data.training_version;
  rec("H3 care plan, 2 goals / 3 objectives (one case_management), measures", pass(!cp.err && ug.v && ug.v.goals === 2 && ug.v.objectives === 3 && sm.v === 2 && /data questions/.test(smCM.err || "") && tv1 === 1),
    `plan ${cp.err || "ok"}; goals ${JSON.stringify(ug.v || ug.err)}; measures ${sm.v || sm.err}; CM objective: ${smCM.err ? "refused" : "accepted"}; training_version ${tv1}`);
  // H4 authorization
  const AU = (num) => ({ _client_id: F.CX, _service_type: "cls", _auth_number: num, _units_authorized: 40, _effective_date: "2026-10-01", _expiration_date: "2026-12-31" });
  const au = await audited("authorization", F.mgrX.c, "create_service_authorization", AU(`ZZ-${RUN}`), "authorization_created");
  const auDup = await rpc(F.mgrX.c, "create_service_authorization", AU(`zz-${RUN}`));
  const avail = (await admin.from("service_authorizations").select("units_available").eq("id", au.v).single()).data;
  rec("H4 authorization (manual adapter), number unique per agency", pass(!au.err && Number(avail.units_available) === 40 && /already exists/.test(auDup.err || "")), `created ${au.err || "ok"}, available ${avail && avail.units_available}; duplicate (case-insensitive): ${auDup.err ? "refused" : "accepted"}`);
  // H5 documents
  const doc = (t, s, r) => ({ _client_id: F.CX, _doc_type: t, _status: s, _not_applicable_reason: r });
  const dc1 = await audited("doc", F.mgrX.c, "upsert_client_document", doc("consent", "complete", null), "client_document_saved");
  const dc2 = await audited("doc n/a", F.mgrX.c, "upsert_client_document", doc("safety_behavior_plan", "not_applicable", "No plan in the IPOS"), "client_document_saved");
  const dc3 = await rpc(F.mgrX.c, "upsert_client_document", doc("safety_behavior_plan", "not_applicable", null));
  rec("H5 client documents incl. not_applicable (reason required)", pass(!dc1.err && !dc2.err && /needs a reason/.test(dc3.err || "")), `${dc1.err || "ok"} / ${dc2.err || "ok"} / without reason: ${dc3.err ? "refused" : "accepted"}`);
  // H6 credential
  const ichat = (await admin.from("credential_types").select("id").eq("agency_id", A).eq("name", "ICHAT").single()).data.id;
  const cr = (c) => rpc(c, "enter_caregiver_credential", { _caregiver_id: F.G, _credential_type_id: ichat, _effective_date: "2026-09-01", _expiry_date: "2027-09-01" });
  const c1 = await audited("hr credential", F.hrX.c, "enter_caregiver_credential", { _caregiver_id: F.G, _credential_type_id: ichat, _effective_date: "2026-09-01", _expiry_date: "2027-09-01" }, "credential_entered");
  const c2 = await audited("mgr override", F.mgrX.c, "enter_caregiver_credential", { _caregiver_id: F.G, _credential_type_id: ichat, _effective_date: "2026-09-01", _expiry_date: "2027-08-31" }, "credential_overridden");
  const c3 = await cr(F.hrX.c);
  const { data: cert } = await admin.from("caregiver_certifications").select("id, entered_by, overridden_by, is_verified, change_history").eq("caregiver_id", F.G).eq("credential_type_id", ichat);
  (cert || []).forEach((x) => (ids.caregiver_certifications = ids.caregiver_certifications || []).push(x.id));
  rec("H6 hr enters credential; manager overrides (who entered + who overrode kept); hr can't change it after", pass(!c1.err && !c2.err && /only a manager/.test(c3.err || "") && cert.length === 1 && cert[0].entered_by === F.hrX.id && cert[0].overridden_by === F.mgrX.id && cert[0].is_verified),
    `rows ${cert.length}; entered_by hr ${cert[0] && cert[0].entered_by === F.hrX.id}; overridden_by mgr ${cert[0] && cert[0].overridden_by === F.mgrX.id}; hr after: ${c3.err ? "refused" : "accepted"}`);
  // H7 in-service + training
  const ins = await audited("in-service", F.hrX.c, "record_inservice_form", { _care_plan_id: plan, _case_manager_name: "Fixture CM", _program_lead_id: F.mgrX.id, _trained_on: "2026-10-02", _signed_at: "2026-10-02T15:00:00Z" }, "inservice_signed");
  const tr = await audited("training", F.hrX.c, "record_training_form", { _care_plan_id: plan, _plan_document_type: "ipos_initial", _plan_effective_date: "2026-10-01", _location: "Office", _records: [{ caregiver_id: F.G, training_date: "2026-10-03" }] }, "training_recorded");
  const { data: trRows } = await admin.from("plan_training_records").select("training_version").eq("care_plan_id", plan);
  rec("H7 in-service form + training record at training_version 1", pass(!ins.err && !tr.err && trRows.length === 1 && trRows[0].training_version === 1), `${ins.err || "ok"} / ${tr.err || "ok"} at tv ${trRows[0] && trRows[0].training_version}`);
  // TV1
  const rn = await audited("renew", F.mgrX.c, "renew_care_plan", { _care_plan_id: plan }, "care_plan_renewed");
  const plan2 = rn.v; ids.care_plans.push(plan2);
  await audited("narrative", F.mgrX.c, "update_care_plan_fields", { _care_plan_id: plan2, _field_values: { hopes: "Edited", abd_type: "Non-Medicaid" } }, "care_plan_updated");
  const ob2 = (await admin.from("care_plan_objectives").select("id, care_plan_goals!inner(care_plan_id)").eq("care_plan_goals.care_plan_id", plan2).eq("responsible_party", "this_agency").limit(1)).data[0].id;
  await audited("measures edit", F.mgrX.c, "set_objective_measures", { _objective_id: ob2, _measures: [{ measure_type_id: yesno, prompt_text: "Changed" }] }, "objective_measures_set");
  const { data: plans } = await admin.from("care_plans").select("id, status, training_version").eq("client_id", F.CX).order("version");
  rec("TV1 renewal with identical goals -> 2; narrative + measures edits keep 2", pass(plans.length === 2 && plans[0].status === "superseded" && plans[1].training_version === 2),
    `plans ${plans.map((p) => `${p.status}:tv${p.training_version}`).join(", ")}`);
  // T: templates
  const curV = (await admin.from("form_template_versions").select("id").eq("template_id", iposTpl).eq("is_current", true).single()).data.id;
  const relabel = await rpc(F.mgrX.c, "save_template_draft", { _template_id: iposTpl, _office_id: null, _kind: null, _name: null, _intake_doc_type: null, _is_required_for_client: null, _sections: [], _note_layout: null,
    _fields: ipos([{ field_key: "strengths", label: "Strengths", field_type: "longtext", storage: "field_value" }]) });
  const curAfter = (await admin.from("form_template_versions").select("id").eq("template_id", iposTpl).eq("is_current", true).single()).data.id;
  const drop = await rpc(F.mgrX.c, "save_template_draft", { _template_id: iposTpl, _office_id: null, _kind: null, _name: null, _intake_doc_type: null, _is_required_for_client: null, _sections: [], _note_layout: null, _fields: ipos().filter((f) => f.field_key !== "expiration_date") });
  const authShell = await draft(F.mgrX.c, null, F.OX, "authorization", `ZZ auth ${RUN}`, [{ field_key: "units", label: "Units", field_type: "units", storage: "spine_column", writes_to_entity: "service_authorization", writes_to_column: "units_authorized" }]);
  const authTpl = authShell.v && await tplOf(authShell.v); ids.form_templates.push(authTpl);
  const pubNoSpine = await rpc(F.mgrX.c, "publish_template_version", { _template_id: authTpl });
  const directUpd = await F.mgrX.c.from("form_template_versions").update({ sections: [{ x: 1 }] }).eq("id", curV).select("id");
  rec("T1 published version unchanged by drafts; Q13 constrained; spine drop not publishable; no direct edit",
    pass(!relabel.err && curAfter === curV && /fixed/.test(drop.err || "") && /required spine fields/.test(pubNoSpine.err || "") && (directUpd.error || directUpd.data.length === 0)),
    `relabel+narrative draft ${relabel.err || "ok"}, current unchanged ${curAfter === curV}; drop spine: ${drop.err ? "refused" : "accepted"}; publish without spine: ${pubNoSpine.err ? "refused" : "accepted"}; direct UPDATE: ${directUpd.error ? "refused" : directUpd.data.length + " rows"}`);
  const wide = await draft(F.aaA.c, null, null, "ipos", `ZZ IPOS agency-wide ${RUN}`, ipos());
  const wideTpl = wide.v && await tplOf(wide.v); ids.form_templates.push(wideTpl);
  await rpc(F.aaA.c, "publish_template_version", { _template_id: wideTpl });
  const cpY = await rpc(F.mgrY.c, "create_care_plan", { _client_id: F.CY, _plan_type: "initial", _header: header, _field_values: { hopes: "Y" } }); ids.care_plans.push(cpY.v);
  const usedY = cpY.v && (await admin.from("care_plans").select("template_id").eq("id", cpY.v).single()).data.template_id;
  const usedX = (await admin.from("care_plans").select("template_id").eq("id", plan).single()).data.template_id;
  rec("T4 office shell wins over agency-wide (Q15)", pass(usedX === iposTpl && usedY === wideTpl), `office X plan -> office shell ${usedX === iposTpl}; office Y plan -> agency-wide ${usedY === wideTpl}`);
  const fv = {}; for (const [k, v] of Object.entries({ unknown: { hopes: "x", zzz: 1 }, wrongType: { hopes: 5 }, badOption: { hopes: "x", abd_type: "Other" }, missingRequired: { abd_type: "Medicaid" } })) {
    const r = await rpc(F.mgrX.c, "update_care_plan_fields", { _care_plan_id: plan2, _field_values: v }); fv[k] = r.err ? "rejected" : "accepted"; }
  rec("T5 field_values must match the snapshot", pass(Object.values(fv).every((x) => x === "rejected")), JSON.stringify(fv));
  // D1 denials
  const anon = createClient(URL_, ANON, opts);
  const calls = {
    seed_office_care_plan_defaults: { _office_id: F.OX }, publish_template_version: { _template_id: iposTpl },
    create_care_plan: { _client_id: F.CX, _plan_type: "initial", _header: header }, renew_care_plan: { _care_plan_id: plan2 },
    update_care_plan_fields: { _care_plan_id: plan2, _header: { recorder_name: "x" } }, upsert_care_plan_goals: { _care_plan_id: plan2, _goals: [] },
    set_objective_measures: { _objective_id: ob2, _measures: [] }, create_service_authorization: AU(`ZZ-D-${RUN}`),
    upsert_client_document: doc("consent", "complete", null), upgrade_instance_template: { _instance_table: "care_plans", _instance_id: plan2 },
    enter_caregiver_credential: { _caregiver_id: F.G, _credential_type_id: ichat, _effective_date: "2026-09-01", _expiry_date: "2027-09-01" },
    record_inservice_form: { _care_plan_id: plan2, _case_manager_name: "CM", _program_lead_id: F.mgrX.id, _trained_on: "2026-10-02", _signed_at: "2026-10-02T15:00:00Z" },
  };
  const clinical = ["create_care_plan", "renew_care_plan", "update_care_plan_fields", "upsert_care_plan_goals", "set_objective_measures", "create_service_authorization", "upsert_client_document", "upgrade_instance_template"];
  const leaks = []; let n = 0;
  for (const [fn, args] of Object.entries(calls)) {
    const who = [["caregiver", F.cg.c], ["client", F.cl.c], ["anon", anon], ["office-Y manager", F.mgrY.c], ["agency-B admin", F.aaB.c]];
    if (clinical.includes(fn) || fn === "publish_template_version") who.push(["scheduler", F.schX.c], ["hr_staff", F.hrX.c]);
    if (clinical.includes(fn)) who.push(["system_admin", F.sysA.c]);
    if (fn === "enter_caregiver_credential" || fn === "record_inservice_form") who.push(["scheduler", F.schX.c], ["system_admin", F.sysA.c]);
    if (fn === "seed_office_care_plan_defaults") who.push(["manager", F.mgrX.c], ["scheduler", F.schX.c], ["hr_staff", F.hrX.c]);
    for (const [label, c] of who) { const r = await rpc(c, fn, args); n++; if (!r.err || !DENY.test(r.err)) leaks.push(`${label}->${fn}: ${r.err ? r.err.slice(0, 40) : "ALLOWED"}`); }
  }
  const ghost = await rpc(F.mgrX.c, "create_care_plan", { _client_id: "00000000-0000-0000-0000-000000000999", _plan_type: "initial", _header: header });
  const other = await rpc(F.mgrY.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: header });
  rec("D1 role/scope denials for every RPC", pass(leaks.length === 0 && ghost.err === other.err), leaks.length ? leaks.join("; ") : `${n} denied calls refused; missing row and other-office row give the same error`);
  // A1 audit
  const bad = audit.filter((a) => (a.expType ? a.matched !== 1 || a.other !== 0 : a.matched + a.other !== 0) || !a.payloadOk);
  rec("A1 exactly one event per audited write (matched by entity id + type); payloads ids/counts only", pass(bad.length === 0),
    bad.length ? JSON.stringify(bad) : `${audit.length} writes: ${audit.filter((a) => a.expType).length} with exactly one correlated event of the expected type and no other, ${audit.filter((a) => !a.expType).length} no-op with none`);
  // X1-X3 (owner review)
  const dupPlan = await rpc(F.mgrX.c, "create_care_plan", { _client_id: F.CX, _plan_type: "initial", _header: header, _field_values: { hopes: "x" } });
  rec("X1 second create_care_plan for a client with an active plan is refused", pass(/already has an active plan/.test(dupPlan.err || "")), dupPlan.err || "accepted");
  const lead = (id) => rpc(F.hrX.c, "record_inservice_form", { _care_plan_id: plan2, _case_manager_name: "CM", _program_lead_id: id, _trained_on: "2026-10-02", _signed_at: "2026-10-02T15:00:00Z" });
  const lY = await lead(F.mgrY.id), lS = await lead(F.schX.id), lA = await lead(F.mgrAll.id);
  rec("X2 record_inservice_form refuses a program lead who isn't a manager of that office", pass(/program lead/.test(lY.err || "") && /program lead/.test(lS.err || "") && !lA.err),
    `office-Y manager: ${lY.err ? "refused" : "accepted"}; scheduler: ${lS.err ? "refused" : "accepted"}; agency-wide manager: ${lA.err || "accepted"}`);
  const pb = (await admin.from("care_plans").select("training_version, status, client_id").eq("id", plan2).single()).data;
  const xr = {}; for (const [k, v] of Object.entries({ training_version: 9, status: "expired", client_id: F.CY })) {
    const r = await rpc(F.mgrX.c, "update_care_plan_fields", { _care_plan_id: plan2, _header: { [k]: v } }); xr[k] = r.err ? "rejected" : "accepted"; }
  const pa = (await admin.from("care_plans").select("training_version, status, client_id").eq("id", plan2).single()).data;
  rec("X3 update_care_plan_fields can't change training_version, status or client", pass(Object.values(xr).every((x) => x === "rejected") && JSON.stringify(pb) === JSON.stringify(pa)), `${JSON.stringify(xr)}; row unchanged ${JSON.stringify(pb) === JSON.stringify(pa)}`);
  // C1 certification lock-down
  const dI = await F.mgrX.c.from("caregiver_certifications").insert({ caregiver_id: F.GX2, certification_name: "x", expiry_date: "2030-01-01" }).select("id");
  const dIY = await F.mgrY.c.from("caregiver_certifications").insert({ caregiver_id: F.G, certification_name: "x", expiry_date: "2030-01-01" }).select("id");
  const rd = await F.mgrX.c.from("caregiver_certifications").select("id").eq("caregiver_id", F.G);
  rec("C1 certification office gap closed for writes (direct writes refused; reads kept)", pass(!!dI.error && !!dIY.error && !rd.error && rd.data.length >= 1),
    `office-X manager INSERT: ${dI.error ? "refused" : "accepted"}; office-Y manager INSERT for office-X caregiver: ${dIY.error ? "refused" : "accepted"}; read rows ${rd.data && rd.data.length}`);
  // ACL
  const acl = await pgRead(async (c) => (await c.query(`SELECT p.proname, p.prosecdef d, COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default)') g
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [[...B1_RPCS, ...B1_INTERNAL]])).rows);
  const badAcl = acl.filter((f) => f.g === "(default)" || /PUBLIC|anon/.test(f.g) || (B1_RPCS.includes(f.proname) ? !(f.d && /authenticated/.test(f.g)) : /authenticated/.test(f.g)));
  rec("ACL every B1 function: RPCs definer + authenticated; internal helpers no API role", pass(acl.length === 28 && badAcl.length === 0), `${acl.length}/28 found; offending: ${badAcl.map((f) => f.proname).join(", ") || "none"}`);
}

(async () => {
  log(`=== Ripple Phase B1 tests — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    F = await setup(); await setupB1(F);
    log(`fixtures [${RUN}]: agency B; offices X, Y (agency A) + Z (B); managers X (restricted), Y (restricted), agency-wide; scheduler X; hr X; agency_admin A + B; system_admin; caregiver; client; 3 clients, 4 caregivers, 6 open shifts`);
    await checkNoBreak(F);
    if (LABEL === "before") await beforeB1(F); else await afterB1(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); }
  finally {
    await teardownB1(F);
    if (ids.caregiver_certifications) for (const id of ids.caregiver_certifications) await admin.from("caregiver_certifications").delete().eq("id", id);
    await teardown(F);
    if (F) {
      const left = await pgRead(async (c) => (await c.query(`SELECT
        (SELECT count(*) FROM public.events WHERE virtual_office_id = ANY($1::uuid[]) OR agency_id = $2::uuid)::int ev,
        (SELECT count(*) FROM public.caregiver_certifications WHERE caregiver_id = ANY($3::uuid[]))::int certs,
        (SELECT count(*) FROM public.office_service_types WHERE virtual_office_id = ANY($1::uuid[]))::int ost,
        (SELECT count(*) FROM public.form_templates WHERE name LIKE $4)::int tpl,
        (SELECT count(*) FROM auth.users WHERE email LIKE $5)::int users`, [[F.OX, F.OY, F.OZ], F.B, [F.G, F.GX2, F.GY, F.GZ].filter(Boolean), `ZZ %${RUN}`, `%${SUFFIX}`])).rows[0]);
      log(`B1 teardown re-query: events ${left.ev}, certifications ${left.certs}, office service types ${left.ost}, templates ${left.tpl}, users ${left.users} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`);
    }
  }
  await closeDb();
  summary();
})();

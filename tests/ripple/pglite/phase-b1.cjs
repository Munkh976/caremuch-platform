// Phase B1 on PGlite: write RPCs over Phase A.
// Usage: node tests/ripple/pglite/phase-b1.cjs   (local PGlite, no network)
const path = require("path");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/", ROLLBACK = path.resolve(__dirname, "../../../docs/rollback") + "/";
const LIVE = __dirname + "/live/";
// live definitions: .sql snapshots, except those stored on DEV with carriage returns (kept exact in JSON)
const EXACT = JSON.parse(require("fs").readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : require("fs").readFileSync(LIVE + n + ".sql", "utf8");
// Local (PGlite) apply + behaviour tests of Phase B1 on top of Phase A. Touches no remote database.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const PHASE_A = fs.readdirSync(MIG).filter((f) => /^2026100612/.test(f)).sort();
const B1 = fs.readdirSync(MIG).filter((f) => /^2026100712/.test(f)).sort();
const A = "56fbfe38-e8eb-40c1-ba27-07428f62ed2e", OX = "12faa863-017e-438c-966c-f67be9b726e7", OY = "56785edd-ce66-4bf0-a487-abb628f21fef";
const B = "bbbbbbbb-0000-0000-0000-000000000001", OZ = "bbbbbbbb-0000-0000-0000-0000000000a1";
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const users = { aaA: U(1), mgrX: U(2), mgrY: U(3), schX: U(4), hrX: U(5), cg: U(6), cl: U(7), aaB: U(8), sysA: U(9), mgrAll: U(10) };
const CX = U(101), CY = U(102), CZ = U(103), GX1 = U(201), GX2 = U(202), GY = U(203);
const rows = []; const rec = (id, ok, d) => { rows.push({ id, ok }); console.log(`${id} ${ok ? "PASS" : "FAIL"} :: ${d}`); };

(async () => {
  const db = new PGlite();
  await db.exec(fs.readFileSync(__dirname + "/stub.sql", "utf8"));
  await db.exec(fs.readFileSync(__dirname + "/live_helpers.sql", "utf8"));
  await db.exec(fs.readFileSync(__dirname + "/stub_b1.sql", "utf8"));
  await db.exec(`
    INSERT INTO agency VALUES ('${A}','A'),('${B}','B');
    INSERT INTO virtual_office (id, agency_id, name) VALUES ('${OX}','${A}','X'),('${OY}','${A}','Y'),('${OZ}','${B}','Z');
    INSERT INTO care_types (code) VALUES ('CLS0001'),('RESP0001');`);
  for (const f of [...PHASE_A, ...B1]) {
    try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { console.log("APPLY FAILED", f, "::", e.message); process.exit(1); }
  }
  console.log(`applied ${PHASE_A.length} Phase A + ${B1.length} B1 migrations`);

  await db.exec(`
    INSERT INTO profiles (id, agency_id, virtual_office_id, office_restricted) VALUES
      ('${users.aaA}','${A}',NULL,false), ('${users.mgrX}','${A}','${OX}',true), ('${users.mgrY}','${A}','${OY}',true),
      ('${users.schX}','${A}','${OX}',true), ('${users.hrX}','${A}','${OX}',true), ('${users.cg}','${A}','${OX}',false),
      ('${users.cl}','${A}',NULL,false), ('${users.aaB}','${B}',NULL,false), ('${users.sysA}','${A}',NULL,false),
      ('${users.mgrAll}','${A}',NULL,false);
    INSERT INTO user_roles (user_id, role, agency_id) VALUES
      ('${users.aaA}','agency_admin','${A}'), ('${users.mgrX}','manager','${A}'), ('${users.mgrY}','manager','${A}'),
      ('${users.schX}','scheduler','${A}'), ('${users.hrX}','hr_staff','${A}'), ('${users.cg}','caregiver','${A}'),
      ('${users.cl}','client','${A}'), ('${users.aaB}','agency_admin','${B}'), ('${users.sysA}','system_admin','${A}'),
      ('${users.mgrAll}','manager','${A}');
    INSERT INTO clients VALUES ('${CX}','${A}','${users.cl}','CX','${OX}'), ('${CY}','${A}',NULL,'CY','${OY}'), ('${CZ}','${B}',NULL,'CZ','${OZ}');
    INSERT INTO caregivers VALUES ('${GX1}','${A}','${users.cg}','G1','${OX}'), ('${GX2}','${A}',NULL,'G2','${OX}'), ('${GY}','${A}',NULL,'GY','${OY}');
    INSERT INTO cp_default_credential_types (name, category, valid_months) VALUES ('ICHAT','background_check',12),('HIPAA','annual_online',12),('Mandt Training','in_person_recert',NULL);
    INSERT INTO cp_default_service_types (care_type_code, service_type) VALUES ('CLS0001','cls'),('RESP0001','respite');`);

  const call = async (who, sql, params = []) => {
    await db.exec("BEGIN");
    try {
      if (who === "anon") await db.exec("SET LOCAL ROLE anon");
      else { await db.exec("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users[who]]); }
      const r = await db.query(sql, params); await db.exec("COMMIT"); return { rows: r.rows, v: r.rows[0] && Object.values(r.rows[0])[0] };
    } catch (e) { await db.exec("ROLLBACK"); return { err: e.message }; }
  };
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const evCount = async () => Number((await q("SELECT count(*)::int n FROM events"))[0].n);
  const lastEvents = async (n) => q(`SELECT event_type, payload FROM events ORDER BY created_at DESC, id DESC LIMIT ${n}`);
  const audit = []; // {step, type, delta, payloadOk}
  const audited = async (step, who, sql, params, expType) => {
    const before = await evCount(); const r = await call(who, sql, params); const after = await evCount();
    let payloadOk = true, type = null;
    if (after > before) { const [e] = await lastEvents(1); type = e.event_type;
      payloadOk = Object.values(e.payload).every((x) => typeof x === "number" || typeof x === "boolean" || (typeof x === "string" && /^[0-9a-f-]{36}$/.test(x))); }
    audit.push({ step, expType, type, delta: after - before, payloadOk, err: r.err });
    return r;
  };
  const DENY = /Not found or not allowed|permission denied/;

  // ======================= HAPPY PATH =======================
  const s1 = await audited("enable module", "aaA", "SELECT seed_office_care_plan_defaults($1)", [OX], "care_plan_module_enabled");
  const s1b = await audited("enable again (idempotent)", "aaA", "SELECT seed_office_care_plan_defaults($1)", [OX], null);
  const vo = (await q(`SELECT care_plan_module_enabled m FROM virtual_office WHERE id='${OX}'`))[0];
  rec("H1 module enable + defaults, idempotent", !s1.err && s1.v.credential_types_added === 3 && s1.v.service_types_added === 2 && vo.m === true
    && !s1b.err && s1b.v.credential_types_added === 0 && s1b.v.service_types_added === 0,
    `first ${JSON.stringify(s1.v || s1.err)}; second ${JSON.stringify(s1b.v || s1b.err)}; flag ${vo.m}`);
  const mgrSeed = await call("mgrX", "SELECT seed_office_care_plan_defaults($1)", [OY]);
  rec("H1b manager can't enable the module", DENY.test(mgrSeed.err || ""), mgrSeed.err || "accepted");

  const noteFields = [{ field_key: "service_date", label: "Date of service", field_type: "date", storage: "spine_column", writes_to_entity: "progress_note", writes_to_column: "service_date" },
    { field_key: "objectives", label: "Objectives", field_type: "table", storage: "child_rows", writes_to_entity: "progress_note_entry" },
    { field_key: "location_note", label: "Location detail", field_type: "text", storage: "field_value" }];
  const noteLayout = { header: ["client", "service_date"], objective_block: ["goal", "objective", "notes", "data"], notes_prompt: "include reinforcers", billing_footer: { enabled: true, fields: ["units_billed"] } };
  const ipos = (extra = []) => [
    { field_key: "effective_date", label: "Plan effective", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "effective_date" },
    { field_key: "expiration_date", label: "Plan expires", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "expiration_date" },
    { field_key: "goals", label: "Goals", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_goal" },
    { field_key: "hopes", label: "Hopes and dreams", field_type: "longtext", storage: "field_value", required: true },
    { field_key: "abd_type", label: "Adverse benefit determination", field_type: "select", storage: "field_value", options: ["Medicaid", "Non-Medicaid"] },
    { field_key: "appeal", label: "Appeal rights", field_type: "text", storage: "static_text", default_value: "You may appeal..." }, ...extra];
  const SAVE = "SELECT save_template_draft($1,$2,$3::form_template_kind,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)";
  const d1 = await audited("note draft", "mgrX", SAVE, [null, OX, "progress_note", "CLS progress note", null, null, "[]", JSON.stringify(noteLayout), JSON.stringify(noteFields)], "template_draft_saved");
  const noteTpl = (await q(`SELECT template_id FROM form_template_versions WHERE id=$1`, [d1.v]))[0].template_id;
  const p1 = await audited("note publish", "mgrX", "SELECT publish_template_version($1)", [noteTpl], "template_published");
  const d2 = await audited("ipos draft", "mgrX", SAVE, [null, OX, "ipos", "IPOS (office X)", null, null, "[]", null, JSON.stringify(ipos())], "template_draft_saved");
  const iposTpl = (await q(`SELECT template_id FROM form_template_versions WHERE id=$1`, [d2.v]))[0].template_id;
  const p2 = await audited("ipos publish", "mgrX", "SELECT publish_template_version($1)", [iposTpl], "template_published");
  rec("H2 manager builds + publishes CLS note shell and IPOS shell", !d1.err && !p1.err && !d2.err && !p2.err, [d1, p1, d2, p2].map((r) => r.err || "ok").join(" / "));

  const header = JSON.stringify({ effective_date: "2026-10-01", expiration_date: "2027-09-30", facilitator_name: "Fixture facilitator" });
  const cp = await audited("create plan", "mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, header, JSON.stringify({ hopes: "Fixture narrative", abd_type: "Medicaid" })], "care_plan_created");
  const plan = cp.v;
  const goals = [{ seq: 1, goal_text: "Goal one", objectives: [
      { letter: "A", seq: 1, objective_text: "Obj 1A", staff_instructions: "Fixture instructions", service_type: "cls", responsible_party: "this_agency" },
      { letter: "B", seq: 2, objective_text: "Obj 1B (CM)", responsible_party: "case_management" }] },
    { seq: 2, goal_text: "Goal two", objectives: [{ letter: "A", seq: 1, objective_text: "Obj 2A", service_type: "respite", responsible_party: "this_agency" }] }];
  const ug = await audited("goals (before training)", "mgrX", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan, JSON.stringify(goals)], "care_plan_updated");
  const objs = await q(`SELECT o.id, o.responsible_party rp FROM care_plan_objectives o JOIN care_plan_goals g ON g.id=o.goal_id WHERE g.care_plan_id=$1 ORDER BY g.seq, o.seq`, [plan]);
  const mts = await q(`SELECT id, kind FROM measure_types WHERE agency_id IS NULL ORDER BY label`);
  const yesno = mts.find((m) => m.kind === "yes_no_na").id, trials = mts.find((m) => m.kind === "trials").id;
  const sm = await audited("measures", "mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [objs[0].id, JSON.stringify([{ measure_type_id: yesno, prompt_text: "Did the client participate?" }, { measure_type_id: trials, prompt_text: "Trials", trial_count: 3 }])], "objective_measures_set");
  const smCM = await call("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [objs[1].id, JSON.stringify([{ measure_type_id: yesno, prompt_text: "x" }])]);
  const tv1 = (await q(`SELECT training_version tv FROM care_plans WHERE id=$1`, [plan]))[0].tv;
  rec("H3 plan with 2 goals / 3 objectives (one case_management) + measures", !cp.err && ug.v && ug.v.goals === 2 && ug.v.objectives === 3 && sm.v === 2 && /delivers have data questions/.test(smCM.err || "") && tv1 === 1,
    `plan ${cp.err || "ok"}; goals ${JSON.stringify(ug.v || ug.err)}; measures ${sm.v || sm.err}; CM objective measures: ${smCM.err ? "refused" : "accepted"}; training_version ${tv1}`);

  const AUTH = "SELECT create_service_authorization($1,$2,$3,$4,$5::date,$6::date)";
  const au = await audited("authorization", "mgrX", AUTH, [CX, "cls", "AUTH-0001", 40, "2026-10-01", "2026-12-31"], "authorization_created");
  const auDup = await call("mgrX", AUTH, [CX, "cls", "auth-0001", 10, "2026-10-01", "2026-12-31"]);
  const auBadSvc = await call("mgrX", AUTH, [CX, "nursing", "AUTH-0002", 10, "2026-10-01", "2026-12-31"]);
  const avail = (await q(`SELECT units_available a FROM service_authorizations WHERE id=$1`, [au.v]))[0];
  rec("H4 authorization (manual adapter)", !au.err && Number(avail.a) === 40 && /already exists/.test(auDup.err || "") && /does not provide/.test(auBadSvc.err || ""),
    `created ${au.err || "ok"} available ${avail && avail.a}; duplicate (case-insensitive): ${auDup.err ? "refused" : "accepted"}; unmapped service: ${auBadSvc.err ? "refused" : "accepted"}`);

  const DOC = "SELECT upsert_client_document($1,$2,$3::client_document_status,$4)";
  const dc1 = await audited("doc complete", "mgrX", DOC, [CX, "consent", "complete", null], "client_document_saved");
  const dc2 = await audited("doc not applicable", "mgrX", DOC, [CX, "safety_behavior_plan", "not_applicable", "No safety or behavior plan in the IPOS"], "client_document_saved");
  const dc3 = await call("mgrX", DOC, [CX, "safety_behavior_plan", "not_applicable", null]);
  const dc4 = await audited("doc new version", "mgrX", DOC, [CX, "consent", "complete", null], "client_document_saved");
  const docs = await q(`SELECT doc_type, version, is_current FROM client_documents WHERE client_id=$1 ORDER BY doc_type, version`, [CX]);
  rec("H5 client documents incl. not_applicable", !dc1.err && !dc2.err && /needs a reason/.test(dc3.err || "") && !dc4.err && docs.filter((d) => d.is_current).length === 2 && docs.length === 3,
    `consent ok; N/A with reason ok; N/A without reason: ${dc3.err ? "refused" : "accepted"}; versions ${docs.map((d) => `${d.doc_type}v${d.version}${d.is_current ? "*" : ""}`).join(", ")}`);

  const ichat = (await q(`SELECT id FROM credential_types WHERE agency_id='${A}' AND name='ICHAT'`))[0].id;
  const CRED = "SELECT enter_caregiver_credential($1,$2,$3::date,$4::date)";
  const c1 = await audited("hr enters credential", "hrX", CRED, [GX1, ichat, "2026-09-01", "2027-09-01"], "credential_entered");
  const c2 = await audited("hr renews (in place)", "hrX", CRED, [GX1, ichat, "2026-09-15", "2027-09-15"], "credential_entered");
  const c3 = await audited("manager overrides", "mgrX", CRED, [GX1, ichat, "2026-09-15", "2027-08-31"], "credential_overridden");
  const c4 = await call("hrX", CRED, [GX1, ichat, "2026-09-20", "2027-09-20"]);
  const cert = (await q(`SELECT count(*) OVER () n, entered_by, overridden_by, is_verified, jsonb_array_length(change_history) h, expiry_date::text e FROM caregiver_certifications WHERE caregiver_id=$1`, [GX1]))[0];
  rec("H6 credential: hr enters, renews in place, manager overrides, hr can't change it after", !c1.err && !c2.err && !c3.err && /only a manager/.test(c4.err || "") && Number(cert.n) === 1
    && cert.entered_by === users.hrX && cert.overridden_by === users.mgrX && cert.is_verified === true && cert.h === 2 && cert.e === "2027-08-31",
    `rows ${cert.n}; entered_by hr ${cert.entered_by === users.hrX}; overridden_by mgr ${cert.overridden_by === users.mgrX}; verified ${cert.is_verified}; history ${cert.h}; hr after override: ${c4.err ? "refused" : "accepted"}`);

  const trBefore = await call("hrX", "SELECT record_training_form($1,'ipos_initial'::plan_document_type,'2026-10-01'::date,'Office',$2::jsonb)", [plan, JSON.stringify([{ caregiver_id: GX1, training_date: "2026-10-02" }])]);
  const ins = await audited("in-service", "hrX", "SELECT record_inservice_form($1,$2,$3,$4::date,$5::timestamptz)", [plan, "Fixture CM", users.mgrX, "2026-10-02", "2026-10-02T15:00:00Z"], "inservice_signed");
  const tr = await audited("training record", "hrX", "SELECT record_training_form($1,'ipos_initial'::plan_document_type,'2026-10-01'::date,'Office',$2::jsonb)",
    [plan, JSON.stringify([{ caregiver_id: GX1, training_date: "2026-10-03", training_method: "outside_pcp", trainer_name: "Fixture lead" }])], "training_recorded");
  const trRow = (await q(`SELECT training_version tv FROM plan_training_records WHERE care_plan_id=$1`, [plan]))[0];
  const trY = await call("hrX", "SELECT record_training_form($1,'ipos_initial'::plan_document_type,'2026-10-01'::date,'Office',$2::jsonb)", [plan, JSON.stringify([{ caregiver_id: GY, training_date: "2026-10-03" }])]);
  const ov = await audited("training override", "mgrX", "SELECT override_training_record($1,'2026-10-04'::date,'pcp_meeting'::training_method,'Clin','Lead','2026-10-04'::date)",
    [(await q(`SELECT id FROM plan_training_records WHERE care_plan_id=$1`, [plan]))[0].id], "training_record_overridden");
  const ovHr = await call("hrX", "SELECT override_training_record($1,'2026-10-04'::date,NULL,NULL,NULL,NULL)", [(await q(`SELECT id FROM plan_training_records WHERE care_plan_id=$1`, [plan]))[0].id]);
  rec("H7 in-service then training record at training_version 1", /in-service form .* first/.test(trBefore.err || "") && !ins.err && !tr.err && trRow.tv === 1 && DENY.test(trY.err || "") && !ov.err && DENY.test(ovHr.err || ""),
    `training before in-service: ${trBefore.err ? "refused" : "accepted"}; in-service ${ins.err || "ok"}; training ${tr.err || "ok"} at tv ${trRow.tv}; caregiver of office Y by office-X hr: ${trY.err ? "refused" : "accepted"}; manager override ${ov.err || "ok"}; hr override: ${ovHr.err ? "refused" : "accepted"}`);

  // ======================= training_version =======================
  const rn = await audited("renew (identical goals)", "mgrX", "SELECT renew_care_plan($1)", [plan], "care_plan_renewed");
  const plan2 = rn.v;
  const st = await q(`SELECT id, status, training_version tv FROM care_plans WHERE client_id=$1 ORDER BY version`, [CX]);
  const sameTree = JSON.stringify((await q(`SELECT cp_goal_tree($1) t`, [plan]))[0].t) === JSON.stringify((await q(`SELECT cp_goal_tree($1) t`, [plan2]))[0].t);
  const copiedMeasures = Number((await q(`SELECT count(*)::int n FROM objective_measures m JOIN care_plan_objectives o ON o.id=m.objective_id JOIN care_plan_goals g ON g.id=o.goal_id WHERE g.care_plan_id=$1`, [plan2]))[0].n);
  await audited("narrative edit", "mgrX", "SELECT update_care_plan_fields($1,NULL,$2::jsonb)", [plan2, JSON.stringify({ hopes: "Edited narrative", abd_type: "Non-Medicaid" })], "care_plan_updated");
  const obj2 = (await q(`SELECT o.id FROM care_plan_objectives o JOIN care_plan_goals g ON g.id=o.goal_id WHERE g.care_plan_id=$1 AND o.responsible_party='this_agency' ORDER BY g.seq, o.seq LIMIT 1`, [plan2]))[0].id;
  await audited("measures edit", "mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [obj2, JSON.stringify([{ measure_type_id: yesno, prompt_text: "Changed question" }])], "objective_measures_set");
  const tvAfterEdits = (await q(`SELECT training_version tv FROM care_plans WHERE id=$1`, [plan2]))[0].tv;
  await call("hrX", "SELECT record_inservice_form($1,'Fixture CM',$2,'2026-10-05'::date,'2026-10-05T15:00:00Z'::timestamptz)", [plan2, users.mgrX]);
  const tree2 = await q(`SELECT g.id gid, g.seq, g.goal_text, o.id oid, o.letter, o.seq oseq, o.objective_text, o.staff_instructions, o.service_type, o.responsible_party FROM care_plan_goals g JOIN care_plan_objectives o ON o.goal_id=g.id WHERE g.care_plan_id=$1 ORDER BY g.seq, o.seq`, [plan2]);
  const goals2 = [1, 2].map((s) => { const gs = tree2.filter((r) => r.seq === s); return { id: gs[0].gid, seq: s, goal_text: gs[0].goal_text,
    objectives: gs.map((r) => ({ id: r.oid, letter: r.letter, seq: r.oseq, objective_text: r.objective_text, staff_instructions: r.staff_instructions, service_type: r.service_type, responsible_party: r.responsible_party })) }; });
  const noop = await audited("goals no-op save", "mgrX", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan2, JSON.stringify(goals2)], null);
  goals2[0].objectives[0].staff_instructions = "Changed instructions";
  const bump = await audited("goals change after training", "mgrX", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan2, JSON.stringify(goals2)], "training_version_bumped");
  rec("TV1 renewal with identical goals -> 2; narrative + measures edits keep 2; goal change after training -> 3",
    st.length === 2 && st[0].status === "superseded" && st[1].status === "active" && st[1].tv === 2 && sameTree && copiedMeasures === 2 && tvAfterEdits === 2
      && noop.v && noop.v.changed === false && bump.v && bump.v.training_version === 3,
    `renewal tv ${st[1] && st[1].tv} (old ${st[0] && st[0].status}); goals copied identical ${sameTree}; measures copied ${copiedMeasures}; after narrative+measures ${tvAfterEdits}; no-op save changed=${noop.v && noop.v.changed}; Instructions change -> ${bump.v && bump.v.training_version}`);

  // ======================= templates =======================
  const pubVer = (await q(`SELECT id FROM form_template_versions WHERE template_id=$1 AND is_current`, [iposTpl]))[0].id;
  let imm1, imm2; try { await db.exec(`UPDATE form_template_versions SET sections='[{"x":1}]' WHERE id='${pubVer}'`); imm1 = "changed"; } catch (e) { imm1 = e.message; }
  try { await db.exec(`UPDATE form_template_fields SET label='Hacked' WHERE template_version_id='${pubVer}'`); imm2 = "changed"; } catch (e) { imm2 = e.message; }
  const v2draft = await call("mgrX", SAVE, [iposTpl, null, null, null, null, null, "[]", null, JSON.stringify(ipos([{ field_key: "strengths", label: "Strengths", field_type: "longtext", storage: "field_value" }]).map((f) => f.field_key === "hopes" ? { ...f, label: "Hopes & dreams (relabeled)" } : f))]);
  const curAfterDraft = (await q(`SELECT id FROM form_template_versions WHERE template_id=$1 AND is_current`, [iposTpl]))[0].id;
  const v2drop = await call("mgrX", SAVE, [iposTpl, null, null, null, null, null, "[]", null, JSON.stringify(ipos().filter((f) => f.field_key !== "expiration_date"))]);
  const v2addSpine = await call("mgrX", SAVE, [iposTpl, null, null, null, null, null, "[]", null, JSON.stringify(ipos([{ field_key: "michicans", label: "MichiCANS date", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "michicans_date" }]))]);
  const newShellNoSpine = await call("mgrX", SAVE, [null, OX, "authorization", "Auth shell", null, null, "[]", null, JSON.stringify([{ field_key: "units", label: "Units", field_type: "units", storage: "spine_column", writes_to_entity: "service_authorization", writes_to_column: "units_authorized" }])]);
  const authTpl = newShellNoSpine.v && (await q(`SELECT template_id FROM form_template_versions WHERE id=$1`, [newShellNoSpine.v]))[0].template_id;
  const pubNoSpine = await call("mgrX", "SELECT publish_template_version($1)", [authTpl]);
  const badChild = await call("mgrX", SAVE, [null, OX, "authorization", "Bad", null, null, "[]", null, JSON.stringify([{ field_key: "lines", label: "Lines", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_goal" }])]);
  rec("T1 published version immutable; drafts don't touch it; Q13 constrained edits",
    /cannot be changed/.test(imm1) && /cannot be changed/.test(imm2) && !v2draft.err && curAfterDraft === pubVer && /fixed/.test(v2drop.err || "") && /fixed/.test(v2addSpine.err || "") && /not an allowed child-row/.test(badChild.err || ""),
    `update published version: ${/cannot/.test(imm1) ? "refused" : imm1}; edit its fields: ${/cannot/.test(imm2) ? "refused" : imm2}; relabel + add narrative draft: ${v2draft.err || "ok"} (current unchanged ${curAfterDraft === pubVer}); drop spine: ${v2drop.err ? "refused" : "accepted"}; add spine: ${v2addSpine.err ? "refused" : "accepted"}; new child structure: ${badChild.err ? "refused" : "accepted"}`);
  rec("T2 a version dropping a required spine column can't be published", /required spine fields/.test(pubNoSpine.err || ""), pubNoSpine.err || "accepted");

  const pubV2 = await call("mgrX", "SELECT publish_template_version($1)", [iposTpl]);
  const up = await audited("upgrade instance", "mgrX", "SELECT upgrade_instance_template('care_plans',$1,$2::jsonb)", [plan2, JSON.stringify({ strengths: "Fixture strengths" })], "instance_template_upgraded");
  const plan2row = (await q(`SELECT template_version tv, field_values fv FROM care_plans WHERE id=$1`, [plan2]))[0];
  const oldPlanTv = (await q(`SELECT template_version tv FROM care_plans WHERE id=$1`, [plan]))[0].tv;
  rec("T3 publish v2 + explicit upgrade; old instance stays on v1", !pubV2.err && !up.err && up.v.to_version === 2 && plan2row.tv === 2 && plan2row.fv.strengths === "Fixture strengths" && oldPlanTv === 1,
    `publish v2 ${pubV2.err || "ok"}; upgrade ${JSON.stringify(up.v || up.err)}; superseded plan still on v${oldPlanTv}`);

  const dW = await call("aaA", SAVE, [null, null, "ipos", "IPOS (agency-wide)", null, null, "[]", null, JSON.stringify(ipos())]);
  const wTpl = (await q(`SELECT template_id FROM form_template_versions WHERE id=$1`, [dW.v]))[0].template_id;
  await call("aaA", "SELECT publish_template_version($1)", [wTpl]);
  const mgrAgencyWide = await call("mgrX", SAVE, [null, null, "ipos", "Manager agency-wide", null, null, "[]", null, JSON.stringify(ipos())]);
  const cpY = await call("mgrY", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CY, header, JSON.stringify({ hopes: "Y narrative" })]);
  const yTpl = (await q(`SELECT template_id t FROM care_plans WHERE id=$1`, [cpY.v]))[0].t;
  const xTplUsed = (await q(`SELECT template_id t FROM care_plans WHERE id=$1`, [plan]))[0].t;
  rec("T4 office shell wins over agency-wide (Q15); manager can't author agency-wide shells", !dW.err && yTpl === wTpl && xTplUsed === iposTpl && DENY.test(mgrAgencyWide.err || ""),
    `office X plan uses office shell ${xTplUsed === iposTpl}; office Y (no own shell) uses agency-wide ${yTpl === wTpl}; manager agency-wide draft: ${mgrAgencyWide.err ? "refused" : "accepted"}`);

  const fvTests = { unknown: { hopes: "x", zzz: 1 }, wrongType: { hopes: 5 }, badOption: { hopes: "x", abd_type: "Other" }, missingRequired: { abd_type: "Medicaid" }, tooLong: { hopes: "x".repeat(20001) } };
  const fvRes = {};
  for (const [k, v] of Object.entries(fvTests)) { const r = await call("mgrX", "SELECT update_care_plan_fields($1,NULL,$2::jsonb)", [plan2, JSON.stringify(v)]); fvRes[k] = r.err ? "rejected" : "accepted"; }
  rec("T5 field_values must match the snapshot", Object.values(fvRes).every((x) => x === "rejected"), JSON.stringify(fvRes));

  // ======================= role / scope denials =======================
  const calls = {
    seed_defaults: ["SELECT seed_office_care_plan_defaults($1)", [OX]],
    save_template_draft: [SAVE, [null, OX, "ipos", "Denied", null, null, "[]", null, JSON.stringify(ipos())]],
    publish_template_version: ["SELECT publish_template_version($1)", [iposTpl]],
    upgrade_instance_template: ["SELECT upgrade_instance_template('care_plans',$1)", [plan2]],
    create_care_plan: ["SELECT create_care_plan($1,'initial',$2::jsonb)", [CX, header]],
    renew_care_plan: ["SELECT renew_care_plan($1)", [plan2]],
    update_care_plan_fields: ["SELECT update_care_plan_fields($1,$2::jsonb)", [plan2, JSON.stringify({ recorder_name: "x" })]],
    upsert_care_plan_goals: ["SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan2, "[]"]],
    set_objective_measures: ["SELECT set_objective_measures($1,$2::jsonb)", [obj2, "[]"]],
    create_service_authorization: [AUTH, [CX, "cls", "AUTH-DENY", 5, "2026-10-01", "2026-12-31"]],
    upsert_client_document: [DOC, [CX, "consent", "complete", null]],
    enter_caregiver_credential: [CRED, [GX2, ichat, "2026-09-01", "2027-09-01"]],
    record_inservice_form: ["SELECT record_inservice_form($1,'CM',$2,'2026-10-02'::date,'2026-10-02T15:00:00Z'::timestamptz)", [plan2, users.mgrX]],
    record_training_form: ["SELECT record_training_form($1,'ipos_initial'::plan_document_type,NULL,NULL,$2::jsonb)", [plan2, JSON.stringify([{ caregiver_id: GX2, training_date: "2026-10-03" }])]],
    override_training_record: ["SELECT override_training_record($1,'2026-10-04'::date,NULL,NULL,NULL,NULL)", [(await q(`SELECT id FROM plan_training_records LIMIT 1`))[0].id]],
  };
  const tier = { clinical: ["upgrade_instance_template", "create_care_plan", "renew_care_plan", "update_care_plan_fields", "upsert_care_plan_goals", "set_objective_measures", "create_service_authorization", "upsert_client_document"],
    training: ["enter_caregiver_credential", "record_inservice_form", "record_training_form"], template: ["save_template_draft", "publish_template_version"] };
  const deniedFor = (fn, who) => {
    if (["cg", "cl", "anon", "mgrY", "aaB"].includes(who)) return true;               // never (other office / other agency / non-staff)
    if (fn === "seed_defaults") return true;                                           // agency_admin only
    if (fn === "override_training_record") return who !== "mgrX";
    if (tier.clinical.includes(fn) || tier.template.includes(fn)) return ["schX", "hrX", "sysA"].includes(who) && !(tier.template.includes(fn) && who === "sysA");
    if (tier.training.includes(fn)) return ["schX", "sysA"].includes(who);
    return true;
  };
  const leaks = []; let checked = 0;
  for (const [fn, [sql, params]] of Object.entries(calls)) for (const who of ["schX", "hrX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) {
    if (!deniedFor(fn, who)) continue;
    const r = await call(who, sql, params); checked++;
    if (!r.err || !DENY.test(r.err)) leaks.push(`${who}->${fn}: ${r.err ? r.err.slice(0, 50) : "ALLOWED"}`);
  }
  const ghost = await call("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb)", [U(999), header]);
  const otherOffice = await call("mgrY", "SELECT create_care_plan($1,'initial',$2::jsonb)", [CX, header]);
  rec("D1 role/scope denials for every RPC (scheduler, hr on clinical, caregiver, client, anon, office-Y manager, agency-B admin, system_admin on clinical/training)",
    leaks.length === 0 && ghost.err === otherOffice.err, leaks.length ? leaks.join("; ") : `${checked} denied calls, all refused; missing row and other-office row give the same error ("${(ghost.err || "").slice(0, 40)}")`);

  // ======================= audit =======================
  const badAudit = audit.filter((a) => (a.expType ? a.delta !== 1 || a.type !== a.expType : a.delta !== 0) || !a.payloadOk);
  rec("A1 exactly one event per audited write, ids/counts only", badAudit.length === 0,
    badAudit.length ? JSON.stringify(badAudit) : `${audit.length} writes checked: ${audit.filter((a) => a.expType).length} with exactly one matching event, ${audit.filter((a) => !a.expType).length} no-ops with none; every payload value is a uuid, number or boolean`);
  await db.exec(`ALTER TABLE events DROP CONSTRAINT events_event_type_check, ADD CONSTRAINT events_event_type_check CHECK (event_type <> 'care_plan_created') NOT VALID`);
  const plansBefore = Number((await q(`SELECT count(*)::int n FROM care_plans`))[0].n);
  const forced = await call("mgrAll", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CY, header, "{}"]);
  const plansAfter = Number((await q(`SELECT count(*)::int n FROM care_plans`))[0].n);
  await db.exec(fs.readFileSync(MIG + B1[0], "utf8"));
  rec("A2 forced audit failure aborts the write", !!forced.err && plansAfter === plansBefore, `create_care_plan with the event type refused: ${forced.err ? forced.err.slice(0, 60) : "accepted"}; plans ${plansBefore} -> ${plansAfter}`);

  // ======================= owner-requested extra checks =======================
  const dupPlan = await call("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, header, JSON.stringify({ hopes: "x" })]);
  rec("X1 second create_care_plan for a client with an active plan is refused", /already has an active plan/.test(dupPlan.err || ""), dupPlan.err || "accepted");
  const leadY = await call("hrX", "SELECT record_inservice_form($1,'CM',$2,'2026-10-02'::date,'2026-10-02T15:00:00Z'::timestamptz)", [plan2, users.mgrY]);
  const leadSch = await call("hrX", "SELECT record_inservice_form($1,'CM',$2,'2026-10-02'::date,'2026-10-02T15:00:00Z'::timestamptz)", [plan2, users.schX]);
  const leadAll = await call("hrX", "SELECT record_inservice_form($1,'CM',$2,'2026-10-02'::date,'2026-10-02T15:00:00Z'::timestamptz)", [plan2, users.mgrAll]);
  rec("X2 record_inservice_form refuses a program lead who isn't a manager of that office", /program lead/.test(leadY.err || "") && /program lead/.test(leadSch.err || "") && !leadAll.err,
    `office-Y manager: ${leadY.err ? "refused" : "accepted"}; scheduler: ${leadSch.err ? "refused" : "accepted"}; agency-wide manager: ${leadAll.err || "accepted"}`);
  const pBefore = (await q(`SELECT training_version, status, client_id FROM care_plans WHERE id=$1`, [plan2]))[0];
  const xr = {};
  for (const [k, v] of Object.entries({ training_version: 9, status: "expired", client_id: CY })) {
    const r = await call("mgrX", "SELECT update_care_plan_fields($1,$2::jsonb)", [plan2, JSON.stringify({ [k]: v })]); xr[k] = r.err ? "rejected" : "accepted"; }
  const pAfter = (await q(`SELECT training_version, status, client_id FROM care_plans WHERE id=$1`, [plan2]))[0];
  rec("X3 update_care_plan_fields can't change training_version, status or client", Object.values(xr).every((x) => x === "rejected") && JSON.stringify(pBefore) === JSON.stringify(pAfter),
    `${JSON.stringify(xr)}; row unchanged ${JSON.stringify(pBefore) === JSON.stringify(pAfter)}`);

  // ======================= certification table lock-down, grants =======================
  const dIns = await call("mgrX", `INSERT INTO caregiver_certifications (caregiver_id, certification_name, expiry_date) VALUES ('${GX2}','x','2030-01-01')`);
  const dUpd = await call("mgrX", `UPDATE caregiver_certifications SET is_verified = true WHERE caregiver_id='${GX1}'`);
  const sel = await call("mgrX", `SELECT count(*)::int n FROM caregiver_certifications`);
  rec("C1 caregiver_certifications: staff direct writes refused, reads kept", /permission denied/.test(dIns.err || "") && /permission denied/.test(dUpd.err || "") && sel.v === 1,
    `insert: ${dIns.err ? "refused" : "accepted"}; update: ${dUpd.err ? "refused" : "accepted"}; staff read rows ${sel.v}`);
  const fns = await q(`SELECT p.proname, p.prosecdef d, COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default)') g
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.oid > (SELECT max(oid) FROM pg_proc WHERE proname='cp_refresh_authorization_units') ORDER BY 1`);
  const rpcs = ["seed_office_care_plan_defaults", "save_template_draft", "publish_template_version", "upgrade_instance_template", "create_care_plan", "renew_care_plan",
    "update_care_plan_fields", "upsert_care_plan_goals", "set_objective_measures", "create_service_authorization", "upsert_client_document",
    "enter_caregiver_credential", "record_inservice_form", "record_training_form", "override_training_record"];
  const badAcl = fns.filter((f) => f.g === "(default)" || /PUBLIC|anon/.test(f.g) || (rpcs.includes(f.proname) ? !(f.d && /authenticated/.test(f.g)) : /authenticated/.test(f.g)));
  fns.forEach((f) => console.log(`   ${f.proname} definer=${f.d} EXECUTE: ${f.g}`));
  rec("ACL every new function: RPCs definer + authenticated only; internal helpers no API role", badAcl.length === 0 && fns.filter((f) => rpcs.includes(f.proname)).length === 15,
    `${fns.length} new functions (${rpcs.length} RPCs); offending: ${badAcl.map((f) => f.proname).join(", ") || "none"}`);
  console.log("summary: " + rows.map((r) => `${r.id}=${r.ok ? "PASS" : "FAIL"}`).join(" "));
})().catch((e) => { console.log("HARNESS ERROR", e.message); process.exit(1); });

// UI S2/S3 backend additions on PGlite: G3 list_templates_with_usage, W1 measure library
// (upsert / set active / delete), G1 list_credential_expirations, get_caregiver_compliance.
// Usage: node tests/ripple/pglite/ui-s2s3.cjs   (local PGlite, no network)
const path = require("path");
const fs = require("fs");
const { PGlite } = require("@electric-sql/pglite");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/";
const LIVE = __dirname + "/live/";
const EXACT = JSON.parse(fs.readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : fs.readFileSync(LIVE + n + ".sql", "utf8");
// everything through S-OFF-1 + shells, then the two UI migrations (the S1 menu seed is data for menu
// tables PGlite doesn't stub; it is data-only and verified on DEV)
const ALL = fs.readdirSync(MIG).filter((f) => /^202610(0612|0712|0812|0912|1012|1112|1312)/.test(f)).sort();
const PRE = ALL.filter((f) => !/^20261013/.test(f)), NEW = ALL.filter((f) => /^20261013/.test(f));
const A = "56fbfe38-e8eb-40c1-ba27-07428f62ed2e", OX = "12faa863-017e-438c-966c-f67be9b726e7", OY = "56785edd-ce66-4bf0-a487-abb628f21fef";
const B = "bbbbbbbb-0000-0000-0000-000000000001", OZ = "bbbbbbbb-0000-0000-0000-0000000000a1", TZ = "America/New_York";
let seq = 0; const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`; const nid = () => U(8000 + ++seq);
const users = { aaA: U(1), mgrA: U(2), mgrY: U(3), mgrX: U(4), schX: U(5), hrX: U(6), cg: U(7), cl: U(8), aaB: U(9), sysA: U(10) };
const rows = []; const rec = (id, ok, d) => { rows.push({ id, ok }); console.log(`${id} ${ok ? "PASS" : "FAIL"} :: ${d}`); };
const DENY = /Not found or not allowed|permission denied/;

(async () => {
  const db = new PGlite();
  for (const f of ["stub.sql", "live_helpers.sql", "stub_b1.sql", "stub_b2.sql", "stub_c.sql", "stub_d.sql", "stub_soff.sql", "stub_ui.sql"]) await db.exec(fs.readFileSync(path.join(__dirname, f), "utf8"));
  await db.exec(fs.readFileSync(LIVE + "assignment_machinery.sql", "utf8"));
  for (const f of ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "check_caregiver_shifts_eligibility", "assign_caregiver_to_shift",
    "caregiver_pick_up_shift", "caregiver_pickup_trade_shift", "release_shift_assignments", "compute_earnings_for_time_entry"]) await db.exec(liveDef(f) + ";");
  await db.exec(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    INSERT INTO agency (id, agency_name) VALUES ('${A}','A'),('${B}','B');
    INSERT INTO virtual_office (id, agency_id, name, timezone) VALUES ('${OX}','${A}','X','${TZ}'),('${OY}','${A}','Y','${TZ}'),('${OZ}','${B}','Z','${TZ}');
    INSERT INTO care_types (code, name) VALUES ('CLS0001','CLS'),('RESP0001','Respite');`);
  for (const f of PRE) { try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { console.log("APPLY FAILED", f, e.message); process.exit(1); } }
  for (const f of NEW) { try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { console.log("APPLY FAILED", f, e.message); process.exit(1); } }
  console.log(`applied ${PRE.length} files, then ${NEW.join(", ")}`);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const day = async (n) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [n]))[0].d;
  await db.exec(`
    INSERT INTO profiles (id, agency_id, virtual_office_id, office_restricted, full_name) VALUES
      ('${users.aaA}','${A}',NULL,false,'Admin A'),('${users.mgrA}','${A}',NULL,false,'Manager All'),('${users.mgrY}','${A}','${OY}',true,'Manager Y'),
      ('${users.mgrX}','${A}','${OX}',true,'Manager X'),('${users.schX}','${A}','${OX}',true,'Scheduler X'),('${users.hrX}','${A}','${OX}',true,'HR X'),
      ('${users.cg}','${A}','${OX}',false,'CG'),('${users.cl}','${A}',NULL,false,'CL'),('${users.aaB}','${B}',NULL,false,'Admin B'),('${users.sysA}','${A}',NULL,false,'Sys');
    INSERT INTO user_roles (user_id, role, agency_id) VALUES ('${users.aaA}','agency_admin','${A}'),('${users.mgrA}','manager','${A}'),('${users.mgrY}','manager','${A}'),
      ('${users.mgrX}','manager','${A}'),('${users.schX}','scheduler','${A}'),('${users.hrX}','hr_staff','${A}'),('${users.cg}','caregiver','${A}'),
      ('${users.cl}','client','${A}'),('${users.aaB}','agency_admin','${B}'),('${users.sysA}','system_admin','${A}');
    INSERT INTO cp_default_credential_types (name, category, valid_months, required) VALUES
      ('ICHAT','background_check',12,true),('HIPAA','annual_online',12,true),('CPR','in_person_recert',24,true),('First Aid','annual',12,true),('Driver','background_check',12,true),('Optional','annual',12,false);
    INSERT INTO cp_default_service_types (care_type_code, service_type) VALUES ('CLS0001','cls'),('RESP0001','respite');`);
  const call = async (who, sql, params = []) => {
    await db.exec("BEGIN");
    try {
      if (who === "anon") await db.exec("SET LOCAL ROLE anon");
      else { await db.exec("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users[who]]); }
      const r = await db.query(sql, params); await db.exec("COMMIT"); return { v: r.rows[0] && Object.values(r.rows[0])[0], rows: r.rows };
    } catch (e) { await db.exec("ROLLBACK"); return { err: e.message }; }
  };
  const must = async (who, sql, p) => { const r = await call(who, sql, p); if (r.err) throw new Error(`${sql.slice(0, 60)}: ${r.err}`); return r.v; };
  await must("aaA", "SELECT seed_office_care_plan_defaults($1)", [OX]); await must("aaA", "SELECT seed_office_care_plan_defaults($1)", [OY]);
  const G = U(310), CX = U(401);
  await db.query(`INSERT INTO caregivers (id, agency_id, user_id, first_name, virtual_office_id, is_active) VALUES ($1,$2,$3,'Gina',$4,true)`, [G, A, users.cg, OX]);
  await db.query(`UPDATE caregivers SET last_name = 'Test' WHERE id = $1`, [G]);
  await db.query(`INSERT INTO clients (id, agency_id, user_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,$3,'Carla','Fixture',$4)`, [CX, A, users.cl, OX]);

  // ================= S2: G3 list_templates_with_usage =================
  const ipos = (extra = []) => JSON.stringify([
    { field_key: "effective_date", label: "Plan effective", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "effective_date" },
    { field_key: "expiration_date", label: "Plan expires", field_type: "date", storage: "spine_column", writes_to_entity: "care_plan", writes_to_column: "expiration_date" },
    { field_key: "goals", label: "Goals", field_type: "table", storage: "child_rows", writes_to_entity: "care_plan_goal" },
    { field_key: "hopes", label: "Hopes", field_type: "longtext", storage: "field_value" }, ...extra]);
  const SAVE = "SELECT save_template_draft($1,$2,$3::form_template_kind,$4,NULL,NULL,'[]'::jsonb,NULL,$5::jsonb,NULL)";
  const verTpl = async (v) => (await q(`SELECT template_id FROM form_template_versions WHERE id = $1`, [v]))[0].template_id;
  const tOffice = await verTpl(await must("mgrX", SAVE, [null, OX, "ipos", "IPOS X", ipos()])); await must("mgrX", "SELECT publish_template_version($1)", [tOffice]);
  const tAgency = await verTpl(await must("aaA", SAVE, [null, null, "ipos", "IPOS agency", ipos()])); await must("aaA", "SELECT publish_template_version($1)", [tAgency]);
  const tY = await verTpl(await must("mgrY", SAVE, [null, OY, "ipos", "IPOS Y", ipos()])); await must("mgrY", "SELECT publish_template_version($1)", [tY]);
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb)", [CX, JSON.stringify({ effective_date: await day(-60), expiration_date: await day(300) })]);
  await must("mgrX", SAVE, [tOffice, null, null, null, ipos([{ field_key: "strengths", label: "Strengths", field_type: "longtext", storage: "field_value" }])]);
  const withDraft = (await call("mgrX", "SELECT list_templates_with_usage($1)", [OX])).v;
  await must("mgrX", "SELECT publish_template_version($1)", [tOffice]);
  const list = (await call("mgrX", "SELECT list_templates_with_usage($1)", [OX])).v;
  const off = list.find((t) => t.template_id === tOffice), ag = list.find((t) => t.template_id === tAgency);
  const planV = (await q(`SELECT template_version FROM care_plans WHERE id = $1`, [plan]))[0].template_version;
  rec("G3-a an office-restricted manager lists its office's shells and the agency-wide ones (not another office's)",
    !!off && !!ag && !list.some((t) => t.template_id === tY) && off.scope === "office" && ag.scope === "agency", `${list.length} shells: ${list.map((t) => `${t.name}(${t.scope})`).join(", ")}`);
  rec("G3-b can_edit: office shell yes, agency-wide shell no (agency_admin only); the agency admin may edit both",
    off.can_edit === true && ag.can_edit === false && (await call("aaA", "SELECT list_templates_with_usage($1)", [OX])).v.every((t) => t.can_edit === true),
    `manager: office ${off.can_edit}, agency ${ag.can_edit}`);
  const offDraft = withDraft.find((t) => t.template_id === tOffice);
  rec("G3-c versions, draft, last published by/when, usage per version (publishing v2 leaves the existing plan on v1)",
    offDraft.draft_version === 2 && offDraft.current_version === 1 && off.current_version === 2 && off.draft_version === null && planV === 1
      && off.versions[0].version === 2 && off.versions[0].usage === 0 && off.versions[1].usage === 1 && off.versions[0].published_by === "Manager X" && !!off.versions[0].published_at,
    `before publish: current v${offDraft.current_version}, draft v${offDraft.draft_version}; after: current v${off.current_version}, usage ${off.versions.map((v) => `v${v.version}=${v.usage}`).join(" ")}, by ${off.versions[0].published_by}; plan on v${planV}`);
  const spine = await call("mgrX", SAVE, [tOffice, null, null, null, JSON.stringify(JSON.parse(ipos()).map((f) => f.field_key === "effective_date" ? { ...f, writes_to_column: "meeting_date" } : f))]);
  const agencyEdit = await call("mgrX", SAVE, [tAgency, null, null, null, ipos([{ field_key: "x", label: "X", field_type: "text", storage: "field_value" }])]);
  rec("G3-d a spine field can't be changed (RPC refuses); an office manager can't draft an agency-wide shell",
    /Spine and child-row fields are fixed/.test(spine.err || "") && DENY.test(agencyEdit.err || ""), `spine "${(spine.err || "accepted").slice(0, 60)}"; agency-wide "${agencyEdit.err || "accepted"}"`);
  const leaks = []; let n = 0;
  for (const w of ["schX", "hrX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) { const r = await call(w, "SELECT list_templates_with_usage($1)", [OX]); n++; if (!r.err || !DENY.test(r.err)) leaks.push(`${w}: ${r.err || "ALLOWED"}`); }
  rec("G3-e scheduler, hr_staff, caregiver, client, anon, other-office manager, agency-B admin, system_admin refused", leaks.length === 0, leaks.join("; ") || `${n} refused`);

  // ================= S2: W1 measure library =================
  const UPS = "SELECT upsert_measure_type($1,$2::measure_kind,$3,$4::jsonb)";
  const mt = await must("mgrX", UPS, [null, "prompt_level", "ZZ Mood scale", JSON.stringify(["Calm", "Upset"])]);
  const ob = (await q(`SELECT o.id FROM care_plan_objectives o JOIN care_plan_goals g ON g.id = o.goal_id WHERE g.care_plan_id = $1 LIMIT 1`, [plan]))[0];
  await must("mgrX", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan, JSON.stringify([{ seq: 1, goal_text: "g", objectives: [{ seq: 1, objective_text: "o", service_type: "cls", responsible_party: "this_agency" }] }])]);
  const obj = (await q(`SELECT o.id FROM care_plan_objectives o JOIN care_plan_goals g ON g.id = o.goal_id WHERE g.care_plan_id = $1 LIMIT 1`, [plan]))[0].id;
  const useIt = await call("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [obj, JSON.stringify([{ measure_type_id: mt, prompt_text: "How was the mood?" }])]);
  rec("W1-a a new agency measure type can be used by set_objective_measures", !useIt.err, useIt.err || "accepted");
  const delUsed = await call("mgrX", "SELECT delete_measure_type($1)", [mt]);
  const kindUsed = await call("mgrX", UPS, [mt, "tally", "ZZ Mood scale", null]);
  const deact = await call("mgrX", "SELECT set_measure_type_active($1,false)", [mt]);
  const useInactive = await call("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [obj, JSON.stringify([{ measure_type_id: mt, prompt_text: "again" }])]);
  rec("W1-b a used type can't be deleted or change kind, but can be deactivated (then it isn't offered for new measures)",
    /in use; deactivate it instead/.test(delUsed.err || "") && /in use, so its kind/.test(kindUsed.err || "") && !deact.err && !!useInactive.err,
    `delete "${(delUsed.err || "accepted").slice(0, 50)}"; kind "${(kindUsed.err || "accepted").slice(0, 40)}"; deactivate ${deact.err || "ok"}; reuse inactive ${useInactive.err ? "refused" : "ACCEPTED"}`);
  const unused = await must("mgrA", UPS, [null, "tally", "ZZ Unused tally", null]);
  const delUnused = await call("mgrA", "SELECT delete_measure_type($1)", [unused]);
  const sysId = (await q(`SELECT id FROM measure_types WHERE agency_id IS NULL LIMIT 1`))[0].id;
  const sysEdit = await call("aaA", UPS, [sysId, null, "Hacked", null]), sysDel = await call("aaA", "SELECT delete_measure_type($1)", [sysId]);
  const dup = await call("mgrX", UPS, [null, "tally", "zz mood SCALE", null]);
  const dupSys = await call("mgrX", UPS, [null, "tally", "Frequency tally", null]);
  rec("W1-c an unused type can be deleted; the 8 system types are read-only; labels are unique (case-insensitive, incl. system labels)",
    !delUnused.err && (await q(`SELECT count(*)::int n FROM measure_types WHERE id = $1`, [unused]))[0].n === 0 && DENY.test(sysEdit.err || "") && DENY.test(sysDel.err || "")
      && /already exists/.test(dup.err || "") && /already exists/.test(dupSys.err || "") && (await q(`SELECT count(*)::int n FROM measure_types WHERE agency_id IS NULL`))[0].n === 8,
    `delete unused ${delUnused.err || "ok"}; system edit "${sysEdit.err}"; system delete "${sysDel.err}"; duplicate "${(dup.err || "accepted").slice(0, 40)}"`);
  const wl = []; let wn = 0;
  for (const w of ["schX", "hrX", "cg", "cl", "anon", "sysA"]) { const r = await call(w, UPS, [null, "tally", `ZZ by ${w}`, null]); wn++; if (!r.err || !DENY.test(r.err)) wl.push(`${w} create: ${r.err || "ALLOWED"}`); }
  for (const w of ["aaB", "schX", "hrX"]) { const r = await call(w, "SELECT set_measure_type_active($1,true)", [mt]); wn++; if (!r.err || !DENY.test(r.err)) wl.push(`${w} activate: ${r.err || "ALLOWED"}`); }
  rec("W1-d scheduler, hr_staff, caregiver, client, anon, system_admin can't create; agency-B admin, scheduler, hr_staff can't change agency A's types", wl.length === 0, wl.join("; ") || `${wn} refused`);

  // ================= S3: G1 + compliance read =================
  const types = await q(`SELECT id, name FROM credential_types WHERE agency_id = $1 AND is_active ORDER BY name`, [A]);
  const byName = Object.fromEntries(types.map((t) => [t.name, t.id]));
  const ENTER = "SELECT enter_caregiver_credential($1,$2,$3::date,$4::date)";
  // CPR +61 (not listed), First Aid +60 (yellow), HIPAA +30 (red), ICHAT +29 (red), Driver 0 (red); Optional -1 (overdue)
  for (const [nm, off] of [["CPR", 61], ["First Aid", 60], ["HIPAA", 30], ["ICHAT", 29], ["Driver", 0], ["Optional", -1]]) await must("hrX", ENTER, [G, byName[nm], await day(-300), await day(off)]);
  const G2 = U(311); await db.query(`INSERT INTO caregivers (id, agency_id, first_name, virtual_office_id, is_active) VALUES ($1,$2,'Nobody',$3,true)`, [G2, A, OX]);
  const ex = (await call("hrX", "SELECT list_credential_expirations($1,60)", [OX])).v;
  const b = (nm, cg = G) => (ex.find((r) => r.caregiver_id === cg && r.credential_type === nm) || {}).band;
  rec("G1-a bands at 61/60/30/29/0/-1 days: 61 not listed, 60 yellow, 30 red, 29 red, 0 red, -1 overdue; required types with no record are 'missing' (optional ones are not)",
    b("CPR") === undefined && b("First Aid") === "yellow" && b("HIPAA") === "red" && b("ICHAT") === "red" && b("Driver") === "red" && b("Optional") === "overdue"
      && ["CPR", "First Aid", "HIPAA", "ICHAT", "Driver"].every((nm) => b(nm, G2) === "missing") && b("Optional", G2) === undefined,
    `G: ${["CPR", "First Aid", "HIPAA", "ICHAT", "Driver", "Optional"].map((nm) => `${nm}=${b(nm) || "-"}`).join(" ")}; no-record caregiver: ${ex.filter((r) => r.caregiver_id === G2).length} missing`);
  const gl = []; let gn = 0;
  for (const w of ["schX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) { const r = await call(w, "SELECT list_credential_expirations($1,60)", [OX]); gn++; if (!r.err || !DENY.test(r.err)) gl.push(`${w}: ${r.err || "ALLOWED"}`); }
  const okRoles = []; for (const w of ["mgrX", "mgrA", "aaA", "hrX"]) okRoles.push(!(await call(w, "SELECT list_credential_expirations($1,60)", [OX])).err);
  rec("G1-b manager, agency_admin, hr_staff (office X) allowed; scheduler, caregiver, client, anon, other-office manager, agency-B admin, system_admin refused",
    gl.length === 0 && okRoles.every(Boolean), `${gl.join("; ") || `${gn} refused`}; allowed ${JSON.stringify(okRoles)}`);
  // override: a manager renews ICHAT (overrides HR) -> HR can no longer change it
  await must("mgrX", ENTER, [G, byName.ICHAT, await day(-10), await day(355)]);
  const hrAfter = await call("hrX", ENTER, [G, byName.ICHAT, await day(-10), await day(300)]);
  const comp = (await call("hrX", "SELECT get_caregiver_compliance($1)", [G])).v;
  const ich = comp.credentials.find((c) => c.name === "ICHAT"), hip = comp.credentials.find((c) => c.name === "HIPAA");
  rec("C-a the compliance read shows every active type with entered by / overridden by / history; after a manager override HR is locked out (RPC refuses)",
    comp.credentials.length === types.length && ich.overridden_by === "Manager X" && ich.locked_for_hr === true && ich.history.length === 1 && ich.history[0].override === true
      && hip.entered_by === "HR X" && hip.locked_for_hr === false && /only a manager can change it/.test(hrAfter.err || ""),
    `${comp.credentials.length} types; ICHAT overridden by ${ich.overridden_by}, history ${ich.history.length}, locked ${ich.locked_for_hr}; HR retry "${(hrAfter.err || "ACCEPTED").slice(0, 60)}"`);
  // per-client training: v1 -> renewal -> needs retraining (hr never reads care plans)
  await must("hrX", "SELECT record_inservice_form($1,'CM',$2,$3::date,now())", [plan, users.mgrX, await day(-1)]);
  await must("hrX", "SELECT record_training_form($1,'ipos_initial'::plan_document_type,NULL,NULL,$2::jsonb)", [plan, JSON.stringify([{ caregiver_id: G, training_date: await day(-1) }])]);
  const t1 = (await call("hrX", "SELECT get_caregiver_compliance($1)", [G])).v.training[0];
  await must("mgrX", "SELECT renew_care_plan($1)", [plan]);
  const t2 = (await call("hrX", "SELECT get_caregiver_compliance($1)", [G])).v.training[0];
  const hrPlans = await call("hrX", "SELECT count(*)::int FROM care_plans");
  rec("C-b per-client training: trained at the current version -> fine; after a renewal -> needs retraining (current v2, trained v1); client shown as first name + initial; hr_staff reads no care plans",
    t1.needs_retraining === false && t1.current_version === t1.trained_version && t2.needs_retraining === true && t2.current_version === 2 && t2.trained_version === 1 && t2.client_name === "Carla F." && hrPlans.v === 0,
    `before renewal ${JSON.stringify({ c: t1.current_version, t: t1.trained_version, n: t1.needs_retraining })}; after ${JSON.stringify({ c: t2.current_version, t: t2.trained_version, n: t2.needs_retraining, name: t2.client_name })}; hr care_plans rows ${hrPlans.v}`);
  const cl2 = []; let cn = 0;
  for (const w of ["schX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) { const r = await call(w, "SELECT get_caregiver_compliance($1)", [G]); cn++; if (!r.err || !DENY.test(r.err)) cl2.push(`${w}: ${r.err || "ALLOWED"}`); }
  rec("C-c the compliance read is refused for scheduler, caregiver, client, anon, other-office manager, agency-B admin, system_admin", cl2.length === 0, cl2.join("; ") || `${cn} refused`);

  // ================= ACL =================
  const acl = await q(`SELECT p.proname, p.prosecdef d, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.proname = ANY($1) ORDER BY 1`,
    [["list_templates_with_usage", "upsert_measure_type", "set_measure_type_active", "delete_measure_type", "cp_require_agency_measure_type", "list_credential_expirations", "get_caregiver_compliance"]]);
  const bad = acl.filter((f) => /(^|[{,])=X|anon=X/.test(f.acl) || (f.proname.startsWith("cp_") ? (f.d || /authenticated=X/.test(f.acl)) : !(f.d && /authenticated=X/.test(f.acl))));
  rec("ACL 6 RPCs SECURITY DEFINER + authenticated, no PUBLIC/anon; the internal helper has no API role", acl.length === 7 && bad.length === 0,
    acl.map((f) => `${f.proname} definer=${f.d}`).join("; ") + (bad.length ? ` OFFENDING ${bad.map((f) => f.proname)}` : ""));
  console.log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
})().catch((e) => { console.log("HARNESS ERROR", e.message); process.exit(1); });

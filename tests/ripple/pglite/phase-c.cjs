// Phase C on PGlite: eligibility changes over the LIVE scheduling functions (verbatim definitions in live/) + A/B1/B2.
// Usage: node tests/ripple/pglite/phase-c.cjs   (local PGlite, no network)
const path = require("path");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/", ROLLBACK = path.resolve(__dirname, "../../../docs/rollback") + "/";
const LIVE = __dirname + "/live/";
// live definitions: .sql snapshots, except those stored on DEV with carriage returns (kept exact in JSON)
const EXACT = JSON.parse(require("fs").readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : require("fs").readFileSync(LIVE + n + ".sql", "utf8");
// Local (PGlite) test of Phase C on top of the LIVE scheduling machinery (verbatim live function
// bodies) + Phase A/B1/B2. Baseline taken BEFORE Phase C is applied, compared after. No remote DB.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const ALL = fs.readdirSync(MIG).filter((f) => /^2026100(612|712|812|912)/.test(f)).sort();
const PRE = ALL.filter((f) => !/^20261009/.test(f)), PC = ALL.filter((f) => /^20261009/.test(f));
const A = "56fbfe38-e8eb-40c1-ba27-07428f62ed2e", OR = "12faa863-017e-438c-966c-f67be9b726e7", OK_ = "56785edd-ce66-4bf0-a487-abb628f21fef";
const B = "bbbbbbbb-0000-0000-0000-000000000001", OZ = "bbbbbbbb-0000-0000-0000-0000000000a1", TZ = "America/New_York";
let seq = 0; const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`; const nid = () => U(5000 + ++seq);
const users = { aaA: U(1), mgrA: U(2), mgrY: U(3), schR: U(4), hrR: U(5), cgGood: U(6), cl: U(7), aaB: U(8), sysA: U(9), cgBad: U(10) };
const rows = []; const rec = (id, ok, d) => { rows.push({ id, ok }); console.log(`${id} ${ok ? "PASS" : "FAIL"} :: ${d}`); };
const DENY = /Not found or not allowed|permission denied/;

(async () => {
  const db = new PGlite();
  for (const f of ["stub.sql", "live_helpers.sql", "stub_b1.sql", "stub_b2.sql", "stub_c.sql"]) await db.exec(fs.readFileSync(__dirname + "/" + f, "utf8"));
  await db.exec(fs.readFileSync(LIVE + "assignment_machinery.sql", "utf8"));
  for (const f of ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "check_caregiver_shifts_eligibility", "assign_caregiver_to_shift", "caregiver_pick_up_shift", "caregiver_pickup_trade_shift", "release_shift_assignments"])
    await db.exec(liveDef(f) + ";");
  await db.exec(`
    CREATE TRIGGER trg_enforce_derived_shift_caregiver BEFORE INSERT OR UPDATE OF caregiver_id ON public.shifts FOR EACH ROW EXECUTE FUNCTION enforce_derived_shift_caregiver();
    CREATE TRIGGER trg_protect_assignment_columns BEFORE INSERT OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION protect_assignment_columns();
    CREATE TRIGGER trg_protect_completed_assignment BEFORE DELETE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION protect_completed_assignment();
    CREATE TRIGGER trg_sync_shift_caregiver AFTER INSERT OR DELETE OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION sync_shift_caregiver_from_assignment();
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    INSERT INTO agency (id, agency_name) VALUES ('${A}','A'),('${B}','B');
    INSERT INTO virtual_office (id, agency_id, name, timezone) VALUES ('${OR}','${A}','Ripple-like','${TZ}'),('${OK_}','${A}','KindCare-like','${TZ}'),('${OZ}','${B}','Z','${TZ}');
    INSERT INTO care_types (code, name) VALUES ('CLS0001','CLS'),('RESP0001','Respite');`);
  for (const f of PRE) { try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { console.log("APPLY FAILED", f, e.message); process.exit(1); } }
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const day = async (n) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [n]))[0].d;
  console.log(`database clock: ${(await q("SELECT now() t"))[0].t.toISOString()} (office day ${await day(0)})`);

  await db.exec(`
    INSERT INTO profiles (id, agency_id, virtual_office_id, office_restricted, full_name) VALUES
      ('${users.aaA}','${A}',NULL,false,'AA'),('${users.mgrA}','${A}',NULL,false,'MA'),('${users.mgrY}','${A}','${OK_}',true,'MY'),
      ('${users.schR}','${A}','${OR}',true,'S'),('${users.hrR}','${A}','${OR}',true,'H'),('${users.cgGood}','${A}','${OR}',false,'CG'),
      ('${users.cgBad}','${A}','${OR}',false,'CB'),('${users.cl}','${A}',NULL,false,'CL'),('${users.aaB}','${B}',NULL,false,'AB'),('${users.sysA}','${A}',NULL,false,'SA');
    INSERT INTO user_roles (user_id, role, agency_id) VALUES ('${users.aaA}','agency_admin','${A}'),('${users.mgrA}','manager','${A}'),('${users.mgrY}','manager','${A}'),
      ('${users.schR}','scheduler','${A}'),('${users.hrR}','hr_staff','${A}'),('${users.cgGood}','caregiver','${A}'),('${users.cgBad}','caregiver','${A}'),
      ('${users.cl}','client','${A}'),('${users.aaB}','agency_admin','${B}'),('${users.sysA}','system_admin','${A}');
    INSERT INTO cp_default_credential_types (name, category, valid_months, required) VALUES ('ICHAT','background_check',12,true),('HIPAA','annual_online',12,true),('Medication','in_person_recert',NULL,false);
    INSERT INTO cp_default_service_types (care_type_code, service_type) VALUES ('CLS0001','cls'),('RESP0001','respite');`);
  const call = async (who, sql, params = []) => {
    await db.exec("BEGIN");
    try {
      if (who === "anon") await db.exec("SET LOCAL ROLE anon");
      else if (who !== "su") { await db.exec("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users[who]]); }
      const r = await db.query(sql, params); await db.exec("COMMIT"); return { rows: r.rows, v: r.rows[0] && Object.values(r.rows[0])[0] };
    } catch (e) { await db.exec("ROLLBACK"); return { err: e.message }; }
  };
  const must = async (who, sql, p) => { const r = await call(who, sql, p); if (r.err) throw new Error(`${sql.slice(0, 60)}: ${r.err}`); return r.v; };
  const cg = async (id, office, user = null) => { await db.query(`INSERT INTO caregivers (id, agency_id, user_id, first_name, virtual_office_id, is_active) VALUES ($1,$2,$3,'G',$4,true)`, [id, A, user, office]);
    await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1,'CLS0001'),($1,'RESP0001')`, [id]); return id; };
  const client = async (id, office) => { await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'C','Fixture',$3)`, [id, A, office]); return id; };
  const shift = async (clientId, office, off, start, end, code = "CLS0001") => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
                    VALUES ($1,$2,$3,$4,$5::date,$6::time,$7::time,$8,'open', extract(epoch FROM ($7::time - $6::time))/3600)`, [id, A, clientId, code, await day(off), start, end, office]); return id; };
  const codes = (j) => j ? `eligible=${j.eligible} hard=[${(j.hard || []).map((x) => x.code).sort()}] soft=[${(j.soft || []).map((x) => x.code).sort()}] adv=[${(j.advisory || []).map((x) => x.code).sort()}]` : "null";
  const elig = async (s, c) => (await call("mgrA", "SELECT check_assignment_eligibility($1,$2)", [s, c])).v;
  const ASSIGN = "SELECT assign_caregiver_to_shift($1,$2,$3::assignment_method,'test',NULL)";

  // ================= no-break baseline BEFORE Phase C =================
  const GKb = await cg(U(301), OK_), GKa = await cg(U(302), OK_), GRb = await cg(U(303), OR), GRa = await cg(U(304), OR);
  const CK = await client(U(401), OK_), CR0 = await client(U(402), OR);
  const nbShifts = { k: await shift(CK, OK_, 3, "09:00", "10:00"), r: await shift(CR0, OR, 3, "09:00", "10:00") };
  const nbAssign = { before: [], after: [] };
  for (const [i, m] of ["manual", "ai_suggested", "auto_assigned"].entries()) { nbAssign.before.push(await shift(CK, OK_, 4 + i, "09:00", "10:00")); nbAssign.after.push(await shift(CK, OK_, 4 + i, "11:00", "12:00")); }
  const snapNB = async (gK, gR, assignShifts) => {
    const o = {};
    o.single_k = codes(await elig(nbShifts.k, gK)); o.single_r = codes(await elig(nbShifts.r, gR));
    o.bulk_k = JSON.stringify((await call("mgrA", "SELECT caregiver_id, result FROM check_assignment_eligibility_bulk($1,$2::uuid[])", [nbShifts.k, `{${gK}}`])).rows.map((r) => codes(r.result)));
    const ms = ["manual", "ai_suggested", "auto_assigned"];
    for (const [i, m] of ms.entries()) { const r = await call("mgrA", ASSIGN, [assignShifts[i], gK, m]); o[`assign_${m}`] = r.err ? `ERR ${r.err}` : `ok overridden=${r.v.overridden} ${codes(r.v.eligibility)}`; }
    return o;
  };
  const before = await snapNB(GKb, GRb, nbAssign.before);
  const aclBefore = Object.fromEntries((await q(`SELECT proname, pg_get_function_identity_arguments(p.oid) a, (SELECT string_agg(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE') g
     FROM pg_proc p WHERE proname IN ('check_assignment_eligibility','check_caregiver_shifts_eligibility','caregiver_pick_up_shift','caregiver_pickup_trade_shift','create_progress_note_for_shift','check_assignment_eligibility_bulk','assign_caregiver_to_shift','review_progress_note','guard_virtual_office_flags','cp_derive_authorization_units') ORDER BY 1`)).map((r) => [r.proname, `${r.a} | ${r.g}`]));

  // ================= apply Phase C =================
  for (const f of PC) { try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { console.log("APPLY FAILED", f, e.message); process.exit(1); } }
  console.log(`applied Phase C: ${PC.join(", ")}`);
  const after = await snapNB(GKa, GRa, nbAssign.after);
  const diff = Object.keys(before).filter((k) => before[k] !== after[k]);
  rec("NB1 no-break: with module/enforcement off on every office, single/bulk eligibility and Manual/Smart(ai_suggested)/Auto assign results are identical to before Phase C",
    diff.length === 0, diff.length ? diff.map((k) => `${k}: ${before[k]} -> ${after[k]}`).join("; ") : JSON.stringify(after));
  const aclAfter = Object.fromEntries((await q(`SELECT proname, pg_get_function_identity_arguments(p.oid) a, (SELECT string_agg(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) x WHERE x.privilege_type='EXECUTE') g
     FROM pg_proc p WHERE proname IN ('check_assignment_eligibility','check_caregiver_shifts_eligibility','caregiver_pick_up_shift','caregiver_pickup_trade_shift','create_progress_note_for_shift','check_assignment_eligibility_bulk','assign_caregiver_to_shift','review_progress_note','guard_virtual_office_flags','cp_derive_authorization_units') ORDER BY 1`)).map((r) => [r.proname, `${r.a} | ${r.g}`]));
  rec("SIG changed functions keep their exact signature and EXECUTE grants (CREATE OR REPLACE, no overloads)", JSON.stringify(aclBefore) === JSON.stringify(aclAfter) && Object.keys(aclAfter).length === 10,
    Object.entries(aclAfter).map(([k, v]) => `${k}(${v})`).join("; "));

  // ================= compliance rules on the Ripple-like office =================
  await must("aaA", "SELECT seed_office_care_plan_defaults($1)", [OR]);
  const stamped = (await q(`SELECT care_plan_module_enabled_at IS NOT NULL AND care_plan_module_enabled_at > now() - interval '1 minute' ok FROM virtual_office WHERE id=$1`, [OR]))[0].ok;
  // the stub has RLS on virtual_office but no policy: mirror the live ones so the admin's UPDATE reaches the row
  await db.exec(`CREATE POLICY "vo_select_stub" ON public.virtual_office FOR SELECT TO authenticated USING (agency_id = current_agency_id());
    CREATE POLICY "vo_update_staff" ON public.virtual_office FOR UPDATE TO authenticated
    USING ((is_agency_staff(auth.uid()) AND agency_id = current_agency_id() AND (NOT is_office_restricted(auth.uid()) OR id = current_virtual_office_id())) OR has_role(auth.uid(), 'system_admin'))
    WITH CHECK ((is_agency_staff(auth.uid()) AND agency_id = current_agency_id() AND (NOT is_office_restricted(auth.uid()) OR id = current_virtual_office_id())) OR has_role(auth.uid(), 'system_admin'));`);
  const reach = await call("aaA", "UPDATE virtual_office SET billing_week_start = billing_week_start WHERE id = $1 RETURNING id", [OR]);
  const handSet = await call("aaA", "UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '1 year' WHERE id = $1 RETURNING id", [OR]);
  rec("GL go-live: turning the module on stamps care_plan_module_enabled_at; nobody signed in (agency admin included) can set it by hand",
    stamped === true && (reach.rows || []).length === 1 && /go-live date is set when the module is turned on/.test(handSet.err || ""),
    `stamped ${stamped}; admin reaches the row (${(reach.rows || []).length}); admin hand-set "${(handSet.err || `accepted, ${(handSet.rows || []).length} row(s)`).slice(0, 70)}"`);
  // fixtures: the module has been live for 90 days, so past shifts in the tests below are after go-live
  const setLive = async (off) => db.exec(`UPDATE virtual_office SET care_plan_module_enabled_at = ((now() AT TIME ZONE '${TZ}')::date + ${off}) AT TIME ZONE '${TZ}' WHERE id = '${OR}'`);
  await setLive(-90);
  await db.exec(`UPDATE virtual_office SET compliance_enforcement_enabled = true WHERE id = '${OR}'`);   // owner action (service role here)
  const GOOD = await cg(U(310), OR, users.cgGood), BADC = await cg(U(311), OR, users.cgBad), UNTR = await cg(U(312), OR);
  const ctypes = (await q(`SELECT id, name FROM credential_types WHERE agency_id=$1 AND required`, [A]));
  for (const g of [GOOD, UNTR]) for (const t of ctypes) await must("hrR", "SELECT enter_caregiver_credential($1,$2,$3::date,$4::date)", [g, t.id, await day(-30), await day(300)]);
  const setupClient = async (id, trained, authUnits, authFrom = -30, authTo = 60) => {
    await client(id, OR);
    const plan = await must("mgrA", "SELECT create_care_plan($1,'initial',$2::jsonb)", [id, JSON.stringify({ effective_date: await day(-60), expiration_date: await day(300) })]);
    await must("mgrA", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan, JSON.stringify([{ seq: 1, goal_text: "g", objectives: [{ seq: 1, objective_text: "o", service_type: "cls", responsible_party: "this_agency" }] }])]);
    await must("hrR", "SELECT record_inservice_form($1,'CM',$2,$3::date,now())", [plan, users.mgrA, await day(-1)]);
    if (trained.length) await must("hrR", "SELECT record_training_form($1,'ipos_initial'::plan_document_type,NULL,NULL,$2::jsonb)", [plan, JSON.stringify(trained.map((g) => ({ caregiver_id: g, training_date: "2026-01-01" })))]);
    let auth = null;
    if (authUnits) auth = await must("mgrA", "SELECT create_service_authorization($1,'cls',$2,$3,$4::date,$5::date)", [id, `AUTH-${id.slice(-4)}`, authUnits, await day(authFrom), await day(authTo)]);
    return { plan, auth };
  };
  const C1 = U(501); const c1 = await setupClient(C1, [GOOD, BADC], 40);
  const T1 = await shift(C1, OR, 3, "09:00", "10:00");
  const hardCodes = async (s, g) => ((await elig(s, g)).hard || []).map((x) => x.code).sort().join(",");
  const okGood = await hardCodes(T1, GOOD), badC = await hardCodes(T1, BADC), untr = await hardCodes(T1, UNTR);
  for (const t of ctypes) await must("hrR", "SELECT enter_caregiver_credential($1,$2,$3::date,$4::date)", [BADC, t.id, await day(-30), await day(300)]);
  const badCFixed = await hardCodes(T1, BADC);
  await must("hrR", "SELECT record_training_form($1,'ipos_initial'::plan_document_type,NULL,NULL,$2::jsonb)", [c1.plan, JSON.stringify([{ caregiver_id: UNTR, training_date: "2026-01-02" }])]);
  const untrFixed = await hardCodes(T1, UNTR);
  rec("R-a/R-b credential and training rules each hard-block on their own and pass when fixed",
    okGood === "" && badC === "credential_missing" && untr === "training_missing" && badCFixed === "" && untrFixed === "",
    `fully compliant: [${okGood}]; missing credentials: [${badC}] -> fixed [${badCFixed}]; untrained: [${untr}] -> trained [${untrFixed}]`);
  const plan2 = await must("mgrA", "SELECT renew_care_plan($1)", [c1.plan]);
  const oldVersion = await hardCodes(T1, GOOD);
  await must("hrR", "SELECT record_inservice_form($1,'CM',$2,$3::date,now())", [plan2, users.mgrA, await day(0)]);
  await must("hrR", "SELECT record_training_form($1,'ipos_annual'::plan_document_type,NULL,NULL,$2::jsonb)", [plan2, JSON.stringify([{ caregiver_id: GOOD, training_date: "2026-01-03" }])]);
  const retrained = await hardCodes(T1, GOOD);
  rec("R-b trained on an OLD plan version is blocked; retrained on the current version passes", oldVersion === "training_missing" && retrained === "", `after renewal (tv 2): [${oldVersion}]; after retraining: [${retrained}]`);
  const C2 = U(502); await setupClient(C2, [GOOD], null);
  const C3 = U(503); await setupClient(C3, [GOOD], 40, -90, -10);
  const noAuth = await hardCodes(await shift(C2, OR, 3, "11:00", "12:00"), GOOD), expired = await hardCodes(await shift(C3, OR, 3, "13:00", "14:00"), GOOD);
  rec("R-c no authorization / expired authorization each hard-block on their own", noAuth === "authorization_missing" && expired === "authorization_expired", `no auth: [${noAuth}]; expired: [${expired}]`);

  // ================= projected units =================
  const C4 = U(504); const c4 = await setupClient(C4, [GOOD, BADC], 6);
  const F1 = await shift(C4, OR, 5, "09:00", "10:00"), F2 = await shift(C4, OR, 6, "09:00", "10:00");
  const a1 = await call("mgrA", ASSIGN, [F1, GOOD, "manual"]);
  const f2Blocked = await hardCodes(F2, GOOD);
  const f2Detail = ((await elig(F2, GOOD)).hard || []).find((x) => x.code === "units_short");
  const RELEASE = "SELECT release_shift_assignments($1::uuid[], 'test cancel')";
  await must("mgrA", RELEASE, [`{${F1}}`]);   // the real cancel path
  const f2AfterCancel = await hardCodes(F2, GOOD);
  rec("U-c two future 4-unit shifts against 6 units: the first assigns, the second is blocked (projected 2 < 4); cancelling the first frees the units",
    !a1.err && f2Blocked === "units_short" && f2AfterCancel === "" && /needs 4 units; 2 projected/.test(f2Detail && f2Detail.detail),
    `assign F1 ${a1.err || "ok"}; F2 [${f2Blocked}] "${f2Detail && f2Detail.detail}"; after cancelling F1: [${f2AfterCancel}]`);
  const C5 = U(505); const c5 = await setupClient(C5, [GOOD], 10);
  const P = await shift(C5, OR, -1, "09:00", "10:00"); await must("mgrA", ASSIGN, [P, GOOD, "manual"]);
  const pn = await must("mgrA", "SELECT create_progress_note_for_shift($1)", [P]);
  const F3 = await shift(C5, OR, 5, "11:00", "12:00"), F4 = await shift(C5, OR, 6, "11:00", "12:00");
  await must("mgrA", ASSIGN, [F3, GOOD, "manual"]);
  const f4Draft = await hardCodes(F4, GOOD);
  const nr = (await q(`SELECT scheduled_start FROM progress_notes WHERE id=$1`, [pn]))[0];
  await must("cgGood", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [pn, JSON.stringify({ client_arrived_at: nr.scheduled_start.toISOString() })]);
  await must("cgGood", "SELECT submit_progress_note($1,'Good Caregiver')", [pn]);
  const f4Submitted = await hardCodes(F4, GOOD);
  await must("mgrA", "SELECT review_progress_note($1,true,NULL)", [pn]);
  const f4Reviewed = await hardCodes(F4, GOOD); const left = Number((await q(`SELECT units_available a FROM service_authorizations WHERE id=$1`, [c5.auth]))[0].a);
  await must("mgrA", "SELECT void_progress_note($1,'test')", [pn]);
  const f4Voided = await hardCodes(F4, GOOD);
  const pRel = await call("mgrA", RELEASE, [`{${P}}`]);
  const f4PastCancelled = await hardCodes(F4, GOOD);
  rec("U-c review / void move units correctly: a draft or submitted note and an assigned future shift both count; review charges the note (no double count); void un-charges the note but the past assigned shift counts again; cancelling it frees the units",
    f4Draft === "units_short" && f4Submitted === "units_short" && f4Reviewed === "units_short" && left === 6 && f4Voided === "units_short" && !pRel.err && f4PastCancelled === "",
    `10 units, note 4 + F3 4 pending: F4 draft [${f4Draft}], submitted [${f4Submitted}], reviewed [${f4Reviewed}] (available ${left}), voided [${f4Voided}], past shift released (${pRel.err || pRel.v + " row"}) [${f4PastCancelled}]`);

  // ================= past demand (change 1) =================
  // 8 units. F (future, 4 units) is assigned; PP and PQ are PAST shifts (4 units each).
  const proj = async (s) => (await q(`SELECT cp_shift_client_context($1) c`, [s]))[0].c.proj;
  const C6 = U(506); await setupClient(C6, [GOOD], 8);
  const F = await shift(C6, OR, 5, "09:00", "10:00"); await must("mgrA", ASSIGN, [F, GOOD, "manual"]);
  const PP = await shift(C6, OR, -2, "09:00", "10:00"), PQ = await shift(C6, OR, -3, "09:00", "10:00");
  const p0 = (await proj(F)).projected;
  await must("mgrA", ASSIGN, [PP, GOOD, "manual"]);
  const p1 = (await proj(F)).projected, h1 = await hardCodes(F, GOOD);
  const F5 = await shift(C6, OR, 6, "11:00", "12:00"); const h5 = await hardCodes(F5, GOOD);
  rec("U-p1 a past assigned shift without a note reduces projected units (F sees 8 -> 4; a further future 4-unit shift is short)",
    Number(p0) === 8 && Number(p1) === 4 && h1 === "" && h5 === "units_short", `F projected before PP ${p0}, after PP ${p1}, F [${h1}]; F5 [${h5}]`);
  const ppn = await must("mgrA", "SELECT create_progress_note_for_shift($1)", [PP]);
  const p2 = (await proj(F)).projected, h2 = await hardCodes(F, GOOD);
  rec("U-p2 creating the past shift's note doesn't double count (the note counts, the shift stops counting: F still sees 4)",
    !!ppn && Number(p2) === 4 && h2 === "", `note ${ppn ? "created" : "missing"}; F projected ${p2} (double count would be 0); F [${h2}]`);
  // PQ was assigned before the rules applied (enforcement off -> advisory only), then enforcement is back on
  const pqHard = await hardCodes(PQ, GOOD);
  await db.exec(`UPDATE virtual_office SET compliance_enforcement_enabled = false WHERE id = '${OR}'`);
  await must("mgrA", ASSIGN, [PQ, GOOD, "manual"]);
  await db.exec(`UPDATE virtual_office SET compliance_enforcement_enabled = true WHERE id = '${OR}'`);
  const p3 = (await proj(F)).projected, h3 = await hardCodes(F, GOOD);
  await must("mgrA", RELEASE, [`{${PQ}}`]);
  const p4 = (await proj(F)).projected, h4 = await hardCodes(F, GOOD);
  rec("U-p3 cancelling a past assigned shift frees its units",
    pqHard === "units_short" && Number(p3) === 0 && h3 === "units_short" && Number(p4) === 4 && h4 === "", `PQ itself refused under enforcement [${pqHard}]; PQ assigned with enforcement off: F projected ${p3} [${h3}]; PQ released: F projected ${p4} [${h4}]`);

  const enforce = async (on) => db.exec(`UPDATE virtual_office SET compliance_enforcement_enabled = ${on} WHERE id = '${OR}'`);
  const assignLoose = async (s, g) => { await enforce(false); const r = await call("mgrA", ASSIGN, [s, g, "manual"]); await enforce(true); if (r.err) throw new Error("assignLoose: " + r.err); };

  // ================= fix 1: demand that fits nowhere still counts =================
  const CF = U(507); await setupClient(CF, [GOOD], 6);
  const big = await shift(CF, OR, -4, "06:00", "08:00"); await assignLoose(big, GOOD);   // 8 units, no note, auth has 6
  const small = await shift(CF, OR, 4, "06:00", "06:30");                                // 2 units
  const fSmall = await hardCodes(small, GOOD), pSmall = await proj(small);
  rec("U-f1 unplaced demand doesn't disappear: auth with 6 left, a past assigned 8-unit shift without a note, then a 2-unit shift -> units_short (projected floored at 0)",
    fSmall === "units_short" && Number(pSmall.projected) === 0, `2-unit shift [${fSmall}], projected ${pSmall.projected} (raw 6 - 8 = -2)`);

  // ================= fix 2: go-live cutover + opening balance =================
  const CU = U(508); await setupClient(CU, [GOOD], 40);
  const old = await shift(CU, OR, -10, "19:00", "20:00"); await must("mgrA", ASSIGN, [old, GOOD, "manual"]);
  await db.exec(`BEGIN; SELECT set_config('caremuch.assignment_ctx','1',true); UPDATE shift_assignments SET status='completed' WHERE shift_id='${old}'; UPDATE shifts SET status='completed' WHERE id='${old}'; COMMIT;`);
  const FU = await shift(CU, OR, 4, "19:00", "20:00");
  await setLive(-5); const pAfterLive = (await proj(FU)).projected;   // the completed shift (day -10) is before go-live
  await setLive(-20); const pBeforeLive = (await proj(FU)).projected; // go-live earlier: now it counts
  await setLive(-90);
  rec("U-cut a completed shift (no note) dated before the module was turned on is ignored; after go-live it would count",
    Number(pAfterLive) === 40 && Number(pBeforeLive) === 36, `go-live day -5: projected ${pAfterLive}; go-live day -20: projected ${pBeforeLive}`);
  const CO = U(509); await client(CO, OR);
  const AUTHOB = "SELECT create_service_authorization($1,'cls',$2,40,$3::date,$4::date,15,NULL,NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,$5)";
  const ob = await call("mgrA", AUTHOB, [CO, "OB-1", await day(-30), await day(60), 10]);
  const obAvail = ob.v && Number((await q(`SELECT units_available a FROM service_authorizations WHERE id=$1`, [ob.v]))[0].a);
  const obEv = ob.v && (await q(`SELECT payload FROM events WHERE event_type='authorization_created' AND subject_id=$1`, [ob.v]))[0];
  const obNeg = await call("mgrA", AUTHOB, [CO, "OB-2", await day(-30), await day(60), -1]);
  const obOver = await call("mgrA", AUTHOB, [CO, "OB-3", await day(-30), await day(60), 41]);
  rec("OB opening balance: 10 used before CareMuch on a 40-unit authorization -> 30 available (audited as a number); negative or over the authorized units refused",
    !ob.err && obAvail === 30 && obEv && obEv.payload.units_used_before_caremuch === 10 && /between 0 and the units authorized/.test(obNeg.err || "") && /between 0 and the units authorized/.test(obOver.err || ""),
    `available ${obAvail}; payload ${obEv && JSON.stringify(obEv.payload)}; -1 "${(obNeg.err || "accepted").slice(0, 60)}"; 41 "${(obOver.err || "accepted").slice(0, 40)}"`);

  // ================= fix 3: per-period caps =================
  const nextMon = Number((await q(`SELECT 8 - extract(isodow FROM (now() AT TIME ZONE '${TZ}')::date)::int n`))[0].n);   // days to next Monday (1..7)
  const capClient = async (id, units, cap) => { await setupClient(id, [GOOD], null);
    return must("mgrA", "SELECT create_service_authorization($1,'cls',$2,$3,$4::date,$5::date,15,NULL,NULL,NULL,'per_week'::auth_period_type,$6,NULL,'{}'::jsonb,0)",
      [id, `CAP-${id.slice(-4)}`, units, await day(-60), await day(60), cap]); };
  const CW = U(510); await capClient(CW, 200, 20);
  for (let k = 0; k < 4; k++) await must("mgrA", ASSIGN, [await shift(CW, OR, nextMon + k, "17:00", "18:00"), GOOD, "manual"]);   // 16 pending in week W
  const w5 = await shift(CW, OR, nextMon + 4, "17:00", "18:00"); const w5c = await hardCodes(w5, GOOD); const w5a = await call("mgrA", ASSIGN, [w5, GOOD, "manual"]);
  const w6 = await shift(CW, OR, nextMon + 5, "17:00", "18:00"); const w6e = await elig(w6, GOOD);
  const w6c = (w6e.hard || []).map((x) => x.code).sort().join(","), w6d = ((w6e.hard || []).find((x) => x.code === "units_short_period") || {}).detail;
  const nw = await shift(CW, OR, nextMon + 7, "17:00", "18:00"); const nwc = await hardCodes(nw, GOOD);
  rec("PW weekly cap 20 with 16 pending: a 4-unit shift passes; a second 4-unit shift the same week is blocked (units_short_period); the same shift next week passes",
    w5c === "" && !w5a.err && w6c === "units_short_period" && /needs 4 units; 0 left this week/.test(w6d || "") && nwc === "",
    `5th [${w5c}] assigned ${!w5a.err}; 6th [${w6c}] "${w6d}"; next week [${nwc}]`);
  const CRV = U(511); await capClient(CRV, 100, 8);
  const lw = nextMon - 14;   // Monday of LAST week (entirely past)
  const notes = [];
  for (let k = 0; k < 3; k++) {
    const s = await shift(CRV, OR, lw + k, "15:00", "16:00"); await assignLoose(s, GOOD);
    const id = await must("mgrA", "SELECT create_progress_note_for_shift($1)", [s]);
    const st = (await q(`SELECT scheduled_start FROM progress_notes WHERE id=$1`, [id]))[0].scheduled_start;
    await must("cgGood", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [id, JSON.stringify({ client_arrived_at: st.toISOString() })]);
    await must("cgGood", "SELECT submit_progress_note($1,'Good Caregiver')", [id]); notes.push(id);
  }
  const rv1 = await call("mgrA", "SELECT review_progress_note($1,true,NULL)", [notes[0]]), rv2 = await call("mgrA", "SELECT review_progress_note($1,true,NULL)", [notes[1]]);
  const rv3 = await call("mgrA", "SELECT review_progress_note($1,true,NULL)", [notes[2]]);
  const st3 = (await q(`SELECT status, authorization_id FROM progress_notes WHERE id=$1`, [notes[2]]))[0];
  const lw4 = await shift(CRV, OR, lw + 3, "15:00", "16:00"); const lw4c = await hardCodes(lw4, GOOD);
  rec("PR review refused when it would push the authorization over its weekly cap (note stays submitted); charged units count in the projection's week too",
    !rv1.err && !rv2.err && /over the authorization's weekly cap \(4 units needed, 0 left this week\)/.test(rv3.err || "") && st3.status === "submitted" && st3.authorization_id === null && lw4c === "units_short_period",
    `reviews 1-2 ${rv1.err || "ok"}/${rv2.err || "ok"}; 3rd "${(rv3.err || "accepted").slice(0, 100)}" -> ${st3.status}; another shift that week [${lw4c}]`);

  // ================= advisory when enforcement is off; Kind-Care-like office unaffected =================
  await db.exec(`UPDATE virtual_office SET compliance_enforcement_enabled = false WHERE id = '${OR}'`);
  const FRESH = await cg(U(313), OR); const advOnly = await elig(T1, FRESH);
  await db.exec(`UPDATE virtual_office SET compliance_enforcement_enabled = true WHERE id = '${OR}'`);
  const kind = codes(await elig(nbShifts.k, GKa));
  rec("R-flag enforcement off -> the same rules are advisory only (assignable); the Kind-Care-like office (flags off) is unaffected",
    advOnly.eligible === true && (advOnly.hard || []).length === 0 && ["credential_missing", "training_missing"].every((c) => (advOnly.advisory || []).some((x) => x.code === c)) && kind === after.single_k,
    `enforcement off: eligible ${advOnly.eligible}, advisory [${(advOnly.advisory || []).map((x) => x.code)}]; Kind-Care-like: ${kind}`);

  // ================= Manual / Smart / Auto honour the rules =================
  const T6 = await shift(C1, OR, 7, "09:00", "10:00"); const NEWBIE = await cg(U(314), OR);
  const ms = {}; for (const m of ["manual", "ai_suggested", "auto_assigned"]) { const r = await call("mgrA", ASSIGN, [T6, NEWBIE, m]); ms[m] = r.err ? (/Missing required credential/.test(r.err) ? "refused (credential)" : r.err) : "ASSIGNED"; }
  const bulk = (await call("mgrA", "SELECT result FROM check_assignment_eligibility_bulk($1,$2::uuid[])", [T6, `{${NEWBIE},${GOOD}}`])).rows.map((r) => r.result.eligible);
  rec("M Manual, Smart (ai_suggested + the bulk check match-caregiver filters on) and Auto assign all honour the rules",
    Object.values(ms).every((x) => x === "refused (credential)") && bulk[0] === false && bulk[1] === true, `${JSON.stringify(ms)}; bulk eligible [newbie ${bulk[0]}, compliant ${bulk[1]}]`);

  // ================= bulk computes the client-level checks once per shift (change 3) =================
  const cgs = [NEWBIE, GOOD, UNTR, BADC, FRESH];
  const counts = async (sql, p) => {
    await db.exec("BEGIN"); await db.exec("SET LOCAL track_functions = 'all'");
    const rd = async () => Object.fromEntries((await db.query(`SELECT funcname, calls::int c FROM pg_stat_xact_user_functions WHERE funcname IN ('cp_shift_client_context','cp_projected_units','cp_eligibility_core')`)).rows.map((x) => [x.funcname, x.c]));
    const r0 = await rd(); await db.query(sql, p); const r1 = await rd();   // deltas within this call
    await db.exec("ROLLBACK"); return Object.fromEntries(Object.entries(r1).map(([k, v]) => [k, v - (r0[k] || 0)]));
  };
  const cBulk = await counts("SELECT * FROM check_assignment_eligibility_bulk($1,$2::uuid[])", [T6, `{${cgs.join(",")}}`]);
  const cSingle = await counts(`SELECT ${cgs.map((_, i) => `check_assignment_eligibility($1,$${i + 2})`).join(",")}`, [T6, ...cgs]);
  const bulkRes = (await call("mgrA", "SELECT caregiver_id, result FROM check_assignment_eligibility_bulk($1,$2::uuid[])", [T6, `{${cgs.join(",")}}`])).rows;
  const same = [];
  for (const r of bulkRes) same.push(JSON.stringify(r.result) === JSON.stringify(await elig(T6, r.caregiver_id)));
  rec("B bulk computes the client-level checks (plan/training version, projected units) ONCE per shift, not once per caregiver; results identical to single checks",
    cBulk.cp_shift_client_context === 1 && cBulk.cp_projected_units === 1 && cBulk.cp_eligibility_core === 5 && cSingle.cp_shift_client_context === 5 && same.length === 5 && same.every(Boolean),
    `5 caregivers: bulk ${JSON.stringify(cBulk)}; 5 single checks ${JSON.stringify(cSingle)}; bulk == single for ${same.filter(Boolean).length}/5`);

  // ================= caregiver-safe text =================
  await db.query(`UPDATE caregivers SET user_id = NULL WHERE id = $1`, [BADC]);
  await db.query(`UPDATE caregivers SET user_id = $1 WHERE id = $2`, [users.cgBad, NEWBIE]);
  const T7 = await shift(C2, OR, 8, "09:00", "10:00");
  const side = (await call("cgBad", "SELECT result FROM check_caregiver_shifts_eligibility($1::uuid[])", [`{${T7}}`])).rows[0].result;
  const pick = await call("cgBad", "SELECT caregiver_pick_up_shift($1)", [T7]);
  const T8 = await shift(C1, OR, 9, "09:00", "10:00"); await must("mgrA", ASSIGN, [T8, GOOD, "manual"]);
  const tr = U(9001); await db.query(`INSERT INTO shift_trades (id, original_caregiver_id, shift_id, status) VALUES ($1,$2,$3,'pending')`, [tr, GOOD, T8]);
  const trade = await call("cgBad", "SELECT caregiver_pickup_trade_shift($1)", [tr]);
  const text = JSON.stringify(side) + (pick.err || "") + (trade.err || "");
  const leak = /ICHAT|HIPAA|authoriz|units|version|cls|respite|plan of service|\d+ of \d+/i;
  rec("R6 caregiver-facing results (shift list, pick-up, trade pick-up) show only generic text for the new codes",
    (side.hard || []).some((x) => x.code === "credential_missing") && (side.hard || []).some((x) => x.code === "not_bookable") && !leak.test(text) && !!pick.err && !!trade.err,
    `codes [${(side.hard || []).map((x) => x.code)}]; details "${[...new Set((side.hard || []).filter((x) => /credential|authoriz|training|units/.test(x.code)).map((x) => x.detail))].join(" | ")}"; pick-up "${(pick.err || "").slice(0, 80)}"; trade "${(trade.err || "").slice(0, 60)}"; leak ${leak.test(text)}`);

  // ================= group sessions =================
  const GG = await cg(U(320), OK_), GH = await cg(U(321), OK_);
  const gs = await must("mgrA", "SELECT create_group_session($1,$2::date,'14:00','15:00','1:3',NULL)", [OK_, await day(10)]);
  // clients 0-3 + 5-7 in the group; client 4 has a same-slot shift outside it
  const gc = []; for (let i = 0; i < 8; i++) gc.push(await client(U(600 + i), OK_));
  const gsh = []; for (let i = 0; i < 8; i++) gsh.push(await shift(gc[i], OK_, 10, "14:00", "15:00"));
  for (const i of [0, 1, 2, 3, 5, 6, 7]) await must("mgrA", "SELECT set_shift_group_session($1,$2)", [gsh[i], gs]);
  const ga = []; for (let i = 0; i < 3; i++) ga.push(await call("mgrA", ASSIGN, [gsh[i], GG, "manual"]));
  const gb = []; for (const i of [5, 6, 7]) gb.push(await call("mgrA", ASSIGN, [gsh[i], GH, "manual"]));
  const fourth = await call("mgrA", ASSIGN, [gsh[3], GG, "manual"]);
  const outside = await call("mgrA", ASSIGN, [gsh[4], GG, "manual"]);
  const dupClient = await shift(gc[5], OK_, 10, "14:00", "15:00");
  const dup = await call("mgrA", "SELECT set_shift_group_session($1,$2)", [dupClient, gs]);
  rec("G-cap per caregiver: two caregivers in one group with 3 clients each both pass; a 4th client for one caregiver is group_full; the same client twice in one group is refused",
    ga.every((r) => !r.err) && gb.every((r) => !r.err) && /This caregiver already has 3 of 3 clients/.test(fourth.err || "") && /already has a shift in this group session/.test(dup.err || ""),
    `GG 3 assigns ${ga.map((r) => r.err || "ok").join("/")}; GH 3 assigns ${gb.map((r) => r.err || "ok").join("/")}; GG 4th "${(fourth.err || "accepted").slice(0, 80)}"; same client twice "${(dup.err || "accepted").slice(0, 60)}"`);
  const gs2 = await must("mgrA", "SELECT create_group_session($1,$2::date,'14:00','15:00',NULL,NULL)", [OK_, await day(10)]);
  const other = await shift(await client(U(610), OK_), OK_, 10, "14:00", "15:00"); await must("mgrA", "SELECT set_shift_group_session($1,$2)", [other, gs2]);
  const otherGroup = await call("mgrA", ASSIGN, [other, GG, "manual"]);
  const wrongSlot = await call("mgrA", "SELECT set_shift_group_session($1,$2)", [await shift(gc[0], OK_, 10, "14:30", "15:30"), gs]);
  rec("G group session overlap: the same caregiver's 3 group shifts in one slot don't double-book each other; the same caregiver on an overlapping shift NOT in the group, or in another group, is still double_booked",
    ga.every((r) => !r.err) && /Overlaps a shift/.test(outside.err || "") && /Overlaps a shift/.test(otherGroup.err || "") && /exactly its time slot/.test(wrongSlot.err || ""),
    `3 overlapping group assigns ${ga.map((r) => r.err || "ok").join("/")}; not in group "${(outside.err || "accepted").slice(0, 50)}"; other group "${(otherGroup.err || "accepted").slice(0, 50)}"; wrong slot refused ${!!wrongSlot.err}`);
  let guardMsg; await db.exec("BEGIN"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users.mgrA]);
  try { await db.query(`UPDATE shifts SET group_session_id=$1 WHERE id=$2`, [gs, gsh[4]]); guardMsg = "changed"; } catch (e) { guardMsg = e.message; } await db.exec("ROLLBACK");
  rec("G-guard a shift can't be put into a group by a direct update (only set_shift_group_session)", /only through set_shift_group_session/.test(guardMsg), guardMsg.slice(0, 80));

  // ================= retraining list, denials, audit, ACL =================
  const T9 = await shift(C1, OR, 11, "09:00", "10:00"); await must("mgrA", ASSIGN, [T9, GOOD, "manual"]);
  await must("mgrA", "SELECT renew_care_plan($1)", [plan2]);
  const retr = (await call("hrR", "SELECT list_caregivers_needing_retraining($1)", [OR])).v || [];
  rec("L already-assigned shifts stay assigned after a renewal; the dashboard list shows the caregivers needing retraining",
    retr.some((x) => x.shift_id === T9 && x.caregiver_id === GOOD) && (await q(`SELECT caregiver_id FROM shifts WHERE id=$1`, [T9]))[0].caregiver_id === GOOD, `listed ${retr.length} shift(s), T9 for GOOD ${retr.some((x) => x.shift_id === T9)}`);
  const D = { create_group_session: ["SELECT create_group_session($1,$2::date,'09:00','10:00',NULL,NULL)", [OK_, await day(12)], ["hrR", "cgGood", "cl", "anon", "aaB", "sysA"]],
    set_shift_group_session: ["SELECT set_shift_group_session($1,$2)", [gsh[4], gs], ["hrR", "cgGood", "cl", "anon", "aaB", "sysA", "schR"]],
    list_caregivers_needing_retraining: ["SELECT list_caregivers_needing_retraining($1)", [OR], ["schR", "cgGood", "cl", "anon", "aaB", "sysA", "mgrY"]] };
  const leaks = []; let n = 0;
  for (const [fn, [sql, p, whos]] of Object.entries(D)) for (const w of whos) { const r = await call(w, sql, p); n++; if (!r.err || !DENY.test(r.err)) leaks.push(`${w}->${fn}: ${r.err ? r.err.slice(0, 40) : "ALLOWED"}`); }
  rec("D every new Phase C RPC refused outside its tier/scope (hr_staff on scheduling, scheduler on training list, caregiver, client, anon, agency B, system_admin, other-office manager)",
    leaks.length === 0, leaks.length ? leaks.join("; ") : `${n} denied calls refused`);
  const ev = await q(`SELECT event_type, count(*)::int n FROM events WHERE event_type IN ('group_session_created','shift_group_session_set') GROUP BY 1 ORDER BY 1`);
  const evMap = Object.fromEntries(ev.map((r) => [r.event_type, r.n]));
  rec("A1 one event per group-session write (2 sessions created; 8 shifts set; refused writes leave none)", evMap.group_session_created === 2 && evMap.shift_group_session_set === 8, JSON.stringify(evMap));
  const fns = await q(`SELECT p.proname, p.prosecdef d, COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default)') g
    FROM pg_proc p WHERE p.proname IN ('cp_shift_units','cp_projected_units','cp_safe_issue_list','cp_caregiver_safe_eligibility','cp_guard_shift_group_session','create_group_session','set_shift_group_session','list_caregivers_needing_retraining','guard_virtual_office_flags','cp_eligibility_core','cp_shift_client_context','cp_lock_client_authorizations','cp_period_window','cp_period_left') ORDER BY 1`);
  const rpcs = ["create_group_session", "set_shift_group_session", "list_caregivers_needing_retraining"];
  const badAcl = fns.filter((f) => f.g === "(default)" || /PUBLIC|anon/.test(f.g) || (rpcs.includes(f.proname) ? !(f.d && /authenticated/.test(f.g)) : /authenticated/.test(f.g)));
  fns.forEach((f) => console.log(`   ${f.proname} definer=${f.d} EXECUTE: ${f.g}`));
  rec("ACL new Phase C functions: 3 RPCs definer + authenticated; helpers and trigger functions no API role", badAcl.length === 0 && fns.length === 14, `offending: ${badAcl.map((f) => f.proname).join(", ") || "none"}`);
  const csa = await q(`SELECT p.pronargs n, (SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE') g FROM pg_proc p WHERE p.proname = 'create_service_authorization'`);
  rec("R13 create_service_authorization: exactly one function (15 arguments), old 14-argument one dropped, grants re-applied (authenticated, no PUBLIC/anon)",
    csa.length === 1 && csa[0].n === 15 && /authenticated/.test(csa[0].g) && !/PUBLIC|anon/.test(csa[0].g), JSON.stringify(csa));
  console.log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok ? "PASS" : "FAIL"}`).join(" "));
})().catch((e) => { console.log("HARNESS ERROR", e.message); process.exit(1); });

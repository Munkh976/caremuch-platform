// Phase D2 on PGlite: get_client_onboarding_status / list_clients_onboarding over A/B1/B2/C (+ the live
// scheduling functions, as in phase-c.cjs). Each of the 8 items flips on its own; onboarded only when
// all pass; expiry paths; denials; ACLs.
// Usage: node tests/ripple/pglite/phase-d.cjs   (local PGlite, no network)
const path = require("path");
const fs = require("fs");
const { PGlite } = require("@electric-sql/pglite");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/";
const LIVE = __dirname + "/live/";
const EXACT = JSON.parse(fs.readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : fs.readFileSync(LIVE + n + ".sql", "utf8");
const ALL = fs.readdirSync(MIG).filter((f) => /^202610(0612|0712|0812|0912|1012)/.test(f)).sort();
const PRE = ALL.filter((f) => !/^20261010/.test(f)), PD = ALL.filter((f) => /^20261010/.test(f));
const A = "56fbfe38-e8eb-40c1-ba27-07428f62ed2e", OR = "12faa863-017e-438c-966c-f67be9b726e7", OY = "56785edd-ce66-4bf0-a487-abb628f21fef";
const B = "bbbbbbbb-0000-0000-0000-000000000001", OZ = "bbbbbbbb-0000-0000-0000-0000000000a1", TZ = "America/New_York";
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const users = { aaA: U(1), mgrA: U(2), mgrY: U(3), schR: U(4), hrR: U(5), cgGood: U(6), cl: U(7), aaB: U(8), sysA: U(9), mgrR: U(11) };
const rows = []; const rec = (id, ok, d) => { rows.push({ id, ok }); console.log(`${id} ${ok ? "PASS" : "FAIL"} :: ${d}`); };
const DENY = /Not found or not allowed|permission denied/;
const KEYS = ["ipos", "assessment", "inservice", "client_forms", "safety_behavior_plan", "training", "authorization", "cls_note_setup"];

(async () => {
  const db = new PGlite();
  for (const f of ["stub.sql", "live_helpers.sql", "stub_b1.sql", "stub_b2.sql", "stub_c.sql", "stub_d.sql"]) await db.exec(fs.readFileSync(path.join(__dirname, f), "utf8"));
  await db.exec(fs.readFileSync(LIVE + "assignment_machinery.sql", "utf8"));
  for (const f of ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "check_caregiver_shifts_eligibility", "assign_caregiver_to_shift",
    "caregiver_pick_up_shift", "caregiver_pickup_trade_shift", "release_shift_assignments"]) await db.exec(liveDef(f) + ";");
  await db.exec(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    INSERT INTO agency (id, agency_name) VALUES ('${A}','A'),('${B}','B');
    INSERT INTO virtual_office (id, agency_id, name, timezone) VALUES ('${OR}','${A}','Ripple-like','${TZ}'),('${OY}','${A}','Other office','${TZ}'),('${OZ}','${B}','Z','${TZ}');
    INSERT INTO care_types (code, name) VALUES ('CLS0001','CLS'),('RESP0001','Respite');`);
  for (const f of PRE) { try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { console.log("APPLY FAILED", f, e.message); process.exit(1); } }
  for (const f of PD) { try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { console.log("APPLY FAILED", f, e.message); process.exit(1); } }
  console.log(`applied ${PRE.length} files through Phase C, then Phase D: ${PD.join(", ")}`);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const day = async (n) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [n]))[0].d;
  await db.exec(`
    INSERT INTO profiles (id, agency_id, virtual_office_id, office_restricted, full_name) VALUES
      ('${users.aaA}','${A}',NULL,false,'AA'),('${users.mgrA}','${A}',NULL,false,'MA'),('${users.mgrY}','${A}','${OY}',true,'MY'),('${users.mgrR}','${A}','${OR}',true,'MR'),
      ('${users.schR}','${A}','${OR}',true,'S'),('${users.hrR}','${A}','${OR}',true,'H'),('${users.cgGood}','${A}','${OR}',false,'CG'),
      ('${users.cl}','${A}',NULL,false,'CL'),('${users.aaB}','${B}',NULL,false,'AB'),('${users.sysA}','${A}',NULL,false,'SA');
    INSERT INTO user_roles (user_id, role, agency_id) VALUES ('${users.aaA}','agency_admin','${A}'),('${users.mgrA}','manager','${A}'),('${users.mgrY}','manager','${A}'),
      ('${users.mgrR}','manager','${A}'),('${users.schR}','scheduler','${A}'),('${users.hrR}','hr_staff','${A}'),('${users.cgGood}','caregiver','${A}'),
      ('${users.cl}','client','${A}'),('${users.aaB}','agency_admin','${B}'),('${users.sysA}','system_admin','${A}');
    INSERT INTO cp_default_credential_types (name, category, valid_months, required) VALUES ('ICHAT','background_check',12,true);
    INSERT INTO cp_default_service_types (care_type_code, service_type) VALUES ('CLS0001','cls'),('RESP0001','respite');`);
  const call = async (who, sql, params = []) => {
    await db.exec("BEGIN");
    try {
      if (who === "anon") await db.exec("SET LOCAL ROLE anon");
      else if (who !== "su") { await db.exec("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users[who]]); }
      const r = await db.query(sql, params); await db.exec("COMMIT"); return { v: r.rows[0] && Object.values(r.rows[0])[0] };
    } catch (e) { await db.exec("ROLLBACK"); return { err: e.message }; }
  };
  const must = async (who, sql, p) => { const r = await call(who, sql, p); if (r.err) throw new Error(`${sql.slice(0, 60)}: ${r.err}`); return r.v; };
  await must("aaA", "SELECT seed_office_care_plan_defaults($1)", [OR]);
  const G = U(310); await db.query(`INSERT INTO caregivers (id, agency_id, user_id, first_name, virtual_office_id, is_active) VALUES ($1,$2,$3,'G',$4,true)`, [G, A, users.cgGood, OR]);
  const X = U(501), X2 = U(502), XY = U(503);
  for (const [id, o] of [[X, OR], [X2, OR], [XY, OY]]) await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'C','Fixture',$3)`, [id, A, o]);

  const status = async (c, who = "mgrR") => { const r = await call(who, "SELECT get_client_onboarding_status($1)", [c]); if (r.err) throw new Error(r.err); return r.v; };
  const map = (s) => Object.fromEntries(s.items.map((i) => [i.key, i.status]));
  // each step must change exactly the expected item(s), to the expected status
  const flips = [];
  let cur = await status(X);
  const s0 = map(cur);
  const step = async (label, fn, expect) => {
    await fn(); const nxt = await status(X); const a = map(cur), b = map(nxt);
    const changed = KEYS.filter((k) => a[k] !== b[k]);
    const ok = JSON.stringify(changed) === JSON.stringify(Object.keys(expect)) && Object.entries(expect).every(([k, v]) => b[k] === v);
    flips.push({ label, ok, changed: changed.map((k) => `${k}:${a[k]}->${b[k]}`).join(","), onboarded: nxt.onboarded });
    cur = nxt; return nxt;
  };
  const doc = (t, st, na = null, exp = null) => must("mgrR", "SELECT upsert_client_document($1,$2,$3::client_document_status,$4,NULL,$5::date)", [X, t, st, na, exp]);
  const plan = { id: null };
  await step("1 create the plan (IPOS)", async () => { plan.id = await must("mgrR", "SELECT create_care_plan($1,'initial',$2::jsonb)", [X, JSON.stringify({ effective_date: await day(-60), expiration_date: await day(300) })]); }, { ipos: "complete" });
  await step("8a goals with one this_agency objective, no measure yet", async () => {
    await must("mgrR", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan.id, JSON.stringify([{ seq: 1, goal_text: "g", objectives: [{ seq: 1, objective_text: "o", service_type: "cls", responsible_party: "this_agency" },
      { seq: 2, objective_text: "cm", responsible_party: "case_management" }] }])]); }, {});
  await step("8b a measure on every this_agency objective (CLS note set up)", async () => {
    const ob = (await q(`SELECT o.id FROM care_plan_objectives o JOIN care_plan_goals g ON g.id = o.goal_id WHERE g.care_plan_id = $1 AND o.responsible_party = 'this_agency'`, [plan.id]))[0].id;
    const mt = (await q(`SELECT id FROM measure_types WHERE agency_id IS NULL AND kind = 'yes_no_na' LIMIT 1`))[0].id;
    await must("mgrR", "SELECT set_objective_measures($1,$2::jsonb)", [ob, JSON.stringify([{ measure_type_id: mt, prompt_text: "Participated?" }])]); }, { cls_note_setup: "complete" });
  await step("2 assessment", () => doc("assessment", "complete"), { assessment: "complete" });
  await step("3 in-service signed at the current training_version", () => must("hrR", "SELECT record_inservice_form($1,'CM',$2,$3::date,now())", [plan.id, users.mgrR, s0 && "2026-01-01"]), { inservice: "complete" });
  await step("4a four of five client forms", async () => { for (const t of ["consent", "insurance", "emergency_contacts", "allergies"]) await doc(t, "complete"); }, {});
  await step("4b fifth client form not applicable", () => doc("release_of_information", "not_applicable", "No outside party"), { client_forms: "complete" });
  await step("5 safety/behavior plan not applicable (Q7)", () => doc("safety_behavior_plan", "not_applicable", "No plan in the IPOS"), { safety_behavior_plan: "not_applicable" });
  await step("6 a caregiver trained at the current version (Q8)", () => must("hrR", "SELECT record_training_form($1,'ipos_initial'::plan_document_type,NULL,NULL,$2::jsonb)",
    [plan.id, JSON.stringify([{ caregiver_id: G, training_date: "2026-01-02" }])]), { training: "complete" });
  const beforeLast = cur.onboarded;
  await step("7 authorization valid today", async () => must("mgrR", "SELECT create_service_authorization($1,'cls','D2-AUTH',40,$2::date,$3::date)", [X, await day(-30), await day(60)]), { authorization: "complete" });
  const onboardedNow = cur.onboarded;
  // expiry paths
  await step("E1 assessment expired (complete, expiration date passed)", async () => doc("assessment", "complete", null, await day(-1)), { assessment: "expired" });
  await step("E2 assessment renewed", () => doc("assessment", "complete"), { assessment: "complete" });
  await step("E3 a client form pending again", () => doc("allergies", "pending"), { client_forms: "missing" });
  await step("E4 the client form completed", () => doc("allergies", "complete"), { client_forms: "complete" });
  for (const f of flips) rec(`F ${f.label}`, f.ok, `changed [${f.changed || "none"}]; onboarded ${f.onboarded}`);
  rec("O1 all 8 missing at the start; onboarded only when all 8 pass (false right before the 8th, true after it); an item going expired/missing takes it away again",
    KEYS.every((k) => s0[k] === "missing") && s0.onboarded === undefined && beforeLast === false && onboardedNow === true
      && flips.find((f) => f.label.startsWith("E1")).onboarded === false && flips.find((f) => f.label.startsWith("E4")).onboarded === true,
    `start ${JSON.stringify(s0)}; before the 8th ${beforeLast}; after ${onboardedNow}`);
  // renewal: in-service and training become expired (older training_version), IPOS stays complete
  await must("mgrR", "SELECT renew_care_plan($1)", [plan.id]);
  const rn = map(await status(X));
  rec("E5 after a renewal (training_version 2): in-service and training read 'expired' until redone at the new version; IPOS complete; not onboarded",
    rn.inservice === "expired" && rn.training === "expired" && rn.ipos === "complete" && (await status(X)).onboarded === false, JSON.stringify(rn));
  // list
  const lst = (await call("mgrR", "SELECT list_clients_onboarding($1)", [OR])).v || [];
  rec("L list_clients_onboarding: every active client of the office (not other offices), same shape",
    lst.length === 2 && lst.some((x) => x.client_id === X2 && x.onboarded === false && x.items.length === 8) && !lst.some((x) => x.client_id === XY),
    `${lst.length} clients: ${lst.map((x) => `${x.client_id.slice(-3)} onboarded=${x.onboarded}`).join(", ")}`);
  await db.query(`UPDATE clients SET is_active = false WHERE id = $1`, [X2]);
  const lst2 = (await call("mgrR", "SELECT list_clients_onboarding($1)", [OR])).v || [];
  rec("L2 inactive clients are left out", lst2.length === 1 && lst2[0].client_id === X, `${lst2.length} client(s)`);
  // allowed: office manager, agency-wide manager, agency admin
  const ok = []; for (const w of ["mgrR", "mgrA", "aaA"]) ok.push(!(await call(w, "SELECT get_client_onboarding_status($1)", [X])).err && !(await call(w, "SELECT list_clients_onboarding($1)", [OR])).err);
  rec("P manager (office and agency-wide) and agency_admin can read", ok.every(Boolean), JSON.stringify(ok));
  // denials
  const leaks = []; let n = 0;
  for (const [sql, p] of [["SELECT get_client_onboarding_status($1)", [X]], ["SELECT list_clients_onboarding($1)", [OR]], ["SELECT get_client_onboarding_status($1)", [U(999)]]])
    for (const w of ["schR", "hrR", "cgGood", "cl", "anon", "mgrY", "aaB", "sysA"]) { const r = await call(w, sql, p); n++; if (!r.err || !DENY.test(r.err)) leaks.push(`${w} ${sql.slice(7, 30)}: ${r.err ? r.err.slice(0, 40) : "ALLOWED"}`); }
  const ghost = await call("mgrR", "SELECT get_client_onboarding_status($1)", [U(999)]);
  rec("D scheduler, hr_staff, caregiver, client, anon, other-office manager, agency-B admin, system_admin refused (generic); unknown client refused the same way",
    leaks.length === 0 && DENY.test(ghost.err || ""), leaks.length ? leaks.join("; ") : `${n} denied calls refused; unknown client "${ghost.err}"`);
  // ACL
  const acl = await q(`SELECT p.proname, p.prosecdef d, p.provolatile v, COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default)') g
    FROM pg_proc p WHERE p.proname IN ('cp_client_onboarding','get_client_onboarding_status','list_clients_onboarding') ORDER BY 1`);
  const bad = acl.filter((f) => /PUBLIC|anon|\(default\)/.test(f.g) || (f.proname === "cp_client_onboarding" ? (f.d || /authenticated/.test(f.g)) : !(f.d && /authenticated/.test(f.g))));
  rec("ACL 2 RPCs SECURITY DEFINER + authenticated only (no PUBLIC/anon); the evaluator has no API role; all STABLE",
    acl.length === 3 && bad.length === 0 && acl.every((f) => f.v === "s"), acl.map((f) => `${f.proname} definer=${f.d} ${f.g}`).join("; "));
  console.log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}${r.id.startsWith("F ") ? r.id.split(" ")[1] : ""}=${r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
})().catch((e) => { console.log("HARNESS ERROR", e.message); process.exit(1); });

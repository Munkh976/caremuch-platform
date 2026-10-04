// S-OFF-1 (caller office scope in assign / release / compute earnings) + the note-shell service_type
// change, on PGlite over A..D2 and the live scheduling functions.
// Usage: node tests/ripple/pglite/soff.cjs   (local PGlite, no network)
const path = require("path");
const fs = require("fs");
const { PGlite } = require("@electric-sql/pglite");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/";
const LIVE = __dirname + "/live/";
const EXACT = JSON.parse(fs.readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : fs.readFileSync(LIVE + n + ".sql", "utf8");
const ALL = fs.readdirSync(MIG).filter((f) => /^202610(0612|0712|0812|0912|1012|1112)/.test(f)).sort();
const PRE = ALL.filter((f) => !/^20261011/.test(f)), NEW = ALL.filter((f) => /^20261011/.test(f));
const A = "56fbfe38-e8eb-40c1-ba27-07428f62ed2e", OX = "12faa863-017e-438c-966c-f67be9b726e7", OY = "56785edd-ce66-4bf0-a487-abb628f21fef", TZ = "America/New_York";
let seq = 0; const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`; const nid = () => U(7000 + ++seq);
const users = { aaA: U(1), mgrA: U(2), mgrY: U(3), mgrX: U(4), cgX: U(6) };
const rows = []; const rec = (id, ok, d) => { rows.push({ id, ok }); console.log(`${id} ${ok ? "PASS" : "FAIL"} :: ${d}`); };
const DENY = /Not found or not allowed/;

(async () => {
  const db = new PGlite();
  for (const f of ["stub.sql", "live_helpers.sql", "stub_b1.sql", "stub_b2.sql", "stub_c.sql", "stub_d.sql", "stub_soff.sql"]) await db.exec(fs.readFileSync(path.join(__dirname, f), "utf8"));
  await db.exec(fs.readFileSync(LIVE + "assignment_machinery.sql", "utf8"));
  for (const f of ["check_assignment_eligibility", "check_assignment_eligibility_bulk", "check_caregiver_shifts_eligibility", "assign_caregiver_to_shift",
    "caregiver_pick_up_shift", "caregiver_pickup_trade_shift", "release_shift_assignments", "compute_earnings_for_time_entry"]) await db.exec(liveDef(f) + ";");
  await db.exec(`
    CREATE TRIGGER trg_enforce_derived_shift_caregiver BEFORE INSERT OR UPDATE OF caregiver_id ON public.shifts FOR EACH ROW EXECUTE FUNCTION enforce_derived_shift_caregiver();
    CREATE TRIGGER trg_protect_assignment_columns BEFORE INSERT OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION protect_assignment_columns();
    CREATE TRIGGER trg_sync_shift_caregiver AFTER INSERT OR DELETE OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION sync_shift_caregiver_from_assignment();
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    INSERT INTO agency (id, agency_name) VALUES ('${A}','A');
    INSERT INTO virtual_office (id, agency_id, name, timezone) VALUES ('${OX}','${A}','X','${TZ}'),('${OY}','${A}','Y','${TZ}');
    INSERT INTO care_types (code, name) VALUES ('CLS0001','CLS'),('RESP0001','Respite');`);
  for (const f of PRE) { try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { console.log("APPLY FAILED", f, e.message); process.exit(1); } }
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const day = async (n) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [n]))[0].d;
  await db.exec(`
    INSERT INTO profiles (id, agency_id, virtual_office_id, office_restricted, full_name) VALUES
      ('${users.aaA}','${A}',NULL,false,'AA'),('${users.mgrA}','${A}',NULL,false,'MA'),('${users.mgrY}','${A}','${OY}',true,'MY'),
      ('${users.mgrX}','${A}','${OX}',true,'MX'),('${users.cgX}','${A}','${OX}',false,'CG');
    INSERT INTO user_roles (user_id, role, agency_id) VALUES ('${users.aaA}','agency_admin','${A}'),('${users.mgrA}','manager','${A}'),('${users.mgrY}','manager','${A}'),
      ('${users.mgrX}','manager','${A}'),('${users.cgX}','caregiver','${A}');
    INSERT INTO cp_default_service_types (care_type_code, service_type) VALUES ('CLS0001','cls'),('RESP0001','respite');`);
  const call = async (who, sql, params = []) => {
    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users[who]]);
      const r = await db.query(sql, params); await db.exec("COMMIT"); return { v: r.rows[0] && Object.values(r.rows[0])[0] };
    } catch (e) { await db.exec("ROLLBACK"); return { err: e.message }; }
  };
  const must = async (who, sql, p) => { const r = await call(who, sql, p); if (r.err) throw new Error(`${sql.slice(0, 60)}: ${r.err}`); return r.v; };
  const G = U(310), GY = U(311);
  for (const [id, o, u] of [[G, OX, users.cgX], [GY, OY, null]]) {
    await db.query(`INSERT INTO caregivers (id, agency_id, user_id, first_name, virtual_office_id, is_active, hourly_rate) VALUES ($1,$2,$3,'G',$4,true,20)`, [id, A, u, o]);
    await db.query(`INSERT INTO caregiver_skills (caregiver_id, care_type_code) VALUES ($1,'CLS0001'),($1,'RESP0001')`, [id]); }
  const CX = U(401), CY = U(402);
  for (const [id, o] of [[CX, OX], [CY, OY]]) await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'C','Fixture',$3)`, [id, A, o]);
  const shift = async (client, office, off, start, code = "CLS0001") => { const id = nid(); const end = `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00`;
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
                    VALUES ($1,$2,$3,$4,$5::date,$6::time,$7::time,$8,'open',1)`, [id, A, client, code, await day(off), `${start}:00`, end, office]); return id; };
  const ASSIGN = "SELECT assign_caregiver_to_shift($1,$2,'manual'::assignment_method,'t',NULL)";
  const RELEASE = "SELECT release_shift_assignments($1::uuid[], 'test')";
  const active = async (s) => Number((await q(`SELECT count(*) n FROM shift_assignments WHERE shift_id = $1 AND status <> 'cancelled'`, [s]))[0].n);
  const te = async (s, g, office) => { const id = nid(); await db.query(`INSERT INTO time_entries (id, agency_id, shift_id, caregiver_id, hours_worked, status, virtual_office_id) VALUES ($1,$2,$3,$4,1,'approved',$5)`, [id, A, s, g, office]); return id; };
  const aclOf = async () => JSON.stringify(await q(`SELECT proname, pg_get_function_identity_arguments(oid) a, COALESCE(proacl::text,'') acl FROM pg_proc
    WHERE proname IN ('assign_caregiver_to_shift','release_shift_assignments','compute_earnings_for_time_entry','create_progress_note_for_shift') ORDER BY 1`));

  // ---------- baseline BEFORE the new migrations: what an office-Y manager can do today ----------
  const b1 = await shift(CX, OX, 3, "09"); const gapAssign = await call("mgrY", ASSIGN, [b1, G]);
  const gapRelease = await call("mgrY", RELEASE, [`{${b1}}`]);
  const tb = await te(b1, G, OX); const gapEarn = await call("mgrY", "SELECT compute_earnings_for_time_entry($1, false)", [tb]);
  const nbBefore = {}; const nbS = await shift(CY, OY, 4, "09"); const nbR = await call("mgrA", ASSIGN, [nbS, GY]); nbBefore.assign = nbR.err || `ok eligible=${nbR.v.eligibility.eligible}`;
  nbBefore.release = (await call("mgrA", RELEASE, [`{${nbS}}`])).v; const nbT = await te(nbS, GY, OY); nbBefore.earn = JSON.stringify(((await call("mgrA", "SELECT compute_earnings_for_time_entry($1,false)", [nbT])).v || {}).ok);
  const aclBefore = await aclOf();
  rec("GAP before S-OFF-1 (reproduces D3 S8): an office-Y manager can assign, release and compute earnings on office X",
    !gapAssign.err && !gapRelease.err && gapRelease.v === 1 && !gapEarn.err && gapEarn.v.ok === true, `assign ${gapAssign.err || "ACCEPTED"}; release ${gapRelease.err || gapRelease.v + " row"}; earnings ${gapEarn.err || JSON.stringify(gapEarn.v.ok)}`);

  for (const f of NEW) { try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { console.log("APPLY FAILED", f, e.message); process.exit(1); } }
  console.log(`applied: ${NEW.join(", ")}`);

  // ---------- S-OFF-1 ----------
  const s1 = await shift(CX, OX, 5, "09"), s2 = await shift(CX, OX, 5, "11"), s3 = await shift(CX, OX, 5, "13");
  const yA = await call("mgrY", ASSIGN, [s1, G]); const xA = await call("mgrX", ASSIGN, [s1, G]); const aA = await call("mgrA", ASSIGN, [s2, G]);
  rec("A assign: office-Y manager refused (generic) on an office-X shift; office-X manager and unrestricted manager succeed",
    DENY.test(yA.err || "") && !xA.err && !aA.err, `Y "${yA.err || "ACCEPTED"}"; X ${xA.err || "ok"}; unrestricted ${aA.err || "ok"}`);
  const yR = await call("mgrY", RELEASE, [`{${s1}}`]); const still = await active(s1);
  const sy = await shift(CY, OY, 5, "15"); await must("mgrA", ASSIGN, [sy, GY]);
  const yMixed = await call("mgrY", RELEASE, [`{${sy},${s2}}`]); const mixedKept = (await active(sy)) + (await active(s2));
  const xR = await call("mgrX", RELEASE, [`{${s1}}`]); const aR = await call("mgrA", RELEASE, [`{${s2}}`]);
  rec("R release: office-Y manager refused on an office-X shift (assignment kept) and on a mixed own+other list (nothing released); office-X and unrestricted managers succeed",
    DENY.test(yR.err || "") && still === 1 && DENY.test(yMixed.err || "") && mixedKept === 2 && xR.v === 1 && aR.v === 1,
    `Y "${yR.err || "ACCEPTED"}" (kept ${still}); Y mixed "${yMixed.err || "ACCEPTED"}" (kept ${mixedKept}/2); X ${xR.err || xR.v}; unrestricted ${aR.err || aR.v}`);
  const t1 = await te(s3, G, OX);
  const yE = await call("mgrY", "SELECT compute_earnings_for_time_entry($1,false)", [t1]); const xE = await call("mgrX", "SELECT compute_earnings_for_time_entry($1,false)", [t1]);
  const aE = await call("mgrA", "SELECT compute_earnings_for_time_entry($1,true)", [t1]);
  rec("E compute earnings: office-Y manager refused on an office-X time entry; office-X manager and unrestricted manager succeed",
    DENY.test(yE.err || "") && xE.v && xE.v.ok === true && aE.v && aE.v.ok === true, `Y "${yE.err || "ACCEPTED"}"; X ${xE.err || JSON.stringify(xE.v.ok)}; unrestricted recompute ${aE.err || JSON.stringify(aE.v.ok)}`);
  const op = await shift(CX, OX, 6, "09"); const pick = await call("cgX", "SELECT caregiver_pick_up_shift($1)", [op]);
  rec("P caregiver self pick-up still works", !pick.err && (await active(op)) === 1, pick.err || "picked up");
  const nbAfter = {}; const nbS2 = await shift(CY, OY, 4, "11"); const nbR2 = await call("mgrA", ASSIGN, [nbS2, GY]); nbAfter.assign = nbR2.err || `ok eligible=${nbR2.v.eligibility.eligible}`;
  nbAfter.release = (await call("mgrA", RELEASE, [`{${nbS2}}`])).v; const nbT2 = await te(nbS2, GY, OY); nbAfter.earn = JSON.stringify(((await call("mgrA", "SELECT compute_earnings_for_time_entry($1,false)", [nbT2])).v || {}).ok);
  rec("NB1 unrestricted manager: assign / release / compute earnings results identical before and after S-OFF-1", JSON.stringify(nbBefore) === JSON.stringify(nbAfter), `${JSON.stringify(nbBefore)} -> ${JSON.stringify(nbAfter)}`);

  // ---------- note shells per service ----------
  await must("aaA", "SELECT seed_office_care_plan_defaults($1)", [OX]); await must("aaA", "SELECT seed_office_care_plan_defaults($1)", [OY]);
  const noteFields = JSON.stringify([{ field_key: "service_date", label: "Date", field_type: "date", storage: "spine_column", writes_to_entity: "progress_note", writes_to_column: "service_date" },
    { field_key: "objectives", label: "Objectives", field_type: "table", storage: "child_rows", writes_to_entity: "progress_note_entry" }]);
  const SAVE = "SELECT save_template_draft(NULL,$1,'progress_note'::form_template_kind,$2,NULL,NULL,'[]'::jsonb,NULL,$3::jsonb,$4)";
  const mkShell = async (office, name, svc) => { const ver = await must("mgrA", SAVE, [office, name, noteFields, svc]);
    const t = (await q(`SELECT template_id FROM form_template_versions WHERE id = $1`, [ver]))[0].template_id; await must("mgrA", "SELECT publish_template_version($1)", [t]); return t; };
  const tCls = await mkShell(OX, "CLS note", "cls"), tResp = await mkShell(OX, "Respite note", "respite");
  const tYcls = await mkShell(OY, "Office Y CLS note", "cls");
  for (const [c, o] of [[CX, OX], [CY, OY]]) await must("mgrA", "SELECT create_care_plan($1,'initial',$2::jsonb)", [c, JSON.stringify({ effective_date: await day(-60), expiration_date: await day(300) })]);
  const noteFor = async (client, office, g, code, start) => { const s = await shift(client, office, -1, start, code); await must("mgrA", ASSIGN, [s, g]);
    const n = await must("mgrA", "SELECT create_progress_note_for_shift($1)", [s]); return (await q(`SELECT template_id FROM progress_notes WHERE id = $1`, [n]))[0].template_id; };
  const nX_cls = await noteFor(CX, OX, G, "CLS0001", "06"), nX_resp = await noteFor(CX, OX, G, "RESP0001", "08");
  const nY_resp = await noteFor(CY, OY, GY, "RESP0001", "08"), nY_cls = await noteFor(CY, OY, GY, "CLS0001", "10");
  rec("N1 a respite note snapshots the respite shell and a CLS note the CLS shell (the respite shell is the newer one, so this is the service match, not recency)",
    nX_cls === tCls && nX_resp === tResp, `CLS note -> ${nX_cls === tCls ? "CLS shell" : nX_cls}; respite note -> ${nX_resp === tResp ? "respite shell" : nX_resp}`);
  rec("N2 no respite shell (office Y has only a CLS shell): the respite note falls back to today's behaviour (the office's newest progress-note shell)",
    nY_resp === tYcls && nY_cls === tYcls, `respite note -> ${nY_resp === tYcls ? "office Y CLS shell" : nY_resp}; CLS note -> ${nY_cls === tYcls ? "office Y CLS shell" : nY_cls}`);
  const badKind = await call("mgrA", "SELECT save_template_draft(NULL,$1,'ipos'::form_template_kind,'x',NULL,NULL,'[]'::jsonb,NULL,'[]'::jsonb,'cls')", [OX]);
  const badVal = await call("mgrA", SAVE, [OX, "bad", noteFields, "dsp"]);
  const fixed = await call("mgrA", "SELECT save_template_draft($1,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,$2::jsonb,'respite')", [tCls, noteFields]);
  rec("N3 service_type only on progress-note shells, only cls/respite, fixed after creation",
    /progress-note shells only/.test(badKind.err || "") && /progress-note shells only/.test(badVal.err || "") && /fixed on an existing shell/.test(fixed.err || ""),
    `ipos+cls "${(badKind.err || "ok").slice(0, 50)}"; dsp "${(badVal.err || "ok").slice(0, 40)}"; change on existing "${(fixed.err || "ok").slice(0, 60)}"`);
  const st = await q(`SELECT p.pronargs n, COALESCE(p.proacl::text,'') acl FROM pg_proc p WHERE p.proname = 'save_template_draft'`);
  const rs = await q(`SELECT COALESCE(proacl::text,'') acl FROM pg_proc WHERE proname = 'cp_resolve_note_template'`);
  rec("R13/ACL save_template_draft: exactly one function (10 arguments), authenticated, no PUBLIC/anon; the resolver has no API role; S-OFF functions keep their ACLs",
    st.length === 1 && st[0].n === 10 && /authenticated=X/.test(st[0].acl) && !/(^|[{,])=X|anon=X/.test(st[0].acl) && rs.length === 1 && !/authenticated|anon|(^|[{,])=X/.test(rs[0].acl) && (await aclOf()) === aclBefore,
    `${JSON.stringify(st)}; resolver ${JSON.stringify(rs)}; S-OFF ACLs unchanged ${(await aclOf()) === aclBefore}`);
  console.log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
})().catch((e) => { console.log("HARNESS ERROR", e.message); process.exit(1); });

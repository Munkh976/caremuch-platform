// Phase B2 on PGlite: progress notes + billing over A/B1.
// Usage: node tests/ripple/pglite/phase-b2.cjs   (local PGlite, no network)
const path = require("path");
const MIG = path.resolve(__dirname, "../../../supabase/migrations") + "/", ROLLBACK = path.resolve(__dirname, "../../../docs/rollback") + "/";
const LIVE = __dirname + "/live/";
// live definitions: .sql snapshots, except those stored on DEV with carriage returns (kept exact in JSON)
const EXACT = JSON.parse(require("fs").readFileSync(LIVE + "exact_definitions.json", "utf8"));
const liveDef = (n) => EXACT[n] ? EXACT[n].definition : require("fs").readFileSync(LIVE + n + ".sql", "utf8");
// Local (PGlite) apply + behaviour tests of Phase B2 on top of Phase A + B1. No remote database.
// All dates/times come from the database clock (now() in the office time zone), never the machine.
const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const FILES = fs.readdirSync(MIG).filter((f) => /^2026100(612|712|812)/.test(f)).sort();
const B2 = FILES.filter((f) => /^20261008/.test(f));
const A = "56fbfe38-e8eb-40c1-ba27-07428f62ed2e", OX = "12faa863-017e-438c-966c-f67be9b726e7", OY = "56785edd-ce66-4bf0-a487-abb628f21fef";
const B = "bbbbbbbb-0000-0000-0000-000000000001", OZ = "bbbbbbbb-0000-0000-0000-0000000000a1", TZ = "America/New_York";
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const users = { aaA: U(1), mgrX: U(2), mgrY: U(3), schX: U(4), hrX: U(5), cg: U(6), cl: U(7), aaB: U(8), sysA: U(9), cg2: U(11) };
const CX = U(101), CY = U(102), CR1 = U(104), CR2 = U(105), CR3 = U(106), GX1 = U(201), GX2 = U(202);
const rows = []; const rec = (id, ok, d) => { rows.push({ id, ok }); console.log(`${id} ${ok ? "PASS" : "FAIL"} :: ${d}`); };
const DENY = /Not found or not allowed|permission denied/;

(async () => {
  const db = new PGlite();
  for (const f of ["stub.sql", "live_helpers.sql", "stub_b1.sql", "stub_b2.sql"]) await db.exec(fs.readFileSync(__dirname + "/" + f, "utf8"));
  await db.exec(`INSERT INTO agency VALUES ('${A}','A'),('${B}','B');
    INSERT INTO virtual_office (id, agency_id, name, timezone) VALUES ('${OX}','${A}','X','${TZ}'),('${OY}','${A}','Y','${TZ}'),('${OZ}','${B}','Z','${TZ}');
    INSERT INTO care_types (code) VALUES ('CLS0001'),('RESP0001');`);
  for (const f of FILES) { try { await db.exec(fs.readFileSync(MIG + f, "utf8")); } catch (e) { console.log("APPLY FAILED", f, "::", e.message); process.exit(1); } }
  console.log(`applied ${FILES.length} migrations (Phase A + B1 + ${B2.length} B2)`);
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  const d = (await q(`SELECT (now() AT TIME ZONE '${TZ}')::date AS today, now() AS dbnow`))[0];
  const day = async (n) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text AS d`, [n]))[0].d;
  console.log(`database clock: ${d.dbnow.toISOString()} (office day ${(await day(0))}); all dates below derive from it`);

  await db.exec(`
    INSERT INTO profiles (id, agency_id, virtual_office_id, office_restricted, full_name) VALUES
      ('${users.aaA}','${A}',NULL,false,'AA'), ('${users.mgrX}','${A}','${OX}',true,'Fixture Manager'), ('${users.mgrY}','${A}','${OY}',true,'MY'),
      ('${users.schX}','${A}','${OX}',true,'S'), ('${users.hrX}','${A}','${OX}',true,'H'), ('${users.cg}','${A}','${OX}',false,'CG'),
      ('${users.cg2}','${A}','${OX}',false,'CG2'), ('${users.cl}','${A}',NULL,false,'CL'), ('${users.aaB}','${B}',NULL,false,'AB'), ('${users.sysA}','${A}',NULL,false,'SA');
    INSERT INTO user_roles (user_id, role, agency_id) VALUES
      ('${users.aaA}','agency_admin','${A}'), ('${users.mgrX}','manager','${A}'), ('${users.mgrY}','manager','${A}'), ('${users.schX}','scheduler','${A}'),
      ('${users.hrX}','hr_staff','${A}'), ('${users.cg}','caregiver','${A}'), ('${users.cg2}','caregiver','${A}'), ('${users.cl}','client','${A}'),
      ('${users.aaB}','agency_admin','${B}'), ('${users.sysA}','system_admin','${A}');
    INSERT INTO clients (id, agency_id, user_id, first_name, last_name, virtual_office_id) VALUES
      ('${CX}','${A}','${users.cl}','Cora','Xavier','${OX}'), ('${CY}','${A}',NULL,'Yan','Y','${OY}'),
      ('${CR1}','${A}',NULL,'R1','One','${OX}'), ('${CR2}','${A}',NULL,'R2','Two','${OX}'), ('${CR3}','${A}',NULL,'R3','Three','${OX}');
    INSERT INTO caregivers VALUES ('${GX1}','${A}','${users.cg}','G1','${OX}'), ('${GX2}','${A}','${users.cg2}','G2','${OX}');
    INSERT INTO cp_default_service_types (care_type_code, service_type) VALUES ('CLS0001','cls'),('RESP0001','respite');`);

  const call = async (who, sql, params = []) => {
    await db.exec("BEGIN");
    try {
      if (who === "anon") await db.exec("SET LOCAL ROLE anon");
      else if (who !== "su") { await db.exec("SET LOCAL ROLE authenticated"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users[who]]); }
      const r = await db.query(sql, params); await db.exec("COMMIT"); return { rows: r.rows, v: r.rows[0] && Object.values(r.rows[0])[0] };
    } catch (e) { await db.exec("ROLLBACK"); return { err: e.message }; }
  };
  const must = async (who, sql, params) => { const r = await call(who, sql, params); if (r.err) { console.log("SETUP FAILED:", sql.slice(0, 80), "::", r.err); process.exit(1); } return r.v; };

  // ---------- B1 setup through the RPCs ----------
  await must("aaA", "SELECT seed_office_care_plan_defaults($1)", [OX]);
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb)", [CX, JSON.stringify({ effective_date: await day(-60), expiration_date: await day(300) })]);
  await must("mgrX", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan, JSON.stringify([
    { seq: 1, goal_text: "Goal one", objectives: [{ letter: "A", seq: 1, objective_text: "Brush teeth", staff_instructions: "Model first", service_type: "cls", responsible_party: "this_agency" },
                                                  { letter: "B", seq: 2, objective_text: "CM follow-up", responsible_party: "case_management" }] },
    { seq: 2, goal_text: "Goal two", objectives: [{ letter: "A", seq: 1, objective_text: "Respite objective", service_type: "respite", responsible_party: "this_agency" }] }])]);
  const objA = (await q(`SELECT o.id FROM care_plan_objectives o JOIN care_plan_goals g ON g.id=o.goal_id WHERE g.care_plan_id=$1 AND g.seq=1 AND o.seq=1`, [plan]))[0].id;
  const mt = Object.fromEntries((await q(`SELECT kind, id FROM measure_types WHERE agency_id IS NULL`)).map((r) => [r.kind, r.id]));
  await must("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [objA, JSON.stringify([
    { measure_type_id: mt.yes_no_na, prompt_text: "Participated?" }, { measure_type_id: mt.prompt_level, prompt_text: "Highest prompt" },
    { measure_type_id: mt.graded_steps, prompt_text: "Steps tolerated", options: ["Touch", "Hold", "Clip"] }, { measure_type_id: mt.tally, prompt_text: "Interactions" },
    { measure_type_id: mt.trials, prompt_text: "Trials", trial_count: 2 }, { measure_type_id: mt.short_answer, prompt_text: "Strategy" },
    { measure_type_id: mt.narrative, prompt_text: "Describe" }, { measure_type_id: mt.staff_note, prompt_text: "Do not continue if distressed" }])]);
  const AUTH = "SELECT create_service_authorization($1,$2,$3,$4,$5::date,$6::date)";
  const early = await must("mgrX", AUTH, [CX, "cls", "AUTH-EARLY", 8, await day(-60), await day(10)]);
  const late = await must("mgrX", AUTH, [CX, "cls", "AUTH-LATE", 40, await day(-60), await day(60)]);
  await must("mgrX", AUTH, [CR2, "respite", "AUTH-OLD", 40, await day(-90), await day(-20)]);
  await must("mgrX", AUTH, [CR3, "respite", "AUTH-SMALL", 2, await day(-60), await day(60)]);

  // ---------- shifts (local times in the office zone) ----------
  const shifts = {};
  const mkShift = async (key, client, cg, code, dayOff, start, end, status = "assigned") => {
    shifts[key] = U(300 + Object.keys(shifts).length + 1);
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, caregiver_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status)
                    VALUES ($1,$2,$3,$4,$5,$6::date,$7::time,$8::time,$9,$10::shift_status)`, [shifts[key], A, client, cg, code, await day(dayOff), start, end, OX, status]);
  };
  await mkShift("S1", CX, GX1, "CLS0001", -1, "13:00", "14:00"); await mkShift("S2", CX, GX1, "CLS0001", -1, "15:00", "16:00");
  await mkShift("S3", CX, GX1, "CLS0001", -2, "09:00", "10:00"); await mkShift("S4", CX, GX1, "CLS0001", -3, "09:00", "10:00");
  await mkShift("R1", CR1, GX1, "RESP0001", -1, "10:00", "11:00"); await mkShift("R2", CR2, GX1, "RESP0001", -1, "10:00", "11:00");
  await mkShift("R3", CR3, GX1, "RESP0001", -1, "10:00", "11:00"); await mkShift("S6", CX, GX1, "CLS0001", 1, "09:00", "10:00");
  await mkShift("S7", CX, null, "CLS0001", -1, "17:00", "18:00", "open"); await mkShift("S8", CX, GX1, "CLS0001", -4, "09:00", "10:00");
  await mkShift("S9", CX, GX2, "CLS0001", -1, "18:00", "19:00"); await mkShift("SY", CY, GX1, "CLS0001", -1, "09:00", "10:00");

  const ev = async (subject) => (await q(`SELECT event_type, payload FROM events WHERE subject_id=$1 ORDER BY created_at, id`, [subject]));
  const audit = [];
  const audited = async (step, who, sql, params, expType, subjectFn) => {
    const seen = new Set((await q(`SELECT id FROM events`)).map((e) => e.id));          // snapshot just before the call
    const r = await call(who, sql, params); const subj = subjectFn ? subjectFn(r) : (typeof r.v === "string" ? r.v : params[0]);
    const newEvs = subj ? (await q(`SELECT id, event_type, payload FROM events WHERE subject_id=$1 ORDER BY created_at, id`, [subj])).filter((e) => !seen.has(e.id)) : [];
    const n = newEvs.length;
    audit.push({ step, subj, n, expType, ok: (expType ? n === 1 && newEvs[0].event_type === expType : n === 0)
      && newEvs.every((e) => Object.values(e.payload).every((x) => typeof x === "number" || typeof x === "boolean" || (typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)))), err: r.err });
    return r;
  };
  const note = async (id) => (await q(`SELECT * FROM progress_notes WHERE id=$1`, [id]))[0];
  const avail = async (id) => Number((await q(`SELECT units_available a FROM service_authorizations WHERE id=$1`, [id]))[0].a);
  const at = async (shiftKey, plusSec) => (await q(`SELECT (scheduled_start + $2 * interval '1 second')::text t FROM progress_notes WHERE shift_id=$1 AND NOT voided`, [shifts[shiftKey], plusSec]))[0].t;
  const CREATE = "SELECT create_progress_note_for_shift($1)", SAVE = "SELECT save_progress_note_draft($1,$2::jsonb,$3::jsonb,$4)",
    SUBMIT = "SELECT submit_progress_note($1,$2)", REVIEW = "SELECT review_progress_note($1,$2,$3)", RETURN = "SELECT return_progress_note($1,$2)",
    VOID = "SELECT void_progress_note($1,$2)";
  const entryOf = async (nid) => (await q(`SELECT id FROM progress_note_entries WHERE progress_note_id=$1`, [nid]));
  const measures = (await q(`SELECT id, seq FROM objective_measures WHERE objective_id=$1 ORDER BY seq`, [objA])).map((r) => r.id);
  const goodData = () => ({ [measures[0]]: { value: "N/A" }, [measures[1]]: { value: "Verbal" }, [measures[2]]: { steps: [0, 1] }, [measures[3]]: { count: 4 },
    [measures[4]]: { trials: [{ value: "Yes", text: "Board game" }, { value: "No" }] }, [measures[5]]: { value: "Visual card" }, [measures[6]]: { value: "Calm session" } });

  // ===== N1 create: caregiver from shift start, idempotent, CLS entries, times in office zone =====
  const n1 = await audited("create S1", "cg", CREATE, [shifts.S1], "progress_note_created");
  const n1b = await audited("create S1 again", "cg", CREATE, [shifts.S1], null, () => n1.v);
  const N1 = await note(n1.v); const ents = await entryOf(n1.v);
  const expStart = (await q(`SELECT ((shift_date + start_time) AT TIME ZONE '${TZ}') s FROM shifts WHERE id=$1`, [shifts.S1]))[0].s;
  rec("N1 create from shift (caregiver), idempotent, 1 CLS entry (no CM, no respite objective), units 4, office-zone times, plan + training_version stored",
    !n1.err && n1b.v === n1.v && ents.length === 1 && N1.note_kind === "cls" && Number(N1.units_scheduled) === 4 && N1.scheduled_start.getTime() === expStart.getTime()
      && N1.care_plan_id === plan && N1.training_version === 1 && N1.authorization_id === null,
    `id ${n1.err || "ok"}, second call same id ${n1b.v === n1.v}; entries ${ents.length}; kind ${N1.note_kind}; units ${N1.units_scheduled}; start ${N1.scheduled_start.toISOString()} = (date+13:00) ${TZ}; plan stored ${N1.care_plan_id === plan}; tv ${N1.training_version}`);

  // ===== N2 caregiver payload: exact keys =====
  const view = (await call("cg", "SELECT get_progress_note_for_caregiver($1)", [n1.v])).v;
  const NOTE_KEYS = "arrived_late,client_arrived_at,client_first_name,client_last_initial,due_at,id,late_submitted,location,narrative_text,note_kind,actual_end,returned_reason,scheduled_end,scheduled_start,service_date,staff_client_ratio,staff_signature_name,staff_signed_at,status".split(",").sort().join(",");
  const ENTRY_KEYS = "answers,entry_id,goal_text,measures,notes_text,objective_letter,objective_text,staff_instructions";
  const MEASURE_KEYS = "kind,measure_id,options,prompt_text,trial_count";
  const keysOk = Object.keys(view).sort().join(",") === "entries,note" && Object.keys(view.note).sort().join(",") === NOTE_KEYS
    && view.entries.every((e) => Object.keys(e).sort().join(",") === ENTRY_KEYS && e.measures.every((m) => Object.keys(m).sort().join(",") === MEASURE_KEYS));
  const leakWords = /units|authorization|pay|rate|diagnos|michicans|need|medical|address|phone|email|dob|birth/i;
  rec("N2 caregiver payload has exactly the allowed keys (no needs, diagnoses, MichiCANS, other objectives, other clients, units, pay)",
    keysOk && !leakWords.test(JSON.stringify(Object.keys(view.note))) && view.entries.length === 1 && view.entries[0].objective_text === "Brush teeth" && view.note.client_last_initial === "X",
    `top ${Object.keys(view).sort()}; note keys ${Object.keys(view.note).length}; entry keys ok; client shown as "${view.note.client_first_name} ${view.note.client_last_initial}."; objectives ${view.entries.map((e) => e.objective_text)}`);

  // ===== N3 draft validation =====
  const e1 = ents[0].id;
  const bad = { yesno: { [measures[0]]: { value: "Maybe" } }, prompt: { [measures[1]]: { value: "Shouted" } }, stepsRange: { [measures[2]]: { steps: [5] } },
    stepsDup: { [measures[2]]: { steps: [1, 1] } }, tallyNeg: { [measures[3]]: { count: -1 } }, tallyFrac: { [measures[3]]: { count: 1.5 } },
    trialsCount: { [measures[4]]: { trials: [{ value: "Yes" }] } }, staffNote: { [measures[7]]: { value: "x" } }, unknown: { [U(999)]: { value: "Yes" } },
    longText: { [measures[5]]: { value: "x".repeat(501) } } };
  const badRes = {};
  for (const [k, v] of Object.entries(bad)) { const r = await call("cg", SAVE, [n1.v, "{}", JSON.stringify([{ entry_id: e1, data: v }]), null]); badRes[k] = r.err ? "rejected" : "accepted"; }
  const early60 = await call("cg", SAVE, [n1.v, JSON.stringify({ client_arrived_at: await at("S1", -3601) }), "[]", null]);
  const afterEnd = await call("cg", SAVE, [n1.v, JSON.stringify({ client_arrived_at: await at("S1", 3601) }), "[]", null]);
  const naive = await call("cg", SAVE, [n1.v, JSON.stringify({ client_arrived_at: "13:05" }), "[]", null]);
  const good = await call("cg", SAVE, [n1.v, JSON.stringify({ client_arrived_at: await at("S1", 180), staff_client_ratio: "1:3", location: "Center" }),
    JSON.stringify([{ entry_id: e1, notes_text: "Used a reward chart", data: goodData() }]), null]);
  rec("N3 draft: every invalid answer and an arrival outside the window rejected; valid draft saved",
    Object.values(badRes).every((x) => x === "rejected") && !!early60.err && !!afterEnd.err && !!naive.err && !good.err,
    `${JSON.stringify(badRes)}; arrival 60m+1s early: ${early60.err ? "rejected" : "accepted"}; after end: ${afterEnd.err ? "rejected" : "accepted"}; not a timestamp: ${naive.err ? "rejected" : "accepted"}; valid: ${good.err || "saved"}`);

  // ===== N4 submit, snapshot, review FIFO =====
  const sub1 = await audited("submit S1", "cg", SUBMIT, [n1.v, "Fixture Caregiver"], "progress_note_submitted");
  const snapBefore = JSON.stringify((await q(`SELECT measures_snapshot s FROM progress_note_entries WHERE id=$1`, [e1]))[0].s);
  await must("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [objA, JSON.stringify([{ measure_type_id: mt.yes_no_na, prompt_text: "A different question" }])]);
  const snapAfter = JSON.stringify((await q(`SELECT measures_snapshot s FROM progress_note_entries WHERE id=$1`, [e1]))[0].s);
  const viewAfter = (await call("cg", "SELECT get_progress_note_for_caregiver($1)", [n1.v])).v;
  const rv1 = await audited("review S1", "mgrX", REVIEW, [n1.v, true, null], "progress_note_reviewed", () => n1.v);
  const N1r = await note(n1.v);
  rec("N4 submit (typed name + time, not late), measures_snapshot unchanged after the measures are edited, review picks the earliest-expiring authorization",
    !sub1.err && N1r.staff_signature_name === "Fixture Caregiver" && N1r.late_submitted === false && snapBefore === snapAfter && JSON.parse(snapBefore).length === 8
      && viewAfter.entries[0].measures.length === 8 && !rv1.err && N1r.authorization_id === early && (await avail(early)) === 4,
    `submit ${sub1.err || "ok"} late=${N1r.late_submitted}; snapshot ${JSON.parse(snapBefore).length} questions, unchanged ${snapBefore === snapAfter}; caregiver still sees ${viewAfter.entries[0].measures.length}; review -> EARLY, EARLY left ${await avail(early)}`);
  // restore the 8 measures for later notes
  await must("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [objA, JSON.stringify([
    { measure_type_id: mt.yes_no_na, prompt_text: "Participated?" }, { measure_type_id: mt.prompt_level, prompt_text: "Highest prompt" },
    { measure_type_id: mt.graded_steps, prompt_text: "Steps tolerated", options: ["Touch", "Hold", "Clip"] }, { measure_type_id: mt.tally, prompt_text: "Interactions" },
    { measure_type_id: mt.trials, prompt_text: "Trials", trial_count: 2 }, { measure_type_id: mt.short_answer, prompt_text: "Strategy" },
    { measure_type_id: mt.narrative, prompt_text: "Describe" }, { measure_type_id: mt.staff_note, prompt_text: "Do not continue if distressed" }])]);
  const ms2 = (await q(`SELECT id FROM objective_measures WHERE objective_id=$1 ORDER BY seq`, [objA])).map((r) => r.id);
  const data2 = () => ({ [ms2[0]]: { value: "Yes" }, [ms2[1]]: { value: "Gestural" }, [ms2[2]]: { steps: [] }, [ms2[3]]: { count: 0 },
    [ms2[4]]: { trials: [{ value: "N/A" }, { value: "Yes", text: "Puzzle" }] }, [ms2[5]]: { value: "Timer" }, [ms2[6]]: { value: "Good day" } });
  const fill = async (key, arrivalSec, sign = true) => {
    const id = (await call("cg", CREATE, [shifts[key]])).v; const e = (await entryOf(id))[0];
    const s = await call("cg", SAVE, [id, JSON.stringify({ client_arrived_at: await at(key, arrivalSec) }), JSON.stringify(e ? [{ entry_id: e.id, data: data2() }] : []), null]);
    if (s.err) console.log("fill save", key, s.err);
    return id;
  };

  // ===== N5 late arrival + return / fix / resubmit =====
  const n2 = await fill("S2", 360);
  await audited("submit S2", "cg", SUBMIT, [n2, "Fixture Caregiver"], "progress_note_submitted");
  const retNoReason = await call("mgrX", RETURN, [n2, " "]);
  const ret = await audited("return S2", "mgrX", RETURN, [n2, "Please describe the strategy"], "progress_note_returned", () => n2);
  const cgSees = (await call("cg", "SELECT get_progress_note_for_caregiver($1)", [n2])).v.note;
  const mgrEdit = await call("mgrX", SAVE, [n2, JSON.stringify({ location: "x" }), "[]", null]);
  const mgrDirect = await call("mgrX", `UPDATE progress_notes SET location='x' WHERE id='${n2}'`);
  const fix = await call("cg", SAVE, [n2, JSON.stringify({ location: "Community center" }), "[]", null]);
  const resub = await audited("resubmit S2", "cg", SUBMIT, [n2, "Fixture Caregiver"], "progress_note_submitted");
  const rv2 = await audited("review S2", "mgrX", REVIEW, [n2, true, null], "progress_note_reviewed", () => n2);
  const N2 = await note(n2);
  rec("N5 late arrival 4 -> 3; return needs a reason; caregiver sees it, fixes, resubmits; reviewer has no edit path; FIFO draws EARLY again",
    Number(N2.units_used) === 3 && N2.arrived_late && !!retNoReason.err && !ret.err && cgSees.status === "returned" && cgSees.returned_reason === "Please describe the strategy"
      && DENY.test(mgrEdit.err || "") && DENY.test(mgrDirect.err || "") && !fix.err && !resub.err && !rv2.err && N2.authorization_id === early && (await avail(early)) === 1 && N2.returned_count === 1,
    `units ${N2.units_used} late=${N2.arrived_late}; return without reason: ${retNoReason.err ? "refused" : "accepted"}; caregiver sees "${cgSees.returned_reason}"; manager draft edit: ${mgrEdit.err ? "refused" : "accepted"}; manager direct UPDATE: ${mgrDirect.err ? "refused" : "accepted"}; resubmit ${resub.err || "ok"}; review -> EARLY, left ${await avail(early)}`);

  // ===== N6 boundary +5:00 / +5:01, FIFO rollover, late submission =====
  const n3 = await fill("S3", 300); await call("cg", SUBMIT, [n3, "Fixture Caregiver"]);
  const rv3 = await audited("review S3", "mgrX", REVIEW, [n3, true, null], "progress_note_reviewed", () => n3);
  const n4 = await fill("S4", 301); const s4 = await call("cg", SUBMIT, [n4, "Fixture Caregiver"]);
  const N3 = await note(n3), N4 = await note(n4);
  const tsTypes = (await q(`SELECT string_agg(column_name||':'||data_type, ', ' ORDER BY column_name) t FROM information_schema.columns WHERE table_name='progress_notes' AND column_name IN ('scheduled_start','client_arrived_at','due_at')`))[0].t;
  rec("N6 arrival exactly +5:00 -> 4 (not late), +5:01 -> 3 (late), both timestamptz; EARLY exhausted -> next note draws AUTH-LATE; submit past the deadline is accepted and marked late_submitted",
    Number(N3.units_used) === 4 && !N3.arrived_late && Number(N4.units_used) === 3 && N4.arrived_late && !rv3.err && N3.authorization_id === late && (await avail(late)) === 36
      && !s4.err && N4.late_submitted === true && tsTypes === "client_arrived_at:timestamp with time zone, due_at:timestamp with time zone, scheduled_start:timestamp with time zone",
    `+5:00 -> ${N3.units_used}/${N3.arrived_late}; +5:01 -> ${N4.units_used}/${N4.arrived_late}; S3 drew ${N3.authorization_id === late ? "AUTH-LATE" : N3.authorization_id} (EARLY had 1 left), LATE left ${await avail(late)}; S4 late_submitted=${N4.late_submitted}; ${tsTypes}`);

  // ===== N7 respite group session + refusal reasons =====
  const rn = {}; for (const k of ["R1", "R2", "R3"]) rn[k] = (await call("cg", CREATE, [shifts[k]])).v;
  const rEntries = (await q(`SELECT count(*)::int n FROM progress_note_entries WHERE progress_note_id = ANY($1::uuid[])`, [Object.values(rn)]))[0].n;
  for (const k of ["R1", "R2", "R3"]) await call("cg", SAVE, [rn[k], JSON.stringify({ client_arrived_at: await at(k, 0) }), "[]", null]);
  const noNarr = await call("cg", SUBMIT, [rn.R1, "Fixture Caregiver"]);
  const narrOnCls = await call("cg", SAVE, [(await call("cg", CREATE, [shifts.S8])).v, "{}", "[]", "narrative on a CLS note"]);
  for (const k of ["R1", "R2", "R3"]) { await call("cg", SAVE, [rn[k], "{}", "[]", "Session narrative: calm, went for a walk"]); await call("cg", SUBMIT, [rn[k], "Fixture Caregiver"]); }
  const rR1 = await call("mgrX", REVIEW, [rn.R1, true, null]), rR2 = await call("mgrX", REVIEW, [rn.R2, true, null]), rR3 = await call("mgrX", REVIEW, [rn.R3, true, null]);
  const stillSub = (await q(`SELECT count(*)::int n FROM progress_notes WHERE id = ANY($1::uuid[]) AND status='submitted'`, [Object.values(rn)]))[0].n;
  const nbNoReason = await call("mgrX", REVIEW, [rn.R1, false, null]);
  const nb = await audited("review R1 non-billable", "mgrX", REVIEW, [rn.R1, false, "Client left after 10 minutes"], "progress_note_reviewed", () => rn.R1);
  const NR1 = await note(rn.R1);
  rec("N7 group session: 3 clients' shifts in one slot -> 3 respite notes, no entries; narrative required; review refusals give the reason and leave the note submitted; non-billable needs a reason and uses 0 units",
    Object.values(rn).every(Boolean) && new Set(Object.values(rn)).size === 3 && rEntries === 0 && /narrative/.test(noNarr.err || "") && /respite note/.test(narrOnCls.err || "")
      && /no authorization/.test(rR1.err || "") && /outside/.test(rR2.err || "") && /not enough authorized units/.test(rR3.err || "") && stillSub === 3
      && /needs a reason/.test(nbNoReason.err || "") && !nb.err && Number(NR1.units_used) === 0 && NR1.billable === false,
    `notes ${new Set(Object.values(rn)).size}, entries ${rEntries}; submit without narrative: ${noNarr.err ? "refused" : "accepted"}; narrative on CLS: ${narrOnCls.err ? "refused" : "accepted"}; R1 "${(rR1.err || "").slice(0, 60)}"; R2 "${(rR2.err || "").slice(0, 70)}"; R3 "${(rR3.err || "").slice(0, 60)}"; still submitted ${stillSub}/3; non-billable ${nb.err || "ok"} units ${NR1.units_used}`);

  // ===== N8 shift-start rule, unassigned shift, another caregiver's note =====
  const futCg = await call("cg", CREATE, [shifts.S6]); const futMgr = await call("mgrX", CREATE, [shifts.S6]);
  const futSubmit = futMgr.v && await call("cg", SUBMIT, [futMgr.v, "Fixture Caregiver"]);
  const unCg = await call("cg", CREATE, [shifts.S7]); const unMgr = await call("mgrX", CREATE, [shifts.S7]);
  const n9 = (await call("mgrX", CREATE, [shifts.S9])).v;
  const other = { get: await call("cg", "SELECT get_progress_note_for_caregiver($1)", [n9]), save: await call("cg", SAVE, [n9, "{}", "[]", null]), submit: await call("cg", SUBMIT, [n9, "x"]) };
  const own2 = await call("cg2", "SELECT get_progress_note_for_caregiver($1)", [n9]);
  const cgMgr = {}; for (const [k, sql, p] of [["return", RETURN, [n2, "x"]], ["review", REVIEW, [n3, true, null]], ["void", VOID, [n3, "x"]], ["overdue", "SELECT list_overdue_notes($1)", [OX]], ["build", "SELECT build_billing_batch($1,$2::date)", [OX, await day(-1)]]]) {
    const r = await call("cg", sql, p); cgMgr[k] = r.err && DENY.test(r.err) ? "refused" : (r.err || "ALLOWED"); }
  rec("N8 caregiver: note opens at shift start (manager can pre-create); unassigned shift and another caregiver's note -> generic refusal; manager RPCs refused",
    /opens when the shift starts/.test(futCg.err || "") && !futMgr.err && /once the shift has started/.test((futSubmit && futSubmit.err) || "") && DENY.test(unCg.err || "")
      && /no assigned caregiver/.test(unMgr.err || "") && Object.values(other).every((r) => DENY.test(r.err || "")) && !own2.err && Object.values(cgMgr).every((x) => x === "refused"),
    `future: caregiver ${futCg.err ? "refused" : "accepted"}, manager ${futMgr.err || "ok"}, caregiver submit ${futSubmit && futSubmit.err ? "refused" : "accepted"}; unassigned: caregiver ${unCg.err ? "refused" : "accepted"}, manager "${(unMgr.err || "").slice(0, 40)}"; other's note get/save/submit refused; owner reads ok; ${JSON.stringify(cgMgr)}`);

  // ===== N9 void restores units =====
  const beforeVoid = await avail(late);
  const vd = await audited("void S3", "mgrX", VOID, [n3, "Entered against the wrong shift"], "progress_note_voided", () => n3);
  const recreate = await call("cg", CREATE, [shifts.S3]);
  rec("N9 void (reason) restores the units; the shift can get a fresh note", !vd.err && beforeVoid === 36 && (await avail(late)) === 40 && recreate.v && recreate.v !== n3,
    `LATE ${beforeVoid} -> ${await avail(late)}; new note for the shift ${recreate.v && recreate.v !== n3}`);

  // ===== N10 overdue at the office-zone boundary =====
  const n8 = (await q(`SELECT id, due_at, service_date FROM progress_notes WHERE shift_id=$1 AND NOT voided`, [shifts.S8]))[0];
  const local = (await q(`SELECT (($1::timestamptz - interval '1 minute') AT TIME ZONE '${TZ}')::text a, ($1::timestamptz AT TIME ZONE '${TZ}')::text b, (($2::date + 1)::text || ' 23:59:00') ea, (($2::date + 2)::text || ' 00:00:00') eb`, [n8.due_at, n8.service_date]))[0];
  const lst = async (asOf) => ((await call("mgrX", "SELECT list_overdue_notes($1,$2::timestamptz)", [OX, asOf])).v || []).map((x) => x.note_id);
  const at2359 = await lst(new Date(n8.due_at.getTime() - 60000).toISOString()), at0000 = await lst(n8.due_at.toISOString());
  const nowList = await lst(null);
  rec("N10 overdue at DB time in the office zone: 23:59 of the day after -> not overdue; 00:00 of the second day -> overdue",
    local.a === local.ea && local.b === local.eb && !at2359.includes(n8.id) && at0000.includes(n8.id) && nowList.includes(n8.id) && !nowList.includes(n1.v),
    `deadline local ${local.b} (expected ${local.eb}); 1 minute before = ${local.a}; listed at 23:59 ${at2359.includes(n8.id)}, at 00:00 ${at0000.includes(n8.id)}; at DB now: draft S8 listed ${nowList.includes(n8.id)}, submitted S1 not listed ${!nowList.includes(n1.v)}`);

  // ===== N11 billing =====
  const wk = (await q(`SELECT date_trunc('week', $1::date)::date::text w, (date_trunc('week', $1::date)::date + 1)::text w2`, [await day(-1)]))[0];
  const wrongStart = await call("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, wk.w2]);
  const bb = await audited("build batch", "mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, wk.w], "billing_batch_built", (r) => r.v && r.v.batch_id);
  const batch = bb.v.batch_id;
  const incl = (await q(`SELECT id FROM progress_notes WHERE billing_batch_id=$1 ORDER BY id`, [batch])).map((r) => r.id);
  const exReason = Object.fromEntries((bb.v.excluded || []).map((x) => [x.note_id, x.reason]));
  const lines = (await call("mgrX", "SELECT get_billing_batch($1)", [batch])).v.lines;
  const clean = await audited("approve clean", "mgrX", "SELECT approve_clean_rows($1)", [batch], "billing_batch_approved");
  const earlyBill = await call("mgrX", "SELECT mark_batch_billed($1)", [batch]);
  const appr = await audited("approve S2", "mgrX", "SELECT approve_batch_notes($1,$2::uuid[])", [batch, `{${n2}}`], "billing_batch_approved", () => batch);
  const billed = await audited("mark billed", "mgrX", "SELECT mark_batch_billed($1)", [batch], "billing_batch_billed");
  const st = (await q(`SELECT status FROM progress_notes WHERE id = ANY($1::uuid[])`, [[n1.v, n2]])).map((r) => r.status);
  rec("N11 batch on the office's billing week: wrong start day refused; includes the reviewed billable notes only, excluded ones with reasons; lines by client x authorization; clean rows approved in bulk, the late/returned one individually; billed",
    /starts on ISO day 1/.test(wrongStart.err || "") && incl.length === 2 && incl.includes(n1.v) && incl.includes(n2) && exReason[rn.R2] === "submitted, not reviewed"
      && exReason[rn.R1] === "non-billable" && lines.length === 1 && Number(lines[0].units_scheduled) === 8 && Number(lines[0].units_billed) === 7 && Number(lines[0].units_lost_late) === 1
      && clean.v && clean.v.approved === 1 && /Approve every line/.test(earlyBill.err || "") && !appr.err && !billed.err && st.every((s) => s === "billed"),
    `wrong start: ${wrongStart.err ? "refused" : "accepted"}; included ${incl.length} (S1, S2); excluded ${JSON.stringify(Object.values(exReason))}; line ${lines.length}: scheduled ${lines[0] && lines[0].units_scheduled}, billed ${lines[0] && lines[0].units_billed}, lost late ${lines[0] && lines[0].units_lost_late}; clean approved ${clean.v && clean.v.approved}; bill before all approved: ${earlyBill.err ? "refused" : "accepted"}; billed ${billed.err || "ok"}`);

  // ===== N12 billed notes immutable =====
  const imm = { void: await call("mgrX", VOID, [n1.v, "x"]), ret: await call("mgrX", RETURN, [n1.v, "x"]), review: await call("mgrX", REVIEW, [n1.v, true, null]),
    cgSave: await call("cg", SAVE, [n1.v, "{}", "[]", null]), rebuild: await call("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, wk.w]),
    approveAgain: await call("mgrX", "SELECT approve_clean_rows($1)", [batch]) };
  let gNote, gEntry, gBatch;
  await db.exec("BEGIN"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users.mgrX]);
  try { await db.query(`UPDATE progress_notes SET location='edited' WHERE id=$1`, [n1.v]); gNote = "changed"; } catch (e) { gNote = e.message; }
  await db.exec("ROLLBACK"); await db.exec("BEGIN"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users.mgrX]);
  try { await db.query(`UPDATE progress_note_entries SET notes_text='edited' WHERE progress_note_id=$1`, [n1.v]); gEntry = "changed"; } catch (e) { gEntry = e.message; }
  await db.exec("ROLLBACK"); await db.exec("BEGIN"); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [users.mgrX]);
  try { await db.query(`UPDATE billing_batches SET export_ref='x' WHERE id=$1`, [batch]); gBatch = "changed"; } catch (e) { gBatch = e.message; }
  await db.exec("ROLLBACK");
  rec("N12 a billed note can't be voided, returned, re-reviewed or edited (RPCs refuse; guard triggers block even an owner-level write with a user id); billed batch immutable",
    Object.values(imm).every((r) => !!r.err) && /billed note cannot/.test(gNote) && /billed note cannot/.test(gEntry) && /billed batch cannot/.test(gBatch),
    `${Object.entries(imm).map(([k, r]) => `${k}: ${r.err ? "refused" : "accepted"}`).join(", ")}; guard note "${gNote.slice(0, 32)}", entries "${gEntry.slice(0, 32)}", batch "${gBatch.slice(0, 32)}"`);

  // ===== D: role / scope denials for every RPC =====
  const ny = (await call("mgrY", CREATE, [shifts.SY])).v;   // office-Y note for cross-office checks
  const RPCS = {
    create_progress_note_for_shift: [CREATE, [shifts.S2]], get_progress_note_for_caregiver: ["SELECT get_progress_note_for_caregiver($1)", [n2]],
    save_progress_note_draft: [SAVE, [n4, "{}", "[]", null]], submit_progress_note: [SUBMIT, [n4, "x"]],
    return_progress_note: [RETURN, [n4, "x"]], review_progress_note: [REVIEW, [n4, true, null]], void_progress_note: [VOID, [n4, "x"]],
    list_overdue_notes: ["SELECT list_overdue_notes($1)", [OX]], build_billing_batch: ["SELECT build_billing_batch($1,$2::date)", [OX, wk.w]],
    get_billing_batch: ["SELECT get_billing_batch($1)", [batch]], approve_batch_notes: ["SELECT approve_batch_notes($1,$2::uuid[])", [batch, `{${n2}}`]],
    approve_clean_rows: ["SELECT approve_clean_rows($1)", [batch]], mark_batch_billed: ["SELECT mark_batch_billed($1)", [batch]],
  };
  const leaks = []; let n = 0;
  for (const [fn, [sql, p]] of Object.entries(RPCS)) for (const who of ["schX", "hrX", "cl", "anon", "mgrY", "aaB", "sysA"]) {
    const r = await call(who, sql, p); n++; if (!r.err || !DENY.test(r.err)) leaks.push(`${who}->${fn}: ${r.err ? r.err.slice(0, 40) : "ALLOWED"}`);
  }
  const ghost = await call("mgrX", REVIEW, [U(998), true, null]), otherOffice = await call("mgrX", REVIEW, [ny, true, null]);
  rec("D1 every B2 RPC refused for scheduler, hr_staff, client, anon, office-Y manager, agency-B admin, system_admin; missing and other-office rows give the same error",
    leaks.length === 0 && ghost.err === otherOffice.err, leaks.length ? leaks.join("; ") : `${n} denied calls, all refused ("${(ghost.err || "").slice(0, 30)}" for both)`);

  // ===== A1 / A2 audit =====
  const badA = audit.filter((a) => !a.ok);
  rec("A1 exactly one correlated event per audited write (none for the idempotent re-create); payloads ids/counts/flags only",
    badA.length === 0, badA.length ? JSON.stringify(badA) : `${audit.length} audited calls checked by subject id + event type`);
  await db.exec(`ALTER TABLE events DROP CONSTRAINT events_event_type_check, ADD CONSTRAINT events_event_type_check CHECK (event_type <> 'progress_note_voided') NOT VALID`);
  const n4row = await note(n4);
  const forced = await call("mgrX", VOID, [n4, "forced audit failure"]);
  const n4after = await note(n4);
  await db.exec(fs.readFileSync(MIG + FILES.find((f) => /mcpb1_01/.test(f)), "utf8"));
  rec("A2 forced audit failure aborts the void", !!forced.err && n4after.voided === false && n4row.voided === false, `void refused: ${forced.err ? forced.err.slice(0, 50) : "accepted"}; still not voided ${!n4after.voided}`);

  console.log("INFO concurrency: PGlite has one session, so two truly concurrent reviews can only run on DEV (after-run check C1); the sequential FIFO/units behaviour is covered by N6 and N7.");

  // ===== ACL =====
  const fns = await q(`SELECT p.proname, p.prosecdef d, COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, ',' ORDER BY 1) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE'), '(default)') g
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.oid > (SELECT max(oid) FROM pg_proc WHERE proname='override_training_record') ORDER BY 1`);
  const rpcs = Object.keys(RPCS);
  const badAcl = fns.filter((f) => f.g === "(default)" || /PUBLIC|anon/.test(f.g) || (rpcs.includes(f.proname) ? !(f.d && /authenticated/.test(f.g)) : /authenticated/.test(f.g)));
  fns.forEach((f) => console.log(`   ${f.proname} definer=${f.d} EXECUTE: ${f.g}`));
  rec("ACL every new B2 function: 13 RPCs definer + authenticated only; 8 internal helpers no API role", badAcl.length === 0 && fns.length === 21 && fns.filter((f) => rpcs.includes(f.proname)).length === 13,
    `${fns.length} new functions; offending: ${badAcl.map((f) => f.proname).join(", ") || "none"}`);
  console.log("summary: " + rows.map((r) => `${r.id.split(" ")[0]}=${r.ok ? "PASS" : "FAIL"}`).join(" "));
})().catch((e) => { console.log("HARNESS ERROR", e.message, e.stack.split("\n")[1]); process.exit(1); });

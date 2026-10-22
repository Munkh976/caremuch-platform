// S17 IPOS versions on PGlite: 20261029120000 (enum 'pending') + 20261029120100. Catalog (only the 10 approved function
// bodies and the events CHECK change; same identity arguments and ACLs), ACLs, start_pending_plan_version (v1 stays in
// effect: eligibility identical), edits of the pending version (no revisions, no training bump), activation (in-service
// alone doesn't; + one session does, exactly once; a later effective date waits for cp_activate_due_plans; a stale
// pending version never supersedes a newer one), revisions of the active version (no-change save doesn't bump; legacy
// plans get a baseline), plan_revision on training records, the shift creation limits 1a / 1d (inserts and moves;
// other updates, cancelled, no IPOS, no authorization, other offices unchanged), get_shift_creation_limits,
// list_ipos_expiry (1c), the training context on the pending version, files on a pending version.
// Usage: node tests/ripple/pglite/s17.cjs   (local, no network)
const H = require("./harness.cjs");
const ENUM = "20261029120000_s17_pending_status.sql", MIG = "20261029120100_s17_ipos_versions.sql";
const CHANGED = ["update_care_plan_fields", "upsert_care_plan_goals", "set_objective_measures", "set_care_plan_rows", "would_bump_training_version",
  "record_inservice_form", "record_training_form", "add_training_attendees", "get_client_training_context", "cp_attachment_parent"];
let seq = 0; const sid = () => H.U(9700 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(ENUM); const { db, q, call, must } = t;
  const { CX, G, OX, OY, A, TZ, users } = H;
  const at = async (k) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [k]))[0].d;
  const fns = async () => q(`SELECT p.proname n, pg_get_function_identity_arguments(p.oid) a, md5(p.prosrc) h, COALESCE(p.proacl::text,'') acl
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [CHANGED]);
  await db.query("UPDATE virtual_office SET care_plan_module_enabled = true, care_plan_module_enabled_at = now() - interval '40 days' WHERE id = $1", [OX]);
  await H.applyFiles(db, [ENUM]);
  const before = await H.snap(db), fB = await fns();
  await H.applyFiles(db, [MIG]);
  const after = await H.snap(db), fA = await fns();
  const removed = before.filter((x) => !after.includes(x)), added = after.filter((x) => !before.includes(x));
  const okRemoved = removed.every((x) => x.startsWith("con:events.events_event_type_check") || CHANGED.some((n) => x.startsWith(`fn:${n}(`)));
  const same = fB.length === 10 && fB.every((b) => { const a = fA.find((x) => x.n === b.n); return a && a.a === b.a && a.acl === b.acl && a.h !== b.h; });
  rec("F0 catalog: removed only the events CHECK and the 10 approved function bodies (same identity arguments and ACLs, new bodies); everything else is additive",
    okRemoved && removed.length === 11 && same && added.includes("rel:care_plan_revisions:r") && added.some((x) => x.startsWith("trg:CREATE TRIGGER trg_cp_guard_shift_dates")),
    `-${removed.length} (${removed.map((x) => x.split("(")[0].slice(3)).join(",").slice(0, 160)}); +${added.length}; same args/acl ${same}`);
  const acl = await H.aclCheck(q, ["start_pending_plan_version", "get_shift_creation_limits", "list_ipos_expiry", ...CHANGED.filter((n) => n !== "cp_attachment_parent"),
    "cp_attachment_parent", "cp_try_activate_plan", "cp_plan_snapshot", "cp_record_revision", "cp_revision_baseline", "cp_guard_shift_dates", "cp_shift_creation_limits"]);
  const due = (await q(`SELECT proacl::text a FROM pg_proc WHERE proname = 'cp_activate_due_plans'`))[0].a;
  rec("ACL new API RPCs and the changed ones: SECURITY DEFINER, authenticated only; internal cp_ helpers: no API role; cp_activate_due_plans: service_role only",
    acl.ok && /service_role=X/.test(due) && !/authenticated=X|anon=X|(^|[{,])=X/.test(due), `${acl.detail}; due ${due}`);

  // ---- fixtures: plan v1 with goals, measures, rows; authorization; caregiver G trained on v1
  const plan1 = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await at(-60), expiration_date: await at(20) }), "{}"]);
  await must("mgrX", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [plan1, JSON.stringify([{ seq: 1, goal_text: "Goal one", objectives: [{ seq: 1, letter: "A", objective_text: "Obj A", staff_instructions: "Do A", service_type: "cls" }] }])]);
  const objA = async (p) => (await q(`SELECT o.id FROM care_plan_objectives o JOIN care_plan_goals g ON g.id = o.goal_id WHERE g.care_plan_id = $1 AND o.letter = 'A'`, [p]))[0].id;
  const mt = (await q(`SELECT id FROM measure_types WHERE agency_id IS NULL AND kind = 'yes_no_na' LIMIT 1`))[0].id;
  await must("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [await objA(plan1), JSON.stringify([{ measure_type_id: mt, seq: 1, prompt_text: "Did A?" }])]);
  await must("mgrX", "SELECT create_service_authorization($1,'cls','AUTH-17',400,$2::date,$3::date)", [CX, await at(-60), await at(15)]);
  await must("mgrX", "SELECT record_inservice_form($1,'Robin Hale',$2,$3::date,now(),'{}'::jsonb)", [plan1, users.mgrX, await at(-50)]);
  await must("mgrX", "SELECT record_training_form($1,'ipos_initial',NULL,NULL,$2::jsonb,'{}'::jsonb)", [plan1, JSON.stringify([{ caregiver_id: G, training_date: await at(-49), trainer_name: "Pat", signed_date: await at(-49) }])]);
  const shift = async (k, extra = {}) => { const id = sid(); await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours)
      VALUES ($1,$2,$3,$4,$5::date,'09:00','10:00',$6,'open',1)`, [id, A, extra.client || CX, extra.code || "CLS0001", await at(k), extra.office || OX]); return id; };
  const S0 = await shift(3);
  const elig = async () => JSON.stringify((await call("mgrX", "SELECT check_assignment_eligibility($1,$2)", [S0, G])).v);
  const e0 = await elig();
  const snap1 = async () => (await q(`SELECT cp_plan_snapshot($1) s`, [plan1]))[0].s;
  const s1 = JSON.stringify(await snap1());

  // ---- P1 start a pending version
  const p2 = await must("mgrX", "SELECT start_pending_plan_version($1,'annual',$2::jsonb,NULL)", [plan1, JSON.stringify({ effective_date: await at(-1), expiration_date: await at(380) })]);
  const v = await q(`SELECT id, version, training_version tv, status::text st FROM care_plans WHERE client_id = $1 ORDER BY version`, [CX]);
  const copied = (await q(`SELECT count(*)::int n FROM care_plan_goals WHERE care_plan_id = $1`, [p2]))[0].n;
  const e1 = await elig();
  const ev = await q(`SELECT payload FROM events WHERE event_type = 'care_plan_renewed' AND subject_id = $1`, [p2]);
  rec("P1 'Start new IPOS version': v2 PENDING (training version 2, goals copied), v1 stays ACTIVE; the eligibility result for v1's caregiver is byte-identical; audit care_plan_renewed with pending: true",
    v.length === 2 && v[0].st === "active" && v[1].st === "pending" && v[1].tv === 2 && copied === 1 && e1 === e0 && ev.length === 1 && ev[0].payload.pending === true,
    `${v.map((x) => `v${x.version}:${x.st}:tv${x.tv}`).join(" ")}; eligibility same ${e1 === e0}`);
  const again = await call("mgrX", "SELECT start_pending_plan_version($1)", [plan1]);
  const deny = [];
  for (const who of ["hrX", "mgrY", "aaB", "schX", "cg", "anon"]) { const r = await call(who, "SELECT start_pending_plan_version($1)", [plan1]); if (r.err && H.DENY.test(r.err)) deny.push(who); }
  rec("P2 a second pending version is refused (reason); HR, office-Y manager, other agency, scheduler, caregiver, anon refused (generic)",
    /already pending/.test(again.err || "") && deny.length === 6, `${again.err}; ${deny.length}/6`);

  // ---- P3 edits of the pending version
  await must("mgrX", "SELECT update_care_plan_fields($1,$2::jsonb,NULL)", [p2, JSON.stringify({ facilitator_name: "New facilitator" })]);
  const wb = (await call("mgrX", "SELECT would_bump_training_version($1,$2::jsonb)", [p2, JSON.stringify([{ seq: 1, goal_text: "Goal one (v2)", objectives: [{ seq: 1, letter: "A", objective_text: "Obj A v2", staff_instructions: "Do A", service_type: "cls" }] }])])).v;
  await must("mgrX", "SELECT upsert_care_plan_goals($1,$2::jsonb)", [p2, JSON.stringify([{ seq: 1, goal_text: "Goal one (v2)", objectives: [{ seq: 1, letter: "A", objective_text: "Obj A v2", staff_instructions: "Do A", service_type: "cls" }] }])]);
  await must("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [await objA(p2), JSON.stringify([{ measure_type_id: mt, seq: 1, prompt_text: "Did A (v2)?" }])]);
  const rows2 = await call("mgrX", "SELECT set_care_plan_rows($1,'care_plan_natural_support',$2::jsonb)", [p2, JSON.stringify([{ name: "Aunt May", support_type: "natural" }])]);
  const revP = (await q(`SELECT count(*)::int n FROM care_plan_revisions WHERE care_plan_id = $1`, [p2]))[0].n;
  const p2row = (await q(`SELECT training_version tv, revision, facilitator_name f FROM care_plans WHERE id = $1`, [p2]))[0];
  rec("P3 the pending version is editable (header, goals, data questions, IPOS rows): no revision rows, revision 0; v1 is untouched (snapshot identical); would_bump says no bump",
    revP === 0 && p2row.revision === 0 && p2row.f === "New facilitator" && JSON.stringify(await snap1()) === s1 && wb.would_bump === false && !rows2.err,
    `revisions ${revP}; v1 same ${JSON.stringify(await snap1()) === s1}; would_bump ${wb.would_bump}; rows ${rows2.err || "ok"}`);

  // ---- P4 activation
  await must("hrX", "SELECT record_inservice_form($1,'Robin Hale',$2,$3::date,now(),'{}'::jsonb)", [p2, users.mgrX, await at(0)]);
  const stIn = (await q(`SELECT status::text s FROM care_plans WHERE id = $1`, [p2]))[0].s;
  const wb2 = (await call("mgrX", "SELECT would_bump_training_version($1,$2::jsonb)", [p2, JSON.stringify([{ seq: 1, goal_text: "Goal one (v2b)", objectives: [] }])])).v;
  const ctxP = (await call("hrX", "SELECT get_client_training_context($1)", [CX])).v;
  const form = await must("hrX", "SELECT record_training_form($1,'ipos_annual',NULL,NULL,$2::jsonb,'{}'::jsonb)", [p2, JSON.stringify([{ caregiver_id: G, training_date: await at(0), trainer_name: "Pat", signed_date: await at(0) }])]);
  const st = await q(`SELECT version, status::text s, effective_date::text e, revision FROM care_plans WHERE client_id = $1 ORDER BY version`, [CX]);
  const act = await q(`SELECT payload FROM events WHERE event_type = 'care_plan_activated' AND subject_id = $1`, [p2]);
  const rev0 = await q(`SELECT revision, summary FROM care_plan_revisions WHERE care_plan_id = $1`, [p2]);
  const ctxA = (await call("hrX", "SELECT get_client_training_context($1)", [CX])).v;
  const e2 = JSON.parse(await elig());
  rec("P4 the in-service alone doesn't activate (and a pending version never bumps); the training context works on v2 (status pending, in_effect v1); + one session: v2 ACTIVE (effective today, rev 0, revision row 'activated'), v1 SUPERSEDED, one care_plan_activated; G is trained-current; eligibility now uses v2",
    stIn === "pending" && wb2.would_bump === false && ctxP.plan.version === 2 && ctxP.plan.status === "pending" && ctxP.in_effect.version === 1
      && st[0].s === "superseded" && st[1].s === "active" && st[1].e === await at(0) && st[1].revision === 0 && act.length === 1 && rev0.length === 1 && rev0[0].summary === "activated"
      && ctxA.plan.status === "active" && ctxA.in_effect === null && ctxA.caregivers.find((c) => c.caregiver_id === G).trained_current === true
      && !(e2.hard || []).concat(e2.soft || [], e2.advisory || []).some((i) => i.code === "training_missing"),
    `${st.map((x) => `v${x.version}:${x.s}:${x.e}`).join(" ")}; activated ${act.length}; ctx pending→active ${ctxP.plan.status}→${ctxA.plan.status}`);
  const twice = await q(`SELECT cp_try_activate_plan($1) r`, [p2]);
  const attend = await call("hrX", "SELECT add_training_attendees($1,$2::jsonb)", [form, JSON.stringify([{ caregiver_id: H.U(330) }])]);
  rec("P5 activating again does nothing (exactly once)", twice[0].r === false && (await q(`SELECT count(*)::int n FROM events WHERE event_type = 'care_plan_activated'`))[0].n === 1,
    `again ${twice[0].r}; add attendee ${attend.err ? attend.err.slice(0, 40) : "ok"}`);

  // ---- P6 revisions of the active version
  const r1 = await must("mgrX", "SELECT update_care_plan_fields($1,$2::jsonb,NULL)", [p2, JSON.stringify({ recorder_name: "Rec One" })]);
  const revA = (await q(`SELECT revision FROM care_plans WHERE id = $1`, [p2]))[0].revision;
  await must("mgrX", "SELECT update_care_plan_fields($1,$2::jsonb,NULL)", [p2, JSON.stringify({ recorder_name: "Rec One" })]);
  const revB = (await q(`SELECT revision FROM care_plans WHERE id = $1`, [p2]))[0].revision;
  await must("mgrX", "SELECT set_objective_measures($1,$2::jsonb)", [await objA(p2), JSON.stringify([{ measure_type_id: mt, seq: 1, prompt_text: "Did A today?" }])]);
  const revs = await q(`SELECT revision, summary FROM care_plan_revisions WHERE care_plan_id = $1 ORDER BY revision`, [p2]);
  const revEv = await q(`SELECT payload FROM events WHERE event_type = 'care_plan_revised' AND subject_id = $1 ORDER BY occurred_at`, [p2]);
  const f2 = await must("hrX", "SELECT record_training_form($1,'ipos_annual',NULL,NULL,$2::jsonb,'{}'::jsonb)", [p2, JSON.stringify([{ caregiver_id: H.U(330), training_date: await at(0), trainer_name: "Pat", signed_date: await at(0) }])]);
  const pr = (await q(`SELECT plan_revision FROM plan_training_records WHERE training_form_id = $1`, [f2]))[0].plan_revision;
  const ctxR = (await call("hrX", "SELECT get_client_training_context($1)", [CX])).v;
  rec("P6 edits of the ACTIVE version are revisions: header → rev 1 ('header'), the same save again doesn't bump, data questions → rev 2 ('measures'); care_plan_revised per revision (ids, sections); a training record stores the revision (2) and the context shows it",
    revA === 1 && revB === 1 && revs.map((x) => `${x.revision}:${x.summary}`).join("|") === "0:activated|1:header|2:measures" && revEv.length === 2
      && Object.keys(revEv[0].payload).sort().join() === "care_plan_id,revision,sections" && pr === 2
      && ctxR.training_forms.find((f) => f.id === f2).records[0].plan_revision === 2,
    `${revs.map((x) => `${x.revision}:${x.summary}`).join(" | ")}; record rev ${pr}; r1 ${r1}`);

  // ---- P7 a legacy active plan (no revision rows) gets a baseline at its first edit; P8 stale pending never supersedes
  const CY2 = H.U(402);
  await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Lea','Legacy',$3)`, [CY2, A, OX]);
  const pL = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CY2, JSON.stringify({ effective_date: await at(-30), expiration_date: await at(300) }), "{}"]);
  await must("mgrX", "SELECT update_care_plan_fields($1,$2::jsonb,NULL)", [pL, JSON.stringify({ recorder_name: "R" })]);
  const lr = await q(`SELECT revision, summary FROM care_plan_revisions WHERE care_plan_id = $1 ORDER BY revision`, [pL]);
  const pLp = await must("mgrX", "SELECT start_pending_plan_version($1,'annual',$2::jsonb,NULL)", [pL, JSON.stringify({ effective_date: await at(10), expiration_date: await at(400) })]);
  await must("mgrX", "SELECT record_inservice_form($1,'Robin Hale',$2,$3::date,now(),'{}'::jsonb)", [pLp, users.mgrX, await at(0)]);
  await must("mgrX", "SELECT record_training_form($1,'ipos_annual',NULL,NULL,$2::jsonb,'{}'::jsonb)", [pLp, JSON.stringify([{ caregiver_id: G, training_date: await at(0), trainer_name: "Pat", signed_date: await at(0) }])]);
  const futSt = (await q(`SELECT status::text s FROM care_plans WHERE id = $1`, [pLp]))[0].s;
  const due0 = (await q(`SELECT cp_activate_due_plans() n`))[0].n;
  await db.query(`UPDATE care_plans SET effective_date = $2::date WHERE id = $1`, [pLp, await at(0)]);
  const due1 = (await q(`SELECT cp_activate_due_plans() n`))[0].n;
  const futSt2 = (await q(`SELECT status::text s FROM care_plans WHERE id = $1`, [pLp]))[0].s;
  rec("P7 a plan from before S17 gets a 'baseline' revision at its first edit, then rev 1; a ready pending version with a LATER effective date stays pending; the daily cp_activate_due_plans activates it on that date",
    lr.map((x) => `${x.revision}:${x.summary}`).join("|") === "0:baseline|1:header" && futSt === "pending" && due0 === 0 && due1 === 1 && futSt2 === "active",
    `${lr.map((x) => `${x.revision}:${x.summary}`).join(" | ")}; future ${futSt}; due ${due0} → ${due1}; ${futSt2}`);
  const CS = H.U(403);
  await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Sam','Stale',$3)`, [CS, A, OX]);
  const s1p = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CS, JSON.stringify({ effective_date: await at(-30), expiration_date: await at(300) }), "{}"]);
  const s2p = await must("mgrX", "SELECT start_pending_plan_version($1)", [s1p]);
  const s3p = await must("mgrX", "SELECT renew_care_plan($1)", [s1p]);   // unchanged renew, outside the UI: v3 active
  await must("mgrX", "SELECT record_inservice_form($1,'Robin Hale',$2,$3::date,now(),'{}'::jsonb)", [s2p, users.mgrX, await at(0)]);
  await must("mgrX", "SELECT record_training_form($1,'ipos_annual',NULL,NULL,$2::jsonb,'{}'::jsonb)", [s2p, JSON.stringify([{ caregiver_id: G, training_date: await at(0), trainer_name: "Pat", signed_date: await at(0) }])]);
  const stale = await q(`SELECT version, status::text s FROM care_plans WHERE client_id = $1 ORDER BY version`, [CS]);
  rec("P8 a pending version older than the active one (renew_care_plan used outside the UI) never supersedes it",
    stale.map((x) => `${x.version}:${x.s}`).join(" ") === "1:superseded 2:pending 3:active" && !!s3p, stale.map((x) => `${x.version}:${x.s}`).join(" "));

  // ---- S: shift creation limits (CX: v2 active, expires +380; CLS authorization until +15)
  await must("mgrX", "SELECT update_care_plan_fields($1,$2::jsonb,NULL)", [p2, JSON.stringify({ expiration_date: await at(25) })]);
  const tryIns = async (k, extra) => { try { await shift(k, extra); return "ok"; } catch (e) { return e.message; } };
  const a1 = await tryIns(26), a2 = await tryIns(25, { code: "RESP0001" }), d1 = await tryIns(16), d2 = await tryIns(15);
  rec("S1 1a: a visit after the active IPOS's expiration date is refused with the version and date; on the date it's fine. 1d: a CLS visit after the latest CLS authorization end is refused ('No authorization for CLS after …'); on that date fine; respite with no authorization: today's behaviour",
    /^IPOS v2 expires on \w{3} \d{1,2}, \d{4}: no visit can be scheduled after that date/.test(a1) && a2 === "ok" && /^No authorization for CLS after \w{3} \d{1,2}, \d{4}$/.test(d1) && d2 === "ok",
    `${a1.slice(0, 60)} | ${a2} | ${d1} | ${d2}`);
  const mv = await shift(10);
  let moveErr = null; try { await db.query(`UPDATE shifts SET shift_date = $2::date WHERE id = $1`, [mv, await at(20)]); } catch (e) { moveErr = e.message; }
  await db.query(`ALTER TABLE shifts DISABLE TRIGGER trg_cp_guard_shift_dates`);
  const late = await shift(40);                                      // an existing visit dated after the limits (e.g. the date was corrected later)
  await db.query(`ALTER TABLE shifts ENABLE TRIGGER trg_cp_guard_shift_dates`);
  let updErr = null; try { await db.query(`UPDATE shifts SET status = 'assigned', start_time = '10:00', end_time = '11:00' WHERE id = $1`, [late]); await db.query(`UPDATE shifts SET status = 'cancelled' WHERE id = $1`, [late]); } catch (e) { updErr = e.message; }
  await db.query(`UPDATE shifts SET status = 'open' WHERE id = $1`, [late]);
  const noPlanClient = H.U(404);
  await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Nia','NoPlan',$3)`, [noPlanClient, A, OX]);
  const np = await tryIns(500, { client: noPlanClient });
  const CYc = H.U(405);
  await db.query(`INSERT INTO clients (id, agency_id, first_name, last_name, virtual_office_id) VALUES ($1,$2,'Yan','OfficeY',$3)`, [CYc, A, OY]);
  await db.query(`UPDATE virtual_office SET care_plan_module_enabled = false, compliance_enforcement_enabled = false WHERE id = $1`, [OY]);
  await db.query(`INSERT INTO care_plans (agency_id, virtual_office_id, client_id, version, training_version, status, plan_type, effective_date, expiration_date)
    VALUES ($1,$2,$3,1,1,'active','initial',$4::date,$5::date)`, [A, OY, CYc, await at(-100), await at(-10)]);
  const offY = await tryIns(5, { client: CYc, office: OY });
  rec("S2 moves are checked too (date after the limit refused); other updates of an existing late visit (assign, times, cancel) are not; a client with no IPOS and an office without the module keep today's behaviour",
    /No authorization for CLS/.test(moveErr || "") && updErr === null && np === "ok" && offY === "ok", `move ${moveErr}; update ${updErr || "ok"}; no IPOS ${np}; office off ${offY}`);
  const lim = (await call("schX", "SELECT get_shift_creation_limits($1)", [CX])).v;
  const limDeny = []; for (const who of ["mgrY", "aaB", "cg", "cl", "anon"]) { const r = await call(who, "SELECT get_shift_creation_limits($1)", [CX]); if (r.err && H.DENY.test(r.err)) limDeny.push(who); }
  rec("S3 get_shift_creation_limits (scheduler): IPOS v2 until +25, CLS authorized until +15, respite none; refused for office-Y manager, other agency, caregiver, client, anon",
    lim.rules === true && lim.ipos.version === 2 && lim.ipos.expiration_date === await at(25)
      && lim.services.find((s) => s.service_type === "cls").authorized_until === await at(15) && lim.services.find((s) => s.service_type === "respite").authorized_until === null && limDeny.length === 5,
    `${JSON.stringify(lim).slice(0, 160)}; deny ${limDeny.length}/5`);

  // ---- W: 1c warnings
  const pn = await must("mgrX", "SELECT start_pending_plan_version($1)", [p2]);
  await must("mgrX", "SELECT record_inservice_form($1,'Robin Hale',$2,$3::date,now(),'{}'::jsonb)", [pn, users.mgrX, await at(0)]);
  await must("mgrX", "SELECT update_care_plan_fields($1,$2::jsonb,NULL)", [p2, JSON.stringify({ expiration_date: await at(12) })]);
  const w = (await call("mgrX", "SELECT list_ipos_expiry($1,NULL)", [OX])).v;
  const wz = w.find((x) => x.client_id === CX);
  const wDeny = []; for (const who of ["hrX", "schX", "mgrY", "aaB", "cg", "anon"]) { const r = await call(who, "SELECT list_ipos_expiry($1,NULL)", [OX]); if (r.err && H.DENY.test(r.err)) wDeny.push(who); }
  rec("W1 list_ipos_expiry: the client's IPOS v2 expires in 12 days → red, v3 pending (in-service signed, 0 sessions), the existing visits dated after the expiration date listed with their count; other clients with far dates not listed; refused for HR, scheduler, other office / agency, caregiver, anon",
    wz && wz.version === 2 && wz.days_left === 12 && wz.band === "red" && wz.pending.version === 3 && wz.pending.inservice_signed === true && Number(wz.pending.sessions) === 0
      && Number(wz.shifts_after_count) >= 2 && wz.shifts_after.length === Number(wz.shifts_after_count) && !w.some((x) => x.client_id === CY2) && wDeny.length === 6,
    `${wz ? `${wz.band} ${wz.days_left}d pending v${wz.pending.version} after ${wz.shifts_after_count}` : "missing"}; deny ${wDeny.length}/6`);
  const amber = (await call("mgrX", "SELECT list_ipos_expiry($1,$2)", [OX, CX])).v;
  await must("mgrX", "SELECT update_care_plan_fields($1,$2::jsonb,NULL)", [p2, JSON.stringify({ expiration_date: await at(29) })]);
  const am = (await call("mgrX", "SELECT list_ipos_expiry($1,$2)", [OX, CX])).v[0];
  rec("W2 bands: 29 days → amber (14 days or less, or expired → red); the client filter returns one row", am.band === "amber" && amber.length === 1, `${am.band}`);

  // ---- A: files on a pending version (S4b care_plan)
  const pa = await call("mgrX", "SELECT begin_attachment_upload('care_plan',$1,'ISK IPOS v3',NULL,'application/pdf',100)", [pn]);
  const old = await call("mgrX", "SELECT begin_attachment_upload('care_plan',$1,'x',NULL,'application/pdf',100)", [plan1]);
  rec("A1 the ISK IPOS PDF can be attached to a pending version; a superseded version stays read-only", !pa.err && /earlier version/.test(old.err || ""), `${pa.err || "ok"} | ${old.err}`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

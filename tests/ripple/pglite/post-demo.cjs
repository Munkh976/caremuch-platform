// Post-demo 1a + 1b on PGlite: 20261027120000 (note history lists "review undone") and 20261027120100
// (add_training_attendees). Catalog diff (only the reader body changes + one new function), identity arguments and ACLs;
// the reader's output is identical for a note without an undo; an undo shows reviewed -> review_undone -> reviewed;
// adding attendees to a session of the current version (session date + trainer, own signature date, audit), refused for
// a superseded version, duplicates, other offices / agencies / roles and anon, bad input.
// Usage: node tests/ripple/pglite/post-demo.cjs   (local, no network)
const H = require("./harness.cjs");
const HIST = "20261027120000_note_history_undo.sql", ATT = "20261027120100_add_training_attendees.sql";
let seq = 0; const nid = () => H.U(9600 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(HIST); const { db, q, call, must } = t;
  const { CX, G, OX, OY, A, TZ, users } = H;
  const fn = async (names) => (await q(`SELECT p.proname n, pg_get_function_identity_arguments(p.oid) a, md5(p.prosrc) h, p.prosecdef d,
      (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY 1) FROM aclexplode(p.proacl) x) acl
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [names]));

  // fixtures: a reviewed note (no undo) whose reader output is captured before the migrations
  await db.query("UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '40 days' WHERE id = $1", [OX]);
  const at = async (k) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [k]))[0].d;
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await at(-30), expiration_date: await at(300) }), "{}"]);
  await must("mgrX", "SELECT create_service_authorization($1,'cls','AUTH-PD',100,$2::date,$3::date)", [CX, await at(-30), await at(90)]);
  const note = async (k) => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
      VALUES ($1,$2,$3,'CLS0001',$4::date,'09:00','10:00',$5,'assigned',1,$6)`, [id, A, CX, await at(k), OX, G]);
    const n = await must("cg", "SELECT create_progress_note_for_shift($1)", [id]);
    const r = (await q("SELECT scheduled_start, scheduled_end FROM progress_notes WHERE id = $1", [n]))[0];
    await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [n, JSON.stringify({ client_arrived_at: new Date(r.scheduled_start).toISOString(), actual_end: new Date(r.scheduled_end).toISOString() })]);
    await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [n]); return n; };
  const N0 = await note(-3); await must("mgrX", "SELECT review_progress_note($1,true,NULL)", [N0]);
  const read = async (n) => (await call("mgrX", "SELECT get_progress_note_for_staff($1)", [n])).v;
  const out0 = JSON.stringify(await read(N0));
  const before = await H.snap(db), fBefore = await fn(["get_progress_note_for_staff"]);
  await H.applyFiles(db, [HIST, ATT]);
  const after = await H.snap(db), fAfter = await fn(["get_progress_note_for_staff", "add_training_attendees"]);
  const added = after.filter((x) => !before.includes(x)), removed = before.filter((x) => !after.includes(x));
  rec("F0 catalog: only get_progress_note_for_staff's body changes (same identity arguments '_note_id uuid', SECURITY DEFINER, same ACL) and add_training_attendees is new; nothing else",
    removed.length === 1 && removed[0].startsWith("fn:get_progress_note_for_staff(uuid):") && added.length === 2
      && added.some((x) => x.startsWith("fn:get_progress_note_for_staff(uuid):")) && added.some((x) => x.startsWith("fn:add_training_attendees(uuid,jsonb):"))
      && fBefore[0].a === "_note_id uuid" && fAfter.find((f) => f.n === "get_progress_note_for_staff").a === "_note_id uuid"
      && fBefore[0].acl === fAfter.find((f) => f.n === "get_progress_note_for_staff").acl && fBefore[0].h !== fAfter.find((f) => f.n === "get_progress_note_for_staff").h,
    `+${added.map((x) => x.slice(0, 45)).join(" ; ")} / -${removed.map((x) => x.slice(0, 45)).join(" ; ")}`);
  const acl = await H.aclCheck(q, ["get_progress_note_for_staff", "add_training_attendees"]);
  rec("ACL both SECURITY DEFINER, EXECUTE for authenticated only (aclexplode: no PUBLIC, no anon); add_training_attendees identity '_training_form_id uuid, _records jsonb'",
    acl.ok && fAfter.every((f) => !/(^|,)(-|anon|public):/i.test(f.acl || "")) && fAfter.find((f) => f.n === "add_training_attendees").a === "_training_form_id uuid, _records jsonb",
    `${acl.detail}; ${fAfter.map((f) => `${f.n} ${f.acl}`).join(" | ")}`);
  rec("H0 a note without an undo reads exactly as before (byte-identical JSON)", JSON.stringify(await read(N0)) === out0, "same");
  const N1 = await note(-2); await must("mgrX", "SELECT review_progress_note($1,true,NULL)", [N1]);
  await must("mgrX", "SELECT undo_progress_note_review($1)", [N1]); await must("aaA", "SELECT review_progress_note($1,true,NULL)", [N1]);
  const h1 = (await read(N1)).history;
  rec("H1 after review -> undo -> review the history has five lines in order: created, submitted, reviewed (Manager X), review undone (Manager X), reviewed (Admin A)",
    h1.map((x) => x.event.replace("progress_note_", "")).join(",") === "created,submitted,reviewed,review_undone,reviewed" && h1[3].by === "Manager X" && h1[4].by === "Admin A" && !!h1[3].at,
    h1.map((x) => `${x.event.replace("progress_note_", "")}/${x.by}`).join(", "));

  // 1b: sessions
  await db.query(`INSERT INTO caregivers (id, agency_id, first_name, last_name, virtual_office_id, is_active) VALUES ($1,$2,'Hank','Two',$3,true), ($4,$2,'Yuri','Office',$5,true), ($6,$2,'Iris','Three',$3,true)`, [H.U(320), A, OX, H.U(321), OY, H.U(322)]);
  const G2 = H.U(320), GY = H.U(321);
  await must("mgrX", "SELECT record_inservice_form($1,'Robin Hale',$2,$3::date,now(),'{}'::jsonb)", [plan, users.mgrX, await at(-5)]);
  const recs = (arr) => JSON.stringify(arr);
  const S1 = await must("mgrX", "SELECT record_training_form($1,'ipos_initial',NULL,NULL,$2::jsonb,'{}'::jsonb)", [plan, recs([{ caregiver_id: G, training_date: await at(-4), trainer_name: "Pat Morgan", signed_date: await at(-4) }])]);
  const evN = async () => (await q(`SELECT count(*)::int n FROM events WHERE event_type = 'training_recorded' AND subject_id = $1`, [S1]))[0].n;
  const e0 = await evN();
  const add = await call("hrX", "SELECT add_training_attendees($1,$2::jsonb)", [S1, recs([{ caregiver_id: G2, signed_date: await at(-1), training_method: "outside_pcp" }])]);
  const r2 = (await q(`SELECT training_date::text d, trainer_name tr, signed_date::text s, training_method::text m, training_version v FROM plan_training_records WHERE training_form_id = $1 AND caregiver_id = $2`, [S1, G2]))[0];
  const ev = (await q(`SELECT payload FROM events WHERE event_type = 'training_recorded' AND subject_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [S1]))[0].payload;
  const ctxCg = (await call("mgrX", "SELECT get_client_training_context($1)", [CX])).v.caregivers.find((c) => c.caregiver_id === G2);
  rec("A1 hr_staff adds Hank to the existing session: one record with the session's date and trainer, his own signature date and method, the current version; Hank is trained-current; one audit row (training_recorded, added: true, ids and counts)",
    !add.err && add.v === 1 && r2.d === await at(-4) && r2.tr === "Pat Morgan" && r2.s === await at(-1) && r2.m === "outside_pcp" && ctxCg.trained_current === true
      && (await evN()) === e0 + 1 && ev.added === true && ev.records === 1 && Object.keys(ev).sort().join() === "added,care_plan_id,records,training_form_id,training_version",
    `${add.err || add.v}; ${JSON.stringify(r2)}; audit ${JSON.stringify(ev)}`);
  const dup = await call("mgrX", "SELECT add_training_attendees($1,$2::jsonb)", [S1, recs([{ caregiver_id: G2 }])]);
  const twice = await call("mgrX", "SELECT add_training_attendees($1,$2::jsonb)", [S1, recs([{ caregiver_id: G }, { caregiver_id: G }])]);
  const bad = await call("mgrX", "SELECT add_training_attendees($1,$2::jsonb)", [S1, recs([{ caregiver_id: G, trainer_name: "x" }])]);
  const fut = await call("mgrX", "SELECT add_training_attendees($1,$2::jsonb)", [S1, recs([{ caregiver_id: H.U(322), signed_date: await at(5) }])]);
  const none = await call("mgrX", "SELECT add_training_attendees($1,'[]'::jsonb)", [S1]);
  rec("A2 refused with the reason: a caregiver already in the session, the same caregiver twice, an unknown property (e.g. trainer_name), a future signature date, an empty list",
    /already in this session/.test(dup.err || "") && /once/.test(twice.err || "") && /Unknown/.test(bad.err || "") && /future/.test(fut.err || "") && /1-100/.test(none.err || ""),
    [dup, twice, bad, fut, none].map((x) => (x.err || "ACCEPTED").slice(0, 45)).join(" | "));
  const cross = await call("mgrX", "SELECT add_training_attendees($1,$2::jsonb)", [S1, recs([{ caregiver_id: GY }])]);
  const refused = [];
  for (const who of ["mgrY", "aaB", "schX", "cg", "cl", "anon"]) {
    const r = await call(who, "SELECT add_training_attendees($1,$2::jsonb)", [S1, recs([{ caregiver_id: G2 }])]);
    if (r.err && H.DENY.test(r.err)) refused.push(who); else console.log("  not refused:", who, r.err || JSON.stringify(r.v));
  }
  rec("A3 refused (generic): a caregiver of another office; manager of another office, the other agency's admin, scheduler, caregiver, client, anon; no extra audit row",
    H.DENY.test(cross.err || "") && refused.length === 6 && (await evN()) === e0 + 1, `cross ${cross.err}; ${refused.length}/6`);
  await must("mgrX", "SELECT renew_care_plan($1)", [plan]);
  const old = await call("mgrX", "SELECT add_training_attendees($1,$2::jsonb)", [S1, recs([{ caregiver_id: GY === G ? G2 : G }])]);
  rec("A4 after a renewal the session belongs to a superseded version: adding is refused with the reason", /earlier plan version/.test(old.err || ""), old.err);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

// S9b on PGlite (20261022120000): a week approved, not billed, is reopened by "Build week again" (approvals cleared,
// the late note added, approve again); a billed week gets supplementary batches 1, 2 for notes reviewed later (same
// flow: approve, billed, lock); nothing waiting -> refused; no note in two batches; units charged once; the week read
// and the dashboard status count every batch; audit flags without PHI; signatures / grants unchanged.
// Usage: node tests/ripple/pglite/ui-s9b.cjs   (local, no network)
const H = require("./harness.cjs");
const S9B = "20261022120000_s9b_billing_supplements.sql";
let seq = 0; const nid = () => H.U(9990 + ++seq);

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(S9B); const { db, q, call, must } = t;
  const sig = async () => (await q(`SELECT string_agg(p.oid::regprocedure::text || ' ' || COALESCE(p.proacl::text,''), ' | ' ORDER BY 1) s FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('build_billing_batch','get_billing_week','list_billing_week_status','approve_batch_notes','mark_batch_billed','get_billing_batch')`))[0].s;
  const sigBefore = await sig();
  await H.applyFiles(db, [S9B]);
  rec("F0 same signatures and grants for the six batch functions (no overload)", (await sig()) === sigBefore, (await sig()).slice(0, 160));
  const { CX, G, OX, A, TZ } = H;
  await db.query("UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '40 days' WHERE id = $1", [OX]);
  const ws = (await q(`SELECT (d - ((extract(isodow FROM d)::int - 1 + 7) % 7) - 7)::text ws FROM (SELECT (now() AT TIME ZONE '${TZ}')::date d) x`))[0].ws;
  const at = async (k) => (await q(`SELECT ($1::date + $2::int)::text d`, [ws, k]))[0].d;
  await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await at(-30), expiration_date: await at(300) }), "{}"]);
  const auth = await must("mgrX", "SELECT create_service_authorization($1,'cls','AUTH-S9B',100,$2::date,$3::date)", [CX, await at(-30), await at(90)]);
  const sh = async (k) => { const id = nid();
    await db.query(`INSERT INTO shifts (id, agency_id, client_id, care_type_code, shift_date, start_time, end_time, virtual_office_id, status, duration_hours, caregiver_id)
      VALUES ($1,$2,$3,'CLS0001',$4::date,'09:00','10:00',$5,'assigned',1,$6)`, [id, A, CX, await at(k), OX, G]); return id; };
  const note = async (k) => { const n = await must("cg", "SELECT create_progress_note_for_shift($1)", [await sh(k)]);
    const st = (await q("SELECT scheduled_start FROM progress_notes WHERE id = $1", [n]))[0].scheduled_start;
    await must("cg", "SELECT save_progress_note_draft($1,$2::jsonb,'[]'::jsonb,NULL)", [n, JSON.stringify({ client_arrived_at: new Date(st).toISOString() })]);
    await must("cg", "SELECT submit_progress_note($1,'Gina Test')", [n]); return n; };
  const review = (n) => must("mgrX", "SELECT review_progress_note($1,true,NULL)", [n]);
  const build = () => must("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, ws]);
  const week = async () => (await call("mgrX", "SELECT get_billing_week($1,$2::date)", [OX, ws])).v;
  const approveAll = async (w, i) => must("mgrX", "SELECT approve_batch_notes($1,$2::uuid[])", [w.batches[i].id, `{${w.batches[i].lines.flatMap((l) => l.notes.map((n) => n.note_id)).join(",")}}`]);
  const avail = async () => Number((await q("SELECT units_available FROM service_authorizations WHERE id = $1", [auth]))[0].units_available);
  const N = { a: await note(0), b: await note(1), c: await note(2), d: await note(3), e: await note(4) };
  await review(N.a); await review(N.b);
  await build(); let w = await week(); await approveAll(w, 0);

  // (a) approved, not billed -> reopen
  await review(N.c);
  const w1 = await week(); const r1 = w1.excluded.find((x) => x.note_id === N.c)?.reason;
  const avBefore = await avail();
  const rb = await build(); const w2 = await week();
  const approvedAfterReopen = (await q("SELECT count(batch_approved_at)::int n FROM progress_notes WHERE billing_batch_id = $1", [w2.batches[0].id]))[0].n;
  rec("A1 a note reviewed after approval: 'reviewed_after_approval', next action 'reopen'; Build week again reopens the main bill (approvals cleared, the note added, status open), audited with reopened=true",
    r1 === "reviewed_after_approval" && w1.next_action === "reopen" && rb.reopened === true && rb.supplement === 0 && w2.batches.length === 1 && w2.batches[0].status === "open"
      && Number(w2.batches[0].totals.notes) === 3 && approvedAfterReopen === 0 && (await avail()) === avBefore,
    `reason ${r1}; next ${w1.next_action}; reopened ${rb.reopened}; notes ${w2.batches[0].totals.notes}; approvals ${approvedAfterReopen}; units ${avBefore} -> ${await avail()}`);
  await approveAll(w2, 0); await must("mgrX", "SELECT mark_batch_billed($1)", [w2.batches[0].id]);

  // (b) billed -> supplement 1, then 2
  await review(N.d);
  const w3 = await week(); const r3 = w3.excluded.find((x) => x.note_id === N.d)?.reason;
  const st3 = (await call("mgrX", "SELECT list_billing_week_status()")).v.find((x) => x.office_id === OX);
  const av3 = await avail(); const s1 = await build(); const w4 = await week();
  rec("B1 billed week + a later review: 'reviewed_after_billing', next action 'supplement', dashboard 'supplement_needed'; Build creates supplement 1 holding only that note; the main bill stays billed; units unchanged by the build",
    r3 === "reviewed_after_billing" && w3.next_action === "supplement" && w3.waiting_for_supplement === 1 && st3.status === "supplement_needed"
      && s1.supplement === 1 && w4.batches.length === 2 && w4.batches[0].status === "billed" && w4.batches[1].status === "open" && Number(w4.batches[1].totals.notes) === 1
      && w4.batches[1].lines[0].notes[0].note_id === N.d && (await avail()) === av3,
    `reason ${r3}; next ${w3.next_action}; dashboard ${st3.status}; s${s1.supplement}: ${w4.batches[1].totals.notes} note(s); units ${av3} -> ${await avail()}`);
  await approveAll(w4, 1); await must("mgrX", "SELECT mark_batch_billed($1)", [w4.batches[1].id]);
  const lock = await call("mgrX", "SELECT return_progress_note($1,'Billed in supplement')", [N.d]);
  await review(N.e); const s2 = await build(); const w5 = await week();
  await approveAll(w5, 2); await must("mgrX", "SELECT mark_batch_billed($1)", [w5.batches[2].id]);
  const none = await call("mgrX", "SELECT build_billing_batch($1,$2::date)", [OX, ws]);
  const st6 = (await call("mgrX", "SELECT list_billing_week_status()")).v.find((x) => x.office_id === OX);
  rec("B2 supplement 1 approved and billed (its note locked); a second late note -> supplement 2 -> billed; nothing waiting -> Build refused; dashboard 'billed' with 2 supplements",
    !!lock.err && s2.supplement === 2 && Number(w5.batches[2].totals.notes) === 1 && /no reviewed note is waiting/.test(none.err || "") && st6.status === "billed" && st6.supplements === 2,
    `lock ${lock.err ? "refused" : "ACCEPTED"}; s2 ${s2.supplement}; none "${(none.err || "ACCEPTED").slice(0, 50)}"; dashboard ${st6.status}/${st6.supplements}`);
  const dist = (await q(`SELECT count(*)::int n, count(DISTINCT id)::int d, count(DISTINCT billing_batch_id)::int b FROM progress_notes WHERE id = ANY($1::uuid[])`, [Object.values(N)]))[0];
  const charged = (await q(`SELECT units_authorized - units_available AS used FROM service_authorizations WHERE id = $1`, [auth]))[0].used;
  const notesUnits = (await q(`SELECT sum(units_used)::numeric s FROM progress_notes WHERE id = ANY($1::uuid[])`, [Object.values(N)]))[0].s;
  rec("C1 every note in exactly one batch (5 notes across 3 batches of the week); units charged once: authorization use = the notes' units",
    dist.n === 5 && dist.b === 3 && Number(charged) === Number(notesUnits) && Number(charged) === 20, `${JSON.stringify(dist)}; charged ${charged}, notes ${notesUnits}`);
  const ev = await q(`SELECT payload FROM events WHERE event_type = 'billing_batch_built' AND subject_id = ANY($1::uuid[]) ORDER BY occurred_at`, [w5.batches.map((b) => b.id)]);
  rec("AU1 every build audited (existing billing_batch_built type) with supplement / reopened flags, ids and counts only",
    ev.length >= 4 && ev.some((e) => e.payload.reopened === true) && ev.some((e) => e.payload.supplement === 2) && ev.every((e) => Object.keys(e.payload).every((k) => ["batch_id", "included", "excluded", "supplement", "reopened"].includes(k))),
    ev.map((e) => `s${e.payload.supplement}${e.payload.reopened ? "+reopen" : ""}`).join(","));
  let dupErr = null; try { await db.query(`INSERT INTO billing_batches (agency_id, virtual_office_id, week_start, week_end, supplement) VALUES ($1,$2,$3::date,$3::date + 6, 1)`, [A, OX, ws]); } catch (e) { dupErr = e.message; }
  rec("U1 (office, week, supplement) is unique (a superuser insert of a second supplement 1 is refused by the constraint)", /billing_batches_office_week_supplement_key/.test(dupErr || ""), dupErr || "ACCEPTED");
  const dl = []; for (const wh of ["hrX", "schX", "cg", "cl", "anon", "mgrY", "aaB", "sysA"]) { const r = await call(wh, "SELECT build_billing_batch($1,$2::date)", [OX, ws]); if (!r.err || !H.DENY.test(r.err)) dl.push(`${wh}: ${r.err || "ALLOWED"}`); }
  rec("R1 build (and so reopen / supplement) refused for hr_staff, scheduler, caregiver, client, anon, office-Y manager, agency-B admin, system_admin", dl.length === 0, dl.join("; ") || "8 refused");
  done();
})().catch((e) => { console.log("HARNESS ERROR", e.message, e.stack); process.exit(1); });

// Read-only check that the demo office has every deliberate state of the demo, with exact counts. Calls the same reads
// the screens use, as the demo program lead (Pat Morgan) / agency admin (Sam Rivera), inside a READ ONLY transaction
// that is rolled back (no session, no password).
// Usage: node tests/ripple/demo/verify-demo.cjs [--as-of YYYY-MM-DD]   (the demo day; default today, office time)
// Date buckets (past / demo day / next week, last week, the week before) use --as-of; "overdue" and the panels are what
// the app shows now (server clock): seeded the evening before, they already match the demo day.
const D = require("./demo-lib.cjs");
const { pgRead } = D;
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const rows = []; const rec = (id, ok, d) => { rows.push({ id, ok }); console.log(`${id} ${ok ? "PASS" : "FAIL"}${d ? " :: " + d : ""}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const [off] = await D.findOffice();
  if (!off) { console.log("no demo office"); process.exitCode = 1; return; }
  const r = await pgRead(async (c) => {
    const q = async (sql, p = []) => (await c.query(sql, p)).rows;
    const asOf = arg("--as-of") || (await q(`SELECT (now() AT TIME ZONE $1)::date::text d`, [D.TZ]))[0].d;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("--as-of must be YYYY-MM-DD");
    const pat = (await q(`SELECT id FROM public.profiles WHERE email = $1`, [D.email("pat.morgan")]))[0].id;
    const sam = (await q(`SELECT id FROM public.profiles WHERE email = $1`, [D.email("sam.rivera")]))[0].id;
    const ana = (await q(`SELECT id FROM public.profiles WHERE email = $1`, [D.email("ana.brooks")]))[0].id;
    await c.query("BEGIN READ ONLY");
    try {
      const W = (await q(`SELECT ($2::date - ((extract(isodow FROM $2::date)::int - v.billing_week_start + 7) % 7))::text w0, v.billing_week_start wks,
        ($2::date - ((extract(isodow FROM $2::date)::int - v.billing_week_start + 7) % 7) - 7)::text a, ($2::date - ((extract(isodow FROM $2::date)::int - v.billing_week_start + 7) % 7) - 14)::text b
        FROM public.virtual_office v WHERE v.id = $1`, [off.id, asOf]))[0];
      const out = { asOf, W,
        agency: (await q(`SELECT (SELECT count(*)::int FROM public.virtual_office WHERE agency_id = $1) offices,
          (SELECT count(*)::int FROM public.profiles WHERE email LIKE $2 AND agency_id <> $1) + (SELECT count(*)::int FROM public.virtual_office WHERE code = 'RPLDEMO' AND agency_id <> $1) elsewhere`, [off.agency_id, `%${D.EMAIL_TAG}`]))[0],
        office: (await q(`SELECT name, care_plan_module_enabled m, compliance_enforcement_enabled e, note_location_mode lm, note_location_default ld FROM public.virtual_office WHERE id = $1`, [off.id]))[0],
        clients: await q(`SELECT id, first_name || ' ' || last_name n, case_number FROM public.clients WHERE virtual_office_id = $1 ORDER BY 2`, [off.id]),
        roles: await q(`SELECT ur.role::text k, count(*)::int n FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id WHERE p.agency_id = $1 GROUP BY 1 ORDER BY 1`, [off.agency_id]),
        statuses: Object.fromEntries((await q(`SELECT status::text k, count(*)::int n FROM public.progress_notes WHERE virtual_office_id = $1 AND NOT voided GROUP BY 1`, [off.id])).map((x) => [x.k, x.n])),
        submitted: await q(`SELECT cl.first_name c, g.first_name g, n.service_date::text d, n.note_kind::text k FROM public.progress_notes n JOIN public.clients cl ON cl.id = n.client_id
          JOIN public.caregivers g ON g.id = n.caregiver_id WHERE n.virtual_office_id = $1 AND n.status = 'submitted'`, [off.id]),
        noNotePast: await q(`SELECT cl.first_name c, g.first_name g, s.shift_date::text d, s.care_type_code code FROM public.shifts s JOIN public.clients cl ON cl.id = s.client_id
          JOIN public.caregivers g ON g.id = s.caregiver_id WHERE s.virtual_office_id = $1 AND s.status IS DISTINCT FROM 'cancelled' AND s.shift_date < $2::date
          AND NOT EXISTS (SELECT 1 FROM public.progress_notes n WHERE n.shift_id = s.id AND NOT n.voided)`, [off.id, asOf]),
        demoDay: await q(`SELECT cl.first_name c, g.first_name g, s.start_time::text st, s.care_type_code code, EXISTS (SELECT 1 FROM public.progress_notes n WHERE n.shift_id = s.id AND NOT n.voided) has_note
          FROM public.shifts s JOIN public.clients cl ON cl.id = s.client_id LEFT JOIN public.caregivers g ON g.id = s.caregiver_id
          WHERE s.virtual_office_id = $1 AND s.shift_date = $2::date AND s.status IS DISTINCT FROM 'cancelled'`, [off.id, asOf]),
        unassigned: await q(`SELECT cl.first_name c, s.shift_date::text d, extract(isodow FROM s.shift_date)::int dow FROM public.shifts s JOIN public.clients cl ON cl.id = s.client_id
          WHERE s.virtual_office_id = $1 AND s.caregiver_id IS NULL AND s.status IS DISTINCT FROM 'cancelled'`, [off.id]),
        overdueRows: await q(`SELECT x.status k, g.first_name g, cl.first_name c, x.service_date::text d FROM public.cp_office_note_queue($1) x
          JOIN public.caregivers g ON g.id = x.caregiver_id JOIN public.clients cl ON cl.id = x.client_id WHERE x.overdue ORDER BY x.service_date`, [off.id]),
        groups: await q(`SELECT gs.session_date::text d, gs.staff_client_ratio r, string_agg(cl.first_name, ',' ORDER BY cl.first_name) clients,
          count(n.id) FILTER (WHERE n.status IN ('reviewed', 'billed') AND n.staff_client_ratio = '1:2')::int notes
          FROM public.group_sessions gs JOIN public.shifts s ON s.group_session_id = gs.id JOIN public.clients cl ON cl.id = s.client_id
          LEFT JOIN public.progress_notes n ON n.shift_id = s.id AND NOT n.voided WHERE gs.virtual_office_id = $1 GROUP BY 1, 2 ORDER BY 1`, [off.id]),
        respite: (await q(`SELECT count(*)::int n FROM public.progress_notes WHERE virtual_office_id = $1 AND note_kind = 'respite' AND status IN ('reviewed', 'billed')`, [off.id]))[0].n,
        kinds: (await q(`SELECT count(DISTINCT mt.kind)::int n FROM public.objective_measures om JOIN public.measure_types mt ON mt.id = om.measure_type_id
          JOIN public.care_plan_objectives o ON o.id = om.objective_id JOIN public.care_plan_goals g ON g.id = o.goal_id JOIN public.care_plans p ON p.id = g.care_plan_id
          WHERE p.virtual_office_id = $1 AND p.status = 'active'`, [off.id]))[0],
        zoePlan: await q(`SELECT version, training_version, status::text FROM public.care_plans p JOIN public.clients cl ON cl.id = p.client_id WHERE cl.virtual_office_id = $1 AND cl.first_name = 'Zoe' ORDER BY version`, [off.id]),
        zoeAuth: await q(`SELECT a.auth_number, a.period_type::text per, a.units_per_period::int cap, a.expiration_date - $2::date days FROM public.service_authorizations a
          JOIN public.clients cl ON cl.id = a.client_id WHERE cl.virtual_office_id = $1 AND cl.first_name = 'Zoe' ORDER BY 1`, [off.id, asOf]),
        anaGreen: (await q(`SELECT count(*) FILTER (WHERE c.expiry_date - $2::date > 60)::int ok, count(*)::int req FROM public.caregivers g
          JOIN public.credential_types t ON t.agency_id = g.agency_id AND t.is_active AND t.required LEFT JOIN public.caregiver_certifications c ON c.caregiver_id = g.id AND c.credential_type_id = t.id
          WHERE g.virtual_office_id = $1 AND g.first_name = 'Ana'`, [off.id, asOf]))[0],
        units: await q(`SELECT to_char(n.scheduled_start AT TIME ZONE 'America/New_York', 'Dy') dy, n.units_used::int u, n.units_scheduled::int s, n.arrived_late late,
          date_trunc('minute', n.actual_end) < n.scheduled_end early FROM public.progress_notes n JOIN public.clients cl ON cl.id = n.client_id
          WHERE cl.virtual_office_id = $1 AND cl.first_name = 'Zoe' AND n.service_date BETWEEN $2::date AND $2::date + 6 AND n.status IN ('reviewed','submitted','returned') ORDER BY n.scheduled_start`, [off.id, W.a]),
      };
      await c.query("SET LOCAL ROLE authenticated");
      const as = async (uid, sql, p = []) => { await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid]); return (await c.query(sql, p)).rows[0].v; };
      Object.assign(out, {
        onboarding: await as(pat, `SELECT list_clients_onboarding($1) v`, [off.id]),
        creds: await as(pat, `SELECT list_credential_expirations($1, 60) v`, [off.id]),
        risk: await as(pat, `SELECT list_authorization_risk($1, 60) v`, [off.id]),
        retrain: await as(pat, `SELECT list_caregivers_needing_retraining($1) v`, [off.id]),
        notes: await as(pat, `SELECT get_notes_review_counts() v`),
        readiness: await as(pat, `SELECT get_enforcement_readiness($1, 14) v`, [off.id]),
        lastWeek: await as(pat, `SELECT get_billing_week($1, $2::date) v`, [off.id, W.a]),
        weekBefore: await as(pat, `SELECT get_billing_week($1, $2::date) v`, [off.id, W.b]),
        status: await as(sam, `SELECT list_billing_week_status() v`),
        // S14 other menus, read the way each screen reads them (RLS as the viewer)
        menus: {
          inquiries: await as(pat, `SELECT json_build_object('all', count(*), 'new', count(*) FILTER (WHERE status = 'new')) v FROM public.care_requests WHERE agency_id = $1`, [off.agency_id]),
          applications: await as(sam, `SELECT json_build_object('all', count(*), 'pending', count(*) FILTER (WHERE status = 'pending')) v FROM public.caregiver_registrations WHERE agency_id = $1`, [off.agency_id]),
          timeOff: await as(pat, `SELECT json_build_object('all', count(*), 'pending', count(*) FILTER (WHERE status = 'pending')) v FROM public.time_off_requests WHERE agency_id = $1`, [off.agency_id]),
          trades: await as(pat, `SELECT json_build_object('board', count(*) FILTER (WHERE status = 'pending' AND NOT requires_manager_approval), 'approval', count(*) FILTER (WHERE status = 'pending' AND requires_manager_approval)) v FROM public.shift_trades`),
          tradeBoardAna: await as(ana, `SELECT count(*)::int v FROM get_caregiver_trade_shifts()`),
          outbox: await as(pat, `SELECT json_build_object('all', count(*), 'unsent', count(*) FILTER (WHERE sent_at IS NULL)) v FROM public.pending_notifications WHERE agency_id = $1`, [off.agency_id]),
          // S4b: the two demo files, as Pat reads them (table RLS and the bucket's read policy)
          files: await as(pat, `SELECT json_build_object('rows', (SELECT string_agg(parent_kind || ':' || display_name, ' | ' ORDER BY parent_kind) FROM public.cp_attachments WHERE agency_id = $1),
            'objects', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'cp-attachments' AND name LIKE $1::text || '/%')) v`, [off.agency_id]),
        },
      });
      await c.query("RESET ROLE");
      return out;
    } finally { await c.query("ROLLBACK"); }
  });
  const W = r.W, name = new Map(r.clients.map((x) => [x.id, x.n]));
  const cgName = (id) => id;   // retraining rows carry ids only
  console.log(`=== verify-demo — demo day ${r.asOf}; billing week ${W.w0}; last week ${W.a}; the week before ${W.b} ===`);
  rec("O own agency, one office 'Ripple Effects – Demo', module on, compliance enforcement OFF, note Location prefilled with the center; nothing of the demo elsewhere",
    r.office.name === D.OFFICE_NAME && r.office.m && !r.office.e && r.office.lm === "default" && r.office.ld === "Ripple Effects Community Inclusion Center" && r.agency.offices === 1 && r.agency.elsewhere === 0, `${JSON.stringify(r.office)}; ${JSON.stringify(r.agency)}`);
  rec("U users: 1 manager (Pat), 1 agency admin (Sam), 1 HR (Jordan), 1 scheduler (Casey), 5 caregivers",
    eq(r.roles, [{ k: "agency_admin", n: 1 }, { k: "caregiver", n: 5 }, { k: "hr_staff", n: 1 }, { k: "manager", n: 1 }, { k: "scheduler", n: 1 }]), r.roles.map((x) => `${x.k} ${x.n}`).join(", "));
  // ---- part B2: notes ----
  const nc = r.notes.find((x) => x.office_id === off.id) || {};
  const od = r.overdueRows.map((x) => `${x.k}:${x.g}/${x.c}/${x.d}`);
  rec("N1 overdue = exactly 2, both before the day before the demo: Ana's visit with no note (Max, respite) + Ben's returned note",
    Number(nc.overdue) === 2 && r.overdueRows.length === 2 && r.overdueRows.every((x) => x.d < W.w0) &&
    r.overdueRows.some((x) => x.k === "not_started" && x.g === "Ana" && x.c === "Max") && r.overdueRows.some((x) => x.k === "returned" && x.g === "Ben"), `${nc.overdue}: ${od.join(", ")}`);
  const wed = new Date(`${W.a}T12:00:00Z`); wed.setUTCDate(wed.getUTCDate() + 3);
  rec("N2 Notes to Review = exactly 1: Mia's Zoe CLS note of last Wednesday (submitted)",
    Number(nc.to_review) === 1 && r.submitted.length === 1 && r.submitted[0].g === "Mia" && r.submitted[0].c === "Zoe" && r.submitted[0].d === wed.toISOString().slice(0, 10),
    `${nc.to_review}: ${r.submitted.map((x) => `${x.g}/${x.c}/${x.d}`).join(", ")}`);
  rec("N3 note states: 1 submitted, 1 returned, 0 drafts (nobody has opened the live note)", r.statuses.submitted === 1 && r.statuses.returned === 1 && !r.statuses.draft, JSON.stringify(r.statuses));
  rec("N4 past visits with no note = exactly 1 (Ana, Max respite, last week: left out of the bill)",
    r.noNotePast.length === 1 && r.noNotePast[0].g === "Ana" && r.noNotePast[0].c === "Max" && r.noNotePast[0].d >= W.a && r.noNotePast[0].d < W.w0, JSON.stringify(r.noNotePast));
  rec("N5 the demo day: exactly 1 visit — Ana, Zoe, CLS, 08:00, no note yet (written live)",
    r.demoDay.length === 1 && r.demoDay[0].g === "Ana" && r.demoDay[0].c === "Zoe" && r.demoDay[0].code === "CLS0001" && r.demoDay[0].st === "08:00:00" && !r.demoDay[0].has_note, JSON.stringify(r.demoDay));
  const pastG = r.groups.filter((g) => g.d < r.asOf), nextG = r.groups.filter((g) => g.d > r.asOf);
  rec("N6 group sessions: 1 past CLS 1:2 (Zoe + Noah) with 2 reviewed group notes; 1 next week (Zoe + Noah)",
    pastG.length === 1 && pastG[0].r === "1:2" && pastG[0].clients === "Noah,Zoe" && pastG[0].notes === 2 && nextG.length === 1 && nextG[0].clients === "Noah,Zoe", JSON.stringify(r.groups));
  rec("N7 respite notes to print (reviewed or billed) exist", r.respite >= 1, `${r.respite}`);
  // ---- billing ----
  const wb = r.weekBefore.batches || [];
  rec("B1 the week before: exactly one bill, main, billed (locked)", wb.length === 1 && wb[0].status === "billed" && wb[0].supplement === 0,
    wb.map((b) => `${b.status} s${b.supplement}, ${b.totals.notes} notes, ${b.totals.units_billed} units`).join("; "));
  const lw = r.lastWeek, reasons = lw.excluded.map((x) => x.reason).sort();
  const cnt = (k) => reasons.filter((x) => x === k).length;
  rec("B2 last week: NOT built (next action 'build'); left out exactly: 1 submitted (not reviewed), 1 returned, 1 no note; 10 reviewed notes waiting to be built",
    lw.batches.length === 0 && lw.next_action === "build" && cnt("not_reviewed") === 1 && cnt("returned") === 1 && cnt("no_note") === 1 && cnt("not_in_bill_yet") === 10,
    `${lw.week_start}: ${lw.next_action}; reasons ${reasons.join(",")}`);
  rec("B3 billing week Sunday–Saturday (billing_week_start = 7)", W.wks === 7 && new Date(`${lw.week_start}T12:00:00Z`).getUTCDay() === 0, `${lw.week_start}..${lw.week_end}`);
  const st = (r.status || []).find((x) => x.office_id === off.id);
  rec("B4 dashboard billing line: last week not built", st && st.status === "not_built", JSON.stringify(st));
  const u = r.units.map((x) => `${x.dy} ${x.u}/${x.s}${x.late ? " late" : ""}${x.early ? " early" : ""}`);
  rec("B5 units: only full 15-minute blocks — 09:20 arrival bills 2 of 4, 09:50 departure bills 3 of 4",
    r.units.some((x) => x.late && x.u === 2 && x.s === 4) && r.units.some((x) => x.early && !x.late && x.u === 3 && x.s === 4), u.join(", "));
  // ---- part B3 ----
  const bands = r.creds.map((x) => `${x.caregiver_name}:${x.band}`).sort();
  rec("C1 credentials: exactly Ben yellow + Ben red + Mia ★ overdue in the panel; Ana every required credential green",
    eq(bands, ["Ben Carter:red", "Ben Carter:yellow", "Mia Lopez:overdue"]) && r.anaGreen.ok === r.anaGreen.req && r.anaGreen.req > 0, `${bands.join(", ")}; Ana ${r.anaGreen.ok}/${r.anaGreen.req} green`);
  const onb = Object.fromEntries(r.onboarding.map((o) => [name.get(o.client_id), o.onboarded ? "onboarded" : `${o.items.filter((i) => ["complete", "not_applicable"].includes(i.status)).length} of 8`]));
  rec("P1 onboarding: Zoe, Max, Noah, Ella onboarded; Lily 5 of 8",
    onb["Zoe Nguyen"] === "onboarded" && onb["Max Ortiz"] === "onboarded" && onb["Noah Kim"] === "onboarded" && onb["Ella Shaw"] === "onboarded" && onb["Lily Park"] === "5 of 8", JSON.stringify(onb));
  rec("P2 Zoe IPOS v1 superseded + v2 active (training v2)", eq(r.zoePlan, [{ version: 1, training_version: 1, status: "superseded" }, { version: 2, training_version: 2, status: "active" }]),
    r.zoePlan.map((p) => `v${p.version}/${p.status}/t${p.training_version}`).join(","));
  const risk = r.risk.map((x) => `${x.auth_number} ${x.days}d at-risk ${x.units_at_risk}`);
  const B = r.zoeAuth.find((x) => x.auth_number.endsWith("-B"));
  rec("P3 Zoe authorization A expiring (≤ 30 days) with units at risk is the only row in Units at risk; B healthy with a weekly cap of 16",
    r.risk.length === 1 && r.risk[0].auth_number === "DEMO-AUTH-1001-A" && r.risk[0].days <= 30 && Number(r.risk[0].units_at_risk) > 0 && B && B.per === "per_week" && B.cap === 16 && B.days > 60,
    `${risk.join("; ")}; B ${B ? `${B.per} ${B.cap}, ${B.days} d` : "missing"}`);
  rec("T1 retraining: exactly 1 visit — Mia on Zoe v2 (Ana and Ben retrained)", r.retrain.length === 1 && name.get(r.retrain[0].client_id) === "Zoe Nguyen" && r.retrain[0].training_version === 2,
    `${r.retrain.length} row(s): ${r.retrain.map((x) => `${name.get(x.client_id)} ${x.shift_date} cg ${cgName(x.caregiver_id).slice(0, 8)}`).join(", ")}`);
  const thu = new Date(`${W.w0}T12:00:00Z`); thu.setUTCDate(thu.getUTCDate() + 11);
  rec("S1 exactly 1 unassigned visit: Zoe, next week's Thursday", r.unassigned.length === 1 && r.unassigned[0].c === "Zoe" && r.unassigned[0].d === thu.toISOString().slice(0, 10), JSON.stringify(r.unassigned));
  rec("S2 readiness: enforcement off and upcoming visits it would block (Mia)", r.readiness.would_block > 0 && !r.readiness.enforcement, `${r.readiness.would_block} of ${r.readiness.shifts_checked}; ${JSON.stringify(r.readiness.by_reason)}`);
  rec("F1 setup: active plans use ≥ 6 of the 8 measure types", r.kinds.n >= 6, `${r.kinds.n}`);
  const m = r.menus;
  rec("M1 Client Inquiries: 3 inquiries, 2 new", Number(m.inquiries.all) === 3 && Number(m.inquiries.new) === 2, JSON.stringify(m.inquiries));
  rec("M2 Caregiver Applications: 3 pending", Number(m.applications.all) === 3 && Number(m.applications.pending) === 3, JSON.stringify(m.applications));
  rec("M3 Time Off Requests: 3 requests, 2 pending", Number(m.timeOff.all) === 3 && Number(m.timeOff.pending) === 2, JSON.stringify(m.timeOff));
  rec("M4 Shift Trades: 1 on the board (Ana sees it on her Trade Board), 1 waiting for approval", Number(m.trades.board) === 1 && Number(m.trades.approval) === 1 && m.tradeBoardAna === 1, `${JSON.stringify(m.trades)}; Ana's board ${m.tradeBoardAna}`);
  rec("M5 Notification Outbox: 3 messages, 2 not sent", Number(m.outbox.all) === 3 && Number(m.outbox.unsent) === 2, JSON.stringify(m.outbox));
  rec("A1 Files (S4b): Zoe's signed consent and the IPOS v2 sign-in sheet are attached (2 rows, 2 stored objects, readable by Pat)",
    m.files.rows === "client_document:Signed consent to services | training_form:IPOS v2 sign-in sheet" && Number(m.files.objects) === 2, JSON.stringify(m.files));
  console.log("summary: " + rows.map((x) => `${x.id.split(" ")[0]}=${x.ok ? "PASS" : "FAIL"}`).join(" "));
  if (rows.some((x) => !x.ok)) process.exitCode = 1;
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; }).finally(() => D.closeDb());

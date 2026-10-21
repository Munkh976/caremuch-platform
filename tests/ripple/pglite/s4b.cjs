// S4b attachments on PGlite: 20261028120000. Catalog (additive only; the events CHECK keeps its 52 values + 3), ACLs
// (API RPCs authenticated only; cp_ helpers no API role; the Edge Function helpers service_role only), the bucket,
// the upload life cycle (begin -> checked -> complete, audit ids only), scope per parent kind (T1-T5), storage.objects
// (read only through a readable active row; no write for API roles, T6), caregiver uploads to their own credential
// (entry unchanged; "waiting for HR" until HR saves it), soft remove (T10), views audited, earlier versions read-only,
// stale pending discard, "other" documents with a custom name, no names in paths or events (T9).
// Usage: node tests/ripple/pglite/s4b.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261028120000_s4b_attachments.sql";
const PDF = "application/pdf";

(async () => {
  const { rec, done } = H.recorder();
  const t = await H.boot(MIG); const { db, q, call, must } = t;
  const { CX, G, OX, OY, A, TZ, users } = H;
  const at = async (k) => (await q(`SELECT ((now() AT TIME ZONE '${TZ}')::date + $1::int)::text d`, [k]))[0].d;
  const before = await H.snap(db);
  const evCheck = async () => (await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'events_event_type_check'`))[0].d;
  const vals = (d) => [...d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  const ev0 = vals(await evCheck());
  await H.applyFiles(db, [MIG]);
  const after = await H.snap(db);
  const added = after.filter((x) => !before.includes(x)), removed = before.filter((x) => !after.includes(x));
  const ev1 = vals(await evCheck());
  rec("F0 catalog is additive: only the events CHECK is replaced (52 values kept + attachment_added / removed / viewed); new: cp_attachments, client_documents.display_name, the RPCs and helpers",
    removed.length === 1 && removed[0].startsWith("con:events.events_event_type_check") && ev0.length === 52 && ev1.length === 55
      && ev0.every((v) => ev1.includes(v)) && ["attachment_added", "attachment_removed", "attachment_viewed"].every((v) => ev1.includes(v))
      && added.includes("rel:cp_attachments:r") && added.some((x) => x.startsWith("col:client_documents.display_name:")),
    `-${removed.map((x) => x.slice(0, 40)).join(";")} +${added.length}; events ${ev0.length} -> ${ev1.length}`);
  const API = ["begin_attachment_upload", "complete_attachment_upload", "remove_attachment", "open_attachment", "list_attachments", "save_other_client_document"];
  const acl = await H.aclCheck(q, [...API, "cp_attachment_parent", "cp_attachment_allowed"]);
  const svcFns = await q(`SELECT proname, proacl::text a FROM pg_proc WHERE proname IN ('cp_attachment_mark_checked','cp_attachment_discard','cp_attachment_stale_pending') ORDER BY 1`);
  const grants = await q(`SELECT privilege_type p FROM information_schema.role_table_grants WHERE table_name = 'cp_attachments' AND grantee IN ('anon','authenticated') ORDER BY 1`);
  rec("ACL API RPCs SECURITY DEFINER + authenticated only; cp_ helpers no API role; Edge Function helpers service_role only; cp_attachments: authenticated SELECT only, anon nothing",
    acl.ok && svcFns.length === 3 && svcFns.every((f) => /service_role=X/.test(f.a) && !/(^|[{,])=X|anon=X|authenticated=X/.test(f.a))
      && grants.map((g) => g.p).join() === "SELECT",
    `${acl.detail}; ${svcFns.map((f) => `${f.proname} ${f.a}`).join(" | ")}; table ${grants.map((g) => g.p).join(",")}`);
  const b = (await q(`SELECT public, file_size_limit, allowed_mime_types::text m FROM storage.buckets WHERE id = 'cp-attachments'`))[0];
  rec("B1 bucket cp-attachments: private, 20 MB, PDF / JPEG / PNG / .docx only (no HEIC: converted on the device)",
    b && b.public === false && Number(b.file_size_limit) === 20971520 && b.m.split(",").length === 4 && !/heic/.test(b.m), JSON.stringify(b));

  // fixtures: plan, intake document, in-service, training session, credentials (G = cg's own; G2 another caregiver)
  await db.query("UPDATE virtual_office SET care_plan_module_enabled_at = now() - interval '40 days' WHERE id = $1", [OX]);
  const plan = await must("mgrX", "SELECT create_care_plan($1,'initial',$2::jsonb,$3::jsonb)", [CX, JSON.stringify({ effective_date: await at(-30), expiration_date: await at(300) }), "{}"]);
  const doc1 = await must("mgrX", "SELECT upsert_client_document($1,'consent','complete',NULL,$2::date,NULL,NULL,'{}'::jsonb)", [CX, await at(-10)]);
  const ins = await must("hrX", "SELECT record_inservice_form($1,'Robin Hale',$2,$3::date,now(),'{}'::jsonb)", [plan, users.mgrX, await at(-5)]);
  const S1 = await must("hrX", "SELECT record_training_form($1,'ipos_initial',NULL,NULL,$2::jsonb,'{}'::jsonb)", [plan, JSON.stringify([{ caregiver_id: G, training_date: await at(-4), trainer_name: "Pat Morgan", signed_date: await at(-4) }])]);
  const G2 = H.U(330);
  await db.query(`INSERT INTO caregivers (id, agency_id, first_name, last_name, virtual_office_id, is_active) VALUES ($1,$2,'Hal','Other',$3,true)`, [G2, A, OX]);
  const ct = (await q(`SELECT id FROM credential_types WHERE agency_id = $1 AND name = 'ICHAT'`, [A]))[0].id;
  const credG = await must("hrX", "SELECT enter_caregiver_credential($1,$2,$3::date,$4::date,NULL)", [G, ct, await at(-30), await at(300)]);
  const credG2 = await must("hrX", "SELECT enter_caregiver_credential($1,$2,$3::date,$4::date,NULL)", [G2, ct, await at(-30), await at(300)]);
  // the cert's updated_at is "now" of its transaction; uploads below are later transactions
  await db.query(`UPDATE caregiver_certifications SET updated_at = now() - interval '1 hour' WHERE id IN ($1,$2)`, [credG, credG2]);

  const svc = async (sql, p = []) => { await db.exec("BEGIN"); try { await db.exec("SET LOCAL ROLE service_role"); const r = await db.query(sql, p); await db.exec("COMMIT"); return { v: r.rows[0] && Object.values(r.rows[0])[0], rows: r.rows }; } catch (e) { await db.exec("ROLLBACK"); return { err: e.message }; } };
  const begin = (who, kind, parent, name = "Signed consent (scan)", mime = PDF, size = 1234) =>
    call(who, "SELECT begin_attachment_upload($1,$2,$3,$4,$5,$6)", [kind, parent, name, null, mime, size]);
  // the Edge Function's part: the object lands in the bucket, is checked, then the uploader completes it
  const upload = async (who, kind, parent, name, size = 1234) => {
    const r = await begin(who, kind, parent, name, PDF, size); if (r.err) throw new Error(`begin ${who} ${kind}: ${r.err}`);
    await db.query(`INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('cp-attachments', $1, $2::jsonb)`, [r.v.object_path, JSON.stringify({ size, mimetype: PDF })]);
    const m = await svc("SELECT cp_attachment_mark_checked($1,$2)", [r.v.id, size]); if (m.err || m.v !== true) throw new Error(`check: ${m.err || m.v}`);
    await must(who, "SELECT complete_attachment_upload($1)", [r.v.id]); return r.v;
  };
  const events = async (type, id) => (await q(`SELECT payload FROM events WHERE event_type = $1 AND subject_id = $2`, [type, id])).map((e) => e.payload);

  // U1: life cycle
  const p1 = await begin("mgrX", "client_document", doc1, "Carla Fixture consent.pdf");
  const row1 = (await q(`SELECT * FROM cp_attachments WHERE id = $1`, [p1.v.id]))[0];
  const seenPending = (await call("mgrX", "SELECT count(*)::int FROM cp_attachments WHERE id = $1", [p1.v.id])).v;
  const early = await call("mgrX", "SELECT complete_attachment_upload($1)", [p1.v.id]);
  await db.query(`INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('cp-attachments', $1, '{"size":1234}'::jsonb)`, [p1.v.object_path]);
  const badSize = await svc("SELECT cp_attachment_mark_checked($1,$2)", [p1.v.id, 999]);
  const okCheck = await svc("SELECT cp_attachment_mark_checked($1,$2)", [p1.v.id, 1234]);
  const notMine = await call("mgrA", "SELECT complete_attachment_upload($1)", [p1.v.id]);
  const done1 = await call("mgrX", "SELECT complete_attachment_upload($1)", [p1.v.id]);
  const e1 = await events("attachment_added", p1.v.id);
  rec("U1 begin -> pending row with a server path '<agency>/<office>/<id>' (no names, no extension), invisible while pending; complete refused until the object is checked (size must match) and for anyone but the uploader; then active; one attachment_added (ids, kind, type, size only)",
    p1.v.object_path === `${A}/${OX}/${p1.v.id}` && row1.completed_at === null && seenPending === 0 && /checked/.test(early.err || "")
      && badSize.v === false && okCheck.v === true && H.DENY.test(notMine.err || "") && !done1.err && e1.length === 1
      && Object.keys(e1[0]).sort().join() === "attachment_id,mime_type,parent_id,parent_kind,size_bytes" && !/Carla|consent/i.test(JSON.stringify(e1)),
    `path ok ${p1.v.object_path === `${A}/${OX}/${p1.v.id}`}; early ${early.err}; size ${badSize.v}/${okCheck.v}; other ${notMine.err}; audit ${JSON.stringify(e1)}`);
  const list = (await call("mgrX", "SELECT list_attachments('client_document', ARRAY[$1::uuid])", [doc1])).v;
  rec("U2 list_attachments: the file with its name, type, size, uploader (Manager X) and can_remove; not waiting for HR",
    list.length === 1 && list[0].display_name === "Carla Fixture consent.pdf" && list[0].uploaded_by === "Manager X" && list[0].can_remove === true && list[0].waiting_for_hr === false,
    JSON.stringify(list.map(({ display_name, uploaded_by, can_remove, size_bytes }) => ({ display_name, uploaded_by, can_remove, size_bytes }))));

  // T1-T5: scope of the RPCs, the table and the objects
  const tr = await upload("hrX", "training_form", S1, "Sign-in sheet");
  const cp = await upload("mgrX", "care_plan", plan, "ISK IPOS v1");
  const objects = async (who) => (await call(who, "SELECT coalesce(array_agg(name ORDER BY name), '{}') FROM storage.objects WHERE bucket_id = 'cp-attachments'")).v || [];
  const rows = async (who) => (await call(who, "SELECT count(*)::int FROM cp_attachments")).v;
  const view = {};
  for (const who of ["mgrX", "mgrA", "aaA", "hrX", "mgrY", "aaB", "schX", "cg", "cl"]) view[who] = { o: (await objects(who)).length, r: await rows(who) };
  const anonO = await call("anon", "SELECT count(*) FROM storage.objects"), anonT = await call("anon", "SELECT count(*) FROM cp_attachments");
  rec("T1-T5 reads: managers / admins of the office see the 3 files (rows and objects); hr_staff only the training file (not the intake document or the plan); office-Y manager, other agency, scheduler, caregiver, client: none; anon: no table access",
    view.mgrX.o === 3 && view.mgrX.r === 3 && view.mgrA.r === 3 && view.aaA.r === 3 && view.hrX.r === 1 && view.hrX.o === 1
      && ["mgrY", "aaB", "schX", "cg", "cl"].every((w) => view[w].o === 0 && view[w].r === 0) && !!anonT.err,
    `${Object.entries(view).map(([k, v]) => `${k} ${v.r}/${v.o}`).join(", ")}; anon table ${anonT.err ? "refused" : anonT.v}; anon objects ${anonO.err ? "refused" : anonO.v}`);
  const deny = [];
  for (const [who, kind, parent] of [["mgrY", "client_document", doc1], ["aaB", "client_document", doc1], ["schX", "training_form", S1], ["cg", "client_document", doc1],
    ["cl", "client_document", doc1], ["anon", "client_document", doc1], ["hrX", "client_document", doc1], ["hrX", "care_plan", plan], ["cg", "credential", credG2], ["mgrX", "nonsense", doc1], ["mgrX", "client_document", H.U(999)]]) {
    const r = await begin(who, kind, parent); if (r.err && H.DENY.test(r.err)) deny.push(who); else console.log("  not refused:", who, kind, r.err || JSON.stringify(r.v));
  }
  const opens = [];
  for (const who of ["mgrY", "aaB", "schX", "cg", "cl", "anon", "hrX"]) { const r = await call(who, "SELECT open_attachment($1)", [p1.v.id]); if (r.err && H.DENY.test(r.err)) opens.push(who); }
  const lists = [];
  for (const who of ["mgrY", "aaB", "cg", "anon"]) { const r = await call(who, "SELECT list_attachments('client_document', ARRAY[$1::uuid])", [doc1]); if (r.err && H.DENY.test(r.err)) lists.push(who); }
  rec("T1b RPCs refused (generic): begin for 11 wrong caller / parent combinations (other office, agency, scheduler, caregiver on a client document or another caregiver's credential, client, anon, HR on intake / plan, unknown kind or parent); open and list likewise",
    deny.length === 11 && opens.length === 7 && lists.length === 4, `begin ${deny.length}/11; open ${opens.length}/7; list ${lists.length}/4`);

  // T6: no direct storage writes
  const w = {};
  for (const who of ["mgrX", "cg", "anon"]) {
    w[who] = [await call(who, `INSERT INTO storage.objects (bucket_id, name) VALUES ('cp-attachments', '${A}/${OX}/x')`),
      await call(who, `UPDATE storage.objects SET metadata = '{}' WHERE bucket_id = 'cp-attachments' RETURNING id`),
      await call(who, `DELETE FROM storage.objects WHERE bucket_id = 'cp-attachments' RETURNING id`)];
  }
  const wOk = Object.values(w).every(([i, u, d]) => !!i.err && (u.err || !u.rows.length) && (d.err || !d.rows.length));
  const tw = await call("mgrX", `UPDATE cp_attachments SET display_name = 'x' RETURNING id`);
  rec("T6 API roles can't insert, update or delete objects in the bucket (no write policy) nor write cp_attachments (no grant)",
    wOk && !!tw.err && (await q(`SELECT count(*)::int n FROM storage.objects WHERE bucket_id='cp-attachments'`))[0].n === 3,
    Object.entries(w).map(([k, [i, u, d]]) => `${k} ins ${i.err ? "refused" : "OK"} upd ${u.err ? "refused" : u.rows.length} del ${d.err ? "refused" : d.rows.length}`).join("; ") + `; table ${tw.err ? "refused" : "OK"}`);

  // T8: type and size
  const heic = await begin("mgrX", "client_document", doc1, "photo", "image/heic");
  const exe = await begin("mgrX", "client_document", doc1, "x", "application/x-msdownload");
  const big = await begin("mgrX", "client_document", doc1, "big", PDF, 20971521);
  const max = await begin("mgrX", "client_document", doc1, "max", PDF, 20971520);
  const noName = await begin("mgrX", "client_document", doc1, "  ");
  rec("T8 refused with the reason: HEIC (converted on the device instead), an executable type, 20 MB + 1 byte, an empty name; exactly 20 MB accepted",
    /isn't accepted/.test(heic.err || "") && /isn't accepted/.test(exe.err || "") && /20 MB/.test(big.err || "") && !max.err && /name/.test(noName.err || ""),
    [heic, exe, big, max, noName].map((x) => (x.err || "ACCEPTED").slice(0, 40)).join(" | "));

  // caregiver: own credential
  const cgU = await upload("cg", "credential", credG, "My ICHAT letter");
  const certBefore = (await q(`SELECT is_verified, expiry_date::text e, updated_at FROM caregiver_certifications WHERE id = $1`, [credG]))[0];
  const hrU = await upload("hrX", "credential", credG, "ICHAT result (HR)");
  const cgList = (await call("cg", "SELECT list_attachments('credential', ARRAY[$1::uuid])", [credG])).v;
  const cgSeesObj = (await objects("cg")).length;
  const hrList1 = (await call("hrX", "SELECT list_attachments('credential', ARRAY[$1::uuid])", [credG])).v;
  rec("C1 the caregiver uploads to their own credential: the entry is unchanged (is_verified, dates); HR sees the caregiver's file as waiting for HR; the caregiver sees both files of their credential (rows and objects)",
    certBefore.is_verified === true && certBefore.e === await at(300) && cgList.length === 2 && cgSeesObj === 2
      && hrList1.find((x) => x.id === cgU.id).waiting_for_hr === true && hrList1.find((x) => x.id === cgU.id).by_caregiver === true && hrList1.find((x) => x.id === hrU.id).waiting_for_hr === false,
    `cert ${JSON.stringify({ v: certBefore.is_verified, e: certBefore.e })}; cg ${cgList.length} files, ${cgSeesObj} objects; waiting ${hrList1.map((x) => x.waiting_for_hr).join(",")}`);
  await must("hrX", "SELECT enter_caregiver_credential($1,$2,$3::date,$4::date,NULL)", [G, ct, await at(-1), await at(364)]);
  const hrList2 = (await call("hrX", "SELECT list_attachments('credential', ARRAY[$1::uuid])", [credG])).v;
  const cgRemoveHr = await call("cg", "SELECT remove_attachment($1,'wrong file')", [hrU.id]);
  const cgRemoveOwn = await call("cg", "SELECT remove_attachment($1,'wrong file')", [cgU.id]);
  rec("C2 after HR renews the entry the caregiver's file is no longer waiting; the caregiver can remove their own upload but not HR's (generic)",
    hrList2.find((x) => x.id === cgU.id).waiting_for_hr === false && H.DENY.test(cgRemoveHr.err || "") && !cgRemoveOwn.err,
    `waiting ${hrList2.find((x) => x.id === cgU.id).waiting_for_hr}; HR file ${cgRemoveHr.err}; own ${cgRemoveOwn.err || "removed"}`);

  // views and remove
  const v0 = (await events("attachment_viewed", p1.v.id)).length;
  const op = await call("mgrX", "SELECT open_attachment($1)", [p1.v.id]);
  const v1 = await events("attachment_viewed", p1.v.id);
  rec("V1 open_attachment returns the path, name and type for the signed URL; every open is audited (attachment_viewed, ids only); refused opens leave no row",
    op.v.object_path === p1.v.object_path && v0 === 0 && v1.length === 1 && Object.keys(v1[0]).sort().join() === "attachment_id,parent_id,parent_kind",
    `${JSON.stringify(v1)}`);
  const objBefore = (await objects("mgrX")).length;
  const noReason = await call("mgrX", "SELECT remove_attachment($1,'  ')", [p1.v.id]);
  const hrRm = await call("hrX", "SELECT remove_attachment($1,'not mine')", [p1.v.id]);
  const rm = await call("mgrX", "SELECT remove_attachment($1,'Duplicate of the signed copy')", [p1.v.id]);
  const after1 = (await call("mgrX", "SELECT list_attachments('client_document', ARRAY[$1::uuid])", [doc1])).v;
  const objStill = (await q(`SELECT count(*)::int n FROM storage.objects WHERE name = $1`, [p1.v.object_path]))[0].n;
  const rmEv = await events("attachment_removed", p1.v.id);
  const reopen = await call("mgrX", "SELECT open_attachment($1)", [p1.v.id]);
  rec("T10 remove needs a reason and the parent's tier (HR can't remove an intake file); after removal the file isn't listed, readable or openable; the object stays (retention); attachment_removed has no reason text",
    /why/.test(noReason.err || "") && H.DENY.test(hrRm.err || "") && !rm.err && after1.length === 0 && objStill === 1 && (await objects("mgrX")).length === objBefore - 1
      && rmEv.length === 1 && !/Duplicate/.test(JSON.stringify(rmEv)) && H.DENY.test(reopen.err || ""),
    `reason ${noReason.err}; hr ${hrRm.err}; listed ${after1.length}; object ${objStill}; event ${JSON.stringify(rmEv)}`);

  // earlier versions are read-only
  await must("mgrX", "SELECT upsert_client_document($1,'consent','complete',NULL,$2::date,NULL,NULL,'{}'::jsonb)", [CX, await at(-1)]);
  const oldDoc = await begin("mgrX", "client_document", doc1);
  const oldList = (await call("mgrX", "SELECT list_attachments('client_document', ARRAY[$1::uuid])", [doc1])).v;
  await must("mgrX", "SELECT renew_care_plan($1)", [plan]);
  const oldTr = await begin("hrX", "training_form", S1), oldPlan = await begin("mgrX", "care_plan", plan);
  const trStill = (await call("hrX", "SELECT list_attachments('training_form', ARRAY[$1::uuid])", [S1])).v;
  rec("R1 earlier versions keep their files read-only: a superseded intake document version, a training session or the plan of a superseded version refuse new files (reason) and still list theirs",
    [oldDoc, oldTr, oldPlan].every((x) => /earlier version/.test(x.err || "")) && trStill.length === 1 && oldList.length === 0,
    [oldDoc, oldTr, oldPlan].map((x) => (x.err || "ACCEPTED").slice(0, 40)).join(" | ") + `; training files ${trStill.length}`);

  // stale pending (answer 6) and the service-only helpers
  const stale = await begin("mgrX", "client_document", (await q(`SELECT id FROM client_documents WHERE client_id = $1 AND is_current AND doc_type = 'consent'`, [CX]))[0].id, "abandoned");
  await db.query(`UPDATE cp_attachments SET uploaded_at = now() - interval '25 hours' WHERE id = $1`, [stale.v.id]);
  const authSvc = await call("mgrX", "SELECT cp_attachment_mark_checked($1,1234)", [stale.v.id]);
  const authStale = await call("mgrX", "SELECT count(*) FROM cp_attachment_stale_pending(24)");
  const listed = (await svc("SELECT id FROM cp_attachment_stale_pending(24)")).rows.map((r) => r.id);
  const disc = await svc("SELECT cp_attachment_discard($1)", [stale.v.id]);
  const discDone = await svc("SELECT cp_attachment_discard($1)", [tr.id]);
  rec("P1 pending uploads older than 24 h are listed for the Edge Function's cleanup and discarded (path returned to remove the object); a completed file is never discarded; API roles can't call these helpers",
    listed.includes(stale.v.id) && !listed.includes(tr.id) && disc.v === stale.v.object_path && discDone.v === null
      && /permission denied/.test(authSvc.err || "") && /permission denied/.test(authStale.err || ""),
    `listed ${listed.length}; discard ${disc.v ? "path" : disc.err}; completed ${discDone.v}; api ${(authSvc.err || "").slice(0, 30)}`);

  // "other" documents
  const o1 = await call("mgrX", "SELECT save_other_client_document($1,NULL,'Guardianship letter','complete',NULL,$2::date,$3::date)", [CX, await at(-3), await at(360)]);
  const r1 = (await q(`SELECT doc_type, display_name, version, is_current FROM client_documents WHERE id = $1`, [o1.v]))[0];
  const o2 = await call("mgrX", "SELECT save_other_client_document($1,$2,'Guardianship letter (court copy)','expired',NULL,NULL,NULL)", [CX, r1.doc_type]);
  const r2 = (await q(`SELECT doc_type, display_name, version FROM client_documents WHERE id = $1`, [o2.v]))[0];
  const badT = await call("mgrX", "SELECT save_other_client_document($1,'consent','x','complete')", [CX]);
  const otherY = await call("mgrY", "SELECT save_other_client_document($1,NULL,'x','complete')", [CX]);
  const noNm = await call("mgrX", "SELECT save_other_client_document($1,NULL,' ','complete')", [CX]);
  const onb = (await call("mgrX", "SELECT get_client_onboarding_status($1)", [CX]));
  const saved = await events("client_document_saved", o1.v);
  rec("O1 Add other document: doc_type other_<12 hex> (no name in it) with the custom name; saving again makes version 2 with the new name; refused: a standard type, another office (generic), no name; audited client_document_saved (ids only)",
    /^other_[0-9a-f]{12}$/.test(r1.doc_type) && r1.display_name === "Guardianship letter" && r2.version === 2 && r2.display_name === "Guardianship letter (court copy)" && r2.doc_type === r1.doc_type
      && /Unknown other/.test(badT.err || "") && H.DENY.test(otherY.err || "") && /name/.test(noNm.err || "") && saved.length === 1 && !/Guardianship/.test(JSON.stringify(saved)),
    `${r1.doc_type} "${r1.display_name}" v${r2.version}; ${[badT, otherY, noNm].map((x) => (x.err || "OK").slice(0, 30)).join(" | ")}; onboarding ${onb.err ? onb.err.slice(0, 40) : "ok"}`);
  const att = await upload("mgrX", "client_document", o2.v, "court copy");
  rec("O2 files attach to an other document like to any intake document", !!att.id, att.id);

  // T9: no names anywhere in paths or attachment events
  const paths = (await q(`SELECT object_path FROM cp_attachments`)).map((r) => r.object_path);
  const evs = JSON.stringify((await q(`SELECT payload FROM events WHERE event_type LIKE 'attachment_%'`)).map((r) => r.payload));
  rec("T9 paths are '<agency>/<office>/<uuid>' only, and no attachment event carries a display name, description or person name",
    paths.every((p) => /^[0-9a-f-]{36}\/([0-9a-f-]{36}|none)\/[0-9a-f-]{36}$/.test(p)) && !/Carla|Fixture|Gina|ICHAT|Sign-in|IPOS|court|Guardianship|letter/i.test(evs),
    `${paths.length} paths; events ${evs.length} chars`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

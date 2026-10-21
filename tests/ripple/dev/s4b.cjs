// S4b attachments on DEV through real logins and the deployed cp-attachments Edge Function (mirrors pglite/s4b.cjs).
// `before`: no cp_attachments, no bucket, the events CHECK as stored (md5), the function not deployed; NB1.
// `after`: ACLs (aclexplode), bucket and storage policies; upload -> check -> complete -> list -> preview / download
// through 60-second signed URLs (expired after 60 s, T7); scope refusals (T1-T5); no direct storage writes (T6);
// disguised type, size mismatch and wrong Content-Type refused (T8); caregiver's own credential upload (entry
// unchanged, waiting for HR); soft remove keeps the object (T10); views audited; cleanup of pending > 24 h; no names
// in paths or events (T9); NB1. Fictitious bytes only. Teardown removes the objects through the Storage API.
// Usage: node tests/ripple/dev/s4b.cjs <before|after> > some.log 2>&1
const { A, REF, LABEL, RUN, URL_, ANON, admin, log, rec, pass, rpc, pgRead, setup, setupB1, checkNoBreak, dbDay, dbNow, teardownB1, teardownB2, teardown, closeDb, summary, reportSkew, createClient, opts } = require("./lib.cjs");
const BUCKET = "cp-attachments", PDF = "application/pdf";
const EVENTS_BEFORE = "cc3ec9cd111c20b3754c4cc7973fa668";   // md5(pg_get_constraintdef) of events_event_type_check before the push (Oct 21)
const API = ["begin_attachment_upload", "complete_attachment_upload", "remove_attachment", "open_attachment", "list_attachments", "save_other_client_document"];
const SVC = ["cp_attachment_mark_checked", "cp_attachment_discard", "cp_attachment_stale_pending"], INTERNAL = ["cp_attachment_parent", "cp_attachment_allowed"];
const pdfBytes = (n = 1500) => { const b = Buffer.alloc(n, 0x20); b.write("%PDF-1.4\n% fictitious test file\n"); b.write("%%EOF", n - 5); return b; };
const fnUrl = `${URL_}/functions/v1/cp-attachments`;
const token = async (c) => (await c.auth.getSession()).data.session.access_token;
async function fn(c, body, bearer = null) {
  const r = await fetch(fnUrl, { method: "POST", headers: { Authorization: `Bearer ${bearer || await token(c)}`, apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, ...(j || {}) };
}
async function uploadVia(c, kind, parent, name, bytes = pdfBytes(), mime = PDF, size = null) {
  const b = await fn(c, { action: "begin", parent_kind: kind, parent_id: parent, display_name: name, mime_type: mime, size_bytes: size ?? bytes.length });
  if (b.status !== 200) return { stage: "begin", ...b };
  const up = await c.storage.from(BUCKET).uploadToSignedUrl(b.path, b.token, bytes, { contentType: mime });
  if (up.error) return { stage: "upload", id: b.id, error: up.error.message };
  const done = await fn(c, { action: "complete", id: b.id });
  return { stage: done.status === 200 ? "done" : "complete", id: b.id, path: b.path, ...done };
}

async function after(F) {
  const must = async (c, f, args) => { const r = await rpc(c, f, args); if (r.err) throw new Error(`${f}: ${r.err}`); return r.v; };
  const anon = createClient(URL_, ANON, opts);
  const cat = await pgRead(async (c) => ({
    fns: (await c.query(`SELECT p.proname n, p.prosecdef d, (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY 1) FROM aclexplode(p.proacl) x) acl
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [[...API, ...SVC, ...INTERNAL]])).rows,
    bucket: (await c.query(`SELECT public, file_size_limit::bigint lim, allowed_mime_types::text m FROM storage.buckets WHERE id = $1`, [BUCKET])).rows[0],
    pols: (await c.query(`SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND (qual LIKE '%cp-attachments%' OR with_check LIKE '%cp-attachments%')`)).rows,
    grants: (await c.query(`SELECT grantee, privilege_type p FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='cp_attachments' AND grantee IN ('anon','authenticated') ORDER BY 1,2`)).rows,
    ev: (await c.query(`SELECT md5(pg_get_constraintdef(oid)) h FROM pg_constraint WHERE conname='events_event_type_check'`)).rows[0].h,
  }));
  const fOk = (n, re, bad) => { const f = cat.fns.find((x) => x.n === n); return f && f.d && re.test(f.acl || "") && !bad.test(f.acl || ""); };
  rec("ACL (aclexplode) 6 API RPCs SECURITY DEFINER, EXECUTE authenticated only; 3 Edge Function helpers service_role only; 2 internal helpers no API role; cp_attachments: authenticated SELECT only, anon none",
    pass(cat.fns.length === 11 && API.every((n) => fOk(n, /authenticated:EXECUTE/, /(^|,)(-|anon|public):/i))
      && SVC.every((n) => fOk(n, /service_role:EXECUTE/, /(^|,)(-|anon|public|authenticated):/i)) && INTERNAL.every((n) => fOk(n, /./, /(^|,)(-|anon|public|authenticated):/i))
      && cat.grants.map((g) => `${g.grantee}:${g.p}`).join() === "authenticated:SELECT"),
    cat.fns.map((f) => `${f.n} ${f.acl}`).join(" | ") + `; table ${cat.grants.map((g) => `${g.grantee}:${g.p}`).join(",")}`);
  rec("B1 bucket private, 20 MB, PDF / JPEG / PNG / .docx; storage.objects has exactly one cp-attachments policy, SELECT; events CHECK changed",
    pass(cat.bucket && cat.bucket.public === false && Number(cat.bucket.lim) === 20971520 && cat.bucket.m.split(",").length === 4 && cat.pols.length === 1 && cat.pols[0].cmd === "SELECT" && cat.ev !== EVENTS_BEFORE),
    `${JSON.stringify(cat.bucket)}; ${JSON.stringify(cat.pols)}`);

  // fixtures
  F.ctBefore = new Set(((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id));
  await must(F.aaA.c, "seed_office_care_plan_defaults", { _office_id: F.OX });
  F.newCredTypes = ((await admin.from("credential_types").select("id").eq("agency_id", A)).data || []).map((x) => x.id).filter((id) => !F.ctBefore.has(id));
  await admin.from("virtual_office").update({ care_plan_module_enabled_at: new Date(Date.parse(await dbNow()) - 20 * 864e5).toISOString() }).eq("id", F.OX);
  const doc = await must(F.mgrX.c, "upsert_client_document", { _client_id: F.CX, _doc_type: "consent", _status: "complete", _effective_date: await dbDay(-5) });
  const ct = ((await admin.from("credential_types").select("id").eq("agency_id", A).eq("name", "ICHAT").limit(1)).data || [])[0].id;
  const cred = await must(F.hrX.c, "enter_caregiver_credential", { _caregiver_id: F.G, _credential_type_id: ct, _effective_date: await dbDay(-30), _expiry_date: await dbDay(300) });
  F.att = [];

  // D1: life cycle as the manager
  const u1 = await uploadVia(F.mgrX.c, "client_document", doc, `ZZ consent ${RUN}`); F.att.push(u1.id);
  const list = (await rpc(F.mgrX.c, "list_attachments", { _parent_kind: "client_document", _parent_ids: [doc] })).v || [];
  const prev = await fn(F.mgrX.c, { action: "open", id: u1.id }), dl = await fn(F.mgrX.c, { action: "open", id: u1.id, download: true });
  const g1 = await fetch(prev.url), body1 = Buffer.from(await g1.arrayBuffer()), g2 = await fetch(dl.url);
  const cd = g2.headers.get("content-disposition") || ""; await g2.arrayBuffer();
  const evs = ((await admin.from("events").select("event_type, payload").eq("subject_id", u1.id)).data || []);
  rec("D1 manager: begin -> signed upload -> complete (size + signature checked) -> listed; preview URL serves the same bytes as application/pdf; download URL names the file; audit attachment_added + 2 attachment_viewed, ids only",
    pass(u1.stage === "done" && list.length === 1 && list[0].display_name === `ZZ consent ${RUN}` && g1.status === 200 && body1.equals(pdfBytes()) && /pdf/.test(g1.headers.get("content-type") || "")
      && /attachment/.test(cd) && cd.includes(`ZZ consent ${RUN}.pdf`) && evs.filter((e) => e.event_type === "attachment_added").length === 1 && evs.filter((e) => e.event_type === "attachment_viewed").length === 2
      && !/ZZ|consent/.test(JSON.stringify(evs.map((e) => e.payload)))),
    `${u1.stage} ${u1.error || ""}; listed ${list.length}; preview ${g1.status} ${g1.headers.get("content-type")}; disposition ${cd ? "set" : "none"}; events ${evs.map((e) => e.event_type).join(",")}`);

  // T1-T5
  const refused = [];
  for (const [who, c] of [["mgrY", F.mgrY.c], ["aaB", F.aaB.c], ["schX", F.schX.c], ["cg", F.cg.c], ["cl", F.cl.c], ["hrX", F.hrX.c]]) {
    const o = await fn(c, { action: "open", id: u1.id }), b = await fn(c, { action: "begin", parent_kind: "client_document", parent_id: doc, display_name: "x", mime_type: PDF, size_bytes: 10 });
    const d = await c.storage.from(BUCKET).download(u1.path);
    if (o.status === 403 && b.status === 403 && d.error) refused.push(who); else log(`  not refused: ${who} open ${o.status} begin ${b.status} direct ${d.error ? "refused" : "OK"}`);
  }
  const anonOpen = await fn(anon, { action: "open", id: u1.id }, ANON), anonDl = await anon.storage.from(BUCKET).download(u1.path);
  const mgrDirect = await F.mgrX.c.storage.from(BUCKET).download(u1.path);
  rec("T1-T5 office-Y manager, other agency, scheduler, caregiver, client and HR (intake tier) can't open, add or download directly; anon neither; the manager can (direct read through the policy)",
    pass(refused.length === 6 && anonOpen.status >= 400 && !!anonDl.error && !mgrDirect.error), `${refused.length}/6; anon open ${anonOpen.status} direct ${anonDl.error ? "refused" : "OK"}; manager direct ${mgrDirect.error ? mgrDirect.error.message : "OK"}`);

  // T6: no direct writes
  const w1 = await F.mgrX.c.storage.from(BUCKET).upload(`${A}/${F.OX}/zz-${RUN}`, pdfBytes(), { contentType: PDF });
  const w2 = await F.mgrX.c.storage.from(BUCKET).upload(u1.path, pdfBytes(), { contentType: PDF, upsert: true });
  const w3 = await F.mgrX.c.storage.from(BUCKET).remove([u1.path]);
  const still = (await admin.storage.from(BUCKET).list(`${A}/${F.OX}`, { search: u1.id })).data || [];
  rec("T6 an authenticated user can't upload to a known path, overwrite an object or delete one (no write policy)",
    pass(!!w1.error && !!w2.error && still.length === 1), `new ${w1.error ? "refused" : "OK"}; overwrite ${w2.error ? "refused" : "OK"}; delete -> object still there ${still.length === 1}`);

  // T8
  const exe = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(800, 1)]);
  const t8a = await uploadVia(F.mgrX.c, "client_document", doc, "renamed.exe", exe);
  const t8aRow = (await admin.from("cp_attachments").select("id").eq("id", t8a.id)).data || [];
  const t8aObj = (await admin.storage.from(BUCKET).list(`${A}/${F.OX}`, { search: t8a.id })).data || [];
  const t8b = await uploadVia(F.mgrX.c, "client_document", doc, "short", pdfBytes(900), PDF, 2000);
  const t8c = await uploadVia(F.mgrX.c, "client_document", doc, "wrong type", pdfBytes(), "application/x-msdownload");
  const t8d = await uploadVia(F.mgrX.c, "client_document", doc, "big", pdfBytes(), PDF, 20971521);
  if (t8b.id) F.att.push(t8b.id);
  rec("T8 an executable renamed to PDF is refused on complete (row and object discarded); a size mismatch is refused; a disallowed type and 20 MB + 1 are refused at begin",
    pass(t8a.stage === "complete" && /don't match its type/.test(t8a.error || "") && t8aRow.length === 0 && t8aObj.length === 0 && t8b.stage === "complete" && /size/.test(t8b.error || "")
      && t8c.stage === "begin" && /isn't accepted/.test(t8c.error || "") && t8d.stage === "begin" && /20 MB/.test(t8d.error || "")),
    [t8a, t8b, t8c, t8d].map((x) => `${x.stage}: ${(x.error || "").slice(0, 40)}`).join(" | ") + `; exe row ${t8aRow.length} object ${t8aObj.length}`);

  // caregiver's own credential
  const certBefore = (await admin.from("caregiver_certifications").select("is_verified, expiry_date, effective_date").eq("id", cred).single()).data;
  const c1 = await uploadVia(F.cg.c, "credential", cred, "My ICHAT letter"); F.att.push(c1.id);
  const certAfter = (await admin.from("caregiver_certifications").select("is_verified, expiry_date, effective_date").eq("id", cred).single()).data;
  const hrL = (await rpc(F.hrX.c, "list_attachments", { _parent_kind: "credential", _parent_ids: [cred] })).v || [];
  const cgOpen = await fn(F.cg.c, { action: "open", id: c1.id });
  const other = await fn(F.cg.c, { action: "begin", parent_kind: "credential", parent_id: cred, display_name: "x", mime_type: PDF, size_bytes: 10 });
  if (other.id) await admin.from("cp_attachments").delete().eq("id", other.id);
  rec("C1 the caregiver uploads a scan to their own credential and can open it; the entry is unchanged (verified flag, dates); HR sees it as waiting for HR",
    pass(c1.stage === "done" && cgOpen.status === 200 && JSON.stringify(certBefore) === JSON.stringify(certAfter) && hrL.length === 1 && hrL[0].waiting_for_hr === true && hrL[0].by_caregiver === true),
    `${c1.stage} ${c1.error || ""}; open ${cgOpen.status}; entry ${JSON.stringify(certAfter)}; waiting ${hrL[0] && hrL[0].waiting_for_hr}`);

  // T7: the signed URL stops working after 60 s
  const t7 = await fn(F.mgrX.c, { action: "open", id: u1.id });
  const ok7 = (await fetch(t7.url)).status;
  log("  waiting 65 s for the signed URL to expire…");
  await new Promise((r) => setTimeout(r, 65000));
  const late7 = await fetch(t7.url); await late7.arrayBuffer();
  rec("T7 a signed URL works right away and is refused after 60 s", pass(ok7 === 200 && late7.status >= 400), `now ${ok7}; after 65 s ${late7.status}`);

  // T10 remove
  const rm = await rpc(F.mgrX.c, "remove_attachment", { _id: u1.id, _reason: "Duplicate (test)" });
  const reopen = await fn(F.mgrX.c, { action: "open", id: u1.id });
  const obj10 = (await admin.storage.from(BUCKET).list(`${A}/${F.OX}`, { search: u1.id })).data || [];
  const rmEv = ((await admin.from("events").select("payload").eq("subject_id", u1.id).eq("event_type", "attachment_removed")).data || []);
  rec("T10 removed: not openable, the object stays (retention), attachment_removed without the reason text",
    pass(!rm.err && reopen.status === 403 && obj10.length === 1 && rmEv.length === 1 && !/Duplicate/.test(JSON.stringify(rmEv))), `${rm.err || "removed"}; reopen ${reopen.status}; object ${obj10.length}`);

  // cleanup of pending uploads older than 24 h (the Edge Function's cleanup action; service-role bearer only)
  const p = await fn(F.mgrX.c, { action: "begin", parent_kind: "client_document", parent_id: doc, display_name: "abandoned", mime_type: PDF, size_bytes: 100 });
  await admin.from("cp_attachments").update({ uploaded_at: new Date(Date.parse(await dbNow()) - 25 * 3600e3).toISOString() }).eq("id", p.id);
  const byUser = await fn(F.mgrX.c, { action: "cleanup" });
  const cl = await fn(null, { action: "cleanup" }, admin.supabaseKey);   // the service key, in memory only
  const gone = (await admin.from("cp_attachments").select("id").eq("id", p.id)).data || [];
  rec("P1 cleanup: refused for a user; with the service role it discards the pending upload older than 24 h",
    pass(byUser.status === 403 && cl.status === 200 && cl.discarded >= 1 && gone.length === 0), `user ${byUser.status}; service ${cl.status} discarded ${cl.discarded}; row ${gone.length}`);

  // T9
  const rowsAll = (await admin.from("cp_attachments").select("id, object_path").eq("virtual_office_id", F.OX)).data || [];
  const evAll = JSON.stringify(((await admin.from("events").select("payload").eq("virtual_office_id", F.OX).like("event_type", "attachment_%")).data || []).map((e) => e.payload));
  rec("T9 object paths are '<agency>/<office>/<uuid>' only; no attachment event carries a name", pass(rowsAll.length >= 2 && rowsAll.every((r) => r.object_path === `${A}/${F.OX}/${r.id}`) && !/ZZ|ICHAT|letter|consent|abandoned/i.test(evAll)),
    `${rowsAll.length} rows; events ${evAll.length} chars`);
}

(async () => {
  log(`=== S4b attachments — ${LABEL} — project ${REF} ===`);
  await reportSkew();
  let F;
  try {
    if (LABEL === "before") {
      const b = await pgRead(async (c) => (await c.query(`SELECT to_regclass('public.cp_attachments') t, (SELECT count(*)::int FROM storage.buckets WHERE id = $1) b,
        (SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conname='events_event_type_check') ev,
        (SELECT count(*)::int FROM pg_proc WHERE proname = ANY($2)) f`, [BUCKET, [...API, ...SVC, ...INTERNAL]])).rows[0]);
      const fnProbe = await fetch(fnUrl, { method: "OPTIONS" });
      rec("B0 before: no cp_attachments, no bucket, none of the 11 functions, events CHECK as stored (md5); Edge Function not deployed",
        pass(b.t === null && b.b === 0 && b.f === 0 && b.ev === EVENTS_BEFORE && fnProbe.status === 404), `${JSON.stringify(b)}; function ${fnProbe.status}`);
    }
    F = await setup(); await setupB1(F);
    await checkNoBreak(F);
    if (LABEL !== "before") await after(F);
  } catch (e) { log("ERROR:", String(e.message).slice(0, 300)); rec("ERROR", "FAIL"); }
  finally {
    if (F && LABEL !== "before") {
      const objs = ((await admin.storage.from(BUCKET).list(`${A}/${F.OX}`, { limit: 1000 })).data || []).map((o) => `${A}/${F.OX}/${o.name}`);
      if (objs.length) await admin.storage.from(BUCKET).remove(objs);
      await admin.from("cp_attachments").delete().eq("virtual_office_id", F.OX);
      for (const t of F.newCredTypes || []) { await admin.from("caregiver_certifications").delete().eq("credential_type_id", t); await admin.from("credential_types").delete().eq("id", t); }
      await teardownB2(F);
    }
    await teardownB1(F); await teardown(F);
    if (F && LABEL !== "before") {
      const left = await pgRead(async (c) => (await c.query(`SELECT (SELECT count(*) FROM storage.objects WHERE bucket_id = $1 AND name LIKE $2)::int objects,
        (SELECT count(*) FROM public.cp_attachments WHERE virtual_office_id = $3 OR client_id = $4 OR caregiver_id = $5)::int rows,
        (SELECT count(*) FROM public.events WHERE virtual_office_id = $3)::int events`, [BUCKET, `${A}/${F.OX}/%`, F.OX, F.CX, F.G])).rows[0]);
      log(`s4b teardown re-query: ${JSON.stringify(left)} → ${Object.values(left).every((v) => v === 0) ? "NONE remaining" : "LEFTOVERS"}`);
    }
    await closeDb();
  }
  summary();
})();

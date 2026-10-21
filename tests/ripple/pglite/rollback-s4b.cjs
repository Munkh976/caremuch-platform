// Rollback proof for 20261028120000 (S4b attachments): s4b_attachments_rollback.sql restores the exact catalog before
// the migration (public schema + the storage bucket and policies); the restored events CHECK is byte-identical to
// DEV's before the push (md5); the rollback refuses, changing nothing, while a file row or object exists; re-applying
// equals the first apply.
// Usage: node tests/ripple/pglite/rollback-s4b.cjs   (local, no network)
const H = require("./harness.cjs");
const MIG = "20261028120000_s4b_attachments.sql", RB = "s4b_attachments_rollback.sql";
const DEV_EVENTS_CHECK = "cc3ec9cd111c20b3754c4cc7973fa668";   // md5(pg_get_constraintdef) on DEV before the push (Oct 21)

(async () => {
  const { rec, done } = H.recorder();
  const { db } = await H.bootSchema(MIG);
  const storageSnap = async () => (await db.query(`
    SELECT 'bucket:'||id||':'||public::text||':'||coalesce(file_size_limit::text,'')||':'||coalesce(allowed_mime_types::text,'') x FROM storage.buckets
    UNION ALL SELECT 'pol:'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'') FROM pg_policies WHERE schemaname='storage' ORDER BY 1`)).rows.map((r) => r.x);
  const snap = async () => [...await H.snap(db), ...await storageSnap()];
  const evMd5 = async () => (await db.query(`SELECT md5(pg_get_constraintdef(oid)) h FROM pg_constraint WHERE conname='events_event_type_check'`)).rows[0].h;
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "-" + x), ...b.filter((x) => !a.includes(x)).map((x) => "+" + x)];
  const s0 = await snap(), m0 = await evMd5();
  await H.applyFiles(db, [MIG]); const s1 = await snap();

  // a file row blocks the rollback (nothing changes)
  const A = H.A, OX = H.OX;
  await db.query(`INSERT INTO agency (id, agency_name) VALUES ($1,'A') ON CONFLICT DO NOTHING`, [A]);
  await db.query(`INSERT INTO virtual_office (id, agency_id, name) VALUES ($1,$2,'X') ON CONFLICT DO NOTHING`, [OX, A]);
  await db.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('cp-attachments', $1)`, [`${A}/${OX}/x`]);
  let blocked = null; try { await H.applyRollback(db, RB); } catch (e) { blocked = e.message; }
  const sB = await snap();
  await db.query(`DELETE FROM storage.objects WHERE bucket_id = 'cp-attachments'`);
  rec("RB0 while the bucket holds an object the rollback stops with the reason and changes nothing",
    /still holds objects/.test(blocked || "") && diff(s1, sB).length === 0, `${(blocked || "NOT BLOCKED").slice(0, 70)}; diff ${diff(s1, sB).length}`);

  await H.applyRollback(db, RB);
  const s2 = await snap(), m2 = await evMd5();
  const d = diff(s0, s2);
  rec("RB1 after the rollback the catalog equals the one before the migration (public schema, bucket, storage policies, grants)",
    d.length === 0, d.length ? d.map((x) => x.slice(0, 70)).join(" ; ") : "identical");
  rec("RB2 the restored events CHECK is byte-identical to DEV's before the push (md5)", m2 === DEV_EVENTS_CHECK && m0 === DEV_EVENTS_CHECK,
    `restored ${m2}; before ${m0}; DEV ${DEV_EVENTS_CHECK}`);
  await H.applyFiles(db, [MIG]); const s3 = await snap();
  rec("RB3 re-applying after the rollback equals the first apply", diff(s1, s3).length === 0, `diff ${diff(s1, s3).slice(0, 2).join(" ; ") || "none"}`);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

// S4b — cp-attachments: signed URLs for the private 'cp-attachments' bucket (docs/design/s4b-file-attachments.md).
// Every permission check is in the database, called with the CALLER's JWT (begin_attachment_upload,
// complete_attachment_upload, open_attachment). The service role is used only after that check succeeded, for what
// an API role can't do: issue a signed upload URL for the server-generated path, read the stored object back to check
// its size and file signature, and sign a 60-second download URL. Signed URLs are returned to the caller only; never
// logged. Logs carry no names, paths or URLs.
//
// Actions (POST JSON):
//   begin    {parent_kind, parent_id, display_name, description?, mime_type, size_bytes} -> {id, path, token}
//   complete {id}  -> {id}   (object size + signature checked; a failed check discards the upload)
//   open     {id, download?: boolean} -> {url}   (60 s; download sets Content-Disposition with the display name)
//   cleanup  {}    -> {discarded}   (service-role bearer only: pending uploads older than 24 h)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const BUCKET = "cp-attachments";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const EXT: Record<string, string> = {
  "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

/** The stored bytes start like the declared type (a renamed .exe is not a PDF). */
export function signatureMatches(mime: string, b: Uint8Array): boolean {
  const starts = (sig: number[]) => sig.every((x, i) => b[i] === x);
  switch (mime) {
    case "application/pdf": return starts([0x25, 0x50, 0x44, 0x46, 0x2d]);                      // %PDF-
    case "image/jpeg": return starts([0xff, 0xd8, 0xff]);
    case "image/png": return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      if (!starts([0x50, 0x4b, 0x03, 0x04])) return false;                                      // zip
      const text = new TextDecoder("latin1").decode(b);
      return text.includes("[Content_Types].xml") && text.includes("word/");
    }
    default: return false;
  }
}
const jwtRole = (t: string): string | null => {
  try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? null; } catch { return null; }
};
const dbError = (e: { code?: string; message?: string }) =>
  json({ error: e.code === "42501" ? "Not found or not allowed" : (e.message ?? "Request failed"), code: e.code }, e.code === "42501" ? 403 : 400);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "", anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "No authorization header" }, 401);
  const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = String(body.action ?? "");

  try {
    if (action === "cleanup") {
      // the gateway verified the JWT's signature (verify_jwt); only a service-role token may run the cleanup
      if (authHeader.slice(7) !== serviceKey && jwtRole(authHeader.slice(7)) !== "service_role") return json({ error: "Not allowed" }, 403);
      const { data, error } = await service.rpc("cp_attachment_stale_pending", { _hours: 24 });
      if (error) return dbError(error);
      let discarded = 0;
      for (const r of (data ?? []) as { id: string; object_path: string }[]) {
        await service.storage.from(BUCKET).remove([r.object_path]);   // no object when the upload never happened
        const { data: p } = await service.rpc("cp_attachment_discard", { _id: r.id });
        if (p) discarded++;
      }
      console.log(`cleanup: discarded ${discarded}`);
      return json({ discarded });
    }

    const user = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user: caller }, error: authError } = await user.auth.getUser(authHeader.slice(7));
    if (authError || !caller) return json({ error: "Unauthorized" }, 401);

    if (action === "begin") {
      const { data, error } = await user.rpc("begin_attachment_upload", {
        _parent_kind: body.parent_kind, _parent_id: body.parent_id, _display_name: body.display_name,
        _description: body.description ?? null, _mime_type: body.mime_type, _size_bytes: body.size_bytes });
      if (error) return dbError(error);
      const { id, object_path } = data as { id: string; object_path: string };
      const { data: signed, error: sErr } = await service.storage.from(BUCKET).createSignedUploadUrl(object_path);
      if (sErr || !signed) { await service.rpc("cp_attachment_discard", { _id: id }); return json({ error: "The upload couldn't be started" }, 500); }
      return json({ id, path: signed.path, token: signed.token });
    }

    if (action === "complete") {
      const id = String(body.id ?? "");
      // the caller's own pending row (read with the service role; complete_attachment_upload re-checks everything)
      const { data: row } = await service.from("cp_attachments").select("id, object_path, mime_type, size_bytes, uploaded_by, completed_at")
        .eq("id", id).maybeSingle();
      if (!row || row.uploaded_by !== caller.id || row.completed_at) return json({ error: "Not found or not allowed" }, 403);
      const { data: blob, error: dErr } = await service.storage.from(BUCKET).download(row.object_path);
      if (dErr || !blob) return json({ error: "The file didn't arrive; try the upload again" }, 400);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength !== row.size_bytes || !signatureMatches(row.mime_type, bytes)) {
        await service.storage.from(BUCKET).remove([row.object_path]);
        await service.rpc("cp_attachment_discard", { _id: row.id });
        return json({ error: bytes.byteLength !== row.size_bytes ? "The file size doesn't match; try the upload again" : "The file's contents don't match its type" }, 400);
      }
      const { data: ok, error: cErr } = await service.rpc("cp_attachment_mark_checked", { _id: row.id, _size: bytes.byteLength });
      if (cErr || !ok) return json({ error: "The file couldn't be checked" }, 400);
      const { error } = await user.rpc("complete_attachment_upload", { _id: row.id });
      if (error) return dbError(error);
      return json({ id: row.id });
    }

    if (action === "open") {
      const { data, error } = await user.rpc("open_attachment", { _id: body.id });
      if (error) return dbError(error);
      const a = data as { object_path: string; display_name: string; mime_type: string };
      const name = a.display_name.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim() || "file";
      const fileName = name.toLowerCase().endsWith(EXT[a.mime_type] ?? "") ? name : name + (EXT[a.mime_type] ?? "");
      const { data: signed, error: sErr } = await service.storage.from(BUCKET)
        .createSignedUrl(a.object_path, 60, body.download ? { download: fileName } : undefined);
      if (sErr || !signed) return json({ error: "The file couldn't be opened" }, 500);
      return json({ url: signed.signedUrl, mime_type: a.mime_type });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("cp-attachments error:", action, (e as Error).name);
    return json({ error: "Request failed" }, 500);
  }
});

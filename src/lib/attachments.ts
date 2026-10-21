import { supabase } from "@/integrations/supabase/client";

/** S4b attachments: what the browser checks before a file goes to the cp-attachments Edge Function. */
export type AttachmentKind = "client_document" | "inservice_form" | "training_form" | "credential" | "care_plan";
export interface Attachment {
  id: string; parent_id: string; display_name: string; description: string | null; mime_type: string; size_bytes: number;
  uploaded_at: string; uploaded_by: string; uploaded_by_me: boolean; by_caregiver: boolean; waiting_for_hr: boolean; can_remove: boolean;
}

export const MAX_BYTES = 20 * 1024 * 1024;           // owner answer 1
export const IMAGE_TARGET_BYTES = 3 * 1024 * 1024;   // photos are compressed to about 2-3 MB
const MAX_EDGE = 2400;
export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", DOCX];
export const ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.docx,application/pdf,image/jpeg,image/png,image/heic,image/heif," + DOCX;
export const TYPE_LABEL: Record<string, string> = { "application/pdf": "PDF", "image/jpeg": "JPEG", "image/png": "PNG", [DOCX]: "Word" };
export const canPreview = (mime: string) => mime === "application/pdf" || mime.startsWith("image/");

export class AttachmentError extends Error {}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
const ext = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
export const isHeic = (f: File) => /^image\/hei[cf]$/i.test(f.type) || ["heic", "heif"].includes(ext(f.name));
/** The name shown in the list: the file name without its extension (paths never carry it). */
export const defaultName = (f: File) => (f.name.replace(/\.[a-z0-9]+$/i, "").trim() || "File").slice(0, 120);

/** The declared type: from the browser, or the extension when the browser leaves it empty (Windows .docx). */
export function mimeOf(f: File): string {
  if (ACCEPTED.includes(f.type)) return f.type;
  const e = ext(f.name);
  return e === "pdf" ? "application/pdf" : e === "jpg" || e === "jpeg" ? "image/jpeg" : e === "png" ? "image/png" : e === "docx" ? DOCX : f.type || "";
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode(); return img;
  } finally { URL.revokeObjectURL(url); }
}
/** Re-encodes a photo as JPEG, longest side at most 2400 px, lowering the quality until it is about 3 MB or less. */
export async function compressImage(blob: Blob): Promise<Blob> {
  const img = await loadImage(blob);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d"); if (!ctx) throw new AttachmentError("This photo couldn't be prepared on this device");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let out: Blob | null = null;
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (out && out.size <= IMAGE_TARGET_BYTES) break;
  }
  if (!out) throw new AttachmentError("This photo couldn't be prepared on this device");
  return out;
}

/**
 * Checks and prepares one file: HEIC is converted to JPEG on the device (owner answer 4), photos are compressed,
 * anything else must be an accepted type of at most 20 MB.
 */
export async function prepareFile(f: File): Promise<{ blob: Blob; mime: string }> {
  if (isHeic(f)) {
    let jpeg: Blob;
    try {
      const { default: heic2any } = await import("heic2any");
      const r = await heic2any({ blob: f, toType: "image/jpeg", quality: 0.85 });
      jpeg = Array.isArray(r) ? r[0] : r;
    } catch {
      throw new AttachmentError("This HEIC photo couldn't be converted on this device. Take it as JPEG (iPhone: Settings › Camera › Formats › Most Compatible) or upload a PDF.");
    }
    return { blob: jpeg.size > IMAGE_TARGET_BYTES ? await compressImage(jpeg) : jpeg, mime: "image/jpeg" };
  }
  const mime = mimeOf(f);
  if (!ACCEPTED.includes(mime)) throw new AttachmentError("This file type isn't accepted (PDF, JPEG, PNG, HEIC photo or Word .docx)");
  if (mime.startsWith("image/") && f.size > IMAGE_TARGET_BYTES) {
    try { return { blob: await compressImage(f), mime: "image/jpeg" }; } catch (e) { if (f.size > MAX_BYTES) throw e; }
  }
  if (f.size > MAX_BYTES) throw new AttachmentError(`This file is ${formatBytes(f.size)}; a file can be at most 20 MB`);
  if (f.size === 0) throw new AttachmentError("This file is empty");
  return { blob: f, mime };
}

async function callFn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("cp-attachments", { body });
  if (error) {
    let msg = "The request failed; try again";
    const ctx = (error as { context?: Response }).context;
    try { const j = ctx ? await ctx.json() : null; if (j?.error) msg = j.error; } catch { /* keep the generic text */ }
    throw new AttachmentError(msg);
  }
  return data as T;
}

/** PUT to the signed upload URL with progress (the token authorizes exactly this one path). */
function putSigned(path: string, token: string, blob: Blob, mime: string, onProgress?: (pct: number) => void): Promise<void> {
  const base = import.meta.env.VITE_SUPABASE_URL as string, key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const url = `${base}/storage/v1/object/upload/sign/cp-attachments/${path}?token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("apikey", key); xhr.setRequestHeader("content-type", mime); xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new AttachmentError("The upload was refused; try again")));
    xhr.onerror = () => reject(new AttachmentError("The upload failed; check the connection and try again"));
    xhr.send(blob);
  });
}

export type UploadStage = "preparing" | "uploading" | "checking" | "done";
export async function uploadAttachment(kind: AttachmentKind, parentId: string, file: File, onStage: (s: UploadStage, pct?: number) => void,
  displayName = defaultName(file), description: string | null = null): Promise<string> {
  onStage("preparing");
  const { blob, mime } = await prepareFile(file);
  const begun = await callFn<{ id: string; path: string; token: string }>({ action: "begin", parent_kind: kind, parent_id: parentId,
    display_name: displayName, description, mime_type: mime, size_bytes: blob.size });
  onStage("uploading", 0);
  await putSigned(begun.path, begun.token, blob, mime, (p) => onStage("uploading", p));
  onStage("checking");
  await callFn<{ id: string }>({ action: "complete", id: begun.id });
  onStage("done");
  return begun.id;
}

/** A 60-second signed URL (audited as a view). Kept in memory only: never stored or put in the app's URL. */
export const openAttachmentUrl = (id: string, download = false) => callFn<{ url: string; mime_type: string }>({ action: "open", id, download });

export async function listAttachments(kind: AttachmentKind, parentIds: string[]): Promise<Attachment[]> {
  if (!parentIds.length) return [];
  const { data, error } = await supabase.rpc("list_attachments", { _parent_kind: kind, _parent_ids: parentIds });
  if (error) throw error;
  return (data ?? []) as unknown as Attachment[];
}

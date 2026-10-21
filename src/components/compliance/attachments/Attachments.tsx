import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, Eye, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACCEPT_ATTR, AttachmentError, canPreview, formatBytes, listAttachments, openAttachmentUrl, TYPE_LABEL, uploadAttachment,
  type Attachment, type AttachmentKind, type UploadStage } from "@/lib/attachments";
import { rpcErrorText } from "@/lib/rpcError";

/**
 * S4b attachments UI. Files live in the private cp-attachments bucket; this component only ever holds attachment ids
 * and, for a moment, a 60-second signed URL in memory (never in the route, storage or logs). Status, effective and
 * expiry dates stay on the parent (one per version), never per file.
 */
const KEY = "attachments";
const useInvalidate = () => {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: [KEY] }), qc.invalidateQueries({ queryKey: ["attachment-counts"] })]);
};

/** Count (and caregiver uploads waiting for HR) per parent, for buttons in a table. */
export function useAttachmentCounts(kind: AttachmentKind, ids: string[]) {
  const sorted = [...ids].sort();
  return useQuery({
    queryKey: ["attachment-counts", kind, sorted.join(",")],
    enabled: sorted.length > 0,
    queryFn: async () => {
      const m = new Map<string, { count: number; waiting: number }>();
      for (const a of await listAttachments(kind, sorted)) {
        const c = m.get(a.parent_id) ?? { count: 0, waiting: 0 };
        c.count++; if (a.waiting_for_hr) c.waiting++; m.set(a.parent_id, c);
      }
      return m;
    },
  });
}

/** "Files (n)" button that opens the files of one parent (plus earlier versions, read-only). */
export function AttachmentsButton({ kind, parentId, title, count = 0, waiting = 0, readOnly = false, history = [] }: {
  kind: AttachmentKind; parentId: string; title: string; count?: number; waiting?: number; readOnly?: boolean; history?: { label: string; parentId: string }[];
}) {
  const [open, setOpen] = useState(false);
  if (readOnly && count === 0 && history.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <>
      <Button size="sm" variant="ghost" className="gap-1 px-2" onClick={() => setOpen(true)} data-testid="files-button" aria-label={`Files of ${title}`}>
        <Paperclip className="h-4 w-4" />{count ? `Files (${count})` : readOnly ? "Files" : "Add files"}
        {waiting > 0 && <Badge variant="outline" className="ml-1 border-warning/50 bg-warning/15 text-foreground" data-testid="waiting-badge">New upload</Badge>}
      </Button>
      {open && <AttachmentsDialog kind={kind} parentId={parentId} title={title} readOnly={readOnly} history={history} onClose={() => setOpen(false)} />}
    </>
  );
}

export function AttachmentsDialog({ kind, parentId, title, readOnly, history, onClose }: {
  kind: AttachmentKind; parentId: string; title: string; readOnly: boolean; history: { label: string; parentId: string }[]; onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader><DialogTitle>Files · {title}</DialogTitle>
          <DialogDescription>PDF, JPEG, PNG, HEIC photo (converted to JPEG on this device) or Word .docx, up to 20 MB each. Photos are compressed before upload.</DialogDescription></DialogHeader>
        <AttachmentsBlock kind={kind} parentId={parentId} readOnly={readOnly} />
        {history.map((h) => (
          <div key={h.parentId} className="space-y-1 border-t pt-3">
            <p className="text-sm font-medium text-muted-foreground">{h.label} (read-only)</p>
            <AttachmentsBlock kind={kind} parentId={h.parentId} readOnly emptyText="No files." />
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}

interface Pending { key: string; name: string; stage: UploadStage | "error"; pct: number; error?: string }
const STAGE_LABEL: Record<string, string> = { preparing: "Preparing…", uploading: "Uploading", checking: "Checking…", done: "Added" };

export function AttachmentsBlock({ kind, parentId, readOnly = false, emptyText = "No files yet." }: { kind: AttachmentKind; parentId: string; readOnly?: boolean; emptyText?: string }) {
  const invalidate = useInvalidate();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [preview, setPreview] = useState<{ a: Attachment; url: string } | null>(null);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const { data: files = [], isLoading, error } = useQuery({ queryKey: [KEY, kind, parentId], queryFn: () => listAttachments(kind, [parentId]) });

  const onPick = async (list: FileList | null) => {
    const picked = Array.from(list ?? []); if (input.current) input.current.value = "";
    if (!picked.length) return;
    const items = picked.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, stage: "preparing" as UploadStage | "error", pct: 0 }));
    setPending((p) => [...p, ...items]);
    const set = (key: string, patch: Partial<Pending>) => setPending((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    for (const [i, f] of picked.entries()) {
      const key = items[i].key;
      try {
        await uploadAttachment(kind, parentId, f, (stage, pct) => set(key, { stage, pct: pct ?? (stage === "done" ? 100 : 0) }));
        await invalidate();
        setPending((p) => p.filter((x) => x.key !== key));
      } catch (e) {
        set(key, { stage: "error", error: e instanceof AttachmentError ? e.message : "The upload failed; try again" });
      }
    }
  };
  const open = async (a: Attachment, download: boolean) => {
    try {
      const { url } = await openAttachmentUrl(a.id, download);
      if (download) { const l = document.createElement("a"); l.href = url; l.rel = "noopener"; document.body.appendChild(l); l.click(); l.remove(); }
      else setPreview({ a, url });
    } catch (e) { toast.error(e instanceof AttachmentError ? e.message : "The file couldn't be opened"); }
  };

  return (
    <div className="space-y-2" data-testid="attachments-block" data-kind={kind}>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading files…</p>
        : error ? <p className="text-sm text-destructive">{rpcErrorText(error as { code?: string; message?: string })}</p>
        : files.length === 0 ? <p className="text-sm text-muted-foreground">{emptyText}</p> : (
        <ul className="divide-y rounded-md border">
          {files.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-2" data-testid="attachment-row" data-name={a.display_name}>
              <div className="flex min-w-0 items-start gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="break-words font-medium">{a.display_name}
                    {a.waiting_for_hr && <Badge variant="outline" className="ml-2 border-warning/50 bg-warning/15 text-foreground">Waiting for HR</Badge>}</div>
                  {a.description && <div className="text-xs text-muted-foreground">{a.description}</div>}
                  <div className="text-xs text-muted-foreground">{TYPE_LABEL[a.mime_type] ?? a.mime_type} · {formatBytes(a.size_bytes)} · {a.uploaded_by} · {format(new Date(a.uploaded_at), "MMM d, yyyy h:mm a")}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {canPreview(a.mime_type) && <Button size="sm" variant="ghost" className="gap-1 px-2" onClick={() => open(a, false)} data-testid="attachment-preview"><Eye className="h-4 w-4" />Preview</Button>}
                <Button size="sm" variant="ghost" className="gap-1 px-2" onClick={() => open(a, true)} data-testid="attachment-download"><Download className="h-4 w-4" />Download</Button>
                {!readOnly && a.can_remove && <Button size="icon" variant="ghost" aria-label={`Remove ${a.display_name}`} onClick={() => setRemoving(a)} data-testid="attachment-remove"><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {pending.length > 0 && (
        <ul className="space-y-2" data-testid="upload-queue">
          {pending.map((p) => (
            <li key={p.key} className="rounded-md border p-2 text-sm" data-stage={p.stage}>
              <div className="flex items-center justify-between gap-2"><span className="min-w-0 break-words">{p.name}</span>
                {p.stage === "error" ? <Button size="sm" variant="ghost" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>Dismiss</Button>
                  : <span className="whitespace-nowrap text-xs text-muted-foreground">{STAGE_LABEL[p.stage]}{p.stage === "uploading" ? ` ${p.pct}%` : ""}</span>}</div>
              {p.stage === "error" ? <p className="mt-1 text-destructive" role="alert" data-testid="upload-error">{p.error}</p>
                : <Progress value={p.stage === "uploading" ? p.pct : p.stage === "preparing" ? 5 : 95} className="mt-2 h-1.5" />}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div>
          <input ref={input} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" id={`att-${kind}-${parentId}`} data-testid="attachment-input" onChange={(e) => onPick(e.target.files)} />
          <Button size="sm" variant="outline" className="gap-1 hover:bg-muted hover:text-foreground" onClick={() => input.current?.click()}><Upload className="h-4 w-4" />Add files</Button>
        </div>
      )}
      {preview && (
        <Dialog open onOpenChange={(o) => !o && setPreview(null)}>
          <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[900px]">
            <DialogHeader><DialogTitle className="break-words pr-6">{preview.a.display_name}</DialogTitle></DialogHeader>
            {preview.a.mime_type === "application/pdf"
              ? <iframe src={preview.url} title={preview.a.display_name} className="h-[70vh] w-full rounded border" referrerPolicy="no-referrer" data-testid="preview-frame" />
              : <img src={preview.url} alt={preview.a.display_name} className="max-h-[70vh] w-full object-contain" referrerPolicy="no-referrer" data-testid="preview-image" />}
          </DialogContent>
        </Dialog>
      )}
      {removing && <RemoveDialog a={removing} onClose={() => setRemoving(null)} onRemoved={invalidate} />}
    </div>
  );
}

function RemoveDialog({ a, onClose, onRemoved }: { a: Attachment; onClose: () => void; onRemoved: () => void }) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("remove_attachment", { _id: a.id, _reason: reason.trim() });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success("File removed"); onRemoved(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[440px]">
        <DialogHeader><DialogTitle>Remove {a.display_name}?</DialogTitle>
          <DialogDescription>The file is hidden from this list. It is kept for the records (retention) and the removal is logged.</DialogDescription></DialogHeader>
        <div className="space-y-1"><Label htmlFor="rm-reason">Reason *</Label><Textarea id="rm-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong file, duplicate" /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" onClick={save} disabled={busy || !reason.trim()}>Remove</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

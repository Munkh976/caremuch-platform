import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowRight, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { parseDateOnly } from "@/lib/dateOnly";
import { humanize } from "@/lib/formTemplates";
import { CLIENT_FORMS, DOC_LABEL, ONBOARDING_LABEL, onboardedCount, onboardingDetail, SINGLE_DOCS, type CarePlanTab, type DocStatus, type Onboarding } from "@/lib/carePlan";
import { rpcErrorText } from "@/lib/rpcError";
import { AttachmentsButton, useAttachmentCounts } from "@/components/compliance/attachments/Attachments";
import { useDocumentHistory, useDocuments, type DocumentRow } from "./useCarePlanData";

const PILL: Record<string, string> = {
  complete: "border-success/40 bg-success/10 text-foreground", not_applicable: "text-muted-foreground",
  expired: "border-destructive/40 bg-destructive/10 text-destructive", missing: "border-warning/40 bg-warning/15 text-foreground", pending: "border-warning/40 bg-warning/15 text-foreground",
};
export function StatusPill({ status }: { status: string }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap", PILL[status])} data-status={status}>{status === "not_applicable" ? "N/A" : humanize(status)}</Badge>;
}
const fmt = (s: string | null) => (s ? format(parseDateOnly(s), "MMM d, yyyy") : "—");

/**
 * Onboarding & Documents (S4): the 8 server items with deep links; intake documents with status and dates per version.
 * S4b: files per document version (earlier versions read-only) and "Add other document" (a custom-named document,
 * doc_type other_<hex>; not one of the 8 onboarding items).
 */
export function OnboardingTab({ clientId, onboarding, trainingVersion, goTo, onChanged }: {
  clientId: string; onboarding: Onboarding | undefined; trainingVersion: number | null; goTo: (tab: CarePlanTab, anchor?: string) => void; onChanged: () => void;
}) {
  const { data: docs = [] } = useDocuments(clientId);
  const [editing, setEditing] = useState<string | null>(null);
  const byType = new Map(docs.map((d) => [d.doc_type, d]));
  const others = docs.filter((d) => d.doc_type.startsWith("other_")).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const { data: history = [] } = useDocumentHistory(clientId);
  const { data: files } = useAttachmentCounts("client_document", docs.map((d) => d.id));
  const label = (t: string) => DOC_LABEL[t] ?? byType.get(t)?.display_name ?? "Other document";
  const filesCell = (t: string, d: DocumentRow | undefined) => {
    const earlier = history.filter((h) => h.doc_type === t).map((h) => ({ label: `Version ${h.version}`, parentId: h.id }));
    return d ? <AttachmentsButton kind="client_document" parentId={d.id} title={`${label(t)} v${d.version}`} count={files?.get(d.id)?.count} history={earlier} />
      : <span className="text-xs text-muted-foreground" title="Save the document's status first">—</span>;
  };
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <Card data-testid="onboarding">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Onboarding {onboarding ? (onboarding.onboarded ? "· onboarded" : `· ${onboardedCount(onboarding)} of 8`) : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(onboarding?.items ?? []).map((it) => {
              const meta = ONBOARDING_LABEL[it.key] ?? { label: humanize(it.key), tab: "onboarding" as CarePlanTab };
              const detail = onboardingDetail(it, trainingVersion);
              return (
                <li key={it.key} className="flex flex-wrap items-center justify-between gap-2 py-2" data-item={it.key} data-status={it.status}>
                  <div className="min-w-0">
                    <div className="font-medium">{meta.label}</div>
                    {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={it.status} />
                    <Button size="sm" variant="ghost" className="gap-1" onClick={() => goTo(meta.tab, meta.anchor)} aria-label={`Go to ${meta.label}`}><ArrowRight className="h-4 w-4" /></Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Intake documents</CardTitle>
          <p className="text-xs text-muted-foreground">Status and dates per version; files are attached to the version (a new version starts without files, earlier versions keep theirs).</p></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border" data-testid="documents">
            <Table>
              <TableHeader><TableRow><TableHead>Document</TableHead><TableHead>Status</TableHead><TableHead>Effective</TableHead><TableHead>Expires</TableHead><TableHead>Note</TableHead><TableHead>Files</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {[...SINGLE_DOCS, ...CLIENT_FORMS].map((t, i) => {
                  const d = byType.get(t);
                  return (
                    <TableRow key={t} id={t === CLIENT_FORMS[0] ? "client-forms" : `doc-${t}`} data-doc={t} className={i === SINGLE_DOCS.length ? "border-t-2" : ""}>
                      <TableCell className="whitespace-nowrap font-medium">{DOC_LABEL[t]}{d ? <span className="ml-1 text-xs text-muted-foreground">v{d.version}</span> : null}</TableCell>
                      <TableCell><StatusPill status={d?.status ?? "missing"} /></TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{fmt(d?.effective_date ?? null)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{fmt(d?.expiration_date ?? null)}</TableCell>
                      <TableCell className="max-w-[260px] text-xs text-muted-foreground">{d?.not_applicable_reason ?? "—"}</TableCell>
                      <TableCell>{filesCell(t, d)}</TableCell>
                      <TableCell className="text-right"><Button size="icon" variant="ghost" aria-label={`Update ${DOC_LABEL[t]}`} onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  );
                })}
                {others.map((d, i) => (
                  <TableRow key={d.doc_type} data-doc={d.doc_type} data-other-doc={d.display_name ?? ""} className={i === 0 ? "border-t-2" : ""}>
                    <TableCell className="font-medium">{label(d.doc_type)}<span className="ml-1 text-xs text-muted-foreground">v{d.version}</span></TableCell>
                    <TableCell><StatusPill status={d.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{fmt(d.effective_date)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{fmt(d.expiration_date)}</TableCell>
                    <TableCell className="max-w-[260px] text-xs text-muted-foreground">{d.not_applicable_reason ?? "—"}</TableCell>
                    <TableCell>{filesCell(d.doc_type, d)}</TableCell>
                    <TableCell className="text-right"><Button size="icon" variant="ghost" aria-label={`Update ${label(d.doc_type)}`} onClick={() => setEditing(d.doc_type)}><Pencil className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button size="sm" variant="outline" className="mt-3 gap-1 hover:bg-muted hover:text-foreground" onClick={() => setEditing("new_other")} data-testid="add-other-document"><Plus className="h-4 w-4" />Add other document</Button>
        </CardContent>
      </Card>
      {editing && <DocDialog clientId={clientId} docType={editing === "new_other" ? null : editing} current={editing === "new_other" ? null : byType.get(editing) ?? null}
        label={editing === "new_other" ? "Other document" : label(editing)} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </div>
  );
}

/** One intake document's new version. docType null = a new "other" document; other_* types also carry a name. */
function DocDialog({ clientId, docType, current, label, onClose, onSaved }: { clientId: string; docType: string | null; current: DocumentRow | null; label: string; onClose: () => void; onSaved: () => void }) {
  const isOther = docType === null || docType.startsWith("other_");
  const [name, setName] = useState(current?.display_name ?? "");
  const [status, setStatus] = useState<DocStatus>((current?.status as DocStatus) && current?.status !== "missing" ? (current?.status as DocStatus) : "complete");
  const [eff, setEff] = useState(current?.effective_date ?? ""); const [exp, setExp] = useState(current?.expiration_date ?? "");
  const [reason, setReason] = useState(current?.not_applicable_reason ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (status !== "not_applicable") setReason(""); }, [status]);
  const save = async () => {
    if (status === "not_applicable" && !reason.trim()) { toast.error("Say why this document doesn't apply"); return; }
    if (eff && exp && exp < eff) { toast.error("The expiration date is before the effective date"); return; }
    if (isOther && !name.trim()) { toast.error("Give the document a name"); return; }
    setBusy(true);
    const common = { _client_id: clientId, _status: status, _not_applicable_reason: status === "not_applicable" ? reason.trim() : undefined,
      _effective_date: eff || undefined, _expiration_date: exp || undefined };
    const { error } = isOther
      ? await supabase.rpc("save_other_client_document", { ...common, _doc_type: docType, _display_name: name.trim() })
      : await supabase.rpc("upsert_client_document", { ...common, _doc_type: docType as string });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(`${isOther ? name.trim() : label} saved${docType === null ? "; add its files from the Files column" : ""}`); onSaved(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[480px]">
        <DialogHeader><DialogTitle>{docType === null ? "Add other document" : label}</DialogTitle><DialogDescription>{docType === null
          ? "A document that isn't one of the standard intake documents (for example a guardianship letter). It doesn't count toward onboarding."
          : "Saving records a new version of this document's status; earlier versions are kept."}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {isOther && <div className="space-y-1"><Label htmlFor="doc-name">Document name *</Label><Input id="doc-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>}
          <div className="space-y-1"><Label htmlFor="doc-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as DocStatus)}><SelectTrigger id="doc-status"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="complete">Complete</SelectItem><SelectItem value="expired">Expired</SelectItem><SelectItem value="not_applicable">Not applicable</SelectItem></SelectContent></Select></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="doc-eff">Effective</Label><Input id="doc-eff" type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="doc-exp">Expires</Label><Input id="doc-exp" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></div>
          </div>
          {status === "not_applicable" && <div className="space-y-1"><Label htmlFor="doc-reason">Why it doesn't apply *</Label><Textarea id="doc-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

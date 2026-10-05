import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useVersionFields } from "./useVersionFields";
import { rpcErrorText } from "@/lib/rpcError";
import { diffFields, fieldKeyFor, isLockedField, STORAGE_LABEL, type FieldChange, type NoteLayout, type Shell, type TemplateField } from "@/lib/formTemplates";
import type { Json } from "@/integrations/supabase/types";

const NEW_TYPES: { value: string; label: string; storage: "field_value" | "static_text" }[] = [
  { value: "text", label: "Short text", storage: "field_value" },
  { value: "longtext", label: "Long text", storage: "field_value" },
  { value: "number", label: "Number", storage: "field_value" },
  { value: "date", label: "Date", storage: "field_value" },
  { value: "select", label: "Choice (select)", storage: "field_value" },
  { value: "checkbox", label: "Checkbox", storage: "field_value" },
  { value: "static", label: "Static text (help)", storage: "static_text" },
];

function useVersionMeta(versionId: string | null) {
  return useQuery({
    queryKey: ["template-version-meta", versionId],
    enabled: !!versionId,
    queryFn: async () => {
      const { data, error } = await supabase.from("form_template_versions").select("sections, note_layout").eq("id", versionId as string).single();
      if (error) throw error;
      return { sections: (data.sections ?? []) as Json, noteLayout: (data.note_layout ?? null) as NoteLayout | null };
    },
  });
}

/**
 * Constrained editor (Q13). Spine and child-row fields are locked (they write to fixed columns and
 * child tables, so every record keeps its meaning); they can only be moved. Field-value and static-text
 * fields: label, required, options, shown on progress note, add/remove. Progress-note shells: billing
 * footer and notes prompt. Save draft (server-side, Q14) -> diff vs the current version -> Publish.
 */
export function ShellEditor({ shell, open, onOpenChange }: { shell: Shell; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const current = shell.versions.find((v) => v.is_current) ?? null;
  const draft = shell.versions.find((v) => v.status === "draft") ?? null;
  const base = draft ?? current;
  const { data: baseFields } = useVersionFields(base?.version_id ?? null);
  const { data: currentFields = [] } = useVersionFields(current?.version_id ?? null);
  const { data: baseMeta } = useVersionMeta(base?.version_id ?? null);
  const { data: currentMeta } = useVersionMeta(current?.version_id ?? null);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [layout, setLayout] = useState<NoteLayout | null>(null);
  const [step, setStep] = useState<"edit" | "review" | "done">("edit");
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState("text");
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [previousVersion, setPreviousVersion] = useState<number | null>(null);

  // Initialize once per opening: the shell prop refreshes after save/publish (the draft disappears on
  // publish), and that must not reset the dialog.
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!open) { setInitialized(false); return; }
    if (!initialized && baseFields && (!base || baseMeta)) {
      setFields(baseFields.map((f) => ({ ...f }))); setLayout(baseMeta?.noteLayout ?? null); setStep(draft ? "review" : "edit"); setInitialized(true);
    }
  }, [open, initialized, baseFields, baseMeta, base, draft]);

  const changes: FieldChange[] = useMemo(() => diffFields(currentFields, fields, currentMeta?.noteLayout, layout), [currentFields, fields, currentMeta, layout]);
  const nextVersion = draft?.version ?? (Math.max(0, ...shell.versions.map((v) => v.version)) + 1);
  const isNote = shell.kind === "progress_note";

  const update = (i: number, patch: Partial<TemplateField>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => setFields((fs) => { const a = [...fs]; const j = i + d; if (j < 0 || j >= a.length) return fs; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const addField = () => {
    const label = newLabel.trim(); if (!label) return;
    const t = NEW_TYPES.find((x) => x.value === newType)!;
    setFields((fs) => [...fs, { field_key: fieldKeyFor(label, fs.map((f) => f.field_key)), label, field_type: t.storage === "static_text" ? "text" : t.value,
      storage: t.storage, required: false, shown_on_progress_note: false, options: t.value === "select" ? ["Option 1"] : null }]);
    setNewLabel("");
  };

  const saveDraft = async () => {
    setBusy(true);
    const payload = fields.map((f, i) => ({ ...f, sort_order: i, options: f.options && f.options.length ? f.options : null }));
    const { error } = await supabase.rpc("save_template_draft", {
      _template_id: shell.template_id, _office_id: null, _kind: null, _name: null, _intake_doc_type: null, _is_required_for_client: null,
      _sections: (baseMeta?.sections ?? []) as Json, _note_layout: (isNote ? layout : null) as Json, _fields: payload as unknown as Json, _service_type: null,
    });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(`Draft v${nextVersion} saved`);
    await qc.invalidateQueries({ queryKey: ["template-list"] });
    setStep("review");
  };

  const publish = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("publish_template_version", { _template_id: shell.template_id });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    setPreviousVersion(current?.version ?? null);
    setPublishedVersion(nextVersion);
    await qc.invalidateQueries({ queryKey: ["template-list"] });
    setStep("done");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step === "review" ? `Review draft v${nextVersion}` : step === "done" ? `Published v${publishedVersion}` : `Edit ${shell.name}`}</DialogTitle>
          <DialogDescription>
            {step === "edit" && "Labels, help text, options, required and order can change. Spine and child-row fields are fixed."}
            {step === "review" && (current ? `Changes compared with the current version v${current.version}.` : "First version of this shell.")}
            {step === "done" && "Existing records stay on their version."}
          </DialogDescription>
        </DialogHeader>

        {step === "edit" && (
          <div className="space-y-3">
            {fields.map((f, i) => {
              const locked = isLockedField(f);
              return (
                <div key={f.field_key} className={`rounded-md border p-3 ${locked ? "bg-muted/40" : ""}`} data-locked={locked}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={locked ? "secondary" : "outline"} className="gap-1">{locked && <Lock className="h-3 w-3" aria-hidden="true" />}{STORAGE_LABEL[f.storage]}</Badge>
                    <span className="text-xs text-muted-foreground">{f.field_key} · {f.field_type}</span>
                    <div className="ml-auto flex gap-1">
                      <Button type="button" size="icon" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === fields.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                      {!locked && <Button type="button" size="icon" variant="ghost" aria-label="Remove field" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                  {locked ? (
                    <div className="mt-2 space-y-1">
                      <p className="font-medium">{f.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Locked: writes to {f.writes_to_entity}{f.writes_to_column ? `.${f.writes_to_column}` : " (child rows)"}. It stays fixed so every record filled
                        from earlier versions keeps its meaning. It can only be moved.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`label-${f.field_key}`}>{f.storage === "static_text" ? "Help / static text" : "Label"}</Label>
                        <Input id={`label-${f.field_key}`} value={f.label} maxLength={200} onChange={(e) => update(i, { label: e.target.value })} />
                      </div>
                      {f.field_type === "select" && (
                        <div className="space-y-1">
                          <Label htmlFor={`opt-${f.field_key}`}>Options (comma separated)</Label>
                          <Input id={`opt-${f.field_key}`} value={(f.options ?? []).join(", ")}
                            onChange={(e) => update(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                        </div>
                      )}
                      {f.storage === "field_value" && (
                        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                          <label className="flex items-center gap-2 text-sm"><Switch id={`req-${f.field_key}`} checked={!!f.required} onCheckedChange={(v) => update(i, { required: v })} aria-label={`Required: ${f.label}`} />Required</label>
                          {isNote && <label className="flex items-center gap-2 text-sm"><Switch checked={!!f.shown_on_progress_note} onCheckedChange={(v) => update(i, { shown_on_progress_note: v })} aria-label={`Shown on progress note: ${f.label}`} />Shown on progress note</label>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="flex flex-col gap-2 rounded-md border border-dashed p-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="new-field">New field</Label>
                <Input id="new-field" placeholder="Label" value={newLabel} maxLength={200} onChange={(e) => setNewLabel(e.target.value)} />
              </div>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="sm:w-[190px]" aria-label="Field type"><SelectValue /></SelectTrigger>
                <SelectContent>{NEW_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" className="gap-1" onClick={addField} disabled={!newLabel.trim()}><Plus className="h-4 w-4" />Add</Button>
            </div>

            {isNote && (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Progress-note layout</p>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={!!layout?.billing_footer?.enabled} onCheckedChange={(v) => setLayout((l) => ({ ...(l ?? {}), billing_footer: { ...(l?.billing_footer ?? {}), enabled: v } }))} />
                  Billing footer ("For billing only")
                </label>
                <div className="space-y-1">
                  <Label htmlFor="footer-fields">Billing footer fields (comma separated)</Label>
                  <Input id="footer-fields" value={(layout?.billing_footer?.fields ?? []).join(", ")}
                    onChange={(e) => setLayout((l) => ({ ...(l ?? {}), billing_footer: { ...(l?.billing_footer ?? {}), fields: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="notes-prompt">Notes prompt</Label>
                  <Input id="notes-prompt" value={layout?.notes_prompt ?? ""} maxLength={300}
                    onChange={(e) => setLayout((l) => ({ ...(l ?? {}), notes_prompt: e.target.value || null }))} />
                </div>
              </div>
            )}
          </div>
        )}

        {step === "review" && (
          <div className="space-y-2" data-testid="draft-diff">
            {changes.length === 0 ? <p className="text-sm text-muted-foreground">No differences from v{current?.version}.</p> : (
              <ul className="space-y-1 text-sm">
                {changes.map((c, i) => (
                  <li key={i} className="flex flex-wrap gap-2">
                    <Badge variant={c.type === "removed" ? "destructive" : "outline"}>{c.type}</Badge>
                    <span>
                      {c.type === "added" || c.type === "removed" ? `${c.label} (${c.key})` : c.type === "changed" ? `${c.label}: ${c.what.join(", ")}` : c.type === "reordered" ? "Field order" : c.what}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === "done" && (
          <p className="text-sm">
            v{publishedVersion} is now current.{" "}
            {previousVersion ? `Existing records stay on v${previousVersion}; upgrade them one client at a time from the client page.` : "No records used an earlier version."}
          </p>
        )}

        <DialogFooter className="gap-2">
          {step === "edit" && <Button onClick={saveDraft} disabled={busy}>Save draft v{nextVersion}</Button>}
          {step === "review" && (
            <>
              <Button variant="outline" onClick={() => setStep("edit")} disabled={busy}>Back to editing</Button>
              <Button onClick={publish} disabled={busy || !shell.can_edit}>Publish v{nextVersion}</Button>
            </>
          )}
          {step === "done" && <Button onClick={() => onOpenChange(false)}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

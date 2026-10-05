import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { humanize } from "@/lib/formTemplates";
import { validateRows, type PlanRow, type RowSection } from "@/lib/carePlan";
import { rpcErrorText } from "@/lib/rpcError";

/** Repeatable rows of one IPOS child-row structure (fixed columns per table). */
export function RowsFields({ section, rows, onChange }: { section: RowSection; rows: PlanRow[]; onChange: (rows: PlanRow[]) => void }) {
  const set = (i: number, k: string, v: PlanRow[string]) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-3" data-rows={section.entity}>
      {rows.map((r, i) => (
        <div key={(r.id as string) ?? `new-${i}`} className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2">
          {section.cols.map((c) => {
            const id = `${section.entity}-${i}-${c.key}`; const v = r[c.key];
            const label = <Label htmlFor={id} className="text-xs">{c.label}{c.required ? " *" : ""}</Label>;
            if (c.kind === "bool") return <div key={c.key} className="flex items-center gap-2"><Switch id={id} checked={v === true} onCheckedChange={(x) => set(i, c.key, x)} />{label}</div>;
            if (typeof c.kind === "object") return (
              <div key={c.key} className="space-y-1">{label}
                <Select value={(v as string) ?? undefined} onValueChange={(x) => set(i, c.key, x)}>
                  <SelectTrigger id={id}><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{c.kind.options.map((o) => <SelectItem key={o} value={o}>{humanize(o)}</SelectItem>)}</SelectContent>
                </Select>
              </div>);
            if (c.kind === "longtext") return <div key={c.key} className="space-y-1 sm:col-span-2">{label}<Textarea id={id} rows={2} value={(v as string) ?? ""} onChange={(e) => set(i, c.key, e.target.value)} /></div>;
            return <div key={c.key} className="space-y-1">{label}<Input id={id} type={c.kind === "date" ? "date" : "text"} value={(v as string) ?? ""} onChange={(e) => set(i, c.key, e.target.value)} /></div>;
          })}
          <div className="flex justify-end sm:col-span-2">
            <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" />Remove</Button>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => onChange([...rows, {}])}><Plus className="h-3 w-3" />Add {section.title.toLowerCase().replace(/ \(.*\)$/, "").replace(/s$/, "")}</Button>
    </div>
  );
}

/** Edit one child-row structure of the active plan (set_care_plan_rows: ids kept, left-out rows removed). */
export function RowsDialog({ open, onOpenChange, planId, section, rows, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; planId: string; section: RowSection; rows: PlanRow[]; onSaved: () => void;
}) {
  const [draft, setDraft] = useState<PlanRow[]>(rows);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setDraft(rows); }, [open, rows]);
  const save = async () => {
    const problem = validateRows(section, draft);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    const payload = draft.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => k === "id" || section.cols.some((c) => c.key === k) && v !== "" && v !== null && v !== undefined)));
    const { error } = await supabase.rpc("set_care_plan_rows", { _care_plan_id: planId, _entity: section.entity, _rows: payload });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(`${section.title} saved`); onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader><DialogTitle>{section.title}</DialogTitle><DialogDescription>These rows never change the plan's training version.</DialogDescription></DialogHeader>
        <RowsFields section={section} rows={draft} onChange={setDraft} />
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={busy}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

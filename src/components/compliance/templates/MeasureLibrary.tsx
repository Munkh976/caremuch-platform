import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rpcErrorText } from "@/lib/rpcError";
import { humanize } from "@/lib/formTemplates";
import type { Database } from "@/integrations/supabase/types";

type Kind = Database["public"]["Enums"]["measure_kind"];
const KINDS: Kind[] = ["yes_no_na", "prompt_level", "graded_steps", "tally", "trials", "short_answer", "narrative", "staff_note"];
interface MeasureType { id: string; agency_id: string | null; kind: Kind; label: string; default_options: string[] | null; is_active: boolean; uses: number }

/** The 8 system measure types (read-only) plus the agency's own (W1: create / edit / deactivate / delete while unused). */
export function MeasureLibrary() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MeasureType | "new" | null>(null);
  const { data: types = [], isLoading } = useQuery({
    queryKey: ["measure-types"],
    queryFn: async (): Promise<MeasureType[]> => {
      const [mt, om] = await Promise.all([
        supabase.from("measure_types").select("id, agency_id, kind, label, default_options, is_active").order("agency_id", { nullsFirst: true }).order("label"),
        supabase.from("objective_measures").select("measure_type_id"),
      ]);
      if (mt.error) throw mt.error;
      const uses = new Map<string, number>();
      for (const r of om.data ?? []) uses.set(r.measure_type_id, (uses.get(r.measure_type_id) ?? 0) + 1);
      return (mt.data ?? []).map((t) => ({ ...t, default_options: Array.isArray(t.default_options) ? (t.default_options as string[]) : null, uses: uses.get(t.id) ?? 0 }));
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["measure-types"] });
  const setActive = async (t: MeasureType, v: boolean) => {
    const { error } = await supabase.rpc("set_measure_type_active", { _id: t.id, _active: v });
    if (error) toast.error(rpcErrorText(error)); else { toast.success(v ? "Reactivated" : "Deactivated"); refresh(); }
  };
  const remove = async (t: MeasureType) => {
    const { error } = await supabase.rpc("delete_measure_type", { _id: t.id });
    if (error) toast.error(rpcErrorText(error)); else { toast.success("Deleted"); refresh(); }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button className="gap-1" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />New measure type</Button></div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Measure</TableHead><TableHead>Kind</TableHead><TableHead>Default options</TableHead>
              <TableHead>Source</TableHead><TableHead className="text-right">Used on</TableHead><TableHead>Active</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
            {types.map((t) => {
              const system = t.agency_id === null;
              return (
                <TableRow key={t.id} data-measure={t.label}>
                  <TableCell className="font-medium">{t.label}</TableCell>
                  <TableCell className="text-sm">{humanize(t.kind)}</TableCell>
                  <TableCell className="max-w-[220px] text-xs text-muted-foreground">{t.default_options?.join(", ") || "—"}</TableCell>
                  <TableCell><Badge variant={system ? "secondary" : "outline"}>{system ? "System" : "Agency"}</Badge></TableCell>
                  <TableCell className="text-right text-sm">{t.uses} objective{t.uses === 1 ? "" : "s"}</TableCell>
                  <TableCell>{system ? <span className="text-xs text-muted-foreground">Always</span> : <Switch checked={t.is_active} onCheckedChange={(v) => setActive(t, v)} aria-label={`Active: ${t.label}`} />}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {!system && (
                      <>
                        <Button size="icon" variant="ghost" aria-label={`Edit ${t.label}`} onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Delete ${t.label}`} disabled={t.uses > 0}
                          title={t.uses > 0 ? "In use: deactivate it instead" : "Delete"} onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {editing && <MeasureTypeDialog type={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function MeasureTypeDialog({ type, onClose, onSaved }: { type: MeasureType | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(type?.label ?? "");
  const [kind, setKind] = useState<Kind>(type?.kind ?? "yes_no_na");
  const [options, setOptions] = useState((type?.default_options ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const opts = options.split(",").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.rpc("upsert_measure_type", { _id: type?.id ?? null, _kind: kind, _label: label, _default_options: opts.length ? opts : null });
    setBusy(false);
    if (error) toast.error(rpcErrorText(error)); else { toast.success(type ? "Saved" : "Measure type added"); onSaved(); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
        <DialogHeader>
          <DialogTitle>{type ? "Edit measure type" : "New measure type"}</DialogTitle>
          <DialogDescription>Agency measure types appear in the data-question picker of every office.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="mt-label">Label</Label><Input id="mt-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)} disabled={!!type && type.uses > 0}>
              <SelectTrigger aria-label="Kind"><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{humanize(k)}</SelectItem>)}</SelectContent>
            </Select>
            {!!type && type.uses > 0 && <p className="text-xs text-muted-foreground">In use, so the kind can't change.</p>}
          </div>
          <div className="space-y-1"><Label htmlFor="mt-opts">Default options (comma separated)</Label><Input id="mt-opts" value={options} onChange={(e) => setOptions(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !label.trim()}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

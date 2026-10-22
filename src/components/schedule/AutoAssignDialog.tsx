import { useEffect, useMemo, useState } from "react";
import { addDays, addMonths, addWeeks, endOfDay, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek, subDays, subMonths, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { FilterChip } from "@/components/compliance/FilterChip";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";
import { parseDateOnly } from "@/lib/dateOnly";
import { rpcErrorText } from "@/lib/rpcError";

/**
 * Auto-assign (owner decision 4, Oct 21): a period (day / week / month) of an office → a server-side preview
 * (propose_auto_assignments: only caregivers who pass every check as with enforcement on; units, caps, group ratio,
 * weekly hours and same-day overlaps counted over the whole set; continuity and the office's weights in the score) →
 * the manager picks → commit_auto_assignments re-checks each pick and assigns through the usual path (audited).
 */
type Mode = "day" | "week" | "month";
interface Proposal { shift_id: string; shift_date: string; start_time: string; end_time: string; client: string; caregiver_id: string; caregiver: string; score: number; reasons: string[]; warnings: string[] }
interface Blocked { shift_id: string; shift_date: string; start_time: string; end_time: string; client: string; reasons: string[] }
const range = (d: Date, m: Mode) => m === "day" ? { start: startOfDay(d), end: endOfDay(d) } : m === "month" ? { start: startOfMonth(d), end: endOfMonth(d) } : { start: startOfWeek(d), end: endOfWeek(d) };
const iso = (d: Date) => format(d, "yyyy-MM-dd");
const when = (s: { shift_date: string; start_time: string; end_time: string }) => `${format(parseDateOnly(s.shift_date), "EEE MMM d")} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;

export function AutoAssignDialog({ open, onOpenChange, initialDate, initialMode, onCommitted }: {
  open: boolean; onOpenChange: (o: boolean) => void; initialDate: Date; initialMode: Mode; onCommitted: () => void;
}) {
  const { offices } = useComplianceOffices();
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [date, setDate] = useState<Date>(initialDate);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [result, setResult] = useState<{ proposals: Proposal[]; blocked: Blocked[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<{ shift_id: string; reason: string }[]>([]);
  useEffect(() => { if (open) { setMode(initialMode); setDate(initialDate); setResult(null); setSkipped([]); } }, [open, initialMode, initialDate]);
  // one office: preselected; several: the manager chooses (a whole agency's offices can be large)
  useEffect(() => { if (!officeId && offices.length === 1) setOfficeId(offices[0].id); }, [offices, officeId]);
  const r = useMemo(() => range(date, mode), [date, mode]);
  const label = mode === "day" ? format(date, "EEEE, MMM d, yyyy") : mode === "month" ? format(date, "MMMM yyyy") : `${format(r.start, "MMM d")} – ${format(r.end, "MMM d, yyyy")}`;
  const move = (dir: 1 | -1) => { setResult(null); setDate((d) => mode === "day" ? (dir > 0 ? addDays(d, 1) : subDays(d, 1)) : mode === "month" ? (dir > 0 ? addMonths(d, 1) : subMonths(d, 1)) : (dir > 0 ? addWeeks(d, 1) : subWeeks(d, 1))); };

  const preview = async () => {
    if (!officeId) return;
    setBusy("preview"); setSkipped([]);
    const { data, error } = await supabase.rpc("propose_auto_assignments", { _office_id: officeId, _from: iso(r.start), _to: iso(r.end) });
    setBusy(null);
    if (error) { toast.error(rpcErrorText(error)); return; }
    const res = data as unknown as { proposals: Proposal[]; blocked: Blocked[] };
    setResult(res); setSelected(new Set(res.proposals.map((p) => p.shift_id)));
  };
  const commit = async () => {
    if (!officeId || !result) return;
    const chosen = result.proposals.filter((p) => selected.has(p.shift_id));
    if (!chosen.length) { toast.error("Nothing selected"); return; }
    setBusy("commit");
    const { data, error } = await supabase.rpc("commit_auto_assignments", { _office_id: officeId, _from: iso(r.start), _to: iso(r.end),
      _assignments: chosen.map((p) => ({ shift_id: p.shift_id, caregiver_id: p.caregiver_id })) });
    setBusy(null);
    if (error) { toast.error(rpcErrorText(error)); return; }
    const res = data as unknown as { assigned: unknown[]; skipped: { shift_id: string; reason: string }[] };
    toast.success(`Assigned ${res.assigned.length} visit${res.assigned.length === 1 ? "" : "s"}${res.skipped.length ? `; ${res.skipped.length} skipped` : ""}`);
    onCommitted();
    if (res.skipped.length) { setSkipped(res.skipped); setResult(null); } else onOpenChange(false);
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[960px]" data-testid="auto-assign-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />Auto-assign</DialogTitle>
          <DialogDescription>Proposes a caregiver for each unassigned visit in the period. Only caregivers who pass every check (credentials, training on the
            client's current IPOS, authorization units, as with enforcement on) are proposed; you confirm before anything is assigned.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {offices.length > 1 && (
            <Select value={officeId ?? ""} onValueChange={(v) => { setOfficeId(v); setResult(null); }}>
              <SelectTrigger className="w-[240px]" aria-label="Office" data-testid="aa-office"><SelectValue placeholder="Choose an office" /></SelectTrigger>
              <SelectContent>{offices.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <ToggleGroup type="single" value={mode} onValueChange={(v) => { if (v) { setMode(v as Mode); setResult(null); } }} aria-label="Period" data-testid="aa-period">
            <FilterChip value="day">Day</FilterChip><FilterChip value="week">Week</FilterChip><FilterChip value="month">Month</FilterChip>
          </ToggleGroup>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" aria-label="Previous period" onClick={() => move(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[180px] text-center text-sm font-medium" data-testid="aa-label">{label}</span>
            <Button size="icon" variant="outline" aria-label="Next period" onClick={() => move(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <Button className="ml-auto gap-1" onClick={preview} disabled={!officeId || busy !== null} data-testid="aa-preview">
            {busy === "preview" && <Loader2 className="h-4 w-4 animate-spin" />}Preview</Button>
        </div>

        {skipped.length > 0 && (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm" data-testid="aa-skipped">
            <p className="font-medium">{skipped.length} not assigned (changed since the preview):</p>
            <ul className="list-disc pl-5 text-muted-foreground">{skipped.map((s) => <li key={s.shift_id}>{s.reason}</li>)}</ul>
          </div>
        )}
        {result && (
          <div className="space-y-4">
            {result.proposals.length === 0 && result.blocked.length === 0 && <p className="text-sm text-muted-foreground" data-testid="aa-empty">No unassigned visits in this period.</p>}
            {result.proposals.length > 0 && (
              <div className="space-y-2" data-testid="aa-proposals">
                <div className="flex items-center justify-between"><p className="font-medium">Proposed ({result.proposals.length})</p>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(selected.size === result.proposals.length ? new Set() : new Set(result.proposals.map((p) => p.shift_id)))}>
                    {selected.size === result.proposals.length ? "Clear all" : "Select all"}</Button></div>
                <ul className="divide-y rounded-md border">
                  {result.proposals.map((p) => (
                    <li key={p.shift_id} className="flex gap-3 p-2" data-testid="aa-proposal" data-shift={p.shift_id}>
                      <Checkbox checked={selected.has(p.shift_id)} onCheckedChange={() => toggle(p.shift_id)} aria-label={`Assign ${p.caregiver} to ${p.client}`} className="mt-1" />
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{when(p)}</span><span>{p.client}</span><span className="text-muted-foreground">→</span>
                          <span className="font-medium">{p.caregiver}</span><Badge variant="outline">{p.score}%</Badge></div>
                        {p.reasons.length > 0 && <p className="text-xs text-muted-foreground">{p.reasons.join(" · ")}</p>}
                        {p.warnings.length > 0 && <p className="text-xs text-warning">{p.warnings.join(" · ")}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.blocked.length > 0 && (
              <div className="space-y-2" data-testid="aa-blocked">
                <p className="font-medium">Can't be filled ({result.blocked.length})</p>
                <ul className="divide-y rounded-md border">
                  {result.blocked.map((b) => (
                    <li key={b.shift_id} className="p-2 text-sm" data-testid="aa-blocked-row">
                      <span className="font-medium">{when(b)}</span> <span>{b.client}</span>
                      <p className="text-xs text-muted-foreground">{b.reasons.join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button id="aa-commit" onClick={commit} disabled={!result || selected.size === 0 || busy !== null} data-testid="aa-commit">
            {busy === "commit" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Assign {selected.size || ""} selected</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

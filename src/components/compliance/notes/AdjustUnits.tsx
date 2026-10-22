import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { fmtTime } from "@/lib/caregiverNotes";
import { ADJUST_MIN, type StaffNote } from "@/lib/staffNotes";
import { UNITS_RULES } from "@/lib/units";

const outline = "min-h-10 gap-1 hover:bg-muted hover:text-foreground";

/**
 * S18 (owner, Oct 22): the note's units to bill in the Review panel — calculated (and the rule it was counted with) vs a
 * reviewer's adjustment — and "Adjust units" while the note is Submitted (adjust_note_units: 0..scheduled, a reason of
 * at least 10 characters; audited; review then charges the adjusted units).
 */
export function NoteUnits({ d, onDone }: { d: StaffNote; onDone: () => void }) {
  const n = d.note, tz = d.office.timezone;
  const [open, setOpen] = useState(false);
  if (n.billable === false || n.units_scheduled == null) return null;
  const adjusted = n.units_adjusted != null;
  const rule = UNITS_RULES.find((r) => r.value === n.units_rule)?.label;
  return (
    <div className="space-y-1 rounded-md border p-3" data-testid="review-units" data-adjusted={adjusted}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium">Units to bill: {n.units_to_bill} of {n.units_scheduled}</span>
          {adjusted && <Badge variant="outline" className="ml-2" data-testid="units-adjusted-badge">Adjusted</Badge>}
        </p>
        {n.status === "submitted" && (
          <Button variant="outline" size="sm" className={outline} onClick={() => setOpen(true)} data-testid="open-adjust-units">
            <SlidersHorizontal className="h-4 w-4" />Adjust units</Button>
        )}
      </div>
      {adjusted && (
        <p className="text-xs text-muted-foreground" data-testid="units-adjusted-detail">
          Calculated {n.units_calculated ?? "—"} · adjusted to {n.units_adjusted}
          {n.units_adjusted_by_name ? ` by ${n.units_adjusted_by_name}` : ""}{n.units_adjusted_at ? `, ${fmtTime(n.units_adjusted_at, tz, true)}` : ""}
          {n.units_adjust_reason ? ` — “${n.units_adjust_reason}”` : ""}
        </p>
      )}
      {rule && <p className="text-xs text-muted-foreground">Counted with: {rule}{n.units_rule === "grace" ? ` (${n.units_grace_minutes} min)` : ""}</p>}
      <AdjustUnitsDialog d={d} open={open} onOpenChange={setOpen} onDone={onDone} />
    </div>
  );
}

function AdjustUnitsDialog({ d, open, onOpenChange, onDone }: { d: StaffNote; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const n = d.note, max = n.units_scheduled ?? 0;
  const [units, setUnits] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setUnits(String(n.units_adjusted ?? n.units_to_bill)); setReason(n.units_adjust_reason ?? ""); setError(null); } }, [open, n.units_adjusted, n.units_to_bill, n.units_adjust_reason]);
  const u = Number(units);
  const unitsOk = units !== "" && Number.isInteger(u) && u >= 0 && u <= max;
  const reasonOk = reason.trim().length >= ADJUST_MIN;

  const run = async (value: number | null) => {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc("adjust_note_units", { _note_id: n.id, _units: value as number, _reason: value === null ? (null as unknown as string) : reason.trim() });
    setBusy(false);
    if (e) { setError(e.code === "22023" ? e.message : "The units couldn't be adjusted."); return; }
    toast.success(value === null ? "Adjustment cleared" : "Units to bill adjusted"); onOpenChange(false); onDone();
  };
  const len = reason.trim().length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="adjust-units-dialog">
        <DialogHeader>
          <DialogTitle>Adjust units to bill</DialogTitle>
          <DialogDescription>Calculated from the caregiver's times: {n.units_calculated ?? n.units_to_bill} of {max}. The adjusted units are charged when you mark
            the note reviewed. The caregiver's times stay as entered.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="max-w-[160px] space-y-1">
            <Label htmlFor="adjust-units">Units to bill (0–{max})</Label>
            <Input id="adjust-units" type="number" min={0} max={max} step={1} value={units} onChange={(e) => setUnits(e.target.value)} data-testid="adjust-units-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="adjust-reason">Reason</Label>
            <Textarea id="adjust-reason" className="min-h-[90px] text-base" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="adjust-reason" />
            <p className={reasonOk ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{reasonOk ? `${len} characters` : `At least ${ADJUST_MIN} characters (${len}/${ADJUST_MIN})`}</p>
          </div>
          {error && <p className="text-sm text-destructive" role="alert" data-testid="adjust-error">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          {n.units_adjusted != null && <Button variant="outline" className={outline} onClick={() => run(null)} disabled={busy} data-testid="clear-adjust">Clear adjustment</Button>}
          <Button variant="outline" className="hover:bg-muted hover:text-foreground" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => run(u)} disabled={busy || !unitsOk || !reasonOk} data-testid="confirm-adjust">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

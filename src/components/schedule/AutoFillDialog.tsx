import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Sparkles } from "lucide-react";
import { assignShift } from "@/lib/shiftAssignment";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shifts: any[];
  rangeLabel: string;
  onCommitted: () => void;
}

type Proposal = {
  shift: any;
  caregiverId: string | null;
  caregiverName: string;
  score: number;
  warnings: string[];
  selected: boolean;
  /** Set only after a commit attempt fails -- the real reason, not just a count. */
  failureReason?: string;
};

export const AutoFillDialog = ({
  open,
  onOpenChange,
  shifts,
  rangeLabel,
  onCommitted,
}: Props) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [committing, setCommitting] = useState(false);

  const analyze = useCallback(async () => {
    setAnalyzing(true);
    setProgress(0);
    const taken = new Map<string, Set<string>>(); // caregiverId -> dates already proposed
    const next: Proposal[] = [];

    for (let i = 0; i < shifts.length; i++) {
      const shift = shifts[i];
      try {
        const { data, error } = await supabase.functions.invoke("match-caregiver", {
          body: { shiftId: shift.id },
        });
        if (error) throw error;
        const matches = data?.matches || [];
        // Skip caregivers already proposed for an overlapping shift on the same day
        const best = matches.find((m: any) => {
          const dates = taken.get(m.caregiver_id);
          return !dates || !dates.has(shift.shift_date);
        });
        if (best) {
          const dates = taken.get(best.caregiver_id) || new Set<string>();
          dates.add(shift.shift_date);
          taken.set(best.caregiver_id, dates);
        }
        next.push({
          shift,
          caregiverId: best?.caregiver_id || null,
          caregiverName: best
            ? `${best.caregiver?.first_name ?? ""} ${best.caregiver?.last_name ?? ""}`.trim()
            : "No match found",
          score: best?.match_score ?? 0,
          warnings: best?.warnings || [],
          selected: !!best,
        });
      } catch (e) {
        console.error(e);
        next.push({
          shift,
          caregiverId: null,
          caregiverName: "Matching failed",
          score: 0,
          warnings: [],
          selected: false,
        });
      }
      setProgress(Math.round(((i + 1) / shifts.length) * 100));
      setProposals([...next]);
    }
    setAnalyzing(false);
  }, [shifts]);

  useEffect(() => {
    if (open && shifts.length > 0) {
      analyze();
    }
    if (!open) {
      setProposals([]);
      setProgress(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (shiftId: string) => {
    setProposals((prev) =>
      prev.map((p) =>
        p.shift.id === shiftId && p.caregiverId ? { ...p, selected: !p.selected } : p
      )
    );
  };

  const commit = async () => {
    const chosen = proposals.filter((p) => p.selected && p.caregiverId);
    if (chosen.length === 0) {
      toast.error("Nothing selected to assign");
      return;
    }
    setCommitting(true);
    let ok = 0;
    const failures: Proposal[] = [];
    for (const p of chosen) {
      try {
        await assignShift({
          shiftId: p.shift.id,
          caregiverId: p.caregiverId!,
          careTypeCode: p.shift.care_type_code,
          startTime: p.shift.start_time?.slice(0, 5),
          endTime: p.shift.end_time?.slice(0, 5),
          method: "auto_assigned",
        });
        ok++;
      } catch (e: any) {
        console.error(e);
        failures.push({ ...p, failureReason: e?.message || "Assignment was refused" });
      }
    }
    setCommitting(false);
    if (failures.length > 0) {
      // Surface WHY, not just a count -- update the visible table with the real
      // reasons instead of only closing on a bare "N failed" toast.
      setProposals((prev) =>
        prev.map((p) => failures.find((f) => f.shift.id === p.shift.id) ?? p)
      );
      toast.error(
        `Auto-filled ${ok} shift${ok === 1 ? "" : "s"} — ${failures.length} failed, see reasons below`
      );
      return;
    }
    toast.success(`Auto-filled ${ok} shift${ok === 1 ? "" : "s"}`);
    onOpenChange(false);
    onCommitted();
  };

  const selectedCount = proposals.filter((p) => p.selected && p.caregiverId).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Auto-fill unassigned shifts
          </DialogTitle>
          <DialogDescription>
            {shifts.length} unassigned shift{shifts.length === 1 ? "" : "s"} in {rangeLabel}. Review
            the proposed pairings, then confirm — nothing is saved until you do.
          </DialogDescription>
        </DialogHeader>

        {analyzing && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Matching caregivers... {progress}%
            </div>
            <Progress value={progress} />
          </div>
        )}

        <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Shift</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Proposed caregiver</TableHead>
                <TableHead className="text-right">Match</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposals.length === 0 && !analyzing ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No unassigned shifts in this period.
                  </TableCell>
                </TableRow>
              ) : (
                proposals.map((p) => (
                  <TableRow key={p.shift.id}>
                    <TableCell>
                      <Checkbox
                        checked={p.selected}
                        disabled={!p.caregiverId}
                        onCheckedChange={() => toggle(p.shift.id)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {format(parseISO(p.shift.shift_date), "EEE, MMM d")}
                      <div className="text-xs text-muted-foreground">
                        {p.shift.start_time?.slice(0, 5)}–{p.shift.end_time?.slice(0, 5)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.shift.clients?.first_name} {p.shift.clients?.last_name}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className={p.caregiverId ? "" : "text-muted-foreground"}>
                        {p.caregiverName}
                      </span>
                      {p.failureReason ? (
                        <div className="text-xs text-destructive">Failed: {p.failureReason}</div>
                      ) : (
                        p.warnings.length > 0 && (
                          <div className="text-xs text-warning">{p.warnings[0]}</div>
                        )
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.caregiverId ? (
                        <Badge variant="outline">{p.score}%</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          —
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={committing}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={analyzing || committing || selectedCount === 0}>
            {committing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Assign {selectedCount} shift{selectedCount === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

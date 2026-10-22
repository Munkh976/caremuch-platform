import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Star, TrendingUp } from "lucide-react";
import { AssignShiftDialog } from "@/components/schedule/AssignShiftDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: any | null;
  onAssigned: () => void;
}

const scoreClass = (score: number) => {
  if (score >= 90) return "border-success text-success";
  if (score >= 75) return "border-primary text-primary";
  if (score >= 60) return "border-warning text-warning";
  return "border-muted-foreground text-muted-foreground";
};

export const SmartAssignSheet = ({ open, onOpenChange, shift, onAssigned }: Props) => {
  const [matches, setMatches] = useState<any[]>([]);
  const [notEligible, setNotEligible] = useState(0);
  const [clientBlocked, setClientBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<any | null>(null);

  const fetchMatches = useCallback(async (shiftId: string) => {
    try {
      setLoading(true);
      // Auto-assign (owner 4a/4b/4f): the same gate and per-office scoring as Auto-assign, in the database
      const { data, error } = await supabase.rpc("suggest_caregivers", { _shift_id: shiftId });
      if (error) throw error;
      const r = data as unknown as { matches: typeof matches; not_eligible: number; client_blocked: string | null };
      setMatches(r?.matches || []);
      setNotEligible(Number(r?.not_eligible ?? 0));
      setClientBlocked(r?.client_blocked ?? null);
    } catch (e) {
      console.error(e);
      toast.error("Failed to fetch caregiver matches");
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && shift?.id) fetchMatches(shift.id);
    if (!open) {
      setMatches([]);
      setPending(null);
      setNotEligible(0);
      setClientBlocked(null);
    }
  }, [open, shift?.id, fetchMatches]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Smart assign</SheetTitle>
            <SheetDescription>
              {shift ? (
                <>
                  {shift.clients?.first_name} {shift.clients?.last_name} ·{" "}
                  {shift.shift_date && format(parseISO(shift.shift_date), "EEE, MMM d")} ·{" "}
                  {shift.start_time?.slice(0, 5)}–{shift.end_time?.slice(0, 5)}
                </>
              ) : (
                "Pick a shift"
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-3">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <p className="text-muted-foreground text-sm">Ranking caregivers...</p>
              </div>
            ) : matches.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground" data-testid="smart-empty">
                <p>No matching caregivers found for this shift.</p>
                {clientBlocked && <p className="mt-1">{clientBlocked}.</p>}
                {notEligible > 0 && <p className="mt-1">{notEligible} caregiver{notEligible === 1 ? " isn't" : "s aren't"} eligible with all care-plan checks on; Assign shows them with the reasons.</p>}
              </div>
            ) : (
              <>
              {notEligible > 0 && <p className="text-xs text-muted-foreground" data-testid="smart-not-eligible">Only caregivers who pass every check (as with enforcement on) are suggested; {notEligible} more can be assigned manually with Assign.</p>}
              {matches.map((match, index) => (
                <Card key={match.caregiver_id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Badge>#{index + 1}</Badge>
                        <div>
                          <p className="font-semibold">
                            {match.caregiver?.first_name} {match.caregiver?.last_name}
                          </p>
                          <div className="flex items-center gap-1 mt-0.5">
                            {match.caregiver?.avg_rating != null ? (
                              <>
                                {[...Array(5)].map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`w-3.5 h-3.5 ${
                                      i < Math.floor(match.caregiver.avg_rating)
                                        ? "fill-warning text-warning"
                                        : "text-muted-foreground/40"
                                    }`}
                                  />
                                ))}
                                <span className="text-xs text-muted-foreground ml-1">
                                  {Number(match.caregiver.avg_rating).toFixed(1)} (
                                  {match.caregiver.rating_count})
                                </span>
                              </>
                            ) : (
                              <Badge variant="outline" className="text-[10px] font-normal">
                                New — no ratings yet
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className={`gap-1 ${scoreClass(match.match_score)}`}>
                        <TrendingUp className="h-3 w-3" />
                        {match.match_score}%
                      </Badge>
                    </div>

                    {match.key_factors?.length > 0 && (
                      <ul className="text-xs text-muted-foreground list-disc list-inside">
                        {match.key_factors.map((f: string, i: number) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    )}
                    {match.warnings?.length > 0 && (
                      <ul className="text-xs text-warning list-disc list-inside">
                        {match.warnings.map((w: string, i: number) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )}

                    <Button size="sm" className="w-full" onClick={() => setPending(match)}>
                      Assign {match.caregiver?.first_name}
                    </Button>
                  </CardContent>
                </Card>
              ))}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AssignShiftDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        shift={shift}
        defaultCaregiverId={pending?.caregiver_id}
        matchContext={
          pending
            ? {
                score: pending.match_score,
                factors: pending.key_factors,
                warnings: pending.warnings,
              }
            : null
        }
        onAssigned={() => {
          setPending(null);
          onOpenChange(false);
          onAssigned();
        }}
      />
    </>
  );
};

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { rpcErrorText } from "@/lib/rpcError";
import { DEFAULT_WEIGHTS, effectiveWeights, FACTORS, isValidWeights, sumWeights, type Weights } from "@/lib/matchWeights";

/**
 * Virtual Offices → Scheduling: the office's Smart match weights (owner decision 4b). They rank caregivers in Smart
 * Assign and Auto-assign; who can be proposed at all is decided by the checks, not by the weights. Saved through
 * set_office_match_weights (agency admin, audited); "Use defaults" clears the office's own weights.
 */
export function MatchWeightsCard({ officeId, officeWeights, agencyWeights, canManage, onSaved }: {
  officeId: string; officeWeights: unknown; agencyWeights: unknown; canManage: boolean; onSaved: () => void;
}) {
  const current = effectiveWeights(officeWeights, agencyWeights);
  const [w, setW] = useState<Weights>(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setW(effectiveWeights(officeWeights, agencyWeights)); }, [officeWeights, agencyWeights]);
  const total = sumWeights(w);
  const save = async (weights: Weights | null) => {
    if (weights && !isValidWeights(weights)) { toast.error("The weights must be whole numbers adding up to 100"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("set_office_match_weights", { _office_id: officeId, _weights: weights });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(weights ? "Match weights saved" : "Match weights back to the defaults"); onSaved();
  };
  return (
    <Card data-testid="match-weights">
      <CardHeader>
        <CardTitle>Smart match weights</CardTitle>
        <CardDescription>How Smart Assign and Auto-assign rank the caregivers who pass every check. A factor at 0 is ignored and not shown in
          the reasons. {isValidWeights(officeWeights) ? "This office has its own weights." : "This office uses the default weights."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FACTORS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`w-${f.key}`}>{f.label}</Label>
              <Input id={`w-${f.key}`} type="number" min={0} max={100} step={1} value={w[f.key]} disabled={!canManage}
                onChange={(e) => setW({ ...w, [f.key]: e.target.value === "" ? 0 : Math.round(Number(e.target.value)) })} />
              <p className="text-xs text-muted-foreground">{f.hint}</p>
            </div>
          ))}
        </div>
        <p className={cn("text-sm", total === 100 ? "text-muted-foreground" : "font-medium text-destructive")} data-testid="weights-total">Total {total} of 100</p>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save(w)} disabled={busy || total !== 100} data-testid="save-weights">Save weights</Button>
            <Button variant="outline" onClick={() => save(null)} disabled={busy}>Use defaults ({FACTORS.map((f) => DEFAULT_WEIGHTS[f.key]).join(" / ")})</Button>
          </div>
        ) : <p className="text-xs text-muted-foreground">Only an agency admin can change these.</p>}
      </CardContent>
    </Card>
  );
}

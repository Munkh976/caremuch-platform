import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { rpcErrorText } from "@/lib/rpcError";
import { UNITS_RULES, unitsUnderRule, type UnitsRule } from "@/lib/units";

const day = "2026-10-01", t = (hhmm: string) => `${day}T${hhmm}:00Z`;
const EXAMPLES: { label: string; arrival: string; end: string }[] = [
  { label: "On time, 9:00–10:00", arrival: "09:00", end: "10:00" },
  { label: "Arrived 9:07", arrival: "09:07", end: "10:00" },
  { label: "Left at 9:52", arrival: "09:00", end: "09:52" },
  { label: "Arrived 9:20, left 9:50", arrival: "09:20", end: "09:50" },
];

/**
 * Virtual Office → Compliance: how a visit's units to bill are counted (S18, owner Oct 22). Saved through
 * set_office_units_rule (agency admin, audited). 15-minute units only for now. Applies to notes saved from now on;
 * submitted notes keep their units, and each note stores the rule it was counted with.
 */
export function UnitsRuleCard({ officeId, canManage }: { officeId: string; canManage: boolean }) {
  const [saved, setSaved] = useState<{ rule: UnitsRule; grace: number } | null>(null);
  const [rule, setRule] = useState<UnitsRule>("full_blocks");
  const [grace, setGrace] = useState(5);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("virtual_office").select("units_rule, units_grace_minutes").eq("id", officeId).maybeSingle();
    if (!data) return;
    const s = { rule: (data.units_rule as UnitsRule) ?? "full_blocks", grace: data.units_grace_minutes ?? 0 };
    setSaved(s); setRule(s.rule); setGrace(s.rule === "grace" ? s.grace : 5);
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  const graceOk = rule !== "grace" || (Number.isInteger(grace) && grace >= 1 && grace <= 14);
  const save = async () => {
    if (!graceOk) { toast.error("The grace period is 1 to 14 minutes"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("set_office_units_rule", { _office_id: officeId, _rule: rule, _grace_minutes: rule === "grace" ? grace : 0, _minutes: 15 });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success("Billing units rule saved"); await load();
  };

  if (!saved) return null;
  const dirty = rule !== saved.rule || (rule === "grace" && grace !== saved.grace);
  return (
    <Card data-testid="units-rule-card">
      <CardHeader>
        <CardTitle>Billing units</CardTitle>
        <CardDescription>How a visit's units to bill are counted from the client's arrival and end times (15-minute units). Applies to
          notes saved from now on; submitted notes keep their units.{!canManage && " Only an agency admin can change this."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={rule} onValueChange={(v) => setRule(v as UnitsRule)} disabled={!canManage} className="space-y-2">
          {UNITS_RULES.map((r) => (
            <div key={r.value} className="flex items-start gap-2">
              <RadioGroupItem value={r.value} id={`units-${r.value}`} className="mt-1" data-testid={`units-rule-${r.value}`} />
              <Label htmlFor={`units-${r.value}`} className="font-normal">
                <span className="font-medium">{r.label}</span> <span className="text-muted-foreground">— {r.hint}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
        {rule === "grace" && (
          <div className="max-w-[220px] space-y-1">
            <Label htmlFor="units-grace-minutes">Grace period (minutes)</Label>
            <Input id="units-grace-minutes" type="number" min={1} max={14} step={1} value={grace} disabled={!canManage}
              onChange={(e) => setGrace(e.target.value === "" ? 0 : Math.round(Number(e.target.value)))} data-testid="units-grace" />
            {!graceOk && <p className="text-xs text-destructive">1 to 14 minutes</p>}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="units-examples">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3 font-medium">Visit scheduled 9:00–10:00 (4 units)</th><th className="py-1 font-medium">Units to bill</th></tr></thead>
            <tbody>
              {EXAMPLES.map((x) => (
                <tr key={x.label} className="border-t">
                  <td className="py-1 pr-3">{x.label}</td>
                  <td className="py-1 font-medium">{unitsUnderRule({ scheduledStart: t("09:00"), scheduledEnd: t("10:00"), arrival: t(x.arrival), end: t(x.end), rule, grace: graceOk ? grace : 0 })} of 4</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage && <Button onClick={save} disabled={busy || !dirty || !graceOk} data-testid="units-rule-save">Save</Button>}
      </CardContent>
    </Card>
  );
}

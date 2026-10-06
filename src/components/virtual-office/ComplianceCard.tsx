import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fmtDay } from "@/lib/caregiverNotes";

interface Flags { module: boolean; enforcement: boolean; goLive: string | null }

/**
 * Virtual Office Compliance card (Ripple S10, G4): the care-plan module and the compliance enforcement switch.
 * Only agency_admin / system_admin change them (R8): the module through seed_office_care_plan_defaults, enforcement
 * through set_compliance_enforcement (audited, server-checked). Managers see the card read-only.
 */
export function ComplianceCard({ officeId, officeName, canManage }: { officeId: string; officeName: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [flags, setFlags] = useState<Flags | null>(null);
  const [confirm, setConfirm] = useState<null | "module" | "on" | "off">(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("virtual_office")
      .select("care_plan_module_enabled, compliance_enforcement_enabled, care_plan_module_enabled_at").eq("id", officeId).maybeSingle();
    if (data) setFlags({ module: data.care_plan_module_enabled === true, enforcement: data.compliance_enforcement_enabled === true, goLive: data.care_plan_module_enabled_at ?? null });
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    const what = confirm; if (!what) return;
    setBusy(true);
    const { error } = what === "module"
      ? await supabase.rpc("seed_office_care_plan_defaults", { _office_id: officeId })
      : await supabase.rpc("set_compliance_enforcement", { _office_id: officeId, _enabled: what === "on" });
    setBusy(false); setConfirm(null);
    if (error) { toast.error(error.message || "Could not change the setting"); return; }
    toast.success(what === "module" ? "Care-plan module turned on" : what === "on" ? "Compliance enforcement is on" : "Compliance enforcement is off");
    await load();
    qc.invalidateQueries({ queryKey: ["compliance-offices"] });
  };

  if (!flags) return null;
  return (
    <Card data-testid="compliance-card">
      <CardHeader>
        <CardTitle>Compliance</CardTitle>
        <CardDescription>
          Care-plan module and assignment enforcement for this office.
          {!canManage && " Only an agency admin can change these settings."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Care-plan module</p>
            <p className="text-xs text-muted-foreground">
              {flags.module ? `On${flags.goLive ? ` since ${fmtDay(flags.goLive.slice(0, 10))}` : ""} (go-live date set by the server)` : "Off: this office uses scheduling only."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={flags.module ? "default" : "outline"} data-testid="module-status">{flags.module ? "On" : "Off"}</Badge>
            {!flags.module && canManage && (
              <Button size="sm" variant="outline" onClick={() => setConfirm("module")} data-testid="module-turn-on">Turn on</Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="max-w-xl">
            <Label htmlFor="enforcement-switch" className="text-sm font-medium">Compliance enforcement</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {flags.enforcement
                ? "On: care-plan checks block assignment."
                : "Off: care-plan checks (training, credentials, authorization units, group size) are advisory; assigning works as before."}
              {!flags.module && " Turn on the care-plan module first."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={flags.enforcement ? "destructive" : "outline"} data-testid="enforcement-status">{flags.enforcement ? "Enforced" : "Advisory"}</Badge>
            <Switch id="enforcement-switch" data-testid="enforcement-switch" checked={flags.enforcement}
              disabled={!canManage || busy || (!flags.module && !flags.enforcement)}
              onCheckedChange={(v) => setConfirm(v ? "on" : "off")} />
          </div>
        </div>
      </CardContent>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <AlertDialogContent data-testid="compliance-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "module" ? `Turn on the care-plan module for ${officeName}?`
                : confirm === "on" ? `Turn on compliance enforcement for ${officeName}?` : `Turn off compliance enforcement for ${officeName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {confirm === "module" && <p>Adds the default credential types and service mappings and shows the care-plan menus for this office. Enforcement stays off. This change is audited.</p>}
                {confirm === "on" && (
                  <ul className="list-disc space-y-1 pl-5" data-testid="compliance-confirm-changes">
                    <li>Care-plan checks (training on the client's current plan, required credentials, authorization and units, group size) stop being advisory and <strong>block</strong> new assignments: the assign dialog shows Blocked and Confirm is disabled.</li>
                    <li>Smart assign and Auto-fill leave out caregivers who don't pass.</li>
                    <li>Caregivers see such shifts as "Not bookable yet" and can't pick them up.</li>
                    <li>Shifts already assigned stay assigned. Offices without the module are not affected.</li>
                    <li>This change is audited (who and when).</li>
                  </ul>
                )}
                {confirm === "off" && <p>Care-plan checks become advisory again: they still show in the assign dialog, but Confirm is enabled and Smart, Auto-fill and caregiver pick-up work as before. This change is audited.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="compliance-confirm-ok" disabled={busy} onClick={(e) => { e.preventDefault(); run(); }}>
              {confirm === "module" ? "Turn on module" : confirm === "on" ? "Turn on enforcement" : "Turn off enforcement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

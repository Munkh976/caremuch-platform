import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { parseDateOnly } from "@/lib/dateOnly";
import { diffSnapshots, expiryText, pendingNeeds, type IposExpiry, type PlanSnapshot } from "@/lib/planVersions";
import { cpKey } from "./useCarePlanData";

/**
 * S17 (IPOS versions): the expiry warning with the visits dated after the expiration date (owner decision 1c), a pending
 * version's progress, and the revision history with "What changed" (display only; the server records revisions).
 */
const day = (d: string) => format(parseDateOnly(d), "MMM d, yyyy");

export function useIposExpiry(officeId: string | null, clientId: string | null = null) {
  return useQuery({
    queryKey: ["ipos-expiry", officeId, clientId],
    enabled: !!officeId,
    retry: false,
    queryFn: async (): Promise<IposExpiry[]> => {
      const { data, error } = await supabase.rpc("list_ipos_expiry", { _office_id: officeId as string, _client_id: clientId });
      if (error) throw error;
      return (data ?? []) as unknown as IposExpiry[];
    },
  });
}

/** Client page: amber within 30 days, red within 14 days and after expiry; the late visits link to Schedule. */
export function IposExpiryBanner({ officeId, clientId }: { officeId: string | null; clientId: string }) {
  const { data = [] } = useIposExpiry(officeId, clientId);
  const e = data[0];
  if (!e || e.band === "none" && !e.shifts_after_count) return null;
  const red = e.band === "red" || e.days_left < 0;
  return (
    <Alert className={cn(red ? "border-destructive/50 bg-destructive/5 text-destructive" : "border-warning/50 bg-warning/10")} data-testid="ipos-expiry-banner" data-band={red ? "red" : "amber"}>
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="space-y-1 text-foreground">
        <p className={cn("font-medium", red && "text-destructive")}>{expiryText(e)}.</p>
        <p className="text-sm">Visits can't be scheduled after {day(e.expiration_date)} until the new version is in effect.{!e.pending && " Start it on the IPOS tab (Start new IPOS version (from ISK))."}</p>
        {e.shifts_after_count > 0 && (
          <div className="text-sm" data-testid="shifts-after">
            <span className="font-medium">{e.shifts_after_count} visit{e.shifts_after_count === 1 ? " is" : "s are"} already scheduled after that date: </span>
            {e.shifts_after.slice(0, 6).map((s, i) => <span key={s.shift_id}>{i ? ", " : ""}{format(parseDateOnly(s.shift_date), "MMM d")} {s.start_time.slice(0, 5)}</span>)}
            {e.shifts_after_count > 6 ? " …" : ""}{" "}
            <Link to={`/schedule?client=${clientId}`} state={{ fromClient: clientId }} className="font-medium text-primary underline-offset-2 hover:underline">Open in Schedule →</Link>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** In-service signed / training sessions of a pending version (manager-tier reads). */
export function usePendingProgress(clientId: string, plan: { id: string; training_version: number } | null) {
  return useQuery({
    queryKey: cpKey(clientId, "pending-progress", plan?.id),
    enabled: !!plan,
    queryFn: async () => {
      const [ins, tr] = await Promise.all([
        supabase.from("plan_inservice_forms").select("id").eq("care_plan_id", plan!.id).eq("training_version", plan!.training_version).not("signed_at", "is", null),
        supabase.from("plan_training_forms").select("id").eq("care_plan_id", plan!.id).eq("training_version", plan!.training_version),
      ]);
      if (ins.error) throw ins.error; if (tr.error) throw tr.error;
      return { inserviceSigned: (ins.data ?? []).length > 0, sessions: (tr.data ?? []).length };
    },
  });
}

export function PendingBadge({ clientId, plan }: { clientId: string; plan: { id: string; version: number; training_version: number } }) {
  const { data } = usePendingProgress(clientId, plan);
  return (
    <Badge variant="outline" className="border-warning/50 bg-warning/15 text-foreground" data-testid="pending-badge">
      IPOS v{plan.version} · {data ? pendingNeeds(data.inserviceSigned, data.sessions) : "Pending"}
    </Badge>
  );
}

/** Revision history of one version with "What changed" between consecutive revisions. */
export function RevisionsDialog({ plan, onClose }: { plan: { id: string; version: number; revision: number }; onClose: () => void }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["plan-revisions", plan.id, plan.revision],
    queryFn: async () => {
      const { data, error } = await supabase.from("care_plan_revisions").select("revision, summary, snapshot, changed_at").eq("care_plan_id", plan.id).order("revision", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[640px]" data-testid="revisions-dialog">
        <DialogHeader><DialogTitle>IPOS v{plan.version} · revisions</DialogTitle>
          <DialogDescription>Ripple's own changes to the version in effect. Rev 0 is the version as it became effective.</DialogDescription></DialogHeader>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : data.length === 0 ? <p className="text-sm text-muted-foreground">No revisions recorded yet.</p> : (
          <ol className="space-y-3">
            {data.map((r, i) => {
              const prev = data[i + 1];
              const lines = r.summary === "activated" || r.summary === "baseline" ? [r.summary === "activated" ? "Became effective." : "State before the first recorded change."]
                : diffSnapshots(prev ? (prev.snapshot as PlanSnapshot) : null, r.snapshot as PlanSnapshot);
              return (
                <li key={r.revision} className="rounded-md border p-3" data-revision={r.revision}>
                  <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold">Rev {r.revision}</span>
                    <span className="text-muted-foreground">{format(new Date(r.changed_at), "MMM d, yyyy h:mm a")}</span>
                    {r.summary && !["activated", "baseline"].includes(r.summary) && <Badge variant="outline">{r.summary}</Badge>}</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm" data-testid="what-changed">{lines.map((l, k) => <li key={k} className="break-words">{l}</li>)}</ul>
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

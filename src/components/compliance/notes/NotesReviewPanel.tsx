import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, FileCheck2, Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { CARE_PLAN_TIER } from "@/lib/roleHome";
import { useNotesReviewCounts } from "./useStaffNotes";

/**
 * Dashboard panel (S8): "Notes to review / Overdue notes" across the module offices in the caller's
 * clinical scope. Renders nothing for anyone else, so other dashboards are unchanged.
 */
export function NotesReviewPanel() {
  const { moduleOffices } = useComplianceOffices();
  const { profile } = useCurrentProfile();
  const tier = !!profile?.roles.some((r) => CARE_PLAN_TIER.includes(r));
  const { data } = useNotesReviewCounts(tier && moduleOffices.length > 0);
  // S9: last complete week's billing status per module office (list_billing_week_status; same tier and scope)
  const { data: billing } = useQuery({
    queryKey: ["billing-week-status"], enabled: tier && moduleOffices.length > 0, staleTime: 60 * 1000,
    queryFn: async (): Promise<{ office_id: string; office_name: string; week_start: string; status: string }[]> => {
      const { data: rows, error } = await supabase.rpc("list_billing_week_status");
      if (error) throw error;
      return (rows as unknown as { office_id: string; office_name: string; week_start: string; status: string }[]) ?? [];
    },
  });
  if (!tier || !data || data.length === 0) return null;
  const toReview = data.reduce((n, c) => n + Number(c.to_review), 0), overdue = data.reduce((n, c) => n + Number(c.overdue), 0);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="notes-review-panel">
      {(billing ?? []).map((b) => (
        <Link key={b.office_id} to="/billing/weekly" className="sm:col-span-2" data-testid="billing-line" data-billing-status={b.status}>
          <Card className="hover:shadow-md"><CardContent className="flex items-center gap-3 p-3">
            <Receipt className="h-5 w-5 text-primary" aria-hidden="true" />
            <p className="flex-1 text-sm"><span className="font-semibold">Last week: {b.status === "billed" ? "billed" : "not yet billed"}</span>
              <span className="text-muted-foreground"> · {billing && billing.length > 1 ? `${b.office_name} · ` : ""}{b.status === "approved" ? "approved, waiting to be marked billed" : b.status === "open" ? "built, not approved" : b.status === "not_built" ? "not built yet" : "locked"}</span></p>
            <span className="text-sm font-medium text-primary">Weekly Billing</span>
          </CardContent></Card>
        </Link>
      ))}
      <Link to="/progress-notes?status=submitted"><Card className="hover:shadow-md"><CardContent className="flex items-center gap-3 p-4">
        <FileCheck2 className="h-6 w-6 text-primary" aria-hidden="true" />
        <div className="flex-1"><p className="font-semibold">Notes to review</p><p className="text-sm text-muted-foreground">Submitted progress notes waiting for review</p></div>
        <span className="text-2xl font-bold tabular-nums" data-testid="panel-to-review">{toReview}</span>
      </CardContent></Card></Link>
      <Link to="/progress-notes?status=overdue"><Card className={overdue ? "border-destructive/40 hover:shadow-md" : "hover:shadow-md"}><CardContent className="flex items-center gap-3 p-4">
        <AlertTriangle className={overdue ? "h-6 w-6 text-destructive" : "h-6 w-6 text-muted-foreground"} aria-hidden="true" />
        <div className="flex-1"><p className="font-semibold">Overdue notes</p><p className="text-sm text-muted-foreground">Not submitted by the end of the day after the visit</p></div>
        <span className="text-2xl font-bold tabular-nums" data-testid="panel-overdue">{overdue}</span>
      </CardContent></Card></Link>
    </div>
  );
}

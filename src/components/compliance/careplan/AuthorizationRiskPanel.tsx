import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { serviceName } from "@/lib/carePlan";

export interface RiskRow { authorization_id: string; client_id: string; client_name: string; auth_number: string; service_type: string; expiration_date: string; days: number;
  band: "red" | "yellow" | "ok"; unit_minutes: number; units_authorized: number; units_available: number; units_pending: number; units_at_risk: number; hours_at_risk: number }

const BAND = { red: "border-destructive/40 bg-destructive/10 text-destructive", yellow: "border-warning/40 bg-warning/15 text-foreground", ok: "" };

/**
 * G2 (list_authorization_risk): authorizations of the office expiring within 60 days (red <= 30,
 * yellow <= 60) and the units no assigned shift will use before they expire. Reused by S11.
 */
export function AuthorizationRiskPanel({ officeId, withinDays = 60 }: { officeId: string | null; withinDays?: number }) {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["auth-risk", officeId, withinDays],
    enabled: !!officeId,
    retry: false,
    queryFn: async (): Promise<RiskRow[]> => {
      const { data, error } = await supabase.rpc("list_authorization_risk", { _office_id: officeId as string, _within_days: withinDays });
      if (error) throw error;
      return (data ?? []) as unknown as RiskRow[];
    },
  });
  return (
    <Card data-testid="risk-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />Authorizations expiring / units at risk</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="text-sm text-muted-foreground">Not available.</p>}
        {!isLoading && !isError && data.length === 0 && <p className="text-sm text-muted-foreground">No authorization expires in the next {withinDays} days.</p>}
        <ul className="divide-y">
          {data.map((r) => (
            <li key={r.authorization_id} data-band={r.band} data-auth={r.auth_number} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <Link to={`/care-plans/${r.client_id}?tab=ipos`} className="font-medium hover:underline">{r.client_name}</Link>
                <span className="ml-2 text-sm text-muted-foreground">{serviceName(r.service_type)} · #{r.auth_number}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className={cn("whitespace-nowrap", BAND[r.band])}>{r.days === 0 ? "Expires today" : `Expires in ${r.days} day${r.days === 1 ? "" : "s"}`}</Badge>
                <span className={cn(r.units_at_risk > 0 ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {r.units_at_risk} units at risk ({r.hours_at_risk} h)
                </span>
                <span className="text-xs text-muted-foreground">{r.units_pending} scheduled</span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ModuleShell } from "@/components/compliance/ModuleShell";
import { OfficePicker } from "@/components/compliance/OfficePicker";
import { AuthorizationRiskPanel } from "@/components/compliance/careplan/AuthorizationRiskPanel";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { FilterChip } from "@/components/compliance/FilterChip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";
import { daysUntil, parseDateOnly } from "@/lib/dateOnly";
import { humanize } from "@/lib/formTemplates";
import { onboardedCount, type Onboarding } from "@/lib/carePlan";

interface ListRow {
  id: string; name: string; onboarding: Onboarding | null;
  plan: { plan_type: string; version: number; training_version: number; next_review_date: string | null; expiration_date: string | null } | null;
  units: { authorized: number; available: number; count: number; nextExpiry: string | null };
}
type Filter = "all" | "pending" | "onboarded" | "review";
/** Review due: the active plan's next review (or its expiration) is within 30 days or past. */
const reviewDue = (r: ListRow) => { const d = r.plan?.next_review_date ?? r.plan?.expiration_date; return !!d && daysUntil(d) <= 30; };

/** /care-plans (S4): clients of the module office with onboarding, plan, review date and units; G2 risk panel. */
export default function CarePlans() {
  const { moduleOffices } = useComplianceOffices();
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const officeId = picked ?? moduleOffices[0]?.id ?? null;
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["care-plan-list", officeId],
    enabled: !!officeId,
    retry: false,
    queryFn: async (): Promise<ListRow[]> => {
      const [ob, cl, pl, au] = await Promise.all([
        supabase.rpc("list_clients_onboarding", { _office_id: officeId as string }),
        supabase.from("clients").select("id, first_name, last_name").eq("virtual_office_id", officeId as string).neq("is_active", false),
        supabase.from("care_plans").select("client_id, plan_type, version, training_version, next_review_date, expiration_date").eq("virtual_office_id", officeId as string).eq("status", "active"),
        supabase.from("service_authorizations").select("client_id, units_authorized, units_available, expiration_date").eq("virtual_office_id", officeId as string),
      ]);
      if (ob.error) throw ob.error;
      if (cl.error) throw cl.error;
      const onb = new Map(((ob.data ?? []) as unknown as Onboarding[]).map((o) => [o.client_id, o]));
      const plans = new Map((pl.data ?? []).map((p) => [p.client_id, p]));
      const today = format(new Date(), "yyyy-MM-dd");
      return (cl.data ?? []).map((c) => {
        const auths = (au.data ?? []).filter((a) => a.client_id === c.id && a.expiration_date >= today);
        return {
          id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Client", onboarding: onb.get(c.id) ?? null, plan: plans.get(c.id) ?? null,
          units: { authorized: auths.reduce((s, a) => s + Number(a.units_authorized), 0), available: auths.reduce((s, a) => s + Number(a.units_available), 0),
            count: auths.length, nextExpiry: auths.map((a) => a.expiration_date).sort()[0] ?? null },
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const rows = useMemo(() => data.filter((r) => filter === "all" || (filter === "pending" && !r.onboarding?.onboarded)
    || (filter === "onboarded" && !!r.onboarding?.onboarded) || (filter === "review" && reviewDue(r))), [data, filter]);

  return (
    <ModuleShell title="Client Care Plans (IPOS)" description="Plans of service, goals, authorizations, onboarding and progress notes for each client." icon={ClipboardCheck} slice="S4">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <OfficePicker offices={moduleOffices} value={officeId} onChange={setPicked} />
        <AuthorizationRiskPanel officeId={officeId} />
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} className="flex-wrap justify-start" aria-label="Filter clients">
          <FilterChip value="all">All</FilterChip>
          <FilterChip value="pending">Onboarding pending</FilterChip>
          <FilterChip value="onboarded">Onboarded</FilterChip>
          <FilterChip value="review">Review due</FilterChip>
        </ToggleGroup>
        <div className="overflow-x-auto rounded-md border" data-testid="care-plan-list">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Client</TableHead><TableHead>Onboarding</TableHead><TableHead>Plan</TableHead><TableHead>Next review</TableHead><TableHead>Units (active authorizations)</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
              {isError && <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">You can't see this office's clients.</TableCell></TableRow>}
              {!isLoading && !isError && rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No clients match.</TableCell></TableRow>}
              {rows.map((r) => {
                const n = r.onboarding ? onboardedCount(r.onboarding) : 0;
                return (
                  <TableRow key={r.id} data-client-row={r.id}>
                    <TableCell className="font-medium"><Link to={`/care-plans/${r.id}`} className="hover:underline">{r.name}</Link></TableCell>
                    <TableCell>
                      {r.onboarding?.onboarded
                        ? <Badge className="border-success/40 bg-success/10 text-foreground" variant="outline" data-onboarding="onboarded">Onboarded</Badge>
                        : <Badge variant="outline" data-onboarding={`${n}/8`}>{n} of 8</Badge>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {r.plan ? <>{humanize(r.plan.plan_type)} · v{r.plan.version} <span className="text-muted-foreground">(training v{r.plan.training_version})</span></> : <span className="text-muted-foreground">No plan</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {r.plan?.next_review_date ? <span className={reviewDue(r) ? "font-medium text-destructive" : ""}>{format(parseDateOnly(r.plan.next_review_date), "MMM d, yyyy")}</span> : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {r.units.count ? <>{r.units.available} left of {r.units.authorized} <span className="text-muted-foreground">({r.units.count} auth{r.units.count === 1 ? "" : "s"}{r.units.nextExpiry ? `, next ends ${format(parseDateOnly(r.units.nextExpiry), "MMM d")}` : ""})</span></>
                        : <span className="text-muted-foreground">None</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </ModuleShell>
  );
}

import { VisitActionsMenu } from "@/components/schedule/VisitActions";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UnitsBar } from "@/components/compliance/UnitsBar";
import { useTrainingContext } from "@/components/compliance/training/useTrainingData";
import { cn } from "@/lib/utils";
import { parseDateOnly } from "@/lib/dateOnly";
import { serviceName } from "@/lib/carePlan";
import { unitsByService } from "@/lib/training";
import type { CarePlanTab } from "@/lib/carePlan";
import { evaluateEligibilityBulk } from "@/lib/shiftEligibility";
import { useAuthorizations } from "./useCarePlanData";

interface ShiftRow { id: string; shift_date: string; start_time: string | null; end_time: string | null; status: string | null; caregiver_id: string | null; care_type_code: string | null;
  group_session_id: string | null; visit_outcome: string | null }
const hm = (t: string | null) => (t ? t.slice(0, 5) : "");

/**
 * Scheduling tab (S6; S15: shifts + eligibility only): this client's recent and upcoming shifts, units per service
 * (projected), and the engine's eligibility for the next unassigned shift (check_assignment_eligibility_bulk, read
 * only). No assign actions: "Open full Schedule ->" goes to the Schedule screen, filtered to this client. Training
 * lives in the Training tab ("N trained caregivers -> Training").
 */
export function SchedulingTab({ clientId, goTo }: { clientId: string; officeId: string | null; goTo: (t: CarePlanTab) => void }) {
  const ctx = useTrainingContext(clientId);
  const auths = useAuthorizations(clientId);
  const [search, setSearch] = useState("");
  const today = ctx.data?.as_of ?? format(new Date(), "yyyy-MM-dd");
  const shifts = useQuery({
    queryKey: ["cp", clientId, "shifts", today],
    enabled: !!ctx.data,
    queryFn: async (): Promise<ShiftRow[]> => {
      const from = format(addDays(parseDateOnly(today), -14), "yyyy-MM-dd"), to = format(addDays(parseDateOnly(today), 45), "yyyy-MM-dd");
      const { data, error } = await supabase.from("shifts").select("id, shift_date, start_time, end_time, status, caregiver_id, care_type_code, group_session_id, visit_outcome")
        .eq("client_id", clientId).gte("shift_date", from).lte("shift_date", to).order("shift_date").order("start_time");
      if (error) throw error;
      return data ?? [];
    },
  });
  const nextOpen = (shifts.data ?? []).find((s) => s.shift_date >= today && !s.caregiver_id && s.status !== "cancelled") ?? null;
  const officeCaregivers = useMemo(() => ctx.data?.caregivers ?? [], [ctx.data]);
  const elig = useQuery({
    queryKey: ["cp", clientId, "elig", nextOpen?.id, officeCaregivers.length],
    enabled: !!nextOpen && officeCaregivers.length > 0,
    queryFn: () => evaluateEligibilityBulk(nextOpen!.id, officeCaregivers.map((c) => c.caregiver_id)),
  });
  const names = useMemo(() => new Map(officeCaregivers.map((c) => [c.caregiver_id, c.name])), [officeCaregivers]);
  const shown = [...officeCaregivers].sort((a, b) => a.name.localeCompare(b.name)).filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const units = unitsByService(auths.data?.authorizations ?? []);

  if (ctx.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (ctx.isError || !ctx.data) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Not available.</CardContent></Card>;
  const trained = officeCaregivers.filter((c) => c.trained_current).length;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4" data-testid="scheduling-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Read-only summary. Assigning happens on the Schedule screen.
          {" "}<button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => goTo("training")} data-testid="training-link">{trained} trained caregiver{trained === 1 ? "" : "s"} → Training</button></p>
        <Button asChild size="sm" variant="outline" className="gap-1"><Link to={`/schedule?client=${clientId}`} data-testid="open-schedule">Open full Schedule <ArrowRight className="h-4 w-4" /></Link></Button>
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Shifts (last 2 weeks, next 6 weeks)</CardTitle></CardHeader>
          <CardContent>
            {shifts.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (shifts.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No shifts in this window.</p> : (
              <ul className="divide-y text-sm" data-testid="client-shifts">
                {(shifts.data ?? []).map((s) => (
                  <li key={s.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2", s.shift_date < today && "text-muted-foreground")} data-shift={s.id}>
                    <span className="whitespace-nowrap">{format(parseDateOnly(s.shift_date), "EEE MMM d")} · {hm(s.start_time)}–{hm(s.end_time)}</span>
                    <span className="flex items-center gap-2">{s.caregiver_id ? names.get(s.caregiver_id) ?? "Assigned" : <Badge variant="outline" className="border-warning/40 bg-warning/15">Unassigned</Badge>}
                      {s.status === "cancelled" && <Badge variant="secondary">{s.visit_outcome === "client_no_show" ? "Client no-show" : "Cancelled"}</Badge>}
                      {s.caregiver_id && <VisitActionsMenu shift={s} />}</span>
                  </li>))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Units by service (active authorizations, projected)</CardTitle></CardHeader>
          <CardContent className="space-y-4" data-testid="units-by-service">
            {units.length === 0 && <p className="text-sm text-muted-foreground">No active authorization.</p>}
            {units.map((u) => (
              <div key={u.service_type} className="space-y-1" data-service={u.service_type}>
                <div className="text-sm font-medium">{serviceName(u.service_type)} <span className="font-normal text-muted-foreground">· {u.count} authorization{u.count === 1 ? "" : "s"}</span></div>
                <UnitsBar authorized={u.authorized} used={u.used} pending={u.pending} unitMinutes={u.unit_minutes} />
              </div>))}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="can-deliver">
        <CardHeader className="space-y-3 pb-2">
          <CardTitle className="text-base">Eligibility for the next unassigned shift</CardTitle>
          <Input className="w-full sm:w-56" placeholder="Search caregivers" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search caregivers" />
          <p className="text-xs text-muted-foreground">
            {nextOpen ? `Next unassigned shift: ${format(parseDateOnly(nextOpen.shift_date), "EEE MMM d")} ${hm(nextOpen.start_time)}. Training and credentials are part of the check.` : "No unassigned upcoming shift, so no eligibility check is shown."}
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Caregiver</TableHead><TableHead>Eligibility</TableHead></TableRow></TableHeader>
              <TableBody>
                {shown.length === 0 && <TableRow><TableCell colSpan={2} className="text-sm text-muted-foreground">None.</TableCell></TableRow>}
                {shown.map((c) => {
                  const e = elig.data?.get(c.caregiver_id);
                  return (
                    <TableRow key={c.caregiver_id} data-caregiver={c.name}>
                      <TableCell className="whitespace-nowrap font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm" data-eligibility>
                        {!nextOpen ? "—" : elig.isLoading ? "Checking…" : !e ? "—" : (
                          <div className="space-y-1">
                            <Badge variant="outline" className={cn(e.autoApprovable ? "border-success/40 bg-success/10" : e.eligible ? "border-warning/40 bg-warning/15" : "border-destructive/40 bg-destructive/10 text-destructive")}>
                              {e.autoApprovable ? "Eligible" : e.eligible ? "Needs approval" : "Blocked"}</Badge>
                            {[...e.blockers, ...e.flags].slice(0, 4).map((i, k) => <div key={k} className="text-xs text-muted-foreground">{i.label}{i.detail ? `: ${i.detail}` : ""}</div>)}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>    </div>
  );
}

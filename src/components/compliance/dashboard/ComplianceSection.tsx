import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, ClipboardList, GraduationCap, ShieldAlert, ShieldCheck, UserRoundCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpiryPill } from "@/components/compliance/ExpiryPill";
import { OfficePicker } from "@/components/compliance/OfficePicker";
import { NotesReviewPanel } from "@/components/compliance/notes/NotesReviewPanel";
import type { RiskRow } from "@/components/compliance/careplan/AuthorizationRiskPanel";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { CARE_PLAN_TIER } from "@/lib/roleHome";
import { serviceName, type Onboarding } from "@/lib/carePlan";
import { parseDateOnly } from "@/lib/dateOnly";
import { cn } from "@/lib/utils";
import {
  credentialRows, distinctCaregivers, pendingOnboarding, reasonList, REASON_LABEL, retrainingRows, TOP,
  type CredRow, type Readiness, type RetrainShiftRow,
} from "@/lib/complianceDashboard";

const day = (d: string) => format(parseDateOnly(d), "EEE, MMM d");
const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as unknown as T;
};

function Panel({ id, title, icon, count, sub, all, children, tone }: { id: string; title: string; icon: ReactNode; count: number | null; sub: string; all?: { to: string; label: string }; children: ReactNode; tone?: "warn" }) {
  return (
    <Card data-testid={`cs-${id}`} className={cn("flex min-w-0 flex-col", tone === "warn" && count ? "border-warning/50" : "")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">{icon}{title}</CardTitle>
          <span className="text-2xl font-bold tabular-nums" data-testid={`cs-count-${id}`}>{count ?? "–"}</span>
        </div>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 pt-0">
        {children}
        {all && <Link to={all.to} className="inline-block text-sm font-medium text-primary hover:underline" data-testid={`cs-all-${id}`}>{all.label} →</Link>}
      </CardContent>
    </Card>
  );
}
const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

/**
 * Dashboard "Care plan compliance" section (Ripple S11) for managers and agency admins with a module office. Brings
 * together onboarding, credentials (G1), units at risk (G2), retraining, notes and billing (S8 / S9 panel, moved here)
 * and enforcement readiness (get_enforcement_readiness). Read-only; names, counts and reasons only; each row links to
 * the record or tab where it is fixed. Renders nothing for anyone else, so other dashboards are unchanged.
 */
export function ComplianceSection() {
  const { moduleOffices } = useComplianceOffices();
  const { profile } = useCurrentProfile();
  const tier = !!profile?.roles.some((r) => CARE_PLAN_TIER.includes(r));
  const [picked, setPicked] = useState<string | null>(null);
  const officeId = tier ? picked ?? moduleOffices[0]?.id ?? null : null;
  const on = !!officeId;

  const names = useQuery({
    queryKey: ["cs-names", officeId], enabled: on, staleTime: 60 * 1000,
    queryFn: async () => {
      const [cl, cg] = await Promise.all([
        supabase.from("clients").select("id, first_name, last_name").eq("virtual_office_id", officeId as string),
        supabase.from("caregivers").select("id, first_name, last_name").eq("virtual_office_id", officeId as string),
      ]);
      const full = (r: { first_name: string | null; last_name: string | null }) => [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";
      return { clients: new Map((cl.data ?? []).map((r) => [r.id, full(r)])), caregivers: new Map((cg.data ?? []).map((r) => [r.id, full(r)])) };
    },
  });
  const onboarding = useQuery({ queryKey: ["cs-onboarding", officeId], enabled: on, retry: false, queryFn: () => rpc<Onboarding[]>("list_clients_onboarding", { _office_id: officeId }) });
  const creds = useQuery({ queryKey: ["cs-creds", officeId], enabled: on, retry: false, queryFn: () => rpc<CredRow[]>("list_credential_expirations", { _office_id: officeId, _within_days: 60 }) });
  const risk = useQuery({ queryKey: ["cs-risk", officeId], enabled: on, retry: false, queryFn: () => rpc<RiskRow[]>("list_authorization_risk", { _office_id: officeId, _within_days: 60 }) });
  const retrain = useQuery({ queryKey: ["cs-retrain", officeId], enabled: on, retry: false, queryFn: () => rpc<RetrainShiftRow[]>("list_caregivers_needing_retraining", { _office_id: officeId }) });
  const ready = useQuery({ queryKey: ["cs-ready", officeId], enabled: on, retry: false, queryFn: () => rpc<Readiness>("get_enforcement_readiness", { _office_id: officeId, _days: 14 }) });

  if (!on) return null;
  const nm = names.data;
  const pending = nm && onboarding.data ? pendingOnboarding(onboarding.data ?? [], nm.clients) : null;
  const cr = creds.data ? credentialRows(creds.data) : null;
  const rt = nm && retrain.data ? retrainingRows(retrain.data, nm.caregivers, nm.clients) : null;
  const rd = ready.data;
  const today = new Date();

  return (
    <section className="space-y-3" data-testid="compliance-section" aria-labelledby="cs-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cs-title" className="text-xl font-semibold">Care plan compliance</h2>
        <OfficePicker offices={moduleOffices} value={officeId} onChange={setPicked} />
      </div>
      <NotesReviewPanel />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel id="onboarding" title="Clients pending onboarding" icon={<UserRoundCheck className="h-4 w-4" aria-hidden="true" />} count={pending?.length ?? null}
          sub="Not all 8 onboarding items are complete." all={{ to: "/care-plans", label: "All care plans" }}>
          {pending?.length === 0 && <Empty>Every client is onboarded.</Empty>}
          <ul className="divide-y">
            {pending?.slice(0, TOP).map((p) => (
              <li key={p.client_id} className="py-2" data-testid="cs-onboarding-row">
                <div className="flex items-center justify-between gap-2">
                  <Link to={p.href} className="font-medium hover:underline">{p.name}</Link>
                  <Badge variant="outline" data-onboarding={`${p.done}/8`}>{p.done} of 8</Badge>
                </div>
                {p.missing.length > 0 && <p className="text-xs text-muted-foreground">Missing: {p.missing.join(", ")}</p>}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="credentials" title="Expiring credentials" icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} count={creds.data?.length ?? null}
          sub="★ Overdue, red ≤ 30 days, yellow ≤ 60 days, and required ones missing." all={{ to: "/caregivers", label: "Caregiver Management" }}>
          {cr && <div className="flex flex-wrap gap-1.5 text-xs" data-testid="cs-cred-bands">
            <Badge variant="destructive">{cr.counts.overdue} overdue</Badge>
            <Badge variant="outline" className="border-destructive/40 text-destructive">{cr.counts.red} ≤ 30 days</Badge>
            <Badge variant="outline" className="border-warning/40">{cr.counts.yellow} ≤ 60 days</Badge>
            <Badge variant="outline">{cr.counts.missing} missing</Badge>
          </div>}
          {cr?.rows.length === 0 && <Empty>Nothing due in the next 60 days.</Empty>}
          <ul className="divide-y">
            {cr?.rows.slice(0, TOP).map((r) => (
              <li key={`${r.caregiver_id}-${r.credential_type_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="cs-credentials-row" data-band={r.band}>
                <Link to={r.href} className="min-w-0 text-sm hover:underline"><span className="font-medium">{r.caregiver_name}</span><span className="text-muted-foreground"> · {r.credential_type}</span></Link>
                {r.band === "missing" ? <Badge variant="destructive">Missing</Badge> : <ExpiryPill expiry={r.expiry_date} today={today} />}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="units" title="Units at risk" icon={<AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />} count={risk.data?.length ?? null}
          sub="Authorizations expiring within 60 days and the units no assigned shift will use." all={{ to: "/care-plans", label: "Client Care Plans" }}>
          {risk.data?.length === 0 && <Empty>No authorization expires in the next 60 days.</Empty>}
          <ul className="divide-y">
            {risk.data?.slice(0, TOP).map((r) => (
              <li key={r.authorization_id} className="py-2" data-testid="cs-units-row" data-band={r.band}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/care-plans/${r.client_id}?tab=ipos`} className="font-medium hover:underline">{r.client_name}</Link>
                  <span className={cn("text-sm", r.units_at_risk > 0 ? "font-medium" : "text-muted-foreground")}>{r.units_at_risk} units at risk</span>
                </div>
                <p className="text-xs text-muted-foreground">{serviceName(r.service_type)} · #{r.auth_number} · {r.days === 0 ? "expires today" : `expires in ${r.days} day${r.days === 1 ? "" : "s"}`}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="retraining" title="Caregivers needing retraining" icon={<GraduationCap className="h-4 w-4" aria-hidden="true" />} count={rt ? distinctCaregivers(rt) : null}
          sub="Assigned to a client whose plan changed since their training." all={{ to: "/training", label: "Client training" }}>
          {rt?.length === 0 && <Empty>No caregiver needs retraining.</Empty>}
          <ul className="divide-y">
            {rt?.slice(0, TOP).map((r) => (
              <li key={`${r.caregiver_id}-${r.client_id}`} className="py-2" data-testid="cs-retraining-row">
                <Link to={r.href} className="font-medium hover:underline">{r.caregiver_name}</Link>
                <p className="text-xs text-muted-foreground">{r.client_name} · training v{r.training_version} · next shift {day(r.next_shift)}{r.shifts > 1 ? ` (+${r.shifts - 1} more)` : ""}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="readiness" title="Enforcement readiness" tone="warn" count={rd?.would_block ?? null}
          icon={rd?.enforcement ? <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" /> : <ClipboardList className="h-4 w-4" aria-hidden="true" />}
          sub={rd ? `${rd.enforcement ? "Enforcement is ON: these shifts' assignments are blocked." : "Enforcement is off: these upcoming shifts would be blocked if it were on."} Next ${rd.days} days, ${rd.shifts_checked} shift${rd.shifts_checked === 1 ? "" : "s"} checked.` : "Upcoming shifts the compliance switch blocks."}
          all={{ to: `/virtual-offices/${officeId}?tab=compliance`, label: "Compliance settings" }}>
          {rd && <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant={rd.enforcement ? "destructive" : "outline"} data-testid="cs-enforcement-state">{rd.enforcement ? "Enforced" : "Advisory"}</Badge>
            {reasonList(rd).map((x) => <Badge key={x.code} variant="outline" data-testid={`cs-reason-${x.code}`} data-n={x.n}>{x.label}: {x.n}</Badge>)}
          </div>}
          {rd && rd.would_block === 0 && <Empty>No upcoming shift would be blocked.</Empty>}
          <ul className="divide-y">
            {rd?.shifts.slice(0, TOP).map((s) => (
              <li key={s.shift_id} className="py-2" data-testid="cs-readiness-row">
                <Link to={`/schedule?client=${s.client_id}`} className="text-sm font-medium hover:underline">
                  {day(s.shift_date)} {s.start_time.slice(0, 5)} · {[s.client_first_name, s.client_last_initial && `${s.client_last_initial}.`].filter(Boolean).join(" ")}
                </Link>
                <p className="text-xs text-muted-foreground">{s.caregiver_name ?? "Unassigned"} · {s.codes.map((c) => REASON_LABEL[c] ?? c).join(", ")}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </section>
  );
}

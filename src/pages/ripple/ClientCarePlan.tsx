import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ClipboardCheck, Pencil } from "lucide-react";
import { ModuleShell } from "@/components/compliance/ModuleShell";
import { ProvenanceBadge } from "@/components/compliance/ProvenanceBadge";
import { CaseNumberDialog } from "@/components/compliance/careplan/CaseNumberDialog";
import { IposTab } from "@/components/compliance/careplan/IposTab";
import { GoalsTab } from "@/components/compliance/careplan/GoalsTab";
import { OnboardingTab } from "@/components/compliance/careplan/OnboardingTab";
import { SchedulingTab } from "@/components/compliance/careplan/SchedulingTab";
import { ClientNotesTab } from "@/components/compliance/notes/ClientNotesTab";
import { useClientHead, useOnboarding, usePlans, useRefreshClient, useShells } from "@/components/compliance/careplan/useCarePlanData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";
import { onboardedCount, type CarePlanTab } from "@/lib/carePlan";

const TABS: CarePlanTab[] = ["ipos", "goals", "notes", "scheduling", "onboarding"];

/** /care-plans/:clientId (S4/S5): one client's plan of service. Ids only in the URL (?tab=). */
export default function ClientCarePlan() {
  const { clientId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as CarePlanTab) ? params.get("tab") : "ipos") as CarePlanTab;
  const { moduleOffices } = useComplianceOffices();
  const client = useClientHead(clientId);
  const officeId = client.data?.virtual_office_id ?? null;
  const office = moduleOffices.find((o) => o.id === officeId) ?? null;
  const inModule = !!office;
  const onboarding = useOnboarding(clientId, inModule);
  const { data: plans = [] } = usePlans(clientId);
  const { data: shells = [] } = useShells();
  const refresh = useRefreshClient(clientId);
  const [caseOpen, setCaseOpen] = useState(false);
  const active = plans.find((p) => p.status === "active") ?? null;
  const shellName = active?.template_id ? shells.find((s) => s.id === active.template_id)?.name : null;
  useEffect(() => { document.title = "Client care plan · CareMuch"; }, []);
  const goTo = (t: CarePlanTab, anchor?: string) => {
    setParams({ tab: t }, { replace: true });
    if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  };
  const denied = !client.isLoading && (!client.data || !inModule || onboarding.isError);
  const name = client.data ? [client.data.first_name, client.data.last_name].filter(Boolean).join(" ") || "Client" : "";

  return (
    <ModuleShell title="Client care plan" description="Plan of service, goals, authorizations and onboarding." icon={ClipboardCheck} slice="S4">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        <Link to="/care-plans" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />All clients</Link>
        {client.isLoading || (inModule && onboarding.isLoading) ? <p className="text-sm text-muted-foreground">Loading…</p> : denied ? (
          <Card data-testid="client-denied"><CardContent className="py-10 text-center text-sm text-muted-foreground">You can't open this client here, or the record wasn't found.</CardContent></Card>
        ) : (
          <>
            <Card data-testid="client-header">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold">{name}</h2>
                  <p className="text-sm text-muted-foreground">{office?.name}</p>
                  <div className="flex items-center gap-1 text-sm" data-testid="case-number">
                    <span className="text-muted-foreground">Case #</span>
                    <span className="font-medium">{client.data?.case_number ?? "not set"}</span>
                    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit case number" onClick={() => setCaseOpen(true)}><Pencil className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {active && shellName && active.template_version ? <ProvenanceBadge shellName={shellName} version={active.template_version} /> : null}
                  <Badge variant={active ? "default" : "secondary"} data-plan-status={active ? "active" : "none"}>{active ? `Plan v${active.version} active` : plans.length ? "No active plan" : "No plan yet"}</Badge>
                  {onboarding.data && (onboarding.data.onboarded
                    ? <Badge variant="outline" className="border-success/40 bg-success/10">Onboarded</Badge>
                    : <Badge variant="outline">Onboarding {onboardedCount(onboarding.data)} of 8</Badge>)}
                </div>
              </CardContent>
            </Card>
            <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
              <div className="overflow-x-auto">
                <TabsList>
                  <TabsTrigger value="ipos">IPOS</TabsTrigger>
                  <TabsTrigger value="goals">Goals</TabsTrigger>
                  <TabsTrigger value="notes">Progress Notes</TabsTrigger>
                  <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
                  <TabsTrigger value="onboarding">Onboarding &amp; Documents</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="ipos" className="mt-4"><IposTab clientId={clientId} officeId={officeId} caseNumber={client.data?.case_number ?? null} onChanged={refresh} /></TabsContent>
              <TabsContent value="goals" className="mt-4"><GoalsTab clientId={clientId} officeId={officeId} plan={active} onChanged={refresh} /></TabsContent>
              <TabsContent value="notes" className="mt-4"><ClientNotesTab clientId={clientId} officeId={officeId} /></TabsContent>
              <TabsContent value="scheduling" className="mt-4"><SchedulingTab clientId={clientId} officeId={officeId} /></TabsContent>
              <TabsContent value="onboarding" className="mt-4">
                <OnboardingTab clientId={clientId} onboarding={onboarding.data} trainingVersion={active?.training_version ?? null} goTo={goTo} onChanged={refresh} />
              </TabsContent>
            </Tabs>
            <CaseNumberDialog clientId={clientId} current={client.data?.case_number ?? null} open={caseOpen} onOpenChange={setCaseOpen} onSaved={refresh} />
          </>
        )}
      </div>
    </ModuleShell>
  );
}

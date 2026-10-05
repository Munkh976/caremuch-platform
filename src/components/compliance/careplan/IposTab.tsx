import { useState } from "react";
import { format } from "date-fns";
import { ArrowUpCircle, History, Pencil, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ExpiryPill } from "@/components/compliance/ExpiryPill";
import { parseDateOnly } from "@/lib/dateOnly";
import { humanize, type TemplateField } from "@/lib/formTemplates";
import { fieldDisplay, HEADER_LABEL, isDateHeader, PLAN_HEADER_COLUMNS, resolveShell, ROW_SECTIONS, type RowSection } from "@/lib/carePlan";
import { AuthorizationsSection } from "./AuthorizationsSection";
import { PlanFormDialog, RenewDialog, UpgradeDialog } from "./PlanForm";
import { RowsDialog } from "./RowsEditor";
import { usePlanRows, usePlans, useShells, type PlanRowFull } from "./useCarePlanData";

const fmt = (s: string | null) => (s ? format(parseDateOnly(s), "MMM d, yyyy") : "—");

function HeaderSummary({ plan }: { plan: PlanRowFull }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {PLAN_HEADER_COLUMNS.filter((c) => plan[c]).map((c) => (
        <div key={c} className={c === "discharge_criteria" ? "sm:col-span-2 lg:col-span-3" : ""}>
          <dt className="text-xs text-muted-foreground">{HEADER_LABEL[c]}</dt>
          <dd className="whitespace-pre-wrap">{isDateHeader(c) ? fmt(plan[c] as string) : (plan[c] as string)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ValuesSummary({ plan }: { plan: PlanRowFull }) {
  const fields = (plan.field_snapshot?.fields ?? []).filter((f: TemplateField) => f.storage === "field_value");
  if (!fields.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {fields.map((f) => <div key={f.field_key}><dt className="text-xs text-muted-foreground">{f.label}</dt><dd className="whitespace-pre-wrap">{fieldDisplay(f, plan.field_values?.[f.field_key])}</dd></div>)}
    </dl>
  );
}

function RowsCard({ clientId, plan, section, editable, onSaved }: { clientId: string; plan: PlanRowFull; section: RowSection; editable: boolean; onSaved: () => void }) {
  const { data: rows = [] } = usePlanRows(clientId, plan.id, section.table);
  const [open, setOpen] = useState(false);
  const shown = section.cols.slice(0, 3);
  return (
    <div className="rounded-md border p-3" data-section={section.entity}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{section.title} <span className="font-normal text-muted-foreground">· {rows.length}</span></h4>
        {editable && <Button size="sm" variant="ghost" className="gap-1" onClick={() => setOpen(true)}><Pencil className="h-3 w-3" />Edit</Button>}
      </div>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
        <ul className="space-y-1 text-sm">
          {rows.map((r, i) => <li key={(r.id as string) ?? i} className="truncate">{shown.map((c) => (typeof r[c.key] === "boolean" ? (r[c.key] ? c.label : "") : (r[c.key] as string) ?? "")).filter(Boolean).join(" · ") || "—"}</li>)}
        </ul>
      )}
      {open && <RowsDialog open={open} onOpenChange={setOpen} planId={plan.id} section={section} rows={rows} onSaved={onSaved} />}
    </div>
  );
}

/** IPOS tab (S4): create / renew / edit / upgrade, version history, child rows, authorizations. */
export function IposTab({ clientId, officeId, onChanged }: { clientId: string; officeId: string | null; onChanged: () => void }) {
  const { data: plans = [], isLoading } = usePlans(clientId);
  const { data: shells = [] } = useShells();
  const [dialog, setDialog] = useState<"create" | "edit" | "renew" | "upgrade" | null>(null);
  const [viewing, setViewing] = useState<PlanRowFull | null>(null);
  const active = plans.find((p) => p.status === "active") ?? null;
  const resolved = resolveShell(shells, "ipos", officeId);
  const planShell = active?.template_id ? shells.find((s) => s.id === active.template_id) ?? null : null;
  const canUpgrade = !!active && !!planShell && planShell.current_version !== null && planShell.current_version !== active.template_version;
  const declared = new Set((active?.field_snapshot?.fields ?? []).filter((f) => f.storage === "child_rows").map((f) => f.writes_to_entity));
  const sections = ROW_SECTIONS.filter((s) => s.entity !== "care_plan_external_service" && (!active?.field_snapshot || declared.has(s.entity)));
  const extEditable = !active?.field_snapshot || declared.has("care_plan_external_service");

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      {!active ? (
        <Card data-testid="no-plan">
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <p className="font-medium">No active plan of service.</p>
            <p className="text-sm text-muted-foreground">{resolved ? `New plans use ${resolved.name} v${resolved.current_version}.` : "No IPOS shell is published for this office; the plan uses the standard fields."}</p>
            <Button className="gap-1" onClick={() => setDialog("create")}><Plus className="h-4 w-4" />Create plan</Button>
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="active-plan">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">{humanize(active.plan_type)} plan · v{active.version}</CardTitle>
              <p className="text-sm text-muted-foreground">Training version {active.training_version} · {fmt(active.effective_date)} – {fmt(active.expiration_date)}</p>
              {active.expiration_date && <ExpiryPill expiry={active.expiration_date} />}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setDialog("edit")}><Pencil className="h-4 w-4" />Edit header and narrative</Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setDialog("renew")}><RefreshCw className="h-4 w-4" />Renew</Button>
              {canUpgrade && <Button size="sm" variant="outline" className="gap-1" onClick={() => setDialog("upgrade")}><ArrowUpCircle className="h-4 w-4" />Upgrade to template v{planShell?.current_version}</Button>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <HeaderSummary plan={active} />
            <ValuesSummary plan={active} />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {sections.map((s) => <RowsCard key={s.entity} clientId={clientId} plan={active} section={s} editable onSaved={onChanged} />)}
              {extEditable && <RowsCard clientId={clientId} plan={active} section={ROW_SECTIONS.find((s) => s.entity === "care_plan_external_service")!} editable onSaved={onChanged} />}
            </div>
          </CardContent>
        </Card>
      )}

      <AuthorizationsSection clientId={clientId} officeId={officeId} planId={active?.id ?? null} canWrite onChanged={onChanged} />

      {plans.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" aria-hidden="true" />Version history</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y" data-testid="plan-history">
              {plans.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-plan-version={p.version}>
                  <span><span className="font-medium">v{p.version}</span> · {humanize(p.plan_type)} · {fmt(p.effective_date)} – {fmt(p.expiration_date)} · training v{p.training_version}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={p.status === "active" ? "default" : "secondary"}>{humanize(p.status)}</Badge>
                    {p.status !== "active" && <Button size="sm" variant="ghost" onClick={() => setViewing(p)}>View (read-only)</Button>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {dialog === "create" && <PlanFormDialog open onOpenChange={(o) => !o && setDialog(null)} mode="create" clientId={clientId} shell={resolved} onSaved={onChanged} />}
      {dialog === "edit" && active && <PlanFormDialog open onOpenChange={(o) => !o && setDialog(null)} mode="edit" clientId={clientId} shell={null} plan={active} onSaved={onChanged} />}
      {dialog === "renew" && active && <RenewDialog open onOpenChange={(o) => !o && setDialog(null)} plan={active} onSaved={onChanged} />}
      {dialog === "upgrade" && active && planShell && <UpgradeDialog open onOpenChange={(o) => !o && setDialog(null)} plan={active} shell={planShell} onSaved={onChanged} />}
      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>Plan v{viewing?.version} (read-only)</SheetTitle><SheetDescription>{viewing ? `${humanize(viewing.status)} · training v${viewing.training_version}` : ""}</SheetDescription></SheetHeader>
          {viewing && <div className="mt-4 space-y-4"><HeaderSummary plan={viewing} /><ValuesSummary plan={viewing} /></div>}
        </SheetContent>
      </Sheet>
    </div>
  );
}

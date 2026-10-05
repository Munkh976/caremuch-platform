import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Ban, ChevronDown, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UnitsBar } from "@/components/compliance/UnitsBar";
import { ExpiryPill } from "@/components/compliance/ExpiryPill";
import { parseDateOnly } from "@/lib/dateOnly";
import { serviceName, type PlanRow } from "@/lib/carePlan";
import { rpcErrorText } from "@/lib/rpcError";
import { useAuthorizations, useOfficeServices, usePlanRows, type AuthorizationRow } from "./useCarePlanData";

type Period = NonNullable<AuthorizationRow["period_type"]>;
const PERIODS: [Period, string][] = [["per_week", "Per week"], ["per_month", "Per month"], ["per_quarter", "Per quarter"], ["per_day", "Per day"], ["per_auth", "Whole authorization"]];
const periodWord = (p: Period | null) => (p ? p.replace("per_", "") : "");
const d = (s: string) => format(parseDateOnly(s), "MMM d, yyyy");

interface AuthForm { service_type: string; auth_number: string; units_authorized: string; effective_date: string; expiration_date: string; unit_minutes: string;
  period_type: Period | "none"; units_per_period: string; units_used_before_caremuch: string }
const blank: AuthForm = { service_type: "", auth_number: "", units_authorized: "", effective_date: "", expiration_date: "", unit_minutes: "15", period_type: "none", units_per_period: "", units_used_before_caremuch: "0" };

function AuthFields({ f, set, services, creating }: { f: AuthForm; set: (f: AuthForm) => void; services: string[]; creating: boolean }) {
  const inp = (k: keyof AuthForm, label: string, type = "text") => (
    <div className="space-y-1"><Label htmlFor={`auth-${k}`}>{label}</Label><Input id={`auth-${k}`} type={type} inputMode={type === "number" ? "decimal" : undefined} value={f[k]} onChange={(e) => set({ ...f, [k]: e.target.value })} /></div>);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {creating && (
        <div className="space-y-1"><Label htmlFor="auth-service">Service</Label>
          <Select value={f.service_type || undefined} onValueChange={(v) => set({ ...f, service_type: v })}>
            <SelectTrigger id="auth-service"><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>{services.map((s) => <SelectItem key={s} value={s}>{serviceName(s)}</SelectItem>)}</SelectContent>
          </Select></div>)}
      {inp("auth_number", "Authorization #")}
      {inp("units_authorized", "Units authorized", "number")}
      {creating && inp("unit_minutes", "Minutes per unit", "number")}
      {inp("effective_date", "Effective", "date")}
      {inp("expiration_date", "Expires", "date")}
      <div className="space-y-1"><Label htmlFor="auth-period">Period cap</Label>
        <Select value={f.period_type} onValueChange={(v) => set({ ...f, period_type: v as AuthForm["period_type"] })}>
          <SelectTrigger id="auth-period"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">No cap</SelectItem>{PERIODS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select></div>
      {f.period_type !== "none" && inp("units_per_period", "Units per period", "number")}
      <div className="sm:col-span-2">{inp("units_used_before_caremuch", "Units used before CareMuch (opening balance)", "number")}</div>
    </div>
  );
}

/** Authorizations of the client (arch §9.2): units table with UnitsBar, create, W2 correct; other providers' lines as reference. */
export function AuthorizationsSection({ clientId, officeId, planId, canWrite, onChanged }: { clientId: string; officeId: string | null; planId: string | null; canWrite: boolean; onChanged: () => void }) {
  const { data, isLoading, isError } = useAuthorizations(clientId);
  const { data: services = [] } = useOfficeServices(officeId);
  const ext = usePlanRows(clientId, planId, "care_plan_external_services");
  const [creating, setCreating] = useState(false);
  const [correcting, setCorrecting] = useState<AuthorizationRow | null>(null);
  const [voiding, setVoiding] = useState<AuthorizationRow | null>(null);
  const rows = data?.authorizations ?? [];
  return (
    <Card id="authorizations" data-testid="authorizations">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">Authorizations</CardTitle>
        {canWrite && <Button size="sm" className="gap-1" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Add authorization</Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="hidden overflow-x-auto rounded-md border sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead><TableHead>Auth #</TableHead><TableHead>Dates</TableHead><TableHead className="text-right">Authorized</TableHead>
                <TableHead className="text-right">Used</TableHead><TableHead className="text-right">Pending</TableHead><TableHead className="text-right">Left</TableHead>
                <TableHead>Period cap</TableHead><TableHead className="min-w-[200px]">Units</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={10} className="text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
              {isError && <TableRow><TableCell colSpan={10} className="text-sm text-muted-foreground">Not available.</TableCell></TableRow>}
              {!isLoading && !isError && rows.length === 0 && <TableRow><TableCell colSpan={10} className="text-sm text-muted-foreground">No authorization yet.</TableCell></TableRow>}
              {rows.map((a) => (
                <TableRow key={a.id} data-auth={a.auth_number}>
                  <TableCell className="whitespace-nowrap font-medium">{serviceName(a.service_type)}</TableCell>
                  <TableCell className="whitespace-nowrap">{a.auth_number}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    <div>{d(a.effective_date)} – {d(a.expiration_date)}</div>
                    {a.status === "active" ? <ExpiryPill expiry={a.expiration_date} className="mt-1" /> : <Badge variant="outline" className="mt-1">{a.status === "expired" ? "Expired" : "Not started"}</Badge>}
                  </TableCell>
                  <TableCell className="text-right">{a.units_authorized}</TableCell>
                  <TableCell className="text-right" title={a.units_used_before_caremuch ? `${a.units_charged} charged + ${a.units_used_before_caremuch} before CareMuch` : undefined}>{a.units_used}</TableCell>
                  <TableCell className="text-right">{a.units_pending}</TableCell>
                  <TableCell className="text-right font-medium">{a.units_left}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{a.period_type && a.units_per_period ? `${a.units_per_period} / ${periodWord(a.period_type)}` : "—"}</TableCell>
                  <TableCell>
                    <UnitsBar authorized={a.units_authorized} used={a.units_used} pending={a.units_pending} unitMinutes={a.unit_minutes}
                      periodCap={a.period_type && a.units_per_period && a.period_left !== null ? { period: periodWord(a.period_type), cap: a.units_per_period, usedInPeriod: a.units_per_period - a.period_left } : null} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">{canWrite && <AuthActions a={a} onCorrect={() => setCorrecting(a)} onVoid={() => setVoiding(a)} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {/* below sm: one stacked card per authorization instead of a sideways-scrolling table */}
        <ul className="space-y-3 sm:hidden" data-testid="authorization-cards">
          {isLoading && <li className="text-sm text-muted-foreground">Loading…</li>}
          {!isLoading && !isError && rows.length === 0 && <li className="text-sm text-muted-foreground">No authorization yet.</li>}
          {rows.map((a) => (
            <li key={a.id} className="space-y-3 rounded-md border p-3" data-auth-card={a.auth_number}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{serviceName(a.service_type)}</span>
                <span className="text-sm text-muted-foreground">#{a.auth_number}</span>
                {a.status === "active" ? <ExpiryPill expiry={a.expiration_date} /> : <Badge variant="outline">{a.status === "expired" ? "Expired" : "Not started"}</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">{d(a.effective_date)} – {d(a.expiration_date)}</div>
              <dl className="grid grid-cols-4 gap-2 text-center text-sm">
                {([["Authorized", a.units_authorized], ["Used", a.units_used], ["Pending", a.units_pending], ["Left", a.units_left]] as const).map(([l, v]) => (
                  <div key={l} className="rounded bg-muted/50 py-1"><dt className="text-[11px] text-muted-foreground">{l}</dt><dd className={l === "Left" ? "font-semibold" : ""}>{v}</dd></div>))}
              </dl>
              {a.period_type && a.units_per_period ? <div className="text-xs text-muted-foreground">Period cap: {a.units_per_period} / {periodWord(a.period_type)}</div> : null}
              <UnitsBar authorized={a.units_authorized} used={a.units_used} pending={a.units_pending} unitMinutes={a.unit_minutes}
                periodCap={a.period_type && a.units_per_period && a.period_left !== null ? { period: periodWord(a.period_type), cap: a.units_per_period, usedInPeriod: a.units_per_period - a.period_left } : null} />
              {canWrite && <div className="flex justify-end"><AuthActions a={a} withLabels onCorrect={() => setCorrecting(a)} onVoid={() => setVoiding(a)} /></div>}
            </li>
          ))}
        </ul>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 px-0 text-muted-foreground" data-testid="external-toggle">
              <ChevronDown className="h-4 w-4" />Other providers' lines (reference only) · {ext.data?.length ?? 0}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ExternalList rows={ext.data ?? []} />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
      {creating && <CreateAuthDialog open={creating} onOpenChange={setCreating} clientId={clientId} services={services} onSaved={onChanged} />}
      {correcting && <CorrectAuthDialog row={correcting} onOpenChange={(o) => !o && setCorrecting(null)} onSaved={onChanged} />}
      {voiding && <VoidAuthDialog row={voiding} onOpenChange={(o) => !o && setVoiding(null)} onSaved={onChanged} />}
    </Card>
  );
}

function ExternalList({ rows }: { rows: PlanRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">None recorded on the plan.</p>;
  return (
    <ul className="divide-y rounded-md border text-sm" data-testid="external-services">
      {rows.map((r, i) => (
        <li key={(r.id as string) ?? i} className="p-2">
          <span className="font-medium">{(r.provider_program as string) || "Provider"}</span> · {(r.service as string) || "service"}
          {r.units_text ? ` · ${r.units_text}` : ""}{r.auth_reference ? ` · ref ${r.auth_reference}` : ""}
          {r.effective_date || r.expiration_date ? <span className="text-muted-foreground"> · {(r.effective_date as string) ?? "?"} – {(r.expiration_date as string) ?? "?"}</span> : null}
        </li>
      ))}
    </ul>
  );
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));

function CreateAuthDialog({ open, onOpenChange, clientId, services, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; clientId: string; services: string[]; onSaved: () => void }) {
  const [f, setF] = useState<AuthForm>(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ ...blank, service_type: services.length === 1 ? services[0] : "" }); }, [open, services]);
  const save = async () => {
    if (!f.service_type || !f.auth_number.trim() || !f.units_authorized || !f.effective_date || !f.expiration_date) { toast.error("Service, number, units and both dates are required"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("create_service_authorization", {
      _client_id: clientId, _service_type: f.service_type, _auth_number: f.auth_number.trim(), _units_authorized: Number(f.units_authorized),
      _effective_date: f.effective_date, _expiration_date: f.expiration_date, _unit_minutes: Number(f.unit_minutes || 15),
      _period_type: f.period_type === "none" ? undefined : f.period_type, _units_per_period: f.period_type === "none" ? undefined : num(f.units_per_period) ?? undefined,
      _units_used_before_caremuch: Number(f.units_used_before_caremuch || 0),
    });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success("Authorization added"); onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader><DialogTitle>Add authorization</DialogTitle><DialogDescription>Units only. The opening balance is what was already used before CareMuch.</DialogDescription></DialogHeader>
        <AuthFields f={f} set={setF} services={services} creating />
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={busy}>Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** W2: correct an authorization (reason required; the server refuses what would contradict charged units). Never deletes. */
function CorrectAuthDialog({ row, onOpenChange, onSaved }: { row: AuthorizationRow; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const initial: AuthForm = { service_type: row.service_type, auth_number: row.auth_number, units_authorized: String(row.units_authorized), effective_date: row.effective_date,
    expiration_date: row.expiration_date, unit_minutes: String(row.unit_minutes), period_type: row.period_type ?? "none", units_per_period: row.units_per_period === null ? "" : String(row.units_per_period),
    units_used_before_caremuch: String(row.units_used_before_caremuch) };
  const [f, setF] = useState<AuthForm>(initial);
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const changes: Record<string, unknown> = {};
    if (f.auth_number.trim() !== row.auth_number) changes.auth_number = f.auth_number.trim();
    if (f.effective_date !== row.effective_date) changes.effective_date = f.effective_date;
    if (f.expiration_date !== row.expiration_date) changes.expiration_date = f.expiration_date;
    if (num(f.units_authorized) !== row.units_authorized) changes.units_authorized = num(f.units_authorized);
    if (num(f.units_used_before_caremuch) !== row.units_used_before_caremuch) changes.units_used_before_caremuch = num(f.units_used_before_caremuch) ?? 0;
    const per = f.period_type === "none" ? null : f.period_type, cap = f.period_type === "none" ? null : num(f.units_per_period);
    if (per !== row.period_type) changes.period_type = per;
    if (cap !== row.units_per_period) changes.units_per_period = cap;
    if (!Object.keys(changes).length) { setRefusal("Nothing to change"); return; }
    if (!reason.trim()) { setRefusal("A reason is required"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("correct_service_authorization", { _id: row.id, _changes: changes as Json, _reason: reason.trim() });
    setBusy(false);
    if (error) { setRefusal(rpcErrorText(error)); return; }
    toast.success("Authorization corrected"); onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-[560px]" data-testid="correct-dialog">
        <DialogHeader><DialogTitle>Correct authorization #{row.auth_number}</DialogTitle>
          <DialogDescription>{serviceName(row.service_type)} · {row.units_charged} units charged so far{row.reviewed_from ? `; reviewed visits ${d(row.reviewed_from)} – ${d(row.reviewed_to as string)}` : ""}. Authorizations are never deleted.</DialogDescription></DialogHeader>
        <AuthFields f={f} set={(x) => { setF(x); setRefusal(null); }} services={[]} creating={false} />
        <div className="space-y-1"><Label htmlFor="auth-reason">Reason for the correction *</Label><Textarea id="auth-reason" rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setRefusal(null); }} /></div>
        {refusal && <Alert variant="destructive" data-testid="correct-error"><AlertDescription>{refusal}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={busy}>Save correction</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuthActions({ a, withLabels, onCorrect, onVoid }: { a: AuthorizationRow; withLabels?: boolean; onCorrect: () => void; onVoid: () => void }) {
  return (
    <span className="inline-flex gap-1">
      <Button size={withLabels ? "sm" : "icon"} variant="ghost" className="gap-1" aria-label={`Correct ${a.auth_number}`} onClick={onCorrect}><Pencil className="h-4 w-4" />{withLabels && "Correct"}</Button>
      {a.void_available && <Button size={withLabels ? "sm" : "icon"} variant="ghost" className="gap-1 text-destructive" aria-label={`Void ${a.auth_number}`} onClick={onVoid}><Ban className="h-4 w-4" />{withLabels && "Void"}</Button>}
    </span>
  );
}

/** W2: void an authorization nothing was ever charged to or allocated from (reason required, audited). It stays on record. */
function VoidAuthDialog({ row, onOpenChange, onSaved }: { row: AuthorizationRow; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!reason.trim()) { setRefusal("A reason is required"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("void_service_authorization", { _id: row.id, _reason: reason.trim() });
    setBusy(false);
    if (error) { setRefusal(rpcErrorText(error)); return; }
    toast.success("Authorization voided"); onSaved(); onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[480px]" data-testid="void-dialog">
        <DialogHeader><DialogTitle>Void authorization #{row.auth_number}</DialogTitle>
          <DialogDescription>Only for an authorization entered by mistake: nothing has been charged to it or scheduled against it. It stays on record as voided and stops counting everywhere; its number can be entered again.</DialogDescription></DialogHeader>
        <div className="space-y-1"><Label htmlFor="void-reason">Reason *</Label><Textarea id="void-reason" rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setRefusal(null); }} /></div>
        {refusal && <Alert variant="destructive" data-testid="void-error"><AlertDescription>{refusal}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="destructive" onClick={save} disabled={busy}>Void</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

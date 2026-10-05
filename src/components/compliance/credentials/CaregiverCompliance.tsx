import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format } from "date-fns";
import { History, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExpiryPill } from "@/components/compliance/ExpiryPill";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { parseDateOnly } from "@/lib/dateOnly";
import { rpcErrorText } from "@/lib/rpcError";

interface HistoryEntry { changed_at: string; changed_by: string | null; override: boolean; previous_writer: string | null; previous_effective_date: string | null; previous_expiry_date: string | null }
interface CredentialRow {
  credential_type_id: string; name: string; category: string; required: boolean; valid_months: number | null;
  certification_id: string | null; effective_date: string | null; expiry_date: string | null; certification_number: string | null;
  entered_by: string | null; entered_by_manager: boolean; overridden_by: string | null; overridden_at: string | null;
  locked_for_hr: boolean; history: HistoryEntry[];
}
interface TrainingRow { client_id: string; client_name: string; current_version: number | null; trained_version: number | null; last_training_date: string | null; needs_retraining: boolean }
interface Compliance { caregiver_id: string; as_of: string; credentials: CredentialRow[]; training: TrainingRow[] }

const CATEGORY_LABEL: Record<string, string> = {
  background_check: "Background checks",
  annual_online: "Annual (online)",
  annual: "Annual",
  in_person_recert: "In-person recertification",
};
const CATEGORY_ORDER = ["background_check", "annual_online", "annual", "in_person_recert"];
const day = (d: string | null) => (d ? format(parseDateOnly(d), "MMM d, yyyy") : "—");

/** "Credentials & Training" for one caregiver (training tier: manager, agency_admin, hr_staff). */
export function CaregiverCompliance({ caregiverId }: { caregiverId: string }) {
  const { profile } = useCurrentProfile();
  const isManager = profile?.roles.some((r) => r === "manager" || r === "agency_admin") ?? false;
  const [entering, setEntering] = useState<CredentialRow | null>(null);
  const [history, setHistory] = useState<CredentialRow | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["caregiver-compliance", caregiverId],
    queryFn: async (): Promise<Compliance> => {
      const { data, error } = await supabase.rpc("get_caregiver_compliance", { _caregiver_id: caregiverId });
      if (error) throw error;
      return data as unknown as Compliance;
    },
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading credentials…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{rpcErrorText(error as { code?: string; message?: string })}</p>;

  const groups = CATEGORY_ORDER.map((c) => ({ c, rows: data.credentials.filter((r) => r.category === c) })).filter((g) => g.rows.length);
  return (
    <div className="space-y-5" data-testid="credentials-tab">
      {groups.map(({ c, rows }) => (
        <div key={c} className="space-y-2">
          <p className="text-sm font-semibold">{CATEGORY_LABEL[c] ?? c}</p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Credential</TableHead><TableHead>Status</TableHead><TableHead>Effective</TableHead><TableHead>Expires</TableHead><TableHead>Entered by</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const hrLocked = !isManager && r.locked_for_hr;
                  return (
                    <TableRow key={r.credential_type_id} data-credential={r.name}>
                      <TableCell className="font-medium">{r.name}{r.required && <span className="ml-1 text-xs text-muted-foreground">(required)</span>}</TableCell>
                      <TableCell>{r.certification_id ? <ExpiryPill expiry={r.expiry_date} today={parseDateOnly(data.as_of)} /> : (
                        r.required ? <Badge variant="destructive" data-band="missing">Missing</Badge> : <span className="text-xs text-muted-foreground">Not on file</span>)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{day(r.effective_date)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{day(r.expiry_date)}</TableCell>
                      <TableCell className="text-sm">
                        {r.entered_by ?? "—"}
                        {r.overridden_by && <div className="mt-1"><Badge variant="outline" className="gap-1 border-warning/50"><ShieldAlert className="h-3 w-3" aria-hidden="true" />Override: {r.overridden_by}</Badge></div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {r.history.length > 0 && <Button size="icon" variant="ghost" aria-label={`History of ${r.name}`} onClick={() => setHistory(r)}><History className="h-4 w-4" /></Button>}
                        <Button size="sm" variant="outline" disabled={hrLocked} title={hrLocked ? "A manager entered or overrode this credential; only a manager can change it" : undefined}
                          onClick={() => setEntering(r)}>{r.certification_id ? "Renew" : "Enter"}</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}

      <div className="space-y-2">
        <p className="text-sm font-semibold">Training for clients</p>
        {data.training.length === 0 ? <p className="text-sm text-muted-foreground">No plan training recorded yet.</p> : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Trained on</TableHead><TableHead>Current plan</TableHead><TableHead>Last training</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {data.training.map((t) => (
                  <TableRow key={t.client_id}>
                    <TableCell className="font-medium">{t.client_name}</TableCell>
                    <TableCell>{t.trained_version ? `v${t.trained_version}` : "—"}</TableCell>
                    <TableCell>{t.current_version ? `v${t.current_version}` : "No active plan"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{day(t.last_training_date)}</TableCell>
                    <TableCell>{t.needs_retraining ? <Badge variant="destructive">Needs retraining</Badge> : <Badge variant="secondary">Trained</Badge>}</TableCell>
                    <TableCell className="text-right"><Link to={`/training/${t.client_id}`} className="whitespace-nowrap text-sm font-medium text-primary hover:underline" data-testid="record-training-link">Record training →</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {entering && <CredentialDialog caregiverId={caregiverId} row={entering} isManager={isManager} onClose={() => setEntering(null)} />}
      <Sheet open={!!history} onOpenChange={(o) => { if (!o) setHistory(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {history && (
            <>
              <SheetHeader><SheetTitle>{history.name}: change history</SheetTitle><SheetDescription>Earlier values, newest first.</SheetDescription></SheetHeader>
              <ul className="mt-4 space-y-3">
                {history.history.map((h, i) => (
                  <li key={i} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{format(new Date(h.changed_at), "MMM d, yyyy h:mm a")}</span>
                      {h.override && <Badge variant="outline" className="border-warning/50">Manager override</Badge>}
                    </div>
                    <p className="text-muted-foreground">By {h.changed_by ?? "—"}; previously entered by {h.previous_writer ?? "—"}</p>
                    <p className="text-muted-foreground">Before: effective {day(h.previous_effective_date)}, expires {day(h.previous_expiry_date)}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CredentialDialog({ caregiverId, row, isManager, onClose }: { caregiverId: string; row: CredentialRow; isManager: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const todayIso = format(new Date(), "yyyy-MM-dd");
  const [effective, setEffective] = useState(todayIso);
  const [expiry, setExpiry] = useState(row.valid_months ? format(addMonths(parseDateOnly(todayIso), row.valid_months), "yyyy-MM-dd") : "");
  const [number, setNumber] = useState(row.certification_number ?? "");
  const [busy, setBusy] = useState(false);
  const overriding = isManager && !!row.certification_id && !row.entered_by_manager && !row.overridden_by;
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("enter_caregiver_credential", {
      _caregiver_id: caregiverId, _credential_type_id: row.credential_type_id, _effective_date: effective || null, _expiry_date: expiry, _certification_number: number || null,
    });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success(overriding ? "Saved as a manager override" : row.certification_id ? "Renewed" : "Entered");
    await qc.invalidateQueries({ queryKey: ["caregiver-compliance", caregiverId] });
    await qc.invalidateQueries({ queryKey: ["credential-expirations"] });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>{row.certification_id ? "Renew" : "Enter"} {row.name}</DialogTitle>
          <DialogDescription>{CATEGORY_LABEL[row.category] ?? row.category}{row.valid_months ? ` · valid ${row.valid_months} months` : ""}</DialogDescription>
        </DialogHeader>
        {overriding && (
          <Alert className="border-warning/50" data-testid="override-warning">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>This is a <strong>manager override</strong> of {row.entered_by ?? "HR"}'s entry. After it, HR can no longer change this credential.</AlertDescription>
          </Alert>
        )}
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="cred-eff">Effective date</Label><Input id="cred-eff" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="cred-exp">Expiry date</Label><Input id="cred-exp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="cred-num">Certificate number (optional)</Label><Input id="cred-num" value={number} maxLength={64} onChange={(e) => setNumber(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !expiry}>{overriding ? "Save override" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

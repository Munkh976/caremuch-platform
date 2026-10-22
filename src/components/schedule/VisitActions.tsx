import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { fmtDay } from "@/lib/caregiverNotes";
import { ACTION_TEXT, actionRequest, canUseVisitActions, formProblem, REASONS, type Preview, type ReasonCode, type VisitAction } from "@/lib/visitActions";

export interface VisitActionShift { id: string; status?: string | null; caregiver_id?: string | null; group_session_id?: string | null }

/**
 * The visit action menu (owner, Oct 22, B) on every row with a caregiver: Unassign caregiver / Cancel visit / Client
 * no-show. Shown to manager, scheduler and agency admin only; the server checks scope, timing and notes.
 */
export function VisitActionsMenu({ shift, onDone, size = "icon" }: { shift: VisitActionShift; onDone?: () => void; size?: "icon" | "sm" }) {
  const { profile } = useCurrentProfile();
  const [action, setAction] = useState<VisitAction | null>(null);
  if (!canUseVisitActions(profile?.roles) || ["cancelled", "completed"].includes(String(shift.status ?? ""))) return null;
  const hasCaregiver = !!shift.caregiver_id;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={size === "icon" ? "icon" : "sm"} className="h-8 hover:bg-muted hover:text-foreground" aria-label="Visit actions"
            data-testid="visit-actions" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="h-4 w-4" />{size === "sm" && <span className="ml-1">More</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem disabled={!hasCaregiver} onSelect={() => setAction("unassign")} data-testid="visit-action-unassign">{ACTION_TEXT.unassign.label}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAction("cancel")} data-testid="visit-action-cancel">{ACTION_TEXT.cancel.label}</DropdownMenuItem>
          <DropdownMenuItem disabled={!hasCaregiver} onSelect={() => setAction("no_show")} data-testid="visit-action-no_show">{ACTION_TEXT.no_show.label}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {action && <VisitActionDialog shift={shift} action={action} onClose={() => setAction(null)} onDone={onDone} />}
    </>
  );
}

function VisitActionDialog({ shift, action, onClose, onDone }: { shift: VisitActionShift; action: VisitAction; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const t = ACTION_TEXT[action];
  const grouped = !!shift.group_session_id;
  const [reason, setReason] = useState<ReasonCode | "">("");
  const [text, setText] = useState("");
  const [requestedBy, setRequestedBy] = useState<"client" | "agency" | "">("");
  const [scope, setScope] = useState<"this" | "following" | "group">("this");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const following = scope === "following", wholeGroup = scope === "group";

  useEffect(() => {
    let live = true;
    setPreview(null);
    supabase.rpc("preview_visit_action", { _shift_id: shift.id, _action: action, _following: following, _whole_group: wholeGroup })
      .then(({ data, error: e }) => { if (!live) return; if (e) setError(e.code === "22023" ? e.message : "The visits couldn't be loaded."); else { setError(null); setPreview(data as unknown as Preview); } });
    return () => { live = false; };
  }, [shift.id, action, following, wholeGroup]);

  const blocked = (preview?.visits ?? []).filter((v) => v.blocker);
  const problem = formProblem(action, { reason, text, requestedBy });
  const run = async () => {
    const { fn, args } = actionRequest(action, shift.id, { reason, text, requestedBy, following, wholeGroup });
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.rpc(fn as never, args as never);
    setBusy(false);
    if (e) { setError(e.code === "22023" ? e.message.replace(/^Not possible: /, "") : "That didn't work. Please try again."); return; }
    const n = (data as unknown as { visits: number } | null)?.visits ?? 1;
    toast.success(`${t.done}${n > 1 ? ` (${n} visits)` : ""}`);
    await qc.invalidateQueries(); onDone?.(); onClose();
  };
  const n = preview?.visits.length ?? 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="visit-action-dialog" data-action={action} onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.explain}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {(action !== "no_show" || grouped) && (
            <div className="space-y-2">
              <Label>Which visits</Label>
              <RadioGroup value={scope} onValueChange={(v) => setScope(v as typeof scope)} className="space-y-1" data-testid="visit-action-scope">
                <div className="flex items-center gap-2"><RadioGroupItem value="this" id="scope-this" /><Label htmlFor="scope-this" className="font-normal">{grouped ? "This client's visit" : "This visit"}</Label></div>
                {action !== "no_show" && !grouped && <div className="flex items-center gap-2"><RadioGroupItem value="following" id="scope-following" data-testid="scope-following" /><Label htmlFor="scope-following" className="font-normal">This and the following visits of the series</Label></div>}
                {grouped && <div className="flex items-center gap-2"><RadioGroupItem value="group" id="scope-group" data-testid="scope-group" /><Label htmlFor="scope-group" className="font-normal">The whole group</Label></div>}
              </RadioGroup>
            </div>
          )}
          {action === "cancel" && (
            <div className="space-y-2">
              <Label>Who asked for the cancellation</Label>
              <RadioGroup value={requestedBy} onValueChange={(v) => setRequestedBy(v as "client" | "agency")} className="flex gap-4" data-testid="visit-action-requested-by">
                <div className="flex items-center gap-2"><RadioGroupItem value="client" id="by-client" /><Label htmlFor="by-client" className="font-normal">The client / family</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="agency" id="by-agency" /><Label htmlFor="by-agency" className="font-normal">The agency</Label></div>
              </RadioGroup>
            </div>
          )}
          {action !== "no_show" && (
            <div className="space-y-1">
              <Label htmlFor="visit-reason">Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as ReasonCode)}>
                <SelectTrigger id="visit-reason" data-testid="visit-action-reason"><SelectValue placeholder="Choose a reason" /></SelectTrigger>
                <SelectContent>{REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="visit-reason-text">{action === "no_show" ? "What happened" : reason === "other" ? "Describe the reason" : "Note (optional)"}</Label>
            <Textarea id="visit-reason-text" className="min-h-[80px] text-base" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} data-testid="visit-action-text" />
          </div>
          <div className="rounded-md border p-3 text-sm" data-testid="visit-action-preview" data-visits={n} data-blocked={blocked.length}>
            {!preview ? <span className="text-muted-foreground">Checking the visits…</span> : (
              <>
                <p className="font-medium">{n === 1 ? "1 visit" : `${n} visits`}: {preview.visits.slice(0, 6).map((v) => `${fmtDay(v.shift_date)} ${v.start_time.slice(0, 5)}`).join(", ")}{n > 6 ? ", …" : ""}</p>
                {action === "cancel" && preview.late_cancel && <p className="text-amber-700 dark:text-amber-400" data-testid="late-cancel">Late cancellation: less than 24 hours before the visit.</p>}
                {blocked.length > 0 && <ul className="mt-1 list-disc pl-5 text-destructive">{blocked.slice(0, 5).map((v) => <li key={v.shift_id}>{v.blocker}</li>)}</ul>}
              </>
            )}
          </div>
          {error && <p className="text-sm text-destructive" role="alert" data-testid="visit-action-error">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="hover:bg-muted hover:text-foreground" onClick={onClose}>Back</Button>
          <Button variant={action === "unassign" ? "default" : "destructive"} disabled={busy || !preview || blocked.length > 0 || !!problem} onClick={run}
            title={problem ?? undefined} data-testid="visit-action-confirm">{t.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

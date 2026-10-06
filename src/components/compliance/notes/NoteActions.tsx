import { useState } from "react";
import { CheckCircle2, Lock, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { RETURN_MIN, returnReasonOk } from "@/lib/staffNotes";

/**
 * Review actions for one note (owner decisions, Oct 5):
 *   - Mark reviewed: review_progress_note (billable; the server picks the authorization FIFO and refuses
 *     with its reason when none fits — the note then stays submitted).
 *   - Return to caregiver: Submitted notes only; a reason of at least 10 characters (trimmed), enforced
 *     here only (the server requires a non-empty reason). A Reviewed note is never returned.
 *   - Billed notes are locked: no buttons.
 * Per-note review only; there is no bulk approve.
 */
export function NoteActions({ noteId, status, compact = false, onDone }: { noteId: string; status: string; compact?: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (status === "billed") return <Badge variant="secondary" className="gap-1" data-testid="note-locked"><Lock className="h-3 w-3" />Billed — locked</Badge>;
  if (status !== "submitted") return null;

  const review = async () => {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc("review_progress_note", { _note_id: noteId, _billable: true, _non_billable_reason: null } as never);
    setBusy(false);
    if (e) { setError(e.code === "22023" ? e.message : "The note couldn't be marked reviewed."); return; }
    toast.success("Note marked reviewed"); onDone();
  };
  const doReturn = async () => {
    if (!returnReasonOk(reason)) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc("return_progress_note", { _note_id: noteId, _reason: reason.trim() });
    setBusy(false);
    if (e) { setError(e.code === "22023" ? e.message : "The note couldn't be returned."); return; }
    toast.success("Note returned to the caregiver"); setOpen(false); setReason(""); onDone();
  };
  const n = reason.trim().length;
  return (
    <div className="space-y-2" data-testid="note-actions">
      <div className={compact ? "flex flex-wrap gap-2" : "flex flex-wrap gap-2"}>
        <Button size={compact ? "sm" : "default"} className="min-h-10 gap-1" onClick={review} disabled={busy} data-testid="mark-reviewed"><CheckCircle2 className="h-4 w-4" />Mark reviewed</Button>
        <Button size={compact ? "sm" : "default"} variant="outline" className="min-h-10 gap-1 hover:bg-muted hover:text-foreground" onClick={() => { setOpen(true); setError(null); }} disabled={busy} data-testid="open-return">
          <Undo2 className="h-4 w-4" />Return to caregiver</Button>
      </div>
      {error && !open && <Alert variant="destructive" data-testid="action-error"><AlertDescription>{error}</AlertDescription></Alert>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="return-dialog">
          <DialogHeader>
            <DialogTitle>Return to caregiver</DialogTitle>
            <DialogDescription>The caregiver sees your reason on the note, edits it and submits it again. The note's content can't be edited by reviewers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="return-reason">Reason</Label>
            <Textarea id="return-reason" className="min-h-[110px] text-base" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className={n >= RETURN_MIN ? "text-xs text-muted-foreground" : "text-xs text-destructive"} data-testid="return-hint">
              {n >= RETURN_MIN ? `${n} characters` : `At least ${RETURN_MIN} characters (${n}/${RETURN_MIN})`}</p>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" className="hover:bg-muted hover:text-foreground" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={doReturn} disabled={busy || !returnReasonOk(reason)} data-testid="confirm-return">Return note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

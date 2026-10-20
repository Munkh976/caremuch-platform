import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { RETURN_MIN, returnReasonOk } from "@/lib/staffNotes";

/**
 * Return to caregiver (owner decisions, Oct 5): Submitted notes only; a reason of at least 10 characters
 * (trimmed), enforced here only (the server requires a non-empty reason). Shared by the row actions and the
 * Review panel.
 */
export function ReturnNoteDialog({ noteId, open, onOpenChange, onDone }: { noteId: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) setError(null); }, [open]);

  const doReturn = async () => {
    if (!returnReasonOk(reason)) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc("return_progress_note", { _note_id: noteId, _reason: reason.trim() });
    setBusy(false);
    if (e) { setError(e.code === "22023" ? e.message : "The note couldn't be returned."); return; }
    toast.success("Note returned to the caregiver"); onOpenChange(false); setReason(""); onDone();
  };
  const n = reason.trim().length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="outline" className="hover:bg-muted hover:text-foreground" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={doReturn} disabled={busy || !returnReasonOk(reason)} data-testid="confirm-return">Return note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

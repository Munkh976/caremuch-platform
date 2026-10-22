import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Lock, Printer, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { fmtTime } from "@/lib/caregiverNotes";
import { REVIEW_ACK, undoReviewBlocked, type StaffNote } from "@/lib/staffNotes";
import { ReturnNoteDialog } from "./ReturnNoteDialog";
import { NoteUnits } from "./AdjustUnits";

const outline = "min-h-10 gap-1 hover:bg-muted hover:text-foreground";

/**
 * The Review panel at the end of a note (demo UX, Oct 19), after the goals, signature and history:
 *   - Submitted: "I have read this note…" (required for Mark reviewed, not for Return), then
 *     [Print] [Return to caregiver] [Mark reviewed]; Mark reviewed asks "Mark this note reviewed?" first.
 *     Return works as before (ReturnNoteDialog, at least 10 characters).
 *   - Reviewed / billed: who reviewed it and when, and Print only (billed: locked).
 *   - Reviewed: also "Undo review" (Part 2, owner decision Oct 19), disabled with the reason once the note's bill
 *     is approved or billed.
 *   - Draft / returned: what the note waits for, and Print.
 */
export function ReviewPanel({ d, onDone }: { d: StaffNote; onDone: () => void }) {
  const n = d.note, tz = d.office.timezone;
  const [ack, setAck] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = async () => {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc("review_progress_note", { _note_id: n.id, _billable: true, _non_billable_reason: null } as never);
    setBusy(false);
    if (e) { setError(e.code === "22023" ? e.message : "The note couldn't be marked reviewed."); return; }
    toast.success("Note marked reviewed"); setAck(false); onDone();
  };

  const print = (
    <Button asChild variant="outline" className={outline}>
      <Link to={`/progress-notes/${n.id}/print`} data-testid="print-link"><Printer className="h-4 w-4" />Print</Link>
    </Button>
  );
  const reviewedBy = n.reviewed_at
    ? <p className="text-sm" data-testid="reviewed-by">Reviewed by <span className="font-medium">{n.reviewed_by_name ?? "a reviewer"}</span> · {fmtTime(n.reviewed_at, tz, true)}</p>
    : null;

  return (
    <Card data-testid="review-panel" data-mode={n.status}>
      <CardHeader className="pb-2"><CardTitle className="text-base">Review</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <NoteUnits d={d} onDone={onDone} />
        {n.status === "submitted" ? (
          <>
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Checkbox id="review-ack" className="mt-0.5 h-5 w-5" checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="review-ack" />
              <Label htmlFor="review-ack" className="text-base font-normal leading-snug">{REVIEW_ACK}</Label>
            </div>
            {error && <Alert variant="destructive" data-testid="action-error"><AlertDescription>{error}</AlertDescription></Alert>}
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end" data-testid="review-buttons">
              {print}
              <Button variant="outline" className={outline} onClick={() => { setReturning(true); setError(null); }} disabled={busy} data-testid="open-return">
                <Undo2 className="h-4 w-4" />Return to caregiver</Button>
              <Button className="min-h-10 gap-1" onClick={() => setConfirm(true)} disabled={busy || !ack} data-testid="mark-reviewed">
                <CheckCircle2 className="h-4 w-4" />Mark reviewed</Button>
            </div>
            {!ack && <p className="text-xs text-muted-foreground sm:text-right" data-testid="ack-hint">Tick the box above to mark the note reviewed.</p>}
            <ReturnNoteDialog noteId={n.id} open={returning} onOpenChange={setReturning} onDone={() => { setAck(false); onDone(); }} />
            <AlertDialog open={confirm} onOpenChange={setConfirm}>
              <AlertDialogContent data-testid="review-confirm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Mark this note reviewed?</AlertDialogTitle>
                  <AlertDialogDescription>The visit's units are charged to the client's authorization, and the caregiver can no longer change the note.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="hover:bg-muted hover:text-foreground" data-testid="cancel-review">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={review} data-testid="confirm-review">Mark reviewed</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              {reviewedBy}
              {n.status === "billed" && <Badge variant="secondary" className="gap-1" data-testid="note-locked"><Lock className="h-3 w-3" />Billed — locked</Badge>}
              {n.status === "returned" && <p className="text-sm text-muted-foreground">Returned to the caregiver. It comes back here when they submit it again.</p>}
              {n.status === "draft" && <p className="text-sm text-muted-foreground">The caregiver hasn't submitted this note yet.</p>}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:flex sm:justify-end">{print}{n.status === "reviewed" && <UndoReview d={d} onDone={onDone} />}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Undo review (Part 2): a secondary button with a confirm; disabled with the reason once the week is approved / billed. */
function UndoReview({ d, onDone }: { d: StaffNote; onDone: () => void }) {
  const n = d.note;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the note's bill (RLS: managers / agency admins of the office); ids only in the query key
  const lock = useQuery({
    queryKey: ["note-undo-lock", n.id],
    retry: false,
    queryFn: async () => {
      const { data: pn, error: e1 } = await supabase.from("progress_notes").select("billing_batch_id, batch_approved_at").eq("id", n.id).single();
      if (e1) throw e1;
      if (!pn.billing_batch_id) return { batchStatus: null as string | null, approved: false };
      const { data: b, error: e2 } = await supabase.from("billing_batches").select("status").eq("id", pn.billing_batch_id).single();
      if (e2) throw e2;
      return { batchStatus: b.status as string, approved: !!pn.batch_approved_at };
    },
  });
  const blocked = lock.data ? undoReviewBlocked(n, lock.data.batchStatus, lock.data.approved) : null;
  const inOpenBill = lock.data?.batchStatus === "open";

  const undo = async () => {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc("undo_progress_note_review", { _note_id: n.id });
    setBusy(false);
    if (e) { setError(e.code === "22023" ? e.message : "The review couldn't be undone."); return; }
    toast.success("Review undone: the note is Submitted again"); onDone();
  };
  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <Button variant="outline" className={outline} onClick={() => { setOpen(true); setError(null); }} disabled={busy || lock.isPending || lock.isError || !!blocked} data-testid="undo-review">
        <RotateCcw className="h-4 w-4" />Undo review</Button>
      {blocked && <p className="text-xs text-muted-foreground" data-testid="undo-blocked">{blocked}</p>}
      {lock.isError && <p className="text-xs text-muted-foreground" data-testid="undo-blocked">Undo isn't available here.</p>}
      {error && <p className="text-sm text-destructive" role="alert" data-testid="undo-error">{error}</p>}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-testid="undo-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this review?</AlertDialogTitle>
            <AlertDialogDescription>
              The note goes back to Submitted and its units go back on the authorization. You can then mark it reviewed again or return it to the caregiver.
              {inOpenBill ? " It also leaves this week's draft bill: build the week again before approving it." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="hover:bg-muted hover:text-foreground" data-testid="cancel-undo">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={undo} data-testid="confirm-undo">Undo review</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
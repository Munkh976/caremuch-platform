import { useState } from "react";
import { CheckCircle2, Lock, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ReturnNoteDialog } from "./ReturnNoteDialog";

/**
 * Review actions for one note in a list row (owner decisions, Oct 5). The note page uses the Review panel.
 *   - Mark reviewed: review_progress_note (billable; the server picks the authorization FIFO and refuses
 *     with its reason when none fits — the note then stays submitted).
 *   - Return to caregiver: Submitted notes only (ReturnNoteDialog). A Reviewed note is never returned.
 *   - Billed notes are locked: no buttons.
 * Per-note review only; there is no bulk approve.
 */
export function NoteActions({ noteId, status, compact = false, onDone }: { noteId: string; status: string; compact?: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
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
  return (
    <div className="space-y-2" data-testid="note-actions">
      <div className="flex flex-wrap gap-2">
        <Button size={compact ? "sm" : "default"} className="min-h-10 gap-1" onClick={review} disabled={busy} data-testid="mark-reviewed"><CheckCircle2 className="h-4 w-4" />Mark reviewed</Button>
        <Button size={compact ? "sm" : "default"} variant="outline" className="min-h-10 gap-1 hover:bg-muted hover:text-foreground" onClick={() => { setOpen(true); setError(null); }} disabled={busy} data-testid="open-return">
          <Undo2 className="h-4 w-4" />Return to caregiver</Button>
      </div>
      {error && !open && <Alert variant="destructive" data-testid="action-error"><AlertDescription>{error}</AlertDescription></Alert>}
      <ReturnNoteDialog noteId={noteId} open={open} onOpenChange={setOpen} onDone={onDone} />
    </div>
  );
}

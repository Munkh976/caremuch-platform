import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { CASE_NUMBER_MAX, normalizeCaseNumber } from "@/lib/caseNumber";

/**
 * Care-plan header: set or clear the client's ISK case number. Same write path as the existing client
 * edit dialog (the staff UPDATE policy on clients); the DB CHECK enforces trimmed, 1..32 characters.
 */
export function CaseNumberDialog({ clientId, current, open, onOpenChange, onSaved }: {
  clientId: string; current: string | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setValue(current ?? ""); setError(null); } }, [open, current]);

  const save = async () => {
    const n = normalizeCaseNumber(value);
    if ("error" in n) { setError(n.error); return; }
    setSaving(true);
    const { data, error: e } = await supabase.from("clients").update({ case_number: n.value }).eq("id", clientId).select("id");
    setSaving(false);
    if (e || !data?.length) { setError("The case number couldn't be saved."); return; }
    onSaved(); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="case-number-dialog">
        <DialogHeader>
          <DialogTitle>Case number</DialogTitle>
          <DialogDescription>The client's ISK case number, as on the paper forms. Leave empty to clear it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="case-number">Case number</Label>
          <Input id="case-number" value={value} maxLength={CASE_NUMBER_MAX + 8} onChange={(e) => { setValue(e.target.value); setError(null); }} autoComplete="off" />
          {error && <p className="text-sm text-destructive" data-testid="case-number-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

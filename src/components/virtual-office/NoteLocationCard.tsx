import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { rpcErrorText } from "@/lib/rpcError";

type Mode = "free" | "default" | "hidden";
const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "free", label: "Caregiver types it", hint: "Empty on each new note (as today)." },
  { value: "default", label: "Prefilled", hint: "New notes start with the location below; the caregiver can change it." },
  { value: "hidden", label: "Hidden", hint: "Not shown on the caregiver's note." },
];

/**
 * Virtual Office → Compliance: the progress note "Location" setting (owner, Oct 22). Saved through
 * set_office_note_location (agency admin, audited). Applies to notes created from now on; existing notes keep theirs.
 */
export function NoteLocationCard({ officeId, canManage }: { officeId: string; canManage: boolean }) {
  const [saved, setSaved] = useState<{ mode: Mode; value: string } | null>(null);
  const [mode, setMode] = useState<Mode>("free");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("virtual_office").select("note_location_mode, note_location_default").eq("id", officeId).maybeSingle();
    if (!data) return;
    const s = { mode: (data.note_location_mode as Mode) ?? "free", value: data.note_location_default ?? "" };
    setSaved(s); setMode(s.mode); setValue(s.value);
  }, [officeId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (mode === "default" && !value.trim()) { toast.error("Enter the location to prefill"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("set_office_note_location", { _office_id: officeId, _mode: mode, _default: value.trim() || null });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success("Note location setting saved"); await load();
  };

  if (!saved) return null;
  const dirty = mode !== saved.mode || value.trim() !== saved.value;
  return (
    <Card data-testid="note-location-card">
      <CardHeader>
        <CardTitle>Progress note location</CardTitle>
        <CardDescription>What the "Location" field on a caregiver's progress note shows. Applies to notes created from now on;
          existing notes keep their location.{!canManage && " Only an agency admin can change this."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} disabled={!canManage} className="space-y-2">
          {MODES.map((m) => (
            <div key={m.value} className="flex items-start gap-2">
              <RadioGroupItem value={m.value} id={`loc-${m.value}`} className="mt-1" data-testid={`note-location-${m.value}`} />
              <Label htmlFor={`loc-${m.value}`} className="font-normal">
                <span className="font-medium">{m.label}</span> <span className="text-muted-foreground">— {m.hint}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
        {mode === "default" && (
          <div className="space-y-1">
            <Label htmlFor="loc-default">Location to prefill</Label>
            <Input id="loc-default" value={value} maxLength={200} disabled={!canManage} onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. the program's community center" data-testid="note-location-default" />
          </div>
        )}
        {canManage && (
          <Button onClick={save} disabled={busy || !dirty} data-testid="note-location-save">Save</Button>
        )}
      </CardContent>
    </Card>
  );
}

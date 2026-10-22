import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
            <Label htmlFor="loc-default-value">Location to prefill</Label>
            <Input id="loc-default-value" value={value} maxLength={200} disabled={!canManage} onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. the program's community center" data-testid="note-location-value" />
          </div>
        )}
        {canManage && (
          <Button onClick={save} disabled={busy || !dirty} data-testid="note-location-save">Save</Button>
        )}
        <VisitLocationSection officeId={officeId} canManage={canManage} />
      </CardContent>
    </Card>
  );
}

type VisitMode = "client_home" | "office";
/**
 * "Visits take place at" (owner, Oct 22, A): the client's home (default) or the office. In office mode the visit screens
 * show the office (note location name, else its name) and the office address. set_office_visit_location: agency admin,
 * audited; 'office' needs the office's street address (Contact tab).
 */
function VisitLocationSection({ officeId, canManage }: { officeId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<VisitMode | null>(null);
  const [mode, setMode] = useState<VisitMode>("client_home");
  const [addr, setAddr] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from("virtual_office").select("visit_location, address, city, state, zip_code").eq("id", officeId).maybeSingle();
    if (!data) return;
    const m = (data.visit_location as VisitMode) ?? "client_home";
    setSaved(m); setMode(m);
    setAddr([data.address, [data.city, data.state].filter(Boolean).join(", "), data.zip_code].filter(Boolean).join(", "));
  }, [officeId]);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("set_office_visit_location", { _office_id: officeId, _mode: mode });
    setBusy(false);
    if (error) { toast.error(rpcErrorText(error)); return; }
    toast.success("Visit location saved"); await load(); qc.invalidateQueries({ queryKey: ["office-places"] });
  };
  if (!saved) return null;
  return (
    <div className="space-y-3 border-t pt-4" data-testid="visit-location">
      <p className="font-medium">Visits take place at</p>
      <RadioGroup value={mode} onValueChange={(v) => setMode(v as VisitMode)} disabled={!canManage} className="space-y-2">
        <div className="flex items-start gap-2">
          <RadioGroupItem value="client_home" id="visit-at-home" className="mt-1" data-testid="visit-at-client_home" />
          <Label htmlFor="visit-at-home" className="font-normal"><span className="font-medium">The client's home</span> <span className="text-muted-foreground">— visit screens show the client's address (as today).</span></Label>
        </div>
        <div className="flex items-start gap-2">
          <RadioGroupItem value="office" id="visit-at-office" className="mt-1" data-testid="visit-at-office" />
          <Label htmlFor="visit-at-office" className="font-normal"><span className="font-medium">The office</span> <span className="text-muted-foreground">— visit screens show the office{addr ? `: ${addr}` : " (add its street address on the Contact tab first)"}.</span></Label>
        </div>
      </RadioGroup>
      {canManage && <Button onClick={save} disabled={busy || mode === saved} data-testid="visit-location-save">Save</Button>}
    </div>
  );
}

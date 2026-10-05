import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ChevronDown, Info, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { CaregiverAppShell } from "@/components/caregivers/CaregiverAppShell";
import { MeasureInput } from "@/components/caregivers/notes/MeasureInput";
import { useCaregiverClock } from "@/components/caregivers/useCaregiverApp";
import {
  clientShort, entryData, fmtDay, fmtTime, isEditable, isoToHhmm, missingAnswers, shiftTimeToIso, STATUS_LABEL,
  type Answer, type CaregiverNote as NotePayload, type CaregiverClock,
} from "@/lib/caregiverNotes";

type EntryState = Record<string, { notes: string; answers: Record<string, Answer> }>;
type SaveState = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };
const GENERIC = "You can't open this note, or it wasn't found.";
const AUTOSAVE_MS = 2000;

/** Height of the on-screen keyboard (visualViewport), 0 when closed. */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport; if (!vv) return;
    const f = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener("resize", f); vv.addEventListener("scroll", f); f();
    return () => { vv.removeEventListener("resize", f); vv.removeEventListener("scroll", f); };
  }, []);
  return inset;
}

/**
 * /caregiver/notes/:shiftId (S7): the assigned caregiver writes the visit's progress note.
 * Only the shift id is in the URL. The note is held in memory only — never local/session storage — and
 * goes to the server through save_progress_note_draft (Save + debounced autosave) and
 * submit_progress_note. Units and billing are never shown; a late arrival shows "Late arrival recorded".
 */
export default function CaregiverNote() {
  const { shiftId = "" } = useParams();
  const qc = useQueryClient();
  const clock = useCaregiverClock();
  const tz = clock.data?.timezone;
  const [open, setOpen] = useState<{ state: "loading" } | { state: "refused"; message: string } | { state: "ready" }>({ state: "loading" });
  const [note, setNote] = useState<NotePayload | null>(null);
  const [arrival, setArrival] = useState(""); const [end, setEnd] = useState("");
  const [ratio, setRatio] = useState(""); const [location, setLocation] = useState("");
  const [narrative, setNarrative] = useState("");
  const [entries, setEntries] = useState<EntryState>({});
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [version, setVersion] = useState(0);
  const saved = useRef(0); const saving = useRef<Promise<boolean> | null>(null);
  const [sheet, setSheet] = useState(false);
  const inset = useKeyboardInset(); const keyboardOpen = inset > 80;
  useEffect(() => { document.title = "Progress note · CareMuch"; }, []);

  const noteId = note?.note.id;
  const editable = !!note && isEditable(note.note.status);

  const fill = useCallback((p: NotePayload, zone: string) => {
    setNote(p);
    setArrival(isoToHhmm(p.note.client_arrived_at ?? p.note.scheduled_start, zone));
    setEnd(isoToHhmm(p.note.actual_end ?? p.note.scheduled_end, zone));
    setRatio(p.note.staff_client_ratio ?? ""); setLocation(p.note.location ?? ""); setNarrative(p.note.narrative_text ?? "");
    setEntries(Object.fromEntries(p.entries.map((e) => [e.entry_id, { notes: e.notes_text ?? "", answers: { ...(e.answers ?? {}) } }])));
  }, []);

  // open: create (idempotent, from the shift start) -> read the caregiver view
  useEffect(() => {
    if (!tz) return;
    let cancelled = false;
    (async () => {
      const c = await supabase.rpc("create_progress_note_for_shift", { _shift_id: shiftId });
      if (cancelled) return;
      if (c.error) { setOpen({ state: "refused", message: c.error.code === "22023" ? c.error.message : GENERIC }); return; }
      const r = await supabase.rpc("get_progress_note_for_caregiver", { _note_id: c.data as string });
      if (cancelled) return;
      if (r.error || !r.data) { setOpen({ state: "refused", message: GENERIC }); return; }
      fill(r.data as unknown as NotePayload, tz); setOpen({ state: "ready" });
    })();
    return () => { cancelled = true; };
  }, [shiftId, tz, fill]);

  const touch = () => setVersion((v) => v + 1);

  /** Save everything on the page as a draft. Returns true when the server has it. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!note || !tz || !isEditable(note.note.status)) return true;
    if (saving.current) await saving.current;
    const at = version;
    const run = (async () => {
      setSave({ kind: "saving" });
      const n = note.note;
      const header: Record<string, string | null> = { staff_client_ratio: ratio.trim() || null, location: location.trim() };
      if (arrival) header.client_arrived_at = shiftTimeToIso(n.service_date, arrival, tz, n.scheduled_start, 60);
      header.actual_end = end ? shiftTimeToIso(n.service_date, end, tz, n.scheduled_start, 0) : null;
      const payload = {
        _note_id: n.id, _header: header,
        _entries: n.note_kind === "cls" ? note.entries.map((e) => ({ entry_id: e.entry_id, notes_text: entries[e.entry_id]?.notes ?? "", data: entryData(e.measures, entries[e.entry_id]?.answers ?? {}) })) : [],
        _narrative_text: n.note_kind === "respite" ? narrative : null,
      };
      const { error } = await supabase.rpc("save_progress_note_draft", payload as never);
      if (error) {
        setSave({ kind: "error", message: error.code === "22023" ? error.message : "Check your connection." });
        return false;
      }
      saved.current = Math.max(saved.current, at);
      setSave({ kind: "saved" });
      // server-derived fields only (late arrival, status); the form keeps what is being typed
      const r = await supabase.rpc("get_progress_note_for_caregiver", { _note_id: n.id });
      if (!r.error && r.data) { const fresh = r.data as unknown as NotePayload; setNote((cur) => cur ? { ...cur, note: { ...cur.note, arrived_late: fresh.note.arrived_late, status: fresh.note.status } } : cur); }
      return true;
    })();
    saving.current = run;
    try { return await run; } finally { if (saving.current === run) saving.current = null; }
  }, [note, tz, version, ratio, location, arrival, end, entries, narrative]);

  const dirty = version > saved.current;
  // debounced autosave
  useEffect(() => {
    if (!editable || !dirty) return;
    const t = setTimeout(() => { void saveNow(); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [version, editable, dirty, saveNow]);
  // warn before leaving with unsaved changes (nothing is kept on the device)
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  if (open.state === "loading" || !tz) return <CaregiverAppShell><div className="flex h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" /></div></CaregiverAppShell>;
  if (open.state === "refused" || !note) {
    return (
      <CaregiverAppShell>
        <BackLink />
        <Card data-testid="note-refused"><CardContent className="py-10 text-center text-base text-muted-foreground">{open.state === "refused" ? open.message : GENERIC}</CardContent></Card>
      </CaregiverAppShell>
    );
  }

  const n = note.note;
  const goals: { goal: string | null; items: typeof note.entries }[] = [];
  for (const e of note.entries) { const last = goals[goals.length - 1]; if (last && last.goal === e.goal_text) last.items.push(e); else goals.push({ goal: e.goal_text, items: [e] }); }
  const setEntry = (id: string, patch: Partial<EntryState[string]>) => { setEntries((s) => ({ ...s, [id]: { ...s[id], ...patch } })); touch(); };

  return (
    <CaregiverAppShell hideNav={keyboardOpen} bottomPad>
      <div className="space-y-4" data-testid="caregiver-note" data-note-kind={n.note_kind} data-status={n.status}>
        <BackLink />
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{n.note_kind === "respite" ? "Respite progress note" : "CLS progress note"}</h1>
            <p className="text-base">{clientShort(n.client_first_name, n.client_last_initial)} · {fmtDay(n.service_date)}</p>
            <p className="text-sm text-muted-foreground">Scheduled {fmtTime(n.scheduled_start, tz)} – {fmtTime(n.scheduled_end, tz)}</p>
          </div>
          <Badge variant={n.status === "returned" ? "destructive" : "secondary"} data-testid="note-status">{STATUS_LABEL[n.status === "billed" ? "reviewed" : n.status]}</Badge>
        </div>

        {n.status === "returned" && (
          <Alert variant="destructive" data-testid="returned-banner">
            <AlertTriangle className="h-4 w-4" /><AlertTitle>Returned for changes</AlertTitle>
            <AlertDescription className="text-base">{n.returned_reason}</AlertDescription>
          </Alert>
        )}
        {!editable && (
          <Alert data-testid="readonly-banner"><Info className="h-4 w-4" /><AlertTitle>{n.status === "submitted" ? "Submitted" : "Reviewed"} — read only</AlertTitle>
            <AlertDescription>{n.staff_signature_name ? `Signed by ${n.staff_signature_name}` : ""}{n.staff_signed_at ? ` · ${fmtTime(n.staff_signed_at, tz, true)}` : ""}</AlertDescription></Alert>
        )}
        {save.kind === "error" && (
          <Alert variant="destructive" role="alert" data-testid="not-saved-banner">
            <AlertTriangle className="h-4 w-4" /><AlertTitle>Not saved — retry</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2"><span>{save.message}</span>
              <Button size="sm" variant="outline" className="min-h-11 gap-1 hover:bg-muted hover:text-foreground" onClick={() => void saveNow()}><RotateCw className="h-4 w-4" />Retry</Button></AlertDescription>
          </Alert>
        )}

        <Card><CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2" data-testid="note-header">
          <div className="space-y-2">
            <Label htmlFor="arrival" className="text-base">Client arrival time <span className="text-destructive">*</span></Label>
            <Input id="arrival" type="time" required className="h-11 text-base" disabled={!editable} value={arrival} onChange={(e) => { setArrival(e.target.value); touch(); }} />
            {n.arrived_late && <p className="flex items-center gap-1 text-sm font-medium text-foreground" data-testid="late-arrival"><Info className="h-4 w-4" />Late arrival recorded</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="end" className="text-base">End time</Label>
            <Input id="end" type="time" className="h-11 text-base" disabled={!editable} value={end} onChange={(e) => { setEnd(e.target.value); touch(); }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location" className="text-base">Location</Label>
            <Input id="location" className="h-11 text-base" maxLength={200} disabled={!editable} value={location} onChange={(e) => { setLocation(e.target.value); touch(); }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ratio" className="text-base">Staff : client ratio</Label>
            <Input id="ratio" className="h-11 text-base" placeholder="1:1" maxLength={5} disabled={!editable} value={ratio} onChange={(e) => { setRatio(e.target.value); touch(); }} />
          </div>
        </CardContent></Card>

        {n.note_kind === "respite" ? (
          <Card><CardContent className="space-y-2 p-4">
            <Label htmlFor="narrative" className="text-base">Session narrative <span className="text-destructive">*</span></Label>
            <p className="text-sm text-muted-foreground">Describe the session: activities, how the person responded, anything staff should know.</p>
            <Textarea id="narrative" className="min-h-[200px] text-base" maxLength={10000} disabled={!editable} value={narrative} onChange={(e) => { setNarrative(e.target.value); touch(); }} />
          </CardContent></Card>
        ) : note.entries.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">This plan has no CLS objectives for your agency.</CardContent></Card>
        ) : goals.map((g, gi) => (
          <section key={gi} className="space-y-3" data-goal={gi + 1}>
            <h2 className="text-base font-bold">Goal {gi + 1}: {g.goal}</h2>
            {g.items.map((e) => (
              <Card key={e.entry_id} data-entry={e.entry_id}><CardContent className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-base font-semibold">{e.objective_letter ? `${e.objective_letter}. ` : ""}{e.objective_text}</p>
                  <Badge variant="outline">CLS</Badge>
                </div>
                {e.staff_instructions && (
                  <Collapsible>
                    <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between rounded-md bg-muted/60 px-3 text-left text-base font-medium">Instructions for Staff<ChevronDown className="h-4 w-4" /></CollapsibleTrigger>
                    <CollapsibleContent><p className="whitespace-pre-wrap px-3 pt-2 text-base">{e.staff_instructions}</p></CollapsibleContent>
                  </Collapsible>
                )}
                <div className="space-y-2">
                  <Label htmlFor={`notes-${e.entry_id}`} className="text-base">Notes <span className="font-normal text-muted-foreground">(include reinforcers)</span></Label>
                  <Textarea id={`notes-${e.entry_id}`} className="min-h-[96px] text-base" maxLength={5000} disabled={!editable} value={entries[e.entry_id]?.notes ?? ""}
                    onChange={(ev) => setEntry(e.entry_id, { notes: ev.target.value })} />
                </div>
                {e.measures.length > 0 && (
                  <div className="space-y-4 border-t pt-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Data</p>
                    {e.measures.map((m) => (
                      <MeasureInput key={m.measure_id} m={m} a={entries[e.entry_id]?.answers[m.measure_id]} disabled={!editable}
                        onChange={(a) => setEntry(e.entry_id, { answers: { ...(entries[e.entry_id]?.answers ?? {}), [m.measure_id]: a } })} />
                    ))}
                  </div>
                )}
              </CardContent></Card>
            ))}
          </section>
        ))}
      </div>

      {editable && (
        <div data-testid="note-footer" className="fixed inset-x-0 z-50 border-t bg-card/95 px-4 py-3 backdrop-blur"
          style={{ bottom: keyboardOpen ? inset : "calc(56px + env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" data-testid="save-state" aria-live="polite">
              {save.kind === "saving" ? "Saving…" : save.kind === "error" ? "Not saved" : dirty ? "Unsaved changes" : save.kind === "saved" ? "Saved" : ""}
            </span>
            <Button variant="outline" className="min-h-11 px-5 hover:bg-muted hover:text-foreground" onClick={() => void saveNow()} disabled={save.kind === "saving"}>Save</Button>
            <Button className="min-h-11 px-5" onClick={() => setSheet(true)} data-testid="open-submit">{n.status === "returned" ? "Resubmit" : "Submit"}</Button>
          </div>
        </div>
      )}

      <SubmitSheet open={sheet} onOpenChange={setSheet} note={note} entries={entries} arrival={arrival} narrative={narrative} clock={clock.data}
        onRefreshClock={() => clock.refetch()} flush={saveNow}
        onSubmitted={async () => {
          const r = await supabase.rpc("get_progress_note_for_caregiver", { _note_id: noteId as string });
          if (!r.error && r.data) fill(r.data as unknown as NotePayload, tz);
          saved.current = version;
          void qc.invalidateQueries({ queryKey: ["caregiver-notes-due"] });
        }} />
    </CaregiverAppShell>
  );
}

function BackLink() {
  return <Link to="/caregiver/notes" className="flex min-h-11 w-fit items-center gap-1 text-base text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Notes</Link>;
}

function SubmitSheet({ open, onOpenChange, note, entries, arrival, narrative, clock, onRefreshClock, flush, onSubmitted }: {
  open: boolean; onOpenChange: (o: boolean) => void; note: NotePayload; entries: EntryState; arrival: string; narrative: string;
  clock: CaregiverClock | undefined; onRefreshClock: () => void; flush: () => Promise<boolean>; onSubmitted: () => Promise<void>;
}) {
  const [name, setName] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setError(null); onRefreshClock(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = note.note;
  const missing: string[] = [];
  if (!arrival) missing.push("the client's arrival time");
  if (n.note_kind === "respite" && !narrative.trim()) missing.push("the session narrative");
  if (n.note_kind === "cls") for (const e of note.entries) {
    const left = missingAnswers(e.measures, entries[e.entry_id]?.answers ?? {});
    if (left.length) missing.push(`${left.length} question${left.length === 1 ? "" : "s"} on ${e.objective_letter ?? "an objective"}`);
  }
  const submit = async () => {
    if (!name.trim()) { setError("Type your full name to sign."); return; }
    setBusy(true); setError(null);
    const ok = await flush();
    if (!ok) { setBusy(false); setError("The note couldn't be saved first. Check your connection and try again."); return; }
    const { error: e } = await supabase.rpc("submit_progress_note", { _note_id: n.id, _typed_signature: name.trim() });
    setBusy(false);
    if (e) { setError(e.code === "22023" ? e.message : "The note couldn't be submitted."); return; }
    toast.success("Progress note submitted");
    onOpenChange(false);
    await onSubmitted();
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto" data-testid="submit-sheet">
        <SheetHeader className="text-left">
          <SheetTitle>{n.status === "returned" ? "Resubmit this note" : "Sign and submit"}</SheetTitle>
          <SheetDescription>After you submit, the note is read only unless your manager returns it.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 pt-4">
          {missing.length > 0 && <Alert variant="destructive" data-testid="submit-missing"><AlertDescription>Still needed: {missing.join("; ")}.</AlertDescription></Alert>}
          <p className="rounded-md bg-muted/60 p-3 text-base" data-testid="attestation">I confirm that I provided this service as written and that this note is true and complete.</p>
          <div className="space-y-2">
            <Label htmlFor="sig" className="text-base">Type your full name</Label>
            <Input id="sig" className="h-11 text-base" autoComplete="off" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground" data-testid="sign-time">Signed at {clock ? fmtTime(clock.now, clock.timezone, true) : "…"} (recorded by the server)</p>
          {error && <p className="text-base text-destructive" role="alert" data-testid="submit-error">{error}</p>}
          <Button className="min-h-11 w-full" disabled={busy || missing.length > 0} onClick={submit} data-testid="confirm-submit">{busy ? "Submitting…" : "Submit note"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

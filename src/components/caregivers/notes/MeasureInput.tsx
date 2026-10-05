import { Check, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Answer, NoteMeasure, TrialAnswer } from "@/lib/caregiverNotes";

const YNN = ["Yes", "No", "N/A"] as const;

/** Yes / No / N/A as one row of large buttons (≥44 px). */
function Segmented({ value, onChange, disabled, label }: { value?: string; onChange: (v: string) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-2">
      {YNN.map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}
          className={cn("min-h-11 rounded-md border text-base font-medium", value === v ? "border-primary bg-primary text-primary-foreground" : "bg-background", disabled && "opacity-70")}>
          {v}
        </button>
      ))}
    </div>
  );
}

/**
 * One data question on a CLS objective. Shapes follow the server (cp_validate_answer): yes_no_na
 * {value}; prompt_level {value: one option}; graded_steps {steps: option indexes}; tally {count};
 * trials {trials: [{value, text?}] × trial_count}; short_answer / narrative {value}; staff_note is text.
 */
export function MeasureInput({ m, a, onChange, disabled }: { m: NoteMeasure; a: Answer | undefined; onChange: (a: Answer) => void; disabled: boolean }) {
  const id = `m-${m.measure_id}`;
  const label = m.prompt_text ?? "";
  const val = a && "value" in a ? a.value : undefined;
  switch (m.kind) {
    case "staff_note":
      return <p className="rounded-md bg-muted/60 p-3 text-base" data-kind="staff_note">{label}</p>;
    case "yes_no_na":
      return <Field label={label} id={id}><Segmented value={val} onChange={(v) => onChange({ value: v })} disabled={disabled} label={label} /></Field>;
    case "prompt_level":
      return (
        <Field label={label} id={id}>
          <select id={id} disabled={disabled} value={val ?? ""} onChange={(e) => onChange({ value: e.target.value })}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base">
            <option value="" disabled>Choose a prompt level</option>
            {(m.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      );
    case "graded_steps": {
      const steps = a && "steps" in a ? a.steps : [];
      const toggle = (i: number) => onChange({ steps: steps.includes(i) ? steps.filter((s) => s !== i) : [...steps, i] });
      return (
        <Field label={label} id={id}>
          <ul className="space-y-2">
            {(m.options ?? []).map((o, i) => (
              <li key={i}>
                <button type="button" role="checkbox" aria-checked={steps.includes(i)} disabled={disabled} onClick={() => toggle(i)}
                  className={cn("flex min-h-11 w-full items-center gap-3 rounded-md border px-3 text-left text-base", steps.includes(i) && "border-primary bg-primary/5")}>
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded border", steps.includes(i) ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                    {steps.includes(i) && <Check className="h-4 w-4" />}
                  </span>
                  <span>{i + 1}. {o}</span>
                </button>
              </li>
            ))}
          </ul>
        </Field>
      );
    }
    case "tally": {
      const n = a && "count" in a ? a.count : 0;
      return (
        <Field label={label} id={id}>
          <div className="flex items-center gap-3" data-kind="tally">
            <Button type="button" variant="outline" className="h-11 w-11 p-0 hover:bg-muted hover:text-foreground" aria-label="Minus one" disabled={disabled || n <= 0} onClick={() => onChange({ count: Math.max(0, n - 1) })}><Minus className="h-5 w-5" /></Button>
            <span className="min-w-[3ch] text-center text-2xl font-bold tabular-nums" aria-live="polite" data-tally={m.measure_id}>{n}</span>
            <Button type="button" variant="outline" className="h-11 w-11 p-0 hover:bg-muted hover:text-foreground" aria-label="Plus one" disabled={disabled || n >= 1000} onClick={() => onChange({ count: Math.min(1000, n + 1) })}><Plus className="h-5 w-5" /></Button>
            <span className="text-sm text-muted-foreground">total</span>
          </div>
        </Field>
      );
    }
    case "trials": {
      const count = m.trial_count ?? 0;
      const trials: TrialAnswer[] = a && "trials" in a ? a.trials : [];
      const set = (i: number, patch: TrialAnswer) => { const next = Array.from({ length: count }, (_, k) => ({ ...(trials[k] ?? {}) })); next[i] = { ...next[i], ...patch }; onChange({ trials: next }); };
      return (
        <Field label={label} id={id}>
          <ol className="space-y-3" data-kind="trials">
            {Array.from({ length: count }, (_, i) => (
              <li key={i} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-semibold">Trial {i + 1}</p>
                <Segmented value={trials[i]?.value} onChange={(v) => set(i, { value: v as TrialAnswer["value"] })} disabled={disabled} label={`${label} trial ${i + 1}`} />
                <Input className="h-11 text-base" placeholder="Short note (optional)" maxLength={500} disabled={disabled} value={trials[i]?.text ?? ""} onChange={(e) => set(i, { text: e.target.value })} aria-label={`Trial ${i + 1} note`} />
              </li>
            ))}
          </ol>
        </Field>
      );
    }
    case "short_answer":
      return <Field label={label} id={id}><Input id={id} className="h-11 text-base" maxLength={500} disabled={disabled} value={val ?? ""} onChange={(e) => onChange({ value: e.target.value })} /></Field>;
    case "narrative":
      return <Field label={label} id={id}><Textarea id={id} className="min-h-[120px] text-base" maxLength={5000} disabled={disabled} value={val ?? ""} onChange={(e) => onChange({ value: e.target.value })} /></Field>;
  }
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2" data-measure={id}>
      <label htmlFor={id} className="block text-base font-medium">{label}</label>
      {children}
    </div>
  );
}

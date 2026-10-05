import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TemplateField } from "@/lib/formTemplates";
import type { FieldValue } from "@/lib/carePlan";

/** One template field_value input, typed by the field (TemplateFormRenderer building block). */
export function FieldInput({ field, value, onChange }: { field: TemplateField; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const id = `fv-${field.field_key}`;
  const label = <Label htmlFor={id}>{field.label}{field.required ? " *" : ""}</Label>;
  switch (field.field_type) {
    case "longtext":
      return <div className="space-y-1">{label}<Textarea id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} /></div>;
    case "number": case "units": case "money":
      return <div className="space-y-1">{label}<Input id={id} type="number" inputMode="decimal" value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} /></div>;
    case "checkbox":
      return <div className="flex items-center gap-2"><Switch id={id} checked={value === true} onCheckedChange={(v) => onChange(v)} />{label}</div>;
    case "date":
      return <div className="space-y-1">{label}<Input id={id} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} /></div>;
    case "select":
      return (
        <div className="space-y-1">{label}
          <Select value={(value as string) ?? undefined} onValueChange={(v) => onChange(v)}>
            <SelectTrigger id={id}><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>{(field.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      );
    case "table": {
      const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      const set = (i: number, text: string) => onChange(rows.map((r, j) => (j === i ? { ...r, text } : r)));
      return (
        <div className="space-y-1">{label}
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`${field.label} row ${i + 1}`} value={String(r.text ?? "")} onChange={(e) => set(i, e.target.value)} />
              <Button type="button" size="icon" variant="ghost" aria-label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => onChange([...rows, { text: "" }])}><Plus className="h-3 w-3" />Add row</Button>
        </div>
      );
    }
    default:
      return <div className="space-y-1">{label}<Input id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} /></div>;
  }
}


import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ComplianceOffice } from "@/hooks/useComplianceOffices";

/** Office choice for module screens. A single office is shown as text (office-restricted users). */
export function OfficePicker({ offices, value, onChange }: { offices: ComplianceOffice[]; value: string | null; onChange: (id: string) => void }) {
  if (offices.length <= 1) {
    return offices[0] ? <p className="text-sm text-muted-foreground">Office: <span className="font-medium text-foreground">{offices[0].name}</span></p> : null;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Office</span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-[240px] max-w-full" aria-label="Office">
          <SelectValue placeholder="Choose an office" />
        </SelectTrigger>
        <SelectContent>
          {offices.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

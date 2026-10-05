import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isLockedField, STORAGE_LABEL } from "@/lib/formTemplates";
import { useVersionFields } from "./useVersionFields";

export function FieldViewer({ versionId }: { versionId: string | null }) {
  const { data: fields = [], isLoading } = useVersionFields(versionId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading fields…</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Field</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Storage</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>On progress note</TableHead>
            <TableHead>Options / target</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((f, i) => (
            <TableRow key={f.field_key}>
              <TableCell className="text-muted-foreground">{i + 1}</TableCell>
              <TableCell>
                <div className="font-medium">{f.label}</div>
                <div className="text-xs text-muted-foreground">{f.field_key}</div>
              </TableCell>
              <TableCell className="text-sm">{f.field_type}</TableCell>
              <TableCell>
                <Badge variant={isLockedField(f) ? "secondary" : "outline"} className="gap-1 whitespace-nowrap">
                  {isLockedField(f) && <Lock className="h-3 w-3" aria-hidden="true" />}
                  {STORAGE_LABEL[f.storage]}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{f.required ? "Yes" : "—"}</TableCell>
              <TableCell className="text-sm">{f.shown_on_progress_note ? "Shown" : "—"}</TableCell>
              <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                {isLockedField(f)
                  ? `${f.writes_to_entity ?? ""}${f.writes_to_column ? "." + f.writes_to_column : ""}`
                  : f.options?.length ? f.options.join(", ") : "—"}
              </TableCell>
            </TableRow>
          ))}
          {fields.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">No fields.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

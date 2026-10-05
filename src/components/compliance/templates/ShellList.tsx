import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FieldViewer } from "./FieldViewer";
import { ShellEditor } from "./ShellEditor";
import { groupShells, shellGroup, type Shell } from "@/lib/formTemplates";
import { rpcErrorText } from "@/lib/rpcError";

const when = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy") : "—");

/** G3: the office's shells and the agency-wide ones, grouped by kind, with versions and usage. */
export function ShellList({ officeId }: { officeId: string | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { data: shells = [], isLoading, error } = useQuery({
    queryKey: ["template-list", officeId],
    enabled: !!officeId,
    queryFn: async (): Promise<Shell[]> => {
      const { data, error } = await supabase.rpc("list_templates_with_usage", { _office_id: officeId as string });
      if (error) throw error;
      return (data ?? []) as unknown as Shell[];
    },
  });
  const shell = shells.find((s) => s.template_id === selected) ?? null;

  if (!officeId) return null;
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading shells…</p>;
  if (error) return <p className="text-sm text-destructive">{rpcErrorText(error as { code?: string; message?: string })}</p>;
  if (shells.length === 0) return <p className="text-sm text-muted-foreground">No shells yet for this office.</p>;

  return (
    <div className="space-y-4">
      {groupShells(shells).map(({ group, shells: rows }) => (
        <Card key={group}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{group}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0 sm:p-6 sm:pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shell</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Draft</TableHead>
                  <TableHead>Last published</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const cur = s.versions.find((v) => v.is_current);
                  const total = s.versions.reduce((n, v) => n + v.usage, 0);
                  return (
                    <TableRow key={s.template_id} className="cursor-pointer" onClick={() => setSelected(s.template_id)} data-shell={s.name}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell><Badge variant={s.scope === "office" ? "secondary" : "outline"}>{s.scope === "office" ? "This office" : "Agency-wide"}</Badge></TableCell>
                      <TableCell>{s.current_version ? `v${s.current_version}` : "—"}</TableCell>
                      <TableCell>{s.draft_version ? <Badge variant="outline">v{s.draft_version} draft</Badge> : "No"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{cur ? `${when(cur.published_at)}${cur.published_by ? ` · ${cur.published_by}` : ""}` : "—"}</TableCell>
                      <TableCell className="text-right text-sm">{cur ? `${cur.usage} on v${cur.version}` : "—"}{total !== (cur?.usage ?? 0) ? ` · ${total} total` : ""}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <ShellDetail shell={shell} onClose={() => setSelected(null)} onEdit={() => setEditing(true)} />
      {shell && <ShellEditor shell={shell} open={editing} onOpenChange={setEditing} />}
    </div>
  );
}

function ShellDetail({ shell, onClose, onEdit }: { shell: Shell | null; onClose: () => void; onEdit: () => void }) {
  const [versionId, setVersionId] = useState<string | null>(null);
  const current = shell?.versions.find((v) => v.is_current) ?? shell?.versions[0] ?? null;
  const shown = shell?.versions.find((v) => v.version_id === versionId) ?? current;
  return (
    <Sheet open={!!shell} onOpenChange={(o) => { if (!o) { setVersionId(null); onClose(); } }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        {shell && (
          <>
            <SheetHeader>
              <SheetTitle>{shell.name}</SheetTitle>
              <SheetDescription>{shellGroup(shell)} · {shell.scope === "office" ? "this office" : "agency-wide"}</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {shell.can_edit ? (
                  <Button className="gap-1" onClick={onEdit}><Pencil className="h-4 w-4" />{shell.draft_version ? `Continue draft v${shell.draft_version}` : "Edit (new draft)"}</Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {shell.scope === "agency" ? "Agency-wide shell: only an agency admin can change it." : "Read only."}
                  </p>
                )}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Version history</p>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Published</TableHead><TableHead className="text-right">Records</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {shell.versions.map((v) => (
                        <TableRow key={v.version_id} className={`cursor-pointer ${v.version_id === shown?.version_id ? "bg-muted/60" : ""}`} onClick={() => setVersionId(v.version_id)}>
                          <TableCell>v{v.version}</TableCell>
                          <TableCell>{v.is_current ? <Badge>Current</Badge> : v.status === "draft" ? <Badge variant="outline">Draft</Badge> : <Badge variant="secondary">Kept</Badge>}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{v.published_at ? `${when(v.published_at)}${v.published_by ? ` · ${v.published_by}` : ""}` : "—"}</TableCell>
                          <TableCell className="text-right">{v.usage}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Older versions are kept: records filled from them still render from their own snapshot.</p>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Fields of v{shown?.version}</p>
                <FieldViewer versionId={shown?.version_id ?? null} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

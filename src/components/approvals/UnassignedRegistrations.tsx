import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Unassigned { id: string; first_name: string; last_name: string; email: string; created_at: string }
interface Option { id: string; name: string }

/**
 * Owner decision (Oct 5, security plan §15.7): only a system_admin assigns an agency (and office)
 * to an UNASSIGNED caregiver registration — one submitted from a page that carries no agency
 * (/caregiver-registration, /assistant). Agency staff never see these rows (caregiver_registrations
 * RLS requires agency_id = their agency), and approve-caregiver-registration refuses them until
 * assigned. The update goes through the existing RLS (system_admin may update any registration);
 * review columns stay protected by trg_protect_registration_review_columns.
 * Render this component only for system_admin.
 */
export function UnassignedRegistrations({ onAssigned }: { onAssigned?: () => void }) {
  const [rows, setRows] = useState<Unassigned[]>([]);
  const [agencies, setAgencies] = useState<Option[]>([]);
  const [offices, setOffices] = useState<Record<string, Option[]>>({});
  const [choice, setChoice] = useState<Record<string, { agency?: string; office?: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    const [{ data: regs }, { data: ags }] = await Promise.all([
      supabase.from("caregiver_registrations").select("id, first_name, last_name, email, created_at")
        .is("agency_id", null).eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("agency").select("id, agency_name").order("agency_name"),
    ]);
    setRows((regs as Unassigned[]) ?? []);
    setAgencies(((ags as { id: string; agency_name: string }[]) ?? []).map((a) => ({ id: a.id, name: a.agency_name })));
  };
  useEffect(() => { load(); }, []);

  const pickAgency = async (regId: string, agencyId: string) => {
    setChoice((c) => ({ ...c, [regId]: { agency: agencyId, office: undefined } }));
    if (!offices[agencyId]) {
      const { data } = await supabase.from("virtual_office").select("id, name").eq("agency_id", agencyId).eq("is_active", true).order("name");
      setOffices((o) => ({ ...o, [agencyId]: (data as Option[]) ?? [] }));
    }
  };

  const assign = async (regId: string) => {
    const c = choice[regId];
    if (!c?.agency) return;
    setSaving(regId);
    const { error, data } = await supabase.from("caregiver_registrations")
      .update({ agency_id: c.agency, virtual_office_id: c.office && c.office !== "none" ? c.office : null } as never)
      .eq("id", regId).is("agency_id", null).select("id");
    setSaving(null);
    if (error || !data?.length) { toast.error(error?.message ?? "Not assigned (it may have been assigned already)"); load(); return; }
    toast.success("Registration assigned. That agency's staff can now review it.");
    load();
    onAssigned?.();
  };

  return (
    <Card className="mb-6 border-warning/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Unassigned registrations <Badge variant="outline">{rows.length}</Badge>
        </CardTitle>
        <CardDescription>
          System admin only. These applications came from a page with no agency. Assign each to an agency
          (and office) so that agency's staff can review it. Agency staff don't see this list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No unassigned registrations.</p>}
        {rows.map((r) => {
          const c = choice[r.id] ?? {};
          return (
            <div key={r.id} className="flex flex-col gap-2 rounded-lg border p-3 md:flex-row md:items-center">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{r.first_name} {r.last_name}</p>
                <p className="truncate text-xs text-muted-foreground">{r.email} · {new Date(r.created_at).toLocaleDateString()}</p>
              </div>
              <Select value={c.agency ?? ""} onValueChange={(v) => pickAgency(r.id, v)}>
                <SelectTrigger className="md:w-56"><SelectValue placeholder="Agency" /></SelectTrigger>
                <SelectContent>{agencies.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={c.office ?? ""} onValueChange={(v) => setChoice((x) => ({ ...x, [r.id]: { ...c, office: v } }))} disabled={!c.agency}>
                <SelectTrigger className="md:w-56"><SelectValue placeholder="Office (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific office</SelectItem>
                  {(c.agency ? offices[c.agency] ?? [] : []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => assign(r.id)} disabled={!c.agency || saving === r.id}>
                {saving === r.id ? "Assigning..." : "Assign"}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

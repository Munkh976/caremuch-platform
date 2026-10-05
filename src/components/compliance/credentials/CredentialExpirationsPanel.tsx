import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpiryPill } from "@/components/compliance/ExpiryPill";
import { OfficePicker } from "@/components/compliance/OfficePicker";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";
import { rpcErrorText } from "@/lib/rpcError";

interface Expiration {
  caregiver_id: string; caregiver_name: string; credential_type_id: string; credential_type: string; category: string;
  required: boolean; expiry_date: string | null; days: number | null; band: "overdue" | "red" | "yellow" | "missing";
}

/**
 * G1 panel on Caregiver Management: credentials overdue / due within 60 days, and required ones
 * missing, for an office with the care-plan module. Renders nothing elsewhere (Kind Care unchanged).
 */
export function CredentialExpirationsPanel({ onOpenCaregiver }: { onOpenCaregiver?: (caregiverId: string) => void }) {
  const { moduleOffices } = useComplianceOffices();
  const [picked, setPicked] = useState<string | null>(null);
  const officeId = picked ?? moduleOffices[0]?.id ?? null;
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["credential-expirations", officeId],
    enabled: !!officeId,
    queryFn: async (): Promise<Expiration[]> => {
      const { data, error } = await supabase.rpc("list_credential_expirations", { _office_id: officeId as string, _within_days: 60 });
      if (error) throw error;
      return (data ?? []) as unknown as Expiration[];
    },
  });
  if (!officeId) return null;
  const count = (b: Expiration["band"]) => data.filter((r) => r.band === b).length;
  const today = new Date();
  return (
    <Card data-testid="expirations-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Credential expirations</CardTitle>
            <CardDescription>Overdue, due within 60 days, and required credentials missing.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/training" className="whitespace-nowrap text-sm font-medium text-primary hover:underline" data-testid="client-training-link">Client training →</Link>
            <OfficePicker offices={moduleOffices} value={officeId} onChange={setPicked} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          <Badge variant="destructive">{count("overdue")} overdue</Badge>
          <Badge variant="outline" className="border-destructive/40 text-destructive">{count("red")} within 30 days</Badge>
          <Badge variant="outline" className="border-warning/40">{count("yellow")} within 60 days</Badge>
          <Badge variant="outline">{count("missing")} missing</Badge>
        </div>
      </CardHeader>
      <CardContent className="max-h-80 overflow-y-auto">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : error ? <p className="text-sm text-destructive">{rpcErrorText(error as { code?: string; message?: string })}</p>
          : data.length === 0 ? <p className="text-sm text-muted-foreground">Nothing due in the next 60 days.</p>
          : (
            <ul className="divide-y">
              {data.map((r) => (
                <li key={`${r.caregiver_id}-${r.credential_type_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2" data-band={r.band} data-credential={r.credential_type}>
                  <button type="button" className="text-left text-sm hover:underline" onClick={() => onOpenCaregiver?.(r.caregiver_id)}>
                    <span className="font-medium">{r.caregiver_name}</span>
                    <span className="text-muted-foreground"> · {r.credential_type}</span>
                  </button>
                  {r.band === "missing" ? <Badge variant="destructive" data-band="missing">Missing</Badge> : <ExpiryPill expiry={r.expiry_date} today={today} />}
                </li>
              ))}
            </ul>
          )}
      </CardContent>
    </Card>
  );
}


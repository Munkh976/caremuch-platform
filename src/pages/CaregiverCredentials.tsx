import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CaregiverAppShell } from "@/components/caregivers/CaregiverAppShell";
import { useCaregiverRecord, useSessionUserId } from "@/components/caregivers/useCaregiverApp";
import { ExpiryPill } from "@/components/compliance/ExpiryPill";
import { AttachmentsBlock, useAttachmentCounts } from "@/components/compliance/attachments/Attachments";

/**
 * Caregiver app: "My credentials" (S4b, owner answer 3). The caregiver sees their own credential entries (read policy
 * "Caregivers read their own certifications") and can upload a scan or photo to each. Uploading changes nothing on the
 * entry: HR checks the file and renews the entry (dates, verified) as today; until then the file shows "Waiting for HR".
 * A credential HR hasn't entered yet has no entry, so there is nothing to attach to: the caregiver gives it to HR.
 */
export default function CaregiverCredentials() {
  const navigate = useNavigate();
  const userId = useSessionUserId();
  const record = useCaregiverRecord(userId);
  const [open, setOpen] = useState<string | null>(null);
  const caregiverId = record.data?.id;
  const { data: certs = [], isLoading } = useQuery({
    queryKey: ["my-credentials", caregiverId],
    enabled: !!caregiverId,
    queryFn: async () => {
      const { data, error } = await supabase.from("caregiver_certifications").select("id, certification_name, expiry_date")
        .eq("caregiver_id", caregiverId as string).not("credential_type_id", "is", null).order("certification_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: files } = useAttachmentCounts("credential", certs.map((c) => c.id));
  return (
    <CaregiverAppShell>
      <Button variant="ghost" className="-ml-2 mb-2 gap-1" onClick={() => navigate("/caregiver-settings")}><ArrowLeft className="h-4 w-4" />Profile</Button>
      <h1 className="text-2xl font-bold">My credentials</h1>
      <p className="mb-4 text-sm text-muted-foreground">Add a photo or PDF of a renewed card or certificate. HR checks it and updates the dates; nothing changes until then.</p>
      {isLoading || record.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : certs.length === 0 ? <Card><CardContent className="py-6 text-sm text-muted-foreground">HR hasn't entered any credentials for you yet. Give your documents to HR.</CardContent></Card> : (
        <ul className="space-y-3" data-testid="my-credentials">
          {certs.map((c) => {
            const f = files?.get(c.id), isOpen = open === c.id;
            return (
              <li key={c.id}><Card data-credential={c.certification_name}>
                <CardContent className="space-y-3 p-4">
                  <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)} data-testid="credential-toggle">
                    <span className="min-w-0">
                      <span className="block font-semibold">{c.certification_name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><ExpiryPill expiry={c.expiry_date} />
                        {f?.count ? `${f.count} file${f.count === 1 ? "" : "s"}` : "No files"}
                        {f?.waiting ? <Badge variant="outline" className="border-warning/50 bg-warning/15 text-foreground">Waiting for HR</Badge> : null}</span>
                    </span>
                    {isOpen ? <ChevronDown className="h-5 w-5 shrink-0" /> : <ChevronRight className="h-5 w-5 shrink-0" />}
                  </button>
                  {isOpen && <AttachmentsBlock kind="credential" parentId={c.id} />}
                </CardContent>
              </Card></li>
            );
          })}
        </ul>
      )}
    </CaregiverAppShell>
  );
}

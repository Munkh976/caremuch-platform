import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CaregiverCompliance } from "./CaregiverCompliance";

/**
 * Adds a "Credentials & Training" tab to the existing caregiver Details content (S3) when `enabled`
 * (training tier + the caregiver's office has the module). Otherwise renders the existing content
 * exactly as before.
 */
export function CaregiverDetailTabs({ enabled, caregiverId, initialTab = "overview", children }: {
  enabled: boolean; caregiverId: string; initialTab?: "overview" | "credentials"; children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Tabs defaultValue={initialTab}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="credentials">Credentials &amp; Training</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="mt-4">{children}</TabsContent>
      <TabsContent value="credentials" className="mt-4"><CaregiverCompliance caregiverId={caregiverId} /></TabsContent>
    </Tabs>
  );
}

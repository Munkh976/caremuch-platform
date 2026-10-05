import { useState } from "react";
import { FileStack } from "lucide-react";
import { ModuleShell } from "@/components/compliance/ModuleShell";
import { OfficePicker } from "@/components/compliance/OfficePicker";
import { ShellList } from "@/components/compliance/templates/ShellList";
import { MeasureLibrary } from "@/components/compliance/templates/MeasureLibrary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useComplianceOffices } from "@/hooks/useComplianceOffices";

/** /form-templates (S2): form shells with versions and the constrained editor, and the measure library. */
export default function FormTemplates() {
  const { moduleOffices } = useComplianceOffices();
  const [picked, setPicked] = useState<string | null>(null);
  const officeId = picked ?? moduleOffices[0]?.id ?? null;
  return (
    <ModuleShell
      title="Form Templates"
      description="Form shells (IPOS, progress notes, intake, authorization) with their versions, and the measure library."
      icon={FileStack}
      slice="S2"
    >
      <div className="space-y-4">
        <OfficePicker offices={moduleOffices} value={officeId} onChange={setPicked} />
        <Tabs defaultValue="shells">
          <TabsList>
            <TabsTrigger value="shells">Shells</TabsTrigger>
            <TabsTrigger value="measures">Measure library</TabsTrigger>
          </TabsList>
          <TabsContent value="shells" className="mt-4"><ShellList officeId={officeId} /></TabsContent>
          <TabsContent value="measures" className="mt-4"><MeasureLibrary /></TabsContent>
        </Tabs>
      </div>
    </ModuleShell>
  );
}

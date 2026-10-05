import { FileStack } from "lucide-react";
import { ModuleShell } from "@/components/compliance/ModuleShell";

/** /form-templates: form shells and the measure library. Built in slice S2. */
export default function FormTemplates() {
  return (
    <ModuleShell
      title="Form Templates"
      description="Form shells (IPOS, progress notes, intake, authorization) with their versions, and the measure library."
      icon={FileStack}
      slice="S2"
    />
  );
}

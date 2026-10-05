import { ClipboardCheck } from "lucide-react";
import { ModuleShell } from "@/components/compliance/ModuleShell";

/** /care-plans: client plans of service (IPOS). Built in slices S4-S6. */
export default function CarePlans() {
  return (
    <ModuleShell
      title="Client Care Plans (IPOS)"
      description="Plans of service, goals, authorizations, onboarding and progress notes for each client."
      icon={ClipboardCheck}
      slice="S4"
    />
  );
}

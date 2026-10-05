import { Receipt } from "lucide-react";
import { ModuleShell } from "@/components/compliance/ModuleShell";

/** /billing/weekly: weekly review and billing of progress notes. Built in slice S9. */
export default function WeeklyBilling() {
  return (
    <ModuleShell
      title="Weekly Billing"
      description="Review the week's progress notes, build the batch and mark it billed. Units only."
      icon={Receipt}
      slice="S9"
    />
  );
}

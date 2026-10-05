import { Card, CardContent } from "@/components/ui/card";
import type { PlanRowFull } from "./useCarePlanData";

/** Goals tab: arrives with slice S5. */
export function GoalsTab(_props: { clientId: string; officeId: string | null; plan: PlanRowFull | null; onChanged: () => void }) {
  return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Goals, objectives and measures. <span className="block pt-1 text-xs">Arrives with slice S5.</span></CardContent></Card>;
}

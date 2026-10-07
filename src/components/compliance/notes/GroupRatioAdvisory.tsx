import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { fetchGroupShifts, groupClients, GROUP_RATIO_LABEL, PREFERRED_CLIENTS } from "@/lib/groupRatio";

/** On a group-session note (S8 detail): "Above Ripple's preferred ratio (1:2)" when the caregiver has more than 2 clients
 *  in the session. Advisory only (S12). */
export function GroupRatioAdvisory({ groupSessionId, shiftId }: { groupSessionId: string; shiftId: string }) {
  const { data } = useQuery({ queryKey: ["group-shifts", groupSessionId], staleTime: 60_000, queryFn: () => fetchGroupShifts(groupSessionId) });
  const cg = data?.find((r) => r.shift_id === shiftId)?.caregiver_ids[0];
  const n = data && cg ? groupClients(data, cg) : 0;
  if (n <= PREFERRED_CLIENTS) return null;
  return <Badge variant="outline" className="ml-2 border-warning/40 text-warning" data-testid="group-ratio-advisory" data-clients={n}>{GROUP_RATIO_LABEL} · 1:{n}</Badge>;
}

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Heart, Users, CalendarClock, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCareTeam } from "@/lib/clientCareTeam";
import { FlexibilityBadge } from "@/components/common/FlexibilityBadge";
import { resolveClientFlexibility } from "@/lib/flexibility";


interface Caregiver {
  id: string;
  first_name: string;
  last_name: string; // last initial + "." (M-SEC-5: display-safe RPC)
  next_shift_date: string | null;
  shifts: number;
}

interface Props {
  clientId: string | null;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const initials = (c: { first_name: string; last_name: string }) =>
  `${c.first_name?.[0] ?? ""}${c.last_name?.[0] ?? ""}`.toUpperCase();

export const CareCircle = ({ clientId }: Props) => {
  const [primary, setPrimary] = useState<Caregiver | null>(null);
  const [backups, setBackups] = useState<Caregiver[]>([]);
  const [windows, setWindows] = useState<any[]>([]);
  const [flexibility, setFlexibility] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    const load = async () => {
      setLoading(true);

      const [{ data: client }, team, { data: requests }, { data: clientWindows }] =
        await Promise.all([
          supabase
            .from("clients")
            .select("preferred_caregiver_id, scheduling_flexibility")
            .eq("id", clientId)
            .maybeSingle(),
          // M-SEC-5: caregivers on this client's shifts + preferred caregiver, display-safe fields only
          fetchMyCareTeam().catch(() => []),
          supabase
            .from("care_requests")
            .select("id, flexibility, created_at")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(1),
          supabase
            .from("client_time_windows")
            .select("day_of_week, preferred_start, preferred_end, earliest_start, latest_end")
            .eq("client_id", clientId)
            .order("day_of_week"),
        ]);

      const people: Caregiver[] = team.map((m) => ({
        id: m.caregiver_id,
        first_name: m.first_name,
        last_name: m.last_initial ? `${m.last_initial}.` : "",
        next_shift_date: m.next_shift_date,
        shifts: m.shift_count,
      }));
      // Explicit designation wins; otherwise fall back to most assignments.
      const sorted = [...people].sort((a, b) => b.shifts - a.shifts);
      const preferred = team.find((m) => m.is_preferred);
      const chosen =
        (preferred ? people.find((p) => p.id === preferred.caregiver_id) : undefined) ?? sorted[0] ?? null;
      setPrimary(chosen);
      setBackups(sorted.filter((p) => p.id !== chosen?.id));

      // Single shared resolution rule: durable client value -> latest care request -> unset.
      const request = ((requests as any[]) ?? [])[0];
      let requestWindows: any[] = [];
      if (request?.id) {
        const { data: tw } = await supabase
          .from("care_request_time_windows")
          .select("day_of_week, preferred_start, preferred_end, earliest_start, latest_end")
          .eq("care_request_id", request.id)
          .order("day_of_week");
        requestWindows = (tw as any[]) ?? [];
      }

      const effective = resolveClientFlexibility({
        clientFlexibility: (client as any)?.scheduling_flexibility ?? null,
        clientWindows: (clientWindows as any[]) ?? [],
        requestFlexibility: request?.flexibility ?? null,
        requestWindows,
      });

      setFlexibility(effective.flexibility);
      setWindows(effective.windows);

      setLoading(false);
    };
    load();
  }, [clientId]);


  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading your care circle...</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-primary" /> Your primary caregiver
          </CardTitle>
          <CardDescription>The person who knows your routine best.</CardDescription>
        </CardHeader>
        <CardContent>
          {primary ? (
            <div className="flex items-center gap-4">
              <Avatar className="h-12 w-12">
                <AvatarFallback>{initials(primary)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">
                  {primary.first_name} {primary.last_name}
                </p>
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />
                    To reach your caregiver, contact your office.
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No caregiver assigned yet — your agency is arranging your care team.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Backup caregivers
          </CardTitle>
          <CardDescription>Familiar faces who cover when your primary caregiver is away.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {backups.length === 0 && (
            <p className="text-sm text-muted-foreground">No backup caregivers yet.</p>
          )}
          {backups.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback>{initials(c)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">
                    {c.first_name} {c.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground">{c.next_shift_date ? `Next visit ${c.next_shift_date}` : "—"}</p>
                </div>
              </div>
              <Badge variant="outline">{c.shifts} shift{c.shifts === 1 ? "" : "s"}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" /> Requested schedule
          </CardTitle>
          <CardDescription>The care times you asked for.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <FlexibilityBadge value={flexibility} showUnset />
          {windows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requested times on file.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {windows.map((w, i) => (
                <li key={i} className="flex justify-between rounded-md bg-muted/40 px-3 py-2">
                  <span>{DAYS[w.day_of_week] ?? w.day_of_week}</span>
                  <span className="text-muted-foreground">
                    {w.preferred_start?.slice(0, 5) ?? "—"} – {w.preferred_end?.slice(0, 5) ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

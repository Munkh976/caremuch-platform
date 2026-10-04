import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, Star, Building2 } from "lucide-react";
import { fetchMyCareTeam, displayName, type CareTeamMember } from "@/lib/clientCareTeam";
import { toast } from "sonner";

interface CareTeamProps {
  clientId: string | null;
}

export const CareTeam = ({ clientId }: CareTeamProps) => {
  const [caregivers, setCaregivers] = useState<CareTeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (clientId) {
      fetchCaregivers();
    }
  }, [clientId]);

  const fetchCaregivers = async () => {
    if (!clientId) return;

    try {
      // M-SEC-5: one display-safe RPC, scoped to the signed-in client server-side. The old path
      // read shift_assignments, which clients cannot see, so this tab was always empty.
      setCaregivers(await fetchMyCareTeam());
    } catch (error: any) {
      toast.error("Failed to load care team");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (c: CareTeamMember) => `${c.first_name.charAt(0)}${c.last_initial ?? ""}`.toUpperCase();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold">Care Team</h2>
        <p className="text-sm text-muted-foreground">Your assigned caregivers</p>
      </div>

      {caregivers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No caregivers assigned yet</p>
            <p className="text-sm text-muted-foreground">Your care team will appear here once shifts are assigned</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {caregivers.map((caregiver) => (
            <Card key={caregiver.caregiver_id} className="hover-scale">
              <CardHeader>
                <div className="flex items-start gap-4">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {getInitials(caregiver)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <CardTitle className="text-lg">
                      {displayName(caregiver)}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {(caregiver.employment_role ?? 'caregiver').replace('_', ' ')}
                      </Badge>
                      {caregiver.avg_rating != null ? (
                        <div className="flex items-center gap-1">
                          <Star className="h-3 w-3 fill-primary text-primary" />
                          <span className="text-xs">
                            {caregiver.avg_rating.toFixed(1)} ({caregiver.rating_count})
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No ratings yet</span>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Building2 className="h-4 w-4" />
                  <span>To reach your caregiver, contact your office.</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

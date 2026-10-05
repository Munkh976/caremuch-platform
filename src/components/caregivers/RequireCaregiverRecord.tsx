import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { roleHome } from "@/lib/roleHome";
import { useCaregiverRecord, useSessionUserId } from "./useCaregiverApp";

/**
 * Route guard for the caregiver app (CLAUDE.md rule 15; owner decision Oct 5). Requires a LINKED
 * CAREGIVER RECORD — an active caregivers row with user_id = auth.uid() in the user's agency — not a
 * role ranking: get_user_role collapses a staff + caregiver user to the staff role, which would lock them
 * out of their own caregiver app. A dual-role user therefore reaches both UIs (role switcher: known issue).
 *   - no session            -> /auth?next=<this path>
 *   - no caregiver record   -> the user's role home with a toast (a caregiver-role user whose record is
 *                              missing gets a message instead, so the redirect can't loop)
 * UX / defence in depth only: the caregiver RPCs check the caller's caregiver row themselves.
 */
export function RequireCaregiverRecord({ children }: { children: ReactNode }) {
  const location = useLocation();
  const userId = useSessionUserId();
  const record = useCaregiverRecord(userId);
  const [home, setHome] = useState<string | null | undefined>(undefined);
  const noRecord = !!userId && record.isSuccess && record.data === null;

  useEffect(() => {
    if (!noRecord) return;
    let cancelled = false;
    supabase.rpc("get_user_role", { _user_id: userId as string }).then(({ data: role }) => {
      if (cancelled) return;
      const to = role ? roleHome(role) : "/auth";
      setHome(to);
      if (role && role !== "caregiver") toast.error("You don't have access to that page");
    });
    return () => { cancelled = true; };
  }, [noRecord, userId]);

  if (userId === null) return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (record.data) return <>{children}</>;
  if (noRecord && home !== undefined) {
    if (home && home !== "/caregiver-dashboard") return <Navigate to={home} replace />;
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center" data-testid="caregiver-record-missing">
        <p className="max-w-sm text-sm text-muted-foreground">Your caregiver profile isn't linked to this login yet. Please contact your agency office.</p>
      </div>
    );
  }
  if (record.isError) {
    return <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">Something went wrong loading your profile. Please reload.</div>;
  }
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolves whether the signed-in user IS a caregiver (has their own `caregivers` row) --
 * not just whether their role happens to have read permission on a caregiver-portal
 * module. `available_shifts` in particular also grants read to manager/scheduler/
 * agency_admin/system_admin (role_permissions), so the module-permission check alone
 * can't tell us which shell chrome to render.
 *
 * Used by caregiver-portal pages that are reachable by other roles too, to pick
 * CaregiverAppShell (bottom tabs) vs. the manager AppLayout (sidebar) -- see
 * docs/caregiver-app-design.md. `null` while unresolved; defaults to treating the page
 * as a caregiver's during that brief window since that's the overwhelming majority of
 * real traffic to these routes.
 */
export function useIsCaregiverRole(): boolean | null {
  const [isCaregiver, setIsCaregiver] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsCaregiver(false);
        return;
      }
      const { data } = await supabase.from("caregivers").select("id").eq("user_id", user.id).maybeSingle();
      setIsCaregiver(!!data);
    })();
  }, []);

  return isCaregiver;
}

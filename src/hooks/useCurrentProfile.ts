import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/roleHome";

export interface CurrentProfile {
  userId: string;
  agencyId: string | null;
  /** The user's office (M-Office). Restricted users act only inside it. */
  officeId: string | null;
  officeRestricted: boolean;
  /** Highest role (get_user_role), as used by RequireRole and the menu. */
  role: AppRole | null;
  /** Every role row the user holds. */
  roles: AppRole[];
}

/** The signed-in user's id, kept in sync with auth changes (so the cache never mixes users). */
function useSessionUserId(): string | null | undefined {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setUserId(data.session?.user.id ?? null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);
  return userId;
}

/**
 * Agency, office, office restriction and roles of the signed-in user. Reads only the user's own
 * profile and role rows (their own-row RLS policies). For display and gating only: RLS and the RPC
 * checks remain the enforcement.
 */
export function useCurrentProfile() {
  const userId = useSessionUserId();
  const query = useQuery({
    queryKey: ["current-profile", userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CurrentProfile> => {
      const uid = userId as string;
      const [profile, roleRows, top] = await Promise.all([
        supabase.from("profiles").select("agency_id, virtual_office_id, office_restricted").eq("id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.rpc("get_user_role", { _user_id: uid }),
      ]);
      if (profile.error) throw profile.error;
      if (roleRows.error) throw roleRows.error;
      return {
        userId: uid,
        agencyId: profile.data?.agency_id ?? null,
        officeId: profile.data?.virtual_office_id ?? null,
        officeRestricted: profile.data?.office_restricted === true,
        role: (top.data as AppRole | null) ?? null,
        roles: (roleRows.data ?? []).map((r) => r.role as AppRole),
      };
    },
  });
  return {
    ...query,
    profile: query.data ?? null,
    signedOut: userId === null,
    // A disabled query (session not known yet) is not "loading" in react-query v5, so say it here:
    // loading until the session is known and, when signed in, until the profile has arrived.
    isLoading: userId === undefined || (!!userId && query.isPending),
  };
}

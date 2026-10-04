import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { roleHome, type AppRole } from "@/lib/roleHome";

/**
 * Route-level role guard (security plan §1.2 / §14). Same mechanism the pages already use
 * (getSession + get_user_role, as in Clients.tsx), lifted to the router so a page can't forget it:
 *   - no session          -> /auth?next=<this path>
 *   - no role (pending)   -> /auth (Auth.tsx shows the "pending approval" message)
 *   - role not in `allow` -> that role's home (caregiver -> /caregiver-dashboard, client ->
 *                            /client-dashboard, ...) with a toast
 * Renders nothing but a spinner until resolved, so no staff content flashes for a denied user.
 * This is UX / defence in depth — RLS and the SECURITY DEFINER RPC checks remain the enforcement.
 */
export function RequireRole({ allow, children }: { allow: readonly AppRole[]; children: ReactNode }) {
  const location = useLocation();
  const [verdict, setVerdict] = useState<{ ok: true } | { to: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVerdict(null);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const next = encodeURIComponent(location.pathname + location.search);
        if (!cancelled) setVerdict({ to: `/auth?next=${next}` });
        return;
      }
      const { data: role } = await supabase.rpc("get_user_role", { _user_id: session.user.id });
      if (cancelled) return;
      if (!role) {
        setVerdict({ to: "/auth" });
        return;
      }
      if (!allow.includes(role as AppRole)) {
        toast.error("You don't have access to that page");
        setVerdict({ to: roleHome(role) });
        return;
      }
      setVerdict({ ok: true });
    })();
    return () => { cancelled = true; };
  }, [location.pathname, location.search, allow]);

  if (!verdict) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }
  if ("to" in verdict) return <Navigate to={verdict.to} replace />;
  return <>{children}</>;
}

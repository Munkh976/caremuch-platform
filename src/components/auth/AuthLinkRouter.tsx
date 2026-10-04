import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Captured when this module is first evaluated, before supabase-js finishes consuming the
// "#access_token=…&type=invite|recovery" fragment of a one-time link.
const INITIAL_LINK_TYPE = /[#&]type=(invite|recovery)\b/.exec(window.location.hash)?.[1] ?? null;

// In memory only (never storage): did this page load arrive through a one-time invite/recovery
// link, or receive a PASSWORD_RECOVERY event? /auth/set-password requires it (owner point D).
let linkArrival: "invite" | "recovery" | null = INITIAL_LINK_TYPE as "invite" | "recovery" | null;
export const arrivedViaPasswordLink = () => linkArrival !== null;

/** Remove auth tokens from the address bar (and history) once supabase-js has read them. */
function stripTokensFromUrl() {
  if (/(access_token|refresh_token|type=(invite|recovery))/.test(window.location.hash)) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }
}

/**
 * One-time invite / recovery links (security plan §15):
 *  - sends the person to /auth/set-password (also when Supabase fell back to the Site URL);
 *  - as soon as the session from the link is established, strips the tokens from the URL with
 *    history.replaceState so they don't linger in the address bar or history.
 * Renders nothing.
 */
export function AuthLinkRouter() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (INITIAL_LINK_TYPE && location.pathname !== "/auth/set-password") {
      // Keep the fragment: supabase-js may not have read the tokens yet. They are stripped below,
      // only once the session exists.
      navigate({ pathname: "/auth/set-password", hash: window.location.hash }, { replace: true });
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        linkArrival = "recovery";
        if (window.location.pathname !== "/auth/set-password") navigate("/auth/set-password", { replace: true });
      }
      // Tokens have been consumed once a session exists — clear them from the URL right away.
      if (session) stripTokensFromUrl();
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

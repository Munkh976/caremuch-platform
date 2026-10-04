import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { canActOn, hasCallerRole, loadPrincipal, MANAGER_OR_ABOVE } from "../_shared/authz.ts";
import { recoveryLink, setPasswordRedirect } from "../_shared/accountLinks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create client with anon key to verify user JWT
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Create admin client for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Get the authenticated user from the request using anon client
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Owner rule A (M-SEC-2b): caller must be manager, agency_admin or system_admin, judged by the
    // highest of ALL the caller's role rows (same ranking as the target).
    const caller = await loadPrincipal(supabaseAdmin, user.id);
    if (!hasCallerRole(caller, MANAGER_OR_ABOVE)) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Issue 2 Mode B (security plan §15): staff no longer type a password for someone else.
    // The function returns a one-time recovery link (shown once, never stored). By default the
    // current password is also invalidated (set to a random value nobody sees), so a leaked or
    // temporary password stops working at once; `keepCurrentPassword: true` skips that step.
    const { userId, newPassword, keepCurrentPassword } = await req.json();

    if (newPassword !== undefined) {
      return new Response(JSON.stringify({ error: "Typed passwords are no longer accepted. A one-time reset link is generated instead." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // M-SEC-2b: the target must be in the caller's agency (system_admin exempt) and rank
    // strictly below the caller. Previously only agency_admin -> system_admin was refused, so a
    // manager could reset a system_admin's or agency_admin's password, in any agency.
    const target = await loadPrincipal(supabaseAdmin, userId);
    const verdict = canActOn(caller, target, userId);
    if (!verdict.ok) {
      return new Response(JSON.stringify({ error: verdict.error }), {
        status: verdict.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: targetUser, error: targetError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (targetError || !targetUser?.user?.email) {
      return new Response(JSON.stringify({ error: "You do not have permission to manage this user" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (keepCurrentPassword !== true) {
      const random = crypto.getRandomValues(new Uint8Array(32));
      const unknownPassword = btoa(String.fromCharCode(...random)); // never returned, logged or stored
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: unknownPassword });
      if (updateError) throw updateError;
    }

    const resetLink = await recoveryLink(supabaseAdmin, {
      email: targetUser.user.email, redirectTo: setPasswordRedirect(req),
      agencyId: target?.agencyId ?? caller.agencyId, actorId: caller.id, targetUserId: userId, fn: 'admin-reset-password',
    });

    // resetLink is returned ONCE to the staff member who asked; it is not stored or logged.
    return new Response(
      JSON.stringify({ success: true, resetLink, currentPasswordInvalidated: keepCurrentPassword !== true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

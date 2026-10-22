// Security hotfix (Oct 21): diagnostic / evaluation functions (rag-eval-harness, embedding-provider-check) were callable
// with only the public anon key. They now require a signed-in system_admin (all of the caller's roles, as loadPrincipal
// reads them). Returns a Response to send back when the caller is not allowed, or null to continue.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { loadPrincipal } from "./authz.ts";

export async function requireSystemAdmin(req: Request, corsHeaders: Record<string, string>): Promise<Response | null> {
  const deny = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return deny(401, "Unauthorized");
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error } = await admin.auth.getUser(auth.slice(7));
  if (error || !user) return deny(401, "Unauthorized");
  const p = await loadPrincipal(admin, user.id);
  if (!p || p.role !== "system_admin") return deny(403, "Not allowed");
  return null;
}

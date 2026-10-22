import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
        auth: {
          persistSession: false,
        },
      }
    );

    // Verify user authentication and admin role
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { data: roleData, error: roleError } = await supabaseClient.rpc("get_user_role", {
      _user_id: user.id,
    });

    // Security hotfix (Oct 21): platform-wide (every agency, every auth user) -> system_admin only, never agency_admin
    if (roleError || roleData !== "system_admin") {
      throw new Error("Insufficient permissions");
    }

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

    // Delete all data from tables in reverse dependency order
    const tables = [
      'shift_assignments',
      'shift_trades',
      'time_off_requests',
      'shifts',
      'client_orders',
      'caregiver_skills',
      'caregiver_availability',
      'caregiver_certifications',
      'client_care_needs',
      'caregivers',
      'clients',
      'care_needs',
      'care_types',
      'user_roles',
      'profiles',
    ];

    const results = {
      deleted: [] as string[],
      errors: [] as any[],
    };

    for (const table of tables) {
      try {
        const { error } = await supabaseAdmin
          .from(table)
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (error) {
          results.errors.push({ table, error: error.message });
        } else {
          results.deleted.push(table);
        }
      } catch (error) {
        results.errors.push({ 
          table, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    // Delete auth users (except the current admin)
    try {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers();
      
      if (users?.users) {
        for (const u of users.users) {
          if (u.id !== user.id) {
            await supabaseAdmin.auth.admin.deleteUser(u.id);
          }
        }
      }
    } catch (error) {
      console.error("Error deleting users:", error);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Database reset complete. Deleted data from ${results.deleted.length} tables.`,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});

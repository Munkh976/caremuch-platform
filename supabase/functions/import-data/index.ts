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

    const { data: importData } = await req.json();

    if (!importData || typeof importData !== 'object') {
      throw new Error("Invalid import data format");
    }

    // Import data in correct dependency order
    const tableOrder = [
      'care_types',
      'care_needs',
      'caregivers',
      'clients',
      'caregiver_skills',
      'caregiver_availability',
      'caregiver_certifications',
      'client_care_needs',
      'client_orders',
      'shifts',
      'shift_assignments',
      'time_off_requests',
      'shift_trades',
    ];

    const results = {
      imported: [] as any[],
      errors: [] as any[],
    };

    for (const table of tableOrder) {
      if (!importData[table] || !Array.isArray(importData[table])) {
        continue;
      }

      const records = importData[table];
      if (records.length === 0) {
        continue;
      }

      try {
        const { data, error } = await supabaseAdmin
          .from(table)
          .insert(records)
          .select();

        if (error) {
          results.errors.push({
            table,
            count: records.length,
            error: error.message,
          });
        } else {
          results.imported.push({
            table,
            count: data?.length || records.length,
          });
        }
      } catch (error) {
        results.errors.push({
          table,
          count: records.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const totalImported = results.imported.reduce((sum, item) => sum + item.count, 0);
    const totalErrors = results.errors.length;

    return new Response(
      JSON.stringify({
        success: totalErrors === 0,
        message: `Import complete. Imported ${totalImported} records from ${results.imported.length} tables${
          totalErrors > 0 ? ` with ${totalErrors} errors` : ''
        }.`,
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

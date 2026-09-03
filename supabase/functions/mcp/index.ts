// supabase function: mcp
// Bundled from src/lib/mcp/index.ts by @lovable.dev/mcp-js.
// src/lib/mcp/index.ts
import { auth, defineMcp } from "npm:@lovable.dev/mcp-js@0.24.0";

// src/lib/mcp/tools/whoami.ts
import { defineTool } from "npm:@lovable.dev/mcp-js@0.24.0";

// src/lib/mcp/supabase.ts
import { createClient } from "npm:@supabase/supabase-js@^2.77.0";
function supabaseForUser(ctx) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

// src/lib/mcp/tools/whoami.ts
var whoami_default = defineTool({
  name: "whoami",
  title: "Who am I",
  description: "Return the signed-in user's id, email and role in CareMuch.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.rpc("get_user_role", { _user_id: ctx.getUserId() });
    if (error) return errorResult(error.message);
    return textResult({ user_id: ctx.getUserId(), email: ctx.getUserEmail(), role: data });
  }
});

// src/lib/mcp/tools/list-shifts.ts
import { defineTool as defineTool2 } from "npm:@lovable.dev/mcp-js@0.24.0";
import { z } from "npm:zod@^3.25.76";
var list_shifts_default = defineTool2({
  name: "list_shifts",
  title: "List shifts",
  description: "List care shifts visible to the signed-in user, optionally filtered by date range and status.",
  inputSchema: {
    from_date: z.string().optional().describe("Earliest shift date, YYYY-MM-DD."),
    to_date: z.string().optional().describe("Latest shift date, YYYY-MM-DD."),
    status: z.string().optional().describe("Shift status filter, e.g. open, assigned, completed."),
    limit: z.number().int().optional().describe("Max rows to return (default 50).")
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from_date, to_date, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let query = supabaseForUser(ctx).from("shifts").select("id, shift_date, start_time, end_time, duration_hours, status, care_type_code, order_title, client_id, caregiver_id, pay_rate").order("shift_date", { ascending: true }).limit(Math.min(limit ?? 50, 200));
    if (from_date) query = query.gte("shift_date", from_date);
    if (to_date) query = query.lte("shift_date", to_date);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return textResult({ shifts: data });
  }
});

// src/lib/mcp/tools/list-caregivers.ts
import { defineTool as defineTool3 } from "npm:@lovable.dev/mcp-js@0.24.0";
import { z as z2 } from "npm:zod@^3.25.76";
var list_caregivers_default = defineTool3({
  name: "list_caregivers",
  title: "List caregivers",
  description: "List caregivers visible to the signed-in user, optionally filtered by name or city.",
  inputSchema: {
    search: z2.string().optional().describe("Match against caregiver first or last name."),
    city: z2.string().optional().describe("Filter by caregiver city."),
    limit: z2.number().int().optional().describe("Max rows to return (default 50).")
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, city, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let query = supabaseForUser(ctx).from("caregivers").select("id, first_name, last_name, email, phone, role, city, state, skills, certifications, reliability_score, hourly_rate, is_active").limit(Math.min(limit ?? 50, 200));
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    if (city) query = query.ilike("city", city);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return textResult({ caregivers: data });
  }
});

// src/lib/mcp/tools/list-clients.ts
import { defineTool as defineTool4 } from "npm:@lovable.dev/mcp-js@0.24.0";
import { z as z3 } from "npm:zod@^3.25.76";
var list_clients_default = defineTool4({
  name: "list_clients",
  title: "List clients",
  description: "List care clients visible to the signed-in user, optionally filtered by name.",
  inputSchema: {
    search: z3.string().optional().describe("Match against client first or last name."),
    limit: z3.number().int().optional().describe("Max rows to return (default 50).")
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let query = supabaseForUser(ctx).from("clients").select("id, first_name, last_name, email, phone, city, state, zip_code, care_requirements, medical_conditions").limit(Math.min(limit ?? 50, 200));
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return textResult({ clients: data });
  }
});

// src/lib/mcp/tools/list-time-off-requests.ts
import { defineTool as defineTool5 } from "npm:@lovable.dev/mcp-js@0.24.0";
import { z as z4 } from "npm:zod@^3.25.76";
var list_time_off_requests_default = defineTool5({
  name: "list_time_off_requests",
  title: "List time off requests",
  description: "List caregiver time off requests visible to the signed-in user, optionally filtered by status.",
  inputSchema: {
    status: z4.string().optional().describe("Request status filter, e.g. pending, approved, denied."),
    limit: z4.number().int().optional().describe("Max rows to return (default 50).")
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let query = supabaseForUser(ctx).from("time_off_requests").select("id, caregiver_id, request_type, status, start_date, end_date, reason, notes, created_at").order("start_date", { ascending: false }).limit(Math.min(limit ?? 50, 200));
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return textResult({ requests: data });
  }
});

// src/lib/mcp/tools/assign-caregiver-to-shift.ts
import { defineTool as defineTool6 } from "npm:@lovable.dev/mcp-js@0.24.0";
import { z as z5 } from "npm:zod@^3.25.76";
var assign_caregiver_to_shift_default = defineTool6({
  name: "assign_caregiver_to_shift",
  title: "Assign caregiver to shift",
  description: "Assign a caregiver to an existing shift and mark the shift as assigned.",
  inputSchema: {
    shift_id: z5.string().describe("The shift id (uuid)."),
    caregiver_id: z5.string().describe("The caregiver id (uuid) to assign.")
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ shift_id, caregiver_id }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const client = supabaseForUser(ctx);
    const { error: assignError } = await client.rpc("assign_caregiver_to_shift", {
      _shift_id: shift_id,
      _caregiver_id: caregiver_id,
      _method: "manual",
      _notes: null,
      _override_reason: null
    });
    if (assignError) return errorResult(assignError.message);
    const { data, error } = await client.from("shifts").select("id, shift_date, start_time, end_time, status, caregiver_id").eq("id", shift_id);
    if (error) return errorResult(error.message);
    if (!data?.length) return errorResult("Shift not found or you do not have permission to update it.");
    return textResult({ shift: data[0] });
  }
});

// src/lib/mcp/index.ts
var projectRef = "jipsobxiblzgivjmtwtq";
var mcp_default = defineMcp({
  name: "caremuch-mcp",
  title: "CareMuch MCP",
  version: "0.1.0",
  instructions: "Tools for CareMuch, a home-care scheduling app. Read shifts, caregivers, clients and time off requests, and assign caregivers to shifts. All calls act as the signed-in CareMuch user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated"
  }),
  tools: [whoami_default, list_shifts_default, list_caregivers_default, list_clients_default, list_time_off_requests_default, assign_caregiver_to_shift_default]
});

// lovable-mcp-supabase-entry.ts
import { createSupabaseHandler } from "npm:@lovable.dev/mcp-js@0.24.0/stacks/supabase";
Deno.serve(createSupabaseHandler(mcp_default, { functionName: "mcp" }));

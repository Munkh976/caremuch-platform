import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Legacy shared-tenant id — same sentinel used in approve-caregiver-registration
// and enable-client-login.
const LEGACY_SYSTEM_AGENCY_ID = '00000000-0000-0000-0000-000000000000';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !caller) return json({ error: 'Unauthorized' }, 401);

    // M-SEC-2b: system_admin only. This backfill scans every agency's unlinked caregivers and
    // clients, so an agency_admin run used to link (and move profiles for) other tenants' records.
    // Its only caller is the system_admin-only AdminUtilities page.
    const { data: callerRole } = await admin.rpc('get_user_role', { _user_id: caller.id });
    if (callerRole !== 'system_admin') {
      return json({ error: 'Only a system administrator can run the account backfill' }, 403);
    }

    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const byEmail = new Map<string, string>();
    for (const u of usersPage?.users ?? []) {
      if (u.email) byEmail.set(u.email.toLowerCase(), u.id);
    }

    let caregiversLinked = 0;
    let clientsLinked = 0;

    // Same guard as approve-caregiver-registration/enable-client-login: don't link a
    // caregiver/client to an existing auth user whose profile already belongs to a
    // different real agency, and bring profiles.agency_id in sync whenever we do link
    // (this function previously never touched profiles.agency_id at all).
    const skipped: { type: 'caregiver' | 'client'; id: string; email: string | null; reason: string }[] = [];
    // M-SEC-2b: link only when the matched account ALREADY belongs to the record's agency. Never
    // relink (move) a profile whose agency is NULL, the legacy shared tenant, missing, or another
    // agency — those are reported in `skipped` for manual review instead of being moved, which
    // closed the "plant a record with the victim's email, then run the backfill" capture path.
    const linkIfSafe = async (uid: string, recordAgencyId: string) => {
      const { data: existingProfile } = await admin
        .from('profiles').select('agency_id').eq('id', uid).maybeSingle();
      if (!existingProfile) {
        return { ok: false as const, reason: 'Matched account has no profile; review manually' };
      }
      if (!existingProfile.agency_id || existingProfile.agency_id === LEGACY_SYSTEM_AGENCY_ID) {
        return { ok: false as const, reason: 'Matched account has no agency (NULL/legacy); review manually' };
      }
      if (existingProfile.agency_id !== recordAgencyId) {
        return { ok: false as const, reason: 'Matched account is already linked to another agency' };
      }
      return { ok: true as const };
    };

    const { data: caregivers } = await admin
      .from('caregivers').select('id, email, agency_id').is('user_id', null);
    for (const c of caregivers ?? []) {
      const uid = c.email ? byEmail.get(c.email.toLowerCase()) : undefined;
      if (!uid) continue;
      const result = await linkIfSafe(uid, c.agency_id);
      if (!result.ok) { skipped.push({ type: 'caregiver', id: c.id, email: c.email, reason: result.reason }); continue; }
      await admin.from('caregivers').update({ user_id: uid }).eq('id', c.id);
      await admin.from('user_roles')
        .upsert({ user_id: uid, role: 'caregiver', agency_id: c.agency_id }, { onConflict: 'user_id,role' });
      caregiversLinked++;
    }

    const { data: clients } = await admin
      .from('clients').select('id, email, agency_id').is('user_id', null);
    for (const c of clients ?? []) {
      const uid = c.email ? byEmail.get(c.email.toLowerCase()) : undefined;
      if (!uid) continue;
      const result = await linkIfSafe(uid, c.agency_id);
      if (!result.ok) { skipped.push({ type: 'client', id: c.id, email: c.email, reason: result.reason }); continue; }
      await admin.from('clients').update({ user_id: uid }).eq('id', c.id);
      await admin.from('user_roles')
        .upsert({ user_id: uid, role: 'client', agency_id: c.agency_id }, { onConflict: 'user_id,role' });
      clientsLinked++;
    }

    return json({ success: true, caregiversLinked, clientsLinked, skipped });
  } catch (error) {
    console.error('link-existing-accounts error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

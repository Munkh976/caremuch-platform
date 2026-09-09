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

    // Guard (a): authenticate + role-check the caller.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !caller) return json({ error: 'Unauthorized' }, 401);

    const { data: callerRole } = await admin.rpc('get_user_role', { _user_id: caller.id });
    if (!callerRole || !['system_admin', 'agency_admin', 'manager'].includes(callerRole)) {
      return json({ error: 'You do not have permission to create caregiver logins' }, 403);
    }

    // Guard (b): resolve the caller's OWN agency_id server-side -- never from a parameter.
    const { data: callerProfile } = await admin
      .from('profiles').select('agency_id').eq('id', caller.id).single();
    if (!callerProfile?.agency_id) return json({ error: 'Your profile is missing an agency' }, 400);
    const agencyId = callerProfile.agency_id as string;

    const body = await req.json().catch(() => ({}));
    const caregiverId: string | undefined = body.caregiverId;
    const emailOverride: string | undefined = body.email;
    if (!caregiverId) return json({ error: 'caregiverId is required' }, 400);

    const { data: caregiver, error: caregiverError } = await admin
      .from('caregivers').select('*').eq('id', caregiverId).single();
    if (caregiverError || !caregiver) return json({ error: 'Caregiver not found' }, 404);
    if (caregiver.agency_id !== agencyId && callerRole !== 'system_admin') {
      return json({ error: 'Caregiver belongs to another agency' }, 403);
    }
    if (caregiver.user_id) return json({ error: 'This caregiver already has a login' }, 400);

    // caregivers.email is NOT NULL in the schema (unlike clients.email, which is
    // optional), so there is no "add an email first" branch here -- but keep a
    // defensive check in case of legacy blank/whitespace data.
    const email = (emailOverride ?? caregiver.email ?? '').trim().toLowerCase();
    if (!email) return json({ error: 'This caregiver has no email address on file.' }, 400);

    const fullName = `${caregiver.first_name} ${caregiver.last_name}`;
    let userId: string | null = null;
    let tempPassword: string | null = null;

    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existingUser = usersPage?.users?.find((u) => (u.email ?? '').toLowerCase() === email);

    if (existingUser) {
      userId = existingUser.id;
    } else {
      tempPassword = `Care-${crypto.randomUUID().slice(0, 10)}`;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, agency_id: agencyId },
      });
      if (createError || !created.user) return json({ error: createError?.message ?? 'Failed to create account' }, 400);
      userId = created.user.id;
      await new Promise((r) => setTimeout(r, 400));
    }

    // Guard (c): an existing auth user (matched by email, which Supabase enforces
    // globally-unique) must not be silently reassigned to a different agency's
    // profile just because this agency ran caregiver-login enable. Same guard as
    // approve-caregiver-registration:148 and enable-client-login:83.
    const { data: existingProfile } = await admin
      .from('profiles').select('agency_id').eq('id', userId).maybeSingle();
    if (existingProfile?.agency_id && ![agencyId, LEGACY_SYSTEM_AGENCY_ID].includes(existingProfile.agency_id)) {
      return json({ error: 'An account with this email is already linked to another agency' }, 400);
    }

    // Guard (d): upsert profiles/user_roles with the CALLER's agency_id, never a
    // client-supplied one.
    await admin.from('profiles').upsert({
      id: userId,
      email,
      full_name: fullName,
      phone: caregiver.phone,
      agency_id: agencyId,
    }, { onConflict: 'id' });

    const { error: linkError } = await admin.from('caregivers')
      .update({ user_id: userId, email }).eq('id', caregiverId);
    if (linkError) return json({ error: linkError.message }, 400);

    await admin.from('user_roles')
      .upsert({ user_id: userId, role: 'caregiver', agency_id: agencyId }, { onConflict: 'user_id,role' });

    await admin.from('pending_notifications').insert({
      agency_id: agencyId,
      recipient_email: email,
      recipient_name: fullName,
      kind: 'caregiver_login_created',
      subject: 'Your CareMuch account is ready',
      body: `Hi ${caregiver.first_name}, an account was created for you.${tempPassword ? ` Temporary password: ${tempPassword}` : ' Use your existing password to sign in.'}`,
      payload: { caregiver_id: caregiverId, temp_password: tempPassword },
    });

    return json({ success: true, userId, email, tempPassword });
  } catch (error) {
    console.error('enable-caregiver-login error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

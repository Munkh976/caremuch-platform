import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { hasCallerRole, loadPrincipal, MANAGER_OR_ABOVE } from "../_shared/authz.ts";
import {
  checkExistingAccount, findAuthUserIdByEmail, inviteNewUser, linkHandedOverNote, setPasswordRedirect,
} from "../_shared/accountLinks.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Issue 2 Mode B + 🟠 fixes (security plan §15):
//  - no temporary password: a NEW account gets a one-time invite link, returned once in the response
//    and never stored (pending_notifications keeps an audit line without any secret);
//  - the agency comes from the CAREGIVER RECORD (a system_admin acting on another agency no longer
//    stamps its own agency on the account);
//  - no `email` override: the caregiver's own email is used (change it on the caregiver first);
//  - an EXISTING auth user is linked only if its profile is already in that agency
//    (NULL/legacy profiles: system_admin only) and its agency is never overwritten.
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

    const callerP = await loadPrincipal(admin, caller.id);
    if (!hasCallerRole(callerP, MANAGER_OR_ABOVE)) {
      return json({ error: 'You do not have permission to create caregiver logins' }, 403);
    }
    const isSystemAdmin = callerP.role === 'system_admin';
    if (!isSystemAdmin && !callerP.agencyId) return json({ error: 'Your profile is missing an agency' }, 400);

    const body = await req.json().catch(() => ({}));
    const caregiverId: string | undefined = body.caregiverId;
    if (!caregiverId) return json({ error: 'caregiverId is required' }, 400);
    if (body.email !== undefined) {
      return json({ error: "The login uses the caregiver's own email. Update the caregiver's email first." }, 400);
    }

    const { data: caregiver, error: caregiverError } = await admin
      .from('caregivers').select('id, agency_id, user_id, email, first_name, last_name, phone').eq('id', caregiverId).single();
    if (caregiverError || !caregiver) return json({ error: 'Caregiver not found' }, 404);
    if (!isSystemAdmin && caregiver.agency_id !== callerP.agencyId) {
      return json({ error: 'Caregiver belongs to another agency' }, 403);
    }
    if (caregiver.user_id) return json({ error: 'This caregiver already has a login' }, 400);
    const agencyId = caregiver.agency_id as string;

    const email = (caregiver.email ?? '').trim().toLowerCase();
    if (!email) return json({ error: 'This caregiver has no email address. Add one first.' }, 400);
    const fullName = `${caregiver.first_name} ${caregiver.last_name}`;

    let userId = await findAuthUserIdByEmail(admin, email);
    let setPasswordLink: string | null = null;

    if (userId) {
      const verdict = await checkExistingAccount(admin, userId, agencyId, isSystemAdmin);
      if (!verdict.ok) return json({ error: verdict.error }, verdict.status);
      // Existing account: fill name/phone, set the agency only if it had none (system_admin path).
      const patch: Record<string, unknown> = { id: userId, email, full_name: fullName, phone: caregiver.phone };
      if (!verdict.profileAgencyId) patch.agency_id = agencyId;
      await admin.from('profiles').upsert(patch, { onConflict: 'id' });
    } else {
      const invited = await inviteNewUser(admin, { email, fullName, agencyId, redirectTo: setPasswordRedirect(req), actorId: caller.id, fn: 'enable-caregiver-login' });
      userId = invited.userId;
      setPasswordLink = invited.link;
      await new Promise((r) => setTimeout(r, 400)); // handle_new_user creates the profile from metadata
      await admin.from('profiles').upsert({ id: userId, email, full_name: fullName, phone: caregiver.phone, agency_id: agencyId }, { onConflict: 'id' });
    }

    const { error: linkError } = await admin.from('caregivers').update({ user_id: userId }).eq('id', caregiverId);
    if (linkError) return json({ error: linkError.message }, 400);

    await admin.from('user_roles')
      .upsert({ user_id: userId, role: 'caregiver', agency_id: agencyId }, { onConflict: 'user_id,role' });

    await admin.from('pending_notifications').insert({
      agency_id: agencyId,
      recipient_email: email,
      recipient_name: fullName,
      kind: 'caregiver_login_created',
      subject: 'Your CareMuch account is ready',
      body: linkHandedOverNote(caregiver.first_name, setPasswordLink ? 'invite' : 'existing'),
      payload: { caregiver_id: caregiverId, delivery: setPasswordLink ? 'set_password_link_shown_once' : 'existing_account' },
    });

    // setPasswordLink is returned ONCE to the staff member who asked; it is not stored or logged.
    return json({ success: true, userId, email, setPasswordLink, existingAccount: !setPasswordLink });
  } catch (error) {
    console.error('enable-caregiver-login error:', error instanceof Error ? error.message : 'unknown');
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

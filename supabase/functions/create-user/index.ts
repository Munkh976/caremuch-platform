import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { CREATABLE_ROLES, hasCallerRole, loadPrincipal, MANAGER_OR_ABOVE, pick, STAFF_ROLES } from "../_shared/authz.ts";
import { findAuthUserIdByEmail, inviteNewUser, setPasswordRedirect } from "../_shared/accountLinks.ts";

// Caller-supplied userData columns allowed on the new record (M-SEC-2b). Everything else —
// id, user_id, agency_id, virtual_office_id, is_active, preferred_caregiver_id, rates set by
// other paths, etc. — is ignored. The app's own callers send only { staffRole } or {}.
const CLIENT_FIELDS = ['address', 'city', 'state', 'zip_code', 'date_of_birth',
  'emergency_contact_name', 'emergency_contact_phone'] as const;
const CAREGIVER_FIELDS = ['address', 'city', 'state', 'zip_code', 'employment_type', 'hourly_rate',
  'emergency_contact_name', 'emergency_contact_phone'] as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get the authorization header from the request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Verify the caller is authenticated
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !caller) {
      throw new Error('Unauthorized');
    }

    // Owner rule A (M-SEC-2b): caller must be manager, agency_admin or system_admin, judged by the
    // highest of ALL the caller's role rows.
    const callerPrincipal = await loadPrincipal(supabaseClient, caller.id);
    if (!hasCallerRole(callerPrincipal, MANAGER_OR_ABOVE)) {
      return new Response(
        JSON.stringify({ error: 'You do not have permission to create users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const isSystemAdmin = callerPrincipal.role === 'system_admin';

    // Get caller's agency_id (and, if the caller is a Tier-3/office-restricted
    // staff member, their virtual_office_id) from profiles.
    const { data: callerProfile } = await supabaseClient
      .from('profiles')
      .select('agency_id, virtual_office_id, office_restricted')
      .eq('id', caller.id)
      .single();

    // Only propagate the caller's own office onto a new caregiver/client when the
    // caller is genuinely office-restricted (Tier 3) -- an agency-wide (Tier 2)
    // caller has no single office to attribute the new record to, so it stays NULL
    // here exactly as it already does today (see M-Office plan §2.5: assigning a
    // specific office on a Tier-2 admin's behalf needs an explicit picker, not
    // built yet).
    const callerOfficeId = callerProfile?.office_restricted ? callerProfile.virtual_office_id : null;

    if (!callerProfile?.agency_id) {
      return new Response(
        JSON.stringify({ error: 'Caller profile not found or missing agency_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { email, password, firstName, lastName, phone, userType, userData, agencyId, virtualOfficeId } = await req.json();

    // Owner rule B (M-SEC-2b): the new user's agency is set server-side — the caller's own agency,
    // or (system_admin only) an explicit, existing `agencyId`. Any agency_id inside userData is
    // dropped by the allow-list below.
    let targetAgencyId: string = callerProfile.agency_id;
    if (agencyId !== undefined && agencyId !== null && agencyId !== callerProfile.agency_id) {
      if (!isSystemAdmin) {
        return new Response(
          JSON.stringify({ error: 'Only a system administrator can create users in another agency' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { data: ag } = await supabaseClient.from('agency').select('id').eq('id', agencyId).maybeSingle();
      if (!ag) {
        return new Response(
          JSON.stringify({ error: 'Unknown agency' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      targetAgencyId = ag.id;
    }

    // Owner rule B: office. An office-restricted caller can only create into its own office (and
    // that remains the default, as before). Otherwise an explicit `virtualOfficeId` must belong
    // to the target agency; none given => NULL (agency-wide), as before.
    let targetOfficeId: string | null = callerOfficeId;
    if (virtualOfficeId !== undefined && virtualOfficeId !== null) {
      if (callerProfile.office_restricted && !isSystemAdmin) {
        if (virtualOfficeId !== callerProfile.virtual_office_id) {
          return new Response(
            JSON.stringify({ error: 'You can only create users in your own office' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        const { data: vo } = await supabaseClient
          .from('virtual_office').select('id').eq('id', virtualOfficeId).eq('agency_id', targetAgencyId).maybeSingle();
        if (!vo) {
          return new Response(
            JSON.stringify({ error: "Office does not belong to the user's agency" }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
      targetOfficeId = virtualOfficeId;
    } else if (targetAgencyId !== callerProfile.agency_id) {
      targetOfficeId = null; // the caller's own office never applies inside another agency
    }

    // Issue 2 Mode B (security plan §15): staff no longer choose a password for the new user.
    if (password !== undefined) {
      return new Response(
        JSON.stringify({ error: 'Passwords are no longer set here. A one-time set-password link is generated instead.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!email || !firstName || !lastName || !userType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // M-SEC-2b: validate the requested role against what THIS caller may grant, before any
    // account is created. Previously the role came straight from the body, so a manager or
    // agency_admin could create a system_admin.
    if (!['client', 'caregiver', 'staff'].includes(userType)) {
      return new Response(
        JSON.stringify({ error: 'Invalid user type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const requestedRole: string | undefined = userType === 'staff' ? userData?.staffRole : userType;
    if (userType === 'staff' && !(STAFF_ROLES as readonly string[]).includes(requestedRole ?? '')) {
      return new Response(
        JSON.stringify({ error: 'Invalid staff role' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const creatable = CREATABLE_ROLES[callerPrincipal.role ?? ''] ?? [];
    if (!requestedRole || !creatable.includes(requestedRole)) {
      return new Response(
        JSON.stringify({ error: `You do not have permission to create a ${requestedRole ?? 'user'} account` }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // M-SEC-2b: only these caller-supplied columns may reach the clients/caregivers insert
    // (previously the whole userData object was spread in, so any column could be set).
    const safeUserData = pick(userData, userType === 'client' ? CLIENT_FIELDS : CAREGIVER_FIELDS);

    // Mode B: create the auth user through a one-time INVITE link (no password). The link is
    // returned once in this response and never stored or logged.
    if (await findAuthUserIdByEmail(supabaseClient, email)) {
      return new Response(
        JSON.stringify({ error: 'An account with this email already exists' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    let invited: { userId: string; link: string };
    try {
      invited = await inviteNewUser(supabaseClient, { email, fullName: `${firstName} ${lastName}`, agencyId: targetAgencyId, redirectTo: setPasswordRedirect(req), actorId: caller.id, fn: 'create-user' });
    } catch (e) {
      console.error('Error creating user:', e instanceof Error ? e.message : 'unknown');
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : 'Failed to create user' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const authData = { user: { id: invited.userId } };

    // Wait a moment for the profile trigger to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Update profile with phone
    if (phone) {
      await supabaseClient
        .from('profiles')
        .update({ phone })
        .eq('id', authData.user.id);
    }

    let recordId = null;

    // Create type-specific record
    if (userType === 'client') {
      const { data: clientData, error: clientError } = await supabaseClient
        .from('clients')
        .insert({
          ...safeUserData,
          user_id: authData.user.id,
          agency_id: targetAgencyId,
          virtual_office_id: targetOfficeId,
        })
        .select()
        .single();

      if (clientError) {
        console.error('Error creating client:', clientError);
        // Clean up auth user if client creation fails
        await supabaseClient.auth.admin.deleteUser(authData.user.id);
        return new Response(
          JSON.stringify({ error: 'Failed to create client record' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      recordId = clientData.id;
    } else if (userType === 'caregiver') {
      const { data: caregiverData, error: caregiverError } = await supabaseClient
        .from('caregivers')
        .insert({
          ...safeUserData,
          first_name: firstName,
          last_name: lastName,
          email,
          phone: phone || '',
          user_id: authData.user.id,
          agency_id: targetAgencyId,
          virtual_office_id: targetOfficeId,
        })
        .select()
        .single();

      if (caregiverError) {
        console.error('Error creating caregiver:', caregiverError);
        // Clean up auth user if caregiver creation fails
        await supabaseClient.auth.admin.deleteUser(authData.user.id);
        return new Response(
          JSON.stringify({ error: 'Failed to create caregiver record' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      recordId = caregiverData.id;
    } else if (userType === 'staff') {
      // Staff roles (system_admin, agency_admin, manager, scheduler, hr_staff)
      // No additional table record needed, just user_roles
    }

    // Add user role (validated above). M-SEC-2b: check the result — previously a failed insert
    // left an auth user with no role. On failure, roll back the record and the auth user.
    const { error: roleError } = await supabaseClient.from('user_roles').insert({
      user_id: authData.user.id,
      role: requestedRole,
      agency_id: targetAgencyId,
    });
    if (roleError) {
      console.error('Error assigning role:', roleError);
      if (recordId && userType === 'client') await supabaseClient.from('clients').delete().eq('id', recordId);
      if (recordId && userType === 'caregiver') await supabaseClient.from('caregivers').delete().eq('id', recordId);
      await supabaseClient.auth.admin.deleteUser(authData.user.id);
      return new Response(
        JSON.stringify({ error: 'Failed to assign role; the account was not created' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        userId: authData.user.id,
        setPasswordLink: invited.link,
        recordId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in create-user function:', error instanceof Error ? error.message : 'unknown');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

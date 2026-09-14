import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

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

    // Check caller's role - must be admin or manager
    const { data: callerRole } = await supabaseClient.rpc('get_user_role', {
      _user_id: caller.id
    });

    const allowedRoles = ['system_admin', 'agency_admin', 'manager'];
    if (!callerRole || !allowedRoles.includes(callerRole)) {
      return new Response(
        JSON.stringify({ error: 'You do not have permission to create users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    const { email, password, firstName, lastName, phone, userType, userData } = await req.json();

    if (!email || !password || !firstName || !lastName || !userType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create the auth user with admin privileges
    const { data: authData, error: createError } = await supabaseClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: `${firstName} ${lastName}`,
        agency_id: callerProfile.agency_id,
      }
    });

    if (createError || !authData.user) {
      console.error('Error creating user:', createError);
      return new Response(
        JSON.stringify({ error: createError?.message || 'Failed to create user' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
          ...userData,
          user_id: authData.user.id,
          agency_id: callerProfile.agency_id,
          virtual_office_id: callerOfficeId,
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
          ...userData,
          first_name: firstName,
          last_name: lastName,
          email,
          phone: phone || '',
          user_id: authData.user.id,
          agency_id: callerProfile.agency_id,
          virtual_office_id: callerOfficeId,
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

    // Add user role
    await supabaseClient.from('user_roles').insert({
      user_id: authData.user.id,
      role: userType === 'staff' ? userData.staffRole : userType,
      agency_id: callerProfile.agency_id,
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        userId: authData.user.id,
        recordId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in create-user function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

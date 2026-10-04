import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { checkExistingAccount, findAuthUserIdByEmail, inviteNewUser, linkHandedOverNote, setPasswordRedirect } from "../_shared/accountLinks.ts";
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Legacy shared-tenant id. No longer used as a fallback; approvals must resolve a real agency.
const LEGACY_SYSTEM_AGENCY_ID = '00000000-0000-0000-0000-000000000000';

type ReviewAction = 'approve' | 'reject';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const parseBody = (body: Record<string, unknown>) => {
  const registrationId = body.registrationId;
  const action = (body.action ?? 'approve') as ReviewAction;
  const rejectionReason = typeof body.rejectionReason === 'string' ? body.rejectionReason.trim() : null;

  if (!isUuid(registrationId) || !['approve', 'reject'].includes(action)) {
    return { error: 'registrationId and a valid action are required' } as const;
  }

  if (action === 'reject' && (!rejectionReason || rejectionReason.length > 1000)) {
    return { error: 'A rejection reason under 1000 characters is required' } as const;
  }

  return { registrationId, action, rejectionReason } as const;
};

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

    const { data: callerRole } = await admin.rpc('get_user_role', { _user_id: caller.id });
    const { data: canReview } = await admin.rpc('has_permission', {
      _user_id: caller.id,
      _module_code: 'caregiver_approvals',
      _permission_type: 'update',
    });
    if (!callerRole || !['agency_admin', 'manager', 'hr_staff'].includes(callerRole) || !canReview) {
      return json({ error: 'You do not have permission to review registrations' }, 403);
    }

    const { data: callerProfile } = await admin
      .from('profiles').select('agency_id').eq('id', caller.id).single();
    if (!callerProfile?.agency_id) return json({ error: 'Your profile is missing an agency' }, 400);

    const agencyId = callerProfile.agency_id as string;
    if (agencyId === LEGACY_SYSTEM_AGENCY_ID) {
      return json({ error: 'Use an agency admin or manager account to review caregiver applications' }, 403);
    }

    const { data: agency, error: agencyError } = await admin
      .from('agency')
      .select('id, is_active')
      .eq('id', agencyId)
      .maybeSingle();

    if (agencyError || !agency?.is_active) {
      return json({ error: 'Your agency is not active or could not be found' }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const parsed = parseBody(body);
    if ('error' in parsed) return json({ error: parsed.error }, 400);
    const { registrationId, action, rejectionReason } = parsed;

    const { data: reg, error: regError } = await admin
      .from('caregiver_registrations').select('*').eq('id', registrationId).single();
    if (regError || !reg) return json({ error: 'Registration not found' }, 404);
    if (reg.status !== 'pending') return json({ error: `Registration is already ${reg.status}` }, 400);
    // 🟠 fix (security plan §15): previously a NULL-agency registration could be claimed (and stamped)
    // by ANY agency. It must now already belong to the reviewer's agency.
    if (!reg.agency_id) {
      return json({ error: 'This registration is not assigned to an agency yet. Ask a system administrator to assign it.' }, 403);
    }
    if (reg.agency_id !== agencyId) {
      return json({ error: 'This registration belongs to another agency' }, 403);
    }

    const reviewStamp = { reviewed_by: caller.id, reviewed_at: new Date().toISOString() };

    if (action === 'reject') {
      const { error } = await admin.from('caregiver_registrations')
        .update({ status: 'rejected', agency_id: agencyId, rejection_reason: rejectionReason, ...reviewStamp })
        .eq('id', registrationId);
      if (error) return json({ error: error.message }, 400);

      await admin.from('pending_notifications').insert({
        agency_id: agencyId,
        recipient_email: reg.email,
        recipient_name: `${reg.first_name} ${reg.last_name}`,
        kind: 'caregiver_rejected',
        subject: 'Your caregiver application was not approved',
        body: `Hi ${reg.first_name}, unfortunately your application was not approved.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
        payload: { registration_id: registrationId, rejection_reason: rejectionReason },
      });

      return json({ success: true, status: 'rejected' });
    }

    // Approve (Mode B, security plan §15): no temporary password. An existing account is linked only
    // if its profile is already in this agency (never moved; NULL/legacy -> refused); a new account
    // gets a one-time invite link returned once in the response and never stored.
    const fullName = `${reg.first_name} ${reg.last_name}`;
    let authUserId: string | null = await findAuthUserIdByEmail(admin, reg.email);
    let setPasswordLink: string | null = null;
    if (authUserId) {
      const verdict = await checkExistingAccount(admin, authUserId, agencyId, false);
      if (!verdict.ok) return json({ error: verdict.error }, verdict.status);
      await admin.from('profiles').upsert({ id: authUserId, email: reg.email, full_name: fullName, phone: reg.phone }, { onConflict: 'id' });
    } else {
      const invited = await inviteNewUser(admin, { email: reg.email, fullName, agencyId, redirectTo: setPasswordRedirect(req), actorId: caller.id, fn: 'approve-caregiver-registration' });
      authUserId = invited.userId;
      setPasswordLink = invited.link;
      await new Promise((r) => setTimeout(r, 400));
      await admin.from('profiles').upsert({ id: authUserId, email: reg.email, full_name: fullName, phone: reg.phone, agency_id: agencyId }, { onConflict: 'id' });
    }

    // Link or create the caregiver roster record
    // 🟠 fix: exact case-insensitive match. `.ilike(email)` treated % and _ in the applicant's own
    // email as wildcards and could attach this account to another caregiver row.
    const { data: agencyCaregivers } = await admin
      .from('caregivers').select('id, user_id, email').eq('agency_id', agencyId);
    const existing = (agencyCaregivers ?? []).find((c: { email: string | null }) => (c.email ?? '').toLowerCase() === reg.email.toLowerCase()) ?? null;

    let caregiverId: string;
    if (existing) {
      if (existing.user_id && existing.user_id !== authUserId) {
        return json({ error: 'A caregiver record with this email is already linked to another account' }, 400);
      }
      caregiverId = existing.id;
      await admin.from('caregivers').update({
        user_id: authUserId,
        first_name: reg.first_name,
        last_name: reg.last_name,
        phone: reg.phone,
        address: reg.address,
        city: reg.city,
        state: reg.state,
        zip_code: reg.zip_code,
        employment_type: reg.employment_type ?? 'full_time',
        hourly_rate: reg.hourly_rate,
        is_active: true,
      }).eq('id', existing.id);
    } else {
      const { data: inserted, error: insertError } = await admin.from('caregivers').insert({
        agency_id: agencyId,
        user_id: authUserId,
        first_name: reg.first_name,
        last_name: reg.last_name,
        email: reg.email,
        phone: reg.phone,
        address: reg.address,
        city: reg.city,
        state: reg.state,
        zip_code: reg.zip_code,
        employment_type: reg.employment_type ?? 'full_time',
        hourly_rate: reg.hourly_rate,
        is_active: true,
      }).select('id').single();
      if (insertError || !inserted) return json({ error: insertError?.message ?? 'Failed to create caregiver' }, 400);
      caregiverId = inserted.id;
    }

    const selectedCareServiceCodes = Array.isArray(reg.care_type_codes)
      ? Array.from(new Set(
          reg.care_type_codes.filter((code: unknown): code is string =>
            typeof code === 'string' && code.trim().length > 0
          )
        ))
      : [];

    if (selectedCareServiceCodes.length > 0) {
      const { data: activeServices, error: servicesError } = await admin
        .from('care_types')
        .select('code')
        .in('code', selectedCareServiceCodes)
        .eq('is_active', true);

      if (servicesError) return json({ error: servicesError.message }, 400);

      const activeCodes = new Set((activeServices ?? []).map((service) => service.code));
      const validCareServiceCodes = selectedCareServiceCodes.filter((code) => activeCodes.has(code));
      if (validCareServiceCodes.length !== selectedCareServiceCodes.length) {
        return json({ error: 'One or more selected Care Services are no longer active' }, 400);
      }

      const { error: clearSkillsError } = await admin
        .from('caregiver_skills')
        .delete()
        .eq('caregiver_id', caregiverId);
      if (clearSkillsError) return json({ error: clearSkillsError.message }, 400);

      const { error: skillsError } = await admin.from('caregiver_skills').insert(
        validCareServiceCodes.map((code) => ({
          caregiver_id: caregiverId,
          care_type_code: code,
          proficiency_level: 'experienced',
          years_experience: 0,
          is_certified: false,
        }))
      );
      if (skillsError) return json({ error: skillsError.message }, 400);
    }

    // Grant the caregiver role
    await admin.from('user_roles')
      .upsert({ user_id: authUserId, role: 'caregiver', agency_id: agencyId }, { onConflict: 'user_id,role' });

    const { error: updateError } = await admin.from('caregiver_registrations')
      .update({ status: 'approved', agency_id: agencyId, ...reviewStamp })
      .eq('id', registrationId);
    if (updateError) return json({ error: updateError.message }, 400);

    await admin.from('pending_notifications').insert({
      agency_id: agencyId,
      recipient_email: reg.email,
      recipient_name: `${reg.first_name} ${reg.last_name}`,
      kind: 'caregiver_approved',
      subject: 'Your caregiver account is active',
      body: `Your application was approved. ${linkHandedOverNote(reg.first_name, setPasswordLink ? 'invite' : 'existing')}`,
      payload: { registration_id: registrationId, caregiver_id: caregiverId, delivery: setPasswordLink ? 'set_password_link_shown_once' : 'existing_account' },
    });

    // setPasswordLink is returned ONCE to the reviewer; it is not stored or logged.
    return json({ success: true, status: 'approved', caregiverId, userId: authUserId, setPasswordLink, existingAccount: !setPasswordLink });
  } catch (error) {
    console.error('approve-caregiver-registration error:', error instanceof Error ? error.message : 'unknown');
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

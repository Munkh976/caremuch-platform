-- Ensure pgcrypto extension is installed in the extensions schema
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Delete the incorrectly created munkh user
DELETE FROM public.user_roles WHERE user_id = '56fbfe38-e8eb-40c1-ba27-07428f62ed2e';
DELETE FROM public.profiles WHERE id = '56fbfe38-e8eb-40c1-ba27-07428f62ed2e';
DELETE FROM auth.users WHERE id = '56fbfe38-e8eb-40c1-ba27-07428f62ed2e';

-- Create a new munkh user with proper random user_id
DO $$
DECLARE
    munkh_user_id uuid;
    caremuch_agency_id uuid := '56fbfe38-e8eb-40c1-ba27-07428f62ed2e';
BEGIN
    -- Generate a new random user ID
    munkh_user_id := gen_random_uuid();
    
    -- Create the auth user
    INSERT INTO auth.users (
        id,
        email,
        encrypted_password,
        email_confirmed_at,
        aud,
        role,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
    ) VALUES (
        munkh_user_id,
        'munkh.mn@gmail.com',
        extensions.crypt('Password123!', extensions.gen_salt('bf')),
        now(),
        'authenticated',
        'authenticated',
        '{"provider":"email","providers":["email"]}'::jsonb,
        json_build_object(
            'full_name', 'Munkh',
            'agency_id', caremuch_agency_id
        )::jsonb,
        now(),
        now()
    );
    
    -- Create auth.identities record
    INSERT INTO auth.identities (
        id,
        user_id,
        provider_id,
        provider,
        identity_data,
        last_sign_in_at,
        created_at,
        updated_at
    ) VALUES (
        gen_random_uuid(),
        munkh_user_id,
        munkh_user_id::text,
        'email',
        json_build_object(
            'sub', munkh_user_id::text,
            'email', 'munkh.mn@gmail.com',
            'email_verified', true
        )::jsonb,
        now(),
        now(),
        now()
    );
    
    -- Create profile
    INSERT INTO public.profiles (id, email, full_name, agency_id, created_at, updated_at)
    VALUES (munkh_user_id, 'munkh.mn@gmail.com', 'Munkh', caremuch_agency_id, now(), now())
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        agency_id = EXCLUDED.agency_id;
    
    -- Create user_role with correct user_id and agency_id
    INSERT INTO public.user_roles (user_id, role, agency_id)
    VALUES (munkh_user_id, 'agency_admin', caremuch_agency_id);
    
    RAISE NOTICE 'Successfully recreated munkh user with new ID: % and agency_id: %', munkh_user_id, caremuch_agency_id;
END $$;
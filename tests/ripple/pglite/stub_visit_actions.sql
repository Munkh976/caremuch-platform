-- Stand-ins for live tables / columns the visit actions touch (PGlite only; they exist on DEV): the Notification Outbox,
-- caregiver e-mail and the order line of a shift.
CREATE TABLE IF NOT EXISTS public.pending_notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agency_id uuid, recipient_email text NOT NULL,
  recipient_name text, kind text NOT NULL, subject text, body text, payload jsonb, sent_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
ALTER TABLE public.caregivers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS order_service_id uuid;

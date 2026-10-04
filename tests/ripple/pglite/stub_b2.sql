-- B2 stand-ins for live columns (PGlite only): shift times/status (live enum shift_status has
-- open, assigned, confirmed, in_progress, completed, cancelled, unassigned), client last_name,
-- profile full_name already present.
CREATE TYPE public.shift_status AS ENUM ('open','assigned','confirmed','in_progress','completed','cancelled','unassigned');
ALTER TABLE public.shifts ADD COLUMN start_time time NOT NULL DEFAULT '09:00', ADD COLUMN end_time time NOT NULL DEFAULT '10:00',
  ADD COLUMN status public.shift_status DEFAULT 'open';
ALTER TABLE public.clients ADD COLUMN last_name text NOT NULL DEFAULT 'Fixture';

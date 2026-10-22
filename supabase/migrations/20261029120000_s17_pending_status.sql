-- S17 (owner approval Oct 21): a care plan version can be PENDING (started from the ISK IPOS, not yet in effect).
-- Additive enum value. In its own migration because a new enum value can't be used in the transaction that adds it.
-- Rollback note: PostgreSQL can't drop an enum value in place; the rollback of S17 leaves 'pending' in the type,
-- unused (it checks that no row has it). Nothing reads the enum's list of values.
ALTER TYPE public.care_plan_status ADD VALUE IF NOT EXISTS 'pending';

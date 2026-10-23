-- Rollback of 20261031190000_shift_cancel_guard.sql (additive: one trigger and its function; nothing else changed).
DROP TRIGGER trg_cp_guard_shift_cancel ON public.shifts;
DROP FUNCTION public.cp_guard_shift_cancel();

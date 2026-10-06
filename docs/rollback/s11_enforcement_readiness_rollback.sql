-- Rollback of 20261024120000_s11_enforcement_readiness.sql (Ripple UI S11): drops the one new read. Nothing else changed.
DROP FUNCTION public.get_enforcement_readiness(uuid, integer);

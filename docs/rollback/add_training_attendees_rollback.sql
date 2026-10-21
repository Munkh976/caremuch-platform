-- Rollback of 20261027120100_add_training_attendees.sql. Attendees already added stay (ordinary training records).
DROP FUNCTION public.add_training_attendees(uuid, jsonb);

-- ai_match_score was never written by any RPC, trigger, or Edge Function —
-- match-caregiver computes a match score per request but only returns it in
-- the HTTP response; it was never persisted back to this column. Column has
-- been NULL for every row since it was introduced. Dropping as dead schema.
ALTER TABLE public.shifts DROP COLUMN IF EXISTS ai_match_score;

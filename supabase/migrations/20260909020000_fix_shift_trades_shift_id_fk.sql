-- Real, pre-existing bug found while investigating "badge count says N but the
-- Trade Board shows nothing": ShiftTrades.tsx's fetchTrades() embeds
-- `shifts:shift_id(...)`, but shift_trades.shift_id (added in
-- 20260728194812_86a67626-1208-4198-94c6-dcd0e05d2121.sql) has never had a
-- foreign key. PostgREST cannot resolve an embedded relationship without one,
-- so that select fails outright and the page's catch block sets an empty list
-- -- while the separate, simpler badge-count query (no embed) still succeeds.
-- That mismatch is the actual defect, independent of any demo data. This FK
-- fixes it for the app generally, not just for seeded rows.
ALTER TABLE public.shift_trades
  ADD CONSTRAINT shift_trades_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE SET NULL;

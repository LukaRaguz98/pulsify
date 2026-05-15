-- ============================================================
-- Pulsify — enable Realtime on analytics_events
-- Lets the dashboard subscribe to live member_join / member_leave
-- (and other) inserts via Supabase Realtime, so views update without
-- waiting for the next poll.
-- ============================================================

alter publication supabase_realtime add table public.analytics_events;

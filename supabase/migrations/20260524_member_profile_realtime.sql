-- ============================================================
-- Pulsify — Realtime for member profiles & directory
-- Streams moderation + activity changes so the member directory and the
-- profile page update live (a warning lands, a ban is issued, a note is
-- added, reputation shifts as a member chats) without a manual refresh.
-- analytics_events is already published (20250107) so it's skipped here.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array['guild_warnings', 'moderation_logs', 'moderation_notes', 'voice_sessions']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Filtered UPDATE/DELETE realtime events (a warning being cleared, a note
-- removed) only match a column filter when the full old row is emitted.
alter table public.guild_warnings  replica identity full;
alter table public.moderation_notes replica identity full;

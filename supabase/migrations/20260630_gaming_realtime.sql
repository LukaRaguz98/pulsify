-- Gaming Analytics — realtime publication fix (follow-up to 20260629).
--
-- The bot (pulse-bot/src/gaming.js) caches each guild's gaming settings in
-- memory and subscribes to `postgres_changes` on `gaming_settings` /
-- `gaming_opt_outs` to pick up dashboard edits. 20260629 created both tables
-- but never added them to the `supabase_realtime` publication, so the
-- subscription was live and silent: toggling "Enable gaming analytics" in
-- Analytics › Gaming wrote the row, the dashboard read it back as on, and the
-- running bot kept the config it had loaded at startup — `enabled: false` —
-- so `onPresenceUpdate` returned early and nothing was ever recorded. The
-- module only started working after a bot restart.
--
-- Every comparable module publishes its config table (polls, self-roles,
-- statistics channels); gaming was the one that missed it.

do $$
declare
  t text;
begin
  foreach t in array array['gaming_settings', 'gaming_opt_outs']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

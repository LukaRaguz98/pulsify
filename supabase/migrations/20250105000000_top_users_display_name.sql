-- ============================================================
-- Pulsify — "Most Active Users" should show each member's server
-- display name, not their username. The bot now records the guild
-- display name on message events; this picks the most recently
-- recorded name per user so older username rows don't win over it.
-- ============================================================

create or replace function public.get_top_users(
  p_guild_id text,
  p_since    timestamptz,
  p_limit    int
)
returns table (
  user_id       text,
  user_name     text,
  message_count bigint
)
language sql
stable
as $$
  select
    user_id,
    (array_agg(user_name order by created_at desc)
      filter (where user_name is not null))[1] as user_name,
    count(*) as message_count
  from public.analytics_events
  where guild_id = p_guild_id
    and event_type = 'message'
    and user_id is not null
    and (p_since is null or created_at >= p_since)
  group by user_id
  order by message_count desc
  limit p_limit;
$$;

grant execute on function public.get_top_users(text, timestamptz, int) to anon, authenticated;

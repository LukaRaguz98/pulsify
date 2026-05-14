-- ============================================================
-- Pulsify — analytics schema
-- Raw event log + voice sessions + aggregation functions used by
-- the Overview and Statistics dashboards.
-- ============================================================

-- Point-in-time events: messages, member joins/leaves, slash commands,
-- moderation actions. High-volume table — the bot buffers inserts.
create table if not exists public.analytics_events (
  id            bigint generated always as identity primary key,
  guild_id      text        not null,
  event_type    text        not null, -- message | member_join | member_leave | command | mod_action
  user_id       text,
  user_name     text,
  channel_id    text,
  channel_name  text,
  metadata      jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists analytics_events_guild_time
  on public.analytics_events (guild_id, created_at desc);
create index if not exists analytics_events_guild_type_time
  on public.analytics_events (guild_id, event_type, created_at desc);

alter table public.analytics_events enable row level security;

create policy "Service role full access to analytics_events"
  on public.analytics_events
  for all
  using (true)
  with check (true);

-- ---------------------------------------------------------------

-- Completed voice channel sessions. The bot tracks active sessions in
-- memory and writes a row (with computed duration) when a user leaves.
create table if not exists public.voice_sessions (
  id               bigint generated always as identity primary key,
  guild_id         text        not null,
  user_id          text        not null,
  user_name        text,
  channel_id       text,
  channel_name     text,
  joined_at        timestamptz not null,
  left_at          timestamptz not null default now(),
  duration_seconds integer     not null,
  created_at       timestamptz not null default now()
);

create index if not exists voice_sessions_guild_time
  on public.voice_sessions (guild_id, left_at desc);

alter table public.voice_sessions enable row level security;

create policy "Service role full access to voice_sessions"
  on public.voice_sessions
  for all
  using (true)
  with check (true);

-- ============================================================
-- Aggregation functions
-- A null p_since means "all time" (no lower time bound).
-- ============================================================

create or replace function public.get_analytics_summary(
  p_guild_id text,
  p_since    timestamptz
)
returns table (
  total_messages    bigint,
  total_commands    bigint,
  total_mod_actions bigint,
  member_joins      bigint,
  member_leaves     bigint,
  active_users      bigint,
  voice_seconds     bigint
)
language sql
stable
as $$
  select
    count(*) filter (where event_type = 'message'),
    count(*) filter (where event_type = 'command'),
    count(*) filter (where event_type = 'mod_action'),
    count(*) filter (where event_type = 'member_join'),
    count(*) filter (where event_type = 'member_leave'),
    count(distinct user_id) filter (where event_type = 'message' and user_id is not null),
    coalesce((
      select sum(duration_seconds)
      from public.voice_sessions v
      where v.guild_id = p_guild_id
        and (p_since is null or v.left_at >= p_since)
    ), 0)
  from public.analytics_events e
  where e.guild_id = p_guild_id
    and (p_since is null or e.created_at >= p_since);
$$;

create or replace function public.get_analytics_timeseries(
  p_guild_id text,
  p_since    timestamptz,
  p_trunc    text            -- 'hour' or 'day'
)
returns table (
  bucket        timestamptz,
  messages      bigint,
  joins         bigint,
  leaves        bigint,
  commands      bigint,
  mod_actions   bigint,
  voice_seconds bigint
)
language sql
stable
as $$
  with ev as (
    select
      date_trunc(p_trunc, created_at) as bucket,
      count(*) filter (where event_type = 'message')       as messages,
      count(*) filter (where event_type = 'member_join')   as joins,
      count(*) filter (where event_type = 'member_leave')  as leaves,
      count(*) filter (where event_type = 'command')       as commands,
      count(*) filter (where event_type = 'mod_action')    as mod_actions
    from public.analytics_events
    where guild_id = p_guild_id
      and (p_since is null or created_at >= p_since)
    group by 1
  ),
  vs as (
    select
      date_trunc(p_trunc, left_at) as bucket,
      sum(duration_seconds)        as voice_seconds
    from public.voice_sessions
    where guild_id = p_guild_id
      and (p_since is null or left_at >= p_since)
    group by 1
  )
  select
    coalesce(ev.bucket, vs.bucket)  as bucket,
    coalesce(ev.messages, 0)        as messages,
    coalesce(ev.joins, 0)          as joins,
    coalesce(ev.leaves, 0)         as leaves,
    coalesce(ev.commands, 0)       as commands,
    coalesce(ev.mod_actions, 0)    as mod_actions,
    coalesce(vs.voice_seconds, 0)  as voice_seconds
  from ev
  full outer join vs on ev.bucket = vs.bucket
  order by 1;
$$;

create or replace function public.get_top_channels(
  p_guild_id text,
  p_since    timestamptz,
  p_limit    int
)
returns table (
  channel_id    text,
  channel_name  text,
  message_count bigint
)
language sql
stable
as $$
  select
    channel_id,
    max(channel_name) as channel_name,
    count(*)          as message_count
  from public.analytics_events
  where guild_id = p_guild_id
    and event_type = 'message'
    and channel_id is not null
    and (p_since is null or created_at >= p_since)
  group by channel_id
  order by message_count desc
  limit p_limit;
$$;

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
    max(user_name) as user_name,
    count(*)       as message_count
  from public.analytics_events
  where guild_id = p_guild_id
    and event_type = 'message'
    and user_id is not null
    and (p_since is null or created_at >= p_since)
  group by user_id
  order by message_count desc
  limit p_limit;
$$;

-- Message volume by hour of day (UTC, 0-23) — drives the "peak activity times" view.
create or replace function public.get_peak_hours(
  p_guild_id text,
  p_since    timestamptz
)
returns table (
  hour          int,
  message_count bigint
)
language sql
stable
as $$
  select
    extract(hour from created_at)::int as hour,
    count(*)                           as message_count
  from public.analytics_events
  where guild_id = p_guild_id
    and event_type = 'message'
    and (p_since is null or created_at >= p_since)
  group by 1
  order by 1;
$$;

grant execute on function public.get_analytics_summary(text, timestamptz)            to anon, authenticated;
grant execute on function public.get_analytics_timeseries(text, timestamptz, text)   to anon, authenticated;
grant execute on function public.get_top_channels(text, timestamptz, int)            to anon, authenticated;
grant execute on function public.get_top_users(text, timestamptz, int)               to anon, authenticated;
grant execute on function public.get_peak_hours(text, timestamptz)                   to anon, authenticated;

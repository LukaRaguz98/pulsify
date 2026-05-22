-- ============================================================
-- Pulsify — Member profiles & reputation
-- Moderator-only notes + per-member and guild-wide activity /
-- infraction aggregations that power the member directory and the
-- detailed profile page. A null p_since means "all time".
-- ============================================================

-- Moderator-only notes attached to a member. Free-form comments other
-- moderators can read — never shown to the member themselves.
create table if not exists public.moderation_notes (
  id               uuid        primary key default gen_random_uuid(),
  guild_id         text        not null,
  user_id          text        not null,
  author_id        text        not null,
  author_username  text,
  body             text        not null,
  created_at       timestamptz not null default now()
);

create index if not exists moderation_notes_guild_user
  on public.moderation_notes (guild_id, user_id, created_at desc);

alter table public.moderation_notes enable row level security;

create policy "Service role full access to moderation_notes"
  on public.moderation_notes
  for all
  using (true)
  with check (true);

-- ============================================================
-- Single-member aggregations (profile page)
-- ============================================================

-- Headline activity totals for one member. `first_seen` / `last_active`
-- are lifetime (ignore p_since) so the profile can show "first seen" even
-- when a short timeframe is selected.
create or replace function public.get_member_profile_stats(
  p_guild_id text,
  p_user_id  text,
  p_since    timestamptz
)
returns table (
  message_count   bigint,
  command_count   bigint,
  active_channels bigint,
  voice_seconds   bigint,
  voice_sessions  bigint,
  first_seen      timestamptz,
  last_active     timestamptz
)
language sql
stable
as $$
  select
    (select count(*) from public.analytics_events e
       where e.guild_id = p_guild_id and e.user_id = p_user_id and e.event_type = 'message'
         and (p_since is null or e.created_at >= p_since)),
    (select count(*) from public.analytics_events e
       where e.guild_id = p_guild_id and e.user_id = p_user_id and e.event_type = 'command'
         and (p_since is null or e.created_at >= p_since)),
    (select count(distinct e.channel_id) from public.analytics_events e
       where e.guild_id = p_guild_id and e.user_id = p_user_id and e.event_type = 'message'
         and e.channel_id is not null
         and (p_since is null or e.created_at >= p_since)),
    coalesce((select sum(v.duration_seconds) from public.voice_sessions v
       where v.guild_id = p_guild_id and v.user_id = p_user_id
         and (p_since is null or v.left_at >= p_since)), 0),
    (select count(*) from public.voice_sessions v
       where v.guild_id = p_guild_id and v.user_id = p_user_id
         and (p_since is null or v.left_at >= p_since)),
    (select min(e.created_at) from public.analytics_events e
       where e.guild_id = p_guild_id and e.user_id = p_user_id),
    (select max(e.created_at) from public.analytics_events e
       where e.guild_id = p_guild_id and e.user_id = p_user_id);
$$;

-- A member's most-used text channels.
create or replace function public.get_member_channel_breakdown(
  p_guild_id text,
  p_user_id  text,
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
    and user_id = p_user_id
    and event_type = 'message'
    and channel_id is not null
    and (p_since is null or created_at >= p_since)
  group by channel_id
  order by message_count desc
  limit p_limit;
$$;

-- Per-day message + voice totals for one member — drives the activity
-- timeline and the contribution heatmap.
create or replace function public.get_member_activity_daily(
  p_guild_id text,
  p_user_id  text,
  p_since    timestamptz
)
returns table (
  day           date,
  messages      bigint,
  voice_seconds bigint
)
language sql
stable
as $$
  with ev as (
    select date_trunc('day', created_at)::date as day, count(*) as messages
    from public.analytics_events
    where guild_id = p_guild_id and user_id = p_user_id and event_type = 'message'
      and (p_since is null or created_at >= p_since)
    group by 1
  ),
  vs as (
    select date_trunc('day', left_at)::date as day, sum(duration_seconds) as voice_seconds
    from public.voice_sessions
    where guild_id = p_guild_id and user_id = p_user_id
      and (p_since is null or left_at >= p_since)
    group by 1
  )
  select
    coalesce(ev.day, vs.day)       as day,
    coalesce(ev.messages, 0)       as messages,
    coalesce(vs.voice_seconds, 0)  as voice_seconds
  from ev full outer join vs on ev.day = vs.day
  order by 1;
$$;

-- Message volume by hour of day (UTC, 0-23) for one member.
create or replace function public.get_member_hourly_activity(
  p_guild_id text,
  p_user_id  text,
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
    and user_id = p_user_id
    and event_type = 'message'
    and (p_since is null or created_at >= p_since)
  group by 1
  order by 1;
$$;

-- ============================================================
-- Guild-wide aggregations (member directory)
-- One pass over the activity tables / log tables so the directory can
-- compute reputation + risk for every member without N round-trips.
-- Only members WITH activity / infractions appear; the dashboard merges
-- these against the live Discord member list.
-- ============================================================

create or replace function public.get_guild_members_stats(
  p_guild_id text,
  p_since    timestamptz
)
returns table (
  user_id       text,
  message_count bigint,
  command_count bigint,
  voice_seconds bigint,
  last_active   timestamptz
)
language sql
stable
as $$
  with ev as (
    select
      user_id,
      count(*) filter (where event_type = 'message') as message_count,
      count(*) filter (where event_type = 'command') as command_count,
      max(created_at)                                 as last_active
    from public.analytics_events
    where guild_id = p_guild_id
      and user_id is not null
      and event_type in ('message', 'command')
      and (p_since is null or created_at >= p_since)
    group by user_id
  ),
  vs as (
    select
      user_id,
      sum(duration_seconds) as voice_seconds,
      max(left_at)          as last_voice
    from public.voice_sessions
    where guild_id = p_guild_id
      and (p_since is null or left_at >= p_since)
    group by user_id
  )
  select
    coalesce(ev.user_id, vs.user_id)        as user_id,
    coalesce(ev.message_count, 0)           as message_count,
    coalesce(ev.command_count, 0)           as command_count,
    coalesce(vs.voice_seconds, 0)           as voice_seconds,
    greatest(ev.last_active, vs.last_voice) as last_active
  from ev full outer join vs on ev.user_id = vs.user_id;
$$;

-- Per-member infraction tallies. Warnings come from guild_warnings (the
-- canonical store, with an `active` flag); timeouts/kicks/bans come from the
-- dashboard moderation log. `total_infractions` weights warnings + timeouts +
-- kicks + bans equally for a simple count.
create or replace function public.get_guild_members_infractions(
  p_guild_id text
)
returns table (
  user_id            text,
  warnings           bigint,
  active_warnings    bigint,
  timeouts           bigint,
  kicks              bigint,
  bans               bigint,
  total_infractions  bigint,
  last_infraction_at timestamptz
)
language sql
stable
as $$
  with w as (
    select
      user_id,
      count(*)                       as warnings,
      count(*) filter (where active) as active_warnings,
      max(created_at)                as last_w
    from public.guild_warnings
    where guild_id = p_guild_id and user_id is not null
    group by user_id
  ),
  m as (
    select
      target_user_id as user_id,
      count(*) filter (where action = 'timeout') as timeouts,
      count(*) filter (where action = 'kick')    as kicks,
      count(*) filter (where action = 'ban')     as bans,
      max(created_at) filter (where action in ('timeout', 'kick', 'ban')) as last_m
    from public.moderation_logs
    where guild_id = p_guild_id and target_user_id is not null
    group by target_user_id
  )
  select
    coalesce(w.user_id, m.user_id)  as user_id,
    coalesce(w.warnings, 0)         as warnings,
    coalesce(w.active_warnings, 0)  as active_warnings,
    coalesce(m.timeouts, 0)         as timeouts,
    coalesce(m.kicks, 0)            as kicks,
    coalesce(m.bans, 0)             as bans,
    coalesce(w.warnings, 0) + coalesce(m.timeouts, 0)
      + coalesce(m.kicks, 0) + coalesce(m.bans, 0) as total_infractions,
    greatest(w.last_w, m.last_m)    as last_infraction_at
  from w full outer join m on w.user_id = m.user_id;
$$;

grant execute on function public.get_member_profile_stats(text, text, timestamptz)        to anon, authenticated;
grant execute on function public.get_member_channel_breakdown(text, text, timestamptz, int) to anon, authenticated;
grant execute on function public.get_member_activity_daily(text, text, timestamptz)        to anon, authenticated;
grant execute on function public.get_member_hourly_activity(text, text, timestamptz)       to anon, authenticated;
grant execute on function public.get_guild_members_stats(text, timestamptz)                to anon, authenticated;
grant execute on function public.get_guild_members_infractions(text)                       to anon, authenticated;

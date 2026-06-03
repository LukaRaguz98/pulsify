-- ============================================================
-- Pulsify — Member Milestones & Recognition System (PULSIFY-35)
--
-- Threshold-based member recognition that sits alongside the Levels & XP
-- system (20260529_leveling.sql). Where leveling rewards a *curve* of XP, a
-- milestone is a single named threshold on one metric — "1 year in the server",
-- "1,000 messages sent", "10 hours in voice", "entered 10 giveaways", "reached
-- level 25" — that, once a member crosses it, grants reward roles, posts a
-- congratulations embed and is logged forever.
--
-- Two-writer pattern (like giveaways/leveling):
--   • DASHBOARD owns the `milestones` definitions (create/edit/enable/delete)
--     and reads everything.
--   • BOT (pulse-bot/src/milestones.js) owns completion: a periodic sweep
--     evaluates each member against the enabled milestones, writes a
--     `member_milestones` row when a threshold is first crossed, assigns the
--     reward roles, announces, and records a notification.
--
-- Three tables + one aggregate RPC:
--   • milestones                  — the definitions (one row per milestone)
--   • member_milestones           — completion records / reward-history log
--   • member_event_participation  — feeds the "events" metric (no per-member
--                                   scheduled-event counter existed before)
--   • get_member_milestone_metrics(guild) — one round-trip with every tracked
--     member's message/voice/command/event/giveaway/xp/level numbers, so the
--     sweep doesn't fan out N queries (same stance as get_guild_members_stats).
--     "join age" is NOT here — the bot derives it from the Discord member's
--     joinedTimestamp; there is no DB source for it.
-- ============================================================

-- ---------------------------------------------------------------
-- Milestone definitions. `metric` + `threshold` define the trigger; `rewards`
-- is a jsonb array of { role_id } (multiple roles per milestone supported);
-- `announce` (off|channel|dm) + `announce_channel_id` + `message` control the
-- congratulations post. Shape mirrored in lib/milestones.ts / milestones.js.
create table if not exists public.milestones (
  id                  uuid        primary key default gen_random_uuid(),
  guild_id            text        not null,
  name                text        not null,
  description         text,
  -- join_age | messages | voice_minutes | events | giveaways | xp | level
  metric              text        not null,
  threshold           bigint      not null default 1,
  enabled             boolean     not null default true,
  -- lucide icon name (UI only; the bot uses the shared milestone badge).
  icon                text        not null default 'Award',
  -- [{ "role_id": "..." }, ...]
  rewards             jsonb       not null default '[]'::jsonb,
  -- off | channel | dm
  announce            text        not null default 'channel',
  announce_channel_id text,
  -- Template; placeholders {user} {mention} {milestone} {server} {value}.
  message             text,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists milestones_guild on public.milestones (guild_id);

alter table public.milestones enable row level security;

create policy "Allow all access to milestones"
  on public.milestones for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Completion records. Doubles as the reward-history log (who earned what, and
-- when). One row per (milestone, member) — the unique constraint makes a
-- re-trigger a no-op (the bot inserts and swallows 23505), exactly like
-- giveaway_entries. `value` snapshots the metric value at completion.
create table if not exists public.member_milestones (
  id           uuid        primary key default gen_random_uuid(),
  guild_id     text        not null,
  milestone_id uuid        not null references public.milestones(id) on delete cascade,
  user_id      text        not null,
  user_name    text,
  value        bigint      not null default 0,
  completed_at timestamptz not null default now(),
  unique (milestone_id, user_id)
);

create index if not exists member_milestones_guild
  on public.member_milestones (guild_id, completed_at desc);
create index if not exists member_milestones_milestone
  on public.member_milestones (milestone_id);

alter table public.member_milestones enable row level security;

create policy "Allow all access to member_milestones"
  on public.member_milestones for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Scheduled-event participation. The bot inserts one row the first time it sees
-- a member mark interest in an event (GuildScheduledEventUserAdd); the unique
-- constraint dedupes re-joins. Counted by the metrics RPC to drive the "events"
-- milestone. Mirrors giveaway_entries (which already gives us the "giveaways"
-- count). History starts empty — only joins seen after this ships are counted.
create table if not exists public.member_event_participation (
  guild_id  text        not null,
  user_id   text        not null,
  event_id  text        not null,
  joined_at timestamptz not null default now(),
  unique (guild_id, user_id, event_id)
);

create index if not exists member_event_participation_guild_user
  on public.member_event_participation (guild_id, user_id);

alter table public.member_event_participation enable row level security;

create policy "Allow all access to member_event_participation"
  on public.member_event_participation for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Per-member metric aggregate for one guild. One round-trip returns every
-- member who has *any* tracked activity, with the numbers the sweep needs to
-- evaluate milestones. join_age is intentionally omitted (computed bot-side
-- from the Discord join date). Only members with activity appear — members with
-- none can only satisfy a join_age milestone, which the bot handles separately.
create or replace function public.get_member_milestone_metrics(
  p_guild_id text
)
returns table (
  user_id    text,
  user_name  text,
  messages   bigint,
  voice_seconds bigint,
  commands   bigint,
  events     bigint,
  giveaways  bigint,
  xp         bigint,
  level      integer
)
language sql
stable
as $$
  with ev as (
    select
      user_id,
      count(*) filter (where event_type = 'message') as messages,
      count(*) filter (where event_type = 'command') as commands,
      max(user_name)                                  as user_name
    from public.analytics_events
    where guild_id = p_guild_id
      and user_id is not null
      and event_type in ('message', 'command')
    group by user_id
  ),
  vs as (
    select user_id, sum(duration_seconds) as voice_seconds
    from public.voice_sessions
    where guild_id = p_guild_id
    group by user_id
  ),
  gw as (
    select user_id, count(*) as giveaways
    from public.giveaway_entries
    where guild_id = p_guild_id
    group by user_id
  ),
  evt as (
    select user_id, count(*) as events
    from public.member_event_participation
    where guild_id = p_guild_id
    group by user_id
  ),
  lv as (
    select user_id, xp, level, user_name
    from public.member_levels
    where guild_id = p_guild_id
  ),
  ids as (
    select user_id from ev
    union select user_id from vs
    union select user_id from gw
    union select user_id from evt
    union select user_id from lv
  )
  select
    ids.user_id,
    coalesce(lv.user_name, ev.user_name)  as user_name,
    coalesce(ev.messages, 0)              as messages,
    coalesce(vs.voice_seconds, 0)         as voice_seconds,
    coalesce(ev.commands, 0)              as commands,
    coalesce(evt.events, 0)               as events,
    coalesce(gw.giveaways, 0)             as giveaways,
    coalesce(lv.xp, 0)                    as xp,
    coalesce(lv.level, 0)                 as level
  from ids
    left join ev  on ev.user_id  = ids.user_id
    left join vs  on vs.user_id  = ids.user_id
    left join gw  on gw.user_id  = ids.user_id
    left join evt on evt.user_id = ids.user_id
    left join lv  on lv.user_id  = ids.user_id;
$$;

grant execute on function public.get_member_milestone_metrics(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Realtime: the dashboard's milestone list / members / analytics update live as
-- members earn milestones, and the bot picks up definition changes without a
-- restart (milestones-watch channel in milestones.js).
do $$
declare
  t text;
begin
  foreach t in array array['milestones', 'member_milestones']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================
-- Pulsify — Gaming Analytics (PULSIFY-64)
--
-- What the server plays, for how long, and with whom. Discord already
-- broadcasts a member's current game through presence, but it keeps no
-- history: the moment someone stops playing, the information is gone. Pulsify
-- listens to those presence transitions, turns them into SESSIONS with a start,
-- an end and a duration, and builds the analytics a gaming community actually
-- wants — most played games, live activity, player profiles, leaderboards,
-- trends, heatmaps and squad detection.
--
-- WHY SESSIONS RATHER THAN SAMPLES:
--   Polling presence every N minutes and counting samples would be simpler, but
--   it cannot answer "how long was your longest session", it double-counts on
--   bot restarts, and its accuracy is capped by the poll interval. A session
--   row (started_at → ended_at) is exact, survives restarts, and every other
--   statistic in the module is a GROUP BY over it. One table is the truth;
--   everything else is an aggregate read.
--
-- ONE OPEN SESSION PER MEMBER, enforced by a unique partial index. Discord can
-- report several activities at once (a game plus Spotify plus a custom status),
-- but "what are you playing" has one answer. The bot picks the single playable
-- activity, and switching games closes the old session before opening the new
-- one. The index makes that state machine impossible to corrupt — a double
-- open raises instead of silently double-counting the member's playtime.
--
-- Two writers, same shape as invites / birthdays / timeline:
--   • BOT (pulse-bot/src/gaming.js) owns the truth. It listens to
--     presenceUpdate, opens/closes/switches sessions, reconciles orphaned open
--     sessions on ready (a restart leaves sessions open), and enforces privacy
--     (ignored roles/members/games, per-member opt-out) at WRITE time so
--     excluded members never reach the database at all.
--   • DASHBOARD (Analytics › Gaming) owns configuration (`gaming_settings`)
--     and reads everything through the aggregate RPCs below.
--
-- PRIVACY IS A WRITE-TIME CONCERN. Presence is personal data, so exclusion is
-- enforced before the insert rather than filtered on read: an opted-out member
-- leaves no rows behind, and turning tracking off stops collection entirely.
-- `gaming_opt_outs` is deliberately its own table (not a list inside settings)
-- so a member can opt themselves out through the bot without the dashboard
-- granting them write access to guild configuration.
--
-- RETENTION follows the [[timeline]] precedent: rows are never pruned by this
-- migration. The configured retention (and the plan's `logRetentionDays`) is
-- applied as the QUERY WINDOW in the API, so shortening it hides history rather
-- than destroying it, and lengthening it brings the history back.
--
-- Three tables + six RPCs:
--   • gaming_sessions   — one row per play session (the only source of truth)
--   • gaming_settings   — one config row per guild
--   • gaming_opt_outs   — per-member exclusion, member-owned
--   • get_gaming_overview  — server-wide totals in one round trip
--   • get_gaming_games     — per-game aggregate (rankings, game details)
--   • get_gaming_players   — per-member aggregate (leaderboards, profiles)
--   • get_gaming_daily     — per-day buckets (trends, growth, sparklines)
--   • get_gaming_heatmap   — hour × weekday buckets (activity heatmaps)
--   • get_gaming_coplay    — member pairs sharing games AND wall-clock time
--                            (squad detection)
-- ============================================================

-- ---------------------------------------------------------------
-- One row per play session. Open sessions (`ended_at is null`) are the live
-- activity feed; closed sessions carry `duration_seconds` so every aggregate is
-- a plain sum rather than a per-row interval computation.
create table if not exists public.gaming_sessions (
  id            uuid        primary key default gen_random_uuid(),
  guild_id      text        not null,
  user_id       text        not null,
  -- Server display name at the time of the session (nickname → global name →
  -- username), denormalised the same way notifications/timeline do it so
  -- historical rows still render after someone leaves or renames.
  user_name     text,

  -- As Discord reports it ("Counter-Strike 2"), rendered verbatim in the UI.
  game_name     text        not null,
  -- Grouping key: lower(trim(game_name)). Discord is inconsistent about casing
  -- and stray whitespace across clients, and without a normalised key the same
  -- game splits into several rows in every ranking.
  game_key      text        not null,
  -- Discord application id when the activity carries one. Verified games have a
  -- stable id even when the display name changes; null for anything Discord
  -- could not identify.
  application_id text,

  started_at    timestamptz not null default now(),
  -- Null while the member is still playing. Set when the session closes.
  ended_at      timestamptz,
  -- Written on close. Null while open — the UI computes a live duration from
  -- started_at instead, so an open session never reports a stale number.
  duration_seconds int,

  -- How the session was observed. 'presence' is the only writer today;
  -- 'recovered' marks a session the bot closed during startup reconciliation
  -- (see gaming.js), where the true end time is an estimate rather than an
  -- observed transition. Keeping them distinguishable means a restart never
  -- silently pollutes "longest session" records.
  source        text        not null default 'presence',

  -- Optional context captured at session start, for the live activity cards.
  voice_channel_id   text,
  voice_channel_name text,
  was_streaming boolean     not null default false,

  created_at    timestamptz not null default now()
);

-- The feed and every date-ranged aggregate.
create index if not exists gaming_sessions_guild_started
  on public.gaming_sessions (guild_id, started_at desc);
-- Per-game rankings and game detail pages.
create index if not exists gaming_sessions_guild_game
  on public.gaming_sessions (guild_id, game_key, started_at desc);
-- Player profiles and per-member leaderboards.
create index if not exists gaming_sessions_guild_user
  on public.gaming_sessions (guild_id, user_id, started_at desc);
-- Live activity: a small, hot slice of a potentially huge table.
create index if not exists gaming_sessions_open
  on public.gaming_sessions (guild_id)
  where ended_at is null;

-- The state machine's integrity guarantee: a member can have at most one open
-- session per guild. Switching games must close the previous session first.
create unique index if not exists gaming_sessions_one_open_per_member
  on public.gaming_sessions (guild_id, user_id)
  where ended_at is null;

alter table public.gaming_sessions enable row level security;
drop policy if exists "Allow all access to gaming_sessions" on public.gaming_sessions;
create policy "Allow all access to gaming_sessions"
  on public.gaming_sessions for all using (true) with check (true);

-- ---------------------------------------------------------------
-- One config row per guild. `enabled` is the master switch the bot reads before
-- recording anything; everything else rides in `settings` jsonb, matching the
-- invite_settings / birthday_settings convention:
--   ignoredRoles      text[]  — members holding any of these are never tracked
--   ignoredMembers    text[]  — explicit member exclusions (admin side)
--   ignoredGames      text[]  — game_key values to skip (launchers, "Custom
--                               Status" impostors, anything the server calls
--                               noise)
--   retentionDays     int     — query window; 0 / null = the plan's maximum
--   anonymizeStats    bool    — aggregate views hide member identities
--   allowMemberOptOut bool    — whether /gaming opt-out is offered
--   exportRoles       text[]  — roles allowed to export beyond admins
--   minSessionSeconds int     — sessions shorter than this are discarded as
--                               noise (alt-tabbing through a launcher)
create table if not exists public.gaming_settings (
  guild_id   text        primary key,
  enabled    boolean     not null default false,
  settings   jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gaming_settings enable row level security;
drop policy if exists "Allow all access to gaming_settings" on public.gaming_settings;
create policy "Allow all access to gaming_settings"
  on public.gaming_settings for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Member-owned exclusion. Separate from `gaming_settings.ignoredMembers` on
-- purpose: that list is the ADMIN's, this one is the MEMBER's. A member opting
-- out through /gaming opt-out must not require (or imply) permission to edit
-- guild configuration, and the two lists answer different questions when
-- someone asks why they are missing from a leaderboard.
--
-- Opting out stops collection; `purge_history` records whether the member also
-- asked for their existing sessions to be deleted, which the bot honours at
-- opt-out time.
create table if not exists public.gaming_opt_outs (
  guild_id      text        not null,
  user_id       text        not null,
  purge_history boolean     not null default false,
  created_at    timestamptz not null default now(),
  primary key (guild_id, user_id)
);

alter table public.gaming_opt_outs enable row level security;
drop policy if exists "Allow all access to gaming_opt_outs" on public.gaming_opt_outs;
create policy "Allow all access to gaming_opt_outs"
  on public.gaming_opt_outs for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Server-wide totals in one round trip. Every number on the overview header
-- comes from here rather than from six separate counts.
--
-- `p_since` is the retention/query window (null = everything). `p_tz` is the
-- guild's display timezone, used for the "today" and "this week" boundaries so
-- a server in UTC+9 does not see its day roll over mid-evening.
--
-- Open sessions contribute their elapsed time so far to the totals — otherwise
-- a long raid in progress would be invisible until it ended.
create or replace function public.get_gaming_overview(
  p_guild_id text,
  p_since    timestamptz default null,
  p_tz       text default 'UTC'
)
returns table (
  total_seconds        bigint,
  total_sessions       bigint,
  unique_games         bigint,
  unique_players       bigint,
  active_today         bigint,
  active_week          bigint,
  currently_playing    bigint,
  avg_session_seconds  numeric,
  longest_seconds      bigint,
  first_session_at     timestamptz,
  last_session_at      timestamptz
)
language sql
stable
as $$
  with scoped as (
    select
      s.*,
      -- Elapsed seconds: exact for closed sessions, live for open ones.
      coalesce(s.duration_seconds, extract(epoch from (now() - s.started_at))::int) as seconds
    from public.gaming_sessions s
    where s.guild_id = p_guild_id
      and (p_since is null or s.started_at >= p_since)
  ),
  bounds as (
    select
      date_trunc('day',  (now() at time zone p_tz)) at time zone p_tz as day_start,
      date_trunc('week', (now() at time zone p_tz)) at time zone p_tz as week_start
  )
  select
    coalesce(sum(sc.seconds), 0)::bigint                                   as total_seconds,
    count(*)::bigint                                                        as total_sessions,
    count(distinct sc.game_key)::bigint                                     as unique_games,
    count(distinct sc.user_id)::bigint                                      as unique_players,
    count(distinct sc.user_id) filter (
      where sc.started_at >= (select day_start from bounds)
    )::bigint                                                               as active_today,
    count(distinct sc.user_id) filter (
      where sc.started_at >= (select week_start from bounds)
    )::bigint                                                               as active_week,
    count(*) filter (where sc.ended_at is null)::bigint                     as currently_playing,
    -- Closed sessions only: an in-flight session would drag the average down
    -- purely because it has not finished yet.
    avg(sc.duration_seconds) filter (where sc.ended_at is not null)         as avg_session_seconds,
    coalesce(max(sc.duration_seconds), 0)::bigint                           as longest_seconds,
    min(sc.started_at)                                                      as first_session_at,
    max(sc.started_at)                                                      as last_session_at
  from scoped sc;
$$;

grant execute on function public.get_gaming_overview(text, timestamptz, text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Per-game aggregate: the "Most Played Games" rankings, the game detail header,
-- and the raw material the engine turns into growth / newly-played lists.
--
-- `first_seen_at` is what makes "newly played games" possible without a second
-- query, and `players_today` / `players_week` feed the "most active today /
-- this week" boards.
create or replace function public.get_gaming_games(
  p_guild_id text,
  p_since    timestamptz default null,
  p_tz       text default 'UTC'
)
returns table (
  game_key           text,
  game_name          text,
  application_id     text,
  total_seconds      bigint,
  total_sessions     bigint,
  unique_players     bigint,
  avg_session_seconds numeric,
  longest_seconds    bigint,
  currently_playing  bigint,
  players_today      bigint,
  players_week       bigint,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz
)
language sql
stable
as $$
  with scoped as (
    select
      s.*,
      coalesce(s.duration_seconds, extract(epoch from (now() - s.started_at))::int) as seconds
    from public.gaming_sessions s
    where s.guild_id = p_guild_id
      and (p_since is null or s.started_at >= p_since)
  ),
  bounds as (
    select
      date_trunc('day',  (now() at time zone p_tz)) at time zone p_tz as day_start,
      date_trunc('week', (now() at time zone p_tz)) at time zone p_tz as week_start
  )
  select
    sc.game_key,
    -- Most recently observed spelling wins, so a game that fixes its own
    -- capitalisation stops showing the old form.
    (array_agg(sc.game_name order by sc.started_at desc))[1]                as game_name,
    (array_agg(sc.application_id order by sc.started_at desc)
       filter (where sc.application_id is not null))[1]                     as application_id,
    coalesce(sum(sc.seconds), 0)::bigint                                    as total_seconds,
    count(*)::bigint                                                        as total_sessions,
    count(distinct sc.user_id)::bigint                                      as unique_players,
    avg(sc.duration_seconds) filter (where sc.ended_at is not null)         as avg_session_seconds,
    coalesce(max(sc.duration_seconds), 0)::bigint                           as longest_seconds,
    count(*) filter (where sc.ended_at is null)::bigint                     as currently_playing,
    count(distinct sc.user_id) filter (
      where sc.started_at >= (select day_start from bounds)
    )::bigint                                                               as players_today,
    count(distinct sc.user_id) filter (
      where sc.started_at >= (select week_start from bounds)
    )::bigint                                                               as players_week,
    min(sc.started_at)                                                      as first_seen_at,
    max(sc.started_at)                                                      as last_seen_at
  from scoped sc
  group by sc.game_key;
$$;

grant execute on function public.get_gaming_games(text, timestamptz, text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Per-member aggregate: playtime leaderboards, session leaderboards, variety
-- ("most different games played") and the header of every player profile.
--
-- `favourite_game` is resolved here rather than in JS because picking it needs
-- a per-member GROUP BY over the same rows we are already scanning.
create or replace function public.get_gaming_players(
  p_guild_id text,
  p_since    timestamptz default null
)
returns table (
  user_id             text,
  user_name           text,
  total_seconds       bigint,
  total_sessions      bigint,
  unique_games        bigint,
  avg_session_seconds numeric,
  longest_seconds     bigint,
  currently_playing   boolean,
  favourite_game      text,
  favourite_seconds   bigint,
  first_session_at    timestamptz,
  last_session_at     timestamptz
)
language sql
stable
as $$
  with scoped as (
    select
      s.*,
      coalesce(s.duration_seconds, extract(epoch from (now() - s.started_at))::int) as seconds
    from public.gaming_sessions s
    where s.guild_id = p_guild_id
      and (p_since is null or s.started_at >= p_since)
  ),
  per_game as (
    select
      sc.user_id,
      sc.game_key,
      (array_agg(sc.game_name order by sc.started_at desc))[1] as game_name,
      sum(sc.seconds)                                          as seconds
    from scoped sc
    group by sc.user_id, sc.game_key
  ),
  favourite as (
    select distinct on (pg.user_id)
      pg.user_id,
      pg.game_name,
      pg.seconds
    from per_game pg
    order by pg.user_id, pg.seconds desc, pg.game_name
  )
  select
    sc.user_id,
    (array_agg(sc.user_name order by sc.started_at desc)
       filter (where sc.user_name is not null))[1]                      as user_name,
    coalesce(sum(sc.seconds), 0)::bigint                                as total_seconds,
    count(*)::bigint                                                    as total_sessions,
    count(distinct sc.game_key)::bigint                                 as unique_games,
    avg(sc.duration_seconds) filter (where sc.ended_at is not null)     as avg_session_seconds,
    coalesce(max(sc.duration_seconds), 0)::bigint                       as longest_seconds,
    bool_or(sc.ended_at is null)                                        as currently_playing,
    max(f.game_name)                                                    as favourite_game,
    coalesce(max(f.seconds), 0)::bigint                                 as favourite_seconds,
    min(sc.started_at)                                                  as first_session_at,
    max(sc.started_at)                                                  as last_session_at
  from scoped sc
  left join favourite f on f.user_id = sc.user_id
  group by sc.user_id;
$$;

grant execute on function public.get_gaming_players(text, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------
-- Per-day buckets for the trend charts, growth comparisons and sparklines.
-- Bucketed in the guild's timezone so "busiest day" means the day the community
-- experienced, not the day UTC recorded.
--
-- Optional `p_game_key` narrows the series to one game, which is what the game
-- detail page's daily/weekly/monthly trends read.
create or replace function public.get_gaming_daily(
  p_guild_id text,
  p_since    timestamptz default null,
  p_tz       text default 'UTC',
  p_game_key text default null
)
returns table (
  day            date,
  total_seconds  bigint,
  total_sessions bigint,
  unique_players bigint,
  unique_games   bigint
)
language sql
stable
as $$
  select
    (s.started_at at time zone p_tz)::date                as day,
    coalesce(sum(
      coalesce(s.duration_seconds, extract(epoch from (now() - s.started_at))::int)
    ), 0)::bigint                                          as total_seconds,
    count(*)::bigint                                       as total_sessions,
    count(distinct s.user_id)::bigint                      as unique_players,
    count(distinct s.game_key)::bigint                     as unique_games
  from public.gaming_sessions s
  where s.guild_id = p_guild_id
    and (p_since is null or s.started_at >= p_since)
    and (p_game_key is null or s.game_key = p_game_key)
  group by 1
  order by 1;
$$;

grant execute on function public.get_gaming_daily(text, timestamptz, text, text) to anon, authenticated;

-- ---------------------------------------------------------------
-- The same daily buckets, but split PER GAME in one round trip.
--
-- The alternative is calling get_gaming_daily once per game to build the
-- "fastest growing / losing popularity" lists, which is N queries for a page
-- that already runs five. This returns the whole cube at once and the engine
-- (lib/gaming.ts computeGameTrends) groups it by key. It also backs the
-- sparkline on every row of the games table and the daily/weekly/monthly
-- trends on the game detail page.
create or replace function public.get_gaming_game_daily(
  p_guild_id text,
  p_since    timestamptz default null,
  p_tz       text default 'UTC'
)
returns table (
  game_key       text,
  day            date,
  total_seconds  bigint,
  total_sessions bigint,
  unique_players bigint
)
language sql
stable
as $$
  select
    s.game_key,
    (s.started_at at time zone p_tz)::date              as day,
    coalesce(sum(
      coalesce(s.duration_seconds, extract(epoch from (now() - s.started_at))::int)
    ), 0)::bigint                                        as total_seconds,
    count(*)::bigint                                     as total_sessions,
    count(distinct s.user_id)::bigint                    as unique_players
  from public.gaming_sessions s
  where s.guild_id = p_guild_id
    and (p_since is null or s.started_at >= p_since)
  group by 1, 2
  order by 1, 2;
$$;

grant execute on function public.get_gaming_game_daily(text, timestamptz, text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Hour × weekday buckets for the activity heatmaps, peak-hour and
-- busiest-weekday statistics.
--
-- A session is attributed to the hour it STARTED. Splitting long sessions
-- across every hour they span would be more accurate for "concurrent players"
-- but wrong for "when does this community sit down to play", which is the
-- question the heatmap is asked. The distinction is documented in lib/gaming.ts
-- where the numbers are labelled.
create or replace function public.get_gaming_heatmap(
  p_guild_id text,
  p_since    timestamptz default null,
  p_tz       text default 'UTC'
)
returns table (
  weekday        int,     -- 0 = Sunday, matching JS getDay()
  hour           int,     -- 0-23 in the guild's timezone
  total_sessions bigint,
  total_seconds  bigint,
  unique_players bigint
)
language sql
stable
as $$
  select
    extract(dow  from (s.started_at at time zone p_tz))::int as weekday,
    extract(hour from (s.started_at at time zone p_tz))::int as hour,
    count(*)::bigint                                          as total_sessions,
    coalesce(sum(
      coalesce(s.duration_seconds, extract(epoch from (now() - s.started_at))::int)
    ), 0)::bigint                                             as total_seconds,
    count(distinct s.user_id)::bigint                          as unique_players
  from public.gaming_sessions s
  where s.guild_id = p_guild_id
    and (p_since is null or s.started_at >= p_since)
  group by 1, 2;
$$;

grant execute on function public.get_gaming_heatmap(text, timestamptz, text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Squad detection. Two members belong in the same squad when they play the same
-- games AT THE SAME TIME — not merely when they both own a game. That means a
-- self-join on game_key with a genuine wall-clock overlap, which is why this
-- lives in SQL: the pair-wise comparison is exactly what a database is good at
-- and exactly what fanning out to JS would make quadratic over the network.
--
-- `user_a < user_b` keeps each pair once. `p_min_overlap_seconds` drops pairs
-- who merely happened to launch the same game in the same hour, and `p_limit`
-- bounds the result for very large servers — the UI only ever shows the top
-- groups, and an unbounded pair list on a busy server is the one query in this
-- module that could genuinely hurt.
create or replace function public.get_gaming_coplay(
  p_guild_id             text,
  p_since                timestamptz default null,
  p_min_overlap_seconds  int default 900,
  p_limit                int default 200
)
returns table (
  user_a          text,
  user_a_name     text,
  user_b          text,
  user_b_name     text,
  shared_games    bigint,
  overlap_seconds bigint,
  sessions_together bigint,
  last_together_at  timestamptz
)
language sql
stable
as $$
  with scoped as (
    select
      s.guild_id, s.user_id, s.user_name, s.game_key, s.game_name,
      s.started_at,
      coalesce(s.ended_at, now()) as ended_at
    from public.gaming_sessions s
    where s.guild_id = p_guild_id
      and (p_since is null or s.started_at >= p_since)
  ),
  pairs as (
    select
      a.user_id   as user_a,
      a.user_name as user_a_name,
      b.user_id   as user_b,
      b.user_name as user_b_name,
      a.game_key,
      -- Overlap of the two intervals, floored at zero.
      greatest(
        0,
        extract(epoch from (
          least(a.ended_at, b.ended_at) - greatest(a.started_at, b.started_at)
        ))
      )::bigint as overlap_seconds,
      least(a.ended_at, b.ended_at) as ended_together_at
    from scoped a
    join scoped b
      on b.game_key = a.game_key
     and b.user_id  > a.user_id
     -- Interval intersection test, index-friendly and evaluated before the
     -- expensive epoch arithmetic above.
     and b.started_at < a.ended_at
     and a.started_at < b.ended_at
  )
  select
    p.user_a,
    max(p.user_a_name)                     as user_a_name,
    p.user_b,
    max(p.user_b_name)                     as user_b_name,
    count(distinct p.game_key)::bigint     as shared_games,
    sum(p.overlap_seconds)::bigint         as overlap_seconds,
    count(*)::bigint                       as sessions_together,
    max(p.ended_together_at)               as last_together_at
  from pairs p
  group by p.user_a, p.user_b
  having sum(p.overlap_seconds) >= p_min_overlap_seconds
  order by sum(p.overlap_seconds) desc
  limit p_limit;
$$;

grant execute on function public.get_gaming_coplay(text, timestamptz, int, int) to anon, authenticated;

-- ============================================================
-- Pulsify — Server Timeline (PULSIFY-63)
--
-- One chronological history of everything significant that happened to a
-- server, whether it was done in the Pulsify dashboard, by a slash command, or
-- straight inside Discord. Admins stop cross-referencing Discord's Audit Log
-- with a dozen module pages: they open Server › Timeline and read the story.
--
-- WHY A DEDICATED TABLE (rather than reading `notifications`):
--   • notifications is an ALERTING surface — it carries read/unread state, is
--     user-clearable ("Clear all" wipes the guild's rows), and is deliberately
--     noisy-but-shallow. History must survive someone clearing their bell.
--   • the timeline stores things notifications never did: the BEFORE and AFTER
--     value of a change, the affected users, which module was touched, and
--     whether the change came from the dashboard, Discord or the bot.
--   • the timeline is queried in ways a feed never is — grouped by day, sliced
--     by actor/module/date-range, aggregated into statistics, exported.
--
-- Notifications are still the front door: `recordNotification` (web + bot)
-- MIRRORS into this table via a type→event map, so every existing call site
-- feeds the timeline for free. Timeline-only events (nickname changes, Pulse
-- Guard detections, settings diffs, …) call the recorder directly.
--
-- Two writers, same shape as milestones / birthdays / invites:
--   • DASHBOARD  — lib/timeline-server.ts recordTimelineEvent()
--   • BOT        — pulse-bot/src/timeline.js createTimeline().record()
--
-- Retention: rows are never pruned here. The plan's `logRetentionDays` is
-- enforced as the QUERY WINDOW in the API (PULSIFY-62 audit §7.6 wanted this
-- to become real gating rather than pricing-page copy), so downgrading hides
-- history rather than destroying it.
-- ============================================================

-- ---------------------------------------------------------------
-- One row per significant server event, append-only.
create table if not exists public.timeline_events (
  id             uuid        primary key default gen_random_uuid(),
  guild_id       text        not null,

  -- Coarse grouping the UI colour-codes and filters by. One of:
  --   roles | channels | members | moderation | economy | automation |
  --   events | configuration
  -- Kept as text (not an enum) so adding a category is a code change, not a
  -- migration — same convention as notifications.category.
  category       text        not null,

  -- Fine-grained event identity, e.g. 'role_renamed', 'member_timeout',
  -- 'backup_restored'. The catalog lives in pulsify-web-app/lib/timeline.ts
  -- (TIMELINE_EVENTS) and is mirrored in pulse-bot/src/timeline.js.
  event_type     text        not null,

  -- Which Pulsify module the event belongs to ('roles', 'pulse-guard',
  -- 'backups', …). Drives the "most modified modules" statistic and the
  -- module filter. Null for events that aren't owned by a module.
  module         text,

  -- info | success | warning | critical — colours the card's status dot.
  severity       text        not null default 'info',

  -- Where the change came from. This is the column that makes the timeline
  -- more useful than Discord's Audit Log:
  --   dashboard — a human acting in Pulsify
  --   discord   — a human acting in the Discord client (attributed via the
  --               audit log by the bot)
  --   command   — a Pulse slash command
  --   bot       — Pulse acting on its own (sweeps, automations, expiries)
  --   system    — Pulsify infrastructure (webhooks, billing sync)
  source         text        not null default 'dashboard',

  -- Human-readable one-liner ("Role @Moderator was renamed to @Staff") and an
  -- optional longer body. Rendered verbatim on the card.
  title          text        not null,
  description    text,

  -- WHO did it. Null actor = Pulse itself. `actor_name` is the server display
  -- name (nickname → global name → username), `actor_username` the raw handle
  -- — same convention as notifications, so the two render identically.
  actor_id       text,
  actor_name     text,
  actor_username text,

  -- WHAT it happened to. `target_type` is a coarse noun the UI uses to pick an
  -- icon and to build the "quick navigation" link: role | channel | member |
  -- message | automation | giveaway | poll | event | announcement | integration
  -- | backup | template | setting | reward | ticket.
  target_id      text,
  target_name    text,
  target_type    text,

  -- BEFORE / AFTER. Free-form jsonb so a rename stores {"name":"Moderator"} →
  -- {"name":"Staff"} while a permission change stores a permission array. Both
  -- null for events that aren't a mutation (a member joining, a detection).
  previous_value jsonb,
  new_value      jsonb,

  -- Members the event touched beyond `target`: [{"id":"…","name":"…"}].
  -- A giveaway's winners, a bulk role grant, a raid's participants.
  affected_users jsonb       not null default '[]'::jsonb,

  -- Anything else worth showing in the detail drawer.
  metadata       jsonb       not null default '{}'::jsonb,

  -- Dashboard route the "Open" quick action navigates to.
  link           text,

  created_at     timestamptz not null default now(),

  -- Lowercased haystack for the search box (member, role, channel, keyword,
  -- administrator). Generated so it can never drift from the columns it
  -- summarises, and so search is a single ILIKE against one indexed column
  -- instead of an OR across six.
  search_text    text generated always as (
    lower(
      coalesce(title, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(actor_name, '') || ' ' ||
      coalesce(actor_username, '') || ' ' ||
      coalesce(target_name, '') || ' ' ||
      coalesce(event_type, '') || ' ' ||
      coalesce(module, '')
    )
  ) stored
);

-- The feed itself: newest-first within a guild, always the first filter.
create index if not exists timeline_events_guild_created
  on public.timeline_events (guild_id, created_at desc);
-- Category chips + the category breakdown statistic.
create index if not exists timeline_events_guild_category
  on public.timeline_events (guild_id, category, created_at desc);
-- "Show me everything this administrator did".
create index if not exists timeline_events_guild_actor
  on public.timeline_events (guild_id, actor_id, created_at desc)
  where actor_id is not null;
-- "Show me everything that happened to this member/role/channel" — powers the
-- member-detail deep link and the target filter.
create index if not exists timeline_events_guild_target
  on public.timeline_events (guild_id, target_id, created_at desc)
  where target_id is not null;
-- Event-type filter, and the module breakdown statistic.
create index if not exists timeline_events_guild_type
  on public.timeline_events (guild_id, event_type, created_at desc);
create index if not exists timeline_events_guild_module
  on public.timeline_events (guild_id, module, created_at desc)
  where module is not null;
-- Keyword search. `search_text` is already lowercased, so the API matches it
-- with LIKE (not ILIKE) against a lowercased needle — which text_pattern_ops
-- can serve for anchored patterns. A substring search ("%staff%") still scans,
-- but the API always pairs a search with the guild id and the plan's date
-- window, so the scan stays bounded to one server's recent history.
create index if not exists timeline_events_search
  on public.timeline_events (guild_id, search_text text_pattern_ops);

alter table public.timeline_events enable row level security;

-- Same posture as every other Pulsify table: access is enforced in the app
-- layer (requireGuildRole) and by the bot's service key, not by RLS.
create policy "Allow all access to timeline_events"
  on public.timeline_events for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Timeline statistics in a single round trip.
--
-- Returns one jsonb object so the dashboard doesn't fan out into six queries
-- for one stats strip:
--   {
--     "total": 1240, "today": 18, "week": 96, "month": 402,
--     "categories": [{"key":"roles","count":140}, …],
--     "modules":    [{"key":"moderation","count":88}, …],
--     "actors":     [{"id":"…","name":"…","username":"…","count":57}, …],
--     "hours":      [{"hour":0,"count":3}, … 24 entries],
--     "weekdays":   [{"weekday":0,"count":12}, … 7 entries],
--     "busiestDay": {"day":"2026-07-18","count":74}
--   }
--
-- `p_since` bounds every aggregate except today/week/month (which are always
-- relative to now) so the caller's plan retention window is respected.
create or replace function public.get_timeline_stats(
  p_guild_id text,
  p_since    timestamptz default null
)
returns jsonb
language sql
stable
as $$
  with scoped as (
    select *
      from public.timeline_events
     where guild_id = p_guild_id
       and (p_since is null or created_at >= p_since)
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'today', (select count(*) from scoped where created_at >= date_trunc('day', now())),
    'week',  (select count(*) from scoped where created_at >= now() - interval '7 days'),
    'month', (select count(*) from scoped where created_at >= now() - interval '30 days'),

    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('key', category, 'count', c) order by c desc)
        from (select category, count(*) c from scoped group by category) t
    ), '[]'::jsonb),

    -- Ordered BEFORE the limit — without it the cut would keep an arbitrary
    -- twelve modules and only then sort them, quietly dropping the busiest.
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object('key', module, 'count', c) order by c desc)
        from (
          select module, count(*) c
            from scoped
           where module is not null
           group by module
           order by count(*) desc
           limit 12
        ) t
    ), '[]'::jsonb),

    -- Most active administrators. Actor identity is denormalised onto every
    -- row, so someone who changed their display name mid-window appears under
    -- two names; grouping on the id and taking the newest name for it keeps
    -- them as one person in the ranking.
    'actors', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', actor_id, 'name', name, 'username', username, 'count', c)
               order by c desc
             )
        from (
          select actor_id,
                 (array_agg(actor_name     order by created_at desc))[1] as name,
                 (array_agg(actor_username order by created_at desc))[1] as username,
                 count(*) c
            from scoped
           where actor_id is not null
           group by actor_id
           order by count(*) desc
           limit 8
        ) t
    ), '[]'::jsonb),

    -- Busiest periods: hour-of-day and day-of-week histograms (UTC), plus the
    -- single busiest calendar day in the window.
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h, 'count', c) order by h)
        from (
          select extract(hour from created_at at time zone 'UTC')::int h, count(*) c
            from scoped group by 1
        ) t
    ), '[]'::jsonb),

    'weekdays', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', d, 'count', c) order by d)
        from (
          select extract(dow from created_at at time zone 'UTC')::int d, count(*) c
            from scoped group by 1
        ) t
    ), '[]'::jsonb),

    'busiestDay', (
      select jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'count', c)
        from (
          select date_trunc('day', created_at at time zone 'UTC') as d, count(*) as c
            from scoped group by 1 order by count(*) desc limit 1
        ) t
    )
  );
$$;

-- ---------------------------------------------------------------
-- Distinct administrators who appear in the timeline, for the "Administrator"
-- filter dropdown. Cheap enough to run on page load; bounded by the same
-- retention window as the feed.
create or replace function public.get_timeline_actors(
  p_guild_id text,
  p_since    timestamptz default null
)
returns table (
  actor_id       text,
  actor_name     text,
  actor_username text,
  event_count    bigint,
  last_active_at timestamptz
)
language sql
stable
as $$
  select actor_id,
         (array_agg(actor_name     order by created_at desc))[1],
         (array_agg(actor_username order by created_at desc))[1],
         count(*),
         max(created_at)
    from public.timeline_events
   where guild_id = p_guild_id
     and actor_id is not null
     and (p_since is null or created_at >= p_since)
   group by actor_id
   order by count(*) desc
   limit 100;
$$;

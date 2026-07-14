-- ============================================================
-- Pulsify — Alt Risk Detection & Investigation System (PULSIFY-59)
--
-- Moderators look an account up (dashboard or /alt-check) and Pulse scores it
-- against the signals it already collects — account age, join recency, default
-- avatar, activity, moderation history, reputation, economy, giveaways,
-- applications, onboarding/verification and prior safety flags — then surfaces
-- POTENTIAL linked accounts with a confidence percentage. Nothing here claims a
-- match: the score and the links are evidence for a human, never a verdict.
--
-- The risk score itself is COMPUTED, never stored as truth: it's derived on the
-- fly from tables that already exist (analytics_events, moderation_logs,
-- economy_*, giveaway_entries, ticket_applications, onboarding_member_progress,
-- ai_moderation_events, security_events). The tables below only store what a
-- human contributes — investigations, notes, manual links — plus a lookup trail
-- and a score SNAPSHOT for the dashboard's queue (so the queue can be sorted
-- without re-scoring every member on every page load).
--
-- Two writers, same as milestones / birthdays:
--   • DASHBOARD (moderators) opens investigations, writes notes, links accounts.
--   • BOT (pulse-bot/src/alt-detection.js) answers /alt-check and auto-flags
--     high/critical accounts on join, opening an investigation for the queue.
--
-- Four tables:
--   • alt_investigations       — one open case per member per guild
--   • alt_investigation_events — append-only timeline (notes, status, flags)
--   • alt_account_links        — moderator-asserted links between two accounts
--   • alt_lookups              — who looked up whom, and what the score was
-- ============================================================

-- ---------------------------------------------------------------
-- One investigation per member per guild. Opened by a moderator from the
-- dashboard, or automatically by the bot when a joining account scores high /
-- critical. `risk_score` + `risk_level` are a SNAPSHOT taken when the case was
-- last touched — the live score is always recomputed on lookup; this copy only
-- exists so the investigation queue can sort/filter without scoring the guild.
create table if not exists public.alt_investigations (
  id            uuid        primary key default gen_random_uuid(),
  guild_id      text        not null,
  user_id       text        not null,
  user_name     text,
  -- open | monitoring | cleared | confirmed | banned
  --   open       — needs review (the queue)
  --   monitoring — plausible but unproven; keep an eye on it
  --   cleared    — reviewed, no action (a false positive)
  --   confirmed  — the moderator judged this an alt/throwaway
  --   banned     — actioned and removed
  status        text        not null default 'open',
  -- 0-100 snapshot of the computed Alt Risk Score, and its band.
  risk_score    integer     not null default 0,
  -- low | moderate | high | critical
  risk_level    text        not null default 'low',
  -- The signal ids that fired when the snapshot was taken (["new_account", …]),
  -- so the queue can show why a case exists without a re-score.
  signals       jsonb       not null default '[]'::jsonb,
  -- dashboard | command | auto (bot join-time flag)
  source        text        not null default 'dashboard',
  opened_by     text,
  opened_by_name text,
  -- Free-text outcome recorded when the case is closed (cleared/confirmed/banned).
  resolution    text,
  resolved_at   timestamptz,
  resolved_by   text,
  resolved_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One case per member per guild — re-flagging an account updates it in place.
create unique index if not exists alt_investigations_guild_user
  on public.alt_investigations (guild_id, user_id);
-- The queue (open cases, worst first) and the resolved list.
create index if not exists alt_investigations_guild_status
  on public.alt_investigations (guild_id, status, risk_score desc);
create index if not exists alt_investigations_guild_updated
  on public.alt_investigations (guild_id, updated_at desc);

alter table public.alt_investigations enable row level security;

create policy "Allow all access to alt_investigations"
  on public.alt_investigations for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Append-only investigation timeline. Every note a moderator writes, every
-- status change, every link added/removed and every automatic flag lands here,
-- so a case reads as a story rather than a set of current values.
create table if not exists public.alt_investigation_events (
  id          uuid        primary key default gen_random_uuid(),
  guild_id    text        not null,
  user_id     text        not null,
  -- note | status | flag | link | unlink | lookup
  kind        text        not null default 'note',
  -- The note body, or a one-line summary for non-note events.
  body        text,
  -- Event-specific context: { from, to } for a status change, { linked_user_id,
  -- confidence } for a link, { score, level, signals } for a flag.
  metadata    jsonb       not null default '{}'::jsonb,
  -- Null author = Pulse itself (the bot's automatic flags).
  author_id   text,
  author_name text,
  created_at  timestamptz not null default now()
);

create index if not exists alt_investigation_events_guild_user
  on public.alt_investigation_events (guild_id, user_id, created_at desc);
create index if not exists alt_investigation_events_guild_created
  on public.alt_investigation_events (guild_id, created_at desc);

alter table public.alt_investigation_events enable row level security;

create policy "Allow all access to alt_investigation_events"
  on public.alt_investigation_events for all using (true) with check (true);

-- ---------------------------------------------------------------
-- A moderator-asserted link between two accounts. These are the ONLY links the
-- product treats as authoritative — everything else the UI shows is a scored
-- "potential" link derived on the fly. The pair is stored NORMALISED (the
-- lexicographically smaller id in `user_id`) so a link can't be inserted twice
-- with the two accounts swapped.
create table if not exists public.alt_account_links (
  id               uuid        primary key default gen_random_uuid(),
  guild_id         text        not null,
  user_id          text        not null,   -- always the smaller of the two ids
  user_name        text,
  linked_user_id   text        not null,   -- always the larger of the two ids
  linked_user_name text,
  -- The moderator's own confidence in the link (0-100). Defaults to certain —
  -- a human asserting a link is a stronger claim than any computed signal.
  confidence       integer     not null default 100,
  -- The indicators that motivated the link, snapshotted at creation time.
  indicators       jsonb       not null default '[]'::jsonb,
  note             text,
  created_by       text,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  constraint alt_account_links_distinct_chk check (user_id <> linked_user_id),
  constraint alt_account_links_confidence_chk check (confidence between 0 and 100)
);

create unique index if not exists alt_account_links_pair
  on public.alt_account_links (guild_id, user_id, linked_user_id);
create index if not exists alt_account_links_guild_linked
  on public.alt_account_links (guild_id, linked_user_id);

alter table public.alt_account_links enable row level security;

create policy "Allow all access to alt_account_links"
  on public.alt_account_links for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Lookup trail — who checked which account, from where, and what the score was
-- at that moment. Doubles as the "previous lookups" list and as an audit record
-- (account risk is sensitive; knowing which moderator pulled a report matters).
create table if not exists public.alt_lookups (
  id          bigint      generated always as identity primary key,
  guild_id    text        not null,
  user_id     text        not null,
  user_name   text,
  risk_score  integer     not null default 0,
  risk_level  text        not null default 'low',
  -- dashboard | command
  source      text        not null default 'dashboard',
  actor_id    text,
  actor_name  text,
  created_at  timestamptz not null default now()
);

create index if not exists alt_lookups_guild_created
  on public.alt_lookups (guild_id, created_at desc);
create index if not exists alt_lookups_guild_user
  on public.alt_lookups (guild_id, user_id, created_at desc);

alter table public.alt_lookups enable row level security;

create policy "Allow all access to alt_lookups"
  on public.alt_lookups for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Hourly activity matrix for a SET of members, in one round trip.
--
-- "Similar activity patterns" compares the 24-hour message histograms of the
-- subject and its candidate links. get_member_hourly_activity already does this
-- for ONE member; calling it per candidate would be a dozen round trips per
-- lookup, so this variant takes an id array and returns every histogram at once.
create or replace function public.get_guild_hourly_matrix(
  p_guild_id text,
  p_user_ids text[],
  p_since    timestamptz default null
)
returns table (
  user_id       text,
  hour          int,
  message_count bigint
)
language sql
stable
as $$
  select
    ae.user_id,
    extract(hour from ae.created_at)::int as hour,
    count(*)                              as message_count
  from public.analytics_events ae
  where ae.guild_id = p_guild_id
    and ae.user_id = any(p_user_ids)
    and ae.event_type = 'message'
    and (p_since is null or ae.created_at >= p_since)
  group by 1, 2
$$;

-- ---------------------------------------------------------------
-- Realtime: the Alt Detection view updates live as the bot auto-flags joining
-- accounts and as other moderators work the queue.
do $$
declare
  t text;
begin
  foreach t in array array['alt_investigations', 'alt_investigation_events', 'alt_account_links', 'alt_lookups']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

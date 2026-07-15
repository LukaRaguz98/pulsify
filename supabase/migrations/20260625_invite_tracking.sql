-- ============================================================
-- Pulsify — Invite Tracking & Referral System (PULSIFY-60)
--
-- Tracks which invite a member used when they join, measures each inviter's
-- performance (valid vs fake vs left), prevents invite farming, and rewards
-- members for successful referrals — integrating with the existing Economy
-- (Pulse Coins), Levels & XP, Roles, Temporary Roles and Alt Detection modules.
--
-- Two-writer pattern (like milestones / birthdays):
--   • BOT (pulse-bot/src/invites.js) owns the truth: it mirrors every guild's
--     Discord invite list into `invites`, diffs the use counts on each join to
--     attribute the inviter, writes an `invited_members` row, evaluates validity
--     + retention, and reacts to leaves/rejoins. Referral REWARDS are Member
--     Milestones with the `invites` metric — the milestone sweep grants them.
--   • DASHBOARD (admins) owns configuration (`invite_settings`) and manual
--     management (`invite_adjustments`), and reads everything for the
--     Engagement › Invites views.
--
-- Four tables + two RPCs (referral REWARDS are Member Milestones with the
-- `invites` metric — NOT a separate table):
--   • invites               — the Discord invite registry (uses/inviter/code)
--   • invited_members       — one row per member join, attributed to an invite
--   • invite_settings       — one config row per guild (validity + anti-abuse)
--   • invite_adjustments    — manual admin actions / audit log (bonus credits…)
--   • get_invite_leaderboard(guild, since) — per-inviter aggregate in one round
--     trip so the leaderboard doesn't fan out N queries.
--   • get_member_milestone_metrics(guild) — REPLACED to add the `invites`
--     (valid + bonus) count so invite milestones evaluate + grant.
-- ============================================================

-- ---------------------------------------------------------------
-- Idempotency: this migration is safe to re-run. An earlier revision shipped
-- two extra tables (invite_rewards, invite_reward_claims) before referral
-- rewards moved onto the Member Milestones engine — drop them if a previous run
-- created them. `drop policy if exists` before every `create policy` (Postgres
-- has no CREATE POLICY IF NOT EXISTS) keeps re-runs from erroring.
drop table if exists public.invite_reward_claims cascade;
drop table if exists public.invite_rewards cascade;

-- ---------------------------------------------------------------
-- The Discord invite registry. The bot mirrors `guild.invites.fetch()` here on
-- ready + on every InviteCreate/Delete and rewrites `uses` when it diffs a join.
-- `deleted_at` soft-deletes an invite that Discord removed (expired / revoked)
-- so historical attribution survives. The vanity URL is stored as a synthetic
-- row with `is_vanity = true` and a null inviter.
create table if not exists public.invites (
  id           uuid        primary key default gen_random_uuid(),
  guild_id     text        not null,
  code         text        not null,
  inviter_id   text,                                  -- null for vanity / unknown
  inviter_name text,
  channel_id   text,
  uses         int         not null default 0,
  max_uses     int         not null default 0,        -- 0 = unlimited
  max_age      int         not null default 0,        -- seconds; 0 = never expires
  temporary    boolean     not null default false,
  is_vanity    boolean     not null default false,
  created_at   timestamptz,                            -- Discord invite creation
  last_seen_at timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint invites_guild_code unique (guild_id, code)
);

create index if not exists invites_guild_inviter on public.invites (guild_id, inviter_id);

alter table public.invites enable row level security;
drop policy if exists "Allow all access to invites" on public.invites;
create policy "Allow all access to invites"
  on public.invites for all using (true) with check (true);

-- ---------------------------------------------------------------
-- One row per member join, attributed to the invite (and therefore inviter)
-- that was used. On a rejoin the existing row is updated in place (joined_at
-- reset, left_at cleared, rejoin_count incremented) so there is exactly one row
-- per (guild, member) — the "current or last" membership episode.
--
-- `status` lifecycle: pending → valid | invalid | fake | left.
--   • pending — joined; not yet meeting the guild's valid-invite rules
--   • valid   — counts toward the inviter's score + rewards
--   • invalid — a rule failed (too-young account, no onboarding, …) or an admin
--               invalidated it; does not count
--   • fake    — anti-abuse tripped (self-invite, alt farming, rejoin abuse)
--   • left    — the member left the server
-- `is_bonus` marks synthetic rows created by manual "add credit" (no real
-- member) — kept out of retention math but counted in the inviter's total.
create table if not exists public.invited_members (
  id                   uuid        primary key default gen_random_uuid(),
  guild_id             text        not null,
  user_id              text        not null,
  user_name            text,
  inviter_id           text,                            -- null = unknown / vanity
  inviter_name         text,
  invite_code          text,
  -- normal | vanity | oauth | bot | unknown
  source               text        not null default 'normal',
  account_created_at   timestamptz,                     -- from the Discord snowflake
  joined_at            timestamptz not null default now(),
  left_at              timestamptz,
  -- pending | valid | invalid | fake | left
  status               text        not null default 'pending',
  fake_reason          text,
  is_alt               boolean     not null default false,
  completed_onboarding boolean     not null default false,
  verified             boolean     not null default false,
  is_active            boolean     not null default false,
  rejoin_count         int         not null default 0,
  is_bonus             boolean     not null default false,
  metadata             jsonb       not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint invited_members_guild_user unique (guild_id, user_id)
);

create index if not exists invited_members_guild_inviter on public.invited_members (guild_id, inviter_id);
create index if not exists invited_members_guild_status  on public.invited_members (guild_id, status);
create index if not exists invited_members_guild_joined  on public.invited_members (guild_id, joined_at desc);

alter table public.invited_members enable row level security;
drop policy if exists "Allow all access to invited_members" on public.invited_members;
create policy "Allow all access to invited_members"
  on public.invited_members for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Per-guild configuration. `enabled` is opt-in. Everything else lives in
-- `settings` jsonb (same { enabled, settings } shape as leveling_settings /
-- birthday_settings): the valid-invite rules, the anti-abuse toggles, the
-- reward stacking / removal flags and the notification routing.
create table if not exists public.invite_settings (
  guild_id   text        primary key,
  enabled    boolean     not null default false,
  settings   jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invite_settings enable row level security;
drop policy if exists "Allow all access to invite_settings" on public.invite_settings;
create policy "Allow all access to invite_settings"
  on public.invite_settings for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Referral REWARDS are NOT a separate system: they are Member Milestones with
-- the `invites` metric (see lib/milestones.ts). An invite milestone is created
-- from Engagement › Milestones (only offered when invite tracking is enabled),
-- and the milestone sweep grants it against the inviter's valid-invite count,
-- which the get_member_milestone_metrics RPC now returns (replaced below).

-- ---------------------------------------------------------------
-- Manual admin actions + audit log. Every manual change (add/remove bonus
-- credit, invalidate a join, approve a suspicious join, reset an inviter's
-- stats) writes a row here for the audit trail required by the acceptance
-- criteria. `amount` is the bonus-invite delta (may be negative);
-- `target_user_id` is the invited member for invalidate/approve.
create table if not exists public.invite_adjustments (
  id             uuid        primary key default gen_random_uuid(),
  guild_id       text        not null,
  user_id        text,                                  -- the inviter affected (null = guild-wide)
  user_name      text,
  -- bonus | invalidate | approve | reset
  kind           text        not null,
  amount         int         not null default 0,
  target_user_id text,                                  -- invited member (invalidate / approve)
  target_name    text,
  reason         text,
  created_by     text,
  created_by_name text,
  created_at     timestamptz not null default now()
);

create index if not exists invite_adjustments_guild on public.invite_adjustments (guild_id, created_at desc);
create index if not exists invite_adjustments_user  on public.invite_adjustments (guild_id, user_id);

alter table public.invite_adjustments enable row level security;
drop policy if exists "Allow all access to invite_adjustments" on public.invite_adjustments;
create policy "Allow all access to invite_adjustments"
  on public.invite_adjustments for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Per-inviter aggregate for one guild in a single round trip — the leaderboard
-- would otherwise fan out a query per inviter. `p_since` filters by join date
-- for the daily / weekly / monthly boards (pass null for all-time). Bonus
-- credits (invite_adjustments) and rewards-earned are merged in JS, not here.
create or replace function public.get_invite_leaderboard(
  p_guild_id text,
  p_since    timestamptz default null
)
returns table (
  inviter_id   text,
  inviter_name text,
  total        bigint,   -- every attributed join (excludes bonus placeholder rows)
  valid        bigint,   -- status = 'valid'
  invalid      bigint,   -- status = 'invalid'
  fake         bigint,   -- status = 'fake'
  left_count   bigint,   -- status = 'left'
  retained     bigint    -- valid AND still in the server (left_at is null)
)
language sql
stable
as $$
  select
    im.inviter_id,
    max(im.inviter_name)                                                   as inviter_name,
    count(*) filter (where not im.is_bonus)                                as total,
    count(*) filter (where im.status = 'valid')                           as valid,
    count(*) filter (where im.status = 'invalid')                        as invalid,
    count(*) filter (where im.status = 'fake')                           as fake,
    count(*) filter (where im.status = 'left')                           as left_count,
    count(*) filter (where im.status = 'valid' and im.left_at is null)   as retained
  from public.invited_members im
  where im.guild_id = p_guild_id
    and im.inviter_id is not null
    and (p_since is null or im.joined_at >= p_since)
  group by im.inviter_id;
$$;

grant execute on function public.get_invite_leaderboard(text, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------
-- Referral rewards run on the Member Milestones engine (metric `invites`), so
-- the milestone metrics RPC must expose each member's valid-invite count (as an
-- inviter) + bonus credits. Replace get_member_milestone_metrics (from
-- 20260605_milestones.sql) with a version that adds the `invites` column and
-- folds inviters with no other activity into the result set.
--
-- The `invites` column changes the function's return-table shape, and
-- CREATE OR REPLACE cannot alter a function's return type — drop it first so
-- this applies cleanly over the 20260605 version and on every re-run.
drop function if exists public.get_member_milestone_metrics(text);
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
  invites    bigint,
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
  iv as (
    select inviter_id as user_id, count(*) as invites
    from public.invited_members
    where guild_id = p_guild_id and inviter_id is not null and status = 'valid'
    group by inviter_id
  ),
  ib as (
    select user_id, sum(amount) as bonus
    from public.invite_adjustments
    where guild_id = p_guild_id and kind = 'bonus' and user_id is not null
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
    union select user_id from iv
    union select user_id from ib
    union select user_id from lv
  )
  select
    ids.user_id,
    coalesce(lv.user_name, ev.user_name)                       as user_name,
    coalesce(ev.messages, 0)                                    as messages,
    coalesce(vs.voice_seconds, 0)                               as voice_seconds,
    coalesce(ev.commands, 0)                                    as commands,
    coalesce(evt.events, 0)                                     as events,
    coalesce(gw.giveaways, 0)                                   as giveaways,
    greatest(0, coalesce(iv.invites, 0) + coalesce(ib.bonus, 0)) as invites,
    coalesce(lv.xp, 0)                                          as xp,
    coalesce(lv.level, 0)                                       as level
  from ids
    left join ev  on ev.user_id  = ids.user_id
    left join vs  on vs.user_id  = ids.user_id
    left join gw  on gw.user_id  = ids.user_id
    left join evt on evt.user_id = ids.user_id
    left join iv  on iv.user_id  = ids.user_id
    left join ib  on ib.user_id  = ids.user_id
    left join lv  on lv.user_id  = ids.user_id;
$$;

grant execute on function public.get_member_milestone_metrics(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Realtime: the dashboard's Invites views update live as members join / leave
-- and as the bot attributes invites; the bot picks up config changes without a
-- restart.
do $$
declare
  t text;
begin
  foreach t in array array[
    'invites', 'invited_members', 'invite_settings', 'invite_adjustments'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

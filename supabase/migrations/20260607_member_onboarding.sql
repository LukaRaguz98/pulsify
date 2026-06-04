-- ============================================================
-- Pulsify — Onboarding System Polish & Upgrade (PULSIFY-37)
--
-- Upgrades the member-facing Onboarding & Welcome experience. The dashboard
-- configures a guided onboarding journey (welcome embed + an interactive panel:
-- self-roles by category, a lightweight verify gate, featured events, community
-- links and completion rewards). The bot (pulse-bot/src/onboarding.js) delivers
-- the panel to new members and owns completion: it records a progress row, grants
-- selected roles, verifies, and on completion awards XP / starter roles / a
-- reputation bonus.
--
-- Config lives in guild_settings.settings.member_onboarding (jsonb — no DDL).
-- This migration adds the per-member tracking + analytics:
--   • onboarding_member_progress — one row per member who starts onboarding,
--     tracking selected roles, completed/skipped steps, verification and the
--     rewards granted. The analytics views read aggregates off this table.
--   • get_onboarding_stats(guild, days) — a single round-trip aggregate
--     (totals, completion rate, role + skipped-step breakdowns and a daily
--     starts/completions series) so the dashboard charts don't dump every row.
-- ============================================================

-- ---------------------------------------------------------------
-- Per-member onboarding progress. Written by the bot as a member moves through
-- the panel; `status` flips started -> completed when they finish (or it's
-- auto-completed). `selected_roles` is the set of self-assigned role ids,
-- `completed_steps` / `skipped_steps` track the reorderable step ids, and the
-- reward columns record what was granted so rewards are never double-applied.
create table if not exists public.onboarding_member_progress (
  guild_id         text        not null,
  user_id          text        not null,
  user_name        text,
  -- started | completed
  status           text        not null default 'started',
  -- ["<role_id>", ...] self-assigned during onboarding
  selected_roles   jsonb       not null default '[]'::jsonb,
  -- ["<step_id>", ...]
  completed_steps  jsonb       not null default '[]'::jsonb,
  skipped_steps    jsonb       not null default '[]'::jsonb,
  verified         boolean     not null default false,
  -- completion rewards (recorded so they apply exactly once)
  rewarded         boolean     not null default false,
  xp_awarded       integer     not null default 0,
  reputation_bonus integer     not null default 0,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create index if not exists onboarding_progress_guild
  on public.onboarding_member_progress (guild_id);
create index if not exists onboarding_progress_guild_started
  on public.onboarding_member_progress (guild_id, started_at);

alter table public.onboarding_member_progress enable row level security;

-- Service role (bot + dashboard server actions) bypasses RLS; no anon policy is
-- granted, mirroring the other bot-owned tables (member_levels, member_milestones).

-- ---------------------------------------------------------------
-- Aggregate stats for the dashboard Analytics tab. One round-trip returns the
-- headline counts, the role + skipped-step breakdowns, and a per-day series of
-- starts/completions over the last `p_days` days.
create or replace function public.get_onboarding_stats(
  p_guild_id text,
  p_days     integer default 30
)
returns jsonb
language sql
stable
as $$
  with rows as (
    select *
    from public.onboarding_member_progress
    where guild_id = p_guild_id
  ),
  windowed as (
    select * from rows
    where started_at >= now() - make_interval(days => greatest(p_days, 1))
  ),
  totals as (
    select
      count(*)::int                                         as starts,
      count(*) filter (where status = 'completed')::int     as completions,
      count(*) filter (where verified)::int                 as verified
    from windowed
  ),
  role_counts as (
    select r.role_id, count(*)::int as count
    from windowed w
    cross join lateral jsonb_array_elements_text(w.selected_roles) as r(role_id)
    group by r.role_id
    order by count desc
    limit 50
  ),
  skip_counts as (
    select s.step_id, count(*)::int as count
    from windowed w
    cross join lateral jsonb_array_elements_text(w.skipped_steps) as s(step_id)
    group by s.step_id
    order by count desc
  ),
  days as (
    select generate_series(
      (current_date - (greatest(p_days, 1) - 1) * interval '1 day')::date,
      current_date,
      interval '1 day'
    )::date as day
  ),
  series as (
    select
      d.day,
      count(w.user_id) filter (where w.started_at::date = d.day)::int    as starts,
      count(w.user_id) filter (
        where w.completed_at is not null and w.completed_at::date = d.day
      )::int                                                             as completions
    from days d
    left join windowed w
      on w.started_at::date = d.day or w.completed_at::date = d.day
    group by d.day
    order by d.day
  )
  select jsonb_build_object(
    'starts',          (select starts from totals),
    'completions',     (select completions from totals),
    'verified',        (select verified from totals),
    'completion_rate', case
                         when (select starts from totals) > 0
                         then round((select completions from totals)::numeric
                                    / (select starts from totals)::numeric, 4)
                         else 0
                       end,
    'roles',   coalesce((select jsonb_agg(jsonb_build_object('role_id', role_id, 'count', count)) from role_counts), '[]'::jsonb),
    'skipped', coalesce((select jsonb_agg(jsonb_build_object('step_id', step_id, 'count', count)) from skip_counts), '[]'::jsonb),
    'series',  coalesce((select jsonb_agg(jsonb_build_object('date', day, 'starts', starts, 'completions', completions)) from series), '[]'::jsonb)
  );
$$;

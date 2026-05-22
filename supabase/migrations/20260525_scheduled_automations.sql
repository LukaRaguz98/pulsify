-- ============================================================
-- Pulsify — Scheduled Automations & Workflows
-- Per-guild recurring automated actions ("workflows") plus the run history
-- that powers the dashboard's execution log and analytics.
--
-- The CATALOG of action types and schedule kinds (what Pulse can automate,
-- their fields and presets) lives in code — lib/automations.ts on the web side,
-- mirrored by pulse-bot/src/scheduler.js on the bot side. These tables hold the
-- per-server WORKFLOW DEFINITIONS and their run log, so adding a new action
-- type never requires a data migration.
-- ============================================================

-- One row per workflow an admin has created. Unlike command_configs (where a
-- missing row means "use defaults"), automations are explicitly created, so a
-- guild with no rows simply has no scheduled automations.
create table if not exists public.scheduled_automations (
  id               uuid        primary key default gen_random_uuid(),
  guild_id         text        not null,
  name             text        not null,
  enabled          boolean     not null default true,
  -- announcement | welcome_reminder | inactivity_cleanup | role_sync |
  -- temp_role_removal | scheduled_moderation | recurring_event | analytics_summary
  action_type      text        not null,
  -- Action-specific fields (channel_id, message, role_id, …). Shape depends on
  -- action_type and is validated in code on save.
  action_config    jsonb       not null default '{}'::jsonb,
  -- daily | weekly | monthly | interval | cron
  schedule_type    text        not null,
  -- Schedule-specific fields: { time }, { time, days }, { time, day },
  -- { every, unit } or { expr }. Interpreted in `timezone`.
  schedule_config  jsonb       not null default '{}'::jsonb,
  -- IANA timezone the schedule's wall-clock times are resolved against.
  timezone         text        not null default 'UTC',
  -- Optional gating evaluated at run time: { min_members, max_members, … }.
  conditions       jsonb       not null default '{}'::jsonb,
  -- Minimum minutes between two runs, on top of the schedule. 0 = none.
  cooldown_minutes integer     not null default 0,
  -- How many times the bot retries the action after a failure. 0 = no retry.
  max_retries      integer     not null default 0,
  -- Pre-computed next fire time (UTC). The bot fires when now() >= this, then
  -- recomputes it. null while disabled. The dashboard renders it as a preview.
  next_run_at      timestamptz,
  last_run_at      timestamptz,
  -- success | failed | skipped | retrying — the outcome of the most recent run.
  last_status      text,
  run_count        integer     not null default 0,
  fail_count       integer     not null default 0,
  -- Set by the dashboard "Run now" / "Test" action; the bot watches this column
  -- via realtime and fires a one-off manual run when it changes.
  run_requested_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       text,
  updated_by       text
);

create index if not exists scheduled_automations_guild
  on public.scheduled_automations (guild_id, created_at desc);
-- Partial index over the work the scheduler actually scans: enabled rows by
-- their next fire time.
create index if not exists scheduled_automations_due
  on public.scheduled_automations (next_run_at)
  where enabled;

alter table public.scheduled_automations enable row level security;

create policy "Allow all access to scheduled_automations"
  on public.scheduled_automations
  for all
  using (true)
  with check (true);

-- The bot subscribes to definition changes so it can refresh its in-memory
-- schedule the moment an admin edits/toggles a workflow, and so it can pick up
-- "Run now" requests immediately.
alter publication supabase_realtime add table public.scheduled_automations;

-- ---------------------------------------------------------------
-- Execution log. One row per run attempt — successful runs, failures, retries
-- and skips (a condition gated the run out). Powers the Scheduled analytics and
-- the live execution log.
create table if not exists public.automation_runs (
  id               bigint generated always as identity primary key,
  -- Soft reference: kept even after the automation is deleted so history
  -- survives. The denormalised name/type keep the log readable on its own.
  automation_id    uuid,
  guild_id         text        not null,
  automation_name  text,
  action_type      text,
  -- success | failed | skipped | retrying
  status           text        not null default 'success',
  -- Failure message, skip reason, or a short success summary.
  detail           text,
  -- 1-based attempt number (>1 means this row is a retry).
  attempt          integer     not null default 1,
  duration_ms      integer,
  -- schedule | manual | test
  triggered_by     text        not null default 'schedule',
  created_at       timestamptz not null default now()
);

create index if not exists automation_runs_guild_time
  on public.automation_runs (guild_id, created_at desc);
create index if not exists automation_runs_guild_status_time
  on public.automation_runs (guild_id, status, created_at desc);
create index if not exists automation_runs_automation_time
  on public.automation_runs (automation_id, created_at desc);

alter table public.automation_runs enable row level security;

create policy "Allow all access to automation_runs"
  on public.automation_runs
  for all
  using (true)
  with check (true);

-- Realtime: the dashboard subscribes to live inserts so the execution log and
-- per-workflow status update without polling.
alter publication supabase_realtime add table public.automation_runs;

-- ============================================================
-- Analytics aggregations. A null p_since means "all time" (no lower bound).
-- "skipped" counts runs a condition gated out; retries are not counted as
-- separate runs in the totals (they share the originating attempt's outcome
-- once it settles), but each retry row is still visible in the raw log.
-- ============================================================

create or replace function public.get_automation_stats(
  p_guild_id text,
  p_since    timestamptz
)
returns table (
  automation_id   uuid,
  automation_name text,
  action_type     text,
  total           bigint,
  success         bigint,
  failed          bigint,
  skipped         bigint,
  last_run        timestamptz
)
language sql
stable
as $$
  select
    automation_id,
    max(automation_name)                            as automation_name,
    max(action_type)                                as action_type,
    count(*) filter (where status <> 'retrying')    as total,
    count(*) filter (where status = 'success')      as success,
    count(*) filter (where status = 'failed')       as failed,
    count(*) filter (where status = 'skipped')      as skipped,
    max(created_at)                                 as last_run
  from public.automation_runs
  where guild_id = p_guild_id
    and (p_since is null or created_at >= p_since)
  group by automation_id
  order by total desc;
$$;

-- Time-bucketed run volume for the trends chart.
create or replace function public.get_automation_trends(
  p_guild_id text,
  p_since    timestamptz,
  p_trunc    text            -- 'hour' or 'day'
)
returns table (
  bucket  timestamptz,
  total   bigint,
  success bigint,
  failed  bigint
)
language sql
stable
as $$
  select
    date_trunc(p_trunc, created_at)                 as bucket,
    count(*) filter (where status <> 'retrying')    as total,
    count(*) filter (where status = 'success')      as success,
    count(*) filter (where status = 'failed')       as failed
  from public.automation_runs
  where guild_id = p_guild_id
    and (p_since is null or created_at >= p_since)
  group by 1
  order by 1;
$$;

grant execute on function public.get_automation_stats(text, timestamptz)        to anon, authenticated;
grant execute on function public.get_automation_trends(text, timestamptz, text) to anon, authenticated;

-- ============================================================
-- Pulsify — Command Center
-- Per-guild slash-command configuration + execution logging.
--
-- The CATALOG of commands (what Pulse offers, their defaults and examples)
-- lives in code — lib/commands.ts on the web side, mirrored by
-- pulse-bot/src/commands.js on the bot side. These tables hold only the
-- per-server OVERRIDES and the run history that powers analytics, so adding
-- a new command never requires a data migration.
-- ============================================================

-- Per-guild, per-command configuration. A MISSING row means "use the catalog
-- defaults" — both the bot and the dashboard treat absence as the
-- default-enabled state, so we never pre-seed rows when a guild joins.
create table if not exists public.command_configs (
  guild_id            text        not null,
  command_name        text        not null,
  enabled             boolean     not null default true,
  -- Hidden commands still run for those allowed, but are omitted from /help
  -- listings and flagged as "hidden" in the dashboard.
  hidden              boolean     not null default false,
  -- Category override; null = use the catalog's default category.
  category            text,
  -- Baseline access tier. 'inherit' = use the catalog default for the command.
  permission_level    text        not null default 'inherit', -- inherit | everyone | moderator | admin
  -- Role/channel allow + deny lists. Empty array = no restriction of that kind.
  allowed_role_ids    text[]      not null default '{}',
  denied_role_ids     text[]      not null default '{}',
  allowed_channel_ids text[]      not null default '{}',
  denied_channel_ids  text[]      not null default '{}',
  -- Per-user cooldown between invocations, in seconds. 0 = no cooldown.
  cooldown_seconds    integer     not null default 0,
  -- Per-guild daily usage cap (counts successful runs). 0 = unlimited.
  usage_limit_per_day integer     not null default 0,
  -- Maintenance pauses the command for everyone and drops it from
  -- registration — distinct from `enabled = false`, which is an intentional
  -- "we don't want this command here" disable.
  maintenance         boolean     not null default false,
  updated_at          timestamptz not null default now(),
  updated_by          text,
  primary key (guild_id, command_name)
);

alter table public.command_configs enable row level security;

create policy "Allow all access to command_configs"
  on public.command_configs
  for all
  using (true)
  with check (true);

-- The bot subscribes to config changes so it can re-register a guild's command
-- set the moment an admin toggles something in the dashboard.
alter publication supabase_realtime add table public.command_configs;

-- ---------------------------------------------------------------
-- Execution log. One row per command attempt — successful runs AND blocked
-- attempts (permission denied, on cooldown, rate-limited, maintenance,
-- disabled). Powers the Command Center analytics and the live execution log.
create table if not exists public.command_logs (
  id           bigint generated always as identity primary key,
  guild_id     text        not null,
  command_name text        not null,
  user_id      text,
  user_name    text,
  channel_id   text,
  channel_name text,
  -- success | failed | denied | cooldown | rate_limited | maintenance | disabled
  status       text        not null default 'success',
  -- Populated for status='failed' (handler threw) or a short denial reason.
  detail       text,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);

create index if not exists command_logs_guild_time
  on public.command_logs (guild_id, created_at desc);
create index if not exists command_logs_guild_cmd_time
  on public.command_logs (guild_id, command_name, created_at desc);
create index if not exists command_logs_guild_status_time
  on public.command_logs (guild_id, status, created_at desc);

alter table public.command_logs enable row level security;

create policy "Allow all access to command_logs"
  on public.command_logs
  for all
  using (true)
  with check (true);

-- Realtime: the dashboard subscribes to live inserts so the execution log and
-- analytics tiles update without polling.
alter publication supabase_realtime add table public.command_logs;

-- ============================================================
-- Analytics aggregations. A null p_since means "all time" (no lower bound).
-- "denied" buckets every non-success, non-failure outcome (cooldown,
-- rate_limited, maintenance, disabled, permission denied) — i.e. attempts
-- Pulse intentionally refused.
-- ============================================================

create or replace function public.get_command_stats(
  p_guild_id text,
  p_since    timestamptz
)
returns table (
  command_name text,
  total        bigint,
  success      bigint,
  failed       bigint,
  denied       bigint,
  last_used    timestamptz
)
language sql
stable
as $$
  select
    command_name,
    count(*)                                                            as total,
    count(*) filter (where status = 'success')                         as success,
    count(*) filter (where status = 'failed')                          as failed,
    count(*) filter (where status in
      ('denied','cooldown','rate_limited','maintenance','disabled'))    as denied,
    max(created_at)                                                     as last_used
  from public.command_logs
  where guild_id = p_guild_id
    and (p_since is null or created_at >= p_since)
  group by command_name
  order by total desc;
$$;

-- Time-bucketed usage for the trends chart.
create or replace function public.get_command_trends(
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
    date_trunc(p_trunc, created_at)             as bucket,
    count(*)                                    as total,
    count(*) filter (where status = 'success')  as success,
    count(*) filter (where status = 'failed')   as failed
  from public.command_logs
  where guild_id = p_guild_id
    and (p_since is null or created_at >= p_since)
  group by 1
  order by 1;
$$;

grant execute on function public.get_command_stats(text, timestamptz)        to anon, authenticated;
grant execute on function public.get_command_trends(text, timestamptz, text) to anon, authenticated;

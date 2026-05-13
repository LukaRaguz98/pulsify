-- ============================================================
-- Pulsify — initial database schema
-- Run this once in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/<your-project>/sql
-- ============================================================

-- Guild automation & feature settings
-- One row per Discord server. `settings` is a JSONB blob that stores
-- the three automation configs: welcome, auto_role, moderation_alerts.
create table if not exists public.guild_settings (
  guild_id    text        primary key,
  settings    jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Row-level security: only the service role (bot / server actions) can write.
-- The web app uses the service role via the server-side Supabase client.
alter table public.guild_settings enable row level security;

create policy "Service role full access to guild_settings"
  on public.guild_settings
  for all
  using (true)
  with check (true);

-- ---------------------------------------------------------------

-- Per-guild member warnings (created by the /warn slash command)
create table if not exists public.guild_warnings (
  id                  uuid        primary key default gen_random_uuid(),
  guild_id            text        not null,
  user_id             text        not null,
  username            text,
  moderator_id        text,
  moderator_username  text,
  reason              text,
  active              boolean     not null default true,
  created_at          timestamptz not null default now()
);

create index if not exists guild_warnings_guild_user
  on public.guild_warnings (guild_id, user_id);

alter table public.guild_warnings enable row level security;

create policy "Service role full access to guild_warnings"
  on public.guild_warnings
  for all
  using (true)
  with check (true);

-- ---------------------------------------------------------------

-- Synced guild metadata (written by the bot on join / /sync command)
create table if not exists public.synced_guilds (
  guild_id      text        primary key,
  name          text,
  icon          text,
  owner_id      text,
  member_count  integer,
  synced_at     timestamptz not null default now()
);

alter table public.synced_guilds enable row level security;

create policy "Service role full access to synced_guilds"
  on public.synced_guilds
  for all
  using (true)
  with check (true);

-- ============================================================
-- Pulsify — Private Channels Automation (PULSIFY-50)
--
-- A "join-to-create" system: when enabled, Pulse provisions a category and a
-- trigger voice channel (e.g. "Private Channel +"). When a member joins the
-- trigger, Pulse creates a private voice channel for them, moves them in, and
-- (optionally) posts an owner control panel. Empty private channels auto-delete.
--
-- Two tables, modelled on the Ticket System (20260527_tickets.sql):
--   • private_channel_configs — one row per guild: the feature toggle, the
--     created category/trigger IDs, and all admin-configurable behaviour. A
--     missing row means "Private Channels has never been configured" (off).
--   • private_channels         — one row per LIVE private channel: its owner,
--     Discord channel id, current name/limit/lock state, and an empty-since
--     stamp that drives the delayed auto-delete sweep.
--
-- Both the dashboard (config save + active-channel management via lib/discord.ts)
-- and the bot (pulse-bot/src/private-channels.js) read/write these tables and
-- subscribe to realtime, so each sees the other's work without a restart.
-- ============================================================

-- One row per guild. Created lazily the first time an admin saves Private
-- Channels settings; absence = the feature has never been configured (off).
create table if not exists public.private_channel_configs (
  guild_id               text        primary key,
  enabled                boolean     not null default false,
  -- Name Pulse gives the auto-created category + trigger voice channel. Pulse
  -- owns these by their stored IDs below; renaming here renames on next sweep.
  category_name          text        not null default 'Private Channels',
  trigger_name           text        not null default 'Private Channel +',
  -- Created-channel name template. Tokens: {username} {display}. e.g.
  -- "{username}'s Channel".
  name_format            text        not null default '{username}''s Channel',
  -- Reserved for future text support; only 'voice' is created today.
  channel_type           text        not null default 'voice',
  -- Discord voice user limit (0 = unlimited) applied to new private channels.
  user_limit             integer     not null default 0,
  -- New channels start locked (hidden from @everyone) when true.
  default_locked         boolean     not null default false,
  -- Auto-delete empty private channels, after this many seconds of being empty.
  auto_delete            boolean     not null default true,
  auto_delete_delay      integer     not null default 60,
  -- Roles allowed to use the trigger (empty = everyone) and roles ignored.
  allowed_role_ids       jsonb       not null default '[]'::jsonb,
  ignored_role_ids       jsonb       not null default '[]'::jsonb,
  -- Max simultaneously-open private channels one member may own. 0 = unlimited.
  per_user_limit         integer     not null default 1,
  -- Let channel owners self-manage via the in-channel control panel.
  allow_owner_management boolean     not null default true,
  -- IDs of the category + trigger channel Pulse created/owns. Nulled when the
  -- Discord side is deleted so the sweep recreates them.
  category_id            text,
  trigger_channel_id     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             text
);

alter table public.private_channel_configs enable row level security;

create policy "Allow all access to private_channel_configs"
  on public.private_channel_configs for all using (true) with check (true);

-- The bot keeps an in-memory config cache and refreshes it the moment an admin
-- saves settings (so enabling the feature provisions the category/trigger live).
alter publication supabase_realtime add table public.private_channel_configs;

-- ---------------------------------------------------------------
-- One row per LIVE private channel. Removed when the channel is deleted.
create table if not exists public.private_channels (
  id            uuid        primary key default gen_random_uuid(),
  guild_id      text        not null,
  -- The Discord voice channel. Unique so we never track the same channel twice.
  channel_id    text        not null unique,
  owner_id      text        not null,
  owner_name    text,
  name          text,
  channel_type  text        not null default 'voice',
  locked        boolean     not null default false,
  user_limit    integer     not null default 0,
  created_at    timestamptz not null default now(),
  -- Set when the channel becomes empty; cleared when re-occupied. The sweep
  -- deletes a channel once (now - empty_since) exceeds auto_delete_delay.
  empty_since   timestamptz
);

create index if not exists private_channels_guild_created
  on public.private_channels (guild_id, created_at desc);
create index if not exists private_channels_channel
  on public.private_channels (channel_id);
create index if not exists private_channels_guild_owner
  on public.private_channels (guild_id, owner_id);
-- The auto-delete sweep walks rows that have gone empty.
create index if not exists private_channels_empty
  on public.private_channels (empty_since)
  where empty_since is not null;

alter table public.private_channels enable row level security;

create policy "Allow all access to private_channels"
  on public.private_channels for all using (true) with check (true);

-- Realtime: the dashboard's active-channel list updates live as the bot creates
-- and deletes private channels, and the bot reacts to dashboard deletes/renames.
alter publication supabase_realtime add table public.private_channels;

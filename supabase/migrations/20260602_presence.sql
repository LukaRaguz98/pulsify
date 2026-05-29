-- ============================================================
-- Pulsify — Custom Bot Status & Presence Management (PULSIFY-30)
--
-- A Discord bot has exactly ONE global presence — it cannot show a different
-- status per server. So unlike per-server nickname/avatar (guild_bot_branding),
-- presence is modelled as: every server authors its OWN presence config, and a
-- single global pointer names which guild's config currently DRIVES the bot's
-- real Discord presence.
--
-- Two tables:
--   • guild_presence    — one row per guild: the status, the rotating activity
--     list, rotation interval, schedule windows and maintenance toggle that the
--     dashboard's Presence view edits.
--   • bot_presence_state — a single pointer row (id = 1) naming the guild whose
--     config is "active". null = fall back to the default "Powered by Pulsify".
--
-- The dashboard (app/dashboard/[guildId]/presence) writes both tables; the BOT
-- (pulse-bot/src/presence.js) keeps an in-memory copy fresh over realtime and,
-- on a rotation tick, resolves dynamic placeholders ({servers}, {members}, …)
-- and calls client.user.setPresence(). The status model + placeholder swap +
-- config normalisation live in code (lib/presence.ts, mirrored by presence.js)
-- so adding an activity kind or placeholder is never a migration.
-- ============================================================

create table if not exists public.guild_presence (
  guild_id        text        primary key,
  -- Whether this server's config is allowed to drive the bot when made active.
  enabled         boolean     not null default false,
  -- online | idle | dnd | invisible
  status          text        not null default 'online',
  -- Ordered rotation list. Each entry:
  --   { kind, text, emoji?, stream_url? }
  -- kind = playing | watching | listening | competing | streaming | custom
  -- `text` may contain dynamic placeholders ({servers}, {members}, {tickets},
  -- {giveaways}, {mod_actions}, {uptime}) resolved live by the bot.
  activities      jsonb       not null default '[]'::jsonb,
  -- When true the bot cycles through `activities` at the interval below; when
  -- false it just shows the first activity.
  rotation_enabled boolean    not null default true,
  rotation_interval_seconds integer not null default 30,
  -- Schedule windows that override the rotation while active (UTC):
  --   [{ days:[0-6], start:'HH:MM', end:'HH:MM', activity:{ kind, text, ... } }]
  schedules       jsonb       not null default '[]'::jsonb,
  -- Maintenance mode forces a dnd status + the maintenance message, ignoring
  -- the rotation, so admins can signal downtime in one toggle.
  maintenance_mode boolean    not null default false,
  maintenance_text text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

alter table public.guild_presence enable row level security;

create policy "Allow all access to guild_presence"
  on public.guild_presence for all using (true) with check (true);

-- The bot watches the active guild's row so a dashboard edit re-renders the
-- presence without a restart.
alter publication supabase_realtime add table public.guild_presence;

-- ---------------------------------------------------------------
-- Singleton pointer: which guild's config drives the bot right now. The id = 1
-- check keeps it a single row (upsert on id = 1). null active_guild_id ⇒ the
-- bot uses its default "Powered by Pulsify" presence.
create table if not exists public.bot_presence_state (
  id              integer     primary key default 1,
  active_guild_id text,
  updated_at      timestamptz not null default now(),
  updated_by      text,
  constraint bot_presence_state_singleton check (id = 1)
);

alter table public.bot_presence_state enable row level security;

create policy "Allow all access to bot_presence_state"
  on public.bot_presence_state for all using (true) with check (true);

-- Realtime: the bot flips its active config the instant a server claims (or
-- releases) the global presence from the dashboard.
alter publication supabase_realtime add table public.bot_presence_state;

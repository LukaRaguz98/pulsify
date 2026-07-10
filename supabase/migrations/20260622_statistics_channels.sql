-- ============================================================
-- Pulsify — Server Statistics Channels (PULSIFY-57)
--
-- Live "counter" channels whose NAME shows a server statistic (e.g.
-- "👥 Members: 1,240", "🚀 Boosts: 14"). Members read them straight from the
-- channel sidebar; Pulse keeps the names in sync automatically.
--
-- Two-writer pattern (like private_channels / temporary_roles):
--   • DASHBOARD owns the config: create / edit / duplicate / delete / reorder /
--     enable-disable rows via the API routes under
--     /api/discord/guild/[guildId]/statistics-channels. It never touches Discord.
--   • BOT (pulse-bot/src/statistics-channels.js) owns every Discord operation:
--     it provisions the channel (a locked voice channel or a category header),
--     renames it when the tracked value CHANGES, and deletes it when the row is
--     disabled/removed. A realtime subscription makes new rows appear promptly;
--     a 10-minute sweep keeps values fresh while respecting Discord's tight
--     channel-rename rate limit (≈2 renames / 10 min / channel — hence the
--     `last_value` change-detection so unchanged channels are never renamed).
-- ============================================================

create table if not exists public.statistics_channels (
    id uuid primary key default gen_random_uuid (),
    guild_id text not null,
    -- The provisioned Discord channel. Null until the bot creates it (or after it
    -- is disabled and the channel is torn down); the bot re-provisions on enable.
    channel_id text,
    -- voice   = locked voice channel (nobody can Connect; name shows in sidebar)
    -- category = category header acting as a labelled divider
    channel_type text not null default 'voice',
    -- Which statistic this channel tracks (see STAT_TYPES in
    -- pulsify-web-app/lib/statistics-channels.ts — keep the two in sync).
    stat_type text not null,
    -- Name template with a {value} placeholder (and a stat-specific alias token,
    -- e.g. {members}). Rendered by the bot to the channel name, max 100 chars.
    name_template text not null default '{value}',
    -- Optional parent category the provisioned channel is nested under.
    category_id text,
    -- Ordering within the dashboard list (and provisioning order).
    position integer not null default 0,
    enabled boolean not null default true,
    -- auto   = refreshed by the 10-minute sweep
    -- manual = only refreshed when an admin presses "Sync now"
    update_mode text not null default 'auto',
    -- The last rendered value string — change-detection so the bot only renames
    -- when the number actually moved (Discord rate-limits channel renames hard).
    last_value text,
    last_synced_at timestamptz,
    -- Last Discord error surfaced to the dashboard (rate limit, missing perms…).
    last_error text,
    -- Bumped by the dashboard's "Sync now" so the bot's realtime handler forces
    -- an immediate refresh (mirrors giveaways.draw_requested_at).
    sync_requested_at timestamptz,
    created_by text,
    created_by_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists statistics_channels_guild on public.statistics_channels (guild_id, position);

create index if not exists statistics_channels_guild_enabled on public.statistics_channels (guild_id, enabled);

alter table public.statistics_channels enable row level security;

create policy "Allow all access to statistics_channels" on public.statistics_channels for all using (true)
with
    check (true);

-- ---------------------------------------------------------------
-- Realtime: the dashboard's Statistics Channels tab updates live as the bot
-- provisions channels and writes back last_value / last_synced_at / last_error.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'statistics_channels'
  ) then
    execute 'alter publication supabase_realtime add table public.statistics_channels';
  end if;
end $$;

-- The bot tears down the provisioned Discord channel when a row is DELETED, and
-- needs guild_id + channel_id from the realtime `old` payload to do it. Postgres
-- only ships the primary key on delete unless the whole old row is replicated.
alter table public.statistics_channels replica identity full;

alter table public.statistics_channels
add column if not exists visibility text not null default 'everyone';
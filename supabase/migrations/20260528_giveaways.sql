-- ============================================================
-- Pulsify — Giveaways & Community Engagement (PULSIFY-24)
--
-- Two tables:
--   • giveaways         — one row per giveaway: prize/title/description, the
--     Discord channel + posted message, the schedule (starts_at / ends_at),
--     entry requirements, the blacklist, and the drawn winners.
--   • giveaway_entries  — one row per participant (a member who clicked Join).
--     A unique (giveaway_id, user_id) constraint makes joins idempotent.
--
-- Like the ticket system, BOTH sides write these tables:
--   • the BOT (pulse-bot/src/giveaways.js) owns the Discord-native flow — it
--     posts the giveaway message, handles the Join button, validates entry
--     requirements, and on a once-a-minute tick it auto-starts scheduled
--     giveaways and auto-draws winners when a giveaway ends.
--   • the DASHBOARD (app/dashboard/[guildId]/giveaways/actions.ts) creates,
--     edits, ends-early, rerolls, cancels and deletes giveaways by talking to
--     the Discord REST API directly (lib/discord.ts).
-- Both subscribe to realtime so each sees the other's work. The requirement /
-- winner-pick logic lives in code (lib/giveaways.ts, mirrored by giveaways.js)
-- so adding a requirement type or preset is never a migration.
-- ============================================================

create table if not exists public.giveaways (
  id              uuid        primary key default gen_random_uuid(),
  guild_id        text        not null,
  -- Headline + body shown in the giveaway embed.
  title           text        not null,
  description     text,
  -- What's being given away (free-text, e.g. "Discord Nitro (1 month)").
  prize           text        not null,
  -- Channel the giveaway is/was posted in, and the message id of the live
  -- embed (set once posted; lets us edit the entry count + announce winners).
  channel_id      text        not null,
  message_id      text,
  -- How many winners are drawn.
  winner_count    integer     not null default 1,
  -- scheduled | active | ended | cancelled
  status          text        not null default 'active',
  -- Entry gating evaluated by the bot when a member clicks Join:
  --   { required_role_ids: [], required_role_mode: 'any'|'all',
  --     min_account_age_days, min_server_age_days, min_messages, anti_alt }
  requirements    jsonb       not null default '{}'::jsonb,
  -- Member ids barred from entering (and from winning a reroll).
  blacklist_user_ids jsonb    not null default '[]'::jsonb,
  -- Schedule. starts_at null = start immediately on create. The bot flips a
  -- scheduled giveaway to active when starts_at passes, and ended when ends_at
  -- passes (drawing winners). Both are UTC.
  starts_at       timestamptz,
  ends_at         timestamptz not null,
  -- Drawn winners (ordered): [{ id, name }]. Empty until the draw.
  winners         jsonb       not null default '[]'::jsonb,
  -- Denormalised entry count, bumped on each join so the embed + list can show
  -- it without counting rows every time. giveaway_entries is the source of truth.
  entry_count     integer     not null default 0,
  -- Who created/hosts the giveaway (a moderator).
  host_id         text,
  host_name       text,
  -- Set by the dashboard's "Draw now" / "Reroll" so the bot (which watches this
  -- column over realtime) can act immediately instead of waiting for the tick.
  draw_requested_at timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      text
);

create index if not exists giveaways_guild_created
  on public.giveaways (guild_id, created_at desc);
create index if not exists giveaways_guild_status
  on public.giveaways (guild_id, status, created_at desc);
-- The bot's tick scans giveaways that still need a lifecycle transition.
create index if not exists giveaways_pending
  on public.giveaways (ends_at)
  where status in ('scheduled', 'active');

alter table public.giveaways enable row level security;

create policy "Allow all access to giveaways"
  on public.giveaways for all using (true) with check (true);

-- The bot keeps an in-memory cache of scheduled + active giveaways and refreshes
-- it the moment the dashboard creates/edits one, so the Join button works and
-- the schedule fires without a restart.
alter publication supabase_realtime add table public.giveaways;

-- ---------------------------------------------------------------
-- One row per participant. Unique on (giveaway_id, user_id) so a double-click
-- is a no-op rather than a duplicate entry.
create table if not exists public.giveaway_entries (
  id           bigint generated always as identity primary key,
  giveaway_id  uuid        not null,
  guild_id     text        not null,
  user_id      text        not null,
  user_name    text,
  -- Snapshot of how the member satisfied entry — purely informational.
  entered_at   timestamptz not null default now(),
  -- Flipped true when the member is drawn as a winner (survives rerolls so the
  -- export shows everyone who ever won this giveaway).
  is_winner    boolean     not null default false,
  unique (giveaway_id, user_id)
);

create index if not exists giveaway_entries_giveaway
  on public.giveaway_entries (giveaway_id, entered_at);
create index if not exists giveaway_entries_guild
  on public.giveaway_entries (guild_id, entered_at desc);

alter table public.giveaway_entries enable row level security;

create policy "Allow all access to giveaway_entries"
  on public.giveaway_entries for all using (true) with check (true);

-- Realtime: the dashboard's entrant list + count update live as members join.
alter publication supabase_realtime add table public.giveaway_entries;

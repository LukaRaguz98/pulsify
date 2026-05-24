-- ============================================================
-- Pulsify — Discord Ticket System & Support Center (PULSIFY-22)
--
-- Three tables:
--   • ticket_configs  — one row per guild: the panel definition, the ticket
--     TYPE catalog, support roles, transcript/log channels, auto-close + limit
--     behaviour. Like command_configs, a missing row means "tickets are off".
--   • tickets         — one row per opened ticket (its Discord channel, opener,
--     status, priority, assignee, form answers, transcript).
--   • ticket_events   — append-only timeline that doubles as the per-ticket
--     audit log AND the internal staff-notes store (type = 'note').
--
-- The catalog of ticket TYPES, statuses and priorities lives in the row JSON
-- (ticket_configs.ticket_types) + in code (lib/tickets.ts on the web side,
-- mirrored by pulse-bot/src/tickets.js). Adding a new ticket type is data, not
-- a migration. Both the dashboard (via lib/discord.ts) and the bot write to
-- these tables, and both subscribe to realtime so each sees the other's work.
-- ============================================================

-- One row per guild. Created lazily the first time an admin saves ticket
-- settings; absence = the feature has never been configured (treated as off).
create table if not exists public.ticket_configs (
  guild_id              text        primary key,
  enabled               boolean     not null default false,
  -- The ticket panel posted into a channel. Both the dashboard and bot can post
  -- it; the buttons/select carry custom_ids the bot recognises. Stored so the
  -- dashboard can preview + re-post it.
  -- { channel_id, message_id, title, description, color, mode, button_label }
  panel                 jsonb       not null default '{}'::jsonb,
  -- Ordered ticket TYPE catalog. Each entry:
  --   { id, label, emoji, description, color, enabled,
  --     category_id (override), support_role_ids (override),
  --     form: [{ id, label, style: 'short'|'paragraph', required, placeholder, max_length }] }
  ticket_types          jsonb       not null default '[]'::jsonb,
  -- Default Discord CATEGORY new ticket channels are created under.
  category_id           text,
  -- Roles granted access to EVERY ticket (support staff baseline).
  support_role_ids      jsonb       not null default '[]'::jsonb,
  -- Channel transcripts are posted to on close.
  transcript_channel_id text,
  -- Channel ticket lifecycle events are mirrored to (open/claim/close/…).
  log_channel_id        text,
  -- Channel-name template. Tokens: {number} {user} {type}. e.g. "ticket-{number}".
  naming_format         text        not null default 'ticket-{number}',
  -- Message posted inside a freshly-created ticket channel. {user} {type} tokens.
  opening_message       text,
  -- Auto-close behaviour: { enabled, inactivity_hours, warn_hours }.
  auto_close            jsonb       not null default '{}'::jsonb,
  -- Max simultaneously-open tickets one user may hold. 0 = unlimited.
  per_user_limit        integer     not null default 1,
  -- Ping the support roles in-channel when a ticket opens.
  ping_support          boolean     not null default true,
  -- Monotonic per-guild counter feeding the {number} token. Bumped on each open.
  ticket_counter        integer     not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            text
);

alter table public.ticket_configs enable row level security;

create policy "Allow all access to ticket_configs"
  on public.ticket_configs for all using (true) with check (true);

-- The bot keeps an in-memory config cache and refreshes it the moment an admin
-- saves settings (so a new panel / type is live without a restart).
alter publication supabase_realtime add table public.ticket_configs;

-- ---------------------------------------------------------------
-- One row per opened ticket.
create table if not exists public.tickets (
  id                   uuid        primary key default gen_random_uuid(),
  guild_id             text        not null,
  -- Per-guild sequential number (snapshot of ticket_configs.ticket_counter at
  -- open time). Drives the {number} token and the human-facing "#42" label.
  number               integer     not null,
  -- The private Discord channel. Nulled if the channel is later deleted but the
  -- ticket record (and its transcript) is kept for history.
  channel_id           text,
  type_id              text,
  type_label           text,
  subject              text,
  -- open | claimed | closed
  status               text        not null default 'open',
  -- low | normal | high | urgent
  priority             text        not null default 'normal',
  opener_id            text        not null,
  opener_name          text,
  claimed_by           text,
  claimed_by_name      text,
  -- Extra users explicitly added to the channel (beyond opener + support).
  participants         jsonb       not null default '[]'::jsonb,
  -- Answers to the type's form: [{ label, value }].
  form_answers         jsonb       not null default '[]'::jsonb,
  opened_at            timestamptz not null default now(),
  -- Last message / action in the ticket — drives inactivity auto-close.
  last_activity_at     timestamptz not null default now(),
  -- Set when an inactivity warning has been posted, so we don't repeat it.
  inactivity_warned_at timestamptz,
  closed_at            timestamptz,
  closed_by            text,
  closed_by_name       text,
  close_reason         text,
  -- Plain-text transcript captured at close (channel message history).
  transcript           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists tickets_guild_created
  on public.tickets (guild_id, created_at desc);
create index if not exists tickets_guild_status
  on public.tickets (guild_id, status, created_at desc);
-- Fast lookup from a Discord channel back to its ticket (bot interaction path).
create index if not exists tickets_channel
  on public.tickets (channel_id);
-- The auto-close scanner walks open tickets by their last activity.
create index if not exists tickets_open_activity
  on public.tickets (last_activity_at)
  where status <> 'closed';

alter table public.tickets enable row level security;

create policy "Allow all access to tickets"
  on public.tickets for all using (true) with check (true);

-- Realtime: the dashboard list updates live as the bot opens/claims/closes
-- tickets, and the bot picks up dashboard-side changes (priority, assignment).
alter publication supabase_realtime add table public.tickets;

-- ---------------------------------------------------------------
-- Append-only per-ticket timeline. Powers the activity timeline in the ticket
-- detail view, the audit log, AND internal staff notes (type = 'note').
create table if not exists public.ticket_events (
  id          bigint generated always as identity primary key,
  -- Soft reference: events are retained even if the ticket row is later deleted,
  -- so an audit trail survives. (No FK so deletes never cascade away history.)
  ticket_id   uuid        not null,
  guild_id    text        not null,
  -- opened | claimed | unclaimed | assigned | closed | reopened | renamed |
  -- user_added | user_removed | priority_changed | note | deleted | panel_posted
  type        text        not null,
  actor_id    text,
  actor_name  text,
  -- Human-readable detail, note body, or reason.
  detail      text,
  metadata    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ticket_events_ticket_time
  on public.ticket_events (ticket_id, created_at);
create index if not exists ticket_events_guild_time
  on public.ticket_events (guild_id, created_at desc);

alter table public.ticket_events enable row level security;

create policy "Allow all access to ticket_events"
  on public.ticket_events for all using (true) with check (true);

-- Realtime: the open ticket detail view streams new timeline entries (notes,
-- status changes) without a refresh.
alter publication supabase_realtime add table public.ticket_events;

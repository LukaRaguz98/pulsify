-- ============================================================
-- Pulsify — Applications System (PULSIFY-43)
--
-- Upgrades the ticket "Application" flow: instead of spinning up a private
-- Discord channel for every applicant (the old behaviour, shared with support
-- tickets), an application is now a CHANNEL-LESS submission stored here and
-- reviewed inside Pulsify under Tickets → Applications.
--
-- Two new tables (mirroring the tickets ↔ ticket_events pairing):
--   • ticket_applications — one row per submission (applicant, type, message,
--     status, reviewer, decision). No Discord channel.
--   • application_events   — append-only review history that doubles as the
--     audit log AND internal staff notes (type = 'note').
--
-- Plus additive columns on ticket_configs: the editable application TYPE
-- catalog, the optional admin notification channel, the applicant-DM toggle, a
-- per-user submission cooldown, and a monotonic per-guild application counter.
--
-- The application TYPE catalog, statuses and custom_id scheme live in code
-- (lib/applications.ts on the web side, mirrored by pulse-bot/src/applications.js
-- + the interaction wiring in pulse-bot/src/tickets.js). Adding a type is data,
-- not a migration. Both the dashboard and the bot write these tables and both
-- subscribe to realtime so each sees the other's work (the bot watches status
-- transitions to DM the applicant).
-- ============================================================

-- ── ticket_configs: additive application columns ─────────────────────────────
-- Defaults chosen so existing rows keep working unchanged (applications stay
-- off until an admin flags the application ticket type + configures these).
alter table public.ticket_configs
  -- Editable application TYPE catalog: [{ id, label, emoji, description, enabled }].
  -- Empty falls back to the code defaults (lib/applications DEFAULT_APPLICATION_TYPES).
  add column if not exists application_types     jsonb   not null default '[]'::jsonb,
  -- Optional channel the bot posts a "new application" admin embed into.
  add column if not exists application_channel_id text,
  -- DM the applicant on receipt + on every status change (with channel fallback off).
  add column if not exists application_dm         boolean not null default true,
  -- Minutes a member must wait between submissions (anti-spam). 0 = no cooldown.
  add column if not exists application_cooldown   integer not null default 0,
  -- Monotonic per-guild counter feeding the human "#42" application label.
  add column if not exists application_counter    integer not null default 0;

-- ── ticket_applications ──────────────────────────────────────────────────────
-- One row per submitted application. No channel_id: applications never create a
-- Discord channel. Kept for history even after a decision is made.
create table if not exists public.ticket_applications (
  id              uuid        primary key default gen_random_uuid(),
  guild_id        text        not null,
  -- Per-guild sequential number (snapshot of ticket_configs.application_counter).
  number          integer     not null,
  -- The application TYPE the member picked. type_id = 'other' carries a free-text
  -- custom_type the applicant typed in.
  type_id         text,
  type_label      text,
  custom_type     text,
  -- The applicant. avatar = Discord avatar hash (rendered to a CDN URL in the UI).
  applicant_id    text        not null,
  applicant_name  text,
  applicant_avatar text,
  -- The application details (the "why / message" field).
  message         text,
  -- Future-proofing for multi-field application forms: [{ label, value }].
  answers         jsonb       not null default '[]'::jsonb,
  -- pending | approved | rejected | needs_info
  status          text        not null default 'pending',
  -- The staff member assigned to review (may differ from who decides).
  reviewer_id     text,
  reviewer_name   text,
  -- Decision metadata. decision_note is the PUBLIC note shown to the applicant.
  decided_at      timestamptz,
  decided_by      text,
  decided_by_name text,
  decision_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ticket_applications_guild_created
  on public.ticket_applications (guild_id, created_at desc);
create index if not exists ticket_applications_guild_status
  on public.ticket_applications (guild_id, status, created_at desc);
-- The bot's anti-spam guard looks up recent submissions by applicant.
create index if not exists ticket_applications_applicant
  on public.ticket_applications (guild_id, applicant_id, created_at desc);

alter table public.ticket_applications enable row level security;

create policy "Allow all access to ticket_applications"
  on public.ticket_applications for all using (true) with check (true);

-- Realtime: the dashboard list updates live as members submit, and the bot
-- watches status transitions (written from the dashboard) to DM the applicant.
alter publication supabase_realtime add table public.ticket_applications;

-- ── application_events ───────────────────────────────────────────────────────
-- Append-only review history. Powers the timeline in the application detail
-- drawer, the audit log, AND internal staff notes (type = 'note').
create table if not exists public.application_events (
  id             bigint generated always as identity primary key,
  -- Soft reference (no FK) so history survives if the application is deleted.
  application_id uuid        not null,
  guild_id       text        not null,
  -- submitted | status_changed | note | assigned | reviewer_cleared | info_requested
  type           text        not null,
  actor_id       text,
  actor_name     text,
  -- Human-readable detail, note body, decision note, or status transition.
  detail         text,
  metadata       jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists application_events_app_time
  on public.application_events (application_id, created_at);
create index if not exists application_events_guild_time
  on public.application_events (guild_id, created_at desc);

alter table public.application_events enable row level security;

create policy "Allow all access to application_events"
  on public.application_events for all using (true) with check (true);

-- Realtime: the open application detail view streams new timeline entries.
alter publication supabase_realtime add table public.application_events;

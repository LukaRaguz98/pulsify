-- ============================================================
-- Pulsify — Announcements (PULSIFY-33)
--
-- One table: `announcements` — one row per announcement an admin authors in the
-- dashboard. Unlike Giveaways/Tickets this is a DASHBOARD-ONLY surface: the bot
-- never writes here. The dashboard (app/dashboard/[guildId]/announcements/
-- actions.ts) creates drafts and publishes them to Discord by posting a Pulse
-- Components-V2 embed through the Discord REST API directly (lib/discord.ts),
-- matching the /changelog embed styling.
--
-- Lifecycle (status):
--   • draft     — authored, not yet posted. May carry an optional `scheduled_for`
--                 planned publish time (informational — published manually for
--                 now; an auto-publish tick is a future addition).
--   • published — posted to Discord; `message_id` + `published_at` are set.
--   • failed    — a publish attempt failed; `error` holds the reason. Retryable.
-- ============================================================

create table if not exists public.announcements (
  id            uuid        primary key default gen_random_uuid(),
  guild_id      text        not null,
  -- Headline + body shown in the announcement embed.
  title         text        not null,
  content       text        not null,
  -- Target channel and, once posted, the id of the published message (so we can
  -- delete it again if the announcement is removed).
  channel_id    text        not null,
  message_id    text,
  -- draft | published | failed
  status        text        not null default 'draft',
  -- Optional planned publish time. Stored on drafts so the UI can surface a
  -- "Scheduled for …" state; publishing is manual for now.
  scheduled_for timestamptz,
  published_at  timestamptz,
  -- Last publish error (set when status flips to 'failed'); cleared on success.
  error         text,
  -- The admin who authored the announcement (Discord identity, for the list +
  -- audit trail). created_by mirrors host bookkeeping in the other tables.
  author_id     text,
  author_name   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    text
);

create index if not exists announcements_guild_created
  on public.announcements (guild_id, created_at desc);
create index if not exists announcements_guild_status
  on public.announcements (guild_id, status, created_at desc);

alter table public.announcements enable row level security;

create policy "Allow all access to announcements"
  on public.announcements for all using (true) with check (true);

-- Realtime so the dashboard list reflects creates/edits/publishes live across
-- open sessions, same as the Giveaways view.
alter publication supabase_realtime add table public.announcements;

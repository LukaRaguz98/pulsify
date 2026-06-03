-- ============================================================
-- Pulsify — Integrations Hub (PULSIFY-34)
--
-- Two tables back the Integrations Hub:
--
--   • integrations      — one row per integration an admin connects in the
--                         dashboard (a GitHub repo, a YouTube channel, an RSS
--                         feed, a Notion workspace, …). A guild can connect the
--                         same provider more than once (two repos, three feeds),
--                         so the row is keyed by id, not (guild, provider).
--   • integration_logs  — append-only diagnostic trail per integration: connects,
--                         disconnects, test runs, sync results and errors. Powers
--                         the "Logs & diagnostics" panel and health indicators.
--
-- Like Announcements, this is a DASHBOARD-ONLY surface for now: the dashboard
-- owns connect/disconnect/test and posts notifications to Discord directly via
-- the REST API (lib/discord.ts). The bot never writes here. A future polling
-- worker can read `integrations` to fan external events into Discord channels;
-- the schema (last_sync_at, last_error, cursor) is shaped for that.
--
-- Lifecycle (status):
--   • connected    — configured and healthy; notifications/sync are armed.
--   • disconnected — connected previously, paused/removed credentials. Kept so
--                    the admin can reconnect without re-entering config.
--   • error        — last connection/test/sync failed; `last_error` holds why.
-- The separate `enabled` flag pauses notifications WITHOUT tearing down the
-- connection (status stays `connected`), so "turn it off for now" and "this is
-- broken" are distinct states.
-- ============================================================

create table if not exists public.integrations (
  id            uuid        primary key default gen_random_uuid(),
  guild_id      text        not null,
  -- Provider key from lib/integrations.ts PROVIDERS (e.g. 'github', 'youtube',
  -- 'rss', 'notion'). Not constrained to an enum here so new providers can ship
  -- without a migration; the dashboard validates against the catalog.
  provider      text        not null,
  -- Human label for this connection ("Pulsify/pulse-bot", "r/discordapp", …).
  -- Defaults to the provider name when the wizard doesn't collect one.
  label         text        not null,
  -- The external resource this row points at: a repo path, channel handle, feed
  -- URL, board id, etc. Used for de-duping and display. Provider-specific shape
  -- lives in `config`.
  external_ref  text,
  -- connected | disconnected | error
  status        text        not null default 'connected',
  -- Provider-specific connection config + (placeholder) credentials, plus any
  -- per-event sync toggles. Free-form JSON validated by the dashboard.
  config        jsonb       not null default '{}'::jsonb,
  -- Discord channel notifications/sync updates are posted to.
  channel_id    text,
  -- Notification message template (supports {{placeholders}} from the catalog).
  -- Null ⇒ use the provider's default template.
  template      text,
  -- Pauses notifications without disconnecting. status stays 'connected'.
  enabled       boolean     not null default true,
  -- Opaque per-provider cursor for the future polling worker (last seen id /
  -- etag / timestamp) so it only forwards new events.
  cursor        text,
  -- Last successful sync / test, and the last error (cleared on success).
  last_sync_at  timestamptz,
  last_error    text,
  -- The admin who connected it (Discord identity, for the list + audit trail).
  author_id     text,
  author_name   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    text
);

create index if not exists integrations_guild_created
  on public.integrations (guild_id, created_at desc);
create index if not exists integrations_guild_provider
  on public.integrations (guild_id, provider);
create index if not exists integrations_guild_status
  on public.integrations (guild_id, status);

create table if not exists public.integration_logs (
  id             uuid        primary key default gen_random_uuid(),
  guild_id       text        not null,
  -- The integration this entry belongs to. Cascade so removing a connection
  -- clears its trail.
  integration_id uuid        not null references public.integrations (id) on delete cascade,
  -- info | success | warning | error
  level          text        not null default 'info',
  -- Short machine-ish event key ('connected', 'test', 'sync', 'disconnected',
  -- 'notification_sent', 'error') for filtering, plus a human message.
  event          text        not null,
  message        text,
  metadata       jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists integration_logs_integration_created
  on public.integration_logs (integration_id, created_at desc);
create index if not exists integration_logs_guild_created
  on public.integration_logs (guild_id, created_at desc);

alter table public.integrations     enable row level security;
alter table public.integration_logs enable row level security;

create policy "Allow all access to integrations"
  on public.integrations for all using (true) with check (true);
create policy "Allow all access to integration_logs"
  on public.integration_logs for all using (true) with check (true);

-- Realtime so the dashboard list + logs reflect connects/edits/tests live across
-- open sessions, same as the Announcements and Giveaways views.
alter publication supabase_realtime add table public.integrations;
alter publication supabase_realtime add table public.integration_logs;

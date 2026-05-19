-- ============================================================
-- Pulsify — AI-powered moderation
-- One settings row per guild (sensitivity, detector toggles, auto-action
-- thresholds, whitelists) and a per-event audit log that doubles as the
-- review queue. Every analysis run from the dashboard is recorded; rows
-- start in `pending` and transition to `auto_actioned`, `resolved`, or
-- `dismissed` as the AI / moderators handle them.
-- ============================================================

-- Settings: a single row per guild. `settings` is a free-form JSONB blob so
-- new detector categories and tunables can be added without a schema change.
create table if not exists public.ai_moderation_settings (
  guild_id    text        primary key,
  enabled     boolean     not null default false,
  sensitivity text        not null default 'medium', -- low | medium | aggressive
  settings    jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.ai_moderation_settings enable row level security;

create policy "Service role full access to ai_moderation_settings"
  on public.ai_moderation_settings
  for all
  using (true)
  with check (true);

-- ---------------------------------------------------------------
-- Detection events. Each row is one flagged message + the AI verdict,
-- the auto-action (if any) and its review state. Doubles as the review
-- queue (`status = 'pending'`) and the history log (any other status).
create table if not exists public.ai_moderation_events (
  id              uuid        primary key default gen_random_uuid(),
  guild_id        text        not null,
  -- Source message context. message_id / channel_id are nullable so the
  -- dashboard can record "test analysis" rows that aren't tied to a real
  -- Discord message.
  message_id      text,
  channel_id      text,
  channel_name    text,
  author_id       text,
  author_name     text,
  author_username text,
  content         text        not null,
  -- AI verdict.
  categories      jsonb       not null default '[]'::jsonb, -- [{ id, label, score }]
  -- Top category label — denormalised for filtering / display so we don't
  -- have to crack open the JSON on every row.
  top_category    text,
  -- 0.0–1.0 confidence the AI is in the top_category being a violation.
  confidence      numeric(3,2) not null default 0,
  severity        text        not null default 'low', -- low | medium | high
  reasoning       text,
  -- Lifecycle.
  status          text        not null default 'pending', -- pending | auto_actioned | resolved | dismissed
  action_taken    text        not null default 'none',    -- none | flag | delete | warn | timeout
  action_meta     jsonb       not null default '{}'::jsonb,
  reviewer_id     text,
  reviewer_name   text,
  reviewed_at     timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists ai_moderation_events_guild_time
  on public.ai_moderation_events (guild_id, created_at desc);

create index if not exists ai_moderation_events_guild_status
  on public.ai_moderation_events (guild_id, status, created_at desc);

create index if not exists ai_moderation_events_guild_category
  on public.ai_moderation_events (guild_id, top_category, created_at desc);

alter table public.ai_moderation_events enable row level security;

create policy "Allow all access to ai_moderation_events"
  on public.ai_moderation_events
  for all
  using (true)
  with check (true);

-- ---------------------------------------------------------------
-- Daily per-guild analysis cap. Mirrors `ai_generations`: callers
-- (server actions / API routes) count how many rows landed in the last
-- 24h before invoking the AI provider.
create index if not exists ai_moderation_events_guild_created
  on public.ai_moderation_events (guild_id, created_at desc);

-- ---------------------------------------------------------------
-- Realtime: the dashboard subscribes to live inserts so review queues
-- and analytics tiles update without polling.
alter publication supabase_realtime add table public.ai_moderation_events;

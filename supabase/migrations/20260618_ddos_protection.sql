-- ============================================================
-- Pulsify — DDoS Protection & Security Monitoring (PULSIFY-52)
--
-- Three tables, modelled on the Polls / Private Channels systems (both sides
-- write them and subscribe to realtime):
--   • security_configs     — one row per guild: the master toggle, the alert
--     channel, the protection rules (per-pattern thresholds + automatic
--     mitigations), the auto-lockdown trigger, and the live lockdown state.
--   • security_events      — one row per DETECTED abuse event: which pattern
--     tripped, the affected module, the severity, the offending member (for
--     per-user patterns), the measured count vs the threshold/window, and the
--     investigation status.
--   • security_mitigations — one row per mitigation ACTION taken (auto or
--     manual): the action, its target (module / user / server), why, when it
--     started, when it expires / ended, and who lifted it (recovery).
--
-- Both sides write these tables:
--   • the BOT (pulse-bot/src/security.js) owns runtime — it samples activity,
--     runs the detection engine against each guild's rules, records events,
--     applies the configured mitigations, raises alerts, enforces the active
--     mitigations (lockdown / blocked users / paused modules) and expires
--     temporary mitigations (recovery).
--   • the DASHBOARD (app/dashboard/[guildId]/(management)/security) configures
--     the rules, monitors live, and lets admins trigger / clear mitigations.
-- The detection engine, rule shape, mitigation catalogue and severity model live
-- in code (lib/security.ts, mirrored by security.js) so adding a pattern,
-- mitigation or rule field is never a migration.
-- ============================================================

create table if not exists public.security_configs (
  guild_id          text        primary key,
  -- Master switch for the whole module.
  enabled           boolean     not null default false,
  -- Discord channel that receives security alerts (null = dashboard-only).
  alert_channel_id  text,
  -- Per-pattern protection rules:
  --   { <pattern>: { enabled, threshold, window_seconds, severity,
  --                  actions: [..], mitigation_seconds } }
  rules             jsonb       not null default '{}'::jsonb,
  -- Auto-lockdown trigger: { enabled, event_threshold, window_seconds, min_severity }.
  auto_lockdown     jsonb       not null default '{}'::jsonb,
  -- Live lockdown state (set by auto-lockdown or a manual lockdown mitigation).
  lockdown_active   boolean     not null default false,
  lockdown_reason   text,
  lockdown_since    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        text
);

alter table public.security_configs enable row level security;

create policy "Allow all access to security_configs"
  on public.security_configs for all using (true) with check (true);

-- The bot caches every guild's config and refreshes it the moment the dashboard
-- saves, so rule changes + manual lockdowns take effect without a restart.
alter publication supabase_realtime add table public.security_configs;

-- ---------------------------------------------------------------
-- One row per detected abuse event.
create table if not exists public.security_events (
  id              uuid        primary key default gen_random_uuid(),
  guild_id        text        not null,
  -- request_spike | command_abuse | failed_actions | ticket_spam | giveaway_spam
  -- | application_spam | api_abuse | member_join_burst | automated_spam
  pattern         text        not null,
  -- The Pulsify surface affected (commands | tickets | giveaways | ...).
  module          text        not null,
  -- low | medium | high | critical
  severity        text        not null default 'medium',
  -- open | mitigated | resolved
  status          text        not null default 'open',
  -- The offending member, for per-user patterns (null for global patterns).
  actor_id        text,
  actor_name      text,
  -- The measured count and the rule it breached.
  count           integer     not null default 0,
  threshold       integer     not null default 0,
  window_seconds  integer     not null default 0,
  -- auto (detection engine) | manual (admin-raised)
  source          text        not null default 'auto',
  details         jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index if not exists security_events_guild_created
  on public.security_events (guild_id, created_at desc);
create index if not exists security_events_guild_status
  on public.security_events (guild_id, status, created_at desc);
create index if not exists security_events_guild_actor
  on public.security_events (guild_id, actor_id);

alter table public.security_events enable row level security;

create policy "Allow all access to security_events"
  on public.security_events for all using (true) with check (true);

-- Realtime: the dashboard's live monitoring view updates as detections land.
alter publication supabase_realtime add table public.security_events;

-- ---------------------------------------------------------------
-- One row per mitigation action (auto-applied by a rule, or manual).
create table if not exists public.security_mitigations (
  id               uuid        primary key default gen_random_uuid(),
  guild_id         text        not null,
  -- notify | increase_cooldown | restrict_commands | pause_module | block_user
  -- | pause_submissions | lockdown
  action           text        not null,
  -- The module a module-scoped action targets (null for user/server actions).
  module           text,
  -- The member a user-scoped action targets (null otherwise).
  target_user_id   text,
  target_user_name text,
  reason           text,
  -- rule (auto from a tripped rule) | manual (admin) | lockdown
  source           text        not null default 'rule',
  -- The pattern / event that caused this mitigation, when applicable.
  pattern          text,
  event_id         uuid,
  -- Whether the mitigation is currently in force. The bot reads active rows to
  -- enforce; the expiry sweep + manual "lift" set this false (recovery).
  active           boolean     not null default true,
  started_at       timestamptz not null default now(),
  -- When a temporary mitigation auto-expires (null = until lifted by hand).
  expires_at       timestamptz,
  ended_at         timestamptz,
  ended_by         text
);

create index if not exists security_mitigations_guild_active
  on public.security_mitigations (guild_id, active, started_at desc);
create index if not exists security_mitigations_guild_created
  on public.security_mitigations (guild_id, started_at desc);
-- The bot's recovery sweep scans active mitigations whose expiry has passed.
create index if not exists security_mitigations_expiry
  on public.security_mitigations (expires_at)
  where active;

alter table public.security_mitigations enable row level security;

create policy "Allow all access to security_mitigations"
  on public.security_mitigations for all using (true) with check (true);

alter publication supabase_realtime add table public.security_mitigations;

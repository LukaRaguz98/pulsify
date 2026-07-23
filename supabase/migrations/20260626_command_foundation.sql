-- ============================================================
-- Pulsify — Slash Command Foundation (PULSIFY-61)
--
-- Groundwork for the slash-command expansion: one synchronized catalog and a
-- record of where a write actually came from.
--
-- ── Why a catalog table ──────────────────────────────────────────────────────
-- Until now the catalog lived in code TWICE — `pulsify-web-app/lib/commands.ts`
-- (drives the Command Center UI) and `pulse-bot/src/commands.js` (drives
-- registration + execution) — mirrored by hand. They drifted: the web catalog
-- was missing /invites, /invite-leaderboard, /invite-rewards, /daily and
-- /weekly, so the Command Center couldn't configure commands the bot was
-- happily serving. Hand-mirroring does not survive the ~80 commands PULSIFY-61
-- adds.
--
-- So the BOT becomes the single source of truth. It owns the definitions
-- (it's the thing that actually registers and runs them) and upserts them into
-- `command_catalog` on startup. The dashboard reads that table. A command the
-- bot doesn't have cannot appear in the Command Center, which is exactly the
-- invariant we want.
--
-- This table is GUILD-AGNOSTIC — it's "what Pulse offers", not "what this
-- server chose". Per-server overrides stay in `command_configs` (20260521),
-- which continues to treat a missing row as "use these defaults". The two join
-- on `command_name`.
--
-- ── Why a source column ──────────────────────────────────────────────────────
-- Once a moderator can /ban from Discord, "who did this and from where" needs
-- an answer. `moderation_logs.source` distinguishes a dashboard action from a
-- slash command so Moderation History and Management Analytics can attribute
-- and filter. Existing rows predate Discord commands and are all dashboard
-- actions, hence the default + backfill.
-- ============================================================

-- ── Catalog ──────────────────────────────────────────────────────────────────

create table if not exists public.command_catalog (
  -- Slash name, lowercase, no leading slash — joins to command_configs.
  command_name        text        primary key,
  description         text        not null,
  -- utility | information | insights | moderation
  category            text        not null default 'utility',
  -- The Pulsify feature this command belongs to, matching FEATURE_KEYS in
  -- lib/templates.ts (automations, onboarding, moderation_alerts, pulse_guard,
  -- ddos_protection, tickets, private_channels, leveling, economy). NULL means
  -- the command is always available and isn't tied to a toggleable module —
  -- /help, /serverinfo and friends. This is what lets a command respect the
  -- dashboard's feature enable/disable switches.
  module              text,
  -- Baseline access tier BEFORE per-guild overrides:
  -- everyone | support | moderator | admin
  default_permission  text        not null default 'everyone',
  -- Whether the reply is invoker-only out of the box. Per-guild overrides live
  -- in command_configs.ephemeral (20260522).
  default_ephemeral   boolean     not null default true,
  -- Minimum plan from lib/billing.ts (free | pro | business | enterprise).
  -- 'free' means ungated. Enforced against the GUILD OWNER's subscription —
  -- see pulse-bot/src/feature-gate.js for why the owner and not the invoker.
  min_plan            text        not null default 'free',
  -- Option descriptors for the dashboard preview, mirroring the registered
  -- slash options: [{ name, description, type, required }].
  options             jsonb       not null default '[]'::jsonb,
  -- Example invocations shown in the preview + copyable as quick tests.
  examples            text[]      not null default '{}',
  -- Longer help text for the command preview panel.
  detail              text        not null default '',
  -- Bumped on every sync. The prune step below deletes rows the running bot
  -- no longer defines, so a removed command disappears from the dashboard.
  synced_at           timestamptz not null default now()
);

create index if not exists command_catalog_category
  on public.command_catalog (category);

create index if not exists command_catalog_module
  on public.command_catalog (module);

alter table public.command_catalog enable row level security;

-- Read-only to the dashboard's anon role in practice; only the bot writes (it
-- syncs on startup). Matching the permissive style of command_configs — the app
-- layer owns authorization, not RLS.
drop policy if exists "Allow all access to command_catalog" on public.command_catalog;
create policy "Allow all access to command_catalog"
  on public.command_catalog
  for all
  using (true)
  with check (true);

-- The dashboard subscribes so the Command Center reflects a bot deploy that
-- adds or removes commands without an admin having to reload. Guarded so a
-- re-run doesn't error on an already-published table (house style — see
-- 20260623_birthdays / 20260625_invite_tracking).
do $$
declare t text;
begin
  foreach t in array array['command_catalog']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── Moderation source attribution ────────────────────────────────────────────

-- 'dashboard' | 'Discord Command' | 'automation'. Defaulting to 'dashboard'
-- backfills every existing row correctly: before PULSIFY-61 the dashboard was
-- the only way to perform a moderation action.
alter table public.moderation_logs
  add column if not exists source text not null default 'dashboard';

-- Moderation History filters by source ("show me everything done from Discord"),
-- always within a guild and newest-first.
create index if not exists moderation_logs_guild_source_time
  on public.moderation_logs (guild_id, source, created_at desc);

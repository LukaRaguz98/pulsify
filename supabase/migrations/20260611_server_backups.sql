-- ============================================================
-- Pulsify — Server Recovery & Backup System (PULSIFY-42)
--
-- A point-in-time, versioned snapshot of a server's configuration that an
-- administrator can review, compare and (selectively) restore — the safety net
-- for accidental changes, moderation mistakes or misconfiguration.
--
-- A *backup* captures selected "sections" (mirrored in lib/backups.ts):
--   • roles         — live Discord role structure (name/colour/perms/flags)
--   • channels      — live channels + categories (type/parent/topic/overwrites)
--   • automations   — guild_settings.settings { welcome, goodbye, auto_role }
--   • moderation    — guild_settings.settings { moderation_alerts }
--   • onboarding    — guild_settings.settings { onboarding, member_onboarding }
--   • pulse_guard   — ai_moderation_settings
--   • tickets       — ticket_configs
--   • giveaways     — giveaways rows (snapshot, not auto-restored)
--   • events        — Discord scheduled events (snapshot, not auto-restored)
--   • announcements — announcements rows (snapshot, not auto-restored)
--
-- RESTORE is additive-safe (mirrors the Server Templates engine): config
-- sections are written back to the tables the bot already reads, and missing
-- roles/channels are CREATED by the dashboard via the Discord REST API. Restore
-- never deletes live resources.
--
-- Backups are created from TWO places:
--   • the dashboard (manual backups + on-demand), and
--   • the bot's hourly backup tick (scheduled daily/weekly backups + retention
--     pruning) — see pulse-bot/src/backups.js.
-- Premium-gated (Business+, the existing `backupRestore` feature flag).
-- ============================================================

-- ── Backups ──────────────────────────────────────────────────────────────────
create table if not exists public.server_backups (
  id              uuid        primary key default gen_random_uuid(),
  guild_id        text        not null,
  name            text        not null,
  -- manual | daily | weekly — how the backup was triggered.
  type            text        not null default 'manual',
  -- Per-guild incrementing sequence number ("Backup #12"). Computed by the
  -- creator (dashboard action / bot tick) as max(version)+1 for the guild.
  version         integer     not null default 1,
  -- Bumped if the captured envelope shape changes (lib/backups CURRENT_BACKUP_VERSION).
  format_version  integer     not null default 1,
  -- The captured configuration, keyed by section (shape: lib/backups BackupSections).
  sections        jsonb       not null default '{}'::jsonb,
  -- Denormalised list of captured section keys for cheap list rendering/filtering.
  section_keys    text[]      not null default '{}',
  -- Byte size of the serialised sections blob (for the "backup size" column).
  size_bytes      integer     not null default 0,
  -- NULL for bot-created scheduled backups.
  created_by      text,
  created_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists server_backups_guild
  on public.server_backups (guild_id, created_at desc);

alter table public.server_backups enable row level security;

create policy "Allow all access to server_backups"
  on public.server_backups for all using (true) with check (true);

-- ── Per-guild schedule + retention ─────────────────────────────────────────────
create table if not exists public.backup_schedules (
  guild_id       text        primary key,
  enabled        boolean     not null default false,
  -- daily | weekly
  frequency      text        not null default 'weekly',
  -- Keep the N most recent scheduled backups; older ones are pruned on each run.
  retention      integer     not null default 10,
  -- Sections the automatic backup captures (defaults to "everything" in code).
  section_keys   text[]      not null default '{}',
  last_backup_at timestamptz,
  -- When the bot's tick should next create a backup for this guild.
  next_backup_at timestamptz,
  updated_at     timestamptz not null default now(),
  updated_by     text
);

alter table public.backup_schedules enable row level security;

create policy "Allow all access to backup_schedules"
  on public.backup_schedules for all using (true) with check (true);

-- ── Recovery logs (audit trail) ────────────────────────────────────────────────
create table if not exists public.recovery_logs (
  id            uuid        primary key default gen_random_uuid(),
  guild_id      text        not null,
  -- backup_created | restore | backup_deleted | backup_pruned | schedule_updated
  action        text        not null,
  -- success | failure | partial
  status        text        not null default 'success',
  -- The backup this entry refers to. Kept on delete so history survives (set null).
  backup_id     uuid        references public.server_backups (id) on delete set null,
  backup_name   text,
  backup_type   text,
  section_keys  text[]      not null default '{}',
  actor_id      text,
  actor_name    text,
  -- Human summary ("3 roles created, 2 sections updated" / failure reason).
  detail        text,
  created_at    timestamptz not null default now()
);

create index if not exists recovery_logs_guild
  on public.recovery_logs (guild_id, created_at desc);

alter table public.recovery_logs enable row level security;

create policy "Allow all access to recovery_logs"
  on public.recovery_logs for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Realtime: the Backup Center refreshes live as the bot creates scheduled
-- backups, prunes old ones, or as restores/logs land from another session.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_backups'
  ) then
    execute 'alter publication supabase_realtime add table public.server_backups';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recovery_logs'
  ) then
    execute 'alter publication supabase_realtime add table public.recovery_logs';
  end if;
end $$;

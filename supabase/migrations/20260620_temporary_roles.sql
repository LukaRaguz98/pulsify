-- ============================================================
-- Pulsify — Temporary Roles (PULSIFY-54)
--
-- Time-limited role assignments layered on top of Server > Roles. An admin (or
-- another Pulsify system — Economy, Marketplace, Giveaways, Events, Automations,
-- Applications, Moderation) grants a member a role that auto-expires after a set
-- duration. Examples: "VIP for 30 days", "Event Access for 24 hours",
-- "Giveaway Winner for 7 days", "Trial Moderator for 14 days".
--
-- Two-writer pattern (like giveaways/milestones):
--   • DASHBOARD owns assignment/extension/shortening/removal (the API routes
--     under /api/discord/guild/[guildId]/temporary-roles) and reads everything.
--   • BOT (pulse-bot/src/temporary-roles.js) owns EXPIRY: a 60s sweep finds
--     active rows past `expires_at`, removes the Discord role, marks the row
--     `expired`, logs an event and (optionally) notifies the member + admins.
--
-- Two tables:
--   • temporary_roles        — one row per live/historical assignment
--   • temporary_role_events  — append-only audit log of every lifecycle action
-- ============================================================

-- ---------------------------------------------------------------
-- Assignments. `status` is the lifecycle: active → expired (by the bot at
-- expiry) or removed (manual early removal). `source` records where the grant
-- originated so other Pulsify systems can attribute their automated grants.
-- `notify_user` / `notify_admin` gate the optional Pulse v2 embed + dashboard
-- notifications. A partial unique index keeps a member from holding two ACTIVE
-- temporary grants of the same role (a re-grant extends instead).
create table if not exists public.temporary_roles (
  id               uuid        primary key default gen_random_uuid(),
  guild_id         text        not null,
  user_id          text        not null,
  user_name        text,
  role_id          text        not null,
  role_name        text,
  -- manual | economy | marketplace | giveaway | event | automation |
  -- application | moderation | other
  source           text        not null default 'manual',
  reason           text,
  assigned_by      text,
  assigned_by_name text,
  assigned_at      timestamptz not null default now(),
  expires_at       timestamptz not null,
  -- active | expired | removed
  status           text        not null default 'active',
  notify_user      boolean     not null default false,
  notify_admin     boolean     not null default false,
  -- Set when the grant leaves `active` (expiry or manual removal).
  ended_at         timestamptz,
  ended_by         text,
  -- Guards the bot from re-notifying for the same "expiring soon" window.
  expiry_warned_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists temporary_roles_guild_status
  on public.temporary_roles (guild_id, status, expires_at);
create index if not exists temporary_roles_guild_user
  on public.temporary_roles (guild_id, user_id);
create index if not exists temporary_roles_role
  on public.temporary_roles (guild_id, role_id);
-- One active grant per (guild, user, role); a re-grant should extend the row.
create unique index if not exists temporary_roles_active_unique
  on public.temporary_roles (guild_id, user_id, role_id)
  where status = 'active';

alter table public.temporary_roles enable row level security;

create policy "Allow all access to temporary_roles"
  on public.temporary_roles for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Append-only audit log of every lifecycle action against an assignment.
-- `action`: assigned | extended | shortened | expired | removed.
-- `detail` carries action-specific context (old/new expiry, duration, etc).
create table if not exists public.temporary_role_events (
  id                uuid        primary key default gen_random_uuid(),
  guild_id          text        not null,
  temporary_role_id uuid        references public.temporary_roles(id) on delete set null,
  user_id           text        not null,
  user_name         text,
  role_id           text        not null,
  role_name         text,
  action            text        not null,
  source            text        not null default 'manual',
  actor_id          text,
  actor_name        text,
  detail            jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists temporary_role_events_guild
  on public.temporary_role_events (guild_id, created_at desc);
create index if not exists temporary_role_events_assignment
  on public.temporary_role_events (temporary_role_id);

alter table public.temporary_role_events enable row level security;

create policy "Allow all access to temporary_role_events"
  on public.temporary_role_events for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Realtime: the dashboard's Temporary Roles tab updates live as the bot expires
-- grants and as other systems assign them.
do $$
declare
  t text;
begin
  foreach t in array array['temporary_roles', 'temporary_role_events']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

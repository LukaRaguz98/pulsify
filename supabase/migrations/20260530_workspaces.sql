-- ============================================================
-- Pulsify — Multi-Server Workspaces & Team Collaboration (PULSIFY-28)
--
-- Adds an ORGANISATION layer above the existing per-guild model. Until now
-- everything was keyed by `guild_id` and access was gated purely by a live
-- Discord "Manage Server" check (lib/moderation-auth.ts). Workspaces let a
-- user group many Discord servers, invite teammates with internal staff roles,
-- and collaborate (shared notes / tasks / incidents, a global watchlist, an
-- activity feed) — none of which exists in Discord itself.
--
-- HYBRID permission model (confirmed product decision): workspace roles fully
-- govern the new /workspace area + all Pulsify-internal collaboration data
-- (the tables below). Anything that MUTATES Discord (bans, kicks, ticket ops,
-- settings) still additionally requires the acting user to have Discord Manage
-- Server on that guild — that boundary is unchanged and lives in code
-- (lib/workspace-auth.ts → authorizeWorkspaceGuildAction).
--
-- BOT scope: none. Workspaces are a dashboard-only overlay over data the bot
-- already writes (synced_guilds, moderation_logs, analytics_events, tickets).
-- No pulse-bot changes accompany this migration.
--
-- Like every other Pulsify table these use RLS allow-all and rely on the
-- server-side authorize helpers for real enforcement — keep consistent with
-- the rest of the schema (see 20260529_leveling.sql). Realtime is enabled on
-- the collaborative tables so the dashboard updates live.
-- ============================================================

-- ---------------------------------------------------------------
-- workspaces — one row per organisation.
create table if not exists public.workspaces (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  -- URL-friendly handle, unique across all workspaces. Generated from the name
  -- in code (lib/workspace.ts slugify) with a short random suffix on collision.
  slug        text        not null unique,
  -- Public URL of the workspace logo (workspace-logos storage bucket). Null ⇒
  -- the UI renders an initial-letter avatar like the guild sidebar does.
  logo_url    text,
  -- Discord user id of the creator. Always also has a workspace_members row
  -- with role 'owner'; this column is the canonical "who owns the org" pointer
  -- used for the delete-workspace gate and ownership transfer.
  owner_id    text        not null,
  -- Branding + misc preferences (accent color, etc). Shape lives in code.
  settings    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.workspaces enable row level security;
create policy "Allow all access to workspaces"
  on public.workspaces for all using (true) with check (true);

-- ---------------------------------------------------------------
-- workspace_members — team roster + internal staff role.
-- role is internal Pulsify RBAC, NOT a Discord role: owner > admin > moderator
-- > analyst > support (capability matrix in lib/workspace.ts).
create table if not exists public.workspace_members (
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  user_id      text        not null,       -- Discord user id
  role         text        not null default 'support',
  display_name text,
  avatar_url   text,
  added_by     text,                       -- Discord id of the inviter (null for the founding owner)
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user
  on public.workspace_members (user_id);

alter table public.workspace_members enable row level security;
create policy "Allow all access to workspace_members"
  on public.workspace_members for all using (true) with check (true);

-- ---------------------------------------------------------------
-- workspace_servers — which Discord guilds belong to a workspace, with tags
-- for grouping. A guild MAY appear in more than one workspace (e.g. an agency
-- and the owner's personal workspace), hence the composite pk rather than a
-- unique guild_id.
create table if not exists public.workspace_servers (
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  guild_id     text        not null,
  -- Free-form grouping labels ("Main", "Partner", "Staging", …) for the
  -- server grid filter. Stored as a text[] so filtering is a simple contains.
  tags         text[]      not null default '{}',
  added_by     text,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, guild_id)
);

create index if not exists workspace_servers_guild
  on public.workspace_servers (guild_id);

alter table public.workspace_servers enable row level security;
create policy "Allow all access to workspace_servers"
  on public.workspace_servers for all using (true) with check (true);

-- ---------------------------------------------------------------
-- workspace_invites — link-based team invites. Discord-only auth means there
-- is no email delivery; an invite is a shareable code. The invitee opens
-- /workspace/join/<code>, signs in with Discord, and a workspace_members row is
-- created for them with `role`. `label` is a free-text note (who it's for),
-- never used for delivery.
create table if not exists public.workspace_invites (
  id          uuid        primary key default gen_random_uuid(),
  workspace_id uuid       not null references public.workspaces(id) on delete cascade,
  code        text        not null unique,
  role        text        not null default 'support',
  label       text,
  created_by  text        not null,
  expires_at  timestamptz,                 -- null ⇒ never expires
  max_uses    integer,                     -- null ⇒ unlimited
  uses        integer     not null default 0,
  revoked     boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists workspace_invites_workspace
  on public.workspace_invites (workspace_id, created_at desc);

alter table public.workspace_invites enable row level security;
create policy "Allow all access to workspace_invites"
  on public.workspace_invites for all using (true) with check (true);

-- ---------------------------------------------------------------
-- workspace_notes — shared staff / moderation notes. guild_id scopes a note to
-- one of the workspace's servers (null ⇒ workspace-wide); subject_user_id makes
-- it a note ABOUT a Discord member (the "shared moderation notes on a user"
-- requirement). `mentions` is a jsonb array of mentioned member user_ids,
-- parsed from the body in code.
create table if not exists public.workspace_notes (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references public.workspaces(id) on delete cascade,
  guild_id        text,
  subject_user_id text,
  author_id       text        not null,
  author_name     text,
  body            text        not null,
  mentions        jsonb       not null default '[]'::jsonb,
  pinned          boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists workspace_notes_workspace
  on public.workspace_notes (workspace_id, created_at desc);
create index if not exists workspace_notes_subject
  on public.workspace_notes (workspace_id, subject_user_id);

alter table public.workspace_notes enable row level security;
create policy "Allow all access to workspace_notes"
  on public.workspace_notes for all using (true) with check (true);

-- ---------------------------------------------------------------
-- workspace_tasks — shared todo board.
create table if not exists public.workspace_tasks (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  guild_id     text,
  title        text        not null,
  description  text,
  status       text        not null default 'open',    -- open | in_progress | done
  priority     text        not null default 'normal',  -- low | normal | high | urgent
  assignee_id  text,                                    -- Discord id of a member
  created_by   text        not null,
  due_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists workspace_tasks_workspace
  on public.workspace_tasks (workspace_id, created_at desc);

alter table public.workspace_tasks enable row level security;
create policy "Allow all access to workspace_tasks"
  on public.workspace_tasks for all using (true) with check (true);

-- ---------------------------------------------------------------
-- workspace_incidents — collaborative moderation workflow. An incident has a
-- lifecycle (status) + severity + assignee, and a thread of comments below.
create table if not exists public.workspace_incidents (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  guild_id     text,
  title        text        not null,
  description  text,
  status       text        not null default 'open',     -- open | investigating | resolved | closed
  severity     text        not null default 'medium',   -- low | medium | high | critical
  assignee_id  text,
  created_by   text        not null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists workspace_incidents_workspace
  on public.workspace_incidents (workspace_id, created_at desc);

alter table public.workspace_incidents enable row level security;
create policy "Allow all access to workspace_incidents"
  on public.workspace_incidents for all using (true) with check (true);

-- workspace_incident_comments — internal incident comments + @mentions.
create table if not exists public.workspace_incident_comments (
  id          uuid        primary key default gen_random_uuid(),
  incident_id uuid        not null references public.workspace_incidents(id) on delete cascade,
  author_id   text        not null,
  author_name text,
  body        text        not null,
  mentions    jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists workspace_incident_comments_incident
  on public.workspace_incident_comments (incident_id, created_at);

alter table public.workspace_incident_comments enable row level security;
create policy "Allow all access to workspace_incident_comments"
  on public.workspace_incident_comments for all using (true) with check (true);

-- ---------------------------------------------------------------
-- workspace_watchlist — global moderation watchlist + shared banned/scam user
-- lists, cross-server. kind: watch (keep an eye on) | scam | banned. Unique per
-- (workspace, user, kind) so the same user can be both watched and flagged scam
-- without dupes.
create table if not exists public.workspace_watchlist (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  user_id      text        not null,       -- Discord user id being tracked
  user_name    text,
  kind         text        not null default 'watch',
  reason       text,
  severity     text        not null default 'medium',   -- low | medium | high | critical
  added_by     text        not null,
  added_by_name text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id, kind)
);

create index if not exists workspace_watchlist_workspace
  on public.workspace_watchlist (workspace_id, created_at desc);

alter table public.workspace_watchlist enable row level security;
create policy "Allow all access to workspace_watchlist"
  on public.workspace_watchlist for all using (true) with check (true);

-- ---------------------------------------------------------------
-- workspace_activity — append-only audit log AND the activity feed. Every
-- mutating workspace action writes one row here (lib/workspace-activity.ts
-- recordWorkspaceActivity). `action` is a dotted verb (server.added,
-- member.invited, note.created, task.completed, incident.created, …),
-- `category` groups them for the feed's notification filter.
create table if not exists public.workspace_activity (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  actor_id     text,
  actor_name   text,
  action       text        not null,
  category     text        not null default 'workspace', -- workspace | servers | team | notes | tasks | incidents | watchlist | moderation
  target_type  text,
  target_id    text,
  summary      text,
  guild_id     text,
  metadata     jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists workspace_activity_workspace_time
  on public.workspace_activity (workspace_id, created_at desc);
create index if not exists workspace_activity_actor
  on public.workspace_activity (workspace_id, actor_id, created_at desc);

alter table public.workspace_activity enable row level security;
create policy "Allow all access to workspace_activity"
  on public.workspace_activity for all using (true) with check (true);

-- ---------------------------------------------------------------
-- workspace_notification_prefs — per-user, per-workspace feed filtering.
-- `enabled_categories` is a jsonb map of category → boolean; missing keys
-- default to ON in code, so a fresh member sees everything until they opt out.
create table if not exists public.workspace_notification_prefs (
  workspace_id       uuid        not null references public.workspaces(id) on delete cascade,
  user_id            text        not null,
  enabled_categories jsonb       not null default '{}'::jsonb,
  updated_at         timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.workspace_notification_prefs enable row level security;
create policy "Allow all access to workspace_notification_prefs"
  on public.workspace_notification_prefs for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Storage bucket for workspace logos. Same public-read / authenticated-write
-- pattern as welcome-banners (20250103000000_welcome_banners_storage.sql).
insert into storage.buckets (id, name, public)
values ('workspace-logos', 'workspace-logos', true)
on conflict (id) do nothing;

create policy "Authenticated users can upload workspace logos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'workspace-logos');

create policy "Authenticated users can update workspace logos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'workspace-logos');

create policy "Public read workspace logos"
  on storage.objects for select
  using (bucket_id = 'workspace-logos');

-- ---------------------------------------------------------------
-- Realtime: the collaborative surfaces update live as teammates work.
do $$
declare
  t text;
begin
  foreach t in array array[
    'workspace_notes',
    'workspace_tasks',
    'workspace_incidents',
    'workspace_incident_comments',
    'workspace_activity',
    'workspace_members',
    'workspace_servers',
    'workspace_watchlist'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

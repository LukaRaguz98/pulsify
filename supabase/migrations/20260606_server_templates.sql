-- ============================================================
-- Pulsify — Server Templates (PULSIFY-36)
--
-- Save, reuse, import and export server configurations. A *template* is a
-- point-in-time snapshot of selected configuration "sections" — automations
-- (welcome/goodbye/auto-role), moderation alert routing, Pulse content
-- (rules/channel reference), onboarding, Pulse Guard (AI moderation), the
-- ticket system, and the role structure — captured from one server and
-- re-applyable to any other (partial imports supported).
--
-- This is a DASHBOARD-ONLY feature, like Workspaces: there is no bot writer.
--   • Capture reads guild_settings / ai_moderation_settings / ticket_configs
--     and the live Discord role list, and stores a sanitised `sections` blob.
--   • Apply merges the chosen sections back into those same tables (which the
--     bot already reads), and creates any missing roles via the Discord REST
--     API straight from the server action — no new bot surface required.
--
-- Built-in "official preset" templates (Gaming, Creator, Support, …) live in
-- code (lib/templates.ts), not here, so they ship with the app and stay
-- versioned. This table only holds the templates a user saves/imports.
-- ============================================================

create table if not exists public.server_templates (
  id            uuid        primary key default gen_random_uuid(),
  -- The server this template was captured from. NULL when imported from JSON
  -- with no known origin. Kept for provenance/filtering; apply is not limited
  -- to the origin guild.
  guild_id      text,
  name          text        not null,
  description   text,
  -- gaming | creator | support | startup | community | custom
  category      text        not null default 'custom',
  -- lucide icon name (UI only).
  icon          text        not null default 'LayoutTemplate',
  -- Snapshot of the captured configuration, keyed by section:
  --   { automations, moderation, pulse, onboarding, pulse_guard, tickets, roles }
  -- Each value is the section's config; absent keys = section not captured.
  -- Shape mirrored in lib/templates.ts (TemplateSections).
  sections      jsonb       not null default '{}'::jsonb,
  author_id     text,
  author_name   text,
  -- Bumped each time the template is applied to a server.
  usage_count   integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists server_templates_guild
  on public.server_templates (guild_id, created_at desc);

alter table public.server_templates enable row level security;

create policy "Allow all access to server_templates"
  on public.server_templates for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Realtime: the Templates view refreshes its library live as templates are
-- created, applied (usage_count bump) or deleted from other tabs/sessions.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_templates'
  ) then
    execute 'alter publication supabase_realtime add table public.server_templates';
  end if;
end $$;

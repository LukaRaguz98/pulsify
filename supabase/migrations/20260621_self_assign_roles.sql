-- ============================================================
-- Pulsify — Self-Assign Roles (PULSIFY-56)
--
-- Interactive role menus posted into a Discord channel where members assign or
-- remove roles themselves using buttons or a select menu — a modern Components
-- V2 replacement for reaction-role bots, layered on top of Server > Roles.
--
-- Two-writer pattern (like polls/giveaways/temporary-roles):
--   • DASHBOARD owns the menu lifecycle (the API routes under
--     /api/discord/guild/[guildId]/self-roles): create, edit, duplicate,
--     publish, disable, archive, delete — and POSTS / edits the Discord message.
--   • BOT (pulse-bot/src/self-roles.js) owns the INTERACTIONS: it handles the
--     `sr:` buttons + select menu, toggles the member's roles (respecting the
--     selection mode + required-role gate) and appends an assignment row so the
--     dashboard can report usage analytics.
--
-- Two tables:
--   • self_role_menus       — one row per menu (config + roles jsonb)
--   • self_role_assignments — append-only log of every add/remove the bot made,
--                             the source for the usage analytics.
-- ============================================================

-- ---------------------------------------------------------------
-- Menus. `roles` is an ordered jsonb array of
--   { role_id, label, description, emoji, button_style, position }
-- so a menu's roles, labels, emojis, colours and ordering travel as one value.
-- `menu_type` picks the control (buttons vs a select menu). `selection_mode`
-- decides whether members may hold several of the menu's roles at once
-- ('multiple') or only one — switching ('single', i.e. mutually exclusive).
-- `min_values` / `max_values` bound a select menu (0 = unbounded). The optional
-- `required_role_ids` gate restricts who may use the menu at all.
create table if not exists public.self_role_menus (
  id                 uuid        primary key default gen_random_uuid(),
  guild_id           text        not null,
  title              text        not null,
  description        text,
  channel_id         text        not null,
  message_id         text,
  -- buttons | select
  menu_type          text        not null default 'buttons',
  -- game | notification | platform | language | region | interest | color | custom
  category           text        not null default 'custom',
  -- multiple (toggle any) | single (mutually exclusive — switching)
  selection_mode     text        not null default 'multiple',
  min_values         integer     not null default 0,
  max_values         integer     not null default 0,
  required_role_ids  jsonb       not null default '[]'::jsonb,
  -- any | all
  required_role_mode text        not null default 'any',
  roles              jsonb       not null default '[]'::jsonb,
  -- draft | active | disabled | archived
  status             text        not null default 'draft',
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists self_role_menus_guild_status
  on public.self_role_menus (guild_id, status);
create index if not exists self_role_menus_guild_created
  on public.self_role_menus (guild_id, created_at desc);

alter table public.self_role_menus enable row level security;

create policy "Allow all access to self_role_menus"
  on public.self_role_menus for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Append-only log of every role add/remove a member made through a menu. Drives
-- the analytics (assignments over time, most/least selected roles). Deleting a
-- menu cascades its history away.
create table if not exists public.self_role_assignments (
  id          uuid        primary key default gen_random_uuid(),
  guild_id    text        not null,
  menu_id     uuid        references public.self_role_menus(id) on delete cascade,
  user_id     text        not null,
  user_name   text,
  role_id     text        not null,
  role_name   text,
  -- added | removed
  action      text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists self_role_assignments_guild_created
  on public.self_role_assignments (guild_id, created_at desc);
create index if not exists self_role_assignments_menu
  on public.self_role_assignments (menu_id);
create index if not exists self_role_assignments_role
  on public.self_role_assignments (guild_id, role_id);

alter table public.self_role_assignments enable row level security;

create policy "Allow all access to self_role_assignments"
  on public.self_role_assignments for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Realtime: the bot keeps a live cache of menus (so it can answer button/select
-- interactions without a DB round-trip), and the dashboard's Self-Assign Roles
-- tab updates its analytics as members self-assign.
do $$
declare
  t text;
begin
  foreach t in array array['self_role_menus', 'self_role_assignments']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

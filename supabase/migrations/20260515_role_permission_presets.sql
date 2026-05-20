-- Per-guild reusable permission presets surfaced in the Roles editor.
-- App-level authorization (lib/moderation-auth.ts) gates writes; RLS keeps
-- direct access scoped to authenticated users.

create table if not exists public.role_permission_presets (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  name text not null,
  description text,
  -- Permission bitfield as a stringified bigint, matching Discord's wire format.
  permissions text not null default '0',
  -- True for seeded defaults (Admin/Moderator/Member/Verified/Bot).
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, name)
);

create index if not exists idx_role_permission_presets_guild
  on public.role_permission_presets (guild_id);

alter table public.role_permission_presets enable row level security;

create policy "Authenticated users can read presets"
  on public.role_permission_presets
  for select
  to authenticated
  using (true);

create policy "Authenticated users can write presets"
  on public.role_permission_presets
  for all
  to authenticated
  using (true)
  with check (true);

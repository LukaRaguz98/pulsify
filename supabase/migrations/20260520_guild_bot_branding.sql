-- ============================================================
-- Pulsify — per-server bot branding
-- Admins can give the Pulse bot a custom nickname and avatar in their own
-- server. Discord is the source of truth for the live values (the bot's guild
-- member nick/avatar); this table records the last change for the dashboard:
-- who set it, when, and whether custom branding is currently applied. That
-- powers the "last updated" line, the audit trail, and the default fallback.
-- ============================================================

create table if not exists public.guild_bot_branding (
  guild_id     text        primary key,
  -- Custom nickname applied to the bot in this guild. null = default username.
  bot_nickname text,
  -- Last-known guild avatar hash from Discord. null = default avatar.
  avatar_hash  text,
  updated_at   timestamptz not null default now(),
  -- Discord user ID + display name of the admin who last changed branding.
  updated_by   text,
  updated_by_name text
);

alter table public.guild_bot_branding enable row level security;

create policy "Service role full access to guild_bot_branding"
  on public.guild_bot_branding
  for all
  using (true)
  with check (true);

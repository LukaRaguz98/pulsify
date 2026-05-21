-- ============================================================
-- Command Center — per-command reply visibility.
-- `ephemeral = true`  → only the member who ran the command sees the reply.
-- `ephemeral = false` → the reply is posted publicly in the channel.
-- Defaults to true to preserve the existing (private) behaviour.
-- ============================================================

alter table public.command_configs
  add column if not exists ephemeral boolean not null default true;

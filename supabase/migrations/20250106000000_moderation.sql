-- ============================================================
-- Pulsify — moderation logs
-- Records every moderation action performed from the dashboard.
-- ============================================================

create table if not exists public.moderation_logs (
  id                  uuid        primary key default gen_random_uuid(),
  guild_id            text        not null,
  action              text        not null, -- timeout | remove_timeout | kick | ban | unban | warn | nickname | add_role | remove_role | delete_message | bulk_delete_messages
  target_user_id      text,
  target_username     text,
  moderator_id        text        not null,
  moderator_username  text,
  reason              text,
  metadata            jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists moderation_logs_guild_time
  on public.moderation_logs (guild_id, created_at desc);

create index if not exists moderation_logs_guild_target
  on public.moderation_logs (guild_id, target_user_id);

alter table public.moderation_logs enable row level security;

create policy "Service role full access to moderation_logs"
  on public.moderation_logs
  for all
  using (true)
  with check (true);

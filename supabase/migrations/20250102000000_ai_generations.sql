create table if not exists public.ai_generations (
  id               uuid        primary key default gen_random_uuid(),
  guild_id         text        not null,
  server_description text,
  tone             text,
  welcome_message  text,
  rules            jsonb,
  onboarding       text,
  channels         jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists ai_generations_guild_created
  on public.ai_generations (guild_id, created_at desc);

alter table public.ai_generations enable row level security;

create policy "Service role full access to ai_generations"
  on public.ai_generations
  for all
  using (true)
  with check (true);

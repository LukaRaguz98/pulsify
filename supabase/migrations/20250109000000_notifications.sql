-- ============================================================
-- Pulsify — notifications & activity feed
-- A single notifications table powers the bell, activity feed, and toasts.
-- Member join/leave notifications are derived from analytics_events via a
-- trigger, so the bot doesn't need to know about this table directly.
-- ============================================================

create table if not exists public.notifications (
  id          uuid        primary key default gen_random_uuid(),
  guild_id    text        not null,
  -- Specific event type: member_join | member_leave | mod_action |
  -- role_created | role_updated | role_deleted | event_created | event_updated |
  -- event_deleted | channel_created | channel_updated | channel_deleted |
  -- server_settings_changed | automation_saved | bot_warning | bot_error |
  -- automation_triggered.
  type        text        not null,
  -- High-level group used for filtering in the UI:
  -- members | moderation | roles | events | channels | settings | automations | bot.
  category    text        not null,
  -- info | success | warning | error — drives icon + color in UI.
  severity    text        not null default 'info',
  title       text        not null,
  body        text,
  -- Optional dashboard route to open when the notification is clicked.
  link        text,
  -- Who triggered the event (Discord user ID + display name).
  actor_id    text,
  actor_name  text,
  -- The thing the event was about (member, channel, role, …).
  target_id   text,
  target_name text,
  metadata    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_guild_time
  on public.notifications (guild_id, created_at desc);
create index if not exists notifications_guild_category_time
  on public.notifications (guild_id, category, created_at desc);
create index if not exists notifications_guild_type_time
  on public.notifications (guild_id, type, created_at desc);

alter table public.notifications enable row level security;

-- Service role + browser clients can read & insert. Matches the pattern used
-- on analytics_events so Realtime broadcasts reach the dashboard.
create policy "Allow all access to notifications"
  on public.notifications
  for all
  using (true)
  with check (true);

-- ---------------------------------------------------------------
-- Per-user read state. Notifications are guild-wide; reads are per-user so
-- each dashboard admin tracks their own inbox independently.
-- user_id is the Discord user ID (stored as text), matching how the rest of
-- the schema identifies users.
create table if not exists public.notification_reads (
  notification_id uuid        not null references public.notifications(id) on delete cascade,
  user_id         text        not null,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists notification_reads_user
  on public.notification_reads (user_id, read_at desc);

alter table public.notification_reads enable row level security;

create policy "Allow all access to notification_reads"
  on public.notification_reads
  for all
  using (true)
  with check (true);

-- ---------------------------------------------------------------
-- Per-user, per-guild notification preferences.
-- `enabled_types` is a JSONB map of type → boolean. Missing keys default to
-- ON in application code, so a fresh user gets every notification until they
-- opt out.
create table if not exists public.notification_preferences (
  user_id       text        not null,
  guild_id      text        not null,
  enabled_types jsonb       not null default '{}'::jsonb,
  toast_enabled boolean     not null default true,
  updated_at    timestamptz not null default now(),
  primary key (user_id, guild_id)
);

alter table public.notification_preferences enable row level security;

create policy "Allow all access to notification_preferences"
  on public.notification_preferences
  for all
  using (true)
  with check (true);

-- ---------------------------------------------------------------
-- Bridge analytics_events → notifications for member joins/leaves so the
-- activity feed surfaces them without the bot needing to know about the
-- notifications table.
create or replace function public.notification_from_analytics_event()
returns trigger
language plpgsql
as $$
begin
  if NEW.event_type = 'member_join' then
    insert into public.notifications (
      guild_id, type, category, severity, title, body,
      target_id, target_name, metadata, created_at
    ) values (
      NEW.guild_id, 'member_join', 'members', 'success',
      coalesce(NEW.user_name, 'A member') || ' joined the server',
      null,
      NEW.user_id, NEW.user_name, NEW.metadata, NEW.created_at
    );
  elsif NEW.event_type = 'member_leave' then
    insert into public.notifications (
      guild_id, type, category, severity, title, body,
      target_id, target_name, metadata, created_at
    ) values (
      NEW.guild_id, 'member_leave', 'members', 'info',
      coalesce(NEW.user_name, 'A member') || ' left the server',
      null,
      NEW.user_id, NEW.user_name, NEW.metadata, NEW.created_at
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notification_from_analytics_event on public.analytics_events;
create trigger trg_notification_from_analytics_event
  after insert on public.analytics_events
  for each row execute function public.notification_from_analytics_event();

-- ---------------------------------------------------------------
-- Retention: drop notifications older than 30 days. Schedule with pg_cron
-- (see Supabase docs → Database → Extensions → pg_cron) or call manually:
--   select public.cleanup_notifications();
create or replace function public.cleanup_notifications()
returns void
language sql
as $$
  delete from public.notifications
  where created_at < now() - interval '30 days';
$$;

-- ---------------------------------------------------------------
-- Helper: unread count for a given user + guild. Used by the bell badge.
create or replace function public.get_notification_unread_count(
  p_user_id  text,
  p_guild_id text
)
returns bigint
language sql
stable
as $$
  select count(*)
  from public.notifications n
  left join public.notification_reads r
    on r.notification_id = n.id and r.user_id = p_user_id
  where n.guild_id = p_guild_id
    and r.notification_id is null;
$$;

grant execute on function public.get_notification_unread_count(text, text) to anon, authenticated;
grant execute on function public.cleanup_notifications() to service_role;

-- ---------------------------------------------------------------
-- Enable Realtime so the dashboard can subscribe to live notification inserts.
alter publication supabase_realtime add table public.notifications;

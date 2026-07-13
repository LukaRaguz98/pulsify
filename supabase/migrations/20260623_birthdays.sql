-- ============================================================
-- Pulsify — Birthday System (PULSIFY-58)
--
-- Members set their birthday (day/month, optional year) and Pulse automatically
-- celebrates it inside Discord: a configurable announcement, an optional
-- temporary birthday role, and optional rewards (Pulse Coins / XP / custom
-- roles). A lightweight social layer that improves community engagement.
--
-- Two-writer pattern (like milestones / temporary-roles):
--   • MEMBERS own their own birthday row (via the /birthday command or the
--     Pulsify member profile). Admins can view but the value is member-authored.
--   • DASHBOARD (admins) owns the per-guild configuration (birthday_settings).
--   • BOT (pulse-bot/src/birthdays.js) owns the daily sweep: at the configured
--     hour it finds members whose birthday is "today", posts the announcement,
--     grants rewards, assigns the temporary birthday role (reusing the
--     temporary_roles table with source 'birthday' so it auto-expires), and
--     writes a birthday_events history row (idempotent per calendar year).
--
-- Three tables:
--   • member_birthdays   — one row per member per guild (member-authored)
--   • birthday_settings  — one config row per guild (admin-authored)
--   • birthday_events    — append-only celebration history + idempotency guard
-- ============================================================

-- ---------------------------------------------------------------
-- Member-authored birthday. `birth_year` is optional (privacy) and `show_year`
-- further lets a member hide their age even when a year is stored. `announce`
-- lets a member opt out of the public shout-out entirely while still appearing
-- in the upcoming list. `timezone` is the member's IANA zone (falls back to the
-- guild default) so "today" is evaluated in their local day.
create table if not exists public.member_birthdays (
  id           uuid        primary key default gen_random_uuid(),
  guild_id     text        not null,
  user_id      text        not null,
  user_name    text,
  birth_month  int         not null,               -- 1-12
  birth_day    int         not null,               -- 1-31
  birth_year   int,                                 -- optional
  timezone     text,                                -- IANA zone, nullable
  show_year    boolean     not null default true,   -- reveal age / year
  announce     boolean     not null default true,   -- allow public announcement
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint member_birthdays_month_chk check (birth_month between 1 and 12),
  constraint member_birthdays_day_chk   check (birth_day between 1 and 31)
);

-- One birthday per member per guild.
create unique index if not exists member_birthdays_guild_user
  on public.member_birthdays (guild_id, user_id);
-- The sweep scans by (guild, month, day) each day.
create index if not exists member_birthdays_guild_date
  on public.member_birthdays (guild_id, birth_month, birth_day);

alter table public.member_birthdays enable row level security;

create policy "Allow all access to member_birthdays"
  on public.member_birthdays for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Per-guild configuration. `enabled` is opt-in (off by default — birthdays are
-- more sensitive than most features). Everything else lives in `settings` jsonb
-- (channel, announce hour + timezone, message template + embed options, the
-- temporary birthday role config, and reward amounts) — same { enabled, settings }
-- shape as leveling_settings / economy_reward_settings.
create table if not exists public.birthday_settings (
  guild_id   text        primary key,
  enabled    boolean     not null default false,
  settings   jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.birthday_settings enable row level security;

create policy "Allow all access to birthday_settings"
  on public.birthday_settings for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Append-only celebration history. `year` is the CALENDAR year the celebration
-- happened (not the birth year); the unique (guild, user, year) index makes the
-- daily sweep idempotent — a member is celebrated at most once per calendar
-- year even if the sweep runs many times that day. `rewards` snapshots what was
-- granted; `age` is the age turned when the birth year is known.
create table if not exists public.birthday_events (
  id          uuid        primary key default gen_random_uuid(),
  guild_id    text        not null,
  user_id     text        not null,
  user_name   text,
  year        int         not null,                 -- calendar year of the celebration
  age         int,                                   -- age turned (if birth_year known)
  announced   boolean     not null default false,
  channel_id  text,
  message_id  text,
  role_id     text,                                  -- temporary birthday role granted
  rewards     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Idempotency: at most one celebration per member per calendar year.
create unique index if not exists birthday_events_guild_user_year
  on public.birthday_events (guild_id, user_id, year);
create index if not exists birthday_events_guild_created
  on public.birthday_events (guild_id, created_at desc);

alter table public.birthday_events enable row level security;

create policy "Allow all access to birthday_events"
  on public.birthday_events for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Realtime: the dashboard's Birthdays view updates live as members set their
-- birthday and as the bot records celebrations.
do $$
declare
  t text;
begin
  foreach t in array array['member_birthdays', 'birthday_settings', 'birthday_events']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

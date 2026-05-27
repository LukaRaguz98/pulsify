-- ============================================================
-- Pulsify — Levels & XP System (PULSIFY-26)
--
-- Extends the existing member *reputation* system (which is computed on the
-- fly from activity + tenure + moderation history, never stored) with a
-- parallel *progression* system: persistent, cumulative XP and a level derived
-- from a configurable curve.
--
-- Two tables:
--   • member_levels     — one row per (guild, member): the canonical XP total
--     plus a denormalised level cache (recomputed by the bot from the guild's
--     curve whenever XP changes — kept only so the dashboard can sort/show it
--     without knowing the curve). XP is the source of truth.
--   • leveling_settings — one row per guild: the XP rates, cooldowns, curve,
--     ignored channels/roles, level-up announcement config and reward roles.
--     A MISSING row means "enabled with defaults" (XP tracking is on by default
--     — see lib/leveling.ts normaliseLevelingSettings), so a guild starts
--     earning XP the moment the bot sees activity, without any setup.
--
-- Like giveaways/tickets the BOT (pulse-bot/src/leveling.js) is the writer of
-- member_levels — it awards XP for messages/voice/commands/giveaway entries/
-- event interest, detects level-ups, assigns reward roles and announces. The
-- DASHBOARD writes leveling_settings (app/dashboard/[guildId]/leveling-settings)
-- and reads both tables. The curve / settings / reward logic lives in code
-- (lib/leveling.ts, mirrored by leveling.js) so tuning it is never a migration.
-- ============================================================

create table if not exists public.member_levels (
  guild_id            text        not null,
  user_id             text        not null,
  user_name           text,
  -- Cumulative XP earned in this guild. Source of truth.
  xp                  bigint      not null default 0,
  -- Denormalised level (= levelForXp(xp, guild curve)). The bot keeps this in
  -- sync on each award; it lets the dashboard sort by level without the curve.
  level               integer     not null default 0,
  -- Last time a message awarded XP — drives the per-user message cooldown so a
  -- restart of the bot doesn't reset anti-spam protection.
  last_message_xp_at  timestamptz,
  updated_at          timestamptz not null default now(),
  primary key (guild_id, user_id)
);

-- Leaderboard + /rank rank-position queries (order by / count where xp > n).
create index if not exists member_levels_guild_xp
  on public.member_levels (guild_id, xp desc);

alter table public.member_levels enable row level security;

create policy "Allow all access to member_levels"
  on public.member_levels for all using (true) with check (true);

-- ---------------------------------------------------------------

create table if not exists public.leveling_settings (
  guild_id   text        primary key,
  -- Whether XP tracking runs. Default true so the feature is on out of the box.
  enabled    boolean     not null default true,
  -- All tunables as one jsonb blob (xp rates, cooldowns, curve, ignored
  -- channels/roles, level-up announce mode + channel + message template,
  -- reward roles, stack flag). Shape lives in lib/leveling.ts.
  settings   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.leveling_settings enable row level security;

create policy "Allow all access to leveling_settings"
  on public.leveling_settings for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Atomic XP increment. XP awards are on a hot, concurrent path — a single
-- member can earn from a message, the voice tick and a command at nearly the
-- same instant — so a JS read-modify-write would lose updates. This upserts and
-- returns the NEW total in one statement; the bot computes the level from the
-- guild's curve in code and writes it back only when it changes.
create or replace function public.add_member_xp(
  p_guild_id  text,
  p_user_id   text,
  p_user_name text,
  p_amount    integer
)
returns bigint
language plpgsql
as $$
declare
  new_xp bigint;
begin
  insert into public.member_levels (guild_id, user_id, user_name, xp, updated_at)
  values (p_guild_id, p_user_id, p_user_name, greatest(p_amount, 0), now())
  on conflict (guild_id, user_id) do update
    set xp         = public.member_levels.xp + greatest(p_amount, 0),
        user_name  = coalesce(excluded.user_name, public.member_levels.user_name),
        updated_at = now()
  returning xp into new_xp;
  return new_xp;
end;
$$;

grant execute on function public.add_member_xp(text, text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------
-- Realtime: the dashboard's directory / profile / leaderboard update live as
-- members earn XP, and the bot picks up settings changes without a restart.
do $$
declare
  t text;
begin
  foreach t in array array['member_levels', 'leveling_settings']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

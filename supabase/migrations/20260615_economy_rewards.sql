-- ============================================================
-- Pulsify — Economy Rewards & Earning System (PULSIFY-47)
--
-- PULSIFY-45 shipped a global Pulse Coins balance earned at a handful of FIXED
-- rates baked into the bot. This migration adds the configuration + state that
-- turns earning into a per-guild, tunable system:
--
--   • economy_reward_settings — one row per guild: an `enabled` flag plus a
--     `settings` jsonb holding every source amount, cooldown/cap, multiplier and
--     anti-abuse rule (shape lives in lib/economy-rewards.ts). Missing row =
--     enabled with defaults (mirrors leveling_settings). Realtime-published so
--     the bot's in-memory config cache stays fresh.
--
--   • economy_streaks — daily/weekly claim state per (guild, user): the last
--     claimed period index + current/longest streak for each cadence. Drives
--     /daily and /weekly with streak + loyalty bonuses.
--
--   • economy_claim_streak() — atomic daily/weekly claim. Guards against
--     double-claims (period-index check) AND credits the coins + writes the
--     ledger row in ONE transaction, so two concurrent /daily presses can't
--     both pay out. Same race-safety contract as economy_adjust.
--
-- Reputation is deliberately absent: it stays the computed 0-100 trust score
-- (never stored/granted). PULSIFY-47 uses it only as an earning *multiplier*,
-- read live from get_global_member_reputation — no schema needed here.
--
-- This is the SAME feature as the rewards shop (20260614) — "Rewards" in the
-- dashboard now covers both spending (shop catalogue: shop_rewards /
-- reward_purchases) and EARNING (this migration). The two table sets are
-- complementary, not duplicates, so nothing from 20260614 is dropped here.
-- Coins themselves still live in economy_users / economy_transactions from
-- 20260613 — this migration only adds the earning config + streak state + the
-- claim RPC.
--
-- Idempotent / re-runnable. The drops below clean up any earlier DRAFT of these
-- objects (the feature is unreleased) so re-applying on a dev DB is safe; they
-- are no-ops on a fresh database and never touch the shop tables.
-- ============================================================

-- ── Dev re-run safety (no-ops on a fresh DB) ──────────────────────────────────
-- Drop the claim function before recreate in case an earlier draft had a
-- different signature/return shape (CREATE OR REPLACE can't change those).
drop function if exists public.economy_claim_streak(text, text, text, text, bigint, integer, bigint, text, text);

-- ── Per-guild earning configuration ───────────────────────────────────────────

create table if not exists public.economy_reward_settings (
  guild_id   text        primary key,
  -- Master switch for the whole earning system in this guild. Missing row =
  -- enabled with defaults, so existing guilds keep earning unchanged.
  enabled    boolean     not null default true,
  -- Full config blob — source amounts, cooldowns, caps, multipliers,
  -- anti-abuse, notifications. Normalised by lib/economy-rewards.ts.
  settings   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.economy_reward_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'economy_reward_settings'
      and policyname = 'Allow all access to economy_reward_settings'
  ) then
    create policy "Allow all access to economy_reward_settings"
      on public.economy_reward_settings for all using (true) with check (true);
  end if;
end $$;

-- ── Daily / weekly streak state ───────────────────────────────────────────────

create table if not exists public.economy_streaks (
  guild_id          text        not null,
  user_id           text        not null,
  user_name         text,
  -- Period index of the last claim (UTC day index / week index). Null = never.
  daily_last_index  bigint,
  daily_streak      integer     not null default 0,
  daily_longest     integer     not null default 0,
  weekly_last_index bigint,
  weekly_streak     integer     not null default 0,
  weekly_longest    integer     not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (guild_id, user_id)
);

alter table public.economy_streaks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'economy_streaks'
      and policyname = 'Allow all access to economy_streaks'
  ) then
    create policy "Allow all access to economy_streaks"
      on public.economy_streaks for all using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------
-- Atomic daily/weekly claim. The bot computes the new streak + total payout in
-- JS (the streak/milestone math lives in lib/economy-rewards.ts), then calls
-- this once. The function re-checks the period guard under a row lock so two
-- concurrent claims can't both succeed, and — only if the claim is fresh —
-- credits the coins and writes the ledger row in the SAME transaction.
--
-- Returns (new_balance, claimed). claimed=false means "already claimed this
-- period" (nothing changed); the bot reports the time remaining.
create or replace function public.economy_claim_streak(
  p_guild_id     text,
  p_user_id      text,
  p_user_name    text,
  p_kind         text,      -- 'daily' | 'weekly'
  p_period_index bigint,    -- dayIndex/weekIndex(now) from lib/economy-rewards
  p_new_streak   integer,   -- bot-computed streak after this claim
  p_amount       bigint,    -- bot-computed total payout (base + streak + milestone)
  p_guild_name   text default null,
  p_reason       text default null
)
returns table (new_balance bigint, claimed boolean)
language plpgsql
as $$
declare
  last_index bigint;
  bal        bigint;
begin
  if p_kind not in ('daily', 'weekly') then
    return query select 0::bigint, false; return;
  end if;

  -- Ensure + lock the streak row.
  insert into public.economy_streaks (guild_id, user_id, user_name)
  values (p_guild_id, p_user_id, p_user_name)
  on conflict (guild_id, user_id) do update
    set user_name = coalesce(excluded.user_name, public.economy_streaks.user_name);

  select case when p_kind = 'daily' then daily_last_index else weekly_last_index end
    into last_index
  from public.economy_streaks
  where guild_id = p_guild_id and user_id = p_user_id
  for update;

  -- Already claimed this period — nothing changes.
  if last_index is not null and last_index >= p_period_index then
    select balance into bal from public.economy_users where user_id = p_user_id;
    return query select coalesce(bal, 0::bigint), false; return;
  end if;

  -- Advance the streak state.
  if p_kind = 'daily' then
    update public.economy_streaks
       set daily_last_index = p_period_index,
           daily_streak     = greatest(p_new_streak, 1),
           daily_longest    = greatest(daily_longest, p_new_streak),
           user_name        = coalesce(p_user_name, user_name),
           updated_at       = now()
     where guild_id = p_guild_id and user_id = p_user_id;
  else
    update public.economy_streaks
       set weekly_last_index = p_period_index,
           weekly_streak     = greatest(p_new_streak, 1),
           weekly_longest    = greatest(weekly_longest, p_new_streak),
           user_name         = coalesce(p_user_name, user_name),
           updated_at        = now()
     where guild_id = p_guild_id and user_id = p_user_id;
  end if;

  -- Credit the coins + write the ledger row (mirrors economy_adjust).
  insert into public.economy_users (user_id, user_name)
  values (p_user_id, p_user_name)
  on conflict (user_id) do update
    set user_name = coalesce(excluded.user_name, public.economy_users.user_name);

  update public.economy_users
     set balance         = balance + greatest(p_amount, 0),
         lifetime_earned = lifetime_earned + greatest(p_amount, 0),
         updated_at      = now()
   where user_id = p_user_id
  returning balance into bal;

  insert into public.economy_transactions
    (user_id, user_name, guild_id, guild_name, amount, balance_after, kind, reason, note)
  values
    (p_user_id, p_user_name, p_guild_id, p_guild_name, greatest(p_amount, 0), bal,
     'reward', coalesce(p_reason, p_kind),
     case when greatest(p_new_streak, 1) > 1 then 'Streak: ' || p_new_streak else null end);

  return query select bal, true;
end;
$$;

grant execute on function public.economy_claim_streak(text, text, text, text, bigint, integer, bigint, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------
-- Realtime: the bot's reward-config cache subscribes to economy_reward_settings
-- so dashboard edits take effect immediately (same pattern as leveling_settings).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'economy_reward_settings'
  ) then
    execute 'alter publication supabase_realtime add table public.economy_reward_settings';
  end if;
end $$;

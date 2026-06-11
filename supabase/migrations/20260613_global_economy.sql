-- ============================================================
-- Pulsify — Global Economy & Reputation (PULSIFY-45)
--
-- Two distinct ideas:
--   • BALANCE (Pulse Coins) — a brand-new GLOBAL currency, one balance per
--     Discord user shared across every server running Pulse. Earned through
--     activity (rides the leveling hooks), level-ups, giveaway wins,
--     milestones and onboarding; spendable and transferable.
--   • REPUTATION — the EXISTING 0-100 trust score (lib/reputation.ts /
--     pulse-bot/src/reputation.js) made GLOBAL. It stays computed-on-the-fly
--     (never stored, never "granted"): the only change is that its inputs are
--     now aggregated across ALL guilds instead of one — see
--     get_global_member_reputation below.
--
-- So this migration owns only the COIN economy tables/RPCs plus the global
-- reputation aggregation function. Levels & XP stay per-guild (member_levels).
--
-- Coin mutations go through atomic RPCs that write the ledger in the same
-- transaction, so concurrent awards can't lose updates and the balance always
-- matches its history.
--
-- NOTE: this feature is unreleased — the drops at the top make the migration
-- safely re-runnable on a dev database that ran an earlier draft (which had a
-- stored points-based reputation). They are no-ops on a fresh database.
-- ============================================================

-- ── Clean up an earlier draft (dev re-run safety; no-ops when fresh) ──────────
drop table if exists public.economy_reputation_events cascade;
drop function if exists public.economy_adjust_reputation(text, text, bigint, text, text, text, text, text, text);
-- economy_totals' return shape changed (dropped total_reputation), so the old
-- function must be dropped before recreation.
drop function if exists public.economy_totals();
alter table if exists public.economy_users drop column if exists reputation;
alter table if exists public.economy_users drop column if exists reputation_earned;
drop index if exists public.economy_users_reputation;

-- ── Coin wallets ─────────────────────────────────────────────────────────────

create table if not exists public.economy_users (
  user_id            text        primary key,
  user_name          text,
  -- Global coin balance. Source of truth; never negative.
  balance            bigint      not null default 0,
  -- Lifetime counters maintained by the RPCs — cheap profile stats +
  -- "top earners" analytics without scanning the ledger.
  lifetime_earned    bigint      not null default 0,
  lifetime_spent     bigint      not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Global leaderboards: richest / most active (≈ lifetime earnings).
create index if not exists economy_users_balance
  on public.economy_users (balance desc);
create index if not exists economy_users_lifetime_earned
  on public.economy_users (lifetime_earned desc);

alter table public.economy_users enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'economy_users'
      and policyname = 'Allow all access to economy_users'
  ) then
    create policy "Allow all access to economy_users"
      on public.economy_users for all using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------

create table if not exists public.economy_transactions (
  id                 bigint      generated always as identity primary key,
  user_id            text        not null,
  user_name          text,
  -- Where the change originated. Null for cross-server/system actions.
  guild_id           text,
  guild_name         text,
  -- Signed: positive = credit, negative = debit.
  amount             bigint      not null,
  balance_after      bigint      not null,
  -- 'earn' | 'spend' | 'transfer_in' | 'transfer_out' | 'reward' |
  -- 'admin_grant' | 'admin_remove'  (shape lives in lib/economy.ts)
  kind               text        not null,
  -- Machine-readable source: 'activity', 'level_up', 'giveaway_win',
  -- 'milestone', 'onboarding', 'transfer', 'admin', ...
  reason             text,
  -- Free-form context (admin justification, transfer note).
  note               text,
  -- Other side of a transfer.
  counterparty_id    text,
  counterparty_name  text,
  -- Who performed an administrative action (dashboard user id).
  actor_id           text,
  actor_name         text,
  created_at         timestamptz not null default now()
);

-- Per-user history, per-guild activity feeds, and global recency scans.
create index if not exists economy_transactions_user
  on public.economy_transactions (user_id, created_at desc);
create index if not exists economy_transactions_guild
  on public.economy_transactions (guild_id, created_at desc);
create index if not exists economy_transactions_created
  on public.economy_transactions (created_at desc);

alter table public.economy_transactions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'economy_transactions'
      and policyname = 'Allow all access to economy_transactions'
  ) then
    create policy "Allow all access to economy_transactions"
      on public.economy_transactions for all using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------
-- Atomic balance change. Earning is on a hot, concurrent path (message +
-- voice tick + command can hit the same user at nearly the same instant) so
-- a JS read-modify-write would lose updates. The UPDATE row-locks the user
-- row, refuses to go below zero (returns NULL → caller reports "insufficient
-- balance"), maintains the lifetime counters and writes the ledger row in the
-- same transaction.
create or replace function public.economy_adjust(
  p_user_id    text,
  p_user_name  text,
  p_amount     bigint,
  p_kind       text,
  p_reason     text,
  p_note       text default null,
  p_guild_id   text default null,
  p_guild_name text default null,
  p_actor_id   text default null,
  p_actor_name text default null
)
returns bigint
language plpgsql
as $$
declare
  new_balance bigint;
begin
  insert into public.economy_users (user_id, user_name)
  values (p_user_id, p_user_name)
  on conflict (user_id) do update
    set user_name = coalesce(excluded.user_name, public.economy_users.user_name);

  update public.economy_users
     set balance         = balance + p_amount,
         lifetime_earned = lifetime_earned + greatest(p_amount, 0),
         lifetime_spent  = lifetime_spent  + greatest(-p_amount, 0),
         updated_at      = now()
   where user_id = p_user_id
     and balance + p_amount >= 0
  returning balance into new_balance;

  if new_balance is null then
    return null; -- insufficient balance — nothing changed, nothing logged
  end if;

  insert into public.economy_transactions
    (user_id, user_name, guild_id, guild_name, amount, balance_after,
     kind, reason, note, actor_id, actor_name)
  values
    (p_user_id, p_user_name, p_guild_id, p_guild_name, p_amount, new_balance,
     p_kind, p_reason, p_note, p_actor_id, p_actor_name);

  return new_balance;
end;
$$;

grant execute on function public.economy_adjust(text, text, bigint, text, text, text, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------
-- Atomic member-to-member transfer (/pay). Locks both user rows in a
-- deterministic order (user_id ascending) so two opposite transfers can't
-- deadlock; debits only if the sender can afford it; writes BOTH ledger rows
-- in the same transaction. Returns the sender's new balance, or NULL if the
-- sender couldn't afford the transfer (nothing changed).
create or replace function public.economy_transfer(
  p_from_id    text,
  p_from_name  text,
  p_to_id      text,
  p_to_name    text,
  p_amount     bigint,
  p_guild_id   text default null,
  p_guild_name text default null,
  p_note       text default null
)
returns bigint
language plpgsql
as $$
declare
  from_balance bigint;
  to_balance   bigint;
begin
  if p_amount is null or p_amount <= 0 or p_from_id = p_to_id then
    return null;
  end if;

  -- Ensure both rows exist, locking in deterministic order.
  insert into public.economy_users (user_id, user_name)
  select u.id, u.name
  from (values (p_from_id, p_from_name), (p_to_id, p_to_name)) as u(id, name)
  order by u.id
  on conflict (user_id) do update
    set user_name = coalesce(excluded.user_name, public.economy_users.user_name);

  -- Lock both rows (ordered) before mutating either side.
  perform 1 from public.economy_users
   where user_id in (p_from_id, p_to_id)
   order by user_id
   for update;

  update public.economy_users
     set balance        = balance - p_amount,
         lifetime_spent = lifetime_spent + p_amount,
         updated_at     = now()
   where user_id = p_from_id
     and balance - p_amount >= 0
  returning balance into from_balance;

  if from_balance is null then
    return null; -- insufficient balance
  end if;

  update public.economy_users
     set balance         = balance + p_amount,
         lifetime_earned = lifetime_earned + p_amount,
         updated_at      = now()
   where user_id = p_to_id
  returning balance into to_balance;

  insert into public.economy_transactions
    (user_id, user_name, guild_id, guild_name, amount, balance_after,
     kind, reason, note, counterparty_id, counterparty_name)
  values
    (p_from_id, p_from_name, p_guild_id, p_guild_name, -p_amount, from_balance,
     'transfer_out', 'transfer', p_note, p_to_id, p_to_name),
    (p_to_id, p_to_name, p_guild_id, p_guild_name, p_amount, to_balance,
     'transfer_in', 'transfer', p_note, p_from_id, p_from_name);

  return from_balance;
end;
$$;

grant execute on function public.economy_transfer(text, text, text, text, bigint, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------
-- Whole-economy totals for the dashboard Overview (PostgREST can't aggregate
-- without a function). One cheap scan over economy_users.
create or replace function public.economy_totals()
returns table (
  circulation  bigint,
  user_count   bigint
)
language sql
stable
as $$
  select
    coalesce(sum(balance), 0)::bigint,
    count(*)::bigint
  from public.economy_users;
$$;

grant execute on function public.economy_totals() to anon, authenticated;

-- ---------------------------------------------------------------
-- GLOBAL reputation inputs. The 0-100 trust score (lib/reputation.ts) is the
-- existing per-guild scoring made global: this aggregates a single member's
-- activity + infractions across EVERY guild so the score reflects the whole
-- Pulse network rather than one server. The caller (web member-profile route,
-- bot /profile + /wallet) adds account age (from the snowflake) and runs the
-- shared computeReputation() — nothing about the score is stored, matching the
-- existing "computed on the fly" design.
--
--   • activity (messages/commands/voice/channels) and first_seen aggregate
--     naturally across guilds.
--   • tenure = days since first_seen (time active in the Pulse network).
--   • assignable roles are per-guild and live-from-Discord, so they're omitted
--     from the global score (a minor 5-pt factor) — the caller passes 0.
create or replace function public.get_global_member_reputation(
  p_user_id text
)
returns table (
  message_count   bigint,
  command_count   bigint,
  active_channels bigint,
  voice_seconds   bigint,
  warnings        bigint,
  timeouts        bigint,
  kicks           bigint,
  bans            bigint,
  first_seen      timestamptz
)
language sql
stable
as $$
  select
    (select count(*) from public.analytics_events e
       where e.user_id = p_user_id and e.event_type = 'message'),
    (select count(*) from public.analytics_events e
       where e.user_id = p_user_id and e.event_type = 'command'),
    (select count(distinct e.channel_id) from public.analytics_events e
       where e.user_id = p_user_id and e.event_type = 'message' and e.channel_id is not null),
    coalesce((select sum(v.duration_seconds) from public.voice_sessions v
       where v.user_id = p_user_id), 0),
    (select count(*) from public.guild_warnings w
       where w.user_id = p_user_id and w.active),
    (select count(*) from public.moderation_logs m
       where m.target_user_id = p_user_id and m.action = 'timeout'),
    (select count(*) from public.moderation_logs m
       where m.target_user_id = p_user_id and m.action = 'kick'),
    (select count(*) from public.moderation_logs m
       where m.target_user_id = p_user_id and m.action = 'ban'),
    (select min(e.created_at) from public.analytics_events e
       where e.user_id = p_user_id);
$$;

grant execute on function public.get_global_member_reputation(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Batched variant for leaderboards: the same global reputation inputs for a
-- set of members in one round-trip (the single-user function would be N+1 for
-- a 1000-member board). Grouped scans instead of correlated subqueries; only
-- members with any recorded data come back — callers default the rest to zero.
create or replace function public.get_global_members_reputation(
  p_user_ids text[]
)
returns table (
  user_id         text,
  message_count   bigint,
  command_count   bigint,
  active_channels bigint,
  voice_seconds   bigint,
  warnings        bigint,
  timeouts        bigint,
  kicks           bigint,
  bans            bigint,
  first_seen      timestamptz
)
language sql
stable
as $$
  with ids as (
    select distinct unnest(p_user_ids) as uid
  ),
  activity as (
    select e.user_id as uid,
           count(*) filter (where e.event_type = 'message')                          as msgs,
           count(*) filter (where e.event_type = 'command')                          as cmds,
           count(distinct e.channel_id) filter
             (where e.event_type = 'message' and e.channel_id is not null)           as chans,
           min(e.created_at)                                                          as first_seen
    from public.analytics_events e
    where e.user_id = any(p_user_ids)
    group by e.user_id
  ),
  voice as (
    select v.user_id as uid, coalesce(sum(v.duration_seconds), 0) as secs
    from public.voice_sessions v
    where v.user_id = any(p_user_ids)
    group by v.user_id
  ),
  warns as (
    select w.user_id as uid, count(*) as n
    from public.guild_warnings w
    where w.user_id = any(p_user_ids) and w.active
    group by w.user_id
  ),
  modlog as (
    select m.target_user_id as uid,
           count(*) filter (where m.action = 'timeout') as timeouts,
           count(*) filter (where m.action = 'kick')    as kicks,
           count(*) filter (where m.action = 'ban')     as bans
    from public.moderation_logs m
    where m.target_user_id = any(p_user_ids)
    group by m.target_user_id
  )
  select
    ids.uid,
    coalesce(a.msgs, 0),
    coalesce(a.cmds, 0),
    coalesce(a.chans, 0),
    coalesce(v.secs, 0)::bigint,
    coalesce(w.n, 0),
    coalesce(ml.timeouts, 0),
    coalesce(ml.kicks, 0),
    coalesce(ml.bans, 0),
    a.first_seen
  from ids
  left join activity a on a.uid = ids.uid
  left join voice    v on v.uid = ids.uid
  left join warns    w on w.uid = ids.uid
  left join modlog  ml on ml.uid = ids.uid;
$$;

grant execute on function public.get_global_members_reputation(text[]) to anon, authenticated;

-- ---------------------------------------------------------------
-- Per-guild progression totals for the Workspaces views: how far each
-- server's LOCAL ladder has been climbed (tracked members, XP, top level) so
-- multi-server workspaces can show server-specific progression next to the
-- global economy numbers. One grouped scan over member_levels.
create or replace function public.get_guild_progression_totals(
  p_guild_ids text[]
)
returns table (
  guild_id  text,
  tracked   bigint,
  total_xp  bigint,
  top_level bigint
)
language sql
stable
as $$
  select ml.guild_id,
         count(*)::bigint,
         coalesce(sum(ml.xp), 0)::bigint,
         coalesce(max(ml.level), 0)::bigint
  from public.member_levels ml
  where ml.guild_id = any(p_guild_ids)
  group by ml.guild_id;
$$;

grant execute on function public.get_guild_progression_totals(text[]) to anon, authenticated;

-- ---------------------------------------------------------------
-- Realtime: the dashboard's economy view and member profiles update live as
-- members earn and spend across servers.
do $$
declare
  t text;
begin
  foreach t in array array['economy_users', 'economy_transactions']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

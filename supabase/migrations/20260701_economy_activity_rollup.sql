-- Economy ledger: roll activity earnings up per day
--
-- WHY. Message and voice earnings are high-frequency by design (a coin per
-- message, a coin per voice tick) and every award wrote its own ledger row —
-- two servers produced ~40k rows in a month, almost all of them "+1 voice".
-- The ledger is meant to be read by humans and charted; a row per message is
-- neither. From here, the rate-limited activity sources (message, voice,
-- command, reaction) collapse into ONE row per member, per server, per source,
-- per UTC day, which the next award tops up.
--
-- Balances are unaffected: economy_users.balance / lifetime_earned are updated
-- exactly as before, so nobody's wallet changes by a single coin. Only how the
-- earning is WRITTEN DOWN changes.
--
-- Reading a rolled-up row:
--   amount        — everything earned from that source, that day
--   rollup_count  — how many awards are folded into it
--   balance_after — the balance after the most recent of those awards
--   created_at    — when the most recent of them landed

-- ── Columns + the uniqueness the upsert needs ────────────────────────────────

alter table public.economy_transactions
  add column if not exists rollup_day date;

alter table public.economy_transactions
  add column if not exists rollup_count integer;

comment on column public.economy_transactions.rollup_day is
  'UTC day this row aggregates (null = a one-off event row, logged individually).';
comment on column public.economy_transactions.rollup_count is
  'How many individual awards are folded into this row (null for one-off rows).';

-- Partial: only rolled-up rows are unique per (member, guild, source, day) —
-- one-off rows (rollup_day null) stay unconstrained.
create unique index if not exists economy_transactions_rollup
  on public.economy_transactions (user_id, guild_id, reason, rollup_day)
  where rollup_day is not null;

-- ── Compact the history that already piled up ────────────────────────────────
--
-- One-time: fold the existing per-event activity rows into the same daily
-- shape. This only rewrites the LEDGER — balances live in economy_users and are
-- not touched — but it is not reversible, which is the point: it is what
-- reclaims the rows that prompted this migration.

do $$
declare
  compacted integer;
  removed   integer;
begin
  create temp table economy_rollup_seed on commit drop as
  select
    user_id,
    guild_id,
    reason,
    (created_at at time zone 'utc')::date            as rollup_day,
    max(user_name)                                   as user_name,
    max(guild_name)                                  as guild_name,
    sum(amount)                                      as amount,
    count(*)::int                                    as rollup_count,
    max(created_at)                                  as created_at,
    (array_agg(balance_after order by created_at desc, id desc))[1] as balance_after,
    (array_agg(kind order by created_at desc, id desc))[1]          as kind
  from public.economy_transactions
  where rollup_day is null
    and reason in ('activity_message', 'activity_voice', 'activity_command', 'activity_reaction')
  group by user_id, guild_id, reason, (created_at at time zone 'utc')::date
  having count(*) > 0;

  select count(*) into compacted from economy_rollup_seed;
  if compacted = 0 then
    return;
  end if;

  delete from public.economy_transactions
   where rollup_day is null
     and reason in ('activity_message', 'activity_voice', 'activity_command', 'activity_reaction');
  get diagnostics removed = row_count;

  insert into public.economy_transactions
    (user_id, user_name, guild_id, guild_name, amount, balance_after,
     kind, reason, rollup_day, rollup_count, created_at)
  select
    user_id, user_name, guild_id, guild_name, amount, balance_after,
    kind, reason, rollup_day, rollup_count, created_at
  from economy_rollup_seed;

  raise notice 'economy ledger compacted: % activity rows -> % daily rows', removed, compacted;
end $$;

-- ── The upserting sibling of economy_adjust ──────────────────────────────────
--
-- Same balance maths as economy_adjust (row-locked UPDATE, refuses to go below
-- zero, maintains the lifetime counters); the difference is the ledger write,
-- which tops up the day's row instead of appending a new one. Kept as its own
-- function rather than a flag on economy_adjust so the hot path stays a single
-- statement and the callers read as what they are.

create or replace function public.economy_adjust_daily(
  p_user_id    text,
  p_user_name  text,
  p_amount     bigint,
  p_kind       text,
  p_reason     text,
  p_guild_id   text default null,
  p_guild_name text default null
)
returns bigint
language plpgsql
as $$
declare
  new_balance bigint;
  v_day       date := (now() at time zone 'utc')::date;
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
     kind, reason, rollup_day, rollup_count)
  values
    (p_user_id, p_user_name, p_guild_id, p_guild_name, p_amount, new_balance,
     p_kind, p_reason, v_day, 1)
  on conflict (user_id, guild_id, reason, rollup_day) where rollup_day is not null
  do update set
    amount        = public.economy_transactions.amount + excluded.amount,
    -- The row now reports the balance after the LATEST award of the day, and
    -- sorts by it, so the ledger still reads newest-first.
    balance_after = excluded.balance_after,
    rollup_count  = coalesce(public.economy_transactions.rollup_count, 1) + 1,
    user_name     = coalesce(excluded.user_name, public.economy_transactions.user_name),
    guild_name    = coalesce(excluded.guild_name, public.economy_transactions.guild_name),
    created_at    = now();

  return new_balance;
end;
$$;

grant execute on function public.economy_adjust_daily(text, text, bigint, text, text, text, text)
  to anon, authenticated;

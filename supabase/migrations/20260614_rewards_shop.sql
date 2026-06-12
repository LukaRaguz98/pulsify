-- ============================================================
-- Pulsify — Global Rewards Shop & Marketplace (PULSIFY-46) — FULL migration
--
-- Single, self-contained, idempotent migration for the whole shop feature
-- (consolidated from the original 20260614 + 20260615 + 20260616 so production
-- runs ONE file). Safe to re-run on a dev database that applied earlier drafts.
--
-- The first real SINK for the global Pulse Coin economy (PULSIFY-45). Members
-- spend their GLOBAL balance on rewards; server admins author rewards for their
-- community, and the Pulsify operator authors a small GLOBAL catalogue (badges /
-- cosmetics shown everywhere).
--
--   • shop_rewards      — reward DEFINITIONS. scope='server' (guild_id set) or
--                         scope='global' (guild_id null, operator-managed).
--   • reward_purchases  — one row per purchase; doubles as the INVENTORY item.
--                         Carries a snapshot of the reward so deleting a reward
--                         never loses purchase history.
--
-- Purchases go through the atomic economy_purchase() RPC: it debits the balance,
-- decrements stock and writes BOTH the coin-ledger row (economy_transactions)
-- and the inventory row in one transaction — same race-safety guarantees as
-- economy_adjust()/economy_transfer() in 20260613_global_economy.sql. Coin cost
-- is read from the LOCKED reward row (never trusted from the client). Computed
-- requirements (reputation / level / achievements) are checked in the API route
-- before the RPC; balance / stock / per-user limits are enforced atomically here.
--
-- Five reward types: role | xp_booster | giveaway_entry | perk | cosmetic
-- (shape + meta in lib/shop.ts; mirrored in pulse-bot/src/shop.js).
--
-- NOTE: unreleased feature — the drops at the top keep the migration re-runnable
-- on a dev database that ran an earlier draft. No-ops on a fresh database.
-- ============================================================

drop function if exists public.economy_purchase(text, text, uuid, text, text, jsonb, timestamptz, text, text);
drop function if exists public.economy_refund_purchase(uuid, text, text);

-- ── Reward definitions ───────────────────────────────────────────────────────

create table if not exists public.shop_rewards (
  id               uuid        primary key default gen_random_uuid(),
  -- 'server' (guild_id set) | 'global' (guild_id null, operator-managed).
  scope            text        not null default 'server',
  guild_id         text,
  -- 'role' | 'xp_booster' | 'giveaway_entry' | 'perk' | 'cosmetic'
  -- (shape + meta live in lib/shop.ts)
  category         text        not null,
  name             text        not null,
  description      text,
  -- Price in Pulse Coins (global currency). Never negative.
  cost             bigint      not null default 0,
  -- Stock: null = unlimited. stock_remaining is decremented per purchase.
  stock            integer,
  stock_remaining  integer,
  -- Max copies one member may own (null = no limit).
  per_user_limit   integer,
  active           boolean     not null default true,
  featured         boolean     not null default false,
  sort             integer     not null default 0,
  -- Display.
  icon             text,
  color            text,
  image_url        text,
  -- Type-specific config, e.g. { "role_id": "...", "duration_days": 30 },
  -- { "multiplier": 2, "duration_hours": 24 }, { "entries": 5 },
  -- { "effect": "badge"|"corner_hud", "cosmetic_key": "..." },
  -- { "instructions": "...", "channel_id": "..." }.
  payload          jsonb       not null default '{}'::jsonb,
  -- Purchase gates: { "min_reputation": 50, "min_level": 10,
  --                   "achievement_ids": ["<milestone-id>", ...] }.
  requirements     jsonb       not null default '{}'::jsonb,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Server shop reads (a guild's active rewards) + the global catalogue.
create index if not exists shop_rewards_guild
  on public.shop_rewards (guild_id, active, sort);
create index if not exists shop_rewards_scope
  on public.shop_rewards (scope, active);

alter table public.shop_rewards enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shop_rewards'
      and policyname = 'Allow all access to shop_rewards'
  ) then
    create policy "Allow all access to shop_rewards"
      on public.shop_rewards for all using (true) with check (true);
  end if;
end $$;

-- ── Purchases / inventory ────────────────────────────────────────────────────

create table if not exists public.reward_purchases (
  id               uuid        primary key default gen_random_uuid(),
  -- Nullable FK: keep the row (with its snapshot) if the reward is deleted.
  reward_id        uuid        references public.shop_rewards (id) on delete set null,
  -- Frozen copy of the reward at purchase time (name, category, payload, …) so
  -- history + inventory render even after the definition changes or is removed.
  reward_snapshot  jsonb       not null default '{}'::jsonb,
  user_id          text        not null,
  user_name        text,
  -- Where it was bought (server reward → its guild; global reward → the guild
  -- context the member purchased from).
  guild_id         text,
  cost             bigint      not null default 0,
  -- Ledger row this purchase wrote (economy_transactions.id).
  transaction_id   bigint,
  -- 'active' (owned/usable) | 'consumed' | 'expired' | 'refunded'.
  status           text        not null default 'active',
  -- Discord-side state: 'fulfilled' | 'pending' | 'failed' | 'manual'.
  fulfillment      text        not null default 'pending',
  activated_at     timestamptz,
  -- Set for temporary rewards (role/booster); the bot sweep expires these.
  expires_at       timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists reward_purchases_user
  on public.reward_purchases (user_id, created_at desc);
create index if not exists reward_purchases_reward
  on public.reward_purchases (reward_id);
create index if not exists reward_purchases_guild
  on public.reward_purchases (guild_id, created_at desc);
-- Expiry sweep: only active rows with a deadline.
create index if not exists reward_purchases_expiry
  on public.reward_purchases (expires_at)
  where status = 'active' and expires_at is not null;

alter table public.reward_purchases enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reward_purchases'
      and policyname = 'Allow all access to reward_purchases'
  ) then
    create policy "Allow all access to reward_purchases"
      on public.reward_purchases for all using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------
-- Atomic purchase. Locks the reward row, re-checks availability (active, stock,
-- per-user limit) and the buyer's balance, then debits coins, decrements stock
-- and writes the ledger + inventory rows in one transaction. The COST is read
-- from the locked reward row so a client can't tamper with the price; the
-- caller passes only presentation/expiry it computed from the reward category.
--
-- Returns one row: (result, balance, purchase_id, cost). `result` is
--   'ok' | 'not_found' | 'inactive' | 'out_of_stock' | 'limit_reached'
--   | 'insufficient_balance'. On any non-'ok' result nothing is written.
create or replace function public.economy_purchase(
  p_user_id         text,
  p_user_name       text,
  p_reward_id       uuid,
  p_guild_id        text,
  p_guild_name      text,
  p_reward_snapshot jsonb,
  p_expires_at      timestamptz,
  p_status          text,
  p_fulfillment     text
)
returns table (
  result      text,
  balance     bigint,
  purchase_id uuid,
  cost        bigint
)
language plpgsql
as $$
-- The RETURNS TABLE out-params (cost, balance) share names with columns we read
-- (shop_rewards.cost, economy_users.balance); prefer the COLUMN on any clash so
-- `select cost from shop_rewards` etc. aren't ambiguous.
#variable_conflict use_column
declare
  r_cost          bigint;
  r_active        boolean;
  r_stock_rem     integer;
  r_per_user      integer;
  owned_count     integer;
  new_balance     bigint;
  tx_id           bigint;
  new_purchase_id uuid;
begin
  -- Lock the reward row for the duration of the transaction.
  select cost, active, stock_remaining, per_user_limit
    into r_cost, r_active, r_stock_rem, r_per_user
  from public.shop_rewards
  where id = p_reward_id
  for update;

  if not found then
    return query select 'not_found'::text, null::bigint, null::uuid, null::bigint;
    return;
  end if;
  if not r_active then
    return query select 'inactive'::text, null::bigint, null::uuid, null::bigint;
    return;
  end if;
  if r_stock_rem is not null and r_stock_rem <= 0 then
    return query select 'out_of_stock'::text, null::bigint, null::uuid, null::bigint;
    return;
  end if;

  if r_per_user is not null then
    select count(*) into owned_count
    from public.reward_purchases
    where reward_id = p_reward_id
      and user_id = p_user_id
      and status <> 'refunded';
    if owned_count >= r_per_user then
      return query select 'limit_reached'::text, null::bigint, null::uuid, null::bigint;
      return;
    end if;
  end if;

  -- Ensure the wallet exists (matches economy_adjust).
  insert into public.economy_users (user_id, user_name)
  values (p_user_id, p_user_name)
  on conflict (user_id) do update
    set user_name = coalesce(excluded.user_name, public.economy_users.user_name);

  -- Debit, refusing to go below zero.
  update public.economy_users
     set balance        = balance - r_cost,
         lifetime_spent = lifetime_spent + r_cost,
         updated_at     = now()
   where user_id = p_user_id
     and balance - r_cost >= 0
  returning balance into new_balance;

  if new_balance is null then
    return query select 'insufficient_balance'::text, null::bigint, null::uuid, null::bigint;
    return;
  end if;

  -- Decrement stock (unlimited rewards leave stock_remaining null untouched).
  if r_stock_rem is not null then
    update public.shop_rewards
       set stock_remaining = stock_remaining - 1,
           updated_at = now()
     where id = p_reward_id;
  end if;

  -- Coin-ledger row (negative = debit), same shape as economy_adjust.
  insert into public.economy_transactions
    (user_id, user_name, guild_id, guild_name, amount, balance_after,
     kind, reason, note)
  values
    (p_user_id, p_user_name, p_guild_id, p_guild_name, -r_cost, new_balance,
     'spend', 'shop', coalesce(p_reward_snapshot->>'name', null))
  returning id into tx_id;

  insert into public.reward_purchases
    (reward_id, reward_snapshot, user_id, user_name, guild_id, cost,
     transaction_id, status, fulfillment, expires_at)
  values
    (p_reward_id, coalesce(p_reward_snapshot, '{}'::jsonb), p_user_id, p_user_name,
     p_guild_id, r_cost, tx_id, coalesce(p_status, 'active'),
     coalesce(p_fulfillment, 'pending'), p_expires_at)
  returning id into new_purchase_id;

  return query select 'ok'::text, new_balance, new_purchase_id, r_cost;
end;
$$;

grant execute on function public.economy_purchase(text, text, uuid, text, text, jsonb, timestamptz, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------
-- Atomic refund. Credits the coins back, restores one unit of stock (if the
-- reward still exists and is stock-limited), flags the purchase 'refunded' and
-- writes a credit ledger row attributed to the actor. Returns (result, balance);
-- result is 'ok' | 'not_found' | 'already_refunded'. Idempotent: a second call
-- on a refunded purchase is a no-op.
create or replace function public.economy_refund_purchase(
  p_purchase_id text,
  p_actor_id    text default null,
  p_actor_name  text default null
)
returns table (
  result  text,
  balance bigint
)
language plpgsql
as $$
#variable_conflict use_column
declare
  p_id         uuid := p_purchase_id::uuid;
  p_user       text;
  p_user_name  text;
  p_guild      text;
  p_cost       bigint;
  p_reward     uuid;
  p_status     text;
  new_balance  bigint;
begin
  select user_id, user_name, guild_id, cost, reward_id, status
    into p_user, p_user_name, p_guild, p_cost, p_reward, p_status
  from public.reward_purchases
  where id = p_id
  for update;

  if not found then
    return query select 'not_found'::text, null::bigint;
    return;
  end if;
  if p_status = 'refunded' then
    return query select 'already_refunded'::text, null::bigint;
    return;
  end if;

  -- Credit the coins back; unwind lifetime_spent without going negative.
  update public.economy_users
     set balance        = balance + p_cost,
         lifetime_spent = greatest(0, lifetime_spent - p_cost),
         updated_at     = now()
   where user_id = p_user
  returning balance into new_balance;

  -- Restore stock on the (still-existing, stock-limited) reward.
  if p_reward is not null then
    update public.shop_rewards
       set stock_remaining = stock_remaining + 1,
           updated_at = now()
     where id = p_reward
       and stock_remaining is not null;
  end if;

  update public.reward_purchases
     set status = 'refunded'
   where id = p_id;

  insert into public.economy_transactions
    (user_id, user_name, guild_id, amount, balance_after,
     kind, reason, note, actor_id, actor_name)
  values
    (p_user, p_user_name, p_guild, p_cost, coalesce(new_balance, p_cost),
     'reward', 'refund', 'Purchase refund', p_actor_id, p_actor_name);

  return query select 'ok'::text, new_balance;
end;
$$;

grant execute on function public.economy_refund_purchase(text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------
-- Giveaway weighting (shop "giveaway entries" reward). Draws are one-row-per-
-- member (unique (giveaway_id, user_id)), so bonus entries are modelled as a
-- per-entry WEIGHT: the bot consumes the member's unused giveaway_entry rewards
-- when they next join a giveaway and bumps this weight; the weighted draw
-- (pickWeightedWinners, mirrored giveaways.js ↔ lib/giveaways.ts) expands each
-- entrant by it. Default 1 = a normal single entry, so existing giveaways draw
-- exactly as before.
alter table public.giveaway_entries
  add column if not exists weight integer not null default 1;

-- Per-purchase display toggle for cosmetics. A member turns an owned badge /
-- decoration on or off from their Inventory; disabled cosmetics stop rendering
-- everywhere (profile chips, the Corner HUD). Default true so existing cosmetics
-- stay shown. Only consulted for cosmetic purchases.
alter table public.reward_purchases
  add column if not exists enabled boolean not null default true;

-- ---------------------------------------------------------------
-- Reward-type consolidation. The shop's categories collapsed to 5 (see
-- lib/shop.ts): perk/custom/event → 'perk' (all staff-fulfilled), badge →
-- 'cosmetic'. Remap any rows from an earlier draft (no-op on a fresh database).
update public.shop_rewards set category = 'perk'     where category in ('custom', 'event');
update public.shop_rewards set category = 'cosmetic' where category = 'badge';

-- ---------------------------------------------------------------
-- Default GLOBAL catalogue. Operator-managed cosmetics shown in EVERY server's
-- shop, independent of what each server admin adds. Fixed ids + on-conflict-do-
-- nothing keep this idempotent; an operator can edit/deactivate them in
-- Economy › Controls. The Animated Corner HUD is a paid "prestige" cosmetic
-- (formerly a free Preferences toggle): once owned it unlocks the corner-
-- decoration toggle (payload.effect='corner_hud').
insert into public.shop_rewards
  (id, scope, guild_id, category, name, description,
   cost, stock, stock_remaining, per_user_limit, active, featured, sort,
   icon, color, image_url, payload, requirements)
values
  -- Prestige cosmetic — costs well above ordinary rewards.
  ('00000000-0000-4000-8000-0000000c0601', 'global', null, 'cosmetic',
   'Animated Corner HUD',
   'Sleek animated HUD brackets in your dashboard corners — a prestige flex that travels with your global Pulse identity. Toggle it on in Preferences once owned.',
   7500, null, null, 1, true, true, 0,
   'Crosshair', '#8b5cf6', null,
   '{"effect": "corner_hud", "cosmetic_key": "corner-hud"}'::jsonb, '{}'::jsonb),
  -- Profile badges — passive, render on the Pulse profile everywhere.
  ('00000000-0000-4000-8000-0000000c0602', 'global', null, 'cosmetic',
   'Pulse Pioneer',
   'An early-supporter badge shown on your global Pulse profile across every server.',
   1000, null, null, 1, true, false, 1,
   null, '#f59e0b', null,
   '{"effect": "badge", "cosmetic_key": "pulse-pioneer"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-0000000c0603', 'global', null, 'cosmetic',
   'Coin Collector',
   'A badge for the coin-rich — show off your Pulse-wide economy standing.',
   2000, null, null, 1, true, false, 2,
   null, '#22c55e', null,
   '{"effect": "badge", "cosmetic_key": "coin-collector"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-0000000c0604', 'global', null, 'cosmetic',
   'Night Owl',
   'For the late-night crew — a cool-toned badge on your global profile.',
   1500, null, null, 1, true, false, 3,
   null, '#6366f1', null,
   '{"effect": "badge", "cosmetic_key": "night-owl"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-0000000c0605', 'global', null, 'cosmetic',
   'Trailblazer',
   'A bold badge for members who lead the way in their communities.',
   2500, null, null, 1, true, false, 4,
   null, '#ec4899', null,
   '{"effect": "badge", "cosmetic_key": "trailblazer"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-0000000c0606', 'global', null, 'cosmetic',
   'Community Star',
   'A shining badge for standout members of any Pulse server.',
   3000, null, null, 1, true, false, 5,
   null, '#eab308', null,
   '{"effect": "badge", "cosmetic_key": "community-star"}'::jsonb, '{}'::jsonb),
  ('00000000-0000-4000-8000-0000000c0607', 'global', null, 'cosmetic',
   'Veteran',
   'A prestige badge for the long-haul — worn with pride across every server.',
   5000, null, null, 1, true, false, 6,
   null, '#ef4444', null,
   '{"effect": "badge", "cosmetic_key": "veteran"}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- Realtime: the dashboard Shop / Inventory and the bot's fulfilment worker react
-- live as rewards change and purchases land.
do $$
declare
  t text;
begin
  foreach t in array array['shop_rewards', 'reward_purchases']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

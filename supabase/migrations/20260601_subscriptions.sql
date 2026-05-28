-- ============================================================
-- Pulsify — Pricing Plans, Feature Gating & Stripe Billing (PULSIFY-29)
--
-- Adds the subscription layer. Every signed-in user has at most ONE active
-- subscription that gates premium features across all their servers (the
-- workspace owner pays once; their teams inherit the plan). A user with no
-- row is treated as 'free' in code, so the table only stores paid + once-paid
-- subscribers — we never INSERT a free row, which keeps Stripe IDs honest.
--
-- Like every other Pulsify table these use RLS allow-all and rely on the
-- server-side authorize helpers for real enforcement — keep consistent with
-- the rest of the schema (see 20260530_workspaces.sql).
-- ============================================================

-- ---------------------------------------------------------------
-- subscriptions — one row per user that has ever opened Stripe Checkout.
-- The PRIMARY plan-gating source of truth in the dashboard.
create table if not exists public.subscriptions (
  -- Discord user id (string) — same identifier the rest of the app keys on.
  -- One row per user; reusing the customer over upgrades/downgrades.
  user_id              text        primary key,
  -- Stripe customer + subscription IDs. customer_id persists across plan
  -- changes; subscription_id rotates if the user cancels then resubscribes.
  stripe_customer_id   text        not null,
  stripe_subscription_id text,
  -- Plan slug from lib/billing.ts (free | pro | business | enterprise).
  -- 'free' is theoretically possible but normally a free user has no row.
  plan                 text        not null default 'free',
  -- Stripe subscription.status: active | trialing | past_due | canceled |
  -- incomplete | incomplete_expired | unpaid | paused. We mirror it verbatim
  -- so server-side checks (lib/billing-server.isActive) stay aligned with Stripe.
  status               text        not null default 'active',
  -- monthly | yearly — useful for the billing UI without an extra Stripe round-trip.
  billing_cycle        text        not null default 'monthly',
  -- The next renewal timestamp (Stripe's current_period_end). Shown on the
  -- billing page and used to flag near-expiry / expired subs locally.
  renewal_date         timestamptz,
  -- Whether the user has scheduled a cancellation at period end. Stripe stores
  -- this on the subscription object; mirror it so the dashboard can show
  -- "cancels on …" without round-tripping.
  cancel_at_period_end boolean     not null default false,
  -- Trial end (if any). Null once the trial has ended (or never had one).
  trial_ends_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists subscriptions_customer
  on public.subscriptions (stripe_customer_id);

create index if not exists subscriptions_subscription
  on public.subscriptions (stripe_subscription_id);

alter table public.subscriptions enable row level security;
create policy "Allow all access to subscriptions"
  on public.subscriptions for all using (true) with check (true);

-- ---------------------------------------------------------------
-- subscription_events — append-only audit log of every billing-relevant
-- Stripe webhook we processed. Powers the billing page's "history" section
-- AND doubles as the durable record we need when reconciling missed/replayed
-- webhooks. `event_id` is unique so duplicate deliveries (Stripe retries on
-- 5xx) become no-ops.
create table if not exists public.subscription_events (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text,                         -- nullable: we can receive events before the user row exists
  event_id    text        not null unique,  -- Stripe event.id (evt_…)
  event_type  text        not null,         -- e.g. customer.subscription.updated
  plan        text,
  status      text,
  amount_cents integer,                     -- amount of the invoice if invoice.* event
  currency    text,                         -- ISO 4217 (usd, eur)
  invoice_url text,                         -- Stripe hosted invoice url, if any
  -- Raw event payload, for debugging unexpected shapes without a Stripe trip.
  payload     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists subscription_events_user_time
  on public.subscription_events (user_id, created_at desc);

alter table public.subscription_events enable row level security;
create policy "Allow all access to subscription_events"
  on public.subscription_events for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Realtime: the billing page subscribes so a successful webhook updates the
-- UI without a refresh.
do $$
declare
  t text;
begin
  foreach t in array array['subscriptions', 'subscription_events']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

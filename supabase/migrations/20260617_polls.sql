-- ============================================================
-- Pulsify — Community Polls & Voting (PULSIFY-51)
--
-- Two tables, modelled on the Giveaways system (20260528_giveaways.sql):
--   • polls       — one row per poll: question/description, the poll type +
--     options, the Discord channel + posted message, the schedule
--     (starts_at / ends_at), voting restrictions, governance settings, the
--     denormalised tallies, and the computed result snapshot.
--   • poll_votes  — one row per cast vote (one per chosen option per voter). A
--     unique (poll_id, user_id, option_id) constraint makes a re-vote on the
--     same option idempotent; single-choice polls keep one row per voter by
--     replacing prior votes.
--
-- Like Giveaways, BOTH sides write these tables:
--   • the BOT (pulse-bot/src/polls.js) owns the Discord-native flow — it posts
--     the poll message, handles the vote buttons / select menu, validates the
--     voting restrictions, and on a once-a-minute tick auto-publishes scheduled
--     polls and auto-closes polls when their end time passes (computing the
--     result snapshot + announcing the outcome).
--   • the DASHBOARD (app/dashboard/[guildId]/polls/actions.ts) creates, edits,
--     closes, archives and duplicates polls by talking to the Discord REST API
--     directly (lib/discord.ts).
-- Both subscribe to realtime so each sees the other's work. The poll-type model,
-- restriction evaluation, result computation and the interaction custom_id
-- scheme live in code (lib/polls.ts, mirrored by polls.js) so adding a poll
-- type, restriction or governance rule is never a migration.
-- ============================================================

create table if not exists public.polls (
  id              uuid        primary key default gen_random_uuid(),
  guild_id        text        not null,
  -- Question (headline) + optional body shown in the poll embed.
  title           text        not null,
  description     text,
  -- single | multiple | yes_no | rating | feature
  poll_type       text        not null default 'single',
  -- Options the member chooses from: [{ id, label, emoji? }]. yes_no + rating
  -- generate their options in code; feature/single/multiple carry explicit ones.
  options         jsonb       not null default '[]'::jsonb,
  -- Hide who voted for what (votes still tracked in Pulsify, just not shown).
  anonymous       boolean     not null default false,
  -- Whether a voter may change their vote after casting it.
  allow_change    boolean     not null default true,
  -- Multiple-choice cap (how many options one voter may pick). 1 elsewhere.
  max_choices     integer     not null default 1,
  -- Channel the poll is/was posted in, and the live message id (set once posted).
  channel_id      text        not null,
  message_id      text,
  -- scheduled | active | closed | archived
  status          text        not null default 'active',
  -- Voting gating evaluated by the bot when a member votes:
  --   { required_role_ids: [], required_role_mode: 'any'|'all',
  --     min_account_age_days, min_level, min_reputation }
  requirements    jsonb       not null default '{}'::jsonb,
  -- Community-governance settings:
  --   { weighted, reputation_weighted, approval_threshold, min_participation }
  governance      jsonb       not null default '{}'::jsonb,
  -- Schedule. starts_at null = publish immediately on create. The bot flips a
  -- scheduled poll to active when starts_at passes, and closed when ends_at
  -- passes (computing results). ends_at null = stays open until closed by hand.
  starts_at       timestamptz,
  ends_at         timestamptz,
  -- Denormalised tallies, bumped as votes land so the embed + list can show them
  -- without counting rows every time. poll_votes is the source of truth.
  vote_count      integer     not null default 0,
  voter_count     integer     not null default 0,
  -- Result snapshot computed at close: { options: [{ id, label, votes, pct }],
  -- winner_ids, total_votes, total_voters, approved, participation_met }.
  results         jsonb       not null default '{}'::jsonb,
  -- Who created/hosts the poll (a moderator).
  host_id         text,
  host_name       text,
  -- Set by the dashboard's "Close now" so the bot (which watches this column
  -- over realtime) can close + tally immediately instead of waiting for the tick.
  close_requested_at timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      text
);

create index if not exists polls_guild_created
  on public.polls (guild_id, created_at desc);
create index if not exists polls_guild_status
  on public.polls (guild_id, status, created_at desc);
-- The bot's tick scans polls that still need a lifecycle transition.
create index if not exists polls_pending
  on public.polls (ends_at)
  where status in ('scheduled', 'active');

alter table public.polls enable row level security;

create policy "Allow all access to polls"
  on public.polls for all using (true) with check (true);

-- The bot keeps an in-memory cache of scheduled + active polls and refreshes it
-- the moment the dashboard creates/edits one, so the vote controls work and the
-- schedule fires without a restart.
alter publication supabase_realtime add table public.polls;

-- ---------------------------------------------------------------
-- One row per cast vote. Unique on (poll_id, user_id, option_id) so a repeat
-- click on the same option is a no-op. Single-choice polls keep one row per
-- voter (the bot deletes the prior vote before inserting the new one); multiple
-- choice keeps one row per chosen option.
create table if not exists public.poll_votes (
  id           bigint generated always as identity primary key,
  poll_id      uuid        not null,
  guild_id     text        not null,
  user_id      text        not null,
  user_name    text,
  -- The option chosen. For rating polls this is the rating value ("1".."5").
  option_id    text        not null,
  -- Vote weight (1 normally; >1 under weighted / reputation-weighted governance).
  weight       integer     not null default 1,
  voted_at     timestamptz not null default now(),
  unique (poll_id, user_id, option_id)
);

create index if not exists poll_votes_poll
  on public.poll_votes (poll_id, voted_at);
create index if not exists poll_votes_poll_user
  on public.poll_votes (poll_id, user_id);
create index if not exists poll_votes_guild
  on public.poll_votes (guild_id, voted_at desc);

alter table public.poll_votes enable row level security;

create policy "Allow all access to poll_votes"
  on public.poll_votes for all using (true) with check (true);

-- Realtime: the dashboard's live results + counts update as members vote.
alter publication supabase_realtime add table public.poll_votes;

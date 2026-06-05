-- ============================================================
-- Pulsify — Community Feedback & Testimonials System (PULSIFY-39)
--
-- Turns the landing page's hard-coded "testimonials" into a real, user-driven
-- feedback system. Any signed-in user can leave ONE piece of feedback (a title,
-- a message and a 1–5 star rating), edit or delete it, upvote other people's
-- feedback as "helpful", and report abuse. The landing page then showcases the
-- top-rated entries as live social proof, and a public /feedback page lets
-- anyone browse, search, sort and filter everything.
--
-- Unlike most Pulsify data this is NOT keyed by guild — feedback is about the
-- product, authored by a Discord user, so the only owner key is `user_id`
-- (the Discord user id, resolved server-side via lib/workspace-auth.ts). There
-- is no bot involvement: the dashboard/web app owns every write through the
-- /api/feedback route handlers, gated by the same auth helpers used elsewhere.
--
-- Anti-abuse decisions baked into the schema:
--   • ONE feedback per author        → unique(user_id) on `feedback`. Submitting
--                                       again edits the existing row instead of
--                                       flooding the wall (spam prevention).
--   • ONE vote per (feedback, voter) → primary key on `feedback_votes` makes a
--                                       double-vote a no-op (vote manipulation).
--   • NO self-voting                 → enforced in the route handler (the voter
--                                       can't be the author); see vote/route.ts.
--   • ONE report per (feedback,user) → primary key on `feedback_reports`.
--
-- Denormalised counters (`vote_count`, `report_count`) are kept exact by AFTER
-- triggers on the child tables, so listing/ordering never needs a join or a
-- correlated count. Popularity ranking is derived in code (lib/feedback.ts)
-- from rating + vote_count.
--
-- Like every other Pulsify table these use RLS allow-all and rely on the
-- server-side authorize helpers for real enforcement — keep consistent with the
-- rest of the schema (see 20260530_workspaces.sql). Realtime is enabled so the
-- landing showcase and /feedback page update live as feedback and votes land.
-- ============================================================

-- ---------------------------------------------------------------
-- feedback — one row per author (unique user_id). Stores a snapshot of the
-- author's Discord identity (name / handle / avatar) at submit time so the wall
-- still renders if the user later deletes their account or leaves Discord
-- ("handle deleted users gracefully"). `status` is the moderation/visibility
-- control: visible rows show publicly; operators can hide or remove abusive
-- ones. `vote_count` / `report_count` are trigger-maintained mirrors of the
-- child tables.
create table if not exists public.feedback (
  id            uuid        primary key default gen_random_uuid(),
  -- Discord user id of the author. Unique ⇒ one feedback per person.
  user_id       text        not null unique,
  -- Identity snapshot (display name, @handle, avatar URL) at write time.
  author_name   text,
  author_handle text,
  author_avatar text,
  title         text        not null,
  message       text        not null,
  -- 1–5 stars.
  rating        smallint    not null check (rating between 1 and 5),
  -- visible | hidden | removed. Only 'visible' is shown publicly; 'hidden' is a
  -- soft moderation state (kept for the author), 'removed' is an operator purge.
  status        text        not null default 'visible'
                  check (status in ('visible', 'hidden', 'removed')),
  -- Trigger-maintained counters (see below). Never written by the app directly.
  vote_count    integer     not null default 0,
  report_count  integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists feedback_status_rating
  on public.feedback (status, rating desc, vote_count desc, created_at desc);
create index if not exists feedback_created
  on public.feedback (created_at desc);

alter table public.feedback enable row level security;
create policy "Allow all access to feedback"
  on public.feedback for all using (true) with check (true);

-- ---------------------------------------------------------------
-- feedback_votes — "this was helpful" upvotes. The composite primary key is the
-- anti-manipulation guarantee: a user can vote a given feedback at most once
-- (a re-vote hits the PK and is swallowed as a no-op by the route handler).
create table if not exists public.feedback_votes (
  feedback_id uuid        not null references public.feedback(id) on delete cascade,
  user_id     text        not null,
  created_at  timestamptz not null default now(),
  primary key (feedback_id, user_id)
);

create index if not exists feedback_votes_user on public.feedback_votes (user_id);

alter table public.feedback_votes enable row level security;
create policy "Allow all access to feedback_votes"
  on public.feedback_votes for all using (true) with check (true);

-- ---------------------------------------------------------------
-- feedback_reports — abuse reports. One report per (feedback, reporter). The
-- route handler refuses self-reports; operators read these to decide whether to
-- hide/remove. `report_count` on the parent surfaces "needs review" at a glance.
create table if not exists public.feedback_reports (
  feedback_id uuid        not null references public.feedback(id) on delete cascade,
  user_id     text        not null,
  reason      text,
  created_at  timestamptz not null default now(),
  primary key (feedback_id, user_id)
);

alter table public.feedback_reports enable row level security;
create policy "Allow all access to feedback_reports"
  on public.feedback_reports for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Counter triggers. Keep feedback.vote_count / report_count exact without the
-- app having to read-modify-write (which would race under concurrent votes).
-- bumped via a single SQL statement guarded to never go below zero.
create or replace function public.feedback_bump_vote_count()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.feedback set vote_count = vote_count + 1 where id = new.feedback_id;
  elsif tg_op = 'DELETE' then
    update public.feedback set vote_count = greatest(vote_count - 1, 0) where id = old.feedback_id;
  end if;
  return null;
end;
$$;

create or replace function public.feedback_bump_report_count()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.feedback set report_count = report_count + 1 where id = new.feedback_id;
  elsif tg_op = 'DELETE' then
    update public.feedback set report_count = greatest(report_count - 1, 0) where id = old.feedback_id;
  end if;
  return null;
end;
$$;

drop trigger if exists feedback_votes_count on public.feedback_votes;
create trigger feedback_votes_count
  after insert or delete on public.feedback_votes
  for each row execute function public.feedback_bump_vote_count();

drop trigger if exists feedback_reports_count on public.feedback_reports;
create trigger feedback_reports_count
  after insert or delete on public.feedback_reports
  for each row execute function public.feedback_bump_report_count();

-- ---------------------------------------------------------------
-- Realtime: the landing showcase and the /feedback page subscribe so new
-- feedback and vote changes appear without a refresh.
do $$
declare
  t text;
begin
  foreach t in array array['feedback', 'feedback_votes']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

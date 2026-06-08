-- ============================================================
-- Pulsify — Operator-curated landing testimonials (extends PULSIFY-39)
-- Lets a Pulsify operator hand-pick which feedback entries appear on the
-- landing page (instead of the automatic top-rated three). Additive + nullable
-- so existing rows keep working; when nothing is featured the landing falls
-- back to the previous automatic ranking.
-- ============================================================

-- Operator-pinned to the landing showcase. The app enforces "at most 3
-- featured" in the route handler (operator-only write).
alter table public.feedback
  add column if not exists featured boolean not null default false;

-- When it was featured — drives the order of the curated picks (most-recently
-- featured first).
alter table public.feedback
  add column if not exists featured_at timestamptz;

-- Partial index: the landing query only ever asks for featured rows.
create index if not exists feedback_featured
  on public.feedback (featured_at desc)
  where featured;

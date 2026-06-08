-- ============================================================
-- Pulsify — Pulse Guard: Detection Accuracy & Intelligence (PULSIFY-41)
-- Extends ai_moderation_events with the transparency + feedback columns the
-- intelligence upgrade needs. All additive + nullable so existing rows and the
-- live analyze endpoint keep working without a backfill.
-- ============================================================

-- Structured detection evidence: one entry per contributing signal
-- ({ source, category, label, weight }). Lets the dashboard and Discord alerts
-- explain *why* a message tripped, beyond the free-text `reasoning`.
alter table public.ai_moderation_events
  add column if not exists signals jsonb not null default '[]'::jsonb;

-- Confidence band (low | medium | high) derived from the numeric confidence at
-- detection time. Denormalised so the history view can filter/group on it
-- without re-deriving the band per row.
alter table public.ai_moderation_events
  add column if not exists confidence_label text;

-- Moderator override / feedback: did Pulse Guard get this right?
--   correct   → true positive, feedback for future tuning
--   incorrect → false positive (the moderator overruled the verdict)
--   null      → no feedback recorded yet
alter table public.ai_moderation_events
  add column if not exists moderator_verdict text;          -- correct | incorrect | null
alter table public.ai_moderation_events
  add column if not exists moderator_verdict_by text;       -- reviewer user id
alter table public.ai_moderation_events
  add column if not exists moderator_verdict_at timestamptz;

-- Backfill the confidence band for existing rows so analytics is consistent
-- from day one. Mirrors confidenceLabel() in lib/ai-moderation.ts.
update public.ai_moderation_events
set confidence_label = case
  when confidence >= 0.8  then 'high'
  when confidence >= 0.55 then 'medium'
  else 'low'
end
where confidence_label is null;

-- Index the override column so the "accuracy / override rate" analytics queries
-- (and any future tuning export) stay cheap per guild.
create index if not exists ai_moderation_events_guild_verdict
  on public.ai_moderation_events (guild_id, moderator_verdict, created_at desc);

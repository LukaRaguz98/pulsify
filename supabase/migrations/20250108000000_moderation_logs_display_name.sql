-- ============================================================
-- Pulsify — store both the target's display name and username on
-- moderation log entries so the dashboard can render the same
-- two-line identity used elsewhere (display on top, username
-- below, ID as fallback).
--
-- Existing rows will have target_display_name = NULL; they fall
-- back to target_username (which historically stored whatever the
-- caller passed — usually the display name).
-- ============================================================

alter table public.moderation_logs
  add column if not exists target_display_name text;

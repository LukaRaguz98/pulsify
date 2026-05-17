-- ============================================================
-- Pulsify — notifications: separate actor display name + handle
-- Adds actor_username so the dashboard can render the actor as
-- "Display Name (username)" in detail views without losing either piece.
-- actor_name continues to hold the display name (server nickname → global
-- name → username), actor_username the raw @handle.
-- ============================================================

alter table public.notifications
  add column if not exists actor_username text;

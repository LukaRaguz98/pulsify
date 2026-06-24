-- ============================================================
-- Pulsify — Templates reframed as feature-enablement profiles (PULSIFY-52 polish)
--
-- Server Templates (PULSIFY-36) originally stored a `sections` snapshot of
-- server config (welcome messages, rules, role structures, …) and applied it by
-- writing those settings + creating Discord roles. That has been reframed: a
-- template is now a **Pulsify feature profile** — which app features are turned
-- ON vs OFF (Pulse Guard, DDoS Protection, Tickets, Leveling, …). Applying a
-- template flips each feature's master enable flag; it no longer creates roles
-- or channels.
--
-- This migration adds the `features` jsonb column that holds the on/off map
-- ({ <feature_key>: boolean }). The legacy `sections` column is left in place
-- (nullable, ignored by the new code) so existing rows are not destroyed.
-- ============================================================

alter table public.server_templates
  add column if not exists features jsonb not null default '{}'::jsonb;

-- ============================================================
-- Pulsify — Slash command renames (PULSIFY-61)
--
-- Four commands became two subcommand groups, so their names changed:
--
--   /alt-check           →  /alt check
--   /invites             →  /invite stats
--   /invite-leaderboard  →  /invite leaderboard
--   /invite-rewards      →  /invite rewards
--
-- WHY: Discord forbids a space in a command name — the name regex allows `-`
-- and `_` only — so a subcommand group is the ONLY way to render "/invite
-- leaderboard" as two words. The hyphenated names were the odd ones out:
-- /birthday has grouped its subcommands since PULSIFY-58, and every command
-- group still to come (/role add, /ticket close, /guard status) reads the same
-- way.
--
-- `command_catalog` needs nothing here — the bot prunes rows it no longer
-- defines on its next boot (src/catalog-sync.js), so the four old entries
-- disappear on their own.
--
-- `command_configs` DOES need this. It keys on `command_name`, so without a
-- rename every per-server setting for these four (disabled, cooldown, channel
-- and role allow/deny, ephemeral) would be silently orphaned — the row would
-- sit there matching nothing while the command quietly reverted to catalog
-- defaults. A server that deliberately switched /alt-check OFF would find it
-- back ON with no explanation. That's the failure this migration exists to
-- prevent.
-- ============================================================

-- ── /alt-check → /alt ────────────────────────────────────────────────────────
-- A clean 1:1 rename. Guarded against a config row for `alt` already existing
-- (it shouldn't, but an upsert race or a re-run would violate the primary key
-- and abort the whole migration).
update public.command_configs
   set command_name = 'alt'
 where command_name = 'alt-check'
   and not exists (
     select 1 from public.command_configs c2
      where c2.guild_id = command_configs.guild_id
        and c2.command_name = 'alt'
   );

-- Anything left is a guild that somehow had both — the old row is now
-- redundant, so drop it rather than leave an orphan behind.
delete from public.command_configs where command_name = 'alt-check';

-- ── The invite trio → /invite ────────────────────────────────────────────────
-- Three commands collapse into one, so three config rows collapse into one and
-- something has to give: the group is configured as a single command from here
-- on (an admin can no longer disable the leaderboard while keeping rewards —
-- exactly as they can't disable only /birthday upcoming today).
--
-- `/invites` is promoted, because it's the one members actually run and so the
-- most likely to carry a deliberate setting. The other two are dropped rather
-- than merged: merging would mean inventing a rule for conflicting values
-- ("leaderboard was disabled but rewards wasn't — is /invite disabled?"), and
-- any rule we picked would silently disable or enable something the admin never
-- asked for. Falling back to the catalog default is at least predictable and
-- visible in the Command Center.
update public.command_configs
   set command_name = 'invite'
 where command_name = 'invites'
   and not exists (
     select 1 from public.command_configs c2
      where c2.guild_id = command_configs.guild_id
        and c2.command_name = 'invite'
   );

delete from public.command_configs
 where command_name in ('invites', 'invite-leaderboard', 'invite-rewards');

-- ── command_logs is deliberately NOT rewritten ───────────────────────────────
-- Renaming historical log rows would claim "/alt check ran 500 times" for a
-- period when that name did not exist. command_logs is an append-only record of
-- what was actually invoked, and the honest answer is that /alt-check ran, then
-- /alt check did.
--
-- The visible cost: the Command Center's usage charts join on command_name, so
-- pre-rename usage for these four no longer maps to a catalog entry and drops
-- out of the "most used" list. Historical rows stay queryable; only the chart
-- continuity breaks. If that continuity is worth more than the accuracy, the
-- rewrite is a one-liner per name — but make it a deliberate choice, not a
-- default.

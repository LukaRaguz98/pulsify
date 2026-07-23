// Moderation logging for actions taken from Discord (PULSIFY-61).
//
// One acceptance criterion for the slash-command expansion is that "actions
// executed through Discord are logged identically to dashboard actions". This
// is the bot-side twin of `recordLog` in
// pulsify-web-app/app/dashboard/[guildId]/(management)/moderation/actions.ts —
// same table, same columns, same activity-feed notification, same wording. The
// ONLY difference is `source`, which says where the action came from.
//
// Moderation History, Management Analytics (which attributes actions to staff)
// and the activity feed all read `moderation_logs`, so writing this row is what
// makes a Discord /ban show up everywhere a dashboard ban does. A command that
// performs a moderation action without calling this is a command whose work
// silently vanishes from the dashboard.
//
// Keep ACTION_LABELS in lock-step with the dashboard's copy — the feed renders
// "{moderator} {label} {target}", and a missing entry degrades to the raw
// action slug.
//
// New slugs are safe to add: there's no CHECK constraint on
// `moderation_logs.action`, and lib/management.ts's `modActionKind` falls back
// to 'mod_other' — which still counts as a moderation action in Management
// Analytics, just not in the headline warn/timeout/kick/ban counters. That's the
// right bucket for channel operations.

const { recordNotification } = require("./notifications");

/** The value written to moderation_logs.source for a slash-command action. */
const SOURCE_DISCORD_COMMAND = "Discord Command";

// Mirrors ACTION_LABELS in the dashboard's moderation/actions.ts.
const ACTION_LABELS = {
  ban: "banned",
  unban: "unbanned",
  kick: "kicked",
  timeout: "timed out",
  remove_timeout: "removed timeout from",
  warn: "warned",
  nickname: "set the nickname of",
  add_role: "added a role to",
  remove_role: "removed a role from",
  delete_message: "deleted a message from",
  bulk_delete_messages: "bulk-deleted messages from",
  // Channel operations (PULSIFY-61). These have no target member, so the feed
  // renders "{moderator} {label}" — the phrasing has to stand alone.
  channel_lock: "locked a channel",
  channel_unlock: "unlocked a channel",
  channel_slowmode: "changed a channel's slowmode",
};

/** Severity mapping, matching the dashboard: bans are errors, warns warnings. */
function severityFor(action) {
  if (action === "ban") return "error";
  if (action === "warn") return "warning";
  return "info";
}

/**
 * Record a moderation action performed from a slash command.
 *
 * `moderator` and `target` are `{ id, username, displayName }`. Returns
 * `{ ok }` — best-effort, because the Discord side-effect (the ban, the kick)
 * has usually already happened by the time we're called. Throwing here would
 * tell the moderator their action failed when it didn't; logging loudly and
 * carrying on is the honest failure mode.
 */
async function recordModerationAction(
  supabase,
  { guildId, action, moderator, target, reason, metadata },
) {
  const row = {
    guild_id: guildId,
    action,
    target_user_id: target?.id ?? null,
    target_username: target?.username ?? null,
    target_display_name: target?.displayName ?? null,
    moderator_id: moderator?.id ?? null,
    moderator_username: moderator?.username ?? null,
    reason: reason ?? null,
    metadata: metadata ?? {},
    source: SOURCE_DISCORD_COMMAND,
  };

  try {
    const { error } = await supabase.from("moderation_logs").insert(row);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(
      `[Pulse] moderation_logs insert failed for ${action} in ${guildId}:`,
      err.message,
    );
    return { ok: false, error: err.message };
  }

  // Fire-and-forget feed entry, worded exactly like the dashboard's so the two
  // sources are indistinguishable in the activity feed.
  const actionLabel = ACTION_LABELS[action] ?? String(action).replace(/_/g, " ");
  const targetLabel = target?.displayName ?? target?.username ?? null;
  const who = moderator?.username ?? "Moderator";
  const title = targetLabel
    ? `${who} ${actionLabel} ${targetLabel}`
    : `${who} ${actionLabel}`;

  await recordNotification({
    guildId,
    type: "mod_action",
    severity: severityFor(action),
    title,
    body: reason ?? null,
    link: `/dashboard/${guildId}/moderation`,
    actorId: moderator?.id ?? null,
    actorName: moderator?.username ?? null,
  }).catch(() => {});

  return { ok: true };
}

/**
 * Pull `{ id, username, displayName }` out of a Discord.js member/user for the
 * log row. Accepts either, since a target may not be in the guild (an /unban
 * target, for instance, only ever exists as a User).
 */
function actorFrom(memberOrUser) {
  if (!memberOrUser) return null;
  const user = memberOrUser.user ?? memberOrUser;
  return {
    id: user.id,
    username: user.username ?? null,
    displayName: memberOrUser.displayName ?? user.globalName ?? user.username ?? null,
  };
}

module.exports = {
  SOURCE_DISCORD_COMMAND,
  ACTION_LABELS,
  recordModerationAction,
  actorFrom,
};

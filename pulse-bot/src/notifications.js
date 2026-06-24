// Bot-side notifications: insert into the same `notifications` table that
// powers the dashboard's bell + activity feed. Mirrors the type/category/
// severity maps from pulsify-web-app/lib/notifications.ts — keep these in
// sync when adding new types.

// Match pulsify-web-app/lib/notifications.ts. Keep these maps in lock-step
// so a `type` written from the bot is grouped + colored the same way the
// dashboard already groups + colors its own writes.
const TYPE_TO_CATEGORY = {
  member_join: 'members',
  member_leave: 'members',
  mod_action: 'moderation',
  role_created: 'roles',
  role_updated: 'roles',
  role_deleted: 'roles',
  temp_role_assigned: 'roles',
  temp_role_expiring: 'roles',
  temp_role_expired: 'roles',
  temp_role_extended: 'roles',
  event_created: 'events',
  event_updated: 'events',
  event_deleted: 'events',
  channel_created: 'channels',
  channel_updated: 'channels',
  channel_deleted: 'channels',
  server_settings_changed: 'settings',
  automation_saved: 'automations',
  automation_triggered: 'automations',
  ticket_opened: 'tickets',
  ticket_updated: 'tickets',
  ticket_closed: 'tickets',
  application_submitted: 'tickets',
  application_status_changed: 'tickets',
  giveaway_started: 'giveaways',
  giveaway_ended: 'giveaways',
  giveaway_rerolled: 'giveaways',
  level_up: 'leveling',
  milestone_reached: 'milestones',
  reward_purchased: 'economy',
  security_alert: 'security',
  security_mitigation: 'security',
  security_recovered: 'security',
  bot_warning: 'bot',
  bot_error: 'bot',
};

const TYPE_TO_SEVERITY = {
  member_join: 'success',
  member_leave: 'info',
  mod_action: 'warning',
  role_created: 'success',
  role_updated: 'info',
  role_deleted: 'warning',
  temp_role_assigned: 'success',
  temp_role_expiring: 'warning',
  temp_role_expired: 'info',
  temp_role_extended: 'info',
  event_created: 'success',
  event_updated: 'info',
  event_deleted: 'warning',
  channel_created: 'success',
  channel_updated: 'info',
  channel_deleted: 'warning',
  server_settings_changed: 'info',
  automation_saved: 'info',
  automation_triggered: 'info',
  ticket_opened: 'info',
  ticket_updated: 'info',
  ticket_closed: 'info',
  application_submitted: 'info',
  application_status_changed: 'info',
  giveaway_started: 'success',
  giveaway_ended: 'success',
  giveaway_rerolled: 'info',
  level_up: 'success',
  milestone_reached: 'success',
  reward_purchased: 'success',
  security_alert: 'warning',
  security_mitigation: 'warning',
  security_recovered: 'success',
  bot_warning: 'warning',
  bot_error: 'error',
};

// Best-effort insert. Logs and swallows errors so a Supabase blip never
// breaks the Discord event handler that called us.
//
// `actorName` holds the server display name (nickname → global name → username),
// `actorUsername` holds the raw @handle. The dashboard renders them as
// "Display (username)" in detail views, so always pass both when you have them.
async function recordNotification(supabase, input) {
  try {
    const { error } = await supabase.from('notifications').insert({
      guild_id: input.guildId,
      type: input.type,
      category: TYPE_TO_CATEGORY[input.type],
      severity: input.severity ?? TYPE_TO_SEVERITY[input.type],
      title: (input.title ?? '').slice(0, 200),
      body: input.body ? String(input.body).slice(0, 1000) : null,
      link: input.link ?? null,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      actor_username: input.actorUsername ?? null,
      target_id: input.targetId ?? null,
      target_name: input.targetName ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) console.error('[Pulse] Notification insert failed:', error.message);
  } catch (err) {
    console.error('[Pulse] Notification insert threw:', err.message);
  }
}

// Discord audit-log entries take a moment to appear after the gateway event,
// and clock skew between Discord and us can be a couple of seconds. 30s is
// generous enough to find the matching entry without picking up an unrelated
// older action against the same target.
const ACTOR_LOOKUP_WINDOW_MS = 30_000;

/**
 * Look up who triggered a Discord-side action by scanning the audit log.
 * Returns { actorId, actorName, actorUsername, isBot, reason } or null.
 *
 * `actorName` is the server display name (nickname → global name → username)
 * — pulled from the guild member when available, falls back to the User
 * object when the member isn't cached/fetchable. `actorUsername` is always
 * the raw @handle from the User object.
 *
 * Fails open — if the bot lacks View Audit Log, or Discord throws, the
 * caller gets null and emits a notification without actor attribution
 * rather than skipping the notification entirely.
 *
 * `isBot` is the key signal callers use for dedup: when the actor is the
 * Pulsify bot itself (i.e. a dashboard-initiated action), the dashboard has
 * already inserted a notification, so the gateway handler should skip.
 */
async function fetchActor(guild, auditType, targetId, botId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 5 });
    const cutoff = Date.now() - ACTOR_LOOKUP_WINDOW_MS;
    const entry = [...logs.entries.values()].find((e) => {
      if (targetId && e.target && e.target.id && e.target.id !== targetId) return false;
      return e.createdTimestamp > cutoff;
    });
    if (!entry || !entry.executor) return null;

    const executor = entry.executor;
    const actorUsername = executor.username ?? null;

    // Prefer the guild-scoped display name (nickname → global name → username).
    // member.displayName resolves that fallback chain for us. Best-effort: if
    // the member isn't cached and the fetch fails, fall back to the User's
    // global name.
    let actorName = executor.globalName ?? executor.username ?? null;
    try {
      const member = await guild.members.fetch({ user: executor.id, force: false });
      if (member?.displayName) actorName = member.displayName;
    } catch {
      // Member left the guild, or we can't fetch — keep the User-level fallback.
    }

    return {
      actorId: executor.id,
      actorName,
      actorUsername,
      isBot: botId ? executor.id === botId : false,
      reason: entry.reason ?? null,
    };
  } catch (err) {
    // Most commonly: bot lacks ViewAuditLog. Don't spam logs — return null
    // and let the caller decide whether to skip or emit with no actor info.
    return null;
  }
}

module.exports = { recordNotification, fetchActor };

// Server Timeline writer for the Pulse bot (PULSIFY-63).
//
// The timeline is the server's history book: every significant change, whether
// it was made in the Pulsify dashboard, through a slash command, or directly
// inside Discord, ends up in `timeline_events`. The bot is the half that sees
// Discord-native changes — someone renaming a role in the Discord client,
// timing a member out, changing a nickname — which the dashboard never
// observes.
//
// Mirrors pulsify-web-app/lib/timeline-server.ts. Two ways in:
//
//   1. recordTimelineEvent(supabase, input) — an explicit emit.
//   2. The MIRROR — recordNotification (src/notifications.js) calls
//      mirrorNotificationToTimeline for every notification whose type maps to
//      a timeline event, so the bot's existing notification call sites feed
//      history for free.
//
// Keep EVENT_DEFS and NOTIFICATION_TO_TIMELINE in lock-step with
// pulsify-web-app/lib/timeline.ts (TIMELINE_EVENTS) and
// pulsify-web-app/lib/timeline-server.ts (NOTIFICATION_TO_TIMELINE). The web
// catalog is the fuller one — it also drives labels and filters; this file
// only needs the fields required to write a row.

// event type -> { category, module, severity, targetType }
// Only the events the BOT can emit are listed. The dashboard owns the rest.
const EVENT_DEFS = {
  // Roles
  role_created:             { category: "roles", module: "roles", severity: "success", targetType: "role" },
  role_deleted:             { category: "roles", module: "roles", severity: "warning", targetType: "role" },
  role_renamed:             { category: "roles", module: "roles", severity: "info", targetType: "role" },
  role_permissions_changed: { category: "roles", module: "roles", severity: "warning", targetType: "role" },
  role_updated:             { category: "roles", module: "roles", severity: "info", targetType: "role" },
  role_assigned:            { category: "roles", module: "roles", severity: "info", targetType: "member" },
  role_unassigned:          { category: "roles", module: "roles", severity: "info", targetType: "member" },
  temp_role_granted:        { category: "roles", module: "temporary-roles", severity: "success", targetType: "member" },
  temp_role_extended:       { category: "roles", module: "temporary-roles", severity: "info", targetType: "member" },
  temp_role_expired:        { category: "roles", module: "temporary-roles", severity: "info", targetType: "member" },
  self_role_menu_published: { category: "roles", module: "self-roles", severity: "success", targetType: "role" },

  // Channels
  channel_created:             { category: "channels", module: "channels", severity: "success", targetType: "channel" },
  channel_deleted:             { category: "channels", module: "channels", severity: "warning", targetType: "channel" },
  channel_renamed:             { category: "channels", module: "channels", severity: "info", targetType: "channel" },
  channel_moved:               { category: "channels", module: "channels", severity: "info", targetType: "channel" },
  channel_permissions_changed: { category: "channels", module: "channels", severity: "warning", targetType: "channel" },
  channel_updated:             { category: "channels", module: "channels", severity: "info", targetType: "channel" },
  category_changed:            { category: "channels", module: "channels", severity: "info", targetType: "channel" },
  private_channel_created:     { category: "channels", module: "private-channels", severity: "info", targetType: "channel" },
  statistics_channel_updated:  { category: "channels", module: "statistics-channels", severity: "info", targetType: "channel" },

  // Members
  member_joined:            { category: "members", module: "members", severity: "success", targetType: "member" },
  member_left:              { category: "members", module: "members", severity: "info", targetType: "member" },
  member_banned:            { category: "members", module: "moderation", severity: "critical", targetType: "member" },
  member_unbanned:          { category: "members", module: "moderation", severity: "info", targetType: "member" },
  member_kicked:            { category: "members", module: "moderation", severity: "warning", targetType: "member" },
  member_timeout:           { category: "members", module: "moderation", severity: "warning", targetType: "member" },
  member_timeout_removed:   { category: "members", module: "moderation", severity: "info", targetType: "member" },
  member_nickname_changed:  { category: "members", module: "members", severity: "info", targetType: "member" },
  member_milestone_reached: { category: "members", module: "milestones", severity: "success", targetType: "member" },
  member_birthday:          { category: "members", module: "birthdays", severity: "success", targetType: "member" },
  member_invited:           { category: "members", module: "invites", severity: "info", targetType: "member" },

  // Moderation
  moderation_warning: { category: "moderation", module: "moderation", severity: "warning", targetType: "member" },
  moderation_mute:    { category: "moderation", module: "moderation", severity: "warning", targetType: "member" },
  moderation_action:  { category: "moderation", module: "moderation", severity: "warning", targetType: "member" },
  moderation_note:    { category: "moderation", module: "moderation", severity: "info", targetType: "member" },
  guard_detection:    { category: "moderation", module: "pulse-guard", severity: "warning", targetType: "message" },
  guard_scam:         { category: "moderation", module: "pulse-guard", severity: "critical", targetType: "message" },
  guard_toxic:        { category: "moderation", module: "pulse-guard", severity: "warning", targetType: "message" },
  alt_risk_flagged:   { category: "moderation", module: "alt-detection", severity: "warning", targetType: "member" },
  security_alert:      { category: "moderation", module: "security", severity: "critical", targetType: "server" },
  security_mitigation: { category: "moderation", module: "security", severity: "warning", targetType: "server" },
  security_recovered:  { category: "moderation", module: "security", severity: "success", targetType: "server" },
  ticket_opened:       { category: "moderation", module: "tickets", severity: "info", targetType: "ticket" },
  ticket_closed:       { category: "moderation", module: "tickets", severity: "info", targetType: "ticket" },
  application_submitted:      { category: "moderation", module: "tickets", severity: "info", targetType: "ticket" },
  application_status_changed: { category: "moderation", module: "tickets", severity: "info", targetType: "ticket" },

  // Economy
  economy_balance_milestone:    { category: "economy", module: "economy", severity: "success", targetType: "member" },
  economy_reputation_milestone: { category: "economy", module: "economy", severity: "success", targetType: "member" },
  economy_purchase:             { category: "economy", module: "shop", severity: "info", targetType: "reward" },
  economy_reward_granted:       { category: "economy", module: "economy", severity: "success", targetType: "member" },

  // Automation
  automation_created:   { category: "automation", module: "automations", severity: "success", targetType: "automation" },
  automation_updated:   { category: "automation", module: "automations", severity: "info", targetType: "automation" },
  automation_triggered: { category: "automation", module: "automations", severity: "info", targetType: "automation" },
  automation_disabled:  { category: "automation", module: "automations", severity: "warning", targetType: "automation" },
  scheduled_ran:        { category: "automation", module: "scheduled", severity: "info", targetType: "automation" },

  // Events
  giveaway_started:       { category: "events", module: "giveaways", severity: "success", targetType: "giveaway" },
  giveaway_ended:         { category: "events", module: "giveaways", severity: "info", targetType: "giveaway" },
  giveaway_rerolled:      { category: "events", module: "giveaways", severity: "info", targetType: "giveaway" },
  event_created:          { category: "events", module: "events", severity: "success", targetType: "event" },
  event_updated:          { category: "events", module: "events", severity: "info", targetType: "event" },
  event_deleted:          { category: "events", module: "events", severity: "warning", targetType: "event" },
  poll_published:         { category: "events", module: "polls", severity: "success", targetType: "poll" },
  poll_closed:            { category: "events", module: "polls", severity: "info", targetType: "poll" },
  announcement_published: { category: "events", module: "announcements", severity: "success", targetType: "announcement" },
  announcement_failed:    { category: "events", module: "announcements", severity: "critical", targetType: "announcement" },

  // Configuration
  settings_changed:         { category: "configuration", module: "settings", severity: "info", targetType: "setting" },
  verification_updated:     { category: "configuration", module: "settings", severity: "warning", targetType: "setting" },
  server_profile_updated:   { category: "configuration", module: "settings", severity: "info", targetType: "server" },
  integration_connected:    { category: "configuration", module: "integrations", severity: "success", targetType: "integration" },
  integration_disconnected: { category: "configuration", module: "integrations", severity: "warning", targetType: "integration" },
  integration_error:        { category: "configuration", module: "integrations", severity: "critical", targetType: "integration" },
  backup_created:           { category: "configuration", module: "backups", severity: "success", targetType: "backup" },
  backup_restored:          { category: "configuration", module: "backups", severity: "warning", targetType: "backup" },
  bot_error:                { category: "configuration", module: "bot", severity: "critical", targetType: "server" },
};

// Notification type -> timeline event type. Mirrors the web map, including its
// deliberate omissions (level_up, invite_valid/invalid, ticket_updated,
// bot_warning) — those are per-member noise the history is better without.
const NOTIFICATION_TO_TIMELINE = {
  member_join: "member_joined",
  member_leave: "member_left",
  mod_action: "moderation_action",
  role_created: "role_created",
  role_updated: "role_updated",
  role_deleted: "role_deleted",
  temp_role_assigned: "temp_role_granted",
  temp_role_expired: "temp_role_expired",
  temp_role_extended: "temp_role_extended",
  event_created: "event_created",
  event_updated: "event_updated",
  event_deleted: "event_deleted",
  channel_created: "channel_created",
  channel_updated: "channel_updated",
  channel_deleted: "channel_deleted",
  server_settings_changed: "settings_changed",
  automation_saved: "automation_updated",
  automation_triggered: "automation_triggered",
  ticket_opened: "ticket_opened",
  ticket_closed: "ticket_closed",
  application_submitted: "application_submitted",
  application_status_changed: "application_status_changed",
  giveaway_started: "giveaway_started",
  giveaway_ended: "giveaway_ended",
  giveaway_rerolled: "giveaway_rerolled",
  poll_started: "poll_published",
  poll_closed: "poll_closed",
  announcement_published: "announcement_published",
  announcement_failed: "announcement_failed",
  integration_connected: "integration_connected",
  integration_disconnected: "integration_disconnected",
  integration_error: "integration_error",
  milestone_reached: "member_milestone_reached",
  birthday_today: "member_birthday",
  reward_purchased: "economy_purchase",
  security_alert: "security_alert",
  security_mitigation: "security_mitigation",
  security_recovered: "security_recovered",
  alt_risk_flagged: "alt_risk_flagged",
  invite_joined: "member_invited",
  invite_reward: "economy_reward_granted",
  invite_spike: "security_alert",
  bot_error: "bot_error",
};

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 2000;
const AFFECTED_USERS_MAX = 100;

function buildRow(input) {
  const def = EVENT_DEFS[input.type] ?? {
    category: "configuration",
    module: null,
    severity: "info",
    targetType: null,
  };
  return {
    guild_id: input.guildId,
    category: def.category,
    event_type: input.type,
    module: input.module !== undefined ? input.module : def.module,
    severity: input.severity ?? def.severity,
    // The bot's default source is 'discord' — it exists to witness changes made
    // in the Discord client. Emitters acting on Pulse's own behalf (sweeps,
    // expiries) pass 'bot'; command handlers pass 'command'.
    source: input.source ?? "discord",
    title: String(input.title ?? "").slice(0, TITLE_MAX),
    description: input.description
      ? String(input.description).slice(0, DESCRIPTION_MAX)
      : null,
    actor_id: input.actorId ?? null,
    actor_name: input.actorName ?? null,
    actor_username: input.actorUsername ?? null,
    target_id: input.targetId ?? null,
    target_name: input.targetName ?? null,
    target_type: input.targetType !== undefined ? input.targetType : def.targetType,
    previous_value: input.previousValue ?? null,
    new_value: input.newValue ?? null,
    affected_users: (input.affectedUsers ?? []).slice(0, AFFECTED_USERS_MAX),
    metadata: input.metadata ?? {},
    link: input.link ?? null,
  };
}

/**
 * Insert one timeline event. Best-effort: the timeline is a record, never a
 * dependency — a Supabase blip must not break the gateway handler that called
 * us, so errors are logged and swallowed.
 */
async function recordTimelineEvent(supabase, input) {
  if (!input?.guildId || !input?.type) return;
  try {
    const { error } = await supabase.from("timeline_events").insert(buildRow(input));
    if (error) console.error("[Pulse] Timeline insert failed:", error.message);
  } catch (err) {
    console.error("[Pulse] Timeline insert threw:", err.message);
  }
}

/** Insert several events in one round trip (sweeps that resolve a batch). */
async function recordTimelineEvents(supabase, inputs) {
  const rows = (inputs ?? []).filter((i) => i?.guildId && i?.type).map(buildRow);
  if (rows.length === 0) return;
  try {
    const { error } = await supabase.from("timeline_events").insert(rows);
    if (error) console.error("[Pulse] Timeline batch insert failed:", error.message);
  } catch (err) {
    console.error("[Pulse] Timeline batch insert threw:", err.message);
  }
}

/** The timeline event a notification type mirrors to, or null. */
function timelineTypeForNotification(type) {
  return NOTIFICATION_TO_TIMELINE[type] ?? null;
}

/**
 * Mirror a notification into the timeline, when its type maps to an event.
 * Called by recordNotification, so every existing bot notification feeds the
 * history without touching its call site.
 */
async function mirrorNotificationToTimeline(supabase, input) {
  const type = timelineTypeForNotification(input.type);
  if (!type) return;
  await recordTimelineEvent(supabase, {
    guildId: input.guildId,
    type,
    title: input.title,
    description: input.body ?? null,
    source: input.timelineSource ?? "discord",
    actorId: input.actorId,
    actorName: input.actorName,
    actorUsername: input.actorUsername,
    targetId: input.targetId,
    targetName: input.targetName,
    metadata: input.metadata,
    link: input.link,
  });
}

// ── /timeline command ────────────────────────────────────────────────────────
// The dashboard's Timeline is the full experience — filters, search, diffs,
// exports. This is the "I'm already in Discord and something just changed"
// shortcut: the last handful of events, optionally narrowed to one category or
// one member, with a link to the full view.

const { MessageFlags } = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  editNotice,
  text,
} = require("./commands");
const { getDashboardUrl } = require("./version");

/** How many events /timeline shows. Deliberately small — it's a peek. */
const TIMELINE_SHOWN = 10;

const CATEGORY_LABELS = {
  roles: "Roles",
  channels: "Channels",
  members: "Members",
  moderation: "Moderation",
  economy: "Economy",
  automation: "Automation",
  events: "Events",
  configuration: "Configuration",
};

/** Where the change came from — the detail Discord's own audit log can't give. */
const SOURCE_LABELS = {
  dashboard: "Dashboard",
  discord: "Discord",
  command: "Command",
  bot: "Pulse",
  system: "System",
};

const absTime = (date) => `<t:${Math.floor(date.getTime() / 1000)}:f>`;

function createTimelineCommands(supabase) {
  async function handleTimeline({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const category = interaction.options.getString("category");
    const user = interaction.options.getUser("user");

    let query = supabase
      .from("timeline_events")
      .select("category, event_type, title, description, actor_name, source, created_at")
      .eq("guild_id", guild.id)
      .order("created_at", { ascending: false })
      .limit(TIMELINE_SHOWN);
    if (category) query = query.eq("category", category);
    // Matches events targeting the member plus events that merely touched them.
    // The id is a Discord snowflake from the interaction, so it's safe to
    // interpolate, and the JSON fragment has no comma for PostgREST to split on.
    if (user) query = query.or(`target_id.eq.${user.id},affected_users.cs.[{"id":"${user.id}"}]`);

    const { data, error } = await query;
    if (error) {
      console.error(`[Pulse] /timeline read failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load the history. Try again shortly.");
    }

    const rows = data ?? [];
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("info", colorHex);

    const scope = [
      category ? CATEGORY_LABELS[category] ?? category : null,
      user ? user.username : null,
    ].filter(Boolean);

    const body = [];
    if (rows.length === 0) {
      body.push(
        text(
          scope.length > 0
            ? `Nothing recorded yet for ${scope.join(" — ")}.`
            : "Nothing has been recorded in this server's history yet. It fills up as things change.",
        ),
      );
    } else {
      body.push(
        text(
          rows
            .map((r) => {
              const when = new Date(r.created_at);
              const from = SOURCE_LABELS[r.source] ?? r.source;
              const by = r.actor_name ? ` — by ${r.actor_name}` : "";
              const label = CATEGORY_LABELS[r.category] ?? r.category;
              return `**${r.title}**\n-# ${absTime(when)} — ${label} — ${from}${by}`;
            })
            .join("\n\n"),
        ),
      );
      body.push(
        text(`-# Full history, filters and exports: ${getDashboardUrl(guild.id)}/timeline`),
      );
    }

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: scope.length > 0 ? `History — ${scope.join(" — ")}` : "Server history",
          subtitle: `Pulse — ${guild.name}`,
          body,
          footer: "Pulse — History",
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  return { handleTimeline };
}

module.exports = {
  recordTimelineEvent,
  recordTimelineEvents,
  mirrorNotificationToTimeline,
  timelineTypeForNotification,
  createTimelineCommands,
  EVENT_DEFS,
  NOTIFICATION_TO_TIMELINE,
  CATEGORY_LABELS,
};

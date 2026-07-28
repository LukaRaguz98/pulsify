require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
  Events,
  AuditLogEvent,
  Partials,
} = require("discord.js");

const { createClient } = require("@supabase/supabase-js");
const { createAnalytics } = require("./analytics");
const { recordNotification, fetchActor } = require("./notifications");
const { recordTimelineEvent, createTimelineCommands } = require("./timeline");
const { forwardMessageToPulseGuard } = require("./ai-moderation");
const { COMMANDS_BY_NAME, replyNotice, renderHelp } = require("./commands");
const { getCurrentVersion } = require("./version");
const {
  loadConfigs,
  invalidateConfigs,
  buildGuildCommandBody,
  getAllowedCommands,
  logCommand,
  evaluate,
} = require("./command-center");
const { syncCatalog } = require("./catalog-sync");
const featureGate = require("./feature-gate");
const { createModeration } = require("./moderation");
const { createRoles } = require("./roles");
const { createChannels } = require("./channels");
const { createGuard } = require("./guard");
const { createEvents } = require("./events");
const { createAnnouncements } = require("./announcements");
const { createScheduler } = require("./scheduler");
const { createAnalytics: createServerAnalytics } = require("./analytics-commands");
const { createSettingsCommands } = require("./settings-commands");
const { createTemplates } = require("./template-apply");
const { createCommunityCommands } = require("./community-commands");
const { createTickets } = require("./tickets");
const { createGiveaways } = require("./giveaways");
const { createPolls } = require("./polls");
const { createSecurity } = require("./security");
const { createLeveling } = require("./leveling");
const { createMilestones } = require("./milestones");
const { createPresence } = require("./presence");
const { createIntegrations } = require("./integrations");
const { createOnboarding } = require("./onboarding");
const { createBackups } = require("./backups");
const { createEconomy } = require("./economy");
const { createEconomyRewards } = require("./economy-rewards");
const { createShop } = require("./shop");
const { createPrivateChannels } = require("./private-channels");
const { createTemporaryRoles } = require("./temporary-roles");
const { createSelfRoles } = require("./self-roles");
const { createBirthdays } = require("./birthdays");
const { createAltDetection } = require("./alt-detection");
const { getGuildAccent } = require("./guild-accent");
const { createStatisticsChannels } = require("./statistics-channels");
const { createInvites } = require("./invites");
const { createGaming } = require("./gaming");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

const analytics = createAnalytics(supabase);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    // Invite Tracking (PULSIFY-60): receive InviteCreate/Delete + let the bot
    // fetch each guild's invite list so a join can be attributed to a code.
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    // Required for Events.GuildScheduledEvent* — without it the bot never
    // sees event create/update/delete and our notifications would miss them.
    GatewayIntentBits.GuildScheduledEvents,
    // Reactions-received rewards (PULSIFY-47) need the reaction gateway events.
    GatewayIntentBits.GuildMessageReactions,
    // Gaming Analytics (PULSIFY-64) turns presence transitions into play
    // sessions. PRIVILEGED: this one must also be enabled for the application
    // in the Discord Developer Portal (Bot → Privileged Gateway Intents →
    // Presence Intent), and past 100 guilds it requires Discord's approval.
    // Without it presenceUpdate never fires and the module records nothing.
    GatewayIntentBits.GuildPresences,
  ],
  // Partials so MessageReactionAdd fires for reactions on messages that aren't
  // in the cache (e.g. older messages) — without these the reward never pays.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Constructed after `client` exists — the scheduler captures it to resolve
// guilds and run actions when workflows fire.
const scheduler = createScheduler(client, supabase);

// The ticket system registers its own interaction + message listeners on start
// (it only handles `tkt:` component/modal interactions, never chat-input, so it
// never collides with the slash-command handler below). Constructed after the
// economy rewards engine (below) so resolving a ticket can pay the handler the
// "helpful contribution" reward.

// The global economy (PULSIFY-45) owns the cross-server coin LEDGER (balance,
// transfers, /wallet + /pay) and the computed global reputation read. Earning
// rules moved out to the rewards engine below (PULSIFY-47); this module is now
// purely the ledger primitives every award path calls. Registers no listeners.
const economy = createEconomy(client, supabase);

// Economy Rewards & Earning engine (PULSIFY-47). Turns the fixed PULSIFY-45
// earning rates into a per-guild, configurable system: it owns the reward
// config cache, the anti-abuse state (cooldowns/caps/dedup) and every award
// path, calling economy's ledger primitives. Constructed right after economy so
// leveling/giveaways/milestones/onboarding all receive it and route their coin
// awards through it. Registers a reaction listener (wired below) + its own
// voice tick; the /daily + /weekly commands route through the command handler.
const economyRewards = createEconomyRewards(client, supabase, economy);

// Ticket system (see note above) — passed the rewards engine for the "helpful
// contribution" payout when a ticket is resolved.
const tickets = createTickets(client, supabase, economyRewards);

// The rewards shop (PULSIFY-46) is the spend side of the economy. Purchases
// happen in the dashboard (atomic RPC + REST role grant); this worker owns the
// gateway side: DMing purchase receipts, recording a dashboard notification,
// a sweep that pulls expired timed roles back off members, and the live
// XP-booster registry. Constructed BEFORE leveling so the booster multiplier
// can be handed in (leveling reads it on its hot per-message XP path).
const shop = createShop(client, supabase);

// The leveling system awards XP for member activity, detects level-ups, assigns
// reward roles and announces them. Constructed BEFORE giveaways so it can be
// handed in — a giveaway entry awards XP too. It registers no interaction
// listener (the /rank + /leaderboard slash commands are routed through the
// command handler below); it only runs a once-a-minute voice-XP tick.
// `economy` is passed so every XP award also pays global coins; `shop` so a
// member's active XP booster multiplies their award.
const leveling = createLeveling(client, supabase, economyRewards, shop);

// The giveaway system likewise registers its own interaction listener (only
// `gw:` buttons) plus a once-a-minute lifecycle tick that starts scheduled
// giveaways and draws winners when they end. `leveling` is passed so a Join
// awards engagement XP; `economy` so winners earn global coins + reputation.
const giveaways = createGiveaways(client, supabase, leveling, economyRewards);

// The polls system (PULSIFY-51) registers its own interaction listener (`pv:`
// vote buttons + select menus) plus a once-a-minute lifecycle tick that opens
// scheduled polls and closes + tallies polls when their end time arrives. It
// reads member_levels + computes reputation for level/reputation vote gates.
const polls = createPolls(client, supabase);

// DDoS Protection & Security Monitoring (PULSIFY-52): samples activity
// (commands, component interactions, messages, joins, ticket/giveaway/
// application actions), runs the detection engine against each guild's rules,
// records events, applies + enforces mitigations (lockdown / blocked users /
// paused modules), raises dashboard + Discord alerts, and expires temporary
// mitigations (recovery). Registers its own interaction tap (classifies
// component/modal interactions by custom_id prefix); command/message/join
// samples are fed from the gateway handlers below. Enforcement is read via
// security.checkAllowed() before a command runs.
const security = createSecurity(client, supabase);

// The milestones system recognises members for crossing activity / tenure
// thresholds. Like leveling it owns its table (member_milestones): a periodic
// sweep evaluates members against the dashboard-defined milestones, assigns
// reward roles, announces, and records a notification. It registers no
// interaction listener — /milestones routes through the command handler below,
// and event participation is fed in from the GuildScheduledEventUserAdd handler.
const milestones = createMilestones(client, supabase, economyRewards);

// The presence system owns the bot's global Discord status. It reads the
// "active" guild's presence config (bot_presence_state → guild_presence),
// rotates through that server's activities (resolving dynamic placeholders like
// {servers}/{members}), and honours maintenance mode. Registers no interaction
// listener — just a rotation timer + a realtime watch on both tables.
const presence = createPresence(client, supabase);

// The integrations worker polls every armed connection in the `integrations`
// table once a minute, forwarding new external activity (GitHub pushes, YouTube
// uploads, RSS items, Jira transitions, …) into the configured Discord channel.
// Registers no interaction listener — just a poll tick + a realtime watch so
// dashboard connects/edits/disconnects take effect immediately.
const integrations = createIntegrations(client, supabase);

// Member onboarding (PULSIFY-37): delivers the welcome embed + interactive
// onboarding panel on join and owns completion (self-roles, verify, rewards).
// Registers its own `ob:` interaction listener; posting is driven from
// GuildMemberAdd below. Passed `leveling` so completion XP routes through the
// same atomic RPC the rest of the levelling system uses.
const onboarding = createOnboarding(client, supabase, leveling, economyRewards);

// Server Recovery & Backup System (PULSIFY-42): the dashboard owns manual
// backups + restores; this worker is the WRITER of SCHEDULED backups. An hourly
// tick captures snapshots for every guild whose backup_schedules row is enabled
// and due, then prunes to the retention count. Registers no interaction listener.
const backups = createBackups(client, supabase);

// Private Channels (PULSIFY-50): the "join-to-create" system. Provisions a
// category + trigger voice channel, creates per-member private voice channels
// when they join the trigger, posts an owner control panel, and auto-deletes
// empty channels. Registers its own `pc:` interaction listener; the join/leave
// flow + channel-delete reconciliation are fed in from the gateway handlers below.
const privateChannels = createPrivateChannels(client, supabase);

// Temporary Roles: 60s sweep that removes expired role grants, logs the event
// and (optionally) notifies the member + admins. Dashboard owns assignment.
const temporaryRoles = createTemporaryRoles(client, supabase);

// Self-Assign Roles (PULSIFY-56): registers its own interaction listener for the
// `sr:` role buttons + select menus, toggling a member's roles when they self-
// assign. Dashboard owns the menu lifecycle + the posted message.
const selfRoles = createSelfRoles(client, supabase);

// Statistics Channels (PULSIFY-57): provisions live "counter" channels and keeps
// their names in sync with server stats via realtime + a 10-minute sweep. The
// dashboard owns the config; this module owns every Discord operation.
const statisticsChannels = createStatisticsChannels(client, supabase);

// Birthday System (PULSIFY-58): a 15-minute sweep that, once the configured
// local hour is reached, celebrates members whose birthday is "today" — posting
// the announcement, granting rewards (coins via economy, XP via leveling, custom
// roles) and assigning a temporary birthday role. Members author their own
// birthday; the dashboard owns the per-guild configuration.
const birthdays = createBirthdays(client, supabase, economy, leveling);

// Alt Risk Detection (PULSIFY-59): answers /alt check with an account's risk
// score, the factors behind it and its potential linked accounts, and scores
// every joining account so high/critical ones land in the dashboard's
// investigation queue before a moderator has to go looking for them.
const altDetection = createAltDetection(client, supabase);

// Invite Tracking & Referral System (PULSIFY-60): mirrors each guild's Discord
// invite list, attributes every join to the invite (and inviter) used, scores
// the join against the guild's valid-invite + anti-abuse rules, and reacts to
// leaves/rejoins. Referral REWARDS are Member Milestones with the `invites`
// metric — the milestone sweep grants them against the valid-invite count this
// module maintains. Registers its own InviteCreate/Delete + GuildMember
// add/remove listeners; /invite stats, /invite leaderboard and /invite rewards route
// through the command handler below.
const invites = createInvites(client, supabase);

// Gaming Analytics (PULSIFY-64): turns Discord presence transitions into play
// sessions — open on start, close on stop, close-and-reopen on a switch — and
// reconciles orphaned sessions after a restart. Owns the only writer for
// `gaming_sessions`; the dashboard reads it through aggregate RPCs. Registers
// its own PresenceUpdate listener and enforces privacy (ignored roles/members/
// games, member opt-out) BEFORE inserting, so excluded members leave no rows.
// Requires the privileged GuildPresences intent — see the client above.
const gaming = createGaming(client, supabase);

// Moderation commands (PULSIFY-61): /warn /timeout /untimeout /kick /ban /unban
// /warnings /purge /modlogs. Pure command handlers — no listeners of its own.
// Every action it takes is written to `moderation_logs` with
// source = "Discord Command", so Moderation History, Management Analytics and
// the activity feed see it exactly as they see a dashboard action.
const moderation = createModeration({ client, supabase });

// Role commands (PULSIFY-61): /role add|remove|temp|info|hierarchy and the
// member-facing /selfrole. `temp` writes a `temporary_roles` row and lets the
// existing 60s sweep in temporary-roles.js expire it — it schedules nothing of
// its own. /selfrole points members at the menus self-roles.js already serves.
const roles = createRoles({ client, supabase });

// Channel commands (PULSIFY-61): /channel lock|unlock|slowmode|stats. Pure
// Discord operations plus a read of analytics_events; no listeners.
const channels = createChannels({ client, supabase });

// Pulse Guard commands (PULSIFY-61): /guard status|whitelist|review. A thin
// read/whitelist surface over the ai_moderation_* tables — the detection policy
// stays web-side (src/ai-moderation.js forwards messages to the analyze API).
// First plan-gated command (minPlan "pro"). No listeners.
const guard = createGuard({ client, supabase });

// Event commands (PULSIFY-61): /event list|info|create|cancel. Discord-native
// scheduled events (guild.scheduledEvents) — no table, module null. No listeners
// (the GuildScheduledEvent* gateway handlers already run below).
const events = createEvents({ client, supabase });

// Announcement commands (PULSIFY-61): /announce + /announcements recent. Posts a
// branded announcement embed and records it in the `announcements` table the
// dashboard shares. No listeners.
const announcements = createAnnouncements({ client, supabase });
// NB: /automation list|toggle|run|logs is served by the SCHEDULER (constructed
// above) — it owns the scheduled_automations workflows the commands manage.

// Analytics & Insights commands (PULSIFY-61): /stats, /insights, /management.
// Reads the analytics RPCs + native Discord state and runs the same engines as
// the dashboard (src/insights-engine.js, src/management-engine.js). No listeners.
// Named `serverAnalytics` to avoid colliding with the `analytics` event tracker.
const serverAnalytics = createServerAnalytics({ client, supabase });

// Server Settings & Assets commands (PULSIFY-61): /serversettings, /statchannel,
// /emoji, /sticker, /soundboard. Read-only config/expression views + a stat-
// channel refresh nudge (reuses statisticsChannels.refreshGuild). No listeners.
const settings = createSettingsCommands({ client, supabase, statisticsChannels });

// Templates + community commands (PULSIFY-61): /template apply, /integrations
// status, /notifications preferences, /feedback submit. No listeners. (/backup
// create|list is served by the `backups` module, constructed above.)
const templates = createTemplates({ client, supabase });
const community = createCommunityCommands({ client, supabase });

// Server Timeline (PULSIFY-63): the writer is stateless (recordTimelineEvent
// takes supabase directly, so gateway handlers can call it without plumbing);
// this only serves the /timeline read command.
const timeline = createTimelineCommands(supabase);

/**
 * Shared helper for Discord-side activity → notifications row (+ Server
 * Timeline entry).
 *
 * Fetches the audit log to attribute the action and dedupes against
 * dashboard-initiated activity: when the audit-log executor is the Pulsify
 * bot itself, the dashboard already wrote a notification when it called
 * Discord, so we skip the gateway-side write to avoid duplicates.
 *
 * The notification mirrors into the timeline automatically. Pass
 * `opts.timeline` to emit a RICHER timeline event instead — a precise event
 * type ('role_renamed' rather than 'role_updated') plus the before/after
 * values, which a notification has nowhere to put. The actor resolved from
 * the audit log is carried over either way, so a change made in the Discord
 * client is still attributed to the human who made it.
 */
async function notifyIfNotBot(opts) {
  const actor = await fetchActor(
    opts.guild,
    opts.auditType,
    opts.targetId,
    client.user?.id,
  );
  if (actor && actor.isBot) return;
  await recordNotification(supabase, {
    guildId: opts.guild.id,
    type: opts.type,
    severity: opts.severity,
    title: opts.title,
    body: opts.body ?? actor?.reason ?? null,
    link: opts.link,
    actorId: actor?.actorId ?? null,
    actorName: actor?.actorName ?? null,
    actorUsername: actor?.actorUsername ?? null,
    targetId: opts.targetId,
    targetName: opts.targetName,
    metadata: opts.metadata,
    timeline: opts.timeline ? false : undefined,
  });
  if (opts.timeline) {
    await recordTimelineEvent(supabase, {
      guildId: opts.guild.id,
      source: "discord",
      title: opts.title,
      description: opts.body ?? actor?.reason ?? null,
      actorId: actor?.actorId ?? null,
      actorName: actor?.actorName ?? null,
      actorUsername: actor?.actorUsername ?? null,
      targetId: opts.targetId,
      targetName: opts.targetName,
      metadata: opts.metadata,
      link: opts.link,
      ...opts.timeline,
    });
  }
}

// ── Server Timeline: member removals ────────────────────────────────────────
// A ban, a kick and a voluntary leave all arrive as the same GuildMemberRemove
// event, and the timeline has to tell them apart — "did they leave or were
// they removed" is the first question of most investigations.
//
// Bans are already recorded by GuildBanAdd, which stamps the pair here so the
// accompanying removal doesn't also get logged as a plain leave. Entries are
// short-lived: the two events arrive within moments of each other, and either
// ordering works (the ban handler stamps; the removal handler checks and, if
// it ran first, the stamp simply expires unused).
const RECENT_REMOVALS = new Map(); // `${guildId}:${userId}` -> timestamp
const REMOVAL_CLAIM_TTL_MS = 30_000;

function markRemovalHandled(guildId, userId) {
  RECENT_REMOVALS.set(`${guildId}:${userId}`, Date.now());
  // Opportunistic sweep — this map only ever holds a handful of live keys.
  const cutoff = Date.now() - REMOVAL_CLAIM_TTL_MS;
  for (const [key, at] of RECENT_REMOVALS) {
    if (at < cutoff) RECENT_REMOVALS.delete(key);
  }
}

function removalWasHandled(guildId, userId) {
  const at = RECENT_REMOVALS.get(`${guildId}:${userId}`);
  return at != null && Date.now() - at < REMOVAL_CLAIM_TTL_MS;
}

/**
 * Record a member's departure as either a kick or a leave.
 *
 * Discord writes the audit-log entry slightly after the gateway event, so we
 * wait a beat before looking. Fails open: if the audit log is unreadable (the
 * bot lacks View Audit Log) the departure is recorded as a plain leave rather
 * than not at all.
 */
async function recordMemberRemoval(member) {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  // A ban claims the removal — GuildBanAdd already wrote member_banned.
  if (removalWasHandled(member.guild.id, member.id)) return;

  const kick = await fetchActor(
    member.guild,
    AuditLogEvent.MemberKick,
    member.id,
    client.user?.id,
  );

  if (kick) {
    markRemovalHandled(member.guild.id, member.id);
    await recordTimelineEvent(supabase, {
      guildId: member.guild.id,
      type: "member_kicked",
      title: `${kick.actorName ?? "A moderator"} kicked ${member.user.tag}`,
      description: kick.reason ?? null,
      source: kick.isBot ? "dashboard" : "discord",
      actorId: kick.actorId,
      actorName: kick.actorName,
      actorUsername: kick.actorUsername,
      targetId: member.id,
      targetName: member.user.tag,
      metadata: { action: "kick" },
      link: `/dashboard/${member.guild.id}/moderation`,
    });
    return;
  }

  await recordTimelineEvent(supabase, {
    guildId: member.guild.id,
    type: "member_left",
    title: `${member.user.tag} left the server`,
    targetId: member.id,
    targetName: member.user.tag,
    metadata: { joined_at: member.joinedAt?.toISOString() ?? null },
    link: `/dashboard/${member.guild.id}/members`,
  });
}

// Pins a consistent, comfortable width across Pulse's v2 embeds (U+2800 blanks
// occupy width without being trimmed) — same trick as commands.js WIDTH_SPACER.
const MEMBER_WIDTH_SPACER = `-# ${"⠀".repeat(44)}`;

/**
 * Build a Components V2 container for a member welcome/goodbye embed, following
 * the standardized Pulse v2 style (same as /changelog, announcements and the
 * rules/onboarding blocks): a `**Pulse**` label + `#` title heading, a width
 * spacer for a consistent width, the description/fields body, then a divider and
 * a `-#` footer. `resolve` runs the {user}/{server} placeholder swap on every
 * text field; `footerLabel` ("Welcome"/"Goodbye") brands the fallback footer
 * when the user left footer_text blank. Returns the raw container object — the
 * caller sends it with the IS_COMPONENTS_V2 flag.
 */
function buildMemberV2Container(cfg, resolve, hasBanner, footerLabel, accentInt) {
  // The colour is the GUILD's accent (guild_settings.embed_color, chosen in the
  // dashboard's Server Settings) — the single source of truth for every Pulse
  // embed. `cfg.color` is no longer read here.
  const colorInt = accentInt;
  const components = [{ type: 10, content: "**Pulse**" }];

  const title = resolve(cfg.title ?? "");
  if (title) components.push({ type: 10, content: `# ${title}` });

  // Width spacer to pin a consistent width — skipped when a banner is present,
  // since the full-width image already defines the embed's width.
  if (!hasBanner) components.push({ type: 10, content: MEMBER_WIDTH_SPACER });

  const description = resolve(cfg.description ?? "");
  if (description) components.push({ type: 10, content: description });

  if (Array.isArray(cfg.fields) && cfg.fields.length > 0) {
    const fieldText = cfg.fields
      .filter((f) => f && (f.name || f.value))
      .map((f) => `**${resolve(f.name ?? "")}**\n${resolve(f.value ?? "")}`)
      .join("\n\n");
    if (fieldText) {
      if (description) components.push({ type: 14, divider: true, spacing: 1 });
      components.push({ type: 10, content: fieldText });
    }
  }

  // Banner — MediaGallery (type 12) referencing the attached banner.png.
  if (hasBanner) {
    components.push({
      type: 12,
      items: [{ media: { url: "attachment://banner.png" } }],
    });
  }

  // Divider + footer — the standardized Pulse v2 close. Honour the user's
  // footer_text; fall back to a branded `Pulse — <label>` when it's blank.
  const footer = cfg.footer_text
    ? resolve(cfg.footer_text)
    : `Pulse — ${footerLabel}`;
  components.push({ type: 14, divider: true, spacing: 1 });
  components.push({ type: 10, content: `-# ${footer}` });

  return {
    type: 17,
    accent_color: isNaN(colorInt) ? 0x6366f1 : colorInt,
    components,
  };
}

// Slash commands are defined in ./commands.js (the catalog) and gated per
// server by the Command Center (./command-center.js). Registration only
// publishes the commands a guild has enabled; execution enforces permissions,
// cooldowns and usage limits. Registering uses the guild's saved config:
//
//   registerGuildCommands(rest, appId, guild) — build + PUT the enabled set.
//
// The REST client + bot application id are captured on ready so the realtime
// command_configs listener can re-register a guild when its config changes.
let restClient = null;
let botAppId = null;

async function registerGuildCommands(rest, appId, guild) {
  // force-refresh the config cache so a freshly-saved dashboard change is
  // reflected the moment we (re)register.
  const configMap = await loadConfigs(supabase, guild.id, { force: true });
  const body = buildGuildCommandBody(configMap);
  await rest
    .put(Routes.applicationGuildCommands(appId, guild.id), { body })
    .catch((err) =>
      console.warn(
        `[Pulse] Failed to register commands for guild ${guild.id}:`,
        err.message,
      ),
    );
}

client.once(Events.ClientReady, async (readyClient) => {
  const version = await getCurrentVersion();
  console.log(`[Pulse] Pulse v${version} starting up — logged in as ${readyClient.user.tag}`);

  // Immediate default presence — shown until the presence system (started at
  // the end of this handler) loads the active guild's config and takes over.
  // Also the steady-state presence whenever no guild is driving it.
  readyClient.user.setPresence({
    activities: [{ name: `Powered by Pulsify [${version}]` }],
    status: "online",
  });

  // Per-guild command registration. We wipe the global command list (stale
  // commands take up to an hour to disappear globally) and register each
  // guild's enabled command set — per-guild commands propagate in seconds, so
  // dashboard toggles take effect almost immediately.
  restClient = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  botAppId = readyClient.user.id;
  await restClient.put(Routes.applicationCommands(botAppId), { body: [] });
  console.log("[Pulse] Cleared global slash commands.");

  // Publish the catalog so the dashboard's Command Center lists exactly what
  // this build serves. Awaited before registration so the dashboard never lists
  // a command that isn't registered yet. Best-effort: a failure leaves the
  // previous sync's rows in place (or, on a first-ever boot, an empty Command
  // Center) but never blocks startup — commands still register and run.
  await syncCatalog(supabase);

  for (const guild of readyClient.guilds.cache.values()) {
    await registerGuildCommands(restClient, botAppId, guild);
    await syncGuild(guild);

    // Seed analytics with members already connected to voice channels.
    for (const vs of guild.voiceStates.cache.values()) {
      if (vs.channelId && !vs.member?.user?.bot) {
        analytics.voiceJoin(
          guild.id,
          vs.id,
          vs.member?.user?.username,
          vs.channelId,
          vs.channel?.name,
        );
      }
    }
  }

  // Remove stale synced_guilds entries for servers the bot is no longer in
  const currentIds = [...readyClient.guilds.cache.keys()];
  const { data: stored } = await supabase
    .from("synced_guilds")
    .select("guild_id");
  const stale = (stored ?? []).filter((r) => !currentIds.includes(r.guild_id));
  if (stale.length > 0) {
    await supabase
      .from("synced_guilds")
      .delete()
      .in(
        "guild_id",
        stale.map((r) => r.guild_id),
      );
    console.log(
      `[Pulse] Removed ${stale.length} stale guild(s) from synced_guilds.`,
    );
  }

  // Live config sync: when an admin changes a command in the dashboard, drop
  // our cached config for that guild and re-register its command set so the
  // change reflects in Discord within seconds (not just at the next restart).
  supabase
    .channel("command-configs")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "command_configs" },
      async (payload) => {
        const guildId = payload.new?.guild_id ?? payload.old?.guild_id;
        if (!guildId) return;
        invalidateConfigs(guildId);
        const guild = readyClient.guilds.cache.get(guildId);
        if (guild && restClient) {
          await registerGuildCommands(restClient, botAppId, guild);
          console.log(`[Pulse] Re-registered commands for guild ${guildId} after config change.`);
        }
      },
    )
    .subscribe();

  // Scheduled Automations: load saved workflows, watch for edits + "Run now"
  // requests over realtime, and fire due workflows once a minute.
  await scheduler.start();

  // Ticket system: load per-guild config + open tickets, subscribe to realtime,
  // wire up panel/control interactions and the inactivity auto-close scan.
  await tickets.start();

  // Giveaway system: load live giveaways, subscribe to realtime (Join button +
  // dashboard draw/reroll requests), and run the start/end lifecycle tick.
  await giveaways.start();

  // Polls system: load live polls, subscribe to realtime (vote buttons/menus +
  // dashboard close requests), and run the open/close lifecycle tick.
  await polls.start();

  // DDoS Protection: load per-guild security config + active mitigations,
  // subscribe to realtime, register the interaction classifier, and start the
  // recovery sweep.
  await security.start();

  // Leveling system: load per-guild XP config, subscribe to settings changes,
  // and start the voice-XP tick.
  await leveling.start();

  // Global economy: register the /leaderboard component listener
  // (select-menu switching + pagination). Coin ledger reads/writes need no
  // startup — this only wires the interactive controls (PULSIFY-49).
  economy.start();

  // Economy rewards engine: load per-guild reward config, subscribe to changes,
  // and start the voice-coins tick (PULSIFY-47).
  await economyRewards.start();

  // Milestones system: load per-guild milestone definitions, subscribe to
  // changes, and start the recognition sweep.
  await milestones.start();

  // Rewards shop: subscribe to new purchases (receipt DM + notification) and
  // start the timed-reward expiry sweep.
  await shop.start();

  // Presence system: take over the bot's global status from the static default
  // set above. Loads the active guild's config and starts the rotation; if no
  // guild is active it leaves the default "Powered by Pulsify" in place.
  await presence.start();

  // Integrations worker: load connected integrations, watch for dashboard
  // changes over realtime, and poll each armed connection once a minute.
  await integrations.start();

  // Onboarding: register the `ob:` interaction listener for the member panel.
  onboarding.start();

  // Backup system: start the hourly scheduled-backup tick (no-op for guilds
  // without an enabled schedule).
  await backups.start();

  // Private Channels: load config, provision categories/triggers for enabled
  // guilds, register the `pc:` listener, and start the empty-channel sweep.
  await privateChannels.start();

  // Temporary Roles: start the expiry sweep (removes lapsed grants, warns on
  // ones expiring within 24h).
  await temporaryRoles.start();

  // Self-Assign Roles: load active menus into cache, subscribe to changes and
  // register the `sr:` button/select listener.
  await selfRoles.start();

  // Statistics Channels: subscribe to config changes, provision channels for
  // enabled rows, and start the 10-minute value-sync sweep.
  await statisticsChannels.start();

  // Birthdays: load per-guild config into cache, subscribe to changes and start
  // the daily celebration sweep.
  await birthdays.start();

  // Alt detection: listen for joins so risky accounts are scored on arrival.
  altDetection.start();

  // Invite tracking: prime the invite cache, attribute joins, grant referral
  // rewards. Registers its own invite + member listeners.
  await invites.start();

  // Gaming analytics: load config + opt-outs, listen to presence, then (after a
  // delay, once the presence cache has populated) reconcile any sessions left
  // open by the previous run and start the stale-session sweep.
  await gaming.start();

  // Startup banner — a clear, scannable success summary so an operator can
  // confirm at a glance which version is live, how many servers it serves, and
  // that every command loaded. Mirrors the data /version reports.
  const guildCount = readyClient.guilds.cache.size;
  const commandCount = COMMANDS_BY_NAME.size;
  console.log("[Pulse] ──────────────────────────────────────────");
  console.log(`[Pulse] ✓ Pulse v${version} is ready`);
  console.log(`[Pulse] ✓ Serving ${guildCount} guild${guildCount === 1 ? "" : "s"}`);
  console.log(`[Pulse] ✓ Loaded ${commandCount} command${commandCount === 1 ? "" : "s"}`);
  console.log("[Pulse] ──────────────────────────────────────────");
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`[Pulse] Joined guild: ${guild.name}`);
  // Register the guild's enabled command set so the new server gets them
  // immediately (per-guild registration propagates in seconds).
  const rest = restClient ?? new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  await registerGuildCommands(rest, botAppId ?? client.user.id, guild);
  await syncGuild(guild);
});

client.on(Events.GuildDelete, async (guild) => {
  console.log(`[Pulse] Left/kicked from guild: ${guild.name} (${guild.id})`);
  await supabase.from("synced_guilds").delete().eq("guild_id", guild.id);
});

client.on(Events.GuildMemberAdd, async (member) => {
  analytics.track({
    type: "member_join",
    guildId: member.guild.id,
    userId: member.id,
    userName: member.user.username,
    immediate: true,
  });

  // Server Timeline: joins and leaves get their notification from the
  // analytics_events DB trigger, not from recordNotification — so the mirror
  // never sees them and the timeline has to record them itself.
  void recordTimelineEvent(supabase, {
    guildId: member.guild.id,
    type: "member_joined",
    title: `${member.user.tag} joined the server`,
    targetId: member.id,
    targetName: member.user.tag,
    metadata: { account_created_at: member.user.createdAt?.toISOString() ?? null },
    link: `/dashboard/${member.guild.id}/members/${member.id}`,
  });

  // Feed DDoS Protection's member-join-burst detector (raid signal).
  security.onMemberJoin(member.guild.id, member.id);

  const settings = await getGuildSettings(member.guild.id);

  if (settings?.welcome?.enabled && settings.welcome.channel_id) {
    try {
      const channel = await member.guild.channels.fetch(
        settings.welcome.channel_id,
      );
      if (channel?.isTextBased()) {
        const resolve = (text) =>
          text
            .replace(/\{user\}/g, member.toString())
            .replace(/\{server\}/g, member.guild.name);

        if (settings.welcome.type === "embed" && settings.welcome.embed) {
          const cfg = settings.welcome.embed;
          const hasBanner = !!cfg.banner_color;
          const accentInt = await getGuildAccent(supabase, member.guild.id);
          const container = buildMemberV2Container(cfg, resolve, hasBanner, "Welcome", accentInt);
          const payload = {
            flags: MessageFlags.IsComponentsV2,
            components: [container],
          };
          if (hasBanner) {
            // Bot fetches banner from the web app and sends it as a Discord attachment.
            // This works in both local dev (same machine) and production.
            const appUrl = process.env.APP_URL ?? "http://localhost:3000";
            const bannerFetchUrl = `${appUrl}/api/banner?name=${encodeURIComponent(member.guild.name)}&color=${cfg.banner_color}`;
            payload.files = [
              { attachment: bannerFetchUrl, name: "banner.png" },
            ];
          }
          await channel.send(payload);
        } else {
          const msg = resolve(
            settings.welcome.message ?? "Welcome to {server}, {user}!",
          );
          await channel.send(msg);
        }
      }
    } catch (err) {
      console.error(
        `[Pulse] Welcome message failed in guild ${member.guild.id}:`,
        err.message,
      );
      await recordNotification(supabase, {
        guildId: member.guild.id,
        type: "bot_warning",
        title: "Welcome message failed to send",
        body: err.message,
        link: `/dashboard/${member.guild.id}/onboarding`,
        targetId: settings.welcome.channel_id,
        metadata: { automation: "welcome" },
      });
    }
  }

  if (settings?.auto_role?.enabled && settings.auto_role.role_id) {
    try {
      const role = await member.guild.roles.fetch(settings.auto_role.role_id);
      if (role) {
        await member.roles.add(role);
        console.log(
          `[Pulse] Auto-role "${role.name}" assigned to ${member.user.tag} in ${member.guild.name}`,
        );
      } else {
        console.warn(
          `[Pulse] Auto-role not found: ${settings.auto_role.role_id} in guild ${member.guild.id}`,
        );
        await recordNotification(supabase, {
          guildId: member.guild.id,
          type: "bot_warning",
          title: "Auto-role is misconfigured",
          body: `The configured role ID ${settings.auto_role.role_id} no longer exists. Pick a new role in Roles › Self-Assign Roles.`,
          link: `/dashboard/${member.guild.id}/roles?tab=self`,
          metadata: {
            automation: "auto_role",
            role_id: settings.auto_role.role_id,
          },
        });
      }
    } catch (err) {
      console.error(
        `[Pulse] Auto-role failed for ${member.user.tag} in guild ${member.guild.id}:`,
        err.message,
      );
      await recordNotification(supabase, {
        guildId: member.guild.id,
        type: "bot_warning",
        title: `Auto-role failed for ${member.user.tag}`,
        body: err.message,
        link: `/dashboard/${member.guild.id}/roles?tab=self`,
        targetId: member.id,
        targetName: member.user.tag,
        metadata: { automation: "auto_role" },
      });
    }
  }

  // Member onboarding (PULSIFY-37): post the interactive welcome panel. Runs
  // independently of the legacy welcome/auto-role above so admins can use either
  // or both. No-ops unless member_onboarding is enabled.
  await onboarding.postForMember(member, settings);
});

client.on(Events.GuildMemberRemove, async (member) => {
  console.log(
    `[Pulse] Member left: ${member.user.tag} from ${member.guild.name}`,
  );

  analytics.track({
    type: "member_leave",
    guildId: member.guild.id,
    userId: member.id,
    userName: member.user.username,
    immediate: true,
  });

  // Server Timeline: "left" and "was kicked" are the same gateway event, and
  // an admin investigating a departure needs to know which. Resolved from the
  // audit log; a ban already claimed this removal via markRemovalHandled.
  void recordMemberRemoval(member);

  const settings = await getGuildSettings(member.guild.id);

  if (settings?.goodbye?.enabled && settings.goodbye.channel_id) {
    try {
      const channel = await member.guild.channels.fetch(
        settings.goodbye.channel_id,
      );
      if (channel?.isTextBased()) {
        // The member already left, so {user} resolves to their name (a mention would be dead).
        const resolve = (text) =>
          text
            .replace(/\{user\}/g, member.user.username)
            .replace(/\{server\}/g, member.guild.name);

        if (settings.goodbye.type === "embed" && settings.goodbye.embed) {
          const cfg = settings.goodbye.embed;
          const hasBanner = !!cfg.banner_color;
          const accentInt = await getGuildAccent(supabase, member.guild.id);
          const container = buildMemberV2Container(cfg, resolve, hasBanner, "Goodbye", accentInt);
          const payload = {
            flags: MessageFlags.IsComponentsV2,
            components: [container],
          };
          if (hasBanner) {
            const appUrl = process.env.APP_URL ?? "http://localhost:3000";
            const bannerFetchUrl = `${appUrl}/api/banner?name=${encodeURIComponent(member.guild.name)}&color=${cfg.banner_color}`;
            payload.files = [
              { attachment: bannerFetchUrl, name: "banner.png" },
            ];
          }
          await channel.send(payload);
        } else {
          const msg = resolve(
            settings.goodbye.message ?? "{user} has left {server}.",
          );
          await channel.send(msg);
        }
      }
    } catch (err) {
      console.error(
        `[Pulse] Goodbye message failed in guild ${member.guild.id}:`,
        err.message,
      );
      await recordNotification(supabase, {
        guildId: member.guild.id,
        type: "bot_warning",
        title: "Goodbye message failed to send",
        body: err.message,
        link: `/dashboard/${member.guild.id}/onboarding`,
        targetId: settings.goodbye.channel_id,
        metadata: { automation: "goodbye" },
      });
    }
  }
});

client.on(Events.GuildBanAdd, async (ban) => {
  // Claim the removal FIRST, before any await: a ban also fires
  // GuildMemberRemove, and the timeline should record it as a ban, not as the
  // member wandering off. Staking the claim up front means the audit-log
  // lookup below can take as long as it likes without losing the race.
  markRemovalHandled(ban.guild.id, ban.user.id);

  analytics.track({
    type: "mod_action",
    guildId: ban.guild.id,
    userId: ban.user.id,
    userName: ban.user.username,
    metadata: { action: "ban" },
  });

  // Surface bans done outside the dashboard (Discord client, other bots, etc.)
  // in the activity feed. Dashboard-initiated bans already write a
  // notification, so notifyIfNotBot skips when the actor is us.
  const actor = await fetchActor(
    ban.guild,
    AuditLogEvent.MemberBanAdd,
    ban.user.id,
    client.user?.id,
  );
  if (!actor?.isBot) {
    const title = actor
      ? `${actor.actorName ?? "A moderator"} banned ${ban.user.tag}`
      : `${ban.user.tag} was banned`;
    const reason = actor?.reason ?? ban.reason ?? null;
    await recordNotification(supabase, {
      guildId: ban.guild.id,
      type: "mod_action",
      severity: "error",
      title,
      body: reason,
      link: `/dashboard/${ban.guild.id}/moderation`,
      actorId: actor?.actorId ?? null,
      actorName: actor?.actorName ?? null,
      actorUsername: actor?.actorUsername ?? null,
      targetId: ban.user.id,
      targetName: ban.user.tag,
      metadata: { action: "ban" },
      // The timeline records a typed `member_banned` instead of the generic
      // moderation_action the mirror would produce.
      timeline: false,
    });
    await recordTimelineEvent(supabase, {
      guildId: ban.guild.id,
      type: "member_banned",
      title,
      description: reason,
      actorId: actor?.actorId ?? null,
      actorName: actor?.actorName ?? null,
      actorUsername: actor?.actorUsername ?? null,
      targetId: ban.user.id,
      targetName: ban.user.tag,
      metadata: { action: "ban" },
      link: `/dashboard/${ban.guild.id}/moderation`,
    });
  }
});

client.on(Events.GuildBanRemove, async (ban) => {
  analytics.track({
    type: "mod_action",
    guildId: ban.guild.id,
    userId: ban.user.id,
    userName: ban.user.username,
    metadata: { action: "unban" },
  });

  const actor = await fetchActor(
    ban.guild,
    AuditLogEvent.MemberBanRemove,
    ban.user.id,
    client.user?.id,
  );
  if (!actor?.isBot) {
    const title = actor
      ? `${actor.actorName ?? "A moderator"} unbanned ${ban.user.tag}`
      : `${ban.user.tag} was unbanned`;
    await recordNotification(supabase, {
      guildId: ban.guild.id,
      type: "mod_action",
      severity: "info",
      title,
      body: actor?.reason ?? null,
      link: `/dashboard/${ban.guild.id}/moderation`,
      actorId: actor?.actorId ?? null,
      actorName: actor?.actorName ?? null,
      actorUsername: actor?.actorUsername ?? null,
      targetId: ban.user.id,
      targetName: ban.user.tag,
      metadata: { action: "unban" },
      timeline: false,
    });
    await recordTimelineEvent(supabase, {
      guildId: ban.guild.id,
      type: "member_unbanned",
      title,
      description: actor?.reason ?? null,
      actorId: actor?.actorId ?? null,
      actorName: actor?.actorName ?? null,
      actorUsername: actor?.actorUsername ?? null,
      targetId: ban.user.id,
      targetName: ban.user.tag,
      metadata: { action: "unban" },
      link: `/dashboard/${ban.guild.id}/moderation`,
    });
  }
});

// ── Member updates (nicknames + timeouts) ───────────────────────────────────
// Server Timeline only (PULSIFY-63) — neither of these has a notification
// type, and both are exactly the kind of change an admin later needs to look
// up: "who timed them out, and when did it lift?", "what were they called
// before?". Role changes are deliberately NOT tracked here: they fire
// constantly (auto-role, level rewards, self-assign menus, temporary roles)
// and each of those systems already records its own grant.
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const nicknameChanged = oldMember.nickname !== newMember.nickname;
  const oldTimeout = oldMember.communicationDisabledUntilTimestamp ?? null;
  const newTimeout = newMember.communicationDisabledUntilTimestamp ?? null;
  // An expired timeout leaves a stale past timestamp on the member until
  // Discord clears it; treat "in the past" as no timeout so a natural expiry
  // doesn't read as a moderator lifting it.
  const now = Date.now();
  const wasTimedOut = oldTimeout != null && oldTimeout > now;
  const isTimedOut = newTimeout != null && newTimeout > now;
  const timeoutChanged = wasTimedOut !== isTimedOut || (isTimedOut && oldTimeout !== newTimeout);

  if (!nicknameChanged && !timeoutChanged) return;

  // One audit lookup covers both — Discord logs nickname edits and timeouts
  // under the same MemberUpdate action.
  const actor = await fetchActor(
    newMember.guild,
    AuditLogEvent.MemberUpdate,
    newMember.id,
    client.user?.id,
  );
  // Dashboard-initiated changes already wrote their own timeline event.
  if (actor?.isBot) return;

  const attribution = {
    source: "discord",
    actorId: actor?.actorId ?? null,
    actorName: actor?.actorName ?? null,
    actorUsername: actor?.actorUsername ?? null,
    targetId: newMember.id,
    targetName: newMember.user.tag,
    link: `/dashboard/${newMember.guild.id}/members/${newMember.id}`,
  };

  if (timeoutChanged) {
    await recordTimelineEvent(supabase, {
      ...attribution,
      guildId: newMember.guild.id,
      type: isTimedOut ? "member_timeout" : "member_timeout_removed",
      title: isTimedOut
        ? `${actor?.actorName ?? "A moderator"} timed out ${newMember.user.tag}`
        : `${actor?.actorName ?? "A moderator"} lifted the timeout on ${newMember.user.tag}`,
      description: actor?.reason ?? null,
      previousValue: { timed_out_until: oldTimeout ? new Date(oldTimeout).toISOString() : null },
      newValue: { timed_out_until: newTimeout && isTimedOut ? new Date(newTimeout).toISOString() : null },
      metadata: { action: isTimedOut ? "timeout" : "remove_timeout" },
    });
  }

  if (nicknameChanged) {
    // Self-changes are common and unremarkable; still recorded, but phrased so
    // the feed doesn't imply a moderator acted.
    const selfChange = actor?.actorId === newMember.id;
    await recordTimelineEvent(supabase, {
      ...attribution,
      guildId: newMember.guild.id,
      type: "member_nickname_changed",
      title: selfChange || !actor
        ? `${newMember.user.tag} changed their nickname`
        : `${actor.actorName ?? "A moderator"} changed the nickname of ${newMember.user.tag}`,
      description: oldMember.nickname
        ? `${oldMember.nickname} — ${newMember.nickname ?? "cleared"}`
        : `Set to ${newMember.nickname}`,
      previousValue: { nickname: oldMember.nickname ?? null },
      newValue: { nickname: newMember.nickname ?? null },
    });
  }
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot || !message.guild) return;
  analytics.track({
    type: "message",
    guildId: message.guild.id,
    userId: message.author.id,
    // Server display name (guild nickname → global name → username).
    userName: message.member?.displayName ?? message.author.displayName,
    channelId: message.channelId,
    channelName: message.channel?.name,
  });

  // Feed DDoS Protection's automated-spam detector (per-user message rate).
  security.onMessage(message.guild.id, message.author.id);

  // Award XP for the message (anti-spam cooldown + ignored channels/roles are
  // enforced inside the module). Fire-and-forget — never blocks tracking.
  void leveling.awardMessage(message);

  // Award Pulse Coins for the message + the once-a-day "active day" bonus
  // (own cooldowns/caps/ignore rules inside the module). Fire-and-forget.
  void economyRewards.onMessage(message);

  // Fire-and-forget — Pulse Guard runs the analysis + auto-action on the web
  // app side. Failures are logged inside the helper, never thrown, so a web
  // app outage can't break message tracking.
  void forwardMessageToPulseGuard(message);
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  // Private Channels: join-to-create + empty-channel cleanup (own bot filter).
  void privateChannels.onVoiceStateUpdate(oldState, newState);

  const guildId = newState.guild.id;
  const userId = newState.id;
  const member = newState.member ?? oldState.member;
  if (member?.user?.bot) return;
  const userName = member?.user?.username;

  const left = oldState.channelId && !newState.channelId;
  const joined = !oldState.channelId && newState.channelId;
  const moved =
    oldState.channelId &&
    newState.channelId &&
    oldState.channelId !== newState.channelId;

  if (left) {
    analytics.voiceLeave(guildId, userId);
  } else if (joined) {
    analytics.voiceJoin(
      guildId,
      userId,
      userName,
      newState.channelId,
      newState.channel?.name,
    );
  } else if (moved) {
    analytics
      .voiceLeave(guildId, userId)
      .then(() =>
        analytics.voiceJoin(
          guildId,
          userId,
          userName,
          newState.channelId,
          newState.channel?.name,
        ),
      );
  }
});

// ── Channels ────────────────────────────────────────────────────────────────
// Discord-side channel changes (someone creates/deletes/renames a channel
// in the Discord client rather than the dashboard). notifyIfNotBot skips
// when the dashboard was the source — it already wrote a notification.

client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) return;
  await notifyIfNotBot({
    guild: channel.guild,
    auditType: AuditLogEvent.ChannelCreate,
    targetId: channel.id,
    type: "channel_created",
    title: `#${channel.name} was created`,
    link: `/dashboard/${channel.guild.id}/channels`,
    targetName: channel.name,
    metadata: { channel_type: channel.type },
  });
});

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) return;
  // Private Channels: drop a tracked channel's row, or clear a deleted
  // category/trigger id so the sweep recreates it.
  void privateChannels.onChannelDelete(channel);
  await notifyIfNotBot({
    guild: channel.guild,
    auditType: AuditLogEvent.ChannelDelete,
    targetId: channel.id,
    type: "channel_deleted",
    title: `#${channel.name} was deleted`,
    link: `/dashboard/${channel.guild.id}/channels`,
    targetName: channel.name,
    metadata: { channel_type: channel.type },
  });
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  // Discord fires ChannelUpdate for a lot of low-signal changes (last-message
  // pointer churn, position rebalancing). Only emit when something a human
  // would care about changed.
  const meaningful =
    oldChannel.name !== newChannel.name ||
    oldChannel.topic !== newChannel.topic ||
    oldChannel.nsfw !== newChannel.nsfw ||
    oldChannel.parentId !== newChannel.parentId ||
    oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser ||
    oldChannel.bitrate !== newChannel.bitrate ||
    oldChannel.userLimit !== newChannel.userLimit;
  if (!meaningful) return;

  const renamed = oldChannel.name !== newChannel.name;
  const moved = oldChannel.parentId !== newChannel.parentId;
  const title = renamed
    ? `#${oldChannel.name} was renamed to #${newChannel.name}`
    : moved
      ? `#${newChannel.name} was moved to another category`
      : `#${newChannel.name} was updated`;

  // Timeline: capture only the fields that actually differ, so the history
  // shows "topic: old → new" instead of a wall of unchanged channel state.
  const previousValue = {};
  const newValue = {};
  for (const [key, oldVal, newVal] of [
    ["name", oldChannel.name, newChannel.name],
    ["topic", oldChannel.topic, newChannel.topic],
    ["nsfw", oldChannel.nsfw, newChannel.nsfw],
    ["parent_id", oldChannel.parentId, newChannel.parentId],
    ["rate_limit_per_user", oldChannel.rateLimitPerUser, newChannel.rateLimitPerUser],
    ["bitrate", oldChannel.bitrate, newChannel.bitrate],
    ["user_limit", oldChannel.userLimit, newChannel.userLimit],
  ]) {
    if (oldVal !== newVal) {
      previousValue[key] = oldVal ?? null;
      newValue[key] = newVal ?? null;
    }
  }

  await notifyIfNotBot({
    guild: newChannel.guild,
    auditType: AuditLogEvent.ChannelUpdate,
    targetId: newChannel.id,
    type: "channel_updated",
    title,
    link: `/dashboard/${newChannel.guild.id}/channels`,
    targetName: newChannel.name,
    timeline: {
      type: renamed ? "channel_renamed" : moved ? "category_changed" : "channel_updated",
      previousValue,
      newValue,
      metadata: { channel_type: newChannel.type },
    },
  });
});

// ── Roles ───────────────────────────────────────────────────────────────────

client.on(Events.GuildRoleCreate, async (role) => {
  await notifyIfNotBot({
    guild: role.guild,
    auditType: AuditLogEvent.RoleCreate,
    targetId: role.id,
    type: "role_created",
    title: `Role @${role.name} was created`,
    link: `/dashboard/${role.guild.id}/roles`,
    targetName: role.name,
  });
});

client.on(Events.GuildRoleDelete, async (role) => {
  await notifyIfNotBot({
    guild: role.guild,
    auditType: AuditLogEvent.RoleDelete,
    targetId: role.id,
    type: "role_deleted",
    title: `Role @${role.name} was deleted`,
    link: `/dashboard/${role.guild.id}/roles`,
    targetName: role.name,
  });
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  // Skip silent position rebalancing — only attribute changes a moderator
  // would recognise as an "update".
  const meaningful =
    oldRole.name !== newRole.name ||
    oldRole.color !== newRole.color ||
    oldRole.permissions.bitfield !== newRole.permissions.bitfield ||
    oldRole.mentionable !== newRole.mentionable ||
    oldRole.hoist !== newRole.hoist;
  if (!meaningful) return;

  const renamed = oldRole.name !== newRole.name;
  const permissionsChanged =
    oldRole.permissions.bitfield !== newRole.permissions.bitfield;
  const title = renamed
    ? `Role @${oldRole.name} was renamed to @${newRole.name}`
    : permissionsChanged
      ? `Permissions changed on @${newRole.name}`
      : `Role @${newRole.name} was updated`;

  // Permission bitfields are BigInt — store them as strings so the jsonb
  // round-trip stays lossless (a 64-bit bitfield doesn't survive as a JS
  // number). The dashboard renders them back into permission names.
  const previousValue = {};
  const newValue = {};
  for (const [key, oldVal, newVal] of [
    ["name", oldRole.name, newRole.name],
    ["color", oldRole.color, newRole.color],
    ["permissions", String(oldRole.permissions.bitfield), String(newRole.permissions.bitfield)],
    ["mentionable", oldRole.mentionable, newRole.mentionable],
    ["hoist", oldRole.hoist, newRole.hoist],
  ]) {
    if (oldVal !== newVal) {
      previousValue[key] = oldVal ?? null;
      newValue[key] = newVal ?? null;
    }
  }

  await notifyIfNotBot({
    guild: newRole.guild,
    auditType: AuditLogEvent.RoleUpdate,
    targetId: newRole.id,
    type: "role_updated",
    title,
    link: `/dashboard/${newRole.guild.id}/roles`,
    targetName: newRole.name,
    timeline: {
      type: renamed
        ? "role_renamed"
        : permissionsChanged
          ? "role_permissions_changed"
          : "role_updated",
      previousValue,
      newValue,
    },
  });
});

// ── Scheduled events ────────────────────────────────────────────────────────

client.on(Events.GuildScheduledEventCreate, async (event) => {
  if (!event.guild) return;
  await notifyIfNotBot({
    guild: event.guild,
    auditType: AuditLogEvent.GuildScheduledEventCreate,
    targetId: event.id,
    type: "event_created",
    title: `"${event.name}" was scheduled`,
    body: event.scheduledStartAt
      ? `Starts ${event.scheduledStartAt.toLocaleString()}`
      : null,
    link: `/dashboard/${event.guild.id}/events`,
    targetName: event.name,
  });
  // Reward the event host (PULSIFY-47).
  void economyRewards.onEventCreate(event);
});

client.on(Events.GuildScheduledEventUpdate, async (oldEvent, newEvent) => {
  if (!newEvent.guild) return;
  // Reward attendance (event went live) / completion (event ended).
  void economyRewards.onEventUpdate(oldEvent, newEvent);
  // Status 4 = CANCELED — treat as a deletion in the activity feed so the
  // user sees one logical "the event went away" entry instead of an update
  // immediately followed by a delete.
  const wasCancelled =
    newEvent.status === 4 && (oldEvent?.status ?? null) !== 4;
  await notifyIfNotBot({
    guild: newEvent.guild,
    auditType: AuditLogEvent.GuildScheduledEventUpdate,
    targetId: newEvent.id,
    type: wasCancelled ? "event_deleted" : "event_updated",
    title: wasCancelled
      ? `"${newEvent.name}" was cancelled`
      : `"${newEvent.name}" was updated`,
    link: `/dashboard/${newEvent.guild.id}/events`,
    targetName: newEvent.name,
  });
});

client.on(Events.GuildScheduledEventDelete, async (event) => {
  if (!event.guild) return;
  await notifyIfNotBot({
    guild: event.guild,
    auditType: AuditLogEvent.GuildScheduledEventDelete,
    targetId: event.id,
    type: "event_deleted",
    title: `"${event.name}" was deleted`,
    link: `/dashboard/${event.guild.id}/events`,
    targetName: event.name,
  });
});

// A member marking interest in a scheduled event = event participation → XP.
client.on(Events.GuildScheduledEventUserAdd, async (scheduledEvent, user) => {
  if (user?.bot) return;
  const guild = scheduledEvent.guild ?? client.guilds.cache.get(scheduledEvent.guildId);
  if (!guild) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member) {
    void leveling.awardEventInterest(guild, member);
    // Record the participation so "event participation" milestones can count it.
    void milestones.recordEventParticipation(guild, member, scheduledEvent.id);
  }
  // Reward event participation in Pulse Coins (also tracks the RSVP for the
  // completion payout when the event ends).
  void economyRewards.onEventUserAdd(scheduledEvent, user);
});

// A reaction added to a message → reward the message author ("reactions
// received"). Anti-farm (self-react, dedup, cooldown, caps) lives in the module.
client.on(Events.MessageReactionAdd, (reaction, user) => {
  void economyRewards.onReaction(reaction, user);
});

// ── Server settings ─────────────────────────────────────────────────────────

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  // Discord fires GuildUpdate on a wide range of internal state changes
  // (member counts, presence, etc.). Filter to fields we actually expose in
  // the dashboard's Server Settings page so the feed isn't noisy.
  const meaningful =
    oldGuild.name !== newGuild.name ||
    oldGuild.icon !== newGuild.icon ||
    oldGuild.verificationLevel !== newGuild.verificationLevel ||
    oldGuild.defaultMessageNotifications !==
      newGuild.defaultMessageNotifications ||
    oldGuild.explicitContentFilter !== newGuild.explicitContentFilter ||
    oldGuild.afkChannelId !== newGuild.afkChannelId ||
    oldGuild.afkTimeout !== newGuild.afkTimeout ||
    oldGuild.systemChannelId !== newGuild.systemChannelId ||
    oldGuild.rulesChannelId !== newGuild.rulesChannelId ||
    oldGuild.publicUpdatesChannelId !== newGuild.publicUpdatesChannelId;
  if (!meaningful) return;

  await notifyIfNotBot({
    guild: newGuild,
    auditType: AuditLogEvent.GuildUpdate,
    targetId: newGuild.id,
    type: "server_settings_changed",
    title:
      oldGuild.name !== newGuild.name
        ? `Server was renamed to "${newGuild.name}"`
        : `Server settings were changed`,
    link: `/dashboard/${newGuild.id}/server-settings`,
    targetName: newGuild.name,
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  // /help pagination (prev/next) — commands.js builds these buttons; handle them
  // here since the central listener owns getAllowedCommands + the page renderer.
  if (interaction.isButton?.() && interaction.customId?.startsWith("help:nav:")) {
    if (!interaction.guild) return;
    try {
      const parts = interaction.customId.split(":");
      const viewerId = parts[2];
      const page = Number(parts[3]) || 0;
      if (interaction.user.id !== viewerId) {
        await replyNotice(
          interaction,
          "This menu belongs to someone else — run /help to open your own.",
        ).catch(() => {});
        return;
      }
      const payload = await renderHelp({
        supabase,
        guild: interaction.guild,
        member: interaction.member,
        getAllowedCommands,
        page,
      });
      await interaction.update({
        ...payload,
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (err) {
      console.error("[Pulse] /help pagination failed:", err.message);
    }
    return;
  }

  // Autocomplete — Discord sends these as their own interaction type as the
  // member types, and expects a response within ~3s. They're deliberately
  // handled BEFORE the chat-input guard below (which returns early on anything
  // that isn't a completed command) and kept off the analytics/logging path:
  // one command invocation can fire dozens of these, and they aren't uses.
  if (interaction.isAutocomplete?.()) {
    if (!interaction.guild) return;
    const def = COMMANDS_BY_NAME.get(interaction.commandName);
    if (!def?.autocomplete) {
      // Never leave the picker hanging on a command with no handler.
      await interaction.respond([]).catch(() => {});
      return;
    }
    try {
      await def.autocomplete({
        interaction,
        guild: interaction.guild,
        client,
        supabase,
        moderation,
        roles,
        channels,
        giveaways,
        polls,
        events,
        scheduler,
        settings,
        templates,
      });
    } catch (err) {
      console.error(
        `[Pulse] /${interaction.commandName} autocomplete failed:`,
        err.message,
      );
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const guild = interaction.guild;
  if (!guild) return;

  const { commandName } = interaction;

  // Keep feeding the Overview analytics (total commands) regardless of the
  // Command Center outcome — every invocation is still a "command" event.
  analytics.track({
    type: "command",
    guildId: interaction.guildId,
    userId: interaction.user.id,
    userName: interaction.user.username,
    channelId: interaction.channelId,
    metadata: { command: commandName },
  });

  // Feed DDoS Protection (command spike + per-user command-abuse detectors) and
  // enforce any active security mitigation BEFORE doing the work: a lockdown,
  // a per-user block, or a paused Commands module short-circuits the command.
  security.onCommand(interaction.guildId, interaction.user.id);
  const securityGate = security.checkAllowed(interaction.guildId, interaction.user.id, "commands");
  if (!securityGate.allowed) {
    await replyNotice(interaction, securityGate.reason).catch(() => {});
    await logCommand(supabase, {
      guildId: guild.id,
      commandName,
      userId: interaction.user.id,
      userName: interaction.member?.displayName ?? interaction.user.username,
      channelId: interaction.channelId,
      channelName: interaction.channel?.name ?? null,
      status: "blocked",
      detail: securityGate.reason,
    });
    return;
  }

  // Award command-usage XP (its own cooldown + ignore rules live in the module).
  void leveling.awardCommand(interaction);
  // Award command-usage Pulse Coins (off by default; own cooldown/caps).
  void economyRewards.onCommand(interaction);

  const logBase = {
    guildId: guild.id,
    commandName,
    userId: interaction.user.id,
    userName: interaction.member?.displayName ?? interaction.user.username,
    channelId: interaction.channelId,
    channelName: interaction.channel?.name ?? null,
  };

  // Gate the command through the Command Center: enable/maintenance,
  // channel + role allow/deny, baseline access level, cooldown, usage cap.
  const verdict = await evaluate(supabase, interaction);

  if (verdict.kind === "unknown") {
    // Registered command with no handler — should not happen, but never hang.
    await replyNotice(interaction, "Unknown command.")
      .catch(() => {});
    return;
  }

  if (verdict.kind === "blocked") {
    await replyNotice(interaction, verdict.reason)
      .catch(() => {});
    await logCommand(supabase, { ...logBase, status: verdict.status, detail: verdict.reason });
    return;
  }

  // Module + plan gating. Runs AFTER the Command Center verdict so an explicit
  // per-server rule (disabled, wrong channel, on cooldown) is reported as
  // itself — an admin who switched a command off should be told that, not sold
  // an upgrade. Blocked results are logged like any other block so the
  // dashboard's command analytics can show what's being gated and why.
  const gate = await featureGate.check(supabase, guild, verdict.def);
  if (!gate.allowed) {
    await replyNotice(interaction, gate.reason).catch(() => {});
    await logCommand(supabase, {
      ...logBase,
      status: gate.status,
      detail: gate.reason,
    });
    return;
  }

  const command = COMMANDS_BY_NAME.get(commandName);
  const startedAt = Date.now();
  try {
    await command.execute({
      interaction,
      guild,
      client,
      supabase,
      getAllowedCommands,
      leveling,
      milestones,
      economy,
      economyRewards,
      birthdays,
      altDetection,
      invites,
      gaming,
      moderation,
      roles,
      channels,
      tickets,
      giveaways,
      polls,
      privateChannels,
      guard,
      events,
      announcements,
      scheduler,
      serverAnalytics,
      onboarding,
      settings,
      backups,
      templates,
      community,
      timeline,
      ephemeral: verdict.ephemeral,
    });
    verdict.commit();
    await logCommand(supabase, {
      ...logBase,
      status: "success",
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error(`[Pulse] /${commandName} failed in guild ${guild.id}:`, err.message);
    await logCommand(supabase, {
      ...logBase,
      status: "failed",
      detail: err.message,
      durationMs: Date.now() - startedAt,
    });
    // Surface a generic failure without leaking internals (replyNotice follows
    // up automatically if the handler already answered before it threw).
    await replyNotice(interaction, "Something went wrong running that command.");
  }
});

async function syncGuild(guild) {
  try {
    await guild.members.fetch().catch(() => null);
    await supabase.from("synced_guilds").upsert(
      {
        guild_id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner_id: guild.ownerId,
        member_count: guild.memberCount,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "guild_id" },
    );
    console.log(`[Pulse] Synced guild: ${guild.name}`);
  } catch (err) {
    console.error(`[Pulse] Failed to sync guild ${guild.name}:`, err);
  }
}

async function getGuildSettings(guildId) {
  const { data } = await supabase
    .from("guild_settings")
    .select("settings")
    .eq("guild_id", guildId)
    .maybeSingle();
  return data?.settings ?? null;
}

async function shutdown() {
  console.log("[Pulse] Shutting down — flushing analytics...");
  try {
    await analytics.flushAllVoice();
    await analytics.flush();
  } catch (err) {
    console.error(
      "[Pulse] Error during analytics flush on shutdown:",
      err.message,
    );
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Surface gateway-level errors clearly rather than letting them pass silently.
client.on(Events.Error, (err) => {
  console.error("[Pulse] Client error:", err.message);
});

// Clear startup failure output — a bad token / missing env / network issue
// during login is the most common "bot won't start" cause, so name it plainly.
client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
  console.error("[Pulse] ✗ Startup failed — could not log in to Discord:", err.message);
  console.error("[Pulse]   Check DISCORD_BOT_TOKEN and the bot's network access.");
  process.exit(1);
});

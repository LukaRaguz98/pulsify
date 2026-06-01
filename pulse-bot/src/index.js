require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
  Events,
  AuditLogEvent,
} = require("discord.js");

const { createClient } = require("@supabase/supabase-js");
const { createAnalytics } = require("./analytics");
const { recordNotification, fetchActor } = require("./notifications");
const { forwardMessageToPulseGuard } = require("./ai-moderation");
const { COMMANDS_BY_NAME } = require("./commands");
const { getCurrentVersion } = require("./version");
const {
  loadConfigs,
  invalidateConfigs,
  buildGuildCommandBody,
  getAllowedCommands,
  logCommand,
  evaluate,
} = require("./command-center");
const { createScheduler } = require("./scheduler");
const { createTickets } = require("./tickets");
const { createGiveaways } = require("./giveaways");
const { createLeveling } = require("./leveling");
const { createPresence } = require("./presence");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

const analytics = createAnalytics(supabase);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    // Required for Events.GuildScheduledEvent* — without it the bot never
    // sees event create/update/delete and our notifications would miss them.
    GatewayIntentBits.GuildScheduledEvents,
  ],
});

// Constructed after `client` exists — the scheduler captures it to resolve
// guilds and run actions when workflows fire.
const scheduler = createScheduler(client, supabase);

// The ticket system registers its own interaction + message listeners on start
// (it only handles `tkt:` component/modal interactions, never chat-input, so it
// never collides with the slash-command handler below).
const tickets = createTickets(client, supabase);

// The leveling system awards XP for member activity, detects level-ups, assigns
// reward roles and announces them. Constructed BEFORE giveaways so it can be
// handed in — a giveaway entry awards XP too. It registers no interaction
// listener (the /rank + /leaderboard slash commands are routed through the
// command handler below); it only runs a once-a-minute voice-XP tick.
const leveling = createLeveling(client, supabase);

// The giveaway system likewise registers its own interaction listener (only
// `gw:` buttons) plus a once-a-minute lifecycle tick that starts scheduled
// giveaways and draws winners when they end. `leveling` is passed so a Join
// awards engagement XP.
const giveaways = createGiveaways(client, supabase, leveling);

// The presence system owns the bot's global Discord status. It reads the
// "active" guild's presence config (bot_presence_state → guild_presence),
// rotates through that server's activities (resolving dynamic placeholders like
// {servers}/{members}), and honours maintenance mode. Registers no interaction
// listener — just a rotation timer + a realtime watch on both tables.
const presence = createPresence(client, supabase);

/**
 * Shared helper for Discord-side activity → notifications row.
 *
 * Fetches the audit log to attribute the action and dedupes against
 * dashboard-initiated activity: when the audit-log executor is the Pulsify
 * bot itself, the dashboard already wrote a notification when it called
 * Discord, so we skip the gateway-side write to avoid duplicates.
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
function buildMemberV2Container(cfg, resolve, hasBanner, footerLabel) {
  const colorInt = parseInt((cfg.color ?? "#6366f1").replace("#", ""), 16);
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
  // footer_text; fall back to a branded `Pulse · <label>` when it's blank.
  const footer = cfg.footer_text
    ? resolve(cfg.footer_text)
    : `Pulse · ${footerLabel}`;
  components.push({ type: 14, divider: true, spacing: 1 });
  components.push({ type: 10, content: `-# ${footer}` });

  return {
    type: 17,
    accent_color: isNaN(colorInt) ? 0x6366f1 : colorInt,
    components,
  };
}

/**
 * Build a Components V2 container for a moderation alert posted to a server's
 * configured alerts channel. Keeps a semantic accent (red = removal,
 * green = restore) but adopts the same v2 layout the rest of Pulse uses:
 * `#` heading, bold-label body lines, a divider, and a `-#` footer carrying a
 * relative timestamp. Falsy `lines` entries are skipped so optional fields
 * (moderator, reason) collapse cleanly.
 */
function buildModAlertContainer({ colorInt, title, lines, footerLabel }) {
  const unix = Math.floor(Date.now() / 1000);
  return {
    type: 17,
    accent_color: colorInt,
    components: [
      { type: 10, content: "**Pulse**" },
      { type: 10, content: `# ${title}` },
      { type: 10, content: "-# Moderation alert" },
      { type: 10, content: lines.filter(Boolean).join("\n") },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: `-# Pulse · ${footerLabel} · <t:${unix}:R>` },
    ],
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

  // Leveling system: load per-guild XP config, subscribe to settings changes,
  // and start the voice-XP tick.
  await leveling.start();

  // Presence system: take over the bot's global status from the static default
  // set above. Loads the active guild's config and starts the rotation; if no
  // guild is active it leaves the default "Powered by Pulsify" in place.
  await presence.start();

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
          const container = buildMemberV2Container(cfg, resolve, hasBanner, "Welcome");
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
        link: `/dashboard/${member.guild.id}/automations`,
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
          body: `The configured role ID ${settings.auto_role.role_id} no longer exists. Pick a new role in Automations.`,
          link: `/dashboard/${member.guild.id}/automations`,
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
        link: `/dashboard/${member.guild.id}/automations`,
        targetId: member.id,
        targetName: member.user.tag,
        metadata: { automation: "auto_role" },
      });
    }
  }
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
          const container = buildMemberV2Container(cfg, resolve, hasBanner, "Goodbye");
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
        link: `/dashboard/${member.guild.id}/automations`,
        targetId: settings.goodbye.channel_id,
        metadata: { automation: "goodbye" },
      });
    }
  }
});

client.on(Events.GuildBanAdd, async (ban) => {
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
    await recordNotification(supabase, {
      guildId: ban.guild.id,
      type: "mod_action",
      severity: "error",
      title: actor
        ? `${actor.actorName ?? "A moderator"} banned ${ban.user.tag}`
        : `${ban.user.tag} was banned`,
      body: actor?.reason ?? ban.reason ?? null,
      link: `/dashboard/${ban.guild.id}/moderation`,
      actorId: actor?.actorId ?? null,
      actorName: actor?.actorName ?? null,
      actorUsername: actor?.actorUsername ?? null,
      targetId: ban.user.id,
      targetName: ban.user.tag,
      metadata: { action: "ban" },
    });
  }

  const settings = await getGuildSettings(ban.guild.id);
  if (
    settings?.moderation_alerts?.enabled &&
    settings.moderation_alerts.channel_id
  ) {
    const channel = ban.guild.channels.cache.get(
      settings.moderation_alerts.channel_id,
    );
    if (channel?.isTextBased()) {
      const container = buildModAlertContainer({
        colorInt: 0xef4444,
        title: "Member banned",
        lines: [
          `**Member:** ${ban.user.tag} (\`${ban.user.id}\`)`,
          actor?.actorName ? `**Moderator:** ${actor.actorName}` : null,
          `**Reason:** ${actor?.reason ?? ban.reason ?? "No reason provided"}`,
        ],
        footerLabel: "Banned",
      });
      await channel
        .send({ flags: MessageFlags.IsComponentsV2, components: [container] })
        .catch(console.error);
    }
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
    await recordNotification(supabase, {
      guildId: ban.guild.id,
      type: "mod_action",
      severity: "info",
      title: actor
        ? `${actor.actorName ?? "A moderator"} unbanned ${ban.user.tag}`
        : `${ban.user.tag} was unbanned`,
      body: actor?.reason ?? null,
      link: `/dashboard/${ban.guild.id}/moderation`,
      actorId: actor?.actorId ?? null,
      actorName: actor?.actorName ?? null,
      actorUsername: actor?.actorUsername ?? null,
      targetId: ban.user.id,
      targetName: ban.user.tag,
      metadata: { action: "unban" },
    });
  }

  const settings = await getGuildSettings(ban.guild.id);
  if (
    settings?.moderation_alerts?.enabled &&
    settings.moderation_alerts.channel_id
  ) {
    const channel = ban.guild.channels.cache.get(
      settings.moderation_alerts.channel_id,
    );
    if (channel?.isTextBased()) {
      const container = buildModAlertContainer({
        colorInt: 0x22c55e,
        title: "Member unbanned",
        lines: [
          `**Member:** ${ban.user.tag} (\`${ban.user.id}\`)`,
          actor?.actorName ? `**Moderator:** ${actor.actorName}` : null,
          actor?.reason ? `**Reason:** ${actor.reason}` : null,
        ],
        footerLabel: "Unbanned",
      });
      await channel
        .send({ flags: MessageFlags.IsComponentsV2, components: [container] })
        .catch(console.error);
    }
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

  // Award XP for the message (anti-spam cooldown + ignored channels/roles are
  // enforced inside the module). Fire-and-forget — never blocks tracking.
  void leveling.awardMessage(message);

  // Fire-and-forget — Pulse Guard runs the analysis + auto-action on the web
  // app side. Failures are logged inside the helper, never thrown, so a web
  // app outage can't break message tracking.
  void forwardMessageToPulseGuard(message);
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
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

  const title =
    oldChannel.name !== newChannel.name
      ? `#${oldChannel.name} was renamed to #${newChannel.name}`
      : `#${newChannel.name} was updated`;
  await notifyIfNotBot({
    guild: newChannel.guild,
    auditType: AuditLogEvent.ChannelUpdate,
    targetId: newChannel.id,
    type: "channel_updated",
    title,
    link: `/dashboard/${newChannel.guild.id}/channels`,
    targetName: newChannel.name,
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

  const title =
    oldRole.name !== newRole.name
      ? `Role @${oldRole.name} was renamed to @${newRole.name}`
      : `Role @${newRole.name} was updated`;
  await notifyIfNotBot({
    guild: newRole.guild,
    auditType: AuditLogEvent.RoleUpdate,
    targetId: newRole.id,
    type: "role_updated",
    title,
    link: `/dashboard/${newRole.guild.id}/roles`,
    targetName: newRole.name,
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
});

client.on(Events.GuildScheduledEventUpdate, async (oldEvent, newEvent) => {
  if (!newEvent.guild) return;
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
  if (member) void leveling.awardEventInterest(guild, member);
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

  // Award command-usage XP (its own cooldown + ignore rules live in the module).
  void leveling.awardCommand(interaction);

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
    await interaction
      .reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }

  if (verdict.kind === "blocked") {
    await interaction
      .reply({ content: verdict.reason, flags: MessageFlags.Ephemeral })
      .catch(() => {});
    await logCommand(supabase, { ...logBase, status: verdict.status, detail: verdict.reason });
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
    // Surface a generic failure without leaking internals; ignore if the
    // interaction was already answered by the handler before it threw.
    const failMsg = { content: "Something went wrong running that command.", flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(failMsg).catch(() => {});
    } else {
      await interaction.reply(failMsg).catch(() => {});
    }
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

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
  Events,
  AuditLogEvent,
} = require("discord.js");

const { createClient } = require("@supabase/supabase-js");
const { createAnalytics } = require("./analytics");
const { recordNotification, fetchActor } = require("./notifications");
const { forwardMessageToPulseGuard } = require("./ai-moderation");

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

/**
 * Build a Components V2 container for a member welcome/goodbye embed.
 *
 * Mirrors the old EmbedBuilder layout but as V2: title → `#` heading,
 * description → body, fields → bold label blocks, banner → MediaGallery,
 * footer → subtext. `resolve` runs the {user}/{server} placeholder swap on
 * every text field. Returns the raw container object — the caller sends it
 * with the IS_COMPONENTS_V2 flag.
 */
function buildMemberV2Container(cfg, resolve, hasBanner) {
  const colorInt = parseInt((cfg.color ?? "#6366f1").replace("#", ""), 16);
  const components = [];

  const title = resolve(cfg.title ?? "");
  if (title) components.push({ type: 10, content: `# ${title}` });

  const description = resolve(cfg.description ?? "");
  if (description) components.push({ type: 10, content: description });

  if (Array.isArray(cfg.fields) && cfg.fields.length > 0) {
    const fieldText = cfg.fields
      .filter((f) => f && (f.name || f.value))
      .map((f) => `**${resolve(f.name ?? "")}**\n${resolve(f.value ?? "")}`)
      .join("\n\n");
    if (fieldText) components.push({ type: 10, content: fieldText });
  }

  // Banner — MediaGallery (type 12) referencing the attached banner.png.
  if (hasBanner) {
    components.push({
      type: 12,
      items: [{ media: { url: "attachment://banner.png" } }],
    });
  }

  if (cfg.footer_text) {
    components.push({ type: 10, content: `-# ${resolve(cfg.footer_text)}` });
  }

  return {
    type: 17,
    accent_color: isNaN(colorInt) ? 0x6366f1 : colorInt,
    components,
  };
}

// Only commands that bridge to the Pulsify web app. User-facing slash
// commands (ping, stats, warn, etc.) were removed — moderators handle all
// of that from the dashboard now. Keep `/sync` because it's the manual
// trigger when the automatic `GuildCreate` sync gets missed.
const commands = [
  new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Sync this server's data to the Pulse dashboard")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[Pulse] Logged in as ${readyClient.user.tag}`);

  readyClient.user.setPresence({
    activities: [{ name: "Powered by Pulsify" }],
    status: "online",
  });

  // Per-guild command registration: stale commands (ping/stats/warn/…) that
  // were previously registered globally take up to an hour to disappear, so
  // we wipe the global list AND register the minimal set per guild. Per-guild
  // commands propagate in seconds.
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationCommands(readyClient.user.id), { body: [] });
  console.log("[Pulse] Cleared global slash commands.");

  for (const guild of readyClient.guilds.cache.values()) {
    await rest
      .put(Routes.applicationGuildCommands(readyClient.user.id, guild.id), {
        body: commands,
      })
      .catch((err) =>
        console.warn(
          `[Pulse] Failed to register commands for guild ${guild.id}:`,
          err.message,
        ),
      );
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
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`[Pulse] Joined guild: ${guild.name}`);
  // Register commands per-guild so the new server gets them immediately.
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  await rest
    .put(Routes.applicationGuildCommands(client.user.id, guild.id), {
      body: commands,
    })
    .catch((err) =>
      console.warn(
        `[Pulse] Failed to register commands for guild ${guild.id}:`,
        err.message,
      ),
    );
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
          const container = buildMemberV2Container(cfg, resolve, hasBanner);
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
          const container = buildMemberV2Container(cfg, resolve, hasBanner);
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
      const embed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("Member Banned")
        .setDescription(`**${ban.user.tag}** (${ban.user.id}) was banned.`)
        .addFields({
          name: "Reason",
          value: ban.reason ?? "No reason provided",
        })
        .setTimestamp();
      await channel.send({ embeds: [embed] }).catch(console.error);
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
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("Member Unbanned")
        .setDescription(`**${ban.user.tag}** (${ban.user.id}) was unbanned.`)
        .setTimestamp();
      await channel.send({ embeds: [embed] }).catch(console.error);
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

  const { commandName } = interaction;

  analytics.track({
    type: "command",
    guildId: interaction.guildId,
    userId: interaction.user.id,
    userName: interaction.user.username,
    channelId: interaction.channelId,
    metadata: { command: commandName },
  });

  if (commandName === "sync") {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    if (!guild) return;
    await syncGuild(guild);
    await interaction.editReply(
      "Server data synced to the Pulse dashboard successfully.",
    );
    return;
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

client.login(process.env.DISCORD_BOT_TOKEN);

// Channel commands — bot side (PULSIFY-61).
//
// /channel lock · /channel unlock · /channel slowmode · /channel stats
//
// `module: null` — these are Discord-native channel controls, not tied to any
// toggleable Pulsify feature. Discord's own Manage Channels permission plus the
// moderator tier are the gate.
//
// ── What "lock" means ────────────────────────────────────────────────────────
// Denying SendMessages to @everyone on the channel, which is what every Discord
// moderator means by locking. Deliberately NOT touching per-role overrides: a
// server that grants SendMessages explicitly to a Moderator role keeps it, so
// staff can still coordinate in a locked channel. That's the behaviour people
// expect and the reason we edit exactly one override rather than sweeping.
//
// Unlock RESETS the @everyone SendMessages override to neutral (null) rather
// than setting it to allow. Those are different states: neutral means "inherit
// from the category / @everyone role", allow means "explicitly permitted here".
// Setting allow would silently override a category-level deny the admin had set
// on purpose, and there'd be no way back through the command.

const { MessageFlags, PermissionFlagsBits, ChannelType } = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  editNotice,
  text,
  divider,
} = require("./commands");
const { recordModerationAction, actorFrom } = require("./moderation-log");

// Discord's slowmode ceiling: 6 hours, in seconds.
const SLOWMODE_MAX_SECONDS = 21600;

// Presets for /channel slowmode's autocomplete. 0 is first — turning it off is
// the most common reason to run the command a second time.
const SLOWMODE_PRESETS = [
  { name: "Off", value: 0 },
  { name: "5 seconds", value: 5 },
  { name: "10 seconds", value: 10 },
  { name: "30 seconds", value: 30 },
  { name: "1 minute", value: 60 },
  { name: "2 minutes", value: 120 },
  { name: "5 minutes", value: 300 },
  { name: "10 minutes", value: 600 },
  { name: "15 minutes", value: 900 },
  { name: "30 minutes", value: 1800 },
  { name: "1 hour", value: 3600 },
  { name: "2 hours", value: 7200 },
  { name: "6 hours (max)", value: SLOWMODE_MAX_SECONDS },
];

/** Channel types that can carry messages, a lock, or slowmode. */
const TEXTUAL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
  ChannelType.GuildForum,
  ChannelType.GuildVoice, // voice channels have a text chat too
];

const STATS_DAYS = 30;

function humaniseSeconds(s) {
  if (s === 0) return "off";
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h} hour${h === 1 ? "" : "s"}`;
}

function createChannels({ client, supabase }) {
  function botCanManage(guild) {
    return guild.members.me?.permissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
  }

  /**
   * Resolve the target channel: the `channel` option, or the current one. Returns
   * `{ channel }` or `{ error }`.
   */
  function resolveChannel(interaction, { requireTextual = true } = {}) {
    const picked = interaction.options.getChannel("channel");
    const channel = picked ?? interaction.channel;
    if (!channel) return { error: "I couldn't work out which channel you mean." };
    if (requireTextual && !TEXTUAL_TYPES.includes(channel.type)) {
      return { error: `<#${channel.id}> isn't a channel that can carry messages.` };
    }
    return { channel };
  }

  /**
   * Whether the bot can edit permissions on this specific channel. Guild-level
   * Manage Channels isn't enough — a channel override can revoke it, and the
   * failure then arrives as an opaque 403.
   */
  function botCanEditChannel(guild, channel) {
    const me = guild.members.me;
    if (!me) return false;
    const perms = channel.permissionsFor?.(me);
    return perms?.has(PermissionFlagsBits.ManageChannels) ?? false;
  }

  async function replyAction(interaction, guild, { title, lines, footer }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    await interaction
      .editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          buildPulseContainer({ colorHex, title, body: [text(lines.join("\n"))], footer }),
        ],
      })
      .catch(() => {});
  }

  const auditReason = (interaction, extra) =>
    `${interaction.user.username}${extra ? `: ${extra}` : ""}`.slice(0, 500);

  // ── /channel lock ──────────────────────────────────────────────────────────

  async function handleLock({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const { channel, error } = resolveChannel(interaction);
    if (error) return editNotice(interaction, error);
    const reason = interaction.options.getString("reason")?.trim() || null;

    if (!botCanManage(guild) || !botCanEditChannel(guild, channel)) {
      return editNotice(
        interaction,
        `I need the Manage Channels permission in <#${channel.id}> to lock it.`,
      );
    }

    const everyone = guild.roles.everyone;
    const current = channel.permissionOverwrites?.cache?.get(everyone.id);
    if (current?.deny?.has(PermissionFlagsBits.SendMessages)) {
      return editNotice(interaction, `<#${channel.id}> is already locked.`);
    }

    try {
      await channel.permissionOverwrites.edit(
        everyone,
        { SendMessages: false },
        { reason: auditReason(interaction, reason ?? "Channel locked") },
      );
    } catch (err) {
      console.error(`[Pulse] /channel lock failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that. Check my permissions in that channel.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "channel_lock",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: null,
      reason,
      metadata: { channel_id: channel.id, channel_name: channel.name ?? null },
    });

    await replyAction(interaction, guild, {
      title: "Channel locked",
      lines: [
        `**Channel** — <#${channel.id}>`,
        reason ? `**Reason** — ${reason}` : "",
        "-# Members can no longer send messages. Roles with an explicit allow still can.",
      ].filter(Boolean),
      footer: "Pulse — Channels",
    });
  }

  // ── /channel unlock ────────────────────────────────────────────────────────

  async function handleUnlock({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const { channel, error } = resolveChannel(interaction);
    if (error) return editNotice(interaction, error);
    const reason = interaction.options.getString("reason")?.trim() || null;

    if (!botCanManage(guild) || !botCanEditChannel(guild, channel)) {
      return editNotice(
        interaction,
        `I need the Manage Channels permission in <#${channel.id}> to unlock it.`,
      );
    }

    const everyone = guild.roles.everyone;
    const current = channel.permissionOverwrites?.cache?.get(everyone.id);
    if (!current?.deny?.has(PermissionFlagsBits.SendMessages)) {
      return editNotice(interaction, `<#${channel.id}> isn't locked.`);
    }

    try {
      // null = clear the override back to neutral, NOT allow. See the note at the
      // top of this file: allow would trample a deliberate category-level deny.
      await channel.permissionOverwrites.edit(
        everyone,
        { SendMessages: null },
        { reason: auditReason(interaction, reason ?? "Channel unlocked") },
      );
    } catch (err) {
      console.error(`[Pulse] /channel unlock failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that. Check my permissions in that channel.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "channel_unlock",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: null,
      reason,
      metadata: { channel_id: channel.id, channel_name: channel.name ?? null },
    });

    await replyAction(interaction, guild, {
      title: "Channel unlocked",
      lines: [
        `**Channel** — <#${channel.id}>`,
        reason ? `**Reason** — ${reason}` : "",
        "-# Send Messages is back to inheriting from the category.",
      ].filter(Boolean),
      footer: "Pulse — Channels",
    });
  }

  // ── /channel slowmode ──────────────────────────────────────────────────────

  async function handleSlowmode({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const { channel, error } = resolveChannel(interaction);
    if (error) return editNotice(interaction, error);
    const seconds = interaction.options.getInteger("seconds", true);

    if (seconds < 0 || seconds > SLOWMODE_MAX_SECONDS) {
      return editNotice(interaction, "Slowmode must be between 0 and 21600 seconds (6 hours).");
    }
    if (!botCanManage(guild) || !botCanEditChannel(guild, channel)) {
      return editNotice(
        interaction,
        `I need the Manage Channels permission in <#${channel.id}> to set slowmode.`,
      );
    }
    if (typeof channel.setRateLimitPerUser !== "function") {
      return editNotice(interaction, `<#${channel.id}> doesn't support slowmode.`);
    }

    try {
      await channel.setRateLimitPerUser(seconds, auditReason(interaction, "Slowmode changed"));
    } catch (err) {
      console.error(`[Pulse] /channel slowmode failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "Discord refused that. Check my permissions in that channel.");
    }

    await recordModerationAction(supabase, {
      guildId: guild.id,
      action: "channel_slowmode",
      moderator: actorFrom(interaction.member ?? interaction.user),
      target: null,
      reason: null,
      metadata: { channel_id: channel.id, channel_name: channel.name ?? null, seconds },
    });

    await replyAction(interaction, guild, {
      title: seconds === 0 ? "Slowmode turned off" : "Slowmode set",
      lines: [
        `**Channel** — <#${channel.id}>`,
        seconds === 0
          ? "-# Members can send messages without a wait."
          : `**Wait** — ${humaniseSeconds(seconds)} between messages`,
      ],
      footer: "Pulse — Channels",
    });
  }

  async function autocompleteSlowmode({ interaction }) {
    const focused = String(interaction.options.getFocused() ?? "").toLowerCase();
    const matches = SLOWMODE_PRESETS.filter((p) => p.name.toLowerCase().includes(focused));
    await interaction.respond(matches.slice(0, 25));
  }

  // ── /channel stats ─────────────────────────────────────────────────────────

  async function handleStats({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    // Stats read `analytics_events`, which records a row per message/command
    // with its channel — so any channel type can be summarised, not just textual
    // ones.
    const { channel, error } = resolveChannel(interaction, { requireTextual: false });
    if (error) return editNotice(interaction, error);

    const since = new Date(Date.now() - STATS_DAYS * 86_400_000).toISOString();
    const { data, error: readError } = await supabase
      .from("analytics_events")
      .select("event_type, user_id, created_at")
      .eq("guild_id", guild.id)
      .eq("channel_id", channel.id)
      .gte("created_at", since)
      .limit(10000);

    if (readError) {
      console.error(`[Pulse] /channel stats read failed in ${guild.id}:`, readError.message);
      return editNotice(interaction, "I couldn't load stats for that channel. Try again shortly.");
    }

    const rows = data ?? [];
    const messages = rows.filter((r) => r.event_type === "message").length;
    const commands = rows.filter((r) => r.event_type === "command").length;
    const people = new Set(rows.map((r) => r.user_id).filter(Boolean)).size;
    const perDay = messages / STATS_DAYS;

    // Busiest day, so the number has some shape rather than just a total.
    const byDay = new Map();
    for (const r of rows) {
      if (r.event_type !== "message") continue;
      const day = String(r.created_at).slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    let busiest = null;
    for (const [day, count] of byDay) {
      if (!busiest || count > busiest.count) busiest = { day, count };
    }

    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("channel", colorHex);

    const body = [];
    if (rows.length === 0) {
      body.push(text(`No recorded activity in <#${channel.id}> over the last ${STATS_DAYS} days.`));
      body.push(
        text("-# Pulse only counts activity since it joined — a quiet number here may just mean it's new."),
      );
    } else {
      body.push(
        text(
          [
            `**Messages** — ${messages.toLocaleString()}`,
            `**Commands** — ${commands.toLocaleString()}`,
            `**People active** — ${people.toLocaleString()}`,
            `**Daily average** — ${perDay.toFixed(1)} message${perDay === 1 ? "" : "s"}`,
          ].join("\n"),
        ),
      );
      if (busiest) {
        body.push(
          text(`**Busiest day** — ${busiest.day} (${busiest.count.toLocaleString()} messages)`),
        );
      }
      body.push(divider());
      const slow = channel.rateLimitPerUser ?? 0;
      body.push(
        text(
          [
            `**Slowmode** — ${humaniseSeconds(slow)}`,
            channel.nsfw !== undefined ? `**Age-restricted** — ${channel.nsfw ? "Yes" : "No"}` : "",
            channel.parent ? `**Category** — ${channel.parent.name}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
      body.push(text(`-# Last ${STATS_DAYS} days`));
    }

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: `#${channel.name}`,
          subtitle: `Pulse — ${guild.name}`,
          body,
          footer: "Pulse — Channels",
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  return {
    handleLock,
    handleUnlock,
    handleSlowmode,
    handleStats,
    autocompleteSlowmode,
  };
}

module.exports = {
  createChannels,
  humaniseSeconds,
  SLOWMODE_MAX_SECONDS,
  SLOWMODE_PRESETS,
  TEXTUAL_TYPES,
};

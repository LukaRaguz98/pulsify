// Pulse slash-command catalog (bot side).
//
// This MIRRORS pulsify-web-app/lib/commands.ts — keep names, categories and
// default permissions in sync. The web catalog drives the dashboard; this one
// drives registration + execution. Per-server overrides live in the
// `command_configs` table and are applied by command-center.js.

const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const PERMISSION = { EVERYONE: "everyone", MODERATOR: "moderator", ADMIN: "admin" };
const ACCENT = 0x8b5cf6;
const DEFAULT_PULSE_COLOR = "#8b5cf6";

// ── Themed Components V2 helpers ─────────────────────────────────────────────
// Every command reply uses the same look as /sync: a header Section carrying a
// thumbnail (the Pulse badge, or — for server/user info — the server icon /
// member avatar), the body, and a subtle `-# Pulse · …` footer. The Pulse
// badge is fetched from the web app's tint endpoint (one shared recolour
// pipeline) and falls back to the bundled PNG so a reply always renders. Keep
// emoji out — the accent bar + glyph carry the branding.

const SYNC_ICON_NAME = "pulse-sync.png";
const ICON_FILES = {
  sync: "pulse-sync.png",
  stats: "pulse-stats.png",
  info: "pulse-info.png",
  help: "pulse-help.png",
};
const localIconCache = {};

const VERIFICATION_LABELS = ["None", "Low", "Medium", "High", "Highest"];
const EXPLICIT_FILTER_LABELS = ["Disabled", "Members without roles", "All members"];

// Notable permissions surfaced by /userinfo, in priority order.
const KEY_PERMISSIONS = [
  [PermissionFlagsBits.Administrator, "Administrator"],
  [PermissionFlagsBits.ManageGuild, "Manage Server"],
  [PermissionFlagsBits.ManageRoles, "Manage Roles"],
  [PermissionFlagsBits.ManageChannels, "Manage Channels"],
  [PermissionFlagsBits.BanMembers, "Ban Members"],
  [PermissionFlagsBits.KickMembers, "Kick Members"],
  [PermissionFlagsBits.ModerateMembers, "Timeout Members"],
  [PermissionFlagsBits.ManageMessages, "Manage Messages"],
  [PermissionFlagsBits.MentionEveryone, "Mention Everyone"],
];

const text = (content) => ({ type: 10, content });
const divider = () => ({ type: 14, divider: true, spacing: 1 });

// Discord auto-sizes a container to its widest line, so short replies (e.g.
// /help with a single category) end up narrower than the data-heavy ones. This
// invisible run of Braille-blank chars (U+2800 — unlike a normal space it
// occupies width and isn't trimmed) pins every embed to the same comfortable
// width. Rendered as small subtext so it adds almost no height.
const WIDTH_SPACER = "⠀".repeat(44);
const widthSpacer = () => text(`-# ${WIDTH_SPACER}`);

/** Compact human-readable duration: "3h 12m", "45m", "30s", "0m". */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (s < 60) return s === 0 ? "0m" : `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

const n = (v) => Number(v ?? 0);

/** Read the guild's configured Pulse Guard accent colour, defaulting to violet. */
async function getPulseColor(supabase, guildId) {
  try {
    const { data } = await supabase
      .from("ai_moderation_settings")
      .select("settings")
      .eq("guild_id", guildId)
      .maybeSingle();
    const color = data?.settings?.embed_color;
    return /^#[0-9a-fA-F]{6}$/.test(color ?? "") ? color : DEFAULT_PULSE_COLOR;
  } catch {
    return DEFAULT_PULSE_COLOR;
  }
}

/**
 * Resolve a Pulse badge as a Discord attachment: the web app's tinted endpoint
 * first (recoloured to the guild accent, bounded by a short timeout so the 3s
 * interaction window is safe), falling back to the bundled PNG. `iconKey` is
 * one of ICON_FILES.
 */
async function loadPulseIcon(iconKey, colorHex) {
  const name = ICON_FILES[iconKey];
  if (!name) return null;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const hex = colorHex.replace("#", "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${appUrl}/api/pulse-icon?icon=${iconKey}&color=${hex}`, {
      signal: controller.signal,
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { attachment: buf, name };
    }
  } catch {
    // fall through to the bundled icon
  } finally {
    clearTimeout(timer);
  }
  try {
    if (!localIconCache[iconKey]) {
      localIconCache[iconKey] = await readFile(path.join(__dirname, "..", "resources", name));
    }
    return { attachment: localIconCache[iconKey], name };
  } catch {
    return null;
  }
}

/**
 * Build a themed Components V2 container. `body` is an array of pre-built V2
 * components (use text()/divider()). `iconUrl` is the header thumbnail — either
 * an `attachment://<name>` reference or an external https URL (server icon /
 * avatar). When omitted the header renders without a thumbnail.
 */
function buildPulseContainer({ iconUrl, colorHex, title, subtitle, body = [], footer }) {
  const colorInt = parseInt(colorHex.replace("#", ""), 16);
  const components = [];

  const headerLines = [text(`**Pulse**`), text(`# ${title}`)];
  if (subtitle) headerLines.push(text(`-# ${subtitle}`));
  if (iconUrl) {
    components.push({
      type: 9,
      components: headerLines,
      accessory: { type: 11, media: { url: iconUrl }, description: "Pulse" },
    });
  } else {
    components.push(...headerLines);
  }

  // Pin all embeds to a consistent, comfortable width.
  components.push(widthSpacer());

  for (const c of body) components.push(c);
  if (footer) components.push(text(`-# ${footer}`));

  return {
    type: 17,
    accent_color: Number.isNaN(colorInt) ? ACCENT : colorInt,
    components,
  };
}

/** /sync keeps its own body (members + status + sync blurb) but the same shell. */
function buildSyncContainer(guild, colorHex, hasIcon) {
  const unix = Math.floor(Date.now() / 1000);
  return buildPulseContainer({
    iconUrl: hasIcon ? `attachment://${SYNC_ICON_NAME}` : null,
    colorHex,
    title: "Server synced",
    subtitle: guild.name,
    body: [
      text(
        `**Members:** ${guild.memberCount.toLocaleString()}\n` +
          `**Channels:** ${guild.channels.cache.size}\n` +
          `**Roles:** ${guild.roles.cache.size}\n` +
          `**Status:** Up to date`,
      ),
      divider(),
      text(
        "This server's data is now available on the Pulse dashboard. Analytics, moderation, and automations stay in sync from here.",
      ),
    ],
    footer: `Pulse · Synced <t:${unix}:R>`,
  });
}

/**
 * Reply with a themed V2 container + its (optional) icon attachment.
 * `ephemeral` (default true) decides whether only the invoker sees the reply
 * or it's posted publicly in the channel — configured per command in the
 * dashboard Command Center.
 */
async function replyContainer(interaction, container, file, ephemeral = true) {
  await interaction.reply({
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    components: [container],
    files: file ? [file] : [],
  });
}

const CATEGORY_LABELS = {
  utility: "Utility",
  information: "Information",
  insights: "Insights",
  moderation: "Moderation",
};

// ── Catalog ──────────────────────────────────────────────────────────────────
const COMMANDS = [
  {
    name: "help",
    category: "utility",
    defaultPermission: PERMISSION.EVERYONE,
    data: new SlashCommandBuilder()
      .setName("help")
      .setDescription("List the commands available to you in this server"),
    async execute({ interaction, guild, supabase, getAllowedCommands, ephemeral }) {
      const colorHex = await getPulseColor(supabase, guild.id);
      const icon = await loadPulseIcon("help", colorHex);
      const allowed = await getAllowedCommands(supabase, guild, interaction.member);

      const byCategory = new Map();
      for (const entry of allowed) {
        if (!byCategory.has(entry.def.category)) byCategory.set(entry.def.category, []);
        byCategory.get(entry.def.category).push(entry);
      }

      const body = [];
      if (allowed.length === 0) {
        body.push(text("You don't have access to any commands here right now."));
      } else {
        body.push(
          text(
            `You can run **${allowed.length}** command${allowed.length === 1 ? "" : "s"} in this server. ` +
              `Arguments shown as \`<required>\` or \`[optional]\`.`,
          ),
        );
        for (const [category, entries] of byCategory) {
          const lines = entries
            .map(({ def, config }) => {
              const opts = (def.data.toJSON().options ?? [])
                .map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`))
                .join(" ");
              const usage = `\`/${def.name}${opts ? ` ${opts}` : ""}\``;
              const level =
                config.permission_level === "inherit" ? def.defaultPermission : config.permission_level;
              const tag = level === "admin" ? " *(Admins)*" : level === "moderator" ? " *(Mods)*" : "";
              return `${usage} — ${def.data.description}${tag}`;
            })
            .join("\n");
          body.push(divider());
          body.push(text(`**${CATEGORY_LABELS[category] ?? category}**\n${lines}`));
        }
      }

      await replyContainer(
        interaction,
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Commands",
          subtitle: guild.name,
          body,
          footer: "Pulse · Tip: managed from the dashboard Command Center",
        }),
        icon,
        ephemeral,
      );
    },
  },
  {
    name: "serverinfo",
    category: "information",
    defaultPermission: PERMISSION.EVERYONE,
    data: new SlashCommandBuilder()
      .setName("serverinfo")
      .setDescription("Show stats and details about this server"),
    async execute({ interaction, guild, supabase, ephemeral }) {
      const colorHex = await getPulseColor(supabase, guild.id);

      // Header thumbnail: the server's own icon. Fall back to the Pulse badge
      // (tinted) for servers without an icon.
      let iconUrl = guild.iconURL({ size: 128 });
      let file = null;
      if (!iconUrl) {
        file = await loadPulseIcon("info", colorHex);
        iconUrl = file ? `attachment://${file.name}` : null;
      }

      const created = Math.floor(guild.createdTimestamp / 1000);

      // Member split is only shown when the member cache is complete (it is on
      // most servers — the bot fetches members on join/ready) so we never print
      // a misleading bot count from a partial cache.
      let membersLine = `**Members:** ${guild.memberCount.toLocaleString()}`;
      const memberCache = guild.members.cache;
      if (memberCache.size >= guild.memberCount && guild.memberCount > 0) {
        const bots = memberCache.filter((m) => m.user.bot).size;
        membersLine =
          `**Members:** ${guild.memberCount.toLocaleString()} — ` +
          `${(guild.memberCount - bots).toLocaleString()} humans · ${bots.toLocaleString()} bots`;
      }

      const ch = guild.channels.cache;
      const cnt = (type) => ch.filter((c) => c.type === type).size;
      const parts = [
        `${cnt(ChannelType.GuildText)} text`,
        `${cnt(ChannelType.GuildVoice)} voice`,
        `${cnt(ChannelType.GuildCategory)} categories`,
      ];
      if (cnt(ChannelType.GuildAnnouncement)) parts.push(`${cnt(ChannelType.GuildAnnouncement)} news`);
      if (cnt(ChannelType.GuildStageVoice)) parts.push(`${cnt(ChannelType.GuildStageVoice)} stage`);
      if (cnt(ChannelType.GuildForum)) parts.push(`${cnt(ChannelType.GuildForum)} forum`);

      const settings = [
        `**Boost status:** Tier ${guild.premiumTier} · ${guild.premiumSubscriptionCount ?? 0} boosts`,
        `**Verification:** ${VERIFICATION_LABELS[guild.verificationLevel] ?? "Unknown"}`,
        `**Content filter:** ${EXPLICIT_FILTER_LABELS[guild.explicitContentFilter] ?? "Unknown"}`,
        `**AFK:** ${
          guild.afkChannelId ? `<#${guild.afkChannelId}> after ${formatDuration(guild.afkTimeout)}` : "Not set"
        }`,
      ];
      if (guild.vanityURLCode) settings.push(`**Vanity URL:** discord.gg/${guild.vanityURLCode}`);

      const body = [
        text(
          `**Owner:** <@${guild.ownerId}>\n` +
            `${membersLine}\n` +
            `**Created:** <t:${created}:F> (<t:${created}:R>)\n` +
            `**Locale:** ${guild.preferredLocale}`,
        ),
        divider(),
        text(
          `**Channels:** ${ch.size} — ${parts.join(" · ")}\n` +
            `**Roles:** ${guild.roles.cache.size}\n` +
            `**Emojis:** ${guild.emojis.cache.size} · **Stickers:** ${guild.stickers.cache.size}\n` +
            `**Scheduled events:** ${guild.scheduledEvents.cache.size}`,
        ),
        divider(),
        text(settings.join("\n")),
      ];
      if (guild.description) {
        body.push(divider());
        body.push(text(`-# ${guild.description}`));
      }

      await replyContainer(
        interaction,
        buildPulseContainer({
          iconUrl,
          colorHex,
          title: "Server info",
          subtitle: guild.name,
          body,
          footer: `Pulse · Server ID ${guild.id}`,
        }),
        file,
        ephemeral,
      );
    },
  },
  {
    name: "userinfo",
    category: "information",
    defaultPermission: PERMISSION.EVERYONE,
    data: new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("Show information about a member")
      .addUserOption((o) =>
        o.setName("user").setDescription("The member to look up (defaults to you)").setRequired(false),
      ),
    async execute({ interaction, guild, supabase, ephemeral }) {
      const colorHex = await getPulseColor(supabase, guild.id);
      const user = interaction.options.getUser("user") ?? interaction.user;
      // Full fetch to expose the banner; falls back to the partial user object.
      const full = await user.fetch().catch(() => null);
      const member = await guild.members.fetch(user.id).catch(() => null);
      const created = Math.floor(user.createdTimestamp / 1000);

      // Header thumbnail: the member's server avatar (falls back to their
      // global avatar, then Discord's default — always a valid URL).
      const avatarUrl = (member ?? user).displayAvatarURL({ size: 256 });
      const bannerUrl = full?.bannerURL ? full.bannerURL({ size: 512 }) : null;

      const body = [
        text(
          `**Username:** @${user.username}\n` +
            `**Mention:** <@${user.id}>\n` +
            `**Account type:** ${user.bot ? "Bot" : "Human"}\n` +
            `**Account created:** <t:${created}:F> (<t:${created}:R>)`,
        ),
      ];

      if (member) {
        const memberLines = [];
        if (member.joinedTimestamp) {
          const j = Math.floor(member.joinedTimestamp / 1000);
          memberLines.push(`**Joined server:** <t:${j}:F> (<t:${j}:R>)`);
        }
        if (member.id === guild.ownerId) memberLines.push(`**Server owner:** Yes`);
        if (member.nickname) memberLines.push(`**Nickname:** ${member.nickname}`);
        const highest = member.roles.highest;
        if (highest && highest.id !== guild.id) memberLines.push(`**Highest role:** <@&${highest.id}>`);
        if (member.premiumSinceTimestamp) {
          memberLines.push(`**Boosting since:** <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`);
        }
        const timeout = member.communicationDisabledUntilTimestamp;
        if (timeout && timeout > Date.now()) {
          memberLines.push(`**Timed out until:** <t:${Math.floor(timeout / 1000)}:R>`);
        }
        if (memberLines.length > 0) {
          body.push(divider());
          body.push(text(memberLines.join("\n")));
        }

        const keyPerms = KEY_PERMISSIONS.filter(([bit]) => member.permissions.has(bit)).map(
          ([, label]) => label,
        );
        if (keyPerms.length > 0) {
          body.push(divider());
          body.push(text(`**Key permissions:** ${keyPerms.join(", ")}`));
        }

        const roles = member.roles.cache
          .filter((r) => r.id !== guild.id)
          .sort((a, b) => b.position - a.position);
        body.push(divider());
        body.push(
          text(
            `**Roles (${roles.size}):** ${
              roles.size > 0 ? roles.map((r) => `<@&${r.id}>`).slice(0, 20).join(" ") : "None"
            }`,
          ),
        );
      } else {
        body.push(divider());
        body.push(text("-# This user isn't a member of this server."));
      }

      const links = [`[Avatar](${avatarUrl})`];
      if (bannerUrl) links.push(`[Banner](${bannerUrl})`);
      body.push(text(`-# ${links.join(" · ")}`));

      await replyContainer(
        interaction,
        buildPulseContainer({
          iconUrl: avatarUrl,
          colorHex,
          title: user.globalName ?? user.username,
          subtitle: `@${user.username}`,
          body,
          footer: `Pulse · User ID ${user.id}`,
        }),
        null,
        ephemeral,
      );
    },
  },
  {
    name: "stats",
    category: "insights",
    defaultPermission: PERMISSION.MODERATOR,
    data: new SlashCommandBuilder()
      .setName("stats")
      .setDescription("Show this server's recent activity summary"),
    async execute({ interaction, guild, supabase, ephemeral }) {
      const colorHex = await getPulseColor(supabase, guild.id);
      const icon = await loadPulseIcon("stats", colorHex);

      const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [day, week] = await Promise.all([
        supabase.rpc("get_analytics_summary", { p_guild_id: guild.id, p_since: since24 }),
        supabase.rpc("get_analytics_summary", { p_guild_id: guild.id, p_since: since7d }),
      ]);
      const d = day.data?.[0] ?? {};
      const w = week.data?.[0] ?? {};
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";

      const summary = (label, s) => {
        const joins = n(s.member_joins);
        const leaves = n(s.member_leaves);
        const net = joins - leaves;
        return text(
          `**${label}**\n` +
            `**Messages:** ${n(s.total_messages).toLocaleString()} · **Active members:** ${n(s.active_users).toLocaleString()}\n` +
            `**Joins:** ${joins.toLocaleString()} · **Leaves:** ${leaves.toLocaleString()} (net ${net >= 0 ? "+" : ""}${net.toLocaleString()})\n` +
            `**Commands:** ${n(s.total_commands).toLocaleString()} · **Mod actions:** ${n(s.total_mod_actions).toLocaleString()}\n` +
            `**Voice time:** ${formatDuration(n(s.voice_seconds))}`,
        );
      };

      await replyContainer(
        interaction,
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Activity",
          subtitle: guild.name,
          body: [
            summary("Last 24 hours", d),
            divider(),
            summary("Last 7 days", w),
            divider(),
            text(`[Open the full analytics dashboard →](${appUrl}/dashboard/${guild.id}/statistics)`),
          ],
          footer: "Pulse · Live server analytics",
        }),
        icon,
        ephemeral,
      );
    },
  },
  {
    name: "sync",
    category: "utility",
    defaultPermission: PERMISSION.ADMIN,
    data: new SlashCommandBuilder()
      .setName("sync")
      .setDescription("Sync this server's data to the Pulse dashboard"),
    async execute({ interaction, guild, supabase, syncGuild, ephemeral }) {
      const colorHex = await getPulseColor(supabase, guild.id);
      const icon = await loadPulseIcon("sync", colorHex);
      try {
        await replyContainer(interaction, buildSyncContainer(guild, colorHex, !!icon), icon, ephemeral);
      } catch (err) {
        console.warn(`[Pulse] /sync reply failed for guild ${guild.id}:`, err.message);
      }
      await syncGuild(guild);
    },
  },
  {
    name: "ticket",
    category: "utility",
    defaultPermission: PERMISSION.EVERYONE,
    data: new SlashCommandBuilder()
      .setName("ticket")
      .setDescription("Open a support ticket"),
    // Delegates to the ticket module (passed in via the execute context from
    // index.js) which presents an ephemeral type picker, then opens a private
    // channel. See pulse-bot/src/tickets.js.
    async execute({ interaction, tickets }) {
      if (!tickets) {
        await interaction.reply({ content: "The ticket system is unavailable right now.", flags: MessageFlags.Ephemeral });
        return;
      }
      await tickets.handleTicketCommand(interaction);
    },
  },
];

const COMMANDS_BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

/** Discord's default-member-permissions bitfield for a baseline access level. */
function defaultMemberPermissionsFor(level) {
  switch (level) {
    case "admin":
      return PermissionFlagsBits.ManageGuild;
    case "moderator":
      return PermissionFlagsBits.ManageMessages;
    default:
      return null; // everyone
  }
}

module.exports = {
  PERMISSION,
  COMMANDS,
  COMMANDS_BY_NAME,
  defaultMemberPermissionsFor,
};

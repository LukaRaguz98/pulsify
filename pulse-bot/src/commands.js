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
const {
  getLatestRelease,
  getReleaseByVersion,
  getReleaseNotesUrl,
  getDashboardUrl,
  getInviteUrl,
} = require("./version");
const { computeReputation, daysSince } = require("./reputation");

const PERMISSION = {
  EVERYONE: "everyone",
  MODERATOR: "moderator",
  ADMIN: "admin",
};
const ACCENT = 0x8b5cf6;
const DEFAULT_PULSE_COLOR = "#8b5cf6";

// ── Themed Components V2 helpers ─────────────────────────────────────────────
// Every command reply shares one look: a header Section carrying a
// thumbnail (the Pulse badge, or — for server/user info — the server icon /
// member avatar), the body, and a subtle `-# Pulse · …` footer. The Pulse
// badge is fetched from the web app's tint endpoint (one shared recolour
// pipeline) and falls back to the bundled PNG so a reply always renders. Keep
// emoji out — the accent bar + glyph carry the branding.

const ICON_FILES = {
  help: "pulse-help.png",
  announcement: "pulse-annoucement.png",
};
const localIconCache = {};

const VERIFICATION_LABELS = ["None", "Low", "Medium", "High", "Highest"];
const EXPLICIT_FILTER_LABELS = [
  "Disabled",
  "Members without roles",
  "All members",
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
    const res = await fetch(
      `${appUrl}/api/pulse-icon?icon=${iconKey}&color=${hex}`,
      {
        signal: controller.signal,
      },
    );
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
      localIconCache[iconKey] = await readFile(
        path.join(__dirname, "..", "resources", name),
      );
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
function buildPulseContainer({
  iconUrl,
  colorHex,
  title,
  subtitle,
  body = [],
  footer,
  noSpacer = false,
}) {
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

  // Pin most embeds to a consistent, comfortable width. Skipped for embeds that
  // carry a full-width image (e.g. /profile's banner) so the image alone defines
  // the width instead of an artificial minimum.
  if (!noSpacer) components.push(widthSpacer());

  for (const c of body) components.push(c);
  if (footer) components.push(text(`-# ${footer}`));

  return {
    type: 17,
    accent_color: Number.isNaN(colorInt) ? ACCENT : colorInt,
    components,
  };
}

/**
 * Reply with a themed V2 container + its (optional) icon attachment.
 * `ephemeral` (default true) decides whether only the invoker sees the reply
 * or it's posted publicly in the channel — configured per command in the
 * dashboard Command Center.
 */
async function replyContainer(interaction, container, file, ephemeral = true) {
  await interaction.reply({
    flags:
      MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    components: [container],
    files: file ? [file] : [],
  });
}

// ── Version / update embed helpers ───────────────────────────────────────────
// Shared by /version, /changelog, /release-notes and /announce-update so every
// update surface carries the same branding + the same quick links.

// Show the FULL changelog — every highlight, in full. The caps below only guard
// against pathological releases bumping into Discord's component limits; real
// releases sit comfortably under them, so nothing gets trimmed in practice.
const HIGHLIGHT_MAX = 25; // hard safety cap on bullet count
const HIGHLIGHT_LINE_MAX = 320; // per-bullet character cap (generous — full text)

/** Truncate to `max` chars on a word boundary, adding an ellipsis when cut. */
function truncate(str, max) {
  if (!str || str.length <= max) return str ?? "";
  return `${str.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Lead paragraph rendered a notch larger than body text (a Discord `###`
 * subheading) so the description under the title stands out and the embed reads
 * better. Kept smaller than the `#` title so the hierarchy holds.
 */
const lead = (content) => text(`### ${content}`);

/**
 * The three link buttons every update embed carries. Link buttons (style 5)
 * need no interaction handler — Discord opens the URL directly. Added to a
 * container's `body` so they render above the `-#` footer (the giveaway
 * pattern).
 */
function linkButtonRow(guildId) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 5,
        label: "View Release Notes",
        url: getReleaseNotesUrl(),
      },
      {
        type: 2,
        style: 5,
        label: "Open Dashboard",
        url: getDashboardUrl(guildId),
      },
      { type: 2, style: 5, label: "Invite Pulse", url: getInviteUrl(guildId) },
    ],
  };
}

function helpLinkButtonRow(guildId, member) {
  const links = [
    { type: 2, style: 5, label: "Invite Pulse", url: getInviteUrl(guildId) },
  ];

  if (memberIsAdmin(member)) {
    links.push(
      {
        type: 2,
        style: 5,
        label: "Open Dashboard",
        url: getDashboardUrl(guildId),
      },
      {
        type: 2,
        style: 5,
        label: "Manage Commands",
        url: `${getDashboardUrl(guildId)}/commands`,
      },
    );
  }

  return { type: 1, components: links };
}

/** Render a release's highlights as a bulleted text block (trimmed + capped). */
function highlightsBlock(highlights) {
  const shown = (highlights ?? []).slice(0, HIGHLIGHT_MAX);
  if (shown.length === 0) return null;
  const lines = shown.map((h) => `- ${truncate(h, HIGHLIGHT_LINE_MAX)}`);
  const extra = (highlights?.length ?? 0) - shown.length;
  if (extra > 0)
    lines.push(`-# …and ${extra} more — see the full release notes`);
  return text(lines.join("\n"));
}

/**
 * Build the "what's new" container for a /changelog reply. The release title is
 * the heading, the version sits in a monospace badge next to the date, the
 * description leads in a larger size, and the highlights sit under a bold
 * "What's new" label — a tidy, professional layout with no emoji. Returns just
 * the container; the caller supplies the icon file + reply.
 */
function buildChangelogContainer(release, { colorHex, icon, guildId } = {}) {
  const body = [];
  if (release.description) body.push(lead(release.description));

  const hl = highlightsBlock(release.highlights);
  if (hl) {
    body.push(divider());
    body.push(text("**What's new**"));
    body.push(hl);
  }

  if (release.outro) {
    body.push(divider());
    body.push(text(`-# ${truncate(release.outro, 240)}`));
  }

  body.push(linkButtonRow(guildId));

  return buildPulseContainer({
    iconUrl: icon ? `attachment://${icon.name}` : null,
    colorHex,
    title: release.title,
    // Version as a monospace badge alongside the release date — a subtle,
    // professional accent under the title.
    subtitle: `Pulse \`v${release.version}\` · Released ${release.date}`,
    body,
    footer: "Pulse · Change Log",
  });
}

/**
 * Fallback container shown when release data can't be loaded — keeps the
 * branding + the release-notes link so the reply is still useful.
 */
function buildUnavailableContainer(colorHex, guildId, icon, message) {
  return buildPulseContainer({
    iconUrl: icon ? `attachment://${icon.name}` : null,
    colorHex,
    title: "Changelog",
    body: [
      text(
        message ??
          "Release details aren't available right now. You can still browse everything that's shipped on the release notes page.",
      ),
      linkButtonRow(guildId),
    ],
    footer: "Pulse · Try again shortly",
  });
}

// ── Profile helpers ───────────────────────────────────────────────────────────
// /profile is built from three transparent images, all generated by the web app
// (next/og) and fetched + attached here (same thin-client pattern as the Pulse
// icons): the reputation/level bars, the identity+activity field cards, and the
// framed banner. Each has a graceful fallback so the embed always renders.

/**
 * Fetch the combined reputation + level bars as a single transparent PNG
 * (reputation left, level right) for /profile, or null on failure. One image so
 * it blends into the embed and nothing is cropped. `level` is optional (omitted
 * when leveling is off for the guild).
 */
async function loadProfileBars({ colorHex, rep, level }) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const qs = new URLSearchParams({
    color: colorHex.replace("#", ""),
    repPct: String(Math.max(0, Math.min(100, Math.round(rep.pct || 0)))),
    repLabel: rep.label,
    repDetail: rep.detail,
  });
  if (level) {
    qs.set("lvl", "1");
    qs.set(
      "lvlPct",
      String(Math.max(0, Math.min(100, Math.round(level.pct || 0)))),
    );
    qs.set("lvlLabel", level.label);
    qs.set("lvlDetail", level.detail);
  }
  const controller = new AbortController();
  // Generous timeout: /profile defers its reply, so we're no longer racing the
  // 3s interaction window — let the image actually generate instead of falling
  // back (e.g. the normalised banner frame, which is what makes it fill width).
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${appUrl}/api/profile-bars?${qs.toString()}`, {
      signal: controller.signal,
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { attachment: buf, name: "profile-bars.png" };
    }
  } catch {
    // fall through to the unicode fallback
  } finally {
    clearTimeout(timer);
  }
  return null;
}

/**
 * Fetch the member's profile fields rendered as a grid of little cards (via
 * /api/profile-cards) as an attachment, or null on failure. `cards` is an array
 * of { l: label, v: value }.
 */
async function loadProfileCards(colorHex, cards) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const qs = new URLSearchParams({
    color: colorHex.replace("#", ""),
    cards: JSON.stringify(cards),
  });
  const controller = new AbortController();
  // Generous timeout: /profile defers its reply, so we're no longer racing the
  // 3s interaction window — let the image actually generate instead of falling
  // back (e.g. the normalised banner frame, which is what makes it fill width).
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${appUrl}/api/profile-cards?${qs.toString()}`, {
      signal: controller.signal,
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { attachment: buf, name: "profile-cards.png" };
    }
  } catch {
    // fall through to the text fallback
  } finally {
    clearTimeout(timer);
  }
  return null;
}

/**
 * Human-readable "time ago" for the profile cards, spelled out in full so it
 * reads naturally on the card: "9 years ago" / "5 months ago" / "17 days ago".
 */
function relAge(ms) {
  const d = daysSince(ms);
  if (d >= 365) {
    const y = Math.floor(d / 365);
    return `${y} year${y === 1 ? "" : "s"} ago`;
  }
  if (d >= 30) {
    const mo = Math.floor(d / 30);
    return `${mo} month${mo === 1 ? "" : "s"} ago`;
  }
  if (d >= 1) return `${d} day${d === 1 ? "" : "s"} ago`;
  return "today";
}

/**
 * Human-readable duration spelled out in full for the profile cards:
 * "25 minutes" / "3 hours 12 minutes" / "45 seconds". Distinct from
 * formatDuration (the compact "3h 12m" form used elsewhere).
 */
function formatDurationWords(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (s < 60) {
    if (s === 0) return "0 minutes";
    return `${s} second${s === 1 ? "" : "s"}`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  const hPart = `${h} hour${h === 1 ? "" : "s"}`;
  return rm > 0 ? `${hPart} ${rm} minute${rm === 1 ? "" : "s"}` : hPart;
}

/**
 * Fetch the member's banner normalised onto a fixed, centred canvas (via
 * /api/banner-frame) as an attachment, so it always renders at a consistent
 * size. Returns null on failure — the caller then falls back to the raw CDN URL.
 */
async function loadBanner(bannerUrl) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const controller = new AbortController();
  // Generous timeout: /profile defers its reply, so we're no longer racing the
  // 3s interaction window — let the image actually generate instead of falling
  // back (e.g. the normalised banner frame, which is what makes it fill width).
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `${appUrl}/api/banner-frame?url=${encodeURIComponent(bannerUrl)}`,
      {
        signal: controller.signal,
      },
    );
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { attachment: buf, name: "banner.png" };
    }
  } catch {
    // fall through to the raw CDN URL
  } finally {
    clearTimeout(timer);
  }
  return null;
}

/** Monospace fallback bar for when the generated image is unavailable. */
function unicodeBar(pct, width = 18) {
  const filled = Math.max(
    0,
    Math.min(width, Math.round(((Number(pct) || 0) / 100) * width)),
  );
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * Gather the participation + moderation inputs a reputation score needs for one
 * member. Best-effort: any query that fails (or is blocked by RLS for the bot's
 * anon role) degrades to 0 rather than throwing, so /profile always renders.
 */
async function fetchMemberMetrics(supabase, guildId, userId) {
  const empty = {
    messages: 0,
    commands: 0,
    voiceSeconds: 0,
    activeChannels: 0,
    warnings: 0,
    timeouts: 0,
    kicks: 0,
    bans: 0,
  };
  try {
    const [statsRes, warnRes, modRes] = await Promise.all([
      supabase.rpc("get_member_profile_stats", {
        p_guild_id: guildId,
        p_user_id: userId,
        p_since: null,
      }),
      supabase
        .from("guild_warnings")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        .eq("active", true),
      supabase
        .from("moderation_logs")
        .select("action")
        .eq("guild_id", guildId)
        .eq("target_user_id", userId)
        .neq("action", "warn")
        .limit(200),
    ]);
    const s = statsRes.data?.[0] ?? {};
    const mod = modRes.data ?? [];
    const tally = (a) => mod.filter((r) => r.action === a).length;
    return {
      messages: Number(s.message_count ?? 0),
      commands: Number(s.command_count ?? 0),
      voiceSeconds: Number(s.voice_seconds ?? 0),
      activeChannels: Number(s.active_channels ?? 0),
      warnings: warnRes.count ?? 0,
      timeouts: tally("timeout"),
      kicks: tally("kick"),
      bans: tally("ban"),
    };
  } catch (err) {
    console.warn(
      `[Pulse] fetchMemberMetrics failed for ${userId}:`,
      err.message,
    );
    return empty;
  }
}

const CATEGORY_LABELS = {
  utility: "Utility",
  information: "Information",
  insights: "Insights",
  moderation: "Moderation",
};

function effectiveCommandPermission(def, config) {
  return config.permission_level === "inherit"
    ? def.defaultPermission
    : config.permission_level;
}

function memberIsAdmin(member) {
  const perms = member?.permissions;
  return (
    perms?.has(PermissionFlagsBits.Administrator) ||
    perms?.has(PermissionFlagsBits.ManageGuild) ||
    false
  );
}

function commandUsage(def) {
  const opts = (def.data.toJSON().options ?? [])
    .map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`))
    .join(" ");
  return `/${def.name}${opts ? ` ${opts}` : ""}`;
}

function commandAccessLabel(level) {
  if (level === "admin") return "Admins";
  if (level === "moderator") return "Mods";
  return "Everyone";
}

// ── Catalog ──────────────────────────────────────────────────────────────────
const COMMANDS = [
  {
    name: "help",
    category: "utility",
    defaultPermission: PERMISSION.EVERYONE,
    data: new SlashCommandBuilder()
      .setName("help")
      .setDescription("List the commands available to you in this server"),
    async execute({
      interaction,
      guild,
      supabase,
      getAllowedCommands,
      ephemeral,
    }) {
      const colorHex = await getPulseColor(supabase, guild.id);
      const icon = await loadPulseIcon("help", colorHex);
      const allowed = await getAllowedCommands(
        supabase,
        guild,
        interaction.member,
      );

      const byCategory = new Map();
      for (const entry of allowed) {
        const level = effectiveCommandPermission(entry.def, entry.config);
        if (level === "admin" && !memberIsAdmin(interaction.member)) continue;

        const category = entry.config.category ?? entry.def.category;
        if (!byCategory.has(category)) byCategory.set(category, []);
        byCategory.get(category).push(entry);
      }

      const visibleCount = [...byCategory.values()].reduce(
        (sum, entries) => sum + entries.length,
        0,
      );
      const body = [];
      if (visibleCount === 0) {
        body.push(
          lead("No commands are available to you in this server right now."),
        );
      } else {
        body.push(
          lead(
            `You can run ${visibleCount} command${visibleCount === 1 ? "" : "s"} in ${guild.name}.`,
          ),
        );
        body.push(
          text(
            "-# Arguments use `<required>` and `[optional]`. Admin-only commands are only shown to server admins.",
          ),
        );
        for (const [category, entries] of byCategory) {
          const lines = entries
            .map(({ def, config }) => {
              const usage = `\`${commandUsage(def)}\``;
              const level = effectiveCommandPermission(def, config);
              return `${usage}\n${def.data.description}\n-# ${commandAccessLabel(level)}`;
            })
            .join("\n\n");
          body.push(divider());
          body.push(
            text(`**${CATEGORY_LABELS[category] ?? category}**\n${lines}`),
          );
        }
      }

      body.push(helpLinkButtonRow(guild.id, interaction.member));

      await replyContainer(
        interaction,
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Command Menu",
          subtitle: `Pulse · ${guild.name}`,
          body,
          footer: "Pulse · Help",
        }),
        icon,
        ephemeral,
      );
    },
  },
  {
    name: "profile",
    category: "information",
    defaultPermission: PERMISSION.EVERYONE,
    data: new SlashCommandBuilder()
      .setName("profile")
      .setDescription(
        "Show a member's profile — reputation, level and standing",
      )
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("The member to look up (defaults to you)")
          .setRequired(false),
      ),
    async execute({ interaction, guild, supabase, leveling, ephemeral }) {
      // Defer up front: looking up another member adds REST fetches (user +
      // member) on top of the image generation, which can blow past Discord's
      // 3s window ("Application did not respond"). Deferring extends it.
      await interaction.deferReply({
        flags: ephemeral ? MessageFlags.Ephemeral : 0,
      });

      const colorHex = await getPulseColor(supabase, guild.id);
      const user = interaction.options.getUser("user") ?? interaction.user;
      const isSelf = user.id === interaction.user.id;

      // Pull everything in parallel to stay inside the interaction window: full
      // user (for the banner), the member, level/rank, and reputation inputs.
      const [full, member, levelInfo, metrics] = await Promise.all([
        user.fetch().catch(() => null),
        guild.members.fetch(user.id).catch(() => null),
        leveling?.getLevelInfo
          ? leveling
              .getLevelInfo(guild, user.id, user.username)
              .catch(() => null)
          : Promise.resolve(null),
        fetchMemberMetrics(supabase, guild.id, user.id),
      ]);

      const displayName =
        member?.displayName ?? user.globalName ?? user.username;
      const avatarUrl = (member ?? user).displayAvatarURL({ size: 512 });
      // Full-size avatar for the "View Avatar" link button (opens in a browser).
      const avatarLinkUrl = (member ?? user).displayAvatarURL({ size: 4096 });
      // Fetch the banner at higher resolution so the framed image (and Discord's
      // downsampled preview) stay sharp — display size is unchanged. Force a
      // static PNG: animated (Nitro) banners default to .gif, which the next/og
      // banner-frame route can't decode — that failure drops us onto the raw CDN
      // URL, which Discord renders narrower (~90%) instead of the full-width frame.
      const bannerUrl = full?.bannerURL
        ? full.bannerURL({ size: 2048, extension: "png", forceStatic: true })
        : null;
      // Original banner (animated .gif kept) for the "View Banner" link button —
      // unlike the framed copy above, this opens the member's real banner in full.
      const bannerOriginalUrl = full?.bannerURL
        ? full.bannerURL({ size: 4096 })
        : null;

      // Reputation from the same inputs the dashboard uses (mirror).
      const assignableRoles = member
        ? member.roles.cache.filter((r) => r.id !== guild.id && !r.managed).size
        : 0;
      const rep = computeReputation({
        accountAgeDays: daysSince(user.createdTimestamp),
        tenureDays: daysSince(member?.joinedTimestamp),
        messages: metrics.messages,
        voiceSeconds: metrics.voiceSeconds,
        commands: metrics.commands,
        activeChannels: metrics.activeChannels,
        assignableRoles,
        warnings: metrics.warnings,
        timeouts: metrics.timeouts,
        kicks: metrics.kicks,
        bans: metrics.bans,
      });

      const prog = levelInfo?.prog ?? {
        level: 0,
        pct: 0,
        intoLevel: 0,
        span: 0,
        toNext: 0,
      };
      const levelingOn = levelInfo?.enabled !== false;

      // Identity + activity fields, rendered as a grid of cards (static values,
      // so an image is fine). Username + display name + dates + activity counts.
      // The member's single highest role (excludes @everyone), shown as a card.
      const topRole = member
        ? member.roles.cache
            .filter((r) => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .first()
        : null;

      const cards = [
        { l: "Username", v: `@${user.username}` },
        { l: "Display name", v: displayName },
        { l: "Account", v: relAge(user.createdTimestamp) },
      ];
      if (member?.joinedTimestamp)
        cards.push({ l: "Joined", v: relAge(member.joinedTimestamp) });
      if (member?.premiumSinceTimestamp)
        cards.push({ l: "Boosting", v: relAge(member.premiumSinceTimestamp) });
      if (topRole) cards.push({ l: "Top role", v: topRole.name });
      cards.push({
        l: "Messages",
        v: `${metrics.messages.toLocaleString()} message${metrics.messages === 1 ? "" : "s"}`,
      });
      cards.push({ l: "Voice", v: formatDurationWords(metrics.voiceSeconds) });
      cards.push({
        l: "Commands",
        v: `${metrics.commands.toLocaleString()} command${metrics.commands === 1 ? "" : "s"}`,
      });
      cards.push({
        l: "Active in",
        v: `${metrics.activeChannels.toLocaleString()} channel${metrics.activeChannels === 1 ? "" : "s"}`,
      });

      // Generate the images in parallel to stay inside the interaction window:
      // the reputation/level bars, the field cards, and the framed banner.
      const [bars, cardsImg, bannerFile] = await Promise.all([
        loadProfileBars({
          colorHex,
          rep: {
            pct: rep.score,
            label: "Reputation",
            detail: `${rep.score}/100 · ${rep.tier}`,
          },
          level: levelingOn
            ? {
                pct: prog.pct,
                label: `Level ${prog.level}`,
                detail: `${prog.intoLevel.toLocaleString()}/${prog.span.toLocaleString()} XP`,
              }
            : null,
        }),
        loadProfileCards(colorHex, cards),
        bannerUrl ? loadBanner(bannerUrl) : Promise.resolve(null),
      ]);

      const body = [];

      body.push(
        lead(
          isSelf
            ? `Here's your standing and activity in ${guild.name}.`
            : `Here's how ${displayName} is doing in ${guild.name}.`,
        ),
      );

      // Reputation + level bars right at the top (single combined image; the
      // heading above each bar is baked in, so no caption is needed below).
      body.push(divider());
      if (bars) {
        body.push({
          type: 12,
          items: [{ media: { url: "attachment://profile-bars.png" } }],
        });
      } else {
        // Unicode fallback when the image can't be fetched — same headings.
        body.push(
          text(
            `**Reputation** ${rep.score}/100 · ${rep.tier}\n\`${unicodeBar(rep.score)}\``,
          ),
        );
        if (levelingOn) {
          body.push(
            text(
              `**Level ${prog.level}** ${prog.intoLevel.toLocaleString()}/${prog.span.toLocaleString()} XP\n\`${unicodeBar(prog.pct)}\``,
            ),
          );
        }
      }

      // Identity + activity field cards (image), or a plain text fallback.
      body.push(divider());
      if (cardsImg) {
        body.push({
          type: 12,
          items: [{ media: { url: "attachment://profile-cards.png" } }],
        });
      } else {
        body.push(text(cards.map((c) => `**${c.l}:** ${c.v}`).join("\n")));
      }

      // The member's profile banner, centred + full-width at the very bottom (if
      // they have one) — no divider above it. Prefer the normalised framed image;
      // fall back to the raw CDN URL (which Discord fetches itself) if the frame
      // couldn't be generated.
      if (bannerUrl) {
        body.push({
          type: 12,
          items: [
            {
              media: {
                url: bannerFile ? "attachment://banner.png" : bannerUrl,
              },
            },
          ],
        });
      }

      // Quick links to open the avatar (and banner, if any) full-size in a
      // browser — same link-button style (type 2, style 5) as the changelog.
      const profileLinks = [
        { type: 2, style: 5, label: "View Avatar", url: avatarLinkUrl },
      ];
      if (bannerOriginalUrl) {
        profileLinks.push({
          type: 2,
          style: 5,
          label: "View Banner",
          url: bannerOriginalUrl,
        });
      }
      // Admins also get a link straight to this member's dashboard detail page
      // (Members › Details). Hidden entirely for non-admins.
      if (
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
      ) {
        profileLinks.push({
          type: 2,
          style: 5,
          label: "Manage on Pulsify",
          url: `${getDashboardUrl(guild.id)}/members/${user.id}`,
        });
      }
      body.push({ type: 1, components: profileLinks });

      // Ephemeral was set at defer time; the edit just adds the Components V2
      // flag + the actual payload.
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          buildPulseContainer({
            iconUrl: avatarUrl,
            colorHex,
            title: `**${displayName}**`,
            subtitle: `${rep.tier}${levelingOn ? ` · Level ${prog.level}` : ""}`,
            body,
            footer: "Pulse · Member profile",
            noSpacer: true,
          }),
        ],
        files: [bars, cardsImg, bannerFile].filter(Boolean),
      });
    },
  },
  {
    name: "changelog",
    category: "utility",
    defaultPermission: PERMISSION.ADMIN,
    // Public reply out of the box — admins can flip it to ephemeral per server.
    defaultEphemeral: false,
    data: new SlashCommandBuilder()
      .setName("changelog")
      .setDescription(
        "Shows detailed release notes for a specific Pulsify version.",
      )
      .addStringOption((o) =>
        o
          .setName("version")
          .setDescription("A version to look up.")
          .setRequired(false),
      ),
    async execute({ interaction, guild, supabase, ephemeral }) {
      const colorHex = await getPulseColor(supabase, guild.id);
      const icon = await loadPulseIcon("announcement", colorHex);

      // Optional `version` arg → that release; otherwise the latest. Tolerate a
      // leading "v" and surrounding whitespace so "v0.30.0" / " 0.30.0 " work.
      const raw = interaction.options.getString("version");
      const wanted = raw ? raw.trim().replace(/^v/i, "") : null;
      const release = wanted
        ? await getReleaseByVersion(wanted)
        : await getLatestRelease();

      if (!release) {
        const msg = wanted
          ? `No release notes found for v${wanted}. Browse every version on the release notes page.`
          : undefined;
        await replyContainer(
          interaction,
          buildUnavailableContainer(colorHex, guild.id, icon, msg),
          icon,
          ephemeral,
        );
        return;
      }

      await replyContainer(
        interaction,
        buildChangelogContainer(release, { colorHex, icon, guildId: guild.id }),
        icon,
        ephemeral,
      );
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
  // Shared embed helpers — reused by other modules (e.g. leveling.js for the
  // /rank + /leaderboard replies) so every Pulse embed shares one look.
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  replyContainer,
  text,
  divider,
};

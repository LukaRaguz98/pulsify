// Pulse slash-command catalog — the SINGLE SOURCE OF TRUTH (PULSIFY-61).
//
// This file defines every command Pulse offers: what it's called, who may run
// it, which module it belongs to, what it costs, and what it does. It drives
// registration + execution here, and src/catalog-sync.js upserts the metadata
// into the `command_catalog` table on startup so the dashboard's Command Center
// renders exactly what the running bot actually serves.
//
// It used to be a hand-mirrored twin of pulsify-web-app/lib/commands.ts, and
// the two drifted — the web catalog silently lost /invites, /invite-leaderboard,
// /invite-rewards, /daily and /weekly, so admins couldn't configure commands the
// bot was happily running. Adding a command is now a change to THIS file only;
// the dashboard follows automatically. Don't reintroduce a second catalog.
//
// ── Entry shape ──────────────────────────────────────────────────────────────
//   name              slash name, no leading slash
//   category          utility | information | insights | moderation — grouping only
//   module            the Pulsify feature this belongs to (src/feature-gate.js
//                     MODULE_SOURCES). The command is unavailable when the server
//                     has that feature switched off. NULL = always available.
//   defaultPermission baseline tier before per-guild overrides (src/permissions.js)
//   defaultEphemeral  false = posts publicly out of the box (default true)
//   minPlan           free | pro | business | enterprise — gated on the guild
//                     OWNER's subscription, with an upgrade prompt below it
//   examples/detail   dashboard preview copy, synced to command_catalog
//   data              the SlashCommandBuilder registered with Discord
//   execute           the handler
//   autocomplete      optional — handles focused-option autocomplete
//
// Per-server overrides (enable, hide, re-permission, cooldown, channel/role
// allow-deny) live in `command_configs` and are applied by command-center.js.

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
const { daysSince } = require("./reputation");
const { fetchImageCached } = require("./image-cache");
// The permission ladder lives in one place; /help renders tiers with the same
// helpers command-center.js enforces them with.
const {
  isAdmin: memberIsAdmin,
  tierLabel: commandAccessLabel,
} = require("./permissions");

// Baseline access tiers a catalog entry can ask for. The ladder itself (what
// each tier means, and who satisfies it) lives in src/permissions.js —
// EVERYONE is the stored alias for that module's `member` tier.
const PERMISSION = {
  EVERYONE: "everyone",
  SUPPORT: "support",
  MODERATOR: "moderator",
  ADMIN: "admin",
};
const ACCENT = 0x8b5cf6;
const DEFAULT_PULSE_COLOR = "#8b5cf6";

// ── Themed Components V2 helpers ─────────────────────────────────────────────
// Every command reply shares one look: a header Section carrying a
// thumbnail (the Pulse badge, or — for server/user info — the server icon /
// member avatar), the body, and a subtle `-# Pulse — …` footer. The Pulse
// badge is fetched from the web app's tint endpoint (one shared recolour
// pipeline) and falls back to the bundled PNG so a reply always renders. Keep
// emoji out — the accent bar + glyph carry the branding.

// Master switch for the Pulse BADGE thumbnails (the violet glyph plates below).
// Turned off: embeds render their header as plain text instead of a type-9
// Section, which is what the "no thumbnail" branch every call site already has
// was written for. This does NOT touch the thumbnails that show a real Discord
// asset — the server icon on /serverinfo, the member avatar on /profile,
// /userinfo, /alt check and milestone announcements — those are URLs, not
// badges, and keep rendering. Everything below (the registry, the assets, the
// tint pipeline, the loaders) is left intact so flipping this back to `true`
// restores the badges everywhere; see also PULSE_BADGES_ENABLED in the web
// app's lib/pulse-icon.ts, which gates the dashboard-posted embeds.
const PULSE_BADGES_ENABLED = false;

const ICON_FILES = {
  help: "pulse-help.png",
  announcement: "pulse-annoucement.png",
  milestone: "pulse-milestone.png",
  // Ranking / progression glyph (server boards, /rank).
  stats: "pulse-stats.png",
  // Trophy glyph — the /leaderboard boards.
  leaderboard: "pulse-leaderboard.png",
  // Info glyph — the /info guide (also the posted Server Rules badge).
  info: "pulse-info.png",
  // Global economy glyph (/balance, /pay, /earn, global boards).
  money: "pulse-money.png",
  // Birthday cake glyph (/birthday, birthday announcements).
  birthday: "pulse-birthday.png",
  // Shield glyph — account safety (/alt check, /modlogs).
  safety: "pulse-guard.png",
  // Warning glyph — /warnings. Already in the web registry (lib/pulse-icon.ts)
  // and bundled in resources/images; the bot's map just never listed it.
  warn: "pulse-warn.png",
  // Trophy glyph — the /invite group. Shares the leaderboard trophy (referrals
  // are a ranking too); no separate asset — pulse-invite.png was a byte-identical
  // duplicate, since removed.
  invite: "pulse-leaderboard.png",
  // Medal glyph — the global trust score (/reputation). Its own icon rather than
  // borrowing the safety shield, which reads as moderation, not standing.
  reputation: "pulse-reputation.png",
  // People glyph — role management (/role info, /role hierarchy).
  roles: "pulse-roles.png",
  // Hash glyph — channel tools (/channel stats).
  channel: "pulse-channel.png",
  // Results-bars glyph — polls (/poll). The poll module loads this asset itself
  // (it falls back to the giveaway badge when absent); listed here so the shared
  // loader can serve it too.
  poll: "pulse-poll.png",
  // Calendar glyph — Discord scheduled events (/event).
  event: "pulse-event.png",
  // Workflow glyph — scheduled automations (/automation).
  automation: "pulse-automation.png",
};
const localIconCache = {};

const VERIFICATION_LABELS = ["None", "Low", "Medium", "High", "Highest"];
const EXPLICIT_FILTER_LABELS = [
  "Disabled",
  "Members without roles",
  "All members",
];

// Elevated, server-wide permissions worth surfacing on /userinfo — in rough
// descending order of significance. Administrator implies every other one, so
// the handler shows just that when it's present rather than the whole list.
const KEY_PERMISSIONS = [
  [PermissionFlagsBits.Administrator, "Administrator"],
  [PermissionFlagsBits.ManageGuild, "Manage Server"],
  [PermissionFlagsBits.ManageRoles, "Manage Roles"],
  [PermissionFlagsBits.ManageChannels, "Manage Channels"],
  [PermissionFlagsBits.ManageMessages, "Manage Messages"],
  [PermissionFlagsBits.BanMembers, "Ban Members"],
  [PermissionFlagsBits.KickMembers, "Kick Members"],
  [PermissionFlagsBits.ModerateMembers, "Timeout Members"],
  [PermissionFlagsBits.ManageNicknames, "Manage Nicknames"],
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

/** Read the guild's configured Pulse accent colour, defaulting to violet. This
 *  is the single source of truth (guild_settings.embed_color) applied to every
 *  Pulse embed — see src/guild-accent.js. */
async function getPulseColor(supabase, guildId) {
  const { getGuildAccentHex } = require("./guild-accent");
  return getGuildAccentHex(supabase, guildId);
}

/**
 * Resolve a Pulse badge as a Discord attachment: the web app's tinted endpoint
 * first (recoloured to the guild accent, bounded by a short timeout so the 3s
 * interaction window is safe), falling back to the bundled PNG. `iconKey` is
 * one of ICON_FILES.
 *
 * Returns null while PULSE_BADGES_ENABLED is off — every caller already treats
 * a null icon as "render the header without a thumbnail", so the switch lands
 * here rather than in ~30 call sites.
 */
async function loadPulseIcon(iconKey, colorHex) {
  if (!PULSE_BADGES_ENABLED) return null;
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
        path.join(__dirname, "..", "resources", "images", name),
      );
    }
    return { attachment: localIconCache[iconKey], name };
  } catch {
    return null;
  }
}

/**
 * Build a themed Components V2 container. `body` is an array of pre-built V2
 * components (use text()/divider()). `actions` is an array of action rows
 * (buttons / select menus) rendered inside the container, below the footer, so
 * interactive controls sit within the embed itself.
 *
 * ── Embed conventions (apply these to EVERY Pulse embed) ─────────────────────
 *
 * 1. HEADER THUMBNAIL (`iconUrl`) — an `attachment://<name>` badge or an https
 *    URL (server icon / member avatar). It is OPTIONAL. CURRENT RULE: the Pulse
 *    BADGES are switched off (PULSE_BADGES_ENABLED = false), so the only
 *    thumbnails an embed shows are real Discord assets — the server icon
 *    (/serverinfo) and the member avatar (/profile, /userinfo, /alt check,
 *    milestone announcements). Everything else renders its header as plain text
 *    lines (no Section), which is what the no-thumbnail branch does.
 *    If the badges are ever switched back on, the old balance rule applies:
 *    keep a badge on content-rich embeds (multi-section bodies where it sits
 *    beside real text) and drop it on short confirmations and notices, where a
 *    fixed-size thumbnail outweighs the message and looks lopsided.
 *
 * 2. NO DASH BULLETS — body lists are plain lines, never `- item` / `• item`.
 *    Most Pulse embeds already read as `**Label** — value` lines or bare
 *    sentences; the few that used leading dashes looked like a different
 *    product. One line per item, `**bold**` for the label, ` — ` as the
 *    separator.
 *
 * 2b. INLINE LISTS ARE SPACE-SEPARATED — never a comma, never a dash. An inline
 *    run of items (roles unlocked, giveaway winners, badges, poll results) joins
 *    with a single space:
 *      Unlocked: <@&1> <@&2>            Badges: `Gold` `Founder`
 *    Items must carry their own visual boundary, or a space between them reads
 *    as one item — role and option names contain spaces ("Server Booster").
 *    Mentions (`<@id>` / `<@&id>`) already render as pills, so they need
 *    nothing; wrap anything plain in backticks.
 *
 *    This is DISTINCT from the ` — ` in rule 2, which separates SEGMENTS — whole
 *    phrases that each contain spaces:
 *      -# **Requirements:** Account age: 30+ days — Level 5+ — Verified
 *    Joining those with a space would slur them into one sentence. Rule of
 *    thumb: a list of *things* → space; a line of *phrases* → ` — `.
 *
 * 3. COLOUR — never hardcode. `colorHex` must come from getPulseColor() (i.e.
 *    guild_settings.embed_color, chosen in the dashboard's Server Settings), so
 *    every embed a server sees is in that server's colour. There are no
 *    per-state or per-feature exceptions.
 *
 * 4. NO EMOJI in embed bodies (the accent bar and the badge carry the branding).
 */
function buildPulseContainer({
  iconUrl,
  colorHex,
  title,
  subtitle,
  body = [],
  footer,
  actions = [],
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
  for (const row of actions) if (row) components.push(row);

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

/**
 * A minimal Components V2 container for the bot's short status messages —
 * validations, errors, "already claimed", "not available", confirmations.
 * Deliberately bare: just the accent bar + the message text (no header glyph,
 * no thumbnail, no footer). One line in, one tidy embed out. Keep it emoji-free
 * like every other Pulse embed.
 */
function buildNoticeContainer(message, colorHex = DEFAULT_PULSE_COLOR) {
  const colorInt = parseInt(String(colorHex).replace("#", ""), 16);
  return {
    type: 17,
    accent_color: Number.isNaN(colorInt) ? ACCENT : colorInt,
    components: [text(message)],
  };
}

/**
 * Reply (or follow up, if the interaction was already answered) with a notice
 * container. Ephemeral by default — these are personal status messages. Pass a
 * `colorHex` when the guild accent is already on hand; otherwise it falls back
 * to Pulse violet (no extra DB read on an error path).
 */
async function replyNotice(interaction, message, ephemeral = true, colorHex = DEFAULT_PULSE_COLOR) {
  const payload = {
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    components: [buildNoticeContainer(message, colorHex)],
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
}

/** Like replyNotice but edits a deferred/earlier reply in place. */
async function editNotice(interaction, message, colorHex = DEFAULT_PULSE_COLOR) {
  await interaction
    .editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [buildNoticeContainer(message, colorHex)],
    })
    .catch(() => {});
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
  // "Open Dashboard" points at the guild root, which routes by role server-side
  // (admins → Overview, members → their member-facing Profile), so everyone
  // gets it. "Manage Commands" is an admin-only management deep link.
  const links = [
    { type: 2, style: 5, label: "Invite Pulse", url: getInviteUrl(guildId) },
    {
      type: 2,
      style: 5,
      label: "Open Dashboard",
      url: getDashboardUrl(guildId),
    },
  ];

  if (memberIsAdmin(member)) {
    links.push({
      type: 2,
      style: 5,
      label: "Manage Commands",
      url: `${getDashboardUrl(guildId)}/commands`,
    });
  }

  return { type: 1, components: links };
}

// /help shows a flat list (no category grouping) paginated at this many per
// page, so each page stays short and scannable.
const HELP_PER_PAGE = 5;

/** Build the /help prev/next row (omitted when everything fits one page). */
function helpNavRow(viewerId, page, totalPages) {
  if (totalPages <= 1) return null;
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        label: "Previous",
        custom_id: `help:nav:${viewerId}:${page - 1}`,
        disabled: page <= 0,
      },
      {
        type: 2,
        style: 2,
        label: "Next",
        custom_id: `help:nav:${viewerId}:${page + 1}`,
        disabled: page >= totalPages - 1,
      },
    ],
  };
}

/**
 * Render a /help page for `member`: a single flat, paginated list of the
 * commands they're allowed to run (admin-only entries hidden from non-admins),
 * HELP_PER_PAGE per page, with prev/next + the link button row. Returns
 * `{ components, files }` for both the initial reply and pagination updates.
 */
async function renderHelp({ supabase, guild, member, getAllowedCommands, page }) {
  const colorHex = await getPulseColor(supabase, guild.id);
  const icon = await loadPulseIcon("help", colorHex);
  const allowed = await getAllowedCommands(supabase, guild, member);

  // Flatten to one list — no category grouping, for a cleaner read.
  const entries = [];
  for (const entry of allowed) {
    const level = effectiveCommandPermission(entry.def, entry.config);
    if (level === "admin" && !memberIsAdmin(member)) continue;
    entries.push(entry);
  }

  const total = entries.length;
  const totalPages = Math.max(1, Math.ceil(total / HELP_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * HELP_PER_PAGE;

  const body = [];
  if (total === 0) {
    body.push(lead("No commands are available to you in this server right now."));
  } else {
    body.push(
      lead(`You can run ${total} command${total === 1 ? "" : "s"} in ${guild.name}.`),
    );
    body.push(
      text(
        "-# Arguments use `<required>` and `[optional]`. Admin-only commands are only shown to server admins.",
      ),
    );
    body.push(divider());
    const lines = entries
      .slice(start, start + HELP_PER_PAGE)
      .map(({ def, config }) => {
        const usage = `\`${commandUsage(def)}\``;
        const level = effectiveCommandPermission(def, config);
        return `${usage}\n${def.data.description}\n-# ${commandAccessLabel(level)}`;
      })
      .join("\n\n");
    body.push(text(lines));
    if (totalPages > 1) {
      body.push(divider());
      body.push(text(`-# Page ${safePage + 1} of ${totalPages}`));
    }
  }

  const actions = [
    helpNavRow(member.id, safePage, totalPages),
    helpLinkButtonRow(guild.id, member),
  ];

  const components = [
    buildPulseContainer({
      iconUrl: icon ? `attachment://${icon.name}` : null,
      colorHex,
      title: "Command Menu",
      subtitle: `Pulse — ${guild.name}`,
      body,
      footer: "Pulse — Help",
      actions,
    }),
  ];

  return { components, files: icon ? [icon] : [] };
}

/**
 * Render a release's highlights as a text block (trimmed + capped). One
 * highlight per line, no dash bullets — highlights already lead with a bold
 * title (`**Title** — body`), so a marker in front of them is noise (see the
 * embed conventions on buildPulseContainer).
 */
function highlightsBlock(highlights) {
  const shown = (highlights ?? []).slice(0, HIGHLIGHT_MAX);
  if (shown.length === 0) return null;
  const lines = shown.map((h) => truncate(h, HIGHLIGHT_LINE_MAX));
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
    subtitle: `Pulse \`v${release.version}\` — Released ${release.date}`,
    body,
    footer: "Pulse — Change Log",
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
    footer: "Pulse — Try again shortly",
  });
}

// ── Profile helpers ───────────────────────────────────────────────────────────
// /profile is built from three transparent images, all generated by the web app
// (next/og) and fetched + attached here (same thin-client pattern as the Pulse
// icons): the reputation/level bars, the identity+activity field cards, and the
// framed banner. Each has a graceful fallback so the embed always renders.

/**
 * Fetch the accent-tinted reputation and/or level bars as a single transparent
 * PNG for /profile, /rank and /reputation, or null on failure. `rep` and `level`
 * are BOTH optional — pass just `rep` for a reputation-only bar (/reputation),
 * just `level` for a level-only bar (/rank), or both (/profile). One image so it
 * blends into the embed and nothing is cropped. Exported so the level/reputation
 * bar looks identical wherever it appears.
 */
async function loadProfileBars({ colorHex, rep, level }) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const clampPct = (v) => String(Math.max(0, Math.min(100, Math.round(v || 0))));
  const qs = new URLSearchParams({ color: colorHex.replace("#", "") });
  if (rep) {
    qs.set("repPct", clampPct(rep.pct));
    qs.set("repLabel", rep.label);
    qs.set("repDetail", rep.detail);
  } else {
    // Skip the reputation column so a level-only bar renders on its own.
    qs.set("rep", "0");
  }
  if (level) {
    qs.set("lvl", "1");
    qs.set("lvlPct", clampPct(level.pct));
    qs.set("lvlLabel", level.label);
    qs.set("lvlDetail", level.detail);
  }
  // Cached per exact bar payload (see image-cache.js) so a re-run is instant and
  // a CDN in production serves the first render for everyone after.
  return fetchImageCached(`${appUrl}/api/profile-bars?${qs.toString()}`, "profile-bars.png");
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
  return fetchImageCached(`${appUrl}/api/profile-cards?${qs.toString()}`, "profile-cards.png");
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
  // The framed banner only changes when the member changes their banner, so it
  // can live a good while; cached per source CDN url.
  return fetchImageCached(
    `${appUrl}/api/banner-frame?url=${encodeURIComponent(bannerUrl)}`,
    "banner.png",
    { ttlMs: 60 * 60 * 1000 },
  );
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

/**
 * The member's owned profile cosmetics (badges) for /profile — GLOBAL, so no
 * guild filter. Mirrors lib/shop.ts ownedCosmetics: active purchases whose
 * snapshot category is 'cosmetic' (or legacy 'badge'), deduped by name. Returns
 * [{ name }]. Best-effort — never throws so /profile always renders.
 */
async function fetchOwnedCosmetics(supabase, userId) {
  try {
    const { data } = await supabase
      .from("reward_purchases")
      .select("reward_snapshot, status, enabled, created_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(200);
    const seen = new Set();
    const out = [];
    for (const row of data ?? []) {
      // Respect the member's Inventory on/off toggle (reward_purchases.enabled).
      if (row.enabled === false) continue;
      const snap = row.reward_snapshot ?? {};
      if (snap.category !== "cosmetic" && snap.category !== "badge") continue;
      const name = String(snap.name ?? "Cosmetic");
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name });
    }
    return out;
  } catch (err) {
    console.warn(`[Pulse] fetchOwnedCosmetics failed for ${userId}:`, err.message);
    return [];
  }
}

function effectiveCommandPermission(def, config) {
  return config.permission_level === "inherit"
    ? def.defaultPermission
    : config.permission_level;
}

function commandUsage(def) {
  const opts = (def.data.toJSON().options ?? [])
    .map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`))
    .join(" ");
  return `/${def.name}${opts ? ` ${opts}` : ""}`;
}


// Shared time-range option for the analytics commands (/stats, /insights,
// /management), matching the dashboard's 24h/7d/30d/all selector.
const PERIOD_CHOICES = [
  { name: "Last 24 hours", value: "24h" },
  { name: "Last 7 days", value: "7d" },
  { name: "Last 30 days", value: "30d" },
  { name: "All time", value: "all" },
];
function addPeriodOption(sc) {
  return sc.addStringOption((o) =>
    o
      .setName("period")
      .setDescription("Time range (default: last 7 days)")
      .setRequired(false)
      .addChoices(...PERIOD_CHOICES),
  );
}

// ── Catalog ──────────────────────────────────────────────────────────────────
const COMMANDS = [
  {
    name: "help",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/help"],
    detail:
      "Lists every command the member is allowed to run, paginated. Disabled, hidden and admin-only commands are omitted automatically, so the list always reflects what that member can actually use.",
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
      const payload = await renderHelp({
        supabase,
        guild,
        member: interaction.member,
        getAllowedCommands,
        page: 0,
      });
      await interaction.reply({
        ...payload,
        flags:
          MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
      });
    },
  },
  {
    name: "profile",
    category: "information",
    // Deliberately NOT gated on leveling/economy: /profile degrades to the parts
    // a server runs (it drops the level bar when leveling is off) rather than
    // disappearing, so identity + activity stay available everywhere.
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/profile", "/profile user:@username"],
    detail:
      "A member's reputation and level shown as accent-tinted bars, plus account + join dates, their most significant roles, owned badges, and quick links to their avatar and banner. Balance and reputation are global across every Pulse server; level is specific to this one. Defaults to your own profile.",
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
    async execute({ interaction, guild, supabase, leveling, milestones, economy, ephemeral }) {
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
      // user (for the banner), the member, level/rank, activity metrics, and
      // the member's GLOBAL wallet (balance + reputation, PULSIFY-45).
      const [full, member, levelInfo, metrics, wallet, cosmetics] = await Promise.all([
        user.fetch().catch(() => null),
        guild.members.fetch(user.id).catch(() => null),
        leveling?.getLevelInfo
          ? leveling
              .getLevelInfo(guild, user.id, user.username)
              .catch(() => null)
          : Promise.resolve(null),
        fetchMemberMetrics(supabase, guild.id, user.id),
        economy?.getWallet
          ? economy.getWallet(user.id, user.createdTimestamp).catch(() => null)
          : Promise.resolve(null),
        fetchOwnedCosmetics(supabase, user.id),
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

      // GLOBAL reputation: the existing 0-100 trust score, now computed from
      // activity across every Pulse server. Balance is the global coin balance.
      // Levels stay per-server.
      const rep = wallet?.reputation ?? { score: 0, tier: "At risk" };
      const balance = wallet?.balance ?? 0;

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
      cards.push({ l: "Balance", v: `${balance.toLocaleString()} coins` });
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
            detail: `${rep.score}/100 — ${rep.tier}`,
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
            `**Reputation** ${rep.score}/100 — ${rep.tier}\n\`${unicodeBar(rep.score)}\``,
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
      body.push(
        text(
          "-# Balance & reputation are global across every Pulse server — level is specific to this server",
        ),
      );

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

      // Owned badges & cosmetics from the rewards shop — part of the global
      // Pulse identity, shown to everyone viewing the profile.
      if (cosmetics.length > 0) {
        body.push(divider());
        body.push(
          text(
            `**Badges & cosmetics**\n${cosmetics.map((c) => `\`${c.name}\``).join(" ")}`,
          ),
        );
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
      // When the server runs milestones, lead with a Milestones button styled to
      // match the link buttons (secondary/grey, no emoji). It must carry a
      // custom_id — Discord link buttons (style 5) need a URL and can't open the
      // in-Discord milestones page — handled by the milestones `ms:` listener.
      const profileLinks = [];
      if (milestones?.hasEnabledMilestones?.(guild.id)) {
        profileLinks.push({
          type: 2,
          style: 2,
          label: "Milestones",
          custom_id: `ms:prof:${user.id}`,
        });
      }
      profileLinks.push({ type: 2, style: 5, label: "View Avatar", url: avatarLinkUrl });
      if (bannerOriginalUrl) {
        profileLinks.push({
          type: 2,
          style: 5,
          label: "View Banner",
          url: bannerOriginalUrl,
        });
      }
      // A dashboard link sized to the VIEWER: admins jump straight to this
      // member's management detail page (Members › Details); everyone else gets
      // "Open Dashboard", whose guild root routes them to their own member-facing
      // Profile (the root redirects non-admins there server-side).
      if (
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
      ) {
        profileLinks.push({
          type: 2,
          style: 5,
          label: "Manage on Pulsify",
          url: `${getDashboardUrl(guild.id)}/members/${user.id}`,
        });
      } else {
        profileLinks.push({
          type: 2,
          style: 5,
          label: "Open Dashboard",
          url: getDashboardUrl(guild.id),
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
            subtitle: `${rep.tier}${levelingOn ? ` — Level ${prog.level}` : ""}`,
            body,
            footer: "Pulse — Member profile",
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
    module: null,
    defaultPermission: PERMISSION.ADMIN,
    // Public reply out of the box — admins can flip it to ephemeral per server.
    defaultEphemeral: false,
    examples: ["/changelog", "/changelog version:0.30.0"],
    detail:
      "A polished summary of a Pulse release — the headline changes and highlights — with a link to the complete release notes. Defaults to the latest release; pass a version to view any past release. Admins only by default.",
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
  {
    name: "milestones",
    category: "information",
    // Milestones has no master on/off switch — a server with none configured
    // simply has an empty list, which the handler already says plainly.
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/milestones", "/milestones user:@username"],
    detail:
      "Lists the recognition milestones a member has earned (time in server, messages, voice, events, giveaways, invites, XP/level) and how close they are to the next ones. Milestones are configured in the dashboard under Engagement › Milestones. Defaults to your own.",
    data: new SlashCommandBuilder()
      .setName("milestones")
      .setDescription(
        "Show a member's recognition milestones — earned and in progress",
      )
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("The member to look up (defaults to you)")
          .setRequired(false),
      ),
    async execute({ interaction, guild, milestones, ephemeral }) {
      if (!milestones?.handleMilestonesCommand) {
        await replyNotice(interaction, "Milestones aren't available right now.");
        return;
      }
      await milestones.handleMilestonesCommand({ interaction, guild, ephemeral });
    },
  },
  {
    name: "birthday",
    category: "information",
    module: "birthdays",
    defaultPermission: PERMISSION.EVERYONE,
    examples: [
      "/birthday set month:March day:14",
      "/birthday view",
      "/birthday upcoming",
      "/birthday remove",
    ],
    detail:
      "Members set their birthday (day/month, optional year, optional timezone) so Pulse can celebrate them automatically. Subcommands: set (add or update yours, with privacy options to hide your year or opt out of announcements), view (see yours or another member's), upcoming (the next birthdays in the server) and remove. Admins configure the announcement channel, time, role and rewards under Engagement › Birthdays.",
    data: (() => {
      const MONTH_CHOICES = [
        { name: "January", value: 1 },
        { name: "February", value: 2 },
        { name: "March", value: 3 },
        { name: "April", value: 4 },
        { name: "May", value: 5 },
        { name: "June", value: 6 },
        { name: "July", value: 7 },
        { name: "August", value: 8 },
        { name: "September", value: 9 },
        { name: "October", value: 10 },
        { name: "November", value: 11 },
        { name: "December", value: 12 },
      ];
      const TZ_CHOICES = [
        { name: "UTC", value: "UTC" },
        { name: "Pacific (Los Angeles)", value: "America/Los_Angeles" },
        { name: "Mountain (Denver)", value: "America/Denver" },
        { name: "Central (Chicago)", value: "America/Chicago" },
        { name: "Eastern (New York)", value: "America/New_York" },
        { name: "Brazil (Sao Paulo)", value: "America/Sao_Paulo" },
        { name: "UK (London)", value: "Europe/London" },
        { name: "Central Europe (Paris)", value: "Europe/Paris" },
        { name: "Eastern Europe (Athens)", value: "Europe/Athens" },
        { name: "Moscow", value: "Europe/Moscow" },
        { name: "Gulf (Dubai)", value: "Asia/Dubai" },
        { name: "India (Kolkata)", value: "Asia/Kolkata" },
        { name: "Singapore", value: "Asia/Singapore" },
        { name: "Japan (Tokyo)", value: "Asia/Tokyo" },
        { name: "Sydney", value: "Australia/Sydney" },
        { name: "New Zealand (Auckland)", value: "Pacific/Auckland" },
      ];
      const maxYear = new Date().getUTCFullYear() - 13;
      return new SlashCommandBuilder()
        .setName("birthday")
        .setDescription("Set and view birthdays in this server")
        .addSubcommand((sc) =>
          sc
            .setName("set")
            .setDescription("Set your birthday so Pulse can celebrate you")
            .addIntegerOption((o) =>
              o.setName("month").setDescription("Birth month").setRequired(true).addChoices(...MONTH_CHOICES),
            )
            .addIntegerOption((o) =>
              o.setName("day").setDescription("Day of the month (1-31)").setRequired(true).setMinValue(1).setMaxValue(31),
            )
            .addIntegerOption((o) =>
              o.setName("year").setDescription("Birth year (optional)").setRequired(false).setMinValue(1900).setMaxValue(maxYear),
            )
            .addStringOption((o) =>
              o.setName("timezone").setDescription("Your timezone (optional)").setRequired(false).addChoices(...TZ_CHOICES),
            )
            .addBooleanOption((o) =>
              o.setName("hide_year").setDescription("Hide your age / birth year").setRequired(false),
            )
            .addBooleanOption((o) =>
              o.setName("announce").setDescription("Allow a public birthday announcement (default: yes)").setRequired(false),
            ),
        )
        .addSubcommand((sc) =>
          sc
            .setName("view")
            .setDescription("View a member's birthday")
            .addUserOption((o) =>
              o.setName("user").setDescription("The member to look up (defaults to you)").setRequired(false),
            ),
        )
        .addSubcommand((sc) =>
          sc.setName("upcoming").setDescription("See the next upcoming birthdays in this server"),
        )
        .addSubcommand((sc) =>
          sc.setName("remove").setDescription("Remove your birthday from this server"),
        );
    })(),
    async execute({ interaction, guild, birthdays }) {
      if (!birthdays?.handleBirthdayCommand) {
        await replyNotice(interaction, "Birthdays aren't available right now.");
        return;
      }
      await birthdays.handleBirthdayCommand({ interaction, guild });
    },
  },
  {
    // One `invite` group rather than /invites + /invite-leaderboard +
    // /invite-rewards. Discord forbids spaces in a command name (the regex
    // allows `-` and `_` only), so a subcommand group is the ONLY way to render
    // "/invite leaderboard" — and it matches /birthday, which has read this way
    // since PULSIFY-58.
    //
    // Trade-off, on purpose: command_configs keys on command_name, so the three
    // are now configured as ONE command. An admin can no longer disable the
    // leaderboard while keeping rewards — exactly as they can't disable only
    // /birthday upcoming today. 20260627 migrates the old rows.
    // Gaming Analytics (PULSIFY-64). EVERYONE-tier: the whole point of the
    // module is that the community can see what it plays. The privacy
    // subcommands are member-facing by definition — an admin cannot opt a
    // member back in on their behalf, which is why opt-in/opt-out live here
    // rather than on the dashboard.
    name: "gaming",
    category: "information",
    module: "gaming",
    defaultPermission: PERMISSION.EVERYONE,
    examples: [
      "/gaming overview",
      "/gaming profile user:@username",
      "/gaming leaderboard board:playtime period:week",
      "/gaming games sort:players",
      "/gaming currently-playing",
    ],
    detail:
      "What this server plays. `overview` is the server's totals — hours played, active players, most played games. `profile` shows one member's playtime, favourite game, longest session and rank (defaults to you). `leaderboard` ranks members by playtime, sessions, longest session or number of different games, over a time range. `games` ranks the games themselves. `currently-playing` lists who is in a game right now, live. `opt-out` removes you from tracking entirely (optionally deleting your recorded sessions) and `opt-in` puts you back. Requires Gaming Analytics to be switched on under Analytics › Gaming; playtime is measured from Discord presence, so members who hide their activity are never recorded.",
    data: new SlashCommandBuilder()
      .setName("gaming")
      .setDescription("Gaming stats, leaderboards and live activity")
      .addSubcommand((sc) =>
        sc.setName("overview").setDescription("This server's gaming statistics"),
      )
      .addSubcommand((sc) =>
        sc
          .setName("profile")
          .setDescription("Show a member's gaming profile (defaults to you)")
          .addUserOption((o) =>
            o.setName("user").setDescription("The member to look up (defaults to you)").setRequired(false),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("leaderboard")
          .setDescription("Rank this server's players")
          .addStringOption((o) =>
            o
              .setName("board")
              .setDescription("What to rank by")
              .setRequired(false)
              .addChoices(
                { name: "Playtime", value: "playtime" },
                { name: "Sessions", value: "sessions" },
                { name: "Longest session", value: "longest" },
                { name: "Most games played", value: "variety" },
              ),
          )
          .addStringOption((o) =>
            o
              .setName("period")
              .setDescription("Time range for the leaderboard")
              .setRequired(false)
              .addChoices(
                { name: "Today", value: "day" },
                { name: "This week", value: "week" },
                { name: "This month", value: "month" },
                { name: "All time", value: "all" },
              ),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("games")
          .setDescription("Rank the games played in this server")
          .addStringOption((o) =>
            o
              .setName("sort")
              .setDescription("How to order the games")
              .setRequired(false)
              .addChoices(
                { name: "Playtime", value: "playtime" },
                { name: "Players", value: "players" },
                { name: "Sessions", value: "sessions" },
                { name: "Alphabetical", value: "alphabetical" },
              ),
          ),
      )
      .addSubcommand((sc) =>
        sc.setName("currently-playing").setDescription("See who's in a game right now"),
      )
      .addSubcommand((sc) =>
        sc
          .setName("opt-out")
          .setDescription("Stop recording your gaming activity")
          .addBooleanOption((o) =>
            o
              .setName("delete-history")
              .setDescription("Also delete the sessions already recorded for you")
              .setRequired(false),
          ),
      )
      .addSubcommand((sc) =>
        sc.setName("opt-in").setDescription("Start recording your gaming activity again"),
      ),
    async execute({ interaction, guild, gaming, ephemeral }) {
      if (!gaming) {
        await replyNotice(interaction, "Gaming analytics isn't available right now.");
        return;
      }
      const sub = interaction.options.getSubcommand();
      const handler = {
        overview: gaming.handleOverview,
        profile: gaming.handleProfile,
        leaderboard: gaming.handleLeaderboard,
        games: gaming.handleGames,
        "currently-playing": gaming.handleCurrentlyPlaying,
        "opt-out": gaming.handleOptOut,
        "opt-in": gaming.handleOptIn,
      }[sub];
      if (!handler) {
        await replyNotice(interaction, "Gaming analytics isn't available right now.");
        return;
      }
      await handler({ interaction, guild, ephemeral });
    },
  },
  {
    name: "invite",
    category: "information",
    module: "invites",
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/invite stats", "/invite stats user:@username", "/invite leaderboard period:month", "/invite rewards"],
    detail:
      "Invite tracking and referrals. `stats` shows a member's invites — valid, pending, fake and left — plus their rank and progress toward the next reward (defaults to you). `leaderboard` ranks the server's top inviters over a time range, counting only invites that pass the server's validity rules, so farmed joins don't inflate it. `rewards` lists the invite milestones and how far you are from each. Requires invite tracking to be switched on under Engagement › Invites.",
    data: new SlashCommandBuilder()
      .setName("invite")
      .setDescription("Invite stats, leaderboard and rewards")
      .addSubcommand((sc) =>
        sc
          .setName("stats")
          .setDescription("Show your invite stats (or another member's)")
          .addUserOption((o) =>
            o.setName("user").setDescription("The member to look up (defaults to you)").setRequired(false),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("leaderboard")
          .setDescription("See the top inviters in this server")
          .addStringOption((o) =>
            o
              .setName("period")
              .setDescription("Time range for the leaderboard")
              .setRequired(false)
              .addChoices(
                { name: "Today", value: "day" },
                { name: "This week", value: "week" },
                { name: "This month", value: "month" },
                { name: "All time", value: "all" },
              ),
          ),
      )
      .addSubcommand((sc) =>
        sc.setName("rewards").setDescription("See the invite reward milestones and your progress"),
      ),
    async execute({ interaction, guild, invites, milestones, ephemeral }) {
      if (!invites) {
        await replyNotice(interaction, "Invite tracking isn't available right now.");
        return;
      }
      // The handlers read their options with getUser("user") / getString("period")
      // exactly as before — inside a subcommand those resolve identically, so
      // none of them needed changing. `milestones` is handed to `rewards` so it
      // can render invite milestones with the shared /milestones look.
      const sub = interaction.options.getSubcommand();
      const handler = {
        stats: invites.handleInvitesCommand,
        leaderboard: invites.handleLeaderboardCommand,
        rewards: invites.handleRewardsCommand,
      }[sub];
      if (!handler) {
        await replyNotice(interaction, "Invite tracking isn't available right now.");
        return;
      }
      await handler({ interaction, guild, ephemeral, milestones });
    },
  },
  {
    name: "balance",
    category: "information",
    module: "economy",
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/balance", "/balance user:@username"],
    detail:
      "Shows the global Pulse balance — coin balance, leaderboard position, reputation tier, lifetime earned/spent and recent activity. Balance and reputation are shared across every server running Pulse; levels stay per-server. Defaults to your own.",
    data: new SlashCommandBuilder()
      .setName("balance")
      .setDescription(
        "Show a member's global Pulse balance, reputation and ranking",
      )
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("The member to look up (defaults to you)")
          .setRequired(false),
      ),
    async execute({ interaction, guild, economy, ephemeral }) {
      if (!economy?.handleBalanceCommand) {
        await replyNotice(interaction, "The Pulse economy isn't available right now.");
        return;
      }
      await economy.handleBalanceCommand({ interaction, guild, ephemeral });
    },
  },
  {
    name: "leaderboard",
    category: "information",
    // Spans three modules — global economy (balance, reputation), leveling
    // (level, XP) and raw activity (messages, voice). Gating it on any one of
    // them would remove the other four boards from a server that runs them, so
    // like /profile it stays available and degrades to what's on.
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/leaderboard", "/leaderboard type:Server Level"],
    detail:
      "An interactive leaderboard with a menu to switch between six boards — Global Balance, Global Reputation, Server Level, Server XP, Messages and Voice Activity — plus pagination. Highlights your own position and shows rank, name and value for each member.",
    data: new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription(
        "View Pulse leaderboards — balance, reputation, levels, XP and activity",
      )
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("Which leaderboard to open first (you can switch in the menu)")
          .setRequired(false)
          .addChoices(
            { name: "Global Balance", value: "balance" },
            { name: "Global Reputation", value: "reputation" },
            { name: "Server Level", value: "level" },
            { name: "Server XP", value: "xp" },
            { name: "Messages", value: "messages" },
            { name: "Voice Activity", value: "voice" },
          ),
      ),
    async execute({ interaction, guild, economy, ephemeral }) {
      if (!economy?.handleLeaderboardCommand) {
        await replyNotice(interaction, "The Pulse economy isn't available right now.");
        return;
      }
      await economy.handleLeaderboardCommand({ interaction, guild, ephemeral });
    },
  },
  {
    name: "info",
    category: "information",
    module: "economy",
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/info"],
    detail:
      "A single-embed guide to earning across Pulse: the global economy (Pulse Balance & Reputation — events, giveaways, onboarding, milestones, daily/weekly) and server progression (XP & Levels — messages, voice, participation, level rewards).",
    data: new SlashCommandBuilder()
      .setName("info")
      .setDescription(
        "Learn how to earn Pulse Balance, Reputation, XP and Levels",
      ),
    async execute({ interaction, guild, economy, ephemeral }) {
      if (!economy?.handleInfoCommand) {
        await replyNotice(interaction, "The Pulse economy isn't available right now.");
        return;
      }
      await economy.handleInfoCommand({ interaction, guild, ephemeral });
    },
  },
  {
    name: "pay",
    category: "utility",
    module: "economy",
    defaultPermission: PERMISSION.EVERYONE,
    // Public by default so the recipient sees the transfer land.
    defaultEphemeral: false,
    examples: [
      "/pay user:@username amount:100",
      "/pay user:@username amount:50 note:thanks!",
    ],
    detail:
      "Transfers Pulse Coins between global balances — the transfer is atomic, refused if the sender cannot afford it, and recorded in both members' transaction history. Public by default so the recipient sees it land.",
    data: new SlashCommandBuilder()
      .setName("pay")
      .setDescription(
        "Send Pulse Coins from your global balance to another member",
      )
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("Who receives the coins")
          .setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName("amount")
          .setDescription("How many coins to send")
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption((o) =>
        o
          .setName("note")
          .setDescription("Optional note shown with the transfer")
          .setRequired(false)
          .setMaxLength(300),
      ),
    async execute({ interaction, guild, economy, ephemeral }) {
      if (!economy?.handlePayCommand) {
        await replyNotice(interaction, "The Pulse economy isn't available right now.");
        return;
      }
      await economy.handlePayCommand({ interaction, guild, ephemeral });
    },
  },
  {
    name: "daily",
    category: "information",
    module: "economy",
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/daily"],
    detail:
      "Claims the daily Pulse Coins reward and advances your daily streak — consecutive claims pay progressively more, and missing a day resets the streak. The amounts, streak bonuses and cooldown are configured by the operator under Economy › Earnings settings.",
    data: new SlashCommandBuilder()
      .setName("daily")
      .setDescription("Claim your daily Pulse Coins reward and build a streak"),
    async execute({ interaction, guild, economyRewards, ephemeral }) {
      if (!economyRewards?.handleClaimCommand) {
        await replyNotice(interaction, "Rewards aren't available right now.");
        return;
      }
      await economyRewards.handleClaimCommand({ interaction, guild, ephemeral }, "daily");
    },
  },
  {
    name: "weekly",
    category: "information",
    module: "economy",
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/weekly"],
    detail:
      "Claims the weekly Pulse Coins reward and advances your weekly streak — a larger payout than /daily on a longer cooldown. The amounts, streak bonuses and cooldown are configured by the operator under Economy › Earnings settings.",
    data: new SlashCommandBuilder()
      .setName("weekly")
      .setDescription("Claim your weekly Pulse Coins reward and build a streak"),
    async execute({ interaction, guild, economyRewards, ephemeral }) {
      if (!economyRewards?.handleClaimCommand) {
        await replyNotice(interaction, "Rewards aren't available right now.");
        return;
      }
      await economyRewards.handleClaimCommand({ interaction, guild, ephemeral }, "weekly");
    },
  },
  {
    // `alt check` rather than `alt-check`: Discord forbids a space in a command
    // name, so a subcommand is the only way to render it as two words — matching
    // /birthday and /invite. A group with one subcommand also leaves room for
    // the obvious future additions (link, unlink, investigations) without
    // minting more top-level names.
    name: "alt",
    category: "moderation",
    // Alt Detection has no master switch — the risk score is computed on demand
    // from signals Pulse already has, so the command works in any server.
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/alt check user:@username"],
    detail:
      "Scores an account against the alt-account indicators Pulse can see — account age, join recency, default avatar, activity, moderation history, reputation, economy footprint, giveaways, onboarding and prior safety flags — then lists the accounts that may be related, each with a confidence percentage. Nothing here proves an alt: Discord exposes no IP or device data, so treat the score as evidence to review. Every check is recorded in the Alt Detection view. Moderators only.",
    data: new SlashCommandBuilder()
      .setName("alt")
      .setDescription("Alt account safety checks")
      .addSubcommand((sc) =>
        sc
          .setName("check")
          .setDescription("Check an account's alt risk — score, factors and potential linked accounts")
          .addUserOption((o) =>
            o.setName("user").setDescription("The account to check").setRequired(true),
          ),
      ),
    async execute({ interaction, guild, altDetection, ephemeral }) {
      if (!altDetection?.handleAltCheckCommand) {
        await replyNotice(interaction, "Alt detection isn't available right now.");
        return;
      }
      await altDetection.handleAltCheckCommand({ interaction, guild, ephemeral });
    },
  },

  // ── Member & Community (PULSIFY-61) ────────────────────────────────────────
  // Pure reads of Discord data — no module, no writes, available to everyone.
  // The handlers are inline (like /help and /profile) because they need no
  // module closure or database: everything comes from the cached guild and the
  // member Discord resolves onto the interaction. /rank and /reputation, by
  // contrast, live in leveling.js / economy.js — they read those modules' data.
  {
    name: "rank",
    category: "information",
    module: "leveling",
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/rank", "/rank user:@username"],
    detail:
      "Shows a member's level, total XP and their position on the server leaderboard, with a bar tracking progress to the next level. Levels are specific to this server. Requires Levels & XP to be switched on. Defaults to you.",
    data: new SlashCommandBuilder()
      .setName("rank")
      .setDescription("Show a member's level, XP and leaderboard position")
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("The member to look up (defaults to you)")
          .setRequired(false),
      ),
    async execute({ interaction, guild, leveling, ephemeral }) {
      if (!leveling?.handleRankCommand) {
        await replyNotice(interaction, "Levels aren't available right now.");
        return;
      }
      await leveling.handleRankCommand({ interaction, guild, ephemeral });
    },
  },
  {
    name: "reputation",
    category: "information",
    // Reputation predates the economy and is always computable (it's a live 0-100
    // score, never stored), so it stays available even where the economy module
    // is off — module null, like /profile.
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/reputation", "/reputation user:@username"],
    detail:
      "Shows a member's global Pulse reputation — a 0-100 trust score computed live from account age, time in servers, messages and voice, and lowered by moderation history. It's shared across every server running Pulse and is never stored. Defaults to you.",
    data: new SlashCommandBuilder()
      .setName("reputation")
      .setDescription("Show a member's global Pulse reputation score")
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("The member to look up (defaults to you)")
          .setRequired(false),
      ),
    async execute({ interaction, guild, economy, ephemeral }) {
      if (!economy?.handleReputationCommand) {
        await replyNotice(interaction, "Reputation isn't available right now.");
        return;
      }
      await economy.handleReputationCommand({ interaction, guild, ephemeral });
    },
  },
  {
    name: "userinfo",
    category: "information",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/userinfo", "/userinfo user:@username"],
    detail:
      "A member's Discord details at a glance — username, ID, when the account was created and when they joined this server, their roles, whether they're boosting, and any elevated permissions they hold. Defaults to you.",
    data: new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("Show a member's Discord account and server details")
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("The member to look up (defaults to you)")
          .setRequired(false),
      ),
    async execute({ interaction, guild, supabase, ephemeral }) {
      const colorHex = await getPulseColor(supabase, guild.id);
      const user = interaction.options.getUser("user") ?? interaction.user;
      // getMember resolves the GuildMember Discord attached to the interaction —
      // null when the looked-up user isn't in this server.
      const member = interaction.options.getMember("user") ?? interaction.member;
      const isSelf = user.id === interaction.user.id;
      const displayName = member?.displayName ?? user.globalName ?? user.username;
      const avatarUrl = (member ?? user).displayAvatarURL({ size: 512 });

      const created = Math.floor(user.createdTimestamp / 1000);
      const accountLines = [
        `**Username** — @${user.username}`,
        `**ID** — \`${user.id}\``,
        `**Account created** — <t:${created}:D> (<t:${created}:R>)`,
      ];
      if (user.bot) accountLines.push("**Type** — Bot application");

      const body = [
        text(
          isSelf
            ? "Here's your Discord profile in this server."
            : `Here's ${displayName}'s Discord profile in this server.`,
        ),
        divider(),
        text(accountLines.join("\n")),
      ];

      if (member) {
        const memberLines = [];
        if (member.joinedTimestamp) {
          const joined = Math.floor(member.joinedTimestamp / 1000);
          memberLines.push(`**Joined server** — <t:${joined}:D> (<t:${joined}:R>)`);
        }
        if (member.premiumSinceTimestamp) {
          memberLines.push(
            `**Boosting since** — <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`,
          );
        }
        if (memberLines.length > 0) {
          body.push(divider());
          body.push(text(memberLines.join("\n")));
        }

        // Roles — highest first, @everyone excluded, shown as inline pills
        // (rule 2b: mentions carry their own boundary, so a space joins them).
        const roles = member.roles.cache
          .filter((r) => r.id !== guild.id)
          .sort((a, b) => b.position - a.position);
        body.push(divider());
        if (roles.size > 0) {
          const shown = [...roles.values()].slice(0, 15).map((r) => `<@&${r.id}>`);
          const extra = roles.size - shown.length;
          body.push(
            text(
              `**Roles — ${roles.size}**\n${shown.join(" ")}${extra > 0 ? `\n-# and ${extra} more` : ""}`,
            ),
          );
        } else {
          body.push(text("**Roles** — none"));
        }

        // Elevated permissions worth calling out. Administrator implies the rest,
        // so we show only that when present rather than a redundant wall.
        const perms = member.permissions;
        const notable = perms.has(PermissionFlagsBits.Administrator)
          ? ["`Administrator`"]
          : KEY_PERMISSIONS.filter(([flag]) => perms.has(flag)).map(([, label]) => `\`${label}\``);
        if (notable.length > 0) {
          body.push(divider());
          body.push(text(`**Key permissions**\n${notable.join(" ")}`));
        }
      } else {
        body.push(divider());
        body.push(
          text(
            "-# This member isn't in the server, so their roles and join date aren't available.",
          ),
        );
      }

      await interaction.reply({
        flags:
          MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
        components: [
          buildPulseContainer({
            iconUrl: avatarUrl,
            colorHex,
            title: `**${displayName}**`,
            subtitle: user.bot ? "Bot" : "Member",
            body,
            footer: "Pulse — Member info",
          }),
        ],
      });
    },
  },
  {
    name: "serverinfo",
    category: "information",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/serverinfo"],
    detail:
      "A snapshot of this server — its owner, when it was created, member and channel counts, roles, emojis and stickers, boost level, and the verification and content-filter settings.",
    data: new SlashCommandBuilder()
      .setName("serverinfo")
      .setDescription("Show this server's details and stats"),
    async execute({ interaction, guild, supabase, ephemeral }) {
      const colorHex = await getPulseColor(supabase, guild.id);
      const iconUrl = guild.iconURL({ size: 512 });

      const created = Math.floor(guild.createdTimestamp / 1000);
      const channels = guild.channels.cache;
      const textCount = channels.filter(
        (c) =>
          c.type === ChannelType.GuildText ||
          c.type === ChannelType.GuildAnnouncement,
      ).size;
      const voiceCount = channels.filter(
        (c) =>
          c.type === ChannelType.GuildVoice ||
          c.type === ChannelType.GuildStageVoice,
      ).size;
      const categoryCount = channels.filter(
        (c) => c.type === ChannelType.GuildCategory,
      ).size;

      const total = guild.memberCount;
      // Bots are best-effort from the member cache (primed at startup); the total
      // is always accurate regardless.
      const bots = guild.members.cache.filter((m) => m.user.bot).size;
      const boosts = guild.premiumSubscriptionCount ?? 0;

      const body = [
        text(`A snapshot of **${guild.name}**.`),
        divider(),
        text(
          [
            `**Owner** — <@${guild.ownerId}>`,
            `**Created** — <t:${created}:D> (<t:${created}:R>)`,
            `**Members** — ${total.toLocaleString()}${bots > 0 ? ` — ${bots} bot${bots === 1 ? "" : "s"}` : ""}`,
          ].join("\n"),
        ),
        divider(),
        text(
          [
            `**Channels** — ${textCount} text — ${voiceCount} voice — ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}`,
            `**Roles** — ${Math.max(0, guild.roles.cache.size - 1).toLocaleString()}`,
            `**Emojis** — ${guild.emojis.cache.size} — **Stickers** — ${guild.stickers.cache.size}`,
          ].join("\n"),
        ),
        divider(),
        text(
          [
            `**Boost level** — Tier ${guild.premiumTier} — ${boosts} boost${boosts === 1 ? "" : "s"}`,
            `**Verification** — ${VERIFICATION_LABELS[guild.verificationLevel] ?? guild.verificationLevel}`,
            `**Content filter** — ${EXPLICIT_FILTER_LABELS[guild.explicitContentFilter] ?? guild.explicitContentFilter}`,
          ].join("\n"),
        ),
      ];

      await interaction.reply({
        flags:
          MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
        components: [
          buildPulseContainer({
            iconUrl,
            colorHex,
            title: `**${guild.name}**`,
            subtitle: `Server — ${total.toLocaleString()} members`,
            body,
            footer: "Pulse — Server info",
          }),
        ],
      });
    },
  },

  // ── Moderation (PULSIFY-61) ────────────────────────────────────────────────
  // Every one of these writes to `moderation_logs` via src/moderation-log.js, so
  // an action taken here lands in Moderation History, Management Analytics and
  // the activity feed exactly as the dashboard's would — tagged
  // source = "Discord Command".
  //
  // `module` is null throughout: these are not gated on the Moderation Alerts
  // feature (that switch governs alert POSTING, not whether a moderator may act).
  // Discord's own permissions plus the moderator tier are the real gate.
  {
    name: "warn",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/warn user:@username reason:Spamming in general"],
    detail:
      "Records a warning against a member and DMs them the reason. Warnings are a record rather than a Discord action, so this works even after the member leaves. The reply shows their running total of active warnings, and everything appears under Moderation with the rest of the history.",
    data: new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Warn a member and record it")
      .addUserOption((o) =>
        o.setName("user").setDescription("The member to warn").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("reason")
          .setDescription("Why they're being warned (shown to them)")
          .setRequired(true)
          .setMaxLength(500),
      ),
    async execute({ interaction, guild, moderation, ephemeral }) {
      await moderation.handleWarn({ interaction, guild, ephemeral });
    },
  },
  {
    name: "timeout",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: [
      "/timeout user:@username duration:10m",
      "/timeout user:@username duration:1d reason:Repeated spam",
    ],
    detail:
      "Times a member out so they can't speak or react. Duration accepts 10m, 2h, 1d, 1h30m or a plain number of minutes, with common presets offered as you type. Discord caps timeouts at 28 days. The member is DMed when it expires and the action is recorded under Moderation.",
    data: new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Time a member out for a while")
      .addUserOption((o) =>
        o.setName("user").setDescription("The member to time out").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("duration")
          .setDescription("How long — e.g. 10m, 2h, 1d (max 28 days)")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName("reason")
          .setDescription("Why they're being timed out (shown to them)")
          .setRequired(false)
          .setMaxLength(500),
      ),
    async execute({ interaction, guild, moderation, ephemeral }) {
      await moderation.handleTimeout({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, moderation }) {
      await moderation.autocompleteDuration({ interaction, guild });
    },
  },
  {
    name: "untimeout",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/untimeout user:@username"],
    detail:
      "Lifts an active timeout early and lets the member take part again. Tells you plainly if they aren't actually timed out, and DMs them that it's been lifted.",
    data: new SlashCommandBuilder()
      .setName("untimeout")
      .setDescription("Lift a member's timeout early")
      .addUserOption((o) =>
        o.setName("user").setDescription("The member to untime out").setRequired(true),
      ),
    async execute({ interaction, guild, moderation, ephemeral }) {
      await moderation.handleUntimeout({ interaction, guild, ephemeral });
    },
  },
  {
    name: "kick",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/kick user:@username reason:Breaking rule 3"],
    detail:
      "Removes a member from the server. They can rejoin with a new invite — use /ban to keep them out. They're DMed the reason before the kick lands, while the DM channel is still reachable.",
    data: new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Remove a member from the server")
      .addUserOption((o) =>
        o.setName("user").setDescription("The member to kick").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("reason")
          .setDescription("Why they're being kicked (shown to them)")
          .setRequired(false)
          .setMaxLength(500),
      ),
    async execute({ interaction, guild, moderation, ephemeral }) {
      await moderation.handleKick({ interaction, guild, ephemeral });
    },
  },
  {
    name: "ban",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: [
      "/ban user:@username reason:Raid account",
      "/ban user:@username reason:Spam delete_days:1",
    ],
    detail:
      "Bans a member and optionally deletes their recent messages (up to 7 days' worth). Works on accounts that were never in the server, so you can pre-emptively ban a known raider by ID. Refuses if they're already banned.",
    data: new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a member from the server")
      .addUserOption((o) =>
        o.setName("user").setDescription("The member to ban").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("reason")
          .setDescription("Why they're being banned (shown to them)")
          .setRequired(false)
          .setMaxLength(500),
      )
      .addIntegerOption((o) =>
        o
          .setName("delete_days")
          .setDescription("Delete their messages from the last N days (0-7)")
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(7),
      ),
    async execute({ interaction, guild, moderation, ephemeral }) {
      await moderation.handleBan({ interaction, guild, ephemeral });
    },
  },
  {
    name: "unban",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/unban user_id:123456789012345678 reason:Appealed"],
    detail:
      "Lifts a ban. Start typing a name and Pulse suggests the server's current bans — Discord can't offer a member picker for someone who has left, so this is how you find them without hunting for a user ID.",
    data: new SlashCommandBuilder()
      .setName("unban")
      .setDescription("Lift a ban")
      .addStringOption((o) =>
        o
          .setName("user_id")
          .setDescription("Start typing a name, or paste their user ID")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName("reason")
          .setDescription("Why the ban is being lifted")
          .setRequired(false)
          .setMaxLength(500),
      ),
    async execute({ interaction, guild, moderation, ephemeral }) {
      await moderation.handleUnban({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, moderation }) {
      await moderation.autocompleteBannedUser({ interaction, guild });
    },
  },
  {
    name: "warnings",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/warnings user:@username"],
    detail:
      "Shows a member's warning history — who warned them, when, and why — with their active and total counts. Inactive warnings (cleared in the dashboard) are listed but marked, so the record stays complete.",
    data: new SlashCommandBuilder()
      .setName("warnings")
      .setDescription("Show a member's warning history")
      .addUserOption((o) =>
        o.setName("user").setDescription("The member to look up").setRequired(true),
      ),
    async execute({ interaction, guild, moderation, ephemeral }) {
      await moderation.handleWarnings({ interaction, guild, ephemeral });
    },
  },
  {
    name: "purge",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/purge amount:25", "/purge amount:10 user:@username"],
    detail:
      "Bulk-deletes recent messages in the current channel, optionally only one member's. Discord won't bulk-delete messages older than 14 days or pinned ones — those are skipped and the reply says how many were left behind. Capped at 100 per run.",
    data: new SlashCommandBuilder()
      .setName("purge")
      .setDescription("Bulk-delete recent messages in this channel")
      .addIntegerOption((o) =>
        o
          .setName("amount")
          .setDescription("How many messages to delete (1-100)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      )
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("Only delete this member's messages")
          .setRequired(false),
      ),
    async execute({ interaction, guild, moderation, ephemeral }) {
      await moderation.handlePurge({ interaction, guild, ephemeral });
    },
  },
  {
    name: "modlogs",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/modlogs", "/modlogs user:@username"],
    detail:
      "The most recent moderation actions in the server, or everything on record against one member. Each entry shows what happened, who did it, when, and whether it came from Discord or the dashboard — the same history the Moderation view renders.",
    data: new SlashCommandBuilder()
      .setName("modlogs")
      .setDescription("Show recent moderation actions")
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("Only show actions against this member")
          .setRequired(false),
      ),
    async execute({ interaction, guild, moderation, ephemeral }) {
      await moderation.handleModlogs({ interaction, guild, ephemeral });
    },
  },
  {
    // Server Timeline (PULSIFY-63). Sits in `insights` rather than `moderation`
    // because it spans the whole server, not just enforcement — /modlogs is the
    // moderation-only view, this is everything.
    name: "timeline",
    category: "insights",
    module: null,
    defaultPermission: PERMISSION.ADMIN,
    examples: [
      "/timeline",
      "/timeline category:Roles",
      "/timeline user:@username",
    ],
    detail:
      "The most recent significant changes to the server — roles, channels, members, moderation, economy, automations, events and configuration — whether they were made in the dashboard or directly in Discord. Each entry says what changed, who changed it and where from. Narrow it to one category or one member, or open Analytics › History in the dashboard for the full history with search, before/after values and CSV/JSON/PDF exports. Admins only.",
    data: new SlashCommandBuilder()
      .setName("timeline")
      .setDescription("Show what recently changed in this server")
      .addStringOption((o) =>
        o
          .setName("category")
          .setDescription("Only show one kind of change")
          .setRequired(false)
          .addChoices(
            { name: "Roles", value: "roles" },
            { name: "Channels", value: "channels" },
            { name: "Members", value: "members" },
            { name: "Moderation", value: "moderation" },
            { name: "Economy", value: "economy" },
            { name: "Automation", value: "automation" },
            { name: "Events", value: "events" },
            { name: "Configuration", value: "configuration" },
          ),
      )
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("Only show changes involving this member")
          .setRequired(false),
      ),
    async execute({ interaction, guild, timeline, ephemeral }) {
      if (!timeline?.handleTimeline) {
        await replyNotice(interaction, "The timeline isn't available right now.");
        return;
      }
      await timeline.handleTimeline({ interaction, guild, ephemeral });
    },
  },

  // ── Roles & Channels (PULSIFY-61) ──────────────────────────────────────────
  {
    // All admin role actions under one name — including `temp`, which the spec
    // lists as a separate /temprole. See the note at the top of src/roles.js.
    name: "role",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.ADMIN,
    examples: [
      "/role add user:@username role:@VIP",
      "/role remove user:@username role:@VIP",
      "/role temp user:@username role:@VIP duration:7d",
      "/role info role:@VIP",
      "/role hierarchy",
    ],
    detail:
      "Manage roles from Discord. `add` and `remove` change a member's roles and record it under Moderation. `temp` grants a role that Pulse takes back automatically when it expires — the same Temporary Roles system the dashboard uses, so it shows up there with its countdown. `info` reports a role's category, member count, position and privileged permissions. `hierarchy` groups every role into Management, Bots and Community and tells you which roles sit above Pulse (and so can't be assigned). Admins only.",
    data: new SlashCommandBuilder()
      .setName("role")
      .setDescription("Add, remove and inspect roles")
      .addSubcommand((sc) =>
        sc
          .setName("add")
          .setDescription("Give a member a role")
          .addUserOption((o) => o.setName("user").setDescription("The member").setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("The role to add").setRequired(true))
          .addStringOption((o) =>
            o.setName("reason").setDescription("Why (recorded in the log)").setRequired(false).setMaxLength(300),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("remove")
          .setDescription("Take a role off a member")
          .addUserOption((o) => o.setName("user").setDescription("The member").setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("The role to remove").setRequired(true))
          .addStringOption((o) =>
            o.setName("reason").setDescription("Why (recorded in the log)").setRequired(false).setMaxLength(300),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("temp")
          .setDescription("Give a member a role that expires on its own")
          .addUserOption((o) => o.setName("user").setDescription("The member").setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("The role to grant").setRequired(true))
          .addStringOption((o) =>
            o
              .setName("duration")
              .setDescription("How long — e.g. 7d, 12h, 30d (max 4 years)")
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addStringOption((o) =>
            o.setName("reason").setDescription("Why (recorded in the log)").setRequired(false).setMaxLength(300),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("info")
          .setDescription("Show a role's details")
          .addRoleOption((o) => o.setName("role").setDescription("The role to inspect").setRequired(true)),
      )
      .addSubcommand((sc) =>
        sc.setName("hierarchy").setDescription("Show the server's role structure"),
      ),
    async execute({ interaction, guild, roles, ephemeral }) {
      const sub = interaction.options.getSubcommand();
      const handler = {
        add: roles?.handleAdd,
        remove: roles?.handleRemove,
        temp: roles?.handleTemp,
        info: roles?.handleInfo,
        hierarchy: roles?.handleHierarchy,
      }[sub];
      if (!handler) {
        await replyNotice(interaction, "Role commands aren't available right now.");
        return;
      }
      await handler({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, roles }) {
      // Only `temp` has an autocompleting option today.
      if (interaction.options.getSubcommand() === "temp") {
        await roles.autocompleteTempDuration({ interaction, guild });
        return;
      }
      await interaction.respond([]);
    },
  },
  {
    // Deliberately its own command rather than `/role menu`: command_configs
    // keys on command_name and Discord's default_member_permissions sits on the
    // top-level command, so a subcommand can't carry a different tier. Folding
    // this into /role would either expose the admin subcommands to everyone or
    // let an "admins only" override kill the member menu.
    name: "selfrole",
    category: "information",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/selfrole", "/selfrole category:color"],
    detail:
      "Find the server's self-assign role menus and jump straight to them. Lists every active menu with its category and channel, plus a button that opens it. Admins create and post menus under Server › Roles; this is how members find them without scrolling back through a channel.",
    data: new SlashCommandBuilder()
      .setName("selfrole")
      .setDescription("Find the role menus you can pick your own roles from")
      .addStringOption((o) =>
        o
          .setName("category")
          .setDescription("Only show menus in this category")
          .setRequired(false)
          .setAutocomplete(true),
      ),
    async execute({ interaction, guild, roles, ephemeral }) {
      if (!roles?.handleSelfRole) {
        await replyNotice(interaction, "Self-assign roles aren't available right now.");
        return;
      }
      await roles.handleSelfRole({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, roles }) {
      await roles.autocompleteSelfRoleCategory({ interaction, guild });
    },
  },
  {
    name: "channel",
    category: "moderation",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: [
      "/channel lock",
      "/channel unlock channel:#general",
      "/channel slowmode seconds:30",
      "/channel stats channel:#general",
    ],
    detail:
      "Channel controls from Discord. `lock` denies Send Messages to @everyone (roles with an explicit allow keep talking, so staff can still coordinate); `unlock` resets that override to inherit rather than force-allowing it. `slowmode` sets the wait between messages, up to Discord's 6-hour cap. `stats` summarises the last 30 days — messages, commands, people active, daily average and the busiest day. All default to the channel you run them in.",
    data: new SlashCommandBuilder()
      .setName("channel")
      .setDescription("Lock, unlock, slow down or inspect a channel")
      .addSubcommand((sc) =>
        sc
          .setName("lock")
          .setDescription("Stop members sending messages here")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Which channel (defaults to this one)").setRequired(false),
          )
          .addStringOption((o) =>
            o.setName("reason").setDescription("Why (recorded in the log)").setRequired(false).setMaxLength(300),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("unlock")
          .setDescription("Let members send messages here again")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Which channel (defaults to this one)").setRequired(false),
          )
          .addStringOption((o) =>
            o.setName("reason").setDescription("Why (recorded in the log)").setRequired(false).setMaxLength(300),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("slowmode")
          .setDescription("Set the wait between messages")
          .addIntegerOption((o) =>
            o
              .setName("seconds")
              .setDescription("Seconds between messages — 0 turns it off (max 21600)")
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(21600)
              .setAutocomplete(true),
          )
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Which channel (defaults to this one)").setRequired(false),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("stats")
          .setDescription("Show a channel's activity over the last 30 days")
          .addChannelOption((o) =>
            o.setName("channel").setDescription("Which channel (defaults to this one)").setRequired(false),
          ),
      ),
    async execute({ interaction, guild, channels, ephemeral }) {
      const sub = interaction.options.getSubcommand();
      const handler = {
        lock: channels?.handleLock,
        unlock: channels?.handleUnlock,
        slowmode: channels?.handleSlowmode,
        stats: channels?.handleStats,
      }[sub];
      if (!handler) {
        await replyNotice(interaction, "Channel commands aren't available right now.");
        return;
      }
      await handler({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, channels }) {
      if (interaction.options.getSubcommand() === "slowmode") {
        await channels.autocompleteSlowmode({ interaction, guild });
        return;
      }
      await interaction.respond([]);
    },
  },

  // ── Tickets & Applications (PULSIFY-61) ────────────────────────────────────
  {
    // SUPPORT tier — the first command that uses it. Support staff are defined
    // by holding one of the roles in Server › Tickets, so a ticket handler who
    // is deliberately NOT a moderator can still work their queue.
    //
    // Every subcommand acts on the ticket whose CHANNEL you're standing in, so
    // there's no ID to look up. They delegate to the same internals the ticket
    // panel's buttons use (see the slash-command section in src/tickets.js).
    name: "ticket",
    category: "utility",
    module: "tickets",
    defaultPermission: PERMISSION.SUPPORT,
    examples: [
      "/ticket claim",
      "/ticket close reason:Resolved",
      "/ticket add user:@username",
      "/ticket priority level:high",
    ],
    detail:
      "Work a ticket from inside its channel — no ID to look up. `claim` takes ownership; `close` saves the transcript, rewards whoever handled it and locks the channel; `add` gives another member access; `priority` re-files it low through urgent. Everything lands in the ticket's timeline and the dashboard exactly as the panel buttons would. Available to support staff (the roles set under Server › Tickets) as well as moderators and admins.",
    data: new SlashCommandBuilder()
      .setName("ticket")
      .setDescription("Claim, close and manage the ticket you're in")
      .addSubcommand((sc) =>
        sc.setName("claim").setDescription("Take ownership of this ticket"),
      )
      .addSubcommand((sc) =>
        sc
          .setName("close")
          .setDescription("Close this ticket and save its transcript")
          .addStringOption((o) =>
            o
              .setName("reason")
              .setDescription("Why it's being closed (shown to the opener)")
              .setRequired(false)
              .setMaxLength(500),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("add")
          .setDescription("Give another member access to this ticket")
          .addUserOption((o) =>
            o.setName("user").setDescription("The member to add").setRequired(true),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("priority")
          .setDescription("Set this ticket's priority")
          .addStringOption((o) =>
            o
              .setName("level")
              .setDescription("How urgent this ticket is")
              .setRequired(true)
              .addChoices(
                { name: "Low", value: "low" },
                { name: "Normal", value: "normal" },
                { name: "High", value: "high" },
                { name: "Urgent", value: "urgent" },
              ),
          ),
      ),
    async execute({ interaction, guild, tickets }) {
      const sub = interaction.options.getSubcommand();
      const handler = {
        claim: tickets?.handleClaimCommand,
        close: tickets?.handleCloseCommand,
        add: tickets?.handleAddCommand,
        priority: tickets?.handlePriorityCommand,
      }[sub];
      if (!handler) {
        await replyNotice(interaction, "The ticket system isn't available right now.");
        return;
      }
      // Deliberately NOT passing `ephemeral`: these handlers reply into the
      // ticket channel on purpose — a claim or a priority change is information
      // the whole ticket needs, not a private confirmation.
      await handler({ interaction, guild });
    },
  },
  {
    // Its own command, not `/ticket status` — /ticket is support-tier and this
    // is for the applicant themselves (a subcommand can't carry its own tier).
    name: "application",
    category: "information",
    module: "tickets",
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/application status"],
    detail:
      "Check where your applications stand — the type, when you submitted, the decision and any note the reviewers left you. Shows your last 10 in this server. Only ever shows your own: applications carry notes written for the applicant, so there's no option to look up anyone else's.",
    data: new SlashCommandBuilder()
      .setName("application")
      .setDescription("Check your applications")
      .addSubcommand((sc) =>
        sc.setName("status").setDescription("See the status of your applications"),
      ),
    async execute({ interaction, guild, tickets, ephemeral }) {
      if (!tickets?.handleApplicationStatusCommand) {
        await replyNotice(interaction, "Applications aren't available right now.");
        return;
      }
      await tickets.handleApplicationStatusCommand({ interaction, guild, ephemeral });
    },
  },

  // ── Giveaways & Polls (PULSIFY-61) ─────────────────────────────────────────
  // Both modules own their Discord-native flow (the Join / vote interactions and
  // the start/draw/close lifecycle) already. These commands are the REST-side
  // create/manage surface, mirroring the dashboard's actions: /giveaway end and
  // /poll close route through `draw_requested_at` / `close_requested_at` so the
  // BOT stays the single winner-drawer / vote-tallier — the command never picks
  // a winner itself. `module: null` — neither has a master on/off switch (a
  // server with none simply has an empty list), so like /milestones they're
  // always available; moderator tier gates who can run them, matching the
  // dashboard's authorizeGuildModerator.
  {
    name: "giveaway",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: [
      "/giveaway create prize:Discord Nitro duration:24h winners:1",
      "/giveaway list",
      "/giveaway end",
      "/giveaway reroll",
    ],
    detail:
      "Run giveaways from Discord. `create` posts a giveaway with a Join button — set the prize, how long it runs (e.g. 24h, 2d), and the number of winners; it appears on the dashboard with everything else. `end` draws the winners early, `reroll` draws a fresh winner for one that already ended (excluding the previous winners), and `list` shows what's live. The bot always performs the draw, so winners are never picked twice. Advanced options — entry requirements, blacklists and scheduling — live in the dashboard. Moderators only.",
    data: new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Create and manage giveaways")
      .addSubcommand((sc) =>
        sc
          .setName("create")
          .setDescription("Start a new giveaway")
          .addStringOption((o) =>
            o.setName("prize").setDescription("What's being given away").setRequired(true).setMaxLength(200),
          )
          .addStringOption((o) =>
            o
              .setName("duration")
              .setDescription("How long it runs — e.g. 30m, 24h, 2d (max 60 days)")
              .setRequired(true),
          )
          .addIntegerOption((o) =>
            o
              .setName("winners")
              .setDescription("How many winners to draw (default 1)")
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(50),
          )
          .addStringOption((o) =>
            o.setName("title").setDescription("Headline for the giveaway (default: Giveaway)").setRequired(false).setMaxLength(100),
          )
          .addStringOption((o) =>
            o.setName("description").setDescription("Extra details shown in the giveaway").setRequired(false).setMaxLength(1500),
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("Where to post it (defaults to this channel)")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("end")
          .setDescription("End a giveaway now and draw its winners")
          .addStringOption((o) =>
            o.setName("giveaway").setDescription("Which giveaway to end").setRequired(true).setAutocomplete(true),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("reroll")
          .setDescription("Draw a new winner for a giveaway that has ended")
          .addStringOption((o) =>
            o.setName("giveaway").setDescription("Which ended giveaway to reroll").setRequired(true).setAutocomplete(true),
          ),
      )
      .addSubcommand((sc) =>
        sc.setName("list").setDescription("List the giveaways running in this server"),
      ),
    async execute({ interaction, guild, giveaways, ephemeral }) {
      const sub = interaction.options.getSubcommand();
      const handler = {
        create: giveaways?.handleCreateCommand,
        end: giveaways?.handleEndCommand,
        reroll: giveaways?.handleRerollCommand,
        list: giveaways?.handleListCommand,
      }[sub];
      if (!handler) {
        await replyNotice(interaction, "Giveaways aren't available right now.");
        return;
      }
      await handler({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, giveaways }) {
      const sub = interaction.options.getSubcommand();
      if ((sub === "end" || sub === "reroll") && giveaways?.autocompleteGiveaway) {
        await giveaways.autocompleteGiveaway({ interaction, guild });
        return;
      }
      await interaction.respond([]);
    },
  },
  {
    name: "poll",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: [
      "/poll create question:Best game night? type:single options:Among Us, Minecraft, Valorant",
      "/poll create question:Ship it? type:yes_no duration:2h",
      "/poll results",
      "/poll close",
    ],
    detail:
      "Run polls from Discord. `create` posts a poll members vote on in-channel — pick a single-choice, multiple-choice or yes/no type, list the options (comma-separated), and optionally set how long it runs and whether votes are anonymous. `results` shows the current or final tally, and `close` ends an open poll and posts the outcome. The bot tallies every vote, so results are counted once. Voting restrictions and weighting live in the dashboard. Moderators only.",
    data: new SlashCommandBuilder()
      .setName("poll")
      .setDescription("Create and manage polls")
      .addSubcommand((sc) =>
        sc
          .setName("create")
          .setDescription("Start a new poll")
          .addStringOption((o) =>
            o.setName("question").setDescription("The poll question").setRequired(true).setMaxLength(200),
          )
          .addStringOption((o) =>
            o
              .setName("type")
              .setDescription("What kind of poll")
              .setRequired(true)
              .addChoices(
                { name: "Single choice", value: "single" },
                { name: "Multiple choice", value: "multiple" },
                { name: "Yes / No", value: "yes_no" },
              ),
          )
          .addStringOption((o) =>
            o
              .setName("options")
              .setDescription("Comma-separated options (2-10) — omit for Yes/No")
              .setRequired(false)
              .setMaxLength(1000),
          )
          .addStringOption((o) =>
            o
              .setName("duration")
              .setDescription("How long it runs — e.g. 1h, 2d (omit to close it yourself)")
              .setRequired(false),
          )
          .addBooleanOption((o) =>
            o.setName("anonymous").setDescription("Hide who voted for what (default: no)").setRequired(false),
          )
          .addStringOption((o) =>
            o.setName("description").setDescription("Extra context shown under the question").setRequired(false).setMaxLength(1500),
          )
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("Where to post it (defaults to this channel)")
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("results")
          .setDescription("Show a poll's current or final results")
          .addStringOption((o) =>
            o.setName("poll").setDescription("Which poll").setRequired(true).setAutocomplete(true),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("close")
          .setDescription("Close an open poll and post its results")
          .addStringOption((o) =>
            o.setName("poll").setDescription("Which poll to close").setRequired(true).setAutocomplete(true),
          ),
      ),
    async execute({ interaction, guild, polls, ephemeral }) {
      const sub = interaction.options.getSubcommand();
      const handler = {
        create: polls?.handleCreateCommand,
        results: polls?.handleResultsCommand,
        close: polls?.handleCloseCommand,
      }[sub];
      if (!handler) {
        await replyNotice(interaction, "Polls aren't available right now.");
        return;
      }
      await handler({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, polls }) {
      const sub = interaction.options.getSubcommand();
      if ((sub === "results" || sub === "close") && polls?.autocompletePoll) {
        await polls.autocompletePoll({ interaction, guild });
        return;
      }
      await interaction.respond([]);
    },
  },

  // ── Private Channels (PULSIFY-61) ──────────────────────────────────────────
  {
    // Member self-service: any member can own a join-to-create voice channel and
    // manage THEIR OWN — so it's everyone-tier, and the handler enforces ownership
    // (the same ownedEntry check the control-panel buttons use). Acts on the
    // private channel the invoker is sitting in, calling the exact same mutations
    // the panel does. Every reply is a short confirmation — no header icon, by the
    // embed conventions (deliberately, like /pay and the moderation actions).
    name: "privatechannel",
    category: "utility",
    module: "private_channels",
    defaultPermission: PERMISSION.EVERYONE,
    examples: [
      "/privatechannel lock",
      "/privatechannel unlock",
      "/privatechannel invite user:@username",
      "/privatechannel kick user:@username",
      "/privatechannel rename name:Study Room",
    ],
    detail:
      "Manage the join-to-create voice channel you're in, without the control panel. `lock` and `unlock` stop or allow others joining; `invite` grants a member access; `kick` removes one (and disconnects them); `rename` changes the channel name. Run it while connected to a channel you own — server staff can manage any private channel too. Requires the Private Channels feature to be switched on.",
    data: new SlashCommandBuilder()
      .setName("privatechannel")
      .setDescription("Manage your private voice channel")
      .addSubcommand((sc) =>
        sc.setName("lock").setDescription("Stop others from joining your channel"),
      )
      .addSubcommand((sc) =>
        sc.setName("unlock").setDescription("Let others join your channel again"),
      )
      .addSubcommand((sc) =>
        sc
          .setName("invite")
          .setDescription("Give a member access to your channel")
          .addUserOption((o) =>
            o.setName("user").setDescription("The member to invite").setRequired(true),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("kick")
          .setDescription("Remove a member from your channel")
          .addUserOption((o) =>
            o.setName("user").setDescription("The member to remove").setRequired(true),
          ),
      )
      .addSubcommand((sc) =>
        sc
          .setName("rename")
          .setDescription("Rename your channel")
          .addStringOption((o) =>
            o.setName("name").setDescription("The new channel name").setRequired(true).setMaxLength(100),
          ),
      ),
    async execute({ interaction, guild, privateChannels, ephemeral }) {
      if (!privateChannels?.handlePrivateChannelCommand) {
        await replyNotice(interaction, "Private channels aren't available right now.");
        return;
      }
      await privateChannels.handlePrivateChannelCommand({ interaction, guild, ephemeral });
    },
  },

  // ── Pulse Guard (PULSIFY-61) ───────────────────────────────────────────────
  {
    // FIRST plan-gated command — minPlan "pro" exercises feature-gate's upgrade
    // prompt (moot while EARLY_ACCESS reads everyone as top tier, but built right
    // for when it flips). Module `pulse_guard` gates on ai_moderation_settings —
    // the command only serves where Pulse Guard is switched on. Moderator tier
    // matches the dashboard's authorizeGuildModerator. The bot stays a thin pipe:
    // these READ config + the flagged queue and toggle the whitelist; detection
    // policy lives web-side (src/guard.js has the full rationale).
    name: "guard",
    category: "moderation",
    module: "pulse_guard",
    minPlan: "pro",
    defaultPermission: PERMISSION.MODERATOR,
    examples: [
      "/guard status",
      "/guard review",
      "/guard whitelist add user:@username",
      "/guard whitelist remove role:@Trusted",
    ],
    detail:
      "Check and tune Pulse Guard, the AI moderation engine, from Discord. `status` summarises what's on — sensitivity, active detectors, alert channel, whitelist size and the last 7 days of activity. `review` lists the most recent detections that may need a look, with a jump link to each. `whitelist add`/`remove` exempts a member or role from analysis (or puts them back). Detection itself runs server-side; these are the controls. Requires Pulse Guard to be enabled, and the Pro plan. Moderators only.",
    data: new SlashCommandBuilder()
      .setName("guard")
      .setDescription("Check and manage Pulse Guard AI moderation")
      .addSubcommand((sc) =>
        sc.setName("status").setDescription("Show Pulse Guard's configuration and recent activity"),
      )
      .addSubcommand((sc) =>
        sc.setName("review").setDescription("List recent detections that may need review"),
      )
      .addSubcommandGroup((g) =>
        g
          .setName("whitelist")
          .setDescription("Exempt members or roles from analysis")
          .addSubcommand((sc) =>
            sc
              .setName("add")
              .setDescription("Whitelist a member or role (skips analysis)")
              .addUserOption((o) => o.setName("user").setDescription("The member to whitelist").setRequired(false))
              .addRoleOption((o) => o.setName("role").setDescription("The role to whitelist").setRequired(false)),
          )
          .addSubcommand((sc) =>
            sc
              .setName("remove")
              .setDescription("Remove a member or role from the whitelist")
              .addUserOption((o) => o.setName("user").setDescription("The member to remove").setRequired(false))
              .addRoleOption((o) => o.setName("role").setDescription("The role to remove").setRequired(false)),
          ),
      ),
    async execute({ interaction, guild, guard, ephemeral }) {
      if (!guard) {
        await replyNotice(interaction, "Pulse Guard isn't available right now.");
        return;
      }
      const group = interaction.options.getSubcommandGroup(false);
      const sub = interaction.options.getSubcommand();
      if (group === "whitelist") {
        await guard.handleWhitelist({ interaction, guild, action: sub, ephemeral });
        return;
      }
      if (sub === "status") {
        await guard.handleStatus({ interaction, guild, ephemeral });
        return;
      }
      if (sub === "review") {
        await guard.handleReview({ interaction, guild, ephemeral });
        return;
      }
      await replyNotice(interaction, "Pulse Guard isn't available right now.");
    },
  },

  // ── Events · Announcements · Automations (PULSIFY-61) ──────────────────────
  {
    // Discord-native scheduled events — no Pulsify table, so module null.
    // Moderator tier: create/cancel are management actions. `create` makes an
    // EXTERNAL event (name + place + start); voice/stage events stay in Discord.
    name: "event",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: [
      "/event list",
      "/event create name:Game Night location:Voice Lounge start:1d duration:2h",
      "/event info",
      "/event cancel",
    ],
    detail:
      "Manage the server's Discord events. `list` shows what's coming up; `info` gives one event's full details; `create` schedules a new external event (a name, a place, and when it starts — e.g. in 2h or 1d, plus how long it runs); `cancel` calls one off. Editing and voice/stage events stay in Discord's own event UI. Moderators only.",
    data: new SlashCommandBuilder()
      .setName("event")
      .setDescription("List, create and manage server events")
      .addSubcommand((sc) => sc.setName("list").setDescription("List upcoming events"))
      .addSubcommand((sc) =>
        sc
          .setName("info")
          .setDescription("Show an event's details")
          .addStringOption((o) => o.setName("event").setDescription("Which event").setRequired(true).setAutocomplete(true)),
      )
      .addSubcommand((sc) =>
        sc
          .setName("create")
          .setDescription("Schedule a new external event")
          .addStringOption((o) => o.setName("name").setDescription("Event name").setRequired(true).setMaxLength(100))
          .addStringOption((o) => o.setName("location").setDescription("Where it happens (a place or link)").setRequired(true).setMaxLength(100))
          .addStringOption((o) => o.setName("start").setDescription("When it starts, from now — e.g. 2h, 1d, 30m").setRequired(true))
          .addStringOption((o) => o.setName("duration").setDescription("How long it runs — e.g. 1h, 2h (default 2h)").setRequired(false))
          .addStringOption((o) => o.setName("description").setDescription("Optional details shown on the event").setRequired(false).setMaxLength(1000)),
      )
      .addSubcommand((sc) =>
        sc
          .setName("cancel")
          .setDescription("Cancel an event")
          .addStringOption((o) => o.setName("event").setDescription("Which event to cancel").setRequired(true).setAutocomplete(true)),
      ),
    async execute({ interaction, guild, events, ephemeral }) {
      const sub = interaction.options.getSubcommand();
      const handler = {
        list: events?.handleList,
        info: events?.handleInfo,
        create: events?.handleCreate,
        cancel: events?.handleCancel,
      }[sub];
      if (!handler) {
        await replyNotice(interaction, "Events aren't available right now.");
        return;
      }
      await handler({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, events }) {
      const sub = interaction.options.getSubcommand();
      if ((sub === "info" || sub === "cancel") && events?.autocompleteEvent) {
        await events.autocompleteEvent({ interaction, guild });
        return;
      }
      await interaction.respond([]);
    },
  },
  {
    name: "announce",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: [
      "/announce message:Server maintenance tonight at 8pm",
      "/announce channel:#news title:Update message:We shipped v2!",
    ],
    detail:
      "Post a Pulse-branded announcement to a channel — a clean titled embed, the same style as the changelog. It's recorded on the dashboard's Announcements page too, so you have a history. Defaults to the current channel. Moderators only.",
    data: new SlashCommandBuilder()
      .setName("announce")
      .setDescription("Post a branded announcement to a channel")
      .addStringOption((o) => o.setName("message").setDescription("What the announcement says").setRequired(true).setMaxLength(4000))
      .addStringOption((o) => o.setName("title").setDescription("Headline (default: Announcement)").setRequired(false).setMaxLength(200))
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Where to post it (defaults to this channel)")
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
    async execute({ interaction, guild, announcements, ephemeral }) {
      if (!announcements?.handleAnnounce) {
        await replyNotice(interaction, "Announcements aren't available right now.");
        return;
      }
      await announcements.handleAnnounce({ interaction, guild, ephemeral });
    },
  },
  {
    // Its own command (a read), everyone-tier — anyone can catch up on what was
    // announced. /announce (posting) stays moderator-only above.
    name: "announcements",
    category: "information",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/announcements recent"],
    detail:
      "Catch up on the server's recent announcements — each with when it was posted, the channel, who sent it, and a jump link. Shows the last 10.",
    data: new SlashCommandBuilder()
      .setName("announcements")
      .setDescription("See the server's recent announcements")
      .addSubcommand((sc) => sc.setName("recent").setDescription("List the most recent announcements")),
    async execute({ interaction, guild, announcements, ephemeral }) {
      if (!announcements?.handleRecent) {
        await replyNotice(interaction, "Announcements aren't available right now.");
        return;
      }
      await announcements.handleRecent({ interaction, guild, ephemeral });
    },
  },
  {
    // Manages the scheduled_automations workflows — served by the scheduler
    // engine (it owns them). `module: null`: the scheduled system has no master
    // switch (each workflow has its own enabled flag). NOT gated on the
    // `automations` feature, which is the separate welcome/goodbye pair.
    name: "automation",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: [
      "/automation list",
      "/automation toggle automation:Weekly digest",
      "/automation run automation:Weekly digest",
      "/automation logs",
    ],
    detail:
      "Manage the server's scheduled automations (the recurring workflows set up in the dashboard). `list` shows each one with its state and next run; `toggle` turns one on or off; `run` fires one immediately; `logs` shows recent runs and how they went. Moderators only.",
    data: new SlashCommandBuilder()
      .setName("automation")
      .setDescription("List, toggle and run scheduled automations")
      .addSubcommand((sc) => sc.setName("list").setDescription("List the server's scheduled automations"))
      .addSubcommand((sc) =>
        sc
          .setName("toggle")
          .setDescription("Turn an automation on or off")
          .addStringOption((o) => o.setName("automation").setDescription("Which automation").setRequired(true).setAutocomplete(true)),
      )
      .addSubcommand((sc) =>
        sc
          .setName("run")
          .setDescription("Run an automation now")
          .addStringOption((o) => o.setName("automation").setDescription("Which automation to run").setRequired(true).setAutocomplete(true)),
      )
      .addSubcommand((sc) =>
        sc
          .setName("logs")
          .setDescription("Show recent automation runs")
          .addStringOption((o) => o.setName("automation").setDescription("Only this automation (optional)").setRequired(false).setAutocomplete(true)),
      ),
    async execute({ interaction, guild, scheduler, ephemeral }) {
      if (!scheduler?.handleAutomationCommand) {
        await replyNotice(interaction, "Automations aren't available right now.");
        return;
      }
      await scheduler.handleAutomationCommand({
        interaction,
        guild,
        action: interaction.options.getSubcommand(),
        ephemeral,
      });
    },
    async autocomplete({ interaction, guild, scheduler }) {
      if (scheduler?.autocompleteAutomation) {
        await scheduler.autocompleteAutomation({ interaction, guild });
        return;
      }
      await interaction.respond([]);
    },
  },
  {
    // Server activity analytics — the dashboard's Statistics view, brought to
    // Discord. Reads the same analytics RPCs. Moderator tier: aggregate server
    // activity (including moderation counts) is a staff tool, not member-facing.
    // `channels` is the top-channels RANKING — the single-channel deep-dive is
    // the separate `/channel stats` (src/channels.js), not duplicated here.
    name: "stats",
    category: "insights",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/stats overview", "/stats overview period:30d", "/stats channels", "/stats members"],
    detail:
      "Server activity at a glance. `overview` summarises members, messages, voice, commands and moderation over a time range, each with its trend; `channels` ranks the busiest channels; `members` ranks the most active members. Pick a period (24h, 7d, 30d or all time — defaults to 7 days). Moderators only.",
    data: new SlashCommandBuilder()
      .setName("stats")
      .setDescription("Server activity statistics")
      .addSubcommand((sc) => addPeriodOption(sc.setName("overview").setDescription("Server activity summary with trends")))
      .addSubcommand((sc) => addPeriodOption(sc.setName("channels").setDescription("The busiest channels")))
      .addSubcommand((sc) => addPeriodOption(sc.setName("members").setDescription("The most active members"))),
    async execute({ interaction, guild, serverAnalytics, ephemeral }) {
      if (!serverAnalytics?.handleStats) {
        await replyNotice(interaction, "Statistics aren't available right now.");
        return;
      }
      await serverAnalytics.handleStats({ interaction, guild, ephemeral });
    },
  },
  {
    // Server Insights — the health score + prioritised recommendations, run
    // through the SAME rule engine as the dashboard (src/insights-engine.js
    // mirrors lib/insights.ts, pinned by tests) so the score always agrees.
    // Admin tier + no plan gate, matching the web route (admin only, no
    // advancedAnalytics gate). See resources/PULSIFY-61.md §5.
    name: "insights",
    category: "insights",
    module: null,
    defaultPermission: PERMISSION.ADMIN,
    examples: ["/insights", "/insights period:30d"],
    detail:
      "A health score for your server plus the most important things to look at — dangerous roles, moderation spikes, engagement dips, inactive channels, missing welcome/onboarding and more. The same analysis as the dashboard's Server Insights, prioritised into a short list. Pick a period (defaults to 7 days). Admins only.",
    data: addPeriodOption(
      new SlashCommandBuilder().setName("insights").setDescription("Server health score and recommendations"),
    ),
    async execute({ interaction, guild, serverAnalytics, ephemeral }) {
      if (!serverAnalytics?.handleInsights) {
        await replyNotice(interaction, "Insights aren't available right now.");
        return;
      }
      await serverAnalytics.handleInsights({ interaction, guild, ephemeral });
    },
  },
  {
    // Management Analytics — staff performance, brought to Discord. Same engine
    // as the dashboard (src/management-engine.js mirrors lib/management.ts).
    // Admin tier + no plan gate, matching the web route.
    name: "management",
    category: "insights",
    module: null,
    defaultPermission: PERMISSION.ADMIN,
    examples: ["/management stats", "/management stats period:30d", "/management stats staff:@moderator"],
    detail:
      "How your staff team is doing — moderation, support and community activity, response times, standouts and things to watch, all attributed per staff member. `stats` shows the whole team; pass a `staff` member to see just their breakdown. Pick a period (defaults to 7 days). Admins only.",
    data: new SlashCommandBuilder()
      .setName("management")
      .setDescription("Staff performance analytics")
      .addSubcommand((sc) =>
        addPeriodOption(
          sc
            .setName("stats")
            .setDescription("Staff performance overview (or one member's)")
            .addUserOption((o) =>
              o.setName("staff").setDescription("Show just this staff member's breakdown").setRequired(false),
            ),
        ),
      ),
    async execute({ interaction, guild, serverAnalytics, ephemeral }) {
      if (!serverAnalytics?.handleManagement) {
        await replyNotice(interaction, "Management analytics aren't available right now.");
        return;
      }
      await serverAnalytics.handleManagement({ interaction, guild, ephemeral });
    },
  },
  {
    // /verify — get the configured verified role. Everyone-tier so members can
    // self-verify (the same action as the onboarding panel's Verify button); the
    // handler elevates to a moderator check when a `user` is passed to verify
    // someone ELSE (a subcommand/tier can't express "self OR mod", so it's done
    // in-handler). `module: null` on purpose — the handler gives a precise
    // "not set up" message and self-verification is a core member action, not a
    // feature to be gated off wholesale.
    name: "verify",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/verify", "/verify user:@member"],
    detail:
      "Get the server's verified role. Run it on its own to verify yourself — the same as clicking Verify on the welcome panel. Moderators can pass a member to verify them manually. Verification is configured under Engagement › Onboarding & Welcome.",
    data: new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Get the verified role in this server")
      .addUserOption((o) =>
        o.setName("user").setDescription("Verify this member (moderators only)").setRequired(false),
      ),
    async execute({ interaction, guild, onboarding, ephemeral }) {
      if (!onboarding?.handleVerifyCommand) {
        await replyNotice(interaction, "Verification isn't available right now.");
        return;
      }
      await onboarding.handleVerifyCommand({ interaction, guild, ephemeral });
    },
  },
  {
    // /verification status — a read (its own name so it can't be confused with
    // the /verify action, and to leave room for future verification subcommands).
    name: "verification",
    category: "information",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/verification status"],
    detail:
      "Check whether verification is set up in this server and whether you're verified.",
    data: new SlashCommandBuilder()
      .setName("verification")
      .setDescription("Check your verification status")
      .addSubcommand((sc) => sc.setName("status").setDescription("Show your verification status")),
    async execute({ interaction, guild, onboarding, ephemeral }) {
      if (!onboarding?.handleVerificationStatus) {
        await replyNotice(interaction, "Verification isn't available right now.");
        return;
      }
      await onboarding.handleVerificationStatus({ interaction, guild, ephemeral });
    },
  },
  {
    // /onboarding resend|stats — moderator group, module `onboarding`. One tier
    // for the whole group (a subcommand can't carry its own): resend is a staff
    // helper ("I lost the welcome, can you resend it"), stats is a staff
    // analytics read. Gated on the onboarding module — off means the group is off.
    name: "onboarding",
    category: "utility",
    module: "onboarding",
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/onboarding resend", "/onboarding resend user:@member", "/onboarding stats"],
    detail:
      "Manage member onboarding. `resend` re-posts the welcome/onboarding panel (to you, or to a member who missed it); `stats` shows the completion funnel — how many members started, completed, verified and earned rewards. Requires Onboarding & Welcome to be enabled. Moderators only.",
    data: new SlashCommandBuilder()
      .setName("onboarding")
      .setDescription("Resend the onboarding panel and view completion stats")
      .addSubcommand((sc) =>
        sc
          .setName("resend")
          .setDescription("Re-post the onboarding panel")
          .addUserOption((o) =>
            o.setName("user").setDescription("Send it to this member (defaults to you)").setRequired(false),
          ),
      )
      .addSubcommand((sc) => sc.setName("stats").setDescription("Onboarding completion stats")),
    async execute({ interaction, guild, onboarding, ephemeral }) {
      const sub = interaction.options.getSubcommand();
      if (sub === "resend") {
        if (!onboarding?.handleResend) {
          await replyNotice(interaction, "Onboarding isn't available right now.");
          return;
        }
        await onboarding.handleResend({ interaction, guild, ephemeral });
        return;
      }
      if (sub === "stats") {
        if (!onboarding?.handleOnboardingStats) {
          await replyNotice(interaction, "Onboarding isn't available right now.");
          return;
        }
        await onboarding.handleOnboardingStats({ interaction, guild, ephemeral });
        return;
      }
      await replyNotice(interaction, "Unknown onboarding view.");
    },
  },
  {
    // /serversettings view — a read-only overview of the server's Pulse config
    // (plan, embed colour, which features are on/off). Admin-tier, module null.
    name: "serversettings",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.ADMIN,
    examples: ["/serversettings view"],
    detail:
      "A snapshot of this server's Pulse configuration — the plan, the embed colour, and which features are switched on or off. Read-only; change anything from the dashboard. Admins only.",
    data: new SlashCommandBuilder()
      .setName("serversettings")
      .setDescription("View this server's Pulse configuration")
      .addSubcommand((sc) => sc.setName("view").setDescription("Show the server's Pulse settings overview")),
    async execute({ interaction, guild, settings, ephemeral }) {
      if (!settings?.handleServerSettings) {
        await replyNotice(interaction, "Settings aren't available right now.");
        return;
      }
      await settings.handleServerSettings({ interaction, guild, ephemeral });
    },
  },
  {
    // /statchannel refresh — force an immediate re-render of the server's
    // statistics channels (the live-counter channels). Moderator-tier
    // operational nudge (like /automation run), module null.
    name: "statchannel",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/statchannel refresh"],
    detail:
      "Force the server's statistics channels (the live member/online/etc. counter channels) to update now, instead of waiting for the next automatic sweep. Set them up from the dashboard under Server › Channels. Moderators only.",
    data: new SlashCommandBuilder()
      .setName("statchannel")
      .setDescription("Refresh the server's statistics channels")
      .addSubcommand((sc) => sc.setName("refresh").setDescription("Update the statistics channels now")),
    async execute({ interaction, guild, settings, ephemeral }) {
      if (!settings?.handleStatChannel) {
        await replyNotice(interaction, "Statistics channels aren't available right now.");
        return;
      }
      await settings.handleStatChannel({ interaction, guild, ephemeral });
    },
  },
  {
    // /emoji list|info — browse the server's custom emojis. Everyone-tier read
    // (server content anyone can see), module null. Read off the gateway cache.
    name: "emoji",
    category: "information",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/emoji list", "/emoji info emoji:blobwave"],
    detail:
      "Browse the server's custom emojis. `list` shows how many there are (static and animated) and their names; `info` gives one emoji's details — its ID, the text you type to use it, and a link to the full image.",
    data: new SlashCommandBuilder()
      .setName("emoji")
      .setDescription("Browse the server's custom emojis")
      .addSubcommand((sc) => sc.setName("list").setDescription("List the server's custom emojis"))
      .addSubcommand((sc) =>
        sc
          .setName("info")
          .setDescription("Show details for one emoji")
          .addStringOption((o) => o.setName("emoji").setDescription("Which emoji").setRequired(true).setAutocomplete(true)),
      ),
    async execute({ interaction, guild, settings, ephemeral }) {
      if (!settings?.handleEmoji) {
        await replyNotice(interaction, "Emojis aren't available right now.");
        return;
      }
      await settings.handleEmoji({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, settings }) {
      if (interaction.options.getSubcommand() === "info" && settings?.autocompleteEmoji) {
        await settings.autocompleteEmoji({ interaction, guild });
        return;
      }
      await interaction.respond([]);
    },
  },
  {
    name: "sticker",
    category: "information",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/sticker list", "/sticker info sticker:welcome"],
    detail:
      "Browse the server's custom stickers. `list` shows them all; `info` gives one sticker's details — its format, related emoji and a link to view it.",
    data: new SlashCommandBuilder()
      .setName("sticker")
      .setDescription("Browse the server's custom stickers")
      .addSubcommand((sc) => sc.setName("list").setDescription("List the server's custom stickers"))
      .addSubcommand((sc) =>
        sc
          .setName("info")
          .setDescription("Show details for one sticker")
          .addStringOption((o) => o.setName("sticker").setDescription("Which sticker").setRequired(true).setAutocomplete(true)),
      ),
    async execute({ interaction, guild, settings, ephemeral }) {
      if (!settings?.handleSticker) {
        await replyNotice(interaction, "Stickers aren't available right now.");
        return;
      }
      await settings.handleSticker({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, settings }) {
      if (interaction.options.getSubcommand() === "info" && settings?.autocompleteSticker) {
        await settings.autocompleteSticker({ interaction, guild });
        return;
      }
      await interaction.respond([]);
    },
  },
  {
    // /soundboard list|info — NOT list|play: playing a sound needs a live voice
    // connection (@discordjs/voice, not a dependency). See the header note in
    // src/settings-commands.js.
    name: "soundboard",
    category: "information",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/soundboard list", "/soundboard info sound:airhorn"],
    detail:
      "Browse the server's custom soundboard sounds. `list` shows them all; `info` gives one sound's details — its volume, emoji and ID. Play sounds from Discord's own soundboard picker in a voice channel.",
    data: new SlashCommandBuilder()
      .setName("soundboard")
      .setDescription("Browse the server's soundboard sounds")
      .addSubcommand((sc) => sc.setName("list").setDescription("List the server's soundboard sounds"))
      .addSubcommand((sc) =>
        sc
          .setName("info")
          .setDescription("Show details for one sound")
          .addStringOption((o) => o.setName("sound").setDescription("Which sound").setRequired(true).setAutocomplete(true)),
      ),
    async execute({ interaction, guild, settings, ephemeral }) {
      if (!settings?.handleSoundboard) {
        await replyNotice(interaction, "The soundboard isn't available right now.");
        return;
      }
      await settings.handleSoundboard({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, settings }) {
      if (interaction.options.getSubcommand() === "info" && settings?.autocompleteSoundboard) {
        await settings.autocompleteSoundboard({ interaction, guild });
        return;
      }
      await interaction.respond([]);
    },
  },
  {
    // /backup create|list — manual server backups. Admin-tier, module null,
    // `minPlan: "business"` (the backupRestore feature is Business+). Scheduled
    // backups still run from the dashboard; this is the on-demand path.
    name: "backup",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.ADMIN,
    minPlan: "business",
    examples: ["/backup create", "/backup create name:Before the big event", "/backup list"],
    detail:
      "Create and view server backups — versioned snapshots of your Pulse config plus the live role/channel structure. `create` takes one now; `list` shows the most recent. Restore or download them from the dashboard. Business plan; admins only.",
    data: new SlashCommandBuilder()
      .setName("backup")
      .setDescription("Create and list server backups")
      .addSubcommand((sc) =>
        sc
          .setName("create")
          .setDescription("Take a backup of the server now")
          .addStringOption((o) => o.setName("name").setDescription("A name for this backup (optional)").setRequired(false).setMaxLength(80)),
      )
      .addSubcommand((sc) => sc.setName("list").setDescription("List the most recent backups")),
    async execute({ interaction, guild, backups, ephemeral }) {
      const sub = interaction.options.getSubcommand();
      if (sub === "create") {
        if (!backups?.handleBackupCreate) {
          await replyNotice(interaction, "Backups aren't available right now.");
          return;
        }
        await backups.handleBackupCreate({ interaction, guild, ephemeral });
        return;
      }
      if (sub === "list") {
        if (!backups?.handleBackupList) {
          await replyNotice(interaction, "Backups aren't available right now.");
          return;
        }
        await backups.handleBackupList({ interaction, guild, ephemeral });
        return;
      }
      await replyNotice(interaction, "Unknown backup view.");
    },
  },
  {
    // /template apply — flip a feature profile's switches. Admin-tier (changes
    // server-wide features), module null. Per-feature plan gate is internal
    // (mirrors the dashboard) so the command itself carries no minPlan.
    name: "template",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.ADMIN,
    examples: ["/template apply template:Essentials", "/template apply template:Full Community"],
    detail:
      "Apply a server template — a feature profile that turns Pulse features on or off in one go. Choose a built-in preset or one your server saved. It flips each feature's switch; it doesn't create roles or channels. Admins only.",
    data: new SlashCommandBuilder()
      .setName("template")
      .setDescription("Apply a server feature template")
      .addSubcommand((sc) =>
        sc
          .setName("apply")
          .setDescription("Apply a template's feature profile")
          .addStringOption((o) => o.setName("template").setDescription("Which template").setRequired(true).setAutocomplete(true)),
      ),
    async execute({ interaction, guild, templates, ephemeral }) {
      if (!templates?.handleApply) {
        await replyNotice(interaction, "Templates aren't available right now.");
        return;
      }
      await templates.handleApply({ interaction, guild, ephemeral });
    },
    async autocomplete({ interaction, guild, templates }) {
      if (templates?.autocompleteTemplate) {
        await templates.autocompleteTemplate({ interaction, guild });
        return;
      }
      await interaction.respond([]);
    },
  },
  {
    // /integrations status — read the guild's connected integrations. Admin-tier
    // (integrations are admin config), module null.
    name: "integrations",
    category: "information",
    module: null,
    defaultPermission: PERMISSION.ADMIN,
    examples: ["/integrations status"],
    detail:
      "See the server's connected integrations (GitHub, YouTube, RSS and more) — each with its state, last sync and any error. Connect and configure them from the dashboard. Admins only.",
    data: new SlashCommandBuilder()
      .setName("integrations")
      .setDescription("View the server's connected integrations")
      .addSubcommand((sc) => sc.setName("status").setDescription("Show integration connection status")),
    async execute({ interaction, guild, community, ephemeral }) {
      if (!community?.handleIntegrations) {
        await replyNotice(interaction, "Integrations aren't available right now.");
        return;
      }
      await community.handleIntegrations({ interaction, guild, ephemeral });
    },
  },
  {
    // /notifications preferences — read the guild's activity-feed notification
    // prefs. Moderator-tier (mirrors the web route's authorizeGuildModerator).
    name: "notifications",
    category: "information",
    module: null,
    defaultPermission: PERMISSION.MODERATOR,
    examples: ["/notifications preferences"],
    detail:
      "See this server's notification preferences — how many activity-feed notification types are on, and whether in-app toasts are enabled. Change them from the dashboard. Moderators only.",
    data: new SlashCommandBuilder()
      .setName("notifications")
      .setDescription("View the server's notification preferences")
      .addSubcommand((sc) => sc.setName("preferences").setDescription("Show notification preferences")),
    async execute({ interaction, guild, community, ephemeral }) {
      if (!community?.handleNotifications) {
        await replyNotice(interaction, "Notification preferences aren't available right now.");
        return;
      }
      await community.handleNotifications({ interaction, guild, ephemeral });
    },
  },
  {
    // /feedback submit — leave a Pulsify testimonial. Everyone-tier, module null.
    // GLOBAL (one review per user across all servers; the landing-page wall).
    name: "feedback",
    category: "utility",
    module: null,
    defaultPermission: PERMISSION.EVERYONE,
    examples: ["/feedback submit rating:5 title:Love it message:Pulse transformed our server"],
    detail:
      "Share your experience with Pulsify — a star rating and a short review. It joins the testimonials on the Pulsify site. One review per person; run it again to update yours.",
    data: new SlashCommandBuilder()
      .setName("feedback")
      .setDescription("Leave feedback about Pulsify")
      .addSubcommand((sc) =>
        sc
          .setName("submit")
          .setDescription("Submit or update your Pulsify review")
          .addIntegerOption((o) =>
            o
              .setName("rating")
              .setDescription("How many stars (1-5)")
              .setRequired(true)
              .addChoices(
                { name: "★☆☆☆☆ (1)", value: 1 },
                { name: "★★☆☆☆ (2)", value: 2 },
                { name: "★★★☆☆ (3)", value: 3 },
                { name: "★★★★☆ (4)", value: 4 },
                { name: "★★★★★ (5)", value: 5 },
              ),
          )
          .addStringOption((o) => o.setName("title").setDescription("A short headline (3-80 chars)").setRequired(true).setMaxLength(80))
          .addStringOption((o) => o.setName("message").setDescription("Your review (10-600 chars)").setRequired(true).setMaxLength(600)),
      ),
    async execute({ interaction, community, ephemeral }) {
      if (!community?.handleFeedback) {
        await replyNotice(interaction, "Feedback isn't available right now.");
        return;
      }
      await community.handleFeedback({ interaction, ephemeral });
    },
  },
];

const COMMANDS_BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

/**
 * Discord's default-member-permissions bitfield for a baseline access level —
 * a hint that greys the command out in the picker for people who can't run it.
 * The real enforcement is command-center.evaluate(); this is presentation.
 *
 * SUPPORT deliberately maps to null (visible to everyone). The tier is defined
 * by holding one of the guild's configured support ROLES, and Discord's
 * default_member_permissions can only express permission bits — there is no
 * bitfield that means "has a specific role". Greying it out for non-moderators
 * would hide it from exactly the support staff it exists for, so it stays
 * visible and the execution-time check does the work.
 */
function defaultMemberPermissionsFor(level) {
  switch (level) {
    case "admin":
      return PermissionFlagsBits.ManageGuild;
    case "moderator":
      return PermissionFlagsBits.ManageMessages;
    default:
      return null; // everyone, support
  }
}

module.exports = {
  PERMISSION,
  COMMANDS,
  COMMANDS_BY_NAME,
  defaultMemberPermissionsFor,
  // /help page renderer — reused by index.js to drive prev/next pagination.
  renderHelp,
  // Shared embed helpers — reused by other modules (e.g. leveling.js for the
  // /rank + /leaderboard replies) so every Pulse embed shares one look.
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  // Master switch for the Pulse badge thumbnails — read by the modules that
  // load their own badge (giveaways, polls, tickets, integrations) instead of
  // going through loadPulseIcon.
  PULSE_BADGES_ENABLED,
  replyContainer,
  // The accent-tinted reputation/level bar image + its unicode fallback — shared
  // by /profile, /rank and /reputation so the bar looks identical everywhere.
  loadProfileBars,
  unicodeBar,
  // Bare notice embeds for short status/validation/error messages.
  buildNoticeContainer,
  replyNotice,
  editNotice,
  text,
  divider,
};

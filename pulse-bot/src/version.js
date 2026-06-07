// Pulse version + release-notes source (bot side).
//
// One module owns "what version is Pulse, and what shipped in it" for the bot.
// The /version, /changelog and /release-notes commands and the startup banner
// all read from here so the answer is consistent everywhere.
//
// Releases are authored as flat `resources/notes/vX.Y.Z.txt` files at the repo
// root — the SAME files the public Release Notes page parses
// (pulsify-web-app/lib/release-notes.ts). We mirror a trimmed-down version of
// that parser so the bot reflects the live release data without us maintaining
// a parallel list. If those files can't be found at runtime (e.g. the bot is
// deployed on its own, without the monorepo's resources/ folder) we fall back
// to the STATIC_RELEASES baked in below so the commands never break.

const { readdir, readFile, stat } = require("node:fs/promises");
const path = require("node:path");

// Current Pulse version. Used for the startup banner and as the displayed
// version when no release files are reachable. Keep this in step with the
// newest resources/notes/vX.Y.Z.txt on each release.
const PULSE_VERSION = "0.40.0";

// Manual/static fallback used only when the release-notes files can't be read.
// Mirrors the shape produced by the parser so callers don't special-case it.
const STATIC_RELEASES = [
  {
    version: "0.37.0",
    title: "Onboarding & Welcome",
    date: "Jun 8, 2026",
    description:
      "A guided, interactive welcome that greets new members, hands out roles, verifies access and rewards completion.",
    highlights: [
      "**Server › Onboarding** — a redesigned editor for the whole new-member experience, with a live preview.",
      "**Interactive welcome panel** — on join Pulse posts a Pulse v2 welcome plus self-role menus, a verify button, events and community links.",
      "**Self-roles, verification & rewards** — roles by category, a built-in verify gate, and XP / starter roles / reputation on completion.",
      "**Onboarding analytics** — starts, completions, completion rate, verifications, most-picked roles and most-skipped steps.",
    ],
    outro: null,
  },
  {
    version: "0.36.0",
    title: "Server Templates",
    date: "Jun 6, 2026",
    description:
      "Save a server's configuration once and deploy it anywhere as a reusable blueprint.",
    highlights: [
      "**Server › Templates** — save, browse, apply, import and export server configurations.",
      "**Capture & apply** — snapshot automations, moderation, Pulse content, onboarding, Pulse Guard, tickets and role structure.",
      "**Smart conflict handling** — missing channel/role references are cleared and existing roles skipped on apply.",
      "**Presets, import & export** — six ready-made setups plus JSON import/export with validation.",
    ],
    outro: null,
  },
  {
    version: "0.35.0",
    title: "Member Milestones",
    date: "Jun 3, 2026",
    description:
      "Automatically recognise and reward members for their time in the server, activity and participation.",
    highlights: [
      "**Engagement › Milestones** — create, manage and track recognition milestones, with stats, search and filters.",
      "**Recognise what matters** — milestones for time in server, messages, voice, events, giveaways, or XP/level.",
      "**Automatic rewards** — Pulse grants reward roles and posts a celebration embed the moment a member qualifies.",
      "**/milestones** — members see what they've earned and how close they are to the next ones; preview & test from the dashboard.",
    ],
    outro: null,
  },
  {
    version: "0.34.0",
    title: "Integrations Hub",
    date: "Jun 2, 2026",
    description:
      "Connect external services and let Pulse pipe their activity straight into Discord.",
    highlights: [
      "**Pulse Bot › Integrations** — a hub to browse, connect and manage external services, with health, search and filters.",
      "**Notification sources** — GitHub, YouTube, Twitch, Reddit, X/Twitter and RSS post updates into a channel you choose.",
      "**Productivity tools** — Google Calendar, Trello, Jira and Notion with configurable event synchronization.",
      "**Setup wizards & test** — a guided flow with a live preview, customisable templates, and a one-click connection test.",
    ],
    outro: null,
  },
  {
    version: "0.33.0",
    title: "Announcements",
    date: "Jun 1, 2026",
    description:
      "Write, preview and publish polished announcements to your server — right from the Pulsify dashboard.",
    highlights: [
      "**Engagement › Announcements** — a new view to draft, manage and review everything you've published, with search and filters.",
      "**Compose with a live preview** — publish on-brand Pulse embeds that match the /changelog styling.",
      "**Drafts & scheduling** — save a draft, set a planned publish time, or duplicate a past announcement.",
      "**Reliable publishing** — Pulse checks it can post to the channel first, with clear failures and one-click retry.",
    ],
    outro: null,
  },
];

// Candidate locations for the shared notes folder, in priority order. __dirname
// is pulse-bot/src, so two levels up is the repo root where resources/ lives;
// the extra candidates cover bot-only deploys that ship resources/ alongside.
const NOTES_DIRS = [
  path.join(__dirname, "..", "..", "resources", "notes"),
  path.join(__dirname, "..", "resources", "notes"),
  path.join(process.cwd(), "resources", "notes"),
];

const HEADER_RE = /^\*\*Pulsify\s+v([\d.]+)\s*[—-]\s*(.+?)\*\*$/;
const SECTION_RE = /^\*\*(.+?)\*\*$/;
const BULLET_RE = /^[-*•]\s+(.*)$/;
const BULLET_LEAD_RE = /^\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/;
// Optional trailing `Month DD, YYYY` line that records the actual release date.
const DATE_RE =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/;

// In-memory cache so repeated commands don't re-read the disk each time.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { releases: null, fetchedAt: 0 };

function compareVersion(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function formatDate(d) {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Parse one notes file into a bot-friendly release object. Returns null when
 * the header line is missing so malformed files are skipped, not fatal.
 * `highlights` is a flat list of the bullet points across every section (lead
 * dropped, inline **bold** kept) — enough for a compact changelog embed.
 */
function parseRelease(content, mtime) {
  const rawLines = content.replace(/\r\n/g, "\n").split("\n");

  // Pull an explicit `Month DD, YYYY` line off the end if present. It records
  // the real release date (mtime is unreliable — a clone/deploy resets it),
  // and stripping it keeps it out of the outro during the body walk below.
  let explicitDate = null;
  let end = rawLines.length;
  while (end > 0 && rawLines[end - 1].trim() === "") end--;
  if (end > 0 && DATE_RE.test(rawLines[end - 1].trim())) {
    const parsed = new Date(rawLines[end - 1].trim());
    if (!Number.isNaN(parsed.getTime())) explicitDate = parsed;
    end--;
  }
  const lines = rawLines.slice(0, end);

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const headerMatch = lines[i]?.trim().match(HEADER_RE);
  if (!headerMatch) return null;
  i++;

  // Lead paragraph: next non-blank line that isn't a section/bullet.
  let description = "";
  while (i < lines.length && lines[i].trim() === "") i++;
  if (
    i < lines.length &&
    !SECTION_RE.test(lines[i].trim()) &&
    !BULLET_RE.test(lines[i].trim())
  ) {
    description = lines[i].trim();
    i++;
  }

  const highlights = [];
  let inSection = false;
  let outroLines = [];

  while (i < lines.length) {
    const line = lines[i].trim();
    i++;
    if (!line) continue;

    if (SECTION_RE.test(line)) {
      inSection = true;
      outroLines = []; // a new section means the prior text wasn't the outro
      continue;
    }

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch && inSection) {
      const text = bulletMatch[1].trim();
      const leadMatch = text.match(BULLET_LEAD_RE);
      // Keep the lead **bold** so the embed renders it bold too (plain bullets
      // already keep any inline **markers** verbatim).
      highlights.push(
        leadMatch
          ? `**${leadMatch[1].trim()}** — ${leadMatch[2].trim()}`
          : text,
      );
      continue;
    }

    // Non-bullet line outside a bullet context → outro candidate (keep last).
    if (!bulletMatch) outroLines = [line];
  }

  return {
    version: headerMatch[1],
    title: headerMatch[2].trim(),
    date: formatDate(explicitDate ?? mtime),
    description,
    highlights,
    outro: outroLines.length > 0 ? outroLines.join(" ").trim() : null,
  };
}

async function findNotesDir() {
  for (const dir of NOTES_DIRS) {
    try {
      if ((await stat(dir)).isDirectory()) return dir;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Load every release on disk, newest version first. Falls back to
 * STATIC_RELEASES when the notes folder is missing or yields nothing, so
 * callers always get at least one release. Cached for CACHE_TTL_MS.
 */
async function loadReleases({ force = false } = {}) {
  if (!force && cache.releases && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.releases;
  }

  let releases = STATIC_RELEASES;
  try {
    const dir = await findNotesDir();
    if (dir) {
      const entries = await readdir(dir);
      const files = entries.filter((f) => /^v\d/.test(f) && f.endsWith(".txt"));
      const parsed = [];
      for (const f of files) {
        try {
          const full = path.join(dir, f);
          const [content, info] = await Promise.all([
            readFile(full, "utf8"),
            stat(full),
          ]);
          const result = parseRelease(content, info.mtime);
          if (result) parsed.push(result);
        } catch {
          // skip unreadable files
        }
      }
      if (parsed.length > 0) {
        releases = parsed.sort((a, b) => compareVersion(b.version, a.version));
      }
    }
  } catch (err) {
    console.warn(
      "[Pulse] Failed to load release notes, using static fallback:",
      err.message,
    );
  }

  cache = { releases, fetchedAt: Date.now() };
  return releases;
}

/** Newest release, or null if somehow none exist (never happens — fallback). */
async function getLatestRelease() {
  const releases = await loadReleases();
  return releases[0] ?? null;
}

async function getReleaseByVersion(version) {
  const releases = await loadReleases();
  return releases.find((r) => r.version === version) ?? null;
}

/**
 * The version Pulse reports. Prefers the newest release file's version so the
 * answer tracks the live notes, falling back to the PULSE_VERSION constant.
 */
async function getCurrentVersion() {
  const latest = await getLatestRelease();
  return latest?.version ?? PULSE_VERSION;
}

// ── Link helpers ─────────────────────────────────────────────────────────────
// APP_URL is the web app base (the public site in production). The release
// notes link must point at the public page so users land on the real changelog.

function appUrl() {
  return process.env.APP_URL ?? "http://localhost:3000";
}

function getReleaseNotesUrl() {
  return `${appUrl()}/release-notes`;
}

function getDashboardUrl(guildId) {
  return guildId ? `${appUrl()}/dashboard/${guildId}` : `${appUrl()}/dashboard`;
}

/** Bot invite URL — mirrors the web app's botInviteUrl (admin perms + slash). */
function getInviteUrl(guildId) {
  const clientId = process.env.DISCORD_CLIENT_ID ?? "";
  const base = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot+applications.commands`;
  return guildId ? `${base}&guild_id=${guildId}` : base;
}

module.exports = {
  PULSE_VERSION,
  STATIC_RELEASES,
  // parsing/loading
  loadReleases,
  getLatestRelease,
  getReleaseByVersion,
  getCurrentVersion,
  // links
  getReleaseNotesUrl,
  getDashboardUrl,
  getInviteUrl,
  // exported for tests
  parseRelease,
  compareVersion,
};

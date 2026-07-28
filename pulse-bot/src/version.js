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
const PULSE_VERSION = "0.64.0";

// Manual/static fallback used only when the release-notes files can't be read.
// Mirrors the shape produced by the parser so callers don't special-case it.
const STATIC_RELEASES = [
  {
    version: "0.64.0",
    title: "Gaming Analytics",
    date: "Jul 28, 2026",
    description:
      "A Gaming view in Analytics that turns Discord presence into real play sessions — with a start, an end and a duration — and builds the whole picture on top: what the server plays, who plays it, when it's busiest, and who keeps playing together.",
    highlights: [
      "**Six views in one** — overview, games, player profiles, live activity, trends and squads, all computed against the same window so every number on screen agrees.",
      "**Sessions, not samples** — Pulse records presence transitions, so a session has a real duration; restarts and reconnects are handled without inventing week-long sessions, and Spotify, custom statuses and videos are never counted as games.",
      "**Squads & trends** — the members who keep ending up in the same games at the same time, grouped automatically, plus rising and falling games, peak hours and a weekly activity heatmap.",
      "**Privacy enforced at write time** — ignored roles, members and games leave no record at all, statistics can be anonymised (exports included), and members can opt out themselves with /gaming opt-out and delete what was recorded.",
      "**/gaming** — server overview, your profile, leaderboards, top games and who is currently playing, plus CSV, JSON and PDF exports from the dashboard.",
    ],
    outro:
      "Find out what your community is actually into — without asking a single member to report it.",
  },
  {
    version: "0.63.0",
    title: "Server History",
    date: "Jul 27, 2026",
    description:
      "A History view in Analytics that keeps one chronological record of every significant change to your server — roles, channels, members, moderation, economy, automations, events and configuration — whether it was made in the dashboard, through a slash command or directly in Discord.",
    highlights: [
      "**Who, what and where from** — every event names the administrator, and uniquely also the origin: the dashboard, the Discord client, a slash command, or Pulse acting on its own.",
      "**Before and after** — expand any event for the previous and new value, field by field, plus affected members, related modules and the raw metadata.",
      "**Find it fast** — filter by category, administrator, member, module, event type or date range, search across everything, and click any name inside an event to narrow the whole history around them.",
      "**Export** — CSV for spreadsheets, JSON for tooling and a formatted PDF report, for your selection, the filtered view or the complete history.",
      "**A tidier sidebar** — the dashboard navigation was regrouped around what you're working on: Members, Content, Economy, Safety, Server, Pulse Bot and Analytics. Nothing moved out of reach.",
    ],
    outro:
      "Included on every plan; how far back it reaches follows your plan's history retention, and nothing is ever deleted.",
  },
  {
    version: "0.62.0",
    title: "Plans, Clarified",
    date: "Jul 23, 2026",
    description:
      "Every module, limit and premium feature is now mapped to a plan and shown side by side across Free, Plus, Pro and Enterprise. No prices changed, no plans were added, and Pulsify stays completely free during early access.",
    highlights: [
      "**Full comparison table** on the pricing page — every module, every usage limit, every premium feature, across all four plans.",
      "**Generous Free** — every core module is included on Free: moderation, levels, economy, reputation, birthdays, invites, polls, giveaways, events, tickets, onboarding, self-assign roles, statistics and private channels, and more.",
      "**Paid plans lift the limits** and unlock Pulse Guard, advanced & bulk moderation, custom branding, DDoS protection, advanced analytics, workspaces and backup & restore.",
      "**Consistent everywhere** — the dashboard, the API and the slash commands now agree on exactly what a server can do, gated on the server owner's plan.",
      "**Clearer limits** — the Billing page lists every usage limit for your plan at a glance.",
    ],
    outro:
      "Nothing is locked today. When early access ends, these are the plans you'll see — with plenty of notice first.",
  },
  {
    version: "0.61.0",
    title: "Slash Commands Everywhere",
    date: "Jul 23, 2026",
    description:
      "The biggest command update yet: dozens of new slash commands bring Pulse's moderation, analytics, engagement, onboarding and server tools into Discord itself, each respecting the same permissions, cooldowns and per-server settings as the dashboard.",
    highlights: [
      "**Full moderator toolkit** — /warn, /timeout, /untimeout, /kick, /ban, /unban, /warnings, /purge and /modlogs, logged to Moderation History exactly like a dashboard action, with role-position checks both ways.",
      "**Roles, tickets & community** — /role add, remove, temp, info and hierarchy, /selfrole, /ticket, /event, /announce, /automation, /giveaway, /poll, /privatechannel and /guard.",
      "**Analytics in chat** — /stats overview, channels and members; /insights for the server health score; /management stats for staff performance.",
      "**Members & server tools** — /rank, /reputation, /userinfo, /serverinfo, /milestones, /verify, /onboarding, /serversettings, /statchannel, /template, /emoji, /sticker, /soundboard, /backup, /integrations, /notifications and /feedback.",
      "**Renamed** — /alt-check is now /alt check, and /invites is now /invite stats (with /invite leaderboard and /invite rewards). Discord doesn't allow spaces in a command name.",
    ],
    outro: "Run /help in your server to see every command you can use.",
  },
  {
    version: "0.60.0",
    title: "Invite Tracking & Referrals",
    date: "Jul 15, 2026",
    description:
      "An Invites view in Engagement that attributes every join to the invite (and inviter) used, scores inviters on valid vs fake vs left, rewards referrals automatically, and blocks invite farming — with a hook into Safety › Alt Detection.",
    highlights: [
      "**Automatic attribution** — Pulse mirrors each server's invite links and diffs the use counts on every join to work out which invite (or the vanity URL) was used and who owns it.",
      "**Fair scoring** — configurable valid-invite rules (account age, minimum stay, onboarding, verification, no active flags, activity, exclude alts) plus anti-abuse for self-invites, alt farming, rapid rejoins, spikes and duplicate claims.",
      "**Leaderboard & analytics** — rank inviters by score for today, this week, this month or all time, with retention, fake counts, rewards earned and a per-inviter profile drawer.",
      "**Referral rewards** — created as Member Milestones with the new \"Valid invites\" trigger (e.g. 25 valid invites → VIP role); the milestone sweep grants the role automatically once invite tracking is on.",
      "**/invites, /invite-leaderboard, /invite-rewards** — plus admin tools to add/remove bonus credits, invalidate or approve a join, grant missed rewards and reset stats, all written to an audit log.",
    ],
    outro:
      "Reward the members who grow your community — and make sure the numbers are real.",
  },
  {
    version: "0.59.0",
    title: "Alt Risk Detection",
    date: "Jul 14, 2026",
    description:
      "An Alt Detection view in Safety that scores any account against the alt-account signals Pulse can see, surfaces potential linked accounts with a confidence percentage, and gives moderators one place to investigate ban evasion and throwaway accounts.",
    highlights: [
      "**Account lookup** — search any member by username, mention or Discord ID (including accounts that left or were banned) and get their profile, activity, moderation history and a 0-100 Alt Risk Score banded Low, Moderate, High or Critical.",
      "**Explainable signals** — twelve inputs (account age, join recency, default avatar, activity, moderation, reputation, economy, giveaways, applications, onboarding, verification, prior flags), each listed with the points it contributed — including the ones that count in the account's favour.",
      "**Potential linked accounts** — similar usernames, near-simultaneous joins, accounts created together, shared moderation history, coin transfers and matching activity hours, each with a confidence percentage and the indicators behind it. Never presented as confirmed.",
      "**Investigations** — Pulse flags high and critical accounts as they join, so the queue is already waiting; cases carry statuses, moderator notes, outcomes, manual account links and a full timeline.",
      "**/alt-check** — the same report in Discord: account age, risk score, risk factors, potential linked accounts and a recommendation, recorded in the dashboard's lookup history.",
    ],
    outro:
      "Judgement stays with your moderators — Pulse just makes sure they have the evidence in front of them.",
  },
  {
    version: "0.58.0",
    title: "Birthday System",
    date: "Jul 11, 2026",
    description:
      "A Birthdays view in Engagement that celebrates members automatically — they set their birthday (with privacy controls), and on the day Pulse posts an announcement, grants a temporary birthday role and hands out rewards.",
    highlights: [
      "**Members set it, their way** — with /birthday set or from the Pulsify profile, with an optional year and timezone; /birthday view, upcoming and remove round out the commands.",
      "**Privacy first** — hide your age, show only day and month, opt out of announcements, or remove your birthday anytime.",
      "**Automatic celebrations** — an on-brand Pulse v2 announcement with a custom message, mentions, image and button, at the channel and hour you choose.",
      "**Role & rewards** — a temporary birthday role that auto-removes, plus optional Pulse Coins, XP and custom roles (reputation stays computed, never granted).",
      "**A view built for it** — today's and upcoming birthdays, a month calendar, countdown labels, celebration history and one settings panel with a live preview and Send test.",
    ],
    outro:
      "Give your community a reason to celebrate — automatic, personal and completely in your members' control.",
  },
  {
    version: "0.57.0",
    title: "Server Statistics Channels",
    date: "Jul 10, 2026",
    description:
      "A Statistics Channels tab in Server > Channels for live counter channels whose names show real-time server stats — members, boosts, roles, messages and more — kept in sync automatically by Pulse.",
    highlights: [
      "**17 statistics** — total/human/bot/online members, boosts and boost level, roles, channels (voice/text), emojis, stickers, server age, new members today/this week, total messages and active members.",
      "**Your templates** — custom name templates like \"👥 Members: {members}\" with emojis, prefixes and a {value} placeholder, as a locked voice channel that's public to everyone or private (admins only).",
      "**Hands-off sync** — Pulse provisions the channel and renames it only when the value changes, refreshing every 10 minutes to stay well within Discord's rate limits.",
      "**Bulk management** — create, edit, duplicate, enable/disable and delete in bulk, with drag-and-drop ordering, search and filters.",
      "**Live preview** — see exactly how the channel name will look, with the current value, before you create it.",
    ],
    outro:
      "Put your server's pulse right in the channel list — live, on-brand and completely automatic.",
  },
  {
    version: "0.56.0",
    title: "Self-Assign Roles",
    date: "Jun 27, 2026",
    description:
      "A Self-Assign Roles tab in Server > Roles for building interactive role menus where members pick their own roles with buttons or a dropdown — a modern replacement for reaction-role bots.",
    highlights: [
      "**Buttons or a select menu** — choose the control that fits the number of roles, post it into any text or announcement channel, and organise menus by category.",
      "**Members self-serve** — assign, remove or switch roles with a tap; make a menu's roles mutually exclusive (single) or freely combinable (multiple), and gate it behind required roles.",
      "**Customisation** — per-role labels, emojis and button colours, with drag-and-drop ordering and a live preview as you build.",
      "**Usage analytics** — most and least selected roles, a 14-day add/remove trend, and active menus, roles offered and members served at a glance.",
      "**Easy management** — edit, duplicate as a draft, disable temporarily, archive when done, plus search and status filters.",
    ],
    outro:
      "Hand role management to your members — interactive, customisable and measured, with no reaction-role bot required.",
  },
  {
    version: "0.55.0",
    title: "Role Hierarchy",
    date: "Jun 25, 2026",
    description:
      "A Hierarchy tab in Server > Roles that auto-groups your roles into Management, Bots and Community, with role statistics and distribution at a glance for a cleaner view of your server's structure.",
    highlights: [
      "**Automatic categorization** — every role is sorted into Management, Bots or Community using simple, deterministic rules (managed flags, permissions, name keywords) — no AI.",
      "**Visual layout** — category cards with the roles inside, top-down by position, showing colour, member count and rank, in compact or expanded view.",
      "**Role statistics** — total roles, members with roles, per-category counts, empty vs. active roles, the highest role and the most-assigned role.",
      "**Distribution** — bars for roles and members per category plus an empty-vs-active gauge.",
      "**Built in** — click any role to open the existing edit flow, refresh on demand and export the hierarchy as a PNG.",
    ],
    outro:
      "A clearer picture of your role structure — grouped, measured and ready to manage.",
  },
  {
    version: "0.54.0",
    title: "Temporary Roles",
    date: "Jun 24, 2026",
    description:
      "A Temporary Roles tab in Server > Roles for time-limited access and rewards — Pulse assigns the role, then removes it automatically when it expires, logging every step.",
    highlights: [
      "**Assign with an expiry** — minutes, hours, days, weeks, months or a custom date, with presets like VIP 30d, Event Access 24h, Giveaway Winner 7d and Trial Moderator 14d.",
      "**Automatic expiration** — a sweep removes expired roles, marks them expired, logs the event and optionally DMs the member (plus a 24h heads-up).",
      "**Source tracking** — every grant is attributed to Manual, Economy, Marketplace, Giveaway, Event, Automation, Application, Moderation or Other.",
      "**Monitoring + management** — active/expiring-soon/recently-expired stats, most-assigned roles, a 14-day trend, plus extend/shorten/remove, bulk actions and live countdowns.",
      "**Audited & in sync** — an append-only log of assigned/extended/shortened/expired/removed events, with graceful handling of deleted roles, departed members and permission limits.",
    ],
    outro:
      "Time-limited permissions, handled for you — assign once and Pulse cleans up on schedule.",
  },
  {
    version: "0.53.0",
    title: "Server Assets Manager",
    date: "Jun 24, 2026",
    description:
      "A dedicated Server › Assets page that manages your emojis, stickers and soundboard sounds in one place — with bulk tools, drag-and-drop uploads and one-click exports.",
    highlights: [
      "**Server › Assets** — Emojis, Stickers and Soundboard tabs with totals, animated counts and live slot-usage bars.",
      "**Full management** — search, filter, sort, grid/list views, previews (with in-dashboard sound playback), rename, delete and duplicate.",
      "**Import** — drag-and-drop or batch uploads with validation, duplicate detection and rename-before-upload, pushed straight to Discord.",
      "**Bulk tools** — select many assets to rename, export or delete together, with confirmation on destructive actions.",
      "**Export** — a single asset, your selection, a whole category, or a full server package as a ZIP with a metadata manifest.",
    ],
    outro:
      "Server branding, organised — no more digging through Discord's native settings.",
  },
  {
    version: "0.52.0",
    title: "DDoS Protection & Security Monitoring",
    date: "Jun 18, 2026",
    description:
      "A new Security section that watches your server for suspicious traffic, abuse and raids — detecting spikes, applying automatic mitigations and alerting you in the dashboard and Discord.",
    highlights: [
      "**Security › DDoS Protection** — a live status banner, an activity-spike graph, open detections, active mitigations and suspicious users in one view.",
      "**Smart detection** — command/request spikes, excessive command usage, repeated failed actions, mass ticket/giveaway/application activity, API abuse, member-join bursts and automated spam.",
      "**Rules & auto-lockdown** — per-pattern thresholds and windows, Relaxed/Balanced/Strict presets, and optional auto-lockdown for sustained attacks.",
      "**Automatic mitigation + alerts** — increase cooldowns, restrict/block members, pause submissions, disable features or lock down — with dashboard + Discord alerts and self-healing recovery.",
      "**Templates, reimagined** — Templates & Quick Setup now toggle which Pulsify features are on/off (start from a preset, apply in one click); premium features stay locked to your plan.",
    ],
    outro:
      "Pulsify is ready for larger, public servers — with the visibility and controls to keep them safe.",
  },
  {
    version: "0.49.0",
    title: "Economy Commands & Earning Visibility",
    date: "Jun 16, 2026",
    description:
      "A polish pass on the in-Discord economy: a flexible /leaderboard, a redesigned /balance, clearer /pay, and a new /earn guide that explains exactly how to earn.",
    highlights: [
      "**/leaderboard** — one command, six boards: Global Balance, Global Reputation, Server Level, Server XP, Messages and Voice Activity. Switch with a menu, page through the rankings, and see your own position highlighted.",
      "**/earn** — a two-page guide to earning everything: global Balance & Reputation on page one, server XP & Levels on page two.",
      "**/balance** (was /wallet) — a cleaner layout with your leaderboard position, reputation, lifetime totals and recent activity, tuned for mobile.",
      "**/pay** — friendlier validation, a clearer success embed and an unmistakable from → to transfer summary.",
    ],
    outro:
      "Members can now see where they stand and exactly how to climb — all without leaving Discord.",
  },
  {
    version: "0.48.0",
    title: "Integrations Polish & Reliability",
    date: "Jun 15, 2026",
    description:
      "A stability-and-style pass on the Integrations Hub: richer, modern notification embeds plus clearer error states, safer controls and easier-to-search logs.",
    highlights: [
      "**Richer, modern notifications** — every integration post follows Pulse's v2 embed style: the service's brand colour, a relative timestamp, a clean headline, a tidy details panel (event, author, status, game, when…) and a one-tap button to the source.",
      "**Confirm before you disconnect** — disconnecting or removing an integration asks first, with a clear note on what happens (disconnect keeps your settings; removal is permanent).",
      "**Clearer error states** — a connection that needs attention shows exactly what went wrong and how to fix it, with a one-click Test to retry and clear the error.",
      "**Searchable logs & consistent dialogs** — search/filter the activity log by integration as well as type, and the setup panel now closes with Escape and can't be dismissed mid-save.",
    ],
    outro: null,
  },
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

// Analytics & Insights commands — bot side (PULSIFY-61).
//
// /stats overview · /stats channels · /stats members  (moderator tier)
// /insights                                            (admin tier)
// /management stats [staff]                            (admin tier)
//
// These bring the dashboard's Statistics, Server Insights and Management
// Analytics views to Discord. `module: null` — analytics isn't a toggleable
// feature. All three read the SAME source of truth the web routes use — the
// analytics RPCs (get_analytics_summary / _timeseries / get_top_channels /
// get_top_users / get_activity_heatmap) plus native Discord state — and run the
// exact same maths, ported into src/insights-engine.js and
// src/management-engine.js and pinned by parity tests, so a health score or a
// staff total never disagrees between here and the dashboard.
//
// NEITHER /insights NOR /management is plan-gated: the web routes gate both at
// admin only (no plan check, no advancedAnalytics gate), so gating the slash
// commands would tell a free server's admin to upgrade for a page they can
// already open. See §5 of resources/PULSIFY-61.md.
//
// Note on `/stats channels`: this is the top-channels RANKING, deliberately not
// a single-channel deep-dive — that already exists as the moderator-tier
// `/channel stats` (src/channels.js). Duplicating it here would be two commands
// doing one job; a server-wide ranking complements it instead.

const { PermissionFlagsBits, MessageFlags, ChannelType } = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  editNotice,
  unicodeBar,
  text,
  divider,
} = require("./commands");
const { getDashboardUrl } = require("./version");
const {
  splitWindow,
  computeTrends,
  generateRecommendations,
  healthFromRecommendations,
  bestActivitySlot,
} = require("./insights-engine");
const {
  buildManagement,
  modActionKind,
  TICKET_EVENT_KIND,
  formatSeconds,
  ROLE_LABELS,
} = require("./management-engine");

const DAY_MS = 86_400_000;
const DISCORD_EPOCH = 1420070400000n;

// The activity heatmap reads a fixed trailing window (independent of the period
// selector) — a server's weekly rhythm needs more than a single week to emerge.
// Mirrors HEATMAP_DAYS in the web insights route.
const HEATMAP_DAYS = 30;

// Text-like channel types where a "last message" is a meaningful activity
// signal — GuildText, GuildAnnouncement, GuildForum, GuildMedia. Mirrors
// TEXTY_CHANNEL_TYPES in the web route.
const TEXTY_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

// Above this member count a full member fetch is too heavy to do on demand, so
// role-membership counts fall back to the cache and are treated as a sample —
// which suppresses the "unused roles" signal (mirrors the web's 1000-member cap
// + unusedRolesReliable flag, adapted to the bot's gateway cache).
const MEMBER_FETCH_CAP = 3000;

// The four Discord permissions flagged danger: 'high' in lib/discord-permissions.ts,
// in that file's category order (so the listed permissions read the same as the
// dashboard). Raw-bit tested — NOT via PermissionsBitField.has(), which treats
// Administrator as implying every permission; the web checks raw bits too, so a
// role with only Administrator lists just "Administrator", matching parity.
const HIGH_DANGER_PERMISSIONS = [
  [PermissionFlagsBits.ManageRoles, "Manage Roles"],
  [PermissionFlagsBits.ManageGuild, "Manage Server"],
  [PermissionFlagsBits.BanMembers, "Ban Members"],
  [PermissionFlagsBits.Administrator, "Administrator"],
];

const PERIOD_CHOICES = [
  { name: "Last 24 hours", value: "24h" },
  { name: "Last 7 days", value: "7d" },
  { name: "Last 30 days", value: "30d" },
  { name: "All time", value: "all" },
];

/** Discord snowflake → creation Date, or null. */
function snowflakeToDate(id) {
  try {
    return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
  } catch {
    return null;
  }
}

/** Resolve the `period` option into concrete windows + copy. */
function resolvePeriod(interaction) {
  const raw = interaction.options.getString("period") ?? "7d";
  const now = Date.now();
  const days = raw === "24h" ? 1 : raw === "7d" ? 7 : raw === "30d" ? 30 : null;
  const comparison = days !== null;
  return {
    key: raw,
    windowDays: days,
    comparison,
    now,
    windowSince: comparison ? new Date(now - days * DAY_MS).toISOString() : null,
    trendSince: comparison ? new Date(now - days * 2 * DAY_MS).toISOString() : null,
    trunc: raw === "24h" ? "hour" : "day",
    label:
      raw === "24h"
        ? "the last 24 hours"
        : raw === "7d"
          ? "the last 7 days"
          : raw === "30d"
            ? "the last 30 days"
            : "all time",
  };
}

/** Compact "3h 12m" / "45m" / "30s" / "0m" from a second count. */
function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (s <= 0) return "0m";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/** A parenthetical trend tag for a metric line, or "" when there's nothing to say. */
function trendTag(t, comparison) {
  if (!comparison || !t) return "";
  if (t.isNew) return " (new)";
  if (t.direction === "stable") return " (steady)";
  const mag = Math.abs(t.changePct);
  return t.direction === "increasing" ? ` (up ${mag}%)` : ` (down ${mag}%)`;
}

const SEVERITY_TAGS = {
  critical: "Critical",
  warning: "Needs attention",
  suggestion: "Suggestion",
  positive: "Looking good",
};

function createAnalytics({ client, supabase }) {
  /**
   * Fetch guild members for role-count / staff-directory work. Large servers
   * fall back to the cache and are flagged unreliable (the web caps the fetch
   * the same way).
   */
  async function fetchMembers(guild) {
    const count = guild.memberCount ?? 0;
    if (count > MEMBER_FETCH_CAP) {
      return { members: guild.members.cache, reliable: false };
    }
    try {
      const all = await guild.members.fetch();
      return { members: all, reliable: true };
    } catch {
      const cache = guild.members.cache;
      return { members: cache, reliable: cache.size >= count };
    }
  }

  async function renderContainer(interaction, guild, iconKey, { title, subtitle, body, footer, actions }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = iconKey ? await loadPulseIcon(iconKey, colorHex) : null;
    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title,
          subtitle,
          body,
          footer,
          actions: actions ?? [],
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  function dashboardButton(guildId, path, label) {
    return {
      type: 1,
      components: [{ type: 2, style: 5, label, url: `${getDashboardUrl(guildId)}${path}` }],
    };
  }

  // ── /stats ───────────────────────────────────────────────────────────────

  async function handleStats({ interaction, guild, ephemeral }) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    if (sub === "overview") return statsOverview(interaction, guild);
    if (sub === "channels") return statsChannels(interaction, guild);
    if (sub === "members") return statsMembers(interaction, guild);
    return editNotice(interaction, "Unknown stats view.");
  }

  async function statsOverview(interaction, guild) {
    const p = resolvePeriod(interaction);
    const [seriesRes, summaryRes] = await Promise.all([
      supabase.rpc("get_analytics_timeseries", {
        p_guild_id: guild.id,
        p_since: p.trendSince,
        p_trunc: p.trunc,
      }),
      supabase.rpc("get_analytics_summary", { p_guild_id: guild.id, p_since: p.windowSince }),
    ]);
    if (seriesRes.error) {
      console.error(`[Pulse] /stats overview failed in ${guild.id}:`, seriesRes.error.message);
      return editNotice(interaction, "I couldn't load server stats right now. Try again shortly.");
    }

    const series = seriesRes.data ?? [];
    // For 'all', derive the effective window from the earliest bucket so the
    // split treats everything as the current period.
    let windowDays = p.windowDays;
    if (!p.comparison) {
      let earliest = p.now;
      for (const b of series) {
        const t = new Date(b.bucket).getTime();
        if (!Number.isNaN(t) && t < earliest) earliest = t;
      }
      windowDays = Math.max(1, Math.ceil((p.now - earliest) / DAY_MS));
    }
    const { current, previous } = splitWindow(series, windowDays, p.now);
    const trends = computeTrends(current, previous);

    const activeUsers = Number(summaryRes.data?.[0]?.active_users ?? 0);
    const totalMembers = guild.memberCount ?? 0;
    const net = current.joins - current.leaves;

    const lines = [];
    lines.push(
      `**Members** — ${net >= 0 ? "+" : ""}${net} net — ${current.joins} joined, ${current.leaves} left${trendTag(trends.netGrowth, p.comparison)}`,
    );
    lines.push(`**Messages** — ${current.messages.toLocaleString()}${trendTag(trends.messages, p.comparison)}`);
    if (current.voice_seconds > 0) {
      lines.push(`**Voice** — ${fmtDuration(current.voice_seconds)}${trendTag(trends.voice_seconds, p.comparison)}`);
    }
    lines.push(`**Commands** — ${current.commands.toLocaleString()}${trendTag(trends.commands, p.comparison)}`);
    if (current.mod_actions > 0) {
      lines.push(`**Moderation** — ${current.mod_actions.toLocaleString()} action${current.mod_actions === 1 ? "" : "s"}${trendTag(trends.mod_actions, p.comparison)}`);
    }
    if (totalMembers > 0) {
      const pct = Math.min(100, Math.round((activeUsers / totalMembers) * 100));
      lines.push(`**Active members** — ${activeUsers.toLocaleString()} (${pct}% of the server)`);
    } else {
      lines.push(`**Active members** — ${activeUsers.toLocaleString()}`);
    }

    const touched =
      current.messages + current.joins + current.leaves + current.commands + current.mod_actions + current.voice_seconds;
    const body = [];
    if (touched === 0) {
      body.push(text(`No recorded activity in ${guild.name} over ${p.label}.`));
      body.push(text("-# Pulse only counts activity since it joined — a quiet number here may just mean it's new."));
    } else {
      body.push(text(`Server activity across ${p.label}.`));
      body.push(divider());
      body.push(text(lines.join("\n")));
    }

    await renderContainer(interaction, guild, "stats", {
      title: "Server Statistics",
      subtitle: `Pulse — ${guild.name}`,
      body,
      footer: "Pulse — Statistics",
      actions: [dashboardButton(guild.id, "/statistics", "Open Statistics")],
    });
  }

  async function statsChannels(interaction, guild) {
    const p = resolvePeriod(interaction);
    const { data, error } = await supabase.rpc("get_top_channels", {
      p_guild_id: guild.id,
      p_since: p.windowSince,
      p_limit: 10,
    });
    if (error) {
      console.error(`[Pulse] /stats channels failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load channel stats right now. Try again shortly.");
    }
    const rows = data ?? [];
    const body = [];
    if (rows.length === 0) {
      body.push(text(`No channel activity recorded over ${p.label}.`));
    } else {
      body.push(text(`The busiest channels over ${p.label}.`));
      body.push(divider());
      const lines = rows.map((r, i) => {
        const label = `<#${r.channel_id}>`;
        const count = Number(r.message_count).toLocaleString();
        return `**${i + 1}.** ${label} — ${count} message${Number(r.message_count) === 1 ? "" : "s"}`;
      });
      body.push(text(lines.join("\n")));
    }
    await renderContainer(interaction, guild, "channel", {
      title: "Top Channels",
      subtitle: `Pulse — ${guild.name}`,
      body,
      footer: "Pulse — Statistics",
      actions: [dashboardButton(guild.id, "/statistics", "Open Statistics")],
    });
  }

  async function statsMembers(interaction, guild) {
    const p = resolvePeriod(interaction);
    const { data, error } = await supabase.rpc("get_top_users", {
      p_guild_id: guild.id,
      p_since: p.windowSince,
      p_limit: 10,
    });
    if (error) {
      console.error(`[Pulse] /stats members failed in ${guild.id}:`, error.message);
      return editNotice(interaction, "I couldn't load member stats right now. Try again shortly.");
    }
    const rows = data ?? [];
    const body = [];
    if (rows.length === 0) {
      body.push(text(`No member activity recorded over ${p.label}.`));
    } else {
      body.push(text(`The most active members over ${p.label}.`));
      body.push(divider());
      const lines = rows.map((r, i) => {
        const count = Number(r.message_count).toLocaleString();
        return `**${i + 1}.** <@${r.user_id}> — ${count} message${Number(r.message_count) === 1 ? "" : "s"}`;
      });
      body.push(text(lines.join("\n")));
    }
    await renderContainer(interaction, guild, "leaderboard", {
      title: "Most Active Members",
      subtitle: `Pulse — ${guild.name}`,
      body,
      footer: "Pulse — Statistics",
      actions: [dashboardButton(guild.id, "/statistics", "Open Statistics")],
    });
  }

  // ── /insights ──────────────────────────────────────────────────────────────

  async function handleInsights({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const p = resolvePeriod(interaction);
    const heatmapSince = new Date(p.now - HEATMAP_DAYS * DAY_MS).toISOString();

    const [seriesRes, summaryRes, heatmapRes, settingsRow, aiModRow, membersInfo] = await Promise.all([
      supabase.rpc("get_analytics_timeseries", {
        p_guild_id: guild.id,
        p_since: p.trendSince,
        p_trunc: p.trunc,
      }),
      supabase.rpc("get_analytics_summary", { p_guild_id: guild.id, p_since: p.windowSince }),
      supabase.rpc("get_activity_heatmap", { p_guild_id: guild.id, p_since: heatmapSince }),
      supabase.from("guild_settings").select("settings").eq("guild_id", guild.id).maybeSingle(),
      supabase.from("ai_moderation_settings").select("enabled").eq("guild_id", guild.id).maybeSingle(),
      fetchMembers(guild),
    ]);

    if (seriesRes.error) {
      console.error(`[Pulse] /insights failed in ${guild.id}:`, seriesRes.error.message);
      return editNotice(interaction, "I couldn't generate insights right now. Try again shortly.");
    }

    const series = seriesRes.data ?? [];
    let windowDays = p.windowDays;
    if (!p.comparison) {
      let earliest = p.now;
      for (const b of series) {
        const t = new Date(b.bucket).getTime();
        if (!Number.isNaN(t) && t < earliest) earliest = t;
      }
      windowDays = Math.max(1, Math.ceil((p.now - earliest) / DAY_MS));
    }
    const { current, previous } = splitWindow(series, windowDays, p.now);
    const trends = computeTrends(current, previous);
    const activeUsers = Number(summaryRes.data?.[0]?.active_users ?? 0);
    const heatmap = heatmapRes.error ? [] : heatmapRes.data ?? [];

    // ── Inactive channels (Discord last-message snowflake) ────────────────────
    const threshold = windowDays >= 30 ? 30 : 14;
    const inactiveChannels = [];
    for (const c of guild.channels.cache.values()) {
      if (!TEXTY_TYPES.has(c.type)) continue;
      const lastId = c.lastMessageId ?? c.id;
      const lastActivity = snowflakeToDate(lastId);
      if (!lastActivity) continue;
      const daysInactive = Math.floor((p.now - lastActivity.getTime()) / DAY_MS);
      if (daysInactive >= threshold) {
        inactiveChannels.push({ id: c.id, name: c.name, daysInactive });
      }
    }
    inactiveChannels.sort((a, b) => b.daysInactive - a.daysInactive);

    // ── Roles: dangerous + unused ─────────────────────────────────────────────
    const { members, reliable } = membersInfo;
    const roleCounts = new Map();
    for (const m of members.values()) {
      for (const rid of m.roles.cache.keys()) {
        roleCounts.set(rid, (roleCounts.get(rid) ?? 0) + 1);
      }
    }
    const unusedRolesReliable = reliable;
    const manageableRoles = guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed);

    const dangerousRoles = [];
    for (const r of manageableRoles.values()) {
      const raw = r.permissions.bitfield;
      const perms = HIGH_DANGER_PERMISSIONS.filter(([bit]) => (raw & bit) === bit).map(([, label]) => label);
      if (perms.length > 0) dangerousRoles.push({ id: r.id, name: r.name, permissions: perms });
    }
    dangerousRoles.sort((a, b) => b.permissions.length - a.permissions.length);

    const unusedRoles = unusedRolesReliable
      ? [...manageableRoles.values()]
          .filter((r) => (roleCounts.get(r.id) ?? 0) === 0)
          .sort((a, b) => b.position - a.position)
          .map((r) => ({ id: r.id, name: r.name }))
      : [];

    // ── Feature config ─────────────────────────────────────────────────────────
    const settings = settingsRow.data?.settings ?? {};
    const welcomeConfigured = settings?.welcome?.enabled === true;
    const pulseGuardEnabled = aiModRow.data?.enabled === true;
    const onboardingStatus = settings?.member_onboarding?.enabled === true ? "completed" : "not_started";

    const signals = {
      windowDays,
      current,
      previous,
      trends,
      activeUsers,
      totalMembers: guild.memberCount ?? 0,
      inactiveChannels: inactiveChannels.slice(0, 8),
      unusedRoles: unusedRoles.slice(0, 8),
      unusedRolesReliable,
      dangerousRoles,
      pulseGuardEnabled,
      welcomeConfigured,
      onboardingStatus,
      peakActivitySlot: bestActivitySlot(heatmap),
    };

    const recommendations = generateRecommendations(signals);
    const health = healthFromRecommendations(recommendations);

    const body = [];
    body.push(text(`**Server health** — ${health.score}/100 — ${health.label}`));
    body.push(text(`\`${unicodeBar(health.score)}\``));
    body.push(text(`-# Based on activity, moderation and structure over ${p.label}`));
    body.push(divider());

    // Top recommendations — surface the most important few, full copy.
    const shown = recommendations.slice(0, 6);
    body.push(text("**What to look at**"));
    body.push(
      text(
        shown
          .map((r) => `**${r.title}**\n${r.detail}\n-# ${SEVERITY_TAGS[r.severity] ?? "Suggestion"}`)
          .join("\n\n"),
      ),
    );
    if (recommendations.length > shown.length) {
      body.push(text(`-# …and ${recommendations.length - shown.length} more in the dashboard`));
    }

    await renderContainer(interaction, guild, "info", {
      title: "Server Insights",
      subtitle: `Pulse — ${guild.name}`,
      body,
      footer: "Pulse — Insights",
      actions: [dashboardButton(guild.id, "/insights", "Open Insights")],
    });
  }

  // ── /management ──────────────────────────────────────────────────────────────

  async function handleManagement({ interaction, guild, ephemeral }) {
    // Only `/management stats` exists; guard in case more subcommands are added.
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    if (sub !== "stats") return editNotice(interaction, "Unknown management view.");

    const p = resolvePeriod(interaction);

    const modQ = supabase
      .from("moderation_logs")
      .select("moderator_id, moderator_username, action, created_at")
      .eq("guild_id", guild.id);
    const ticketEventsQ = supabase
      .from("ticket_events")
      .select("ticket_id, type, actor_id, actor_name, created_at")
      .eq("guild_id", guild.id);
    const ticketsQ = supabase
      .from("tickets")
      .select("id, status, opened_at, closed_at, closed_by, closed_by_name")
      .eq("guild_id", guild.id);
    const annQ = supabase
      .from("announcements")
      .select("author_id, author_name, created_by, status, created_at")
      .eq("guild_id", guild.id)
      .eq("status", "published");
    const gwQ = supabase
      .from("giveaways")
      .select("host_id, host_name, created_by, created_at")
      .eq("guild_id", guild.id);

    const [modRes, ticketEventsRes, ticketsRes, openTicketsRes, annRes, gwRes, supportRolesRes, membersInfo] =
      await Promise.all([
        p.trendSince ? modQ.gte("created_at", p.trendSince) : modQ,
        p.trendSince ? ticketEventsQ.gte("created_at", p.trendSince) : ticketEventsQ,
        p.windowSince ? ticketsQ.gte("opened_at", p.windowSince) : ticketsQ,
        supabase.from("tickets").select("id", { count: "exact", head: true }).eq("guild_id", guild.id).neq("status", "closed"),
        p.trendSince ? annQ.gte("created_at", p.trendSince) : annQ,
        p.trendSince ? gwQ.gte("created_at", p.trendSince) : gwQ,
        supabase.from("ticket_configs").select("support_role_ids").eq("guild_id", guild.id).maybeSingle(),
        fetchMembers(guild),
      ]);

    if (modRes.error) {
      console.error(`[Pulse] /management stats failed in ${guild.id}:`, modRes.error.message);
      return editNotice(interaction, "I couldn't load management analytics right now. Try again shortly.");
    }

    const events = [];
    for (const r of modRes.data ?? []) {
      if (!r.moderator_id) continue;
      events.push({ actorId: r.moderator_id, actorName: r.moderator_username, kind: modActionKind(r.action), at: r.created_at });
    }

    const firstResponse = new Map();
    for (const r of ticketEventsRes.data ?? []) {
      const kind = TICKET_EVENT_KIND[r.type];
      if (!kind || !r.actor_id) continue;
      events.push({ actorId: r.actor_id, actorName: r.actor_name, kind, at: r.created_at });
      if (kind === "ticket_claim") {
        const existing = firstResponse.get(r.ticket_id);
        if (!existing || new Date(r.created_at).getTime() < new Date(existing.at).getTime()) {
          firstResponse.set(r.ticket_id, { at: r.created_at, actorId: r.actor_id, actorName: r.actor_name });
        }
      }
    }

    for (const r of annRes.data ?? []) {
      const actorId = r.author_id ?? r.created_by;
      if (!actorId) continue;
      events.push({ actorId, actorName: r.author_name, kind: "announcement", at: r.created_at });
    }
    for (const r of gwRes.data ?? []) {
      const actorId = r.host_id ?? r.created_by;
      if (!actorId) continue;
      events.push({ actorId, actorName: r.host_name, kind: "giveaway", at: r.created_at });
    }

    // Discord scheduled events have no created_at, so they're attributed to the
    // current window as a best-effort "events created" signal for their creator.
    const nowIso = new Date(p.now).toISOString();
    const scheduled = await guild.scheduledEvents.fetch().catch(() => null);
    if (scheduled) {
      for (const ev of scheduled.values()) {
        const creatorId = ev.creator?.id ?? ev.creatorId;
        if (!creatorId) continue;
        events.push({ actorId: creatorId, actorName: ev.creator?.username ?? null, kind: "event", at: nowIso });
      }
    }

    const tickets = (ticketsRes.data ?? []).map((r) => {
      const fr = firstResponse.get(r.id) ?? null;
      return {
        id: r.id,
        openedAt: r.opened_at,
        firstResponseAt: fr?.at ?? null,
        responderId: fr?.actorId ?? null,
        responderName: fr?.actorName ?? null,
        resolved: r.status === "closed",
        closedAt: r.closed_at,
        closedById: r.closed_by,
        closedByName: r.closed_by_name,
      };
    });

    const supportRoleIds = new Set((supportRolesRes.data?.support_role_ids ?? []).map(String));
    const directory = [];
    for (const m of membersInfo.members.values()) {
      if (m.user?.bot) continue;
      const isSupportRole = m.roles.cache.some((r) => supportRoleIds.has(r.id));
      directory.push({ id: m.id, name: m.displayName ?? m.user?.username ?? null, avatar: null, isSupportRole });
    }

    const data = buildManagement({
      timeframe: p.key,
      now: p.now,
      events,
      tickets,
      directory,
      openTickets: openTicketsRes.count ?? 0,
    });

    const staffUser = interaction.options.getUser("staff");
    if (staffUser) {
      return renderStaffMember(interaction, guild, data, staffUser, p);
    }
    return renderManagementOverview(interaction, guild, data, p);
  }

  async function renderManagementOverview(interaction, guild, data, p) {
    const { totals, support, leaderboards, insights, staff } = data;
    const body = [];

    if (!data.hasActivity) {
      body.push(text(`No staff activity recorded over ${p.label}.`));
      body.push(text("-# Moderation, ticket handling, announcements and events all count once they happen."));
      await renderContainer(interaction, guild, "roles", {
        title: "Management Analytics",
        subtitle: `Pulse — ${guild.name}`,
        body,
        footer: "Pulse — Management",
        actions: [dashboardButton(guild.id, "/management", "Open Management")],
      });
      return;
    }

    body.push(text(`Staff performance across ${p.label}.`));
    body.push(divider());
    body.push(
      text(
        [
          `**Total actions** — ${totals.totalActions.toLocaleString()}${trendTag(totals.trends.totalActions, data.comparison)}`,
          `**Moderation** — ${totals.moderationActions.toLocaleString()}${trendTag(totals.trends.moderationActions, data.comparison)}`,
          `**Support** — ${totals.supportActions.toLocaleString()}${trendTag(totals.trends.supportActions, data.comparison)}`,
          `**Community** — ${totals.communityActions.toLocaleString()}${trendTag(totals.trends.communityActions, data.comparison)}`,
          `**Active staff** — ${totals.activeStaff.toLocaleString()}${trendTag(totals.trends.activeStaff, data.comparison)}`,
        ].join("\n"),
      ),
    );

    if (support.ticketsHandled > 0 || support.openTickets > 0) {
      body.push(divider());
      const supLines = [
        `**Tickets handled** — ${support.ticketsHandled} — **Resolved** — ${support.ticketsResolved} (${support.resolutionRatePct}%)`,
      ];
      if (support.avgFirstResponseSeconds !== null) {
        supLines.push(`**Avg first response** — ${formatSeconds(support.avgFirstResponseSeconds)}`);
      }
      if (support.avgResolutionSeconds !== null) {
        supLines.push(`**Avg resolution** — ${formatSeconds(support.avgResolutionSeconds)}`);
      }
      supLines.push(`**Open now** — ${support.openTickets}`);
      body.push(text(supLines.join("\n")));
    }

    const lb = [];
    const lbLine = (label, entry, fmt) => {
      if (!entry) return;
      lb.push(`**${label}** — <@${entry.id}> (${fmt(entry)})`);
    };
    lbLine("Top contributor", leaderboards.topContributor, (e) => `${e.value} actions`);
    lbLine("Top moderator", leaderboards.mostActiveModerator, (e) => `${e.value} actions`);
    lbLine("Top support", leaderboards.mostActiveSupport, (e) => `${e.value} tickets`);
    lbLine("Fastest responder", leaderboards.fastestResponder, (e) => `${formatSeconds(e.value)} avg`);
    lbLine("Most resolved", leaderboards.mostTicketsResolved, (e) => `${e.value} resolved`);
    if (lb.length > 0) {
      body.push(divider());
      body.push(text("**Standouts**"));
      body.push(text(lb.join("\n")));
    }

    if (insights.length > 0) {
      body.push(divider());
      body.push(text("**What to look at**"));
      body.push(
        text(
          insights
            .slice(0, 3)
            .map((i) => `**${i.title}**\n${i.body}`)
            .join("\n\n"),
        ),
      );
    }

    await renderContainer(interaction, guild, "roles", {
      title: "Management Analytics",
      subtitle: `Pulse — ${guild.name}`,
      body,
      footer: "Pulse — Management",
      actions: [dashboardButton(guild.id, "/management", "Open Management")],
    });
  }

  async function renderStaffMember(interaction, guild, data, staffUser, p) {
    const entry = data.staff.find((s) => s.id === staffUser.id);
    const displayName = staffUser.globalName ?? staffUser.username;

    if (!entry || entry.totalActions === 0) {
      await renderContainer(interaction, guild, "roles", {
        title: displayName,
        subtitle: `Pulse — ${guild.name}`,
        body: [text(`No recorded staff activity for <@${staffUser.id}> over ${p.label}.`)],
        footer: "Pulse — Management",
        actions: [dashboardButton(guild.id, "/management", "Open Management")],
      });
      return;
    }

    const body = [];
    body.push(text(`Staff activity across ${p.label}.`));
    body.push(divider());

    const modLine = [];
    if (entry.warnings) modLine.push(`${entry.warnings} warn`);
    if (entry.timeouts) modLine.push(`${entry.timeouts} timeout`);
    if (entry.kicks) modLine.push(`${entry.kicks} kick`);
    if (entry.bans) modLine.push(`${entry.bans} ban`);
    if (entry.unbans) modLine.push(`${entry.unbans} unban`);
    if (entry.moderationOther) modLine.push(`${entry.moderationOther} other`);
    body.push(
      text(
        `**Moderation** — ${entry.moderationTotal} action${entry.moderationTotal === 1 ? "" : "s"}${modLine.length ? `\n-# ${modLine.join(" — ")}` : ""}`,
      ),
    );

    if (entry.ticketsHandled > 0 || entry.ticketsResolved > 0) {
      const supLine = [`**Support** — ${entry.ticketsHandled} handled, ${entry.ticketsResolved} resolved`];
      if (entry.avgFirstResponseSeconds !== null) {
        supLine.push(`-# Avg first response ${formatSeconds(entry.avgFirstResponseSeconds)}`);
      }
      body.push(text(supLine.join("\n")));
    }

    if (entry.communityTotal > 0) {
      const comLine = [];
      if (entry.announcements) comLine.push(`${entry.announcements} announcement${entry.announcements === 1 ? "" : "s"}`);
      if (entry.giveaways) comLine.push(`${entry.giveaways} giveaway${entry.giveaways === 1 ? "" : "s"}`);
      if (entry.eventsCreated) comLine.push(`${entry.eventsCreated} event${entry.eventsCreated === 1 ? "" : "s"}`);
      body.push(text(`**Community** — ${comLine.join(" — ")}`));
    }

    body.push(divider());
    const lastActive = entry.lastActiveAt ? `<t:${Math.floor(new Date(entry.lastActiveAt).getTime() / 1000)}:R>` : "—";
    body.push(
      text(
        [
          `**Total actions** — ${entry.totalActions}${trendTag(entry.trend, data.comparison)}`,
          `**Active days** — ${entry.activeDays} (${entry.consistencyPct}% consistency)`,
          `**Last active** — ${lastActive}`,
        ].join("\n"),
      ),
    );

    await renderContainer(interaction, guild, "roles", {
      title: displayName,
      subtitle: `${ROLE_LABELS[entry.role] ?? "Staff"} — ${guild.name}`,
      body,
      footer: "Pulse — Management",
      actions: [dashboardButton(guild.id, `/management`, "Open Management")],
    });
  }

  return { handleStats, handleInsights, handleManagement };
}

module.exports = { createAnalytics, PERIOD_CHOICES, snowflakeToDate, fmtDuration };

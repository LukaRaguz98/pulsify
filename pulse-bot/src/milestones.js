// Member Milestones & Recognition System (bot side) — PULSIFY-35.
//
// A milestone is a single named threshold on one member metric ("1 year in the
// server", "1,000 messages", "10 hours in voice", "entered 10 giveaways",
// "reached level 25"). The DASHBOARD owns the definitions (the `milestones`
// table); this module is the WRITER of `member_milestones` — a periodic sweep
// evaluates every member against the enabled milestones, records a completion
// row the first time a threshold is crossed, assigns the reward roles,
// announces it, and records a notification. It also tracks scheduled-event
// participation and serves the /milestones command.
//
// The pure helpers at the top MIRROR pulsify-web-app/lib/milestones.ts — keep
// the two in sync (same as giveaways.js ↔ lib/giveaways.ts, leveling.js ↔
// lib/leveling.ts). The milestoneContainer embed builder must also match the
// dashboard's test embed in app/dashboard/[guildId]/milestones/actions.ts.

const { MessageFlags, Events } = require("discord.js");
const { recordNotification } = require("./notifications");
const { fetchImageCached } = require("./image-cache");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  replyNotice,
  editNotice,
  text,
  divider,
} = require("./commands");

// ── Pure helpers (mirror of lib/milestones.ts) ───────────────────────────────

const MILESTONE_METRICS = [
  "join_age",
  "messages",
  "voice_minutes",
  "events",
  "giveaways",
  "invites",
  "xp",
  "level",
];

const METRIC_META = {
  join_age: { label: "Time in server", unit: "day", icon: "CalendarClock" },
  messages: { label: "Messages sent", unit: "message", icon: "MessageSquare" },
  voice_minutes: { label: "Voice activity", unit: "minute", icon: "Mic" },
  events: { label: "Event participation", unit: "event", icon: "CalendarDays" },
  giveaways: { label: "Giveaway participation", unit: "giveaway", icon: "Gift" },
  invites: { label: "Valid invites", unit: "invite", icon: "UserPlus" },
  xp: { label: "Total XP", unit: "XP", icon: "Sparkles" },
  level: { label: "Level reached", unit: "level", icon: "TrendingUp" },
};

const DEFAULT_MILESTONE_MESSAGE =
  "Congratulations {mention} — you reached the **{milestone}** milestone in {server}!";

const MILESTONE_LIMITS = {
  maxName: 80,
  maxDescription: 300,
  maxMessage: 500,
  maxThreshold: 100_000_000,
  maxRewards: 10,
  maxMilestones: 100,
};

function clampNum(v, min, max, fallback) {
  const num = Number(v);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function isMilestoneMetric(v) {
  return typeof v === "string" && MILESTONE_METRICS.includes(v);
}

function normaliseAnnounce(v) {
  return v === "off" || v === "channel" || v === "dm" ? v : "channel";
}

function normaliseRewards(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    let roleId = "";
    if (typeof r === "string") roleId = r;
    else if (r && typeof r === "object") roleId = String(r.role_id ?? "");
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    out.push({ role_id: roleId });
  }
  return out.slice(0, MILESTONE_LIMITS.maxRewards);
}

function normaliseMilestone(row) {
  const metric = isMilestoneMetric(row.metric) ? row.metric : "messages";
  const message =
    typeof row.message === "string" && row.message.trim()
      ? row.message.slice(0, MILESTONE_LIMITS.maxMessage)
      : DEFAULT_MILESTONE_MESSAGE;
  return {
    id: String(row.id ?? ""),
    guild_id: String(row.guild_id ?? ""),
    name: String(row.name ?? "").slice(0, MILESTONE_LIMITS.maxName) || "Milestone",
    description: row.description ? String(row.description).slice(0, MILESTONE_LIMITS.maxDescription) : null,
    metric,
    threshold: clampNum(row.threshold, 1, MILESTONE_LIMITS.maxThreshold, 1),
    enabled: row.enabled !== false,
    icon: typeof row.icon === "string" && row.icon ? row.icon : METRIC_META[metric].icon,
    rewards: normaliseRewards(row.rewards),
    announce: normaliseAnnounce(row.announce),
    announce_channel_id:
      typeof row.announce_channel_id === "string" && row.announce_channel_id ? row.announce_channel_id : null,
    message,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function metricValue(metrics, metric) {
  switch (metric) {
    case "join_age":
      return metrics.join_age_days;
    case "messages":
      return metrics.messages;
    case "voice_minutes":
      return metrics.voice_minutes;
    case "events":
      return metrics.events;
    case "giveaways":
      return metrics.giveaways;
    case "invites":
      return metrics.invites;
    case "xp":
      return metrics.xp;
    case "level":
      return metrics.level;
    default:
      return 0;
  }
}

function isMet(value, threshold) {
  return value >= threshold;
}

function milestoneProgress(value, threshold) {
  const v = Math.max(0, value);
  const t = Math.max(1, threshold);
  return {
    value: v,
    threshold: t,
    pct: Math.max(0, Math.min(100, Math.round((v / t) * 100))),
    met: v >= t,
    remaining: Math.max(0, t - v),
  };
}

function formatMetricValue(metric, value) {
  const num = Math.max(0, Math.round(value));
  if (metric === "voice_minutes") {
    if (num < 60) return `${num}m`;
    const h = Math.floor(num / 60);
    const m = num % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  if (metric === "join_age") {
    if (num < 30) return `${num}d`;
    if (num < 365) return `${Math.floor(num / 30)}mo`;
    const y = Math.floor(num / 365);
    const mo = Math.floor((num % 365) / 30);
    return mo ? `${y}y ${mo}mo` : `${y}y`;
  }
  if (metric === "level") return `Lvl ${num.toLocaleString()}`;
  return num.toLocaleString();
}

function describeThreshold(metric, threshold) {
  const meta = METRIC_META[metric];
  const num = Math.max(1, Math.round(threshold));
  if (metric === "join_age") return `${formatMetricValue("join_age", num)} in server`;
  if (metric === "voice_minutes") return `${formatMetricValue("voice_minutes", num)} in voice`;
  if (metric === "level") return `Level ${num.toLocaleString()}`;
  if (metric === "xp") return `${num.toLocaleString()} XP`;
  const unit = num === 1 ? meta.unit : `${meta.unit}s`;
  return `${num.toLocaleString()} ${unit}`;
}

// Long, fully-spelled variants (mirror of lib/milestones.ts) — used in embeds so
// the bot reads "7 days" / "10 hours" rather than "7d" / "10h".
function formatMetricValueLong(metric, value) {
  const num = Math.max(0, Math.round(value));
  const plural = (count, unit) => `${count.toLocaleString()} ${unit}${count === 1 ? "" : "s"}`;
  if (metric === "voice_minutes") {
    if (num < 60) return plural(num, "minute");
    const h = Math.floor(num / 60);
    const m = num % 60;
    return m ? `${plural(h, "hour")} ${plural(m, "minute")}` : plural(h, "hour");
  }
  if (metric === "join_age") {
    if (num < 30) return plural(num, "day");
    if (num < 365) return plural(Math.floor(num / 30), "month");
    const y = Math.floor(num / 365);
    const mo = Math.floor((num % 365) / 30);
    return mo ? `${plural(y, "year")} ${plural(mo, "month")}` : plural(y, "year");
  }
  if (metric === "level") return `Level ${num.toLocaleString()}`;
  if (metric === "xp") return `${num.toLocaleString()} XP`;
  return plural(num, METRIC_META[metric].unit);
}

function describeThresholdLong(metric, threshold) {
  const num = Math.max(1, Math.round(threshold));
  if (metric === "join_age") return `${formatMetricValueLong("join_age", num)} in server`;
  if (metric === "voice_minutes") return `${formatMetricValueLong("voice_minutes", num)} in voice`;
  return formatMetricValueLong(metric, num);
}

function renderMilestoneMessage(template, ctx) {
  return String(template ?? "")
    .replace(/\{user\}/g, ctx.user)
    .replace(/\{mention\}/g, ctx.mention)
    .replace(/\{milestone\}/g, ctx.milestone)
    .replace(/\{server\}/g, ctx.server)
    .replace(/\{value\}/g, String(ctx.value));
}

function metricsFromRow(row, joinAgeDays) {
  return {
    join_age_days: Math.max(0, Math.floor(joinAgeDays)),
    messages: Number(row?.messages ?? 0),
    voice_minutes: Math.floor(Number(row?.voice_seconds ?? 0) / 60),
    events: Number(row?.events ?? 0),
    giveaways: Number(row?.giveaways ?? 0),
    invites: Number(row?.invites ?? 0),
    xp: Number(row?.xp ?? 0),
    level: Number(row?.level ?? 0),
  };
}

function computeMilestoneStats(milestones, completions) {
  const counts = new Map();
  const members = new Set();
  for (const c of completions) {
    counts.set(c.milestone_id, (counts.get(c.milestone_id) ?? 0) + 1);
    members.add(c.user_id);
  }
  const byMilestone = milestones
    .map((m) => ({ id: m.id, name: m.name, metric: m.metric, earned: counts.get(m.id) ?? 0 }))
    .sort((a, b) => b.earned - a.earned);
  const mostEarned =
    byMilestone.length > 0 && byMilestone[0].earned > 0
      ? { id: byMilestone[0].id, name: byMilestone[0].name, earned: byMilestone[0].earned }
      : null;
  return {
    total: milestones.length,
    active: milestones.filter((m) => m.enabled).length,
    totalEarned: completions.length,
    membersRecognised: members.size,
    byMilestone,
    mostEarned,
  };
}

/**
 * Fetch the member's milestones rendered as achievement cards (via
 * /api/milestone-cards) as an attachment, or null on failure. `cards` is an
 * array of { n, t, e, p, v }. Mirrors commands.js loadProfileCards — the
 * tinting/rendering lives in the web app so the bot stays a thin client.
 */
async function loadMilestoneCards(colorHex, cards) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const qs = new URLSearchParams({
    color: colorHex.replace("#", ""),
    cards: JSON.stringify(cards),
  });
  // Cached per exact card payload — re-running with the same progress is instant.
  return fetchImageCached(`${appUrl}/api/milestone-cards?${qs.toString()}`, "milestone-cards.png");
}

/**
 * Fetch the full-width accent-tinted "Milestones" banner (via
 * /api/milestone-banner) as an attachment for the bottom of the embed, or null
 * on failure. `name` is the eyebrow (server name). Mirrors commands.js loadBanner.
 */
async function loadMilestoneBanner(colorHex, name) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const qs = new URLSearchParams({ color: colorHex.replace("#", ""), name: name ?? "" });
  // Near-static (only the accent colour + server name vary) → long TTL so it's
  // reused across every /milestones + /profile call for the guild.
  return fetchImageCached(`${appUrl}/api/milestone-banner?${qs.toString()}`, "milestone-banner.png", {
    ttlMs: 24 * 60 * 60 * 1000,
  });
}

// ── Module ─────────────────────────────────────────────────────────────────

const SWEEP_MS = 5 * 60 * 1000; // re-evaluate members against milestones every 5 min

function createMilestones(client, supabase, rewards = null) {
  // guildId -> Milestone[] (all definitions; the sweep filters enabled)
  const configs = new Map();
  let sweepTimer = null;
  let sweeping = false;

  async function loadGuild(guildId) {
    const { data } = await supabase
      .from("milestones")
      .select("*")
      .eq("guild_id", guildId);
    const list = (data ?? []).map(normaliseMilestone);
    configs.set(guildId, list);
    return list;
  }

  async function getGuildMilestones(guildId) {
    if (configs.has(guildId)) return configs.get(guildId);
    return loadGuild(guildId);
  }

  // ── Per-member metrics (single member — used by /milestones) ───────────────

  async function getMemberMetrics(guild, member) {
    const userId = member.id;
    const [profile, gw, evt, lvl, inv] = await Promise.all([
      supabase
        .rpc("get_member_profile_stats", { p_guild_id: guild.id, p_user_id: userId, p_since: null })
        .then((r) => (Array.isArray(r.data) ? r.data[0] : r.data) ?? null)
        .catch(() => null),
      supabase
        .from("giveaway_entries")
        .select("user_id", { count: "exact", head: true })
        .eq("guild_id", guild.id)
        .eq("user_id", userId)
        .then((r) => r.count ?? 0)
        .catch(() => 0),
      supabase
        .from("member_event_participation")
        .select("user_id", { count: "exact", head: true })
        .eq("guild_id", guild.id)
        .eq("user_id", userId)
        .then((r) => r.count ?? 0)
        .catch(() => 0),
      supabase
        .from("member_levels")
        .select("xp, level")
        .eq("guild_id", guild.id)
        .eq("user_id", userId)
        .maybeSingle()
        .then((r) => r.data ?? null)
        .catch(() => null),
      // Valid invites this member has brought in (as inviter). Bonus credits
      // are added below so a manual credit still moves an invite milestone.
      supabase
        .from("invited_members")
        .select("user_id", { count: "exact", head: true })
        .eq("guild_id", guild.id)
        .eq("inviter_id", userId)
        .eq("status", "valid")
        .then((r) => r.count ?? 0)
        .catch(() => 0),
    ]);

    let bonusInvites = 0;
    try {
      const { data: adj } = await supabase
        .from("invite_adjustments")
        .select("amount")
        .eq("guild_id", guild.id)
        .eq("user_id", userId)
        .eq("kind", "bonus");
      bonusInvites = (adj ?? []).reduce((s, a) => s + (a.amount ?? 0), 0);
    } catch {
      /* invite tracking not set up — treat as zero */
    }

    const joinAgeDays = member.joinedTimestamp
      ? (Date.now() - member.joinedTimestamp) / 86_400_000
      : 0;

    return {
      join_age_days: Math.max(0, Math.floor(joinAgeDays)),
      messages: Number(profile?.message_count ?? 0),
      voice_minutes: Math.floor(Number(profile?.voice_seconds ?? 0) / 60),
      events: Number(evt),
      giveaways: Number(gw),
      invites: Math.max(0, Number(inv) + bonusInvites),
      xp: Number(lvl?.xp ?? 0),
      level: Number(lvl?.level ?? 0),
    };
  }

  // ── Embeds ──────────────────────────────────────────────────────────────────

  async function milestoneContainer(guild, member, milestone, value) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const rendered = renderMilestoneMessage(milestone.message || DEFAULT_MILESTONE_MESSAGE, {
      user: member.displayName,
      mention: `<@${member.id}>`,
      milestone: milestone.name,
      server: guild.name,
      value: formatMetricValueLong(milestone.metric, value),
    });
    const body = [text(rendered)];
    if (milestone.rewards.length > 0) {
      body.push(text(`-# Unlocked: ${milestone.rewards.map((r) => `<@&${r.role_id}>`).join(" ")}`));
    }
    // No header badge: the unlock message is a sentence (plus the reward roles),
    // so a thumbnail would dominate it — see the embed conventions on
    // buildPulseContainer. The milestone name is the heading and carries it.
    const container = buildPulseContainer({
      colorHex,
      title: milestone.name,
      subtitle: member.displayName,
      body,
      footer: "Pulse — Milestone",
    });
    return { container, files: [] };
  }

  async function announce(guild, member, milestone, value) {
    if (milestone.announce === "off") return;
    const { container, files } = await milestoneContainer(guild, member, milestone, value);
    const payload = {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: { users: [member.id] },
      files,
    };
    try {
      if (milestone.announce === "dm") {
        await member.send(payload).catch(() => {});
        return;
      }
      if (milestone.announce_channel_id) {
        const channel = await client.channels.fetch(milestone.announce_channel_id).catch(() => null);
        if (channel?.isTextBased?.()) await channel.send(payload).catch(() => {});
      }
    } catch {
      /* best-effort — an announcement failure must never break tracking */
    }
  }

  // ── Reward roles (additive — milestones never remove a role) ────────────────

  async function applyRewardRoles(member, milestone) {
    for (const reward of milestone.rewards) {
      try {
        if (!member.roles.cache.has(reward.role_id)) {
          await member.roles.add(reward.role_id, `Pulse milestone: ${milestone.name}`).catch(() => {});
        }
      } catch {
        /* role above the bot / missing perms — skip silently */
      }
    }
  }

  // ── Completion ────────────────────────────────────────────────────────────────

  async function completeMilestone(guild, member, milestone, value) {
    // Idempotent insert — the unique (milestone_id, user_id) makes a re-trigger a
    // no-op. We only celebrate when OUR insert was the one that created the row.
    const { error } = await supabase.from("member_milestones").insert({
      guild_id: guild.id,
      milestone_id: milestone.id,
      user_id: member.id,
      user_name: member.displayName,
      value: Math.round(value),
      completed_at: new Date().toISOString(),
    });
    if (error) {
      // 23505 = already completed (raced or seen before) — nothing to do.
      if (error.code !== "23505") {
        console.warn("[Pulse] milestone insert failed:", error.message);
      }
      return false;
    }

    // Milestones feed the global economy: a completion earns configurable coins
    // (fire-and-forget — recognition never blocks on the economy).
    if (rewards?.awardMilestone) {
      void rewards.awardMilestone(guild, member.id, member.displayName, milestone.name);
    }

    await applyRewardRoles(member, milestone);
    await announce(guild, member, milestone, value);
    await recordNotification(supabase, {
      guildId: guild.id,
      type: "milestone_reached",
      title: `${member.displayName} reached "${milestone.name}"`,
      body:
        milestone.rewards.length > 0
          ? `Unlocked ${milestone.rewards.length} reward role${milestone.rewards.length === 1 ? "" : "s"}.`
          : null,
      link: `/dashboard/${guild.id}/milestones`,
      targetId: member.id,
      targetName: member.displayName,
      metadata: { milestone_id: milestone.id, metric: milestone.metric, value: Math.round(value) },
    });
    return true;
  }

  // ── Event participation (called from index.js) ──────────────────────────────

  async function recordEventParticipation(guild, member, eventId) {
    try {
      if (!guild || !member || !eventId || member.user?.bot) return;
      await supabase
        .from("member_event_participation")
        .insert({
          guild_id: guild.id,
          user_id: member.id,
          event_id: String(eventId),
          joined_at: new Date().toISOString(),
        })
        .then(() => {}, () => {}); // ignore unique-violation re-joins
    } catch (err) {
      console.warn("[Pulse] recordEventParticipation failed:", err.message);
    }
  }

  // ── Sweep ─────────────────────────────────────────────────────────────────────

  async function sweepGuild(guild) {
    let defs;
    try {
      defs = (await getGuildMilestones(guild.id)).filter((m) => m.enabled);
    } catch {
      return;
    }
    if (defs.length === 0) return;

    const idsForGuild = defs.map((d) => d.id);

    // Load every completion for this guild's milestones so we can skip already-
    // earned (milestone,user) pairs without a per-member query.
    const completed = new Set();
    try {
      const { data } = await supabase
        .from("member_milestones")
        .select("milestone_id, user_id")
        .eq("guild_id", guild.id)
        .in("milestone_id", idsForGuild);
      for (const r of data ?? []) completed.add(`${r.milestone_id}:${r.user_id}`);
    } catch {
      // If we can't read completions, bail rather than risk duplicate awards
      // (the insert is still idempotent, but skip to be safe + quiet).
      return;
    }

    // One round-trip for every active member's metrics.
    const metricsByUser = new Map();
    try {
      const { data } = await supabase.rpc("get_member_milestone_metrics", { p_guild_id: guild.id });
      for (const row of data ?? []) metricsByUser.set(row.user_id, row);
    } catch {
      /* fall through — members with no row are still evaluated for join_age */
    }

    for (const member of guild.members.cache.values()) {
      if (member.user?.bot) continue;
      const joinAge = member.joinedTimestamp ? (Date.now() - member.joinedTimestamp) / 86_400_000 : 0;
      const metrics = metricsFromRow(metricsByUser.get(member.id), joinAge);
      for (const def of defs) {
        const key = `${def.id}:${member.id}`;
        if (completed.has(key)) continue;
        const value = metricValue(metrics, def.metric);
        if (!isMet(value, def.threshold)) continue;
        const ok = await completeMilestone(guild, member, def, value);
        completed.add(key); // mark regardless so a failed insert isn't retried this pass
        if (!ok) continue;
      }
    }
  }

  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        await sweepGuild(guild);
      }
    } catch (err) {
      console.warn("[Pulse] milestone sweep failed:", err.message);
    } finally {
      sweeping = false;
    }
  }

  /** True if the guild has at least one enabled milestone (cache-only check). */
  function hasEnabledMilestones(guildId) {
    const list = configs.get(guildId);
    return Array.isArray(list) && list.some((m) => m.enabled);
  }

  // ── Milestones "page" (shared by /milestones + the /profile button) ──────────

  // Build the milestones achievement page for a member: which they've earned and
  // which they still need to earn. Paginates at 9 per page (3×3 board).
  // Returns { components, files } ready to reply.
  /**
   * Render an ARBITRARY set of milestone-like entries with the exact /milestones
   * look — the accent-tinted achievement-card image (loadMilestoneCards) plus the
   * banner and the milestone badge — so any surface that shows milestones (e.g.
   * /invite rewards, whose invite milestones are `invites`-metric Member
   * Milestones) renders identically instead of a bespoke text list.
   *
   * `entries` is an array of `{ name, metric, threshold, value, earned }`.
   * Returns `{ files, components }` ready to pass to reply/editReply.
   */
  async function renderMilestoneCards({
    guild,
    title,
    subtitle,
    leadText,
    entries,
    footerLabel = "Pulse — Milestones",
  }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("milestone", colorHex);
    const iconUrl = icon ? `attachment://${icon.name}` : null;
    const files = icon ? [icon] : [];

    // One 3×3 board, like buildMilestonesPage's per-page slice.
    const shown = (entries ?? []).slice(0, 9);
    const cardData = shown.map((e) => ({
      n: e.name,
      t: describeThresholdLong(e.metric, e.threshold),
      e: e.earned ? 1 : 0,
      p: milestoneProgress(e.value, e.threshold).pct,
      v: formatMetricValueLong(e.metric, e.value),
    }));
    const [cardsImg, bannerImg] = await Promise.all([
      loadMilestoneCards(colorHex, cardData),
      loadMilestoneBanner(colorHex, guild.name),
    ]);

    const body = [];
    if (leadText) body.push(text(leadText));
    if (cardsImg) {
      body.push({ type: 12, items: [{ media: { url: "attachment://milestone-cards.png" } }] });
      files.push(cardsImg);
    } else {
      // Text fallback (same shape as buildMilestonesPage's) when the image fails.
      body.push(divider());
      body.push(
        text(
          shown
            .map((e) =>
              e.earned
                ? `**${e.name}** — ${describeThresholdLong(e.metric, e.threshold)} *(earned)*`
                : `**${e.name}** — ${formatMetricValueLong(e.metric, e.value)} / ` +
                  `${describeThresholdLong(e.metric, e.threshold)} (${milestoneProgress(e.value, e.threshold).pct}%)`,
            )
            .join("\n"),
        ),
      );
    }
    if (bannerImg) {
      body.push({ type: 12, items: [{ media: { url: "attachment://milestone-banner.png" } }] });
      files.push(bannerImg);
    }

    return {
      files,
      components: [
        buildPulseContainer({
          iconUrl,
          colorHex,
          title,
          subtitle,
          body,
          footer: footerLabel,
          noSpacer: !!(cardsImg || bannerImg),
        }),
      ],
    };
  }

  async function buildMilestonesPage(guild, member, isSelf, page = 0) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("milestone", colorHex);
    const iconUrl = icon ? `attachment://${icon.name}` : member.displayAvatarURL({ size: 128 });
    const files = icon ? [icon] : [];
    const title = isSelf ? "Your milestones" : `${member.displayName}'s milestones`;

    const defs = (await getGuildMilestones(guild.id)).filter((m) => m.enabled);
    if (defs.length === 0) {
      return {
        files,
        components: [
          buildPulseContainer({
            iconUrl,
            colorHex,
            title,
            subtitle: guild.name,
            body: [text("This server hasn't set up any milestones yet.")],
            footer: "Pulse — Milestones",
          }),
        ],
      };
    }

    const [metrics, earnedRows] = await Promise.all([
      getMemberMetrics(guild, member),
      supabase
        .from("member_milestones")
        .select("milestone_id")
        .eq("guild_id", guild.id)
        .eq("user_id", member.id)
        .then((r) => r.data ?? [])
        .catch(() => []),
    ]);
    const earnedIds = new Set(earnedRows.map((r) => r.milestone_id));

    const earned = [];
    const inProgress = [];
    for (const def of defs) {
      const value = metricValue(metrics, def.metric);
      const prog = milestoneProgress(value, def.threshold);
      if (earnedIds.has(def.id) || prog.met) earned.push({ def, prog, value });
      else inProgress.push({ def, prog, value });
    }
    inProgress.sort((a, b) => b.prog.pct - a.prog.pct); // nearest first

    // Unlocked first, then closest-to-complete. Paginate at 9 (a 3×3 board) so
    // servers with many milestones can flip through them with Prev/Next.
    const ordered = [...earned, ...inProgress];
    const PER_PAGE = 9;
    const totalPages = Math.max(1, Math.ceil(ordered.length / PER_PAGE));
    const safePage = Math.max(0, Math.min(Math.floor(page) || 0, totalPages - 1));
    const pageItems = ordered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

    const isItemEarned = (it) => earnedIds.has(it.def.id) || it.prog.met;

    // Render this page's milestones as achievement cards (an image, like
    // /profile's field cards) so the embed reads like the dashboard.
    const cardData = pageItems.map((it) => ({
      n: it.def.name,
      t: describeThresholdLong(it.def.metric, it.def.threshold),
      e: isItemEarned(it) ? 1 : 0,
      p: it.prog.pct,
      v: formatMetricValueLong(it.def.metric, it.value),
    }));
    const [cardsImg, bannerImg] = await Promise.all([
      loadMilestoneCards(colorHex, cardData),
      loadMilestoneBanner(colorHex, guild.name),
    ]);

    const body = [];
    const pageLabel = totalPages > 1 ? ` — Page ${safePage + 1}/${totalPages}` : "";
    body.push(text(`Earned **${earned.length}** of **${defs.length}** milestones.${pageLabel}`));

    if (cardsImg) {
      // Image carries the per-milestone detail; keep the text body minimal.
      body.push({ type: 12, items: [{ media: { url: "attachment://milestone-cards.png" } }] });
      files.push(cardsImg);
    } else {
      // Text fallback (this page's items) when the image can't be generated.
      body.push(divider());
      body.push(
        text(
          pageItems
            .map((it) =>
              isItemEarned(it)
                ? `**${it.def.name}** — ${describeThresholdLong(it.def.metric, it.def.threshold)} *(earned)*`
                : `**${it.def.name}** — ${formatMetricValueLong(it.def.metric, it.value)} / ` +
                  `${describeThresholdLong(it.def.metric, it.def.threshold)} (${it.prog.pct}%)`,
            )
            .join("\n"),
        ),
      );
    }

    // Prev/Next pagination row (only when there's more than one page).
    if (totalPages > 1) {
      body.push({
        type: 1,
        components: [
          { type: 2, style: 2, label: "Previous", custom_id: `ms:pg:${member.id}:${safePage - 1}`, disabled: safePage <= 0 },
          { type: 2, style: 2, label: "Next", custom_id: `ms:pg:${member.id}:${safePage + 1}`, disabled: safePage >= totalPages - 1 },
        ],
      });
    }

    // Full-width accent banner at the very bottom (no divider above it, like
    // /profile's banner).
    if (bannerImg) {
      body.push({ type: 12, items: [{ media: { url: "attachment://milestone-banner.png" } }] });
      files.push(bannerImg);
    }

    return {
      files,
      components: [
        buildPulseContainer({
          iconUrl,
          colorHex,
          title,
          subtitle: guild.name,
          body,
          footer: "Pulse — Milestones",
          // A full-width image defines the width; skip the spacer (like /profile).
          noSpacer: !!(cardsImg || bannerImg),
        }),
      ],
    };
  }

  // ── /milestones command (delegated from commands.js execute) ────────────────

  async function handleMilestonesCommand({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const user = interaction.options.getUser("user") ?? interaction.user;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await editNotice(interaction, "That member isn't in this server.");
      return;
    }
    const page = await buildMilestonesPage(guild, member, user.id === interaction.user.id);
    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: page.components,
      files: page.files,
    });
  }

  // ── Interaction routing (our own listener; index.js owns chat-input) ─────────
  // Handles the "Milestones" button on /profile (`ms:prof:<userId>` — opens the
  // page as a private follow-up) and the embed's Prev/Next pagination
  // (`ms:pg:<userId>:<page>` — edits the message in place).

  async function onInteraction(interaction) {
    try {
      if (!interaction.isButton()) return;
      const id = interaction.customId;
      if (!id.startsWith("ms:")) return;
      const [, action, userId, pageArg] = id.split(":");
      if ((action !== "prof" && action !== "pg") || !userId) return;
      const guild = interaction.guild;
      if (!guild) return;

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await replyNotice(interaction, "That member isn't in this server.")
          .catch(() => {});
        return;
      }
      const isSelf = userId === interaction.user.id;

      if (action === "pg") {
        // Page flip: rebuild and edit the existing message in place. Clear old
        // attachments so the new page's images replace them cleanly.
        await interaction.deferUpdate();
        const page = await buildMilestonesPage(guild, member, isSelf, Number(pageArg) || 0);
        await interaction.editReply({
          flags: MessageFlags.IsComponentsV2,
          components: page.components,
          files: page.files,
          attachments: [],
        });
        return;
      }

      // action === "prof": open page 0 as a private follow-up.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const page = await buildMilestonesPage(guild, member, isSelf, 0);
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: page.components,
        files: page.files,
      });
    } catch (err) {
      console.error("[Pulse] Milestone interaction failed:", err.message);
      if (interaction && !interaction.replied && !interaction.deferred) {
        await replyNotice(interaction, "Something went wrong.").catch(() => {});
      }
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async function reload() {
    const { data, error } = await supabase.from("milestones").select("*");
    if (error) {
      console.warn("[Pulse] milestones load failed:", error.message);
      return;
    }
    configs.clear();
    for (const row of data ?? []) {
      const m = normaliseMilestone(row);
      const list = configs.get(m.guild_id) ?? [];
      list.push(m);
      configs.set(m.guild_id, list);
    }
    const count = (data ?? []).length;
    console.log(`[Pulse] Loaded ${count} milestone(s) across ${configs.size} guild(s).`);
  }

  function subscribe() {
    supabase
      .channel("milestones-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "milestones" }, (payload) => {
        const guildId = payload.new?.guild_id ?? payload.old?.guild_id;
        if (!guildId) return;
        // Refetch the guild's definitions so the cache reflects the change
        // (covers insert/update/delete uniformly).
        void loadGuild(guildId);
      })
      .subscribe();
  }

  async function start() {
    await reload();
    subscribe();
    client.on(Events.InteractionCreate, onInteraction);
    // First sweep a little after ready so the member cache is warm (mirrors the
    // leveling voice tick's startup delay), then every SWEEP_MS.
    setTimeout(() => {
      void sweep();
      sweepTimer = setInterval(() => void sweep(), SWEEP_MS);
      if (sweepTimer.unref) sweepTimer.unref();
    }, 20_000);
    console.log("[Pulse] Milestones system started.");
  }

  return {
    start,
    reload,
    sweep,
    recordEventParticipation,
    handleMilestonesCommand,
    hasEnabledMilestones,
    // Reusable /milestones-look renderer for other surfaces (e.g. /invite rewards).
    renderMilestoneCards,
  };
}

module.exports = {
  createMilestones,
  // Pure helpers exported for unit tests + reuse.
  MILESTONE_METRICS,
  METRIC_META,
  DEFAULT_MILESTONE_MESSAGE,
  MILESTONE_LIMITS,
  isMilestoneMetric,
  normaliseRewards,
  normaliseMilestone,
  metricValue,
  isMet,
  milestoneProgress,
  formatMetricValue,
  formatMetricValueLong,
  describeThreshold,
  describeThresholdLong,
  renderMilestoneMessage,
  metricsFromRow,
  computeMilestoneStats,
};

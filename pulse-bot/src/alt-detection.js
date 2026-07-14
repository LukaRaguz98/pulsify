// Alt Risk Detection — bot side (PULSIFY-59).
//
// Two jobs:
//
//   1. /alt-check — a moderator asks about an account and gets the same report
//      the dashboard shows: the 0-100 Alt Risk Score, the factors behind it, the
//      accounts that may be related (with a confidence percentage) and a one-line
//      recommendation. Every check is recorded in alt_lookups, so the dashboard's
//      "Recent lookups" list is the audit trail for both surfaces.
//
//   2. Join-time flagging — when an account joins and scores High or Critical,
//      Pulse opens an investigation for it automatically. That's what fills the
//      dashboard's queue: by the time a moderator looks, the suspicious joins of
//      the last week are already waiting for them, in order.
//
// The scoring + correlation maths MIRRORS pulsify-web-app/lib/alt-detection.ts —
// keep the two in sync (same weights, same thresholds), the way birthdays.js and
// lib/birthdays.ts are. If they drift, /alt-check and the dashboard will disagree
// about the same account, which is worse than either being slightly wrong.

const { Events, MessageFlags } = require("discord.js");
const { recordNotification } = require("./notifications");
const { buildPulseContainer, getPulseColor, loadPulseIcon, text, divider } = require("./commands");

// ── Risk model (mirror of lib/alt-detection.ts) ───────────────────────────────

const RISK_THRESHOLDS = { low: 0, moderate: 25, high: 50, critical: 75 };

const RISK_META = {
  low: { label: "Low", blurb: "Looks like an established account." },
  moderate: { label: "Moderate", blurb: "A few alt indicators — nothing conclusive." },
  high: { label: "High", blurb: "Several indicators line up. Worth a review." },
  critical: { label: "Critical", blurb: "Matches the profile of a throwaway or evasion alt." },
};

const RECOMMENDATION = {
  low: "No action needed — this account reads as an established member.",
  moderate: "Nothing conclusive. Keep the account under normal moderation and revisit if behaviour changes.",
  high: "Worth a review. Several alt indicators line up — check the potential linked accounts before acting.",
  critical: "Investigate. This account matches the profile of a throwaway or ban-evasion alt; confirm against the linked accounts.",
};

const TENURE_GRACE_ACTIVITY_DAYS = 2;
const TENURE_GRACE_ONBOARDING_DAYS = 1;
const ECONOMY_ESTABLISHED_COINS = 250;

const MIN_LINK_CONFIDENCE = 35;
const MAX_AUTO_CONFIDENCE = 95;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function riskLevelForScore(score) {
  if (score >= RISK_THRESHOLDS.critical) return "critical";
  if (score >= RISK_THRESHOLDS.high) return "high";
  if (score >= RISK_THRESHOLDS.moderate) return "moderate";
  return "low";
}

function isActionable(level) {
  return level === "high" || level === "critical";
}

function daysBetween(iso, now) {
  if (!iso) return 0;
  const ms = now.getTime() - new Date(iso).getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

function hoursBetween(iso, now) {
  if (!iso) return 0;
  const ms = now.getTime() - new Date(iso).getTime();
  return ms <= 0 ? 0 : ms / 3_600_000;
}

/** Score an account. `input` mirrors AltRiskInput in lib/alt-detection.ts. */
function computeAltRisk(input) {
  const now = input.now ?? new Date();
  const signals = [];
  const add = (id, label, detail, points) => {
    signals.push({ id, label, detail, points, tone: points >= 0 ? "risk" : "mitigating" });
  };

  const accountAgeDays = daysBetween(input.accountCreatedAt, now);
  const knownAge = input.accountCreatedAt != null;
  const tenureDays = daysBetween(input.joinedAt, now);
  const joinHours = hoursBetween(input.joinedAt, now);
  const isMember = input.joinedAt != null;

  if (knownAge) {
    if (accountAgeDays < 2) {
      add("new_account", "Brand-new account", `Created ${accountAgeDays === 0 ? "today" : "yesterday"}.`, 22);
    } else if (accountAgeDays < 7) {
      add("new_account", "Very new account", `Created ${accountAgeDays} days ago.`, 16);
    } else if (accountAgeDays < 30) {
      add("new_account", "New account", `Created ${accountAgeDays} days ago.`, 10);
    } else if (accountAgeDays < 90) {
      add("new_account", "Young account", `Created ${accountAgeDays} days ago.`, 5);
    } else if (accountAgeDays >= 365) {
      const years = Math.floor(accountAgeDays / 365);
      add("established_account", "Established account", `Over ${years} year${years > 1 ? "s" : ""} old.`, -8);
    }
  }

  if (isMember) {
    if (joinHours < 24) {
      add("recent_join", "Joined today", "Joined the server within the last 24 hours.", 5);
    } else if (tenureDays < 7) {
      add("recent_join", "Recent join", `Joined ${tenureDays} day${tenureDays === 1 ? "" : "s"} ago.`, 3);
    }
    if (knownAge && accountAgeDays < 30 && joinHours < 48) {
      add(
        "fresh_account_fresh_join",
        "Created shortly before joining",
        "The account was made days before it joined this server.",
        6,
      );
    }
  }

  if (!input.hasAvatar) {
    add("default_avatar", "Default avatar", "Still using a Discord default avatar.", 8);
  }

  const totalActivity = input.messages + Math.floor(input.voiceSeconds / 60);
  if (!isMember || tenureDays >= TENURE_GRACE_ACTIVITY_DAYS) {
    if (totalActivity === 0) {
      add("no_activity", "No activity", "Has never sent a message or joined voice here.", 10);
    } else if (input.messages < 10) {
      add("low_activity", "Barely active", `Only ${input.messages} message${input.messages === 1 ? "" : "s"} sent.`, 5);
    }
  }
  if (input.messages >= 250) {
    add("established_activity", "Long activity history", `${input.messages.toLocaleString()} messages sent here.`, -10);
  } else if (input.messages >= 50) {
    add("established_activity", "Active member", `${input.messages} messages sent here.`, -6);
  }

  const infractions = input.warnings + input.timeouts;
  if (input.bans > 0 || input.kicks > 0) {
    const parts = [];
    if (input.bans > 0) parts.push(`${input.bans} ban${input.bans > 1 ? "s" : ""}`);
    if (input.kicks > 0) parts.push(`${input.kicks} kick${input.kicks > 1 ? "s" : ""}`);
    add("moderation_history", "Removed before", `${parts.join(" and ")} on record in this server.`, 20);
  } else if (infractions >= 3) {
    add("moderation_history", "Repeat infractions", `${infractions} warnings/timeouts on record.`, 12);
  } else if (infractions >= 1) {
    add("moderation_history", "Moderation history", `${infractions} warning/timeout on record.`, 6);
  }

  if (input.reputation >= 70) {
    add("trusted_reputation", "Trusted across Pulse", `Global reputation of ${input.reputation}.`, -10);
  } else if (input.reputation < 20) {
    add("low_reputation", "Low reputation", `Global reputation of ${input.reputation}.`, 6);
  } else if (input.reputation < 40) {
    add("low_reputation", "Below-average reputation", `Global reputation of ${input.reputation}.`, 3);
  }

  if (input.coinBalance === 0 && input.economyLifetime === 0) {
    add("no_economy", "No economy footprint", "No Pulse Coins ever earned or spent, on any server.", 4);
  } else if (input.economyLifetime >= ECONOMY_ESTABLISHED_COINS) {
    add(
      "economy_activity",
      "Economy footprint",
      `${input.economyLifetime.toLocaleString()} coins earned and spent across Pulse.`,
      -5,
    );
  }

  if (input.giveawayEntries > 0 && input.messages < 5 && (!isMember || tenureDays >= 1)) {
    add(
      "giveaway_farming",
      "Enters giveaways, never talks",
      `${input.giveawayEntries} giveaway ${input.giveawayEntries === 1 ? "entry" : "entries"} with almost no messages.`,
      8,
    );
  }

  if (input.applications > 0) {
    add("application_history", "Applied to the server", `${input.applications} application${input.applications > 1 ? "s" : ""} submitted.`, -4);
  }

  if (input.onboardingEnabled && (!isMember || tenureDays >= TENURE_GRACE_ONBOARDING_DAYS)) {
    if (input.onboardingCompleted) {
      add("onboarding_complete", "Completed onboarding", "Went through the server onboarding.", -4);
    } else {
      add("onboarding_incomplete", "Skipped onboarding", "Never completed the server onboarding.", 6);
    }
    if (input.onboardingVerified) {
      add("verified", "Verified member", "Passed the server verification step.", -5);
    } else {
      add("unverified", "Not verified", "Has not passed the server verification step.", 5);
    }
  }

  if (input.guardFlags > 0) {
    const points = clamp(6 + 3 * (input.guardFlags - 1), 6, 14);
    add("guard_flags", "Pulse Guard flags", `${input.guardFlags} message${input.guardFlags > 1 ? "s" : ""} flagged by Pulse Guard.`, points);
  }
  if (input.securityFlags > 0) {
    add("security_flags", "Security detections", `Named in ${input.securityFlags} abuse detection${input.securityFlags > 1 ? "s" : ""}.`, 10);
  }
  if (input.priorConfirmedAlt) {
    add("prior_alt", "Previously confirmed as an alt", "A closed investigation in this server confirmed this account.", 30);
  }
  if (input.manualLinks > 0) {
    add("linked_accounts", "Linked by a moderator", `Manually linked to ${input.manualLinks} other account${input.manualLinks > 1 ? "s" : ""}.`, 12);
  }

  const riskPoints = signals.filter((s) => s.points > 0).reduce((sum, s) => sum + s.points, 0);
  const mitigatingPoints = signals.filter((s) => s.points < 0).reduce((sum, s) => sum - s.points, 0);
  const score = clamp(Math.round(riskPoints - mitigatingPoints), 0, 100);
  const level = riskLevelForScore(score);

  signals.sort((a, b) => b.points - a.points);

  return {
    score,
    level,
    label: RISK_META[level].label,
    signals,
    riskPoints,
    mitigatingPoints,
    recommendation: RECOMMENDATION[level],
  };
}

// ── Name similarity (mirror) ──────────────────────────────────────────────────

function normaliseName(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nameStem(name) {
  return normaliseName(name).replace(/\d+$/, "");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length];
}

function nameSimilarity(a, b) {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return clamp(1 - levenshtein(x, y) / Math.max(x.length, y.length), 0, 1);
}

function sharesNameStem(a, b) {
  const sa = nameStem(a);
  const sb = nameStem(b);
  if (sa.length < 3 || sb.length < 3) return false;
  if (sa !== sb) return false;
  return normaliseName(a) !== normaliseName(b);
}

function minutesApart(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000;
}

/**
 * Correlate the subject against one candidate (mirror of correlateAccount).
 * The bot's /alt-check works from the data it can get cheaply — names, join
 * times, account ages, moderator-asserted links and coin transfers. The hourly
 * activity-pattern indicator is dashboard-only: it costs an extra aggregate per
 * lookup and the embed has no room to explain it.
 */
function correlateAccount(subject, candidate) {
  if (candidate.userId === subject.userId) return null;

  if (candidate.manualLink) {
    return {
      userId: candidate.userId,
      username: candidate.username,
      confidence: clamp(Math.round(candidate.manualLink.confidence), 0, 100),
      indicators: [{ id: "manual", label: "Linked by a moderator" }],
      risk: candidate.risk,
      manual: true,
    };
  }

  const indicators = [];
  const similarity = nameSimilarity(subject.username, candidate.username);
  if (sharesNameStem(subject.username, candidate.username)) {
    indicators.push({ id: "username", label: "Numbered variant of the same name", weight: 0.5 });
  } else if (similarity >= 0.85) {
    indicators.push({ id: "username", label: `Near-identical username (${Math.round(similarity * 100)}%)`, weight: 0.55 });
  } else if (similarity >= 0.72) {
    indicators.push({ id: "username", label: `Similar username (${Math.round(similarity * 100)}%)`, weight: 0.35 });
  }

  const joinGap = minutesApart(subject.joinedAt, candidate.joinedAt);
  if (joinGap <= 5) {
    indicators.push({ id: "join_time", label: "Joined at the same moment", weight: 0.45 });
  } else if (joinGap <= 60) {
    indicators.push({ id: "join_time", label: "Joined around the same time", weight: 0.3 });
  } else if (joinGap <= 1440) {
    indicators.push({ id: "join_time", label: "Joined the same day", weight: 0.12 });
  }

  const createdGap = minutesApart(subject.accountCreatedAt, candidate.accountCreatedAt);
  if (createdGap <= 60) {
    indicators.push({ id: "account_age", label: "Accounts created together", weight: 0.4 });
  } else if (createdGap <= 1440) {
    indicators.push({ id: "account_age", label: "Accounts created the same day", weight: 0.25 });
  } else if (createdGap <= 10080) {
    indicators.push({ id: "account_age", label: "Accounts created the same week", weight: 0.1 });
  }

  if (candidate.sharedModeration) {
    indicators.push(
      candidate.sharedModeration.namesSubject
        ? { id: "moderation", label: "Named in the same moderation case", weight: 0.6 }
        : { id: "moderation", label: "Shared moderation history", weight: 0.35 },
    );
  }

  if (candidate.sharedEconomy >= 3) {
    indicators.push({ id: "economy", label: `${candidate.sharedEconomy} coin transfers between them`, weight: 0.4 });
  } else if (candidate.sharedEconomy >= 1) {
    indicators.push({ id: "economy", label: "Coin transfers between them", weight: 0.25 });
  }

  if (indicators.length === 0) return null;

  const combined = 1 - indicators.reduce((acc, i) => acc * (1 - i.weight), 1);
  const confidence = Math.min(MAX_AUTO_CONFIDENCE, Math.round(combined * 100));
  const strongest = Math.max(...indicators.map((i) => i.weight));
  if (confidence < MIN_LINK_CONFIDENCE) return null;
  if (indicators.length < 2 && strongest < 0.5) return null;

  indicators.sort((a, b) => b.weight - a.weight);

  return { userId: candidate.userId, username: candidate.username, confidence, indicators, risk: candidate.risk, manual: false };
}

// ── Module factory ────────────────────────────────────────────────────────────

/** Discord snowflake → creation Date. */
function snowflakeToDate(id) {
  try {
    return new Date(Number((BigInt(id) >> BigInt(22)) + BigInt(1420070400000)));
  } catch {
    return null;
  }
}

function createAltDetection(client, supabase) {
  // ── Signal loading ──
  // One account at a time (unlike the dashboard, which scores a whole guild),
  // so these are narrow point reads rather than guild-wide scans.

  async function loadOnboardingEnabled(guildId) {
    const { data } = await supabase
      .from("guild_settings")
      .select("settings")
      .eq("guild_id", guildId)
      .maybeSingle();
    return Boolean(data?.settings?.member_onboarding?.enabled);
  }

  async function loadSignals(guild, member, userId) {
    const [
      stats,
      infractions,
      globalRep,
      economy,
      giveaways,
      applications,
      onboarding,
      guardFlags,
      securityFlags,
      links,
      priorAlt,
      onboardingEnabled,
    ] = await Promise.all([
      supabase.rpc("get_member_profile_stats", { p_guild_id: guild.id, p_user_id: userId, p_since: null }),
      supabase.rpc("get_guild_members_infractions", { p_guild_id: guild.id }),
      supabase.rpc("get_global_member_reputation", { p_user_id: userId }),
      supabase.from("economy_users").select("balance, lifetime_earned, lifetime_spent").eq("user_id", userId).maybeSingle(),
      supabase.from("giveaway_entries").select("id", { count: "exact", head: true }).eq("guild_id", guild.id).eq("user_id", userId),
      supabase.from("ticket_applications").select("id", { count: "exact", head: true }).eq("guild_id", guild.id).eq("applicant_id", userId),
      supabase.from("onboarding_member_progress").select("status, verified").eq("guild_id", guild.id).eq("user_id", userId).maybeSingle(),
      supabase.from("ai_moderation_events").select("id", { count: "exact", head: true }).eq("guild_id", guild.id).eq("author_id", userId),
      supabase.from("security_events").select("id", { count: "exact", head: true }).eq("guild_id", guild.id).eq("actor_id", userId),
      supabase.from("alt_account_links").select("*").eq("guild_id", guild.id).or(`user_id.eq.${userId},linked_user_id.eq.${userId}`),
      supabase.from("alt_investigations").select("status").eq("guild_id", guild.id).eq("user_id", userId).maybeSingle(),
      loadOnboardingEnabled(guild.id),
    ]);

    const stat = stats.data?.[0] ?? {};
    const infr = (infractions.data ?? []).find((r) => String(r.user_id) === userId) ?? {};
    const rep = globalRep.data?.[0] ?? {};
    const eco = economy.data ?? {};

    // Reputation mirrors lib/reputation.ts — the same 0-100 trust score the
    // dashboard and /profile show, computed across every Pulse server.
    const { computeReputation, daysSince } = require("./reputation");
    const created = snowflakeToDate(userId);
    const reputation = computeReputation({
      accountAgeDays: daysSince(created ? created.toISOString() : null),
      tenureDays: daysSince(rep.first_seen ?? null),
      messages: Number(rep.message_count ?? 0),
      voiceSeconds: Number(rep.voice_seconds ?? 0),
      commands: Number(rep.command_count ?? 0),
      activeChannels: Number(rep.active_channels ?? 0),
      assignableRoles: 0,
      warnings: Number(rep.warnings ?? 0),
      timeouts: Number(rep.timeouts ?? 0),
      kicks: Number(rep.kicks ?? 0),
      bans: Number(rep.bans ?? 0),
    }).score;

    return {
      input: {
        accountCreatedAt: created ? created.toISOString() : null,
        joinedAt: member?.joinedAt ? member.joinedAt.toISOString() : null,
        hasAvatar: Boolean(member?.avatar || member?.user?.avatar),
        messages: Number(stat.message_count ?? 0),
        voiceSeconds: Number(stat.voice_seconds ?? 0),
        warnings: Number(infr.warnings ?? 0),
        timeouts: Number(infr.timeouts ?? 0),
        kicks: Number(infr.kicks ?? 0),
        bans: Number(infr.bans ?? 0),
        reputation,
        coinBalance: Number(eco.balance ?? 0),
        economyLifetime: Number(eco.lifetime_earned ?? 0) + Number(eco.lifetime_spent ?? 0),
        giveawayEntries: giveaways.count ?? 0,
        applications: applications.count ?? 0,
        onboardingEnabled,
        onboardingCompleted: onboarding.data?.status === "completed",
        onboardingVerified: Boolean(onboarding.data?.verified),
        guardFlags: guardFlags.count ?? 0,
        securityFlags: securityFlags.count ?? 0,
        priorConfirmedAlt: ["confirmed", "banned"].includes(priorAlt.data?.status),
        manualLinks: (links.data ?? []).length,
      },
      links: links.data ?? [],
    };
  }

  /**
   * Potential linked accounts for one subject. Deliberately bounded: only members
   * currently in the guild's cache are considered, and only the cheap indicators
   * run (see correlateAccount). The dashboard does the deeper pass.
   */
  async function findLinkedAccounts(guild, subjectMember, subjectId, links, limit = 3) {
    const manualLinks = new Map();
    for (const link of links) {
      const other = link.user_id === subjectId ? link.linked_user_id : link.user_id;
      manualLinks.set(other, { confidence: link.confidence, note: link.note });
    }

    // Coin transfers involving the subject (global — the economy is).
    const { data: transfers } = await supabase
      .from("economy_transactions")
      .select("user_id, counterparty_id")
      .or(`user_id.eq.${subjectId},counterparty_id.eq.${subjectId}`)
      .not("counterparty_id", "is", null)
      .limit(500);
    const sharedEconomy = new Map();
    for (const row of transfers ?? []) {
      const other = row.user_id === subjectId ? row.counterparty_id : row.user_id;
      if (!other || other === subjectId) continue;
      sharedEconomy.set(other, (sharedEconomy.get(other) ?? 0) + 1);
    }

    // Moderation overlap: records that name the subject, or the same moderator
    // actioning both accounts for the same reason.
    const { data: modLogs } = await supabase
      .from("moderation_logs")
      .select("target_user_id, moderator_id, moderator_username, reason")
      .eq("guild_id", guild.id)
      .limit(1000);
    const rows = modLogs ?? [];
    const subjectKeys = new Set(
      rows
        .filter((r) => r.target_user_id === subjectId && r.moderator_id && r.reason)
        .map((r) => `${r.moderator_id}:${String(r.reason).toLowerCase().replace(/\s+/g, " ").trim()}`),
    );
    const subjectNames = [subjectMember?.user?.username, subjectMember?.displayName, subjectId]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    const sharedModeration = new Map();
    for (const row of rows) {
      const target = row.target_user_id;
      if (!target || target === subjectId) continue;
      const reason = String(row.reason ?? "").toLowerCase();
      if (reason && subjectNames.some((n) => n.length >= 3 && reason.includes(n))) {
        sharedModeration.set(target, { namesSubject: true });
        continue;
      }
      if (sharedModeration.get(target)?.namesSubject) continue;
      if (!row.moderator_id || !row.reason) continue;
      const key = `${row.moderator_id}:${String(row.reason).toLowerCase().replace(/\s+/g, " ").trim()}`;
      if (subjectKeys.has(key)) sharedModeration.set(target, { namesSubject: false });
    }

    const subject = {
      userId: subjectId,
      username: subjectMember?.user?.username ?? "",
      accountCreatedAt: snowflakeToDate(subjectId)?.toISOString() ?? null,
      joinedAt: subjectMember?.joinedAt ? subjectMember.joinedAt.toISOString() : null,
    };

    const out = [];
    for (const [, m] of guild.members.cache) {
      if (m.user.bot || m.id === subjectId) continue;
      const link = correlateAccount(subject, {
        userId: m.id,
        username: m.user.username,
        accountCreatedAt: snowflakeToDate(m.id)?.toISOString() ?? null,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        // The candidate's own risk isn't scored here (that's a query per member);
        // the embed shows the confidence and the indicators, which is what a
        // moderator acts on. The dashboard shows each candidate's risk band.
        risk: null,
        sharedModeration: sharedModeration.get(m.id) ?? null,
        sharedEconomy: sharedEconomy.get(m.id) ?? 0,
        manualLink: manualLinks.get(m.id) ?? null,
      });
      if (link) out.push(link);
    }

    return out.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  async function recordLookup(guild, member, userId, risk, actor) {
    await supabase
      .from("alt_lookups")
      .insert({
        guild_id: guild.id,
        user_id: userId,
        user_name: member?.displayName ?? member?.user?.username ?? null,
        risk_score: risk.score,
        risk_level: risk.level,
        source: "command",
        actor_id: actor?.id ?? null,
        actor_name: actor?.username ?? null,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }

  /**
   * Open an investigation for a high/critical account, once. The unique index on
   * (guild, user) makes this idempotent: an account that keeps re-scoring high
   * updates its snapshot rather than piling up cases, and an account a moderator
   * already cleared is never silently reopened.
   */
  async function flagAccount(guild, member, risk, source) {
    const { data: existing } = await supabase
      .from("alt_investigations")
      .select("id, status")
      .eq("guild_id", guild.id)
      .eq("user_id", member.id)
      .maybeSingle();

    const snapshot = {
      user_name: member.displayName,
      risk_score: risk.score,
      risk_level: risk.level,
      signals: risk.signals.filter((s) => s.tone === "risk").map((s) => s.id),
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await supabase.from("alt_investigations").update(snapshot).eq("id", existing.id);
      return false;
    }

    const { error } = await supabase.from("alt_investigations").insert({
      guild_id: guild.id,
      user_id: member.id,
      status: "open",
      source,
      ...snapshot,
    });
    // 23505 = a racing sweep already opened it.
    if (error && error.code !== "23505") {
      console.warn("[Pulse] alt investigation insert failed:", error.message);
      return false;
    }
    if (error) return false;

    await supabase.from("alt_investigation_events").insert({
      guild_id: guild.id,
      user_id: member.id,
      kind: "flag",
      body: `Flagged on join at ${risk.score}/100 (${RISK_META[risk.level].label}).`,
      metadata: { score: risk.score, level: risk.level, signals: snapshot.signals },
    });

    await recordNotification(supabase, {
      guildId: guild.id,
      type: "alt_risk_flagged",
      title: `${member.displayName} joined with ${RISK_META[risk.level].label.toLowerCase()} alt risk`,
      body: risk.signals
        .filter((s) => s.tone === "risk")
        .slice(0, 3)
        .map((s) => s.label)
        .join(" · "),
      link: `/dashboard/${guild.id}/alt-detection?user=${member.id}`,
      targetId: member.id,
      targetName: member.displayName,
      metadata: { score: risk.score, level: risk.level },
    });

    return true;
  }

  // ── Join-time flagging ──────────────────────────────────────────────────────

  async function onMemberJoin(member) {
    if (member.user.bot) return;
    try {
      const { input } = await loadSignals(member.guild, member, member.id);
      const risk = computeAltRisk(input);
      if (!isActionable(risk.level)) return;
      await flagAccount(member.guild, member, risk, "auto");
    } catch (err) {
      console.warn(`[Pulse] alt risk check failed for ${member.id}:`, err.message);
    }
  }

  // ── /alt-check ──────────────────────────────────────────────────────────────

  function formatDate(iso) {
    if (!iso) return "Unknown";
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  function ageLabel(iso) {
    if (!iso) return "";
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days < 1) return "today";
    if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} month${months === 1 ? "" : "s"} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }

  async function handleAltCheckCommand({ interaction, guild, ephemeral = true }) {
    await interaction
      .deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined })
      .catch(() => {});

    const target = interaction.options.getUser("user", true);
    const member = await guild.members.fetch(target.id).catch(() => null);

    const { input, links } = await loadSignals(guild, member, target.id);
    const risk = computeAltRisk(input);
    const linked = await findLinkedAccounts(guild, member, target.id, links).catch(() => []);

    await recordLookup(guild, member, target.id, risk, interaction.user);

    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("safety", colorHex);

    const created = input.accountCreatedAt;
    const body = [];

    // Account summary.
    body.push(
      text(
        [
          `**Account age** — ${formatDate(created)} (${ageLabel(created)})`,
          input.joinedAt
            ? `**Joined** — ${formatDate(input.joinedAt)} (${ageLabel(input.joinedAt)})`
            : "**Joined** — not a member of this server",
        ].join("\n"),
      ),
    );
    body.push(divider());

    // The score.
    body.push(text(`## ${risk.score}/100 — ${RISK_META[risk.level].label} risk`));
    body.push(text(`-# ${RISK_META[risk.level].blurb}`));

    // Risk factors — the ones that ADD risk, which is what a moderator reads for.
    const factors = risk.signals.filter((s) => s.tone === "risk").slice(0, 6);
    if (factors.length > 0) {
      body.push(divider());
      body.push(text("**Risk factors**"));
      // One factor per line, no dash bullets — see the embed conventions on
      // buildPulseContainer. The bold label opens each line instead.
      body.push(text(factors.map((s) => `**${s.label}** — ${s.detail}`).join("\n")));
    }
    const mitigations = risk.signals.filter((s) => s.tone === "mitigating").slice(0, 3);
    if (mitigations.length > 0) {
      body.push(text(`-# In its favour — ${mitigations.map((s) => s.label).join(", ")}`));
    }

    // Potential linked accounts.
    body.push(divider());
    if (linked.length === 0) {
      body.push(text("**Potential linked accounts**"));
      body.push(text("-# None found — no account in this server correlates strongly with this one."));
    } else {
      body.push(text("**Potential linked accounts**"));
      body.push(
        text(
          linked
            .map(
              (l) =>
                `<@${l.userId}> — **${l.confidence}%**${l.manual ? " (linked by a moderator)" : ""}\n-# ${l.indicators
                  .map((i) => i.label)
                  .join(" — ")}`,
            )
            .join("\n"),
        ),
      );
      body.push(text("-# Potential matches, not confirmed alts — Discord exposes no IP or device data."));
    }

    // Recommendation.
    body.push(divider());
    body.push(text(`**Recommendation** — ${risk.recommendation}`));

    const container = buildPulseContainer({
      iconUrl: icon ? `attachment://${icon.name}` : target.displayAvatarURL({ size: 128 }),
      colorHex,
      title: "Alt Risk Check",
      subtitle: member?.displayName ?? target.username,
      body,
      footer: "Pulse — Alt Detection",
    });

    await interaction
      .editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [container],
        files: icon ? [icon] : [],
      })
      .catch(() => {});
  }

  function start() {
    // A joining account is scored once, on arrival — that's when its risk profile
    // matters and when the queue should learn about it.
    client.on(Events.GuildMemberAdd, (member) => void onMemberJoin(member));
    console.log("[Pulse] Alt risk detection started.");
  }

  return { start, handleAltCheckCommand, onMemberJoin, computeAltRisk };
}

module.exports = {
  createAltDetection,
  // Pure helpers exported for reuse + tests.
  computeAltRisk,
  correlateAccount,
  riskLevelForScore,
  isActionable,
  nameSimilarity,
  sharesNameStem,
  normaliseName,
  RISK_THRESHOLDS,
  RISK_META,
  MIN_LINK_CONFIDENCE,
  MAX_AUTO_CONFIDENCE,
};

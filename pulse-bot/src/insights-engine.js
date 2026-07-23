// Server Insights engine — bot side (PULSIFY-61).
//
// A faithful CommonJS mirror of the pure maths in
// pulsify-web-app/lib/insights.ts: trend classification, the current/previous
// window split, the rule-based recommendation engine and the health score
// derived from it. Same reasoning as src/reputation.js ↔ lib/reputation.ts and
// src/feature-gate.js ↔ its web twin — the bot is plain CommonJS in a separate
// package and can't import the TypeScript, so the maths is re-implemented here
// and pinned by tests (test/insights-engine.test.js) so /insights and the
// dashboard's Insights view never disagree on a health score.
//
// Only the parts /insights actually renders are ported: trends, recommendations
// and health. The dashboard's heatmap/series/topChannels payload plumbing stays
// web-side — the signal-gathering that feeds this engine lives in the command
// handler (src/analytics-commands.js), reduced from the same RPCs + Discord data
// the web route uses.
//
// Keep the thresholds, rule ids, ordering and copy in sync with lib/insights.ts.

// ── Trends ───────────────────────────────────────────────────────────────────

const STABLE_THRESHOLD_PCT = 8;
const MAX_CHANGE_PCT = 999;

/**
 * Percentage change of `current` vs `previous`, classified into a direction.
 * A zero/absent previous window makes a ratio undefined, so it's flagged `isNew`
 * ("New") rather than a fake percentage. Mirrors computeTrend().
 */
function computeTrend(current, previous) {
  if (previous <= 0) {
    if (current <= 0) return { direction: "stable", changePct: 0 };
    return { direction: "increasing", changePct: 0, isNew: true };
  }
  const raw = Math.round(((current - previous) / previous) * 100);
  const changePct = Math.max(-MAX_CHANGE_PCT, Math.min(MAX_CHANGE_PCT, raw));
  if (Math.abs(changePct) < STABLE_THRESHOLD_PCT) return { direction: "stable", changePct };
  return { direction: changePct > 0 ? "increasing" : "decreasing", changePct };
}

function emptyTotals() {
  return { messages: 0, joins: 0, leaves: 0, commands: 0, mod_actions: 0, voice_seconds: 0 };
}

function addPoint(acc, p) {
  acc.messages += Number(p.messages);
  acc.joins += Number(p.joins);
  acc.leaves += Number(p.leaves);
  acc.commands += Number(p.commands);
  acc.mod_actions += Number(p.mod_actions);
  acc.voice_seconds += Number(p.voice_seconds);
}

/**
 * Split a 2×window daily timeseries into the most recent `windowDays`
 * ("current") and the window immediately before it ("previous"). Buckets are
 * placed by their own timestamp so gaps count as zero. Mirrors splitWindow().
 */
function splitWindow(series, windowDays, now = Date.now()) {
  const windowMs = windowDays * 86_400_000;
  const cutoff = now - windowMs;
  const floor = now - windowMs * 2;
  const current = emptyTotals();
  const previous = emptyTotals();
  for (const p of series) {
    const t = new Date(p.bucket).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= cutoff) addPoint(current, p);
    else if (t >= floor) addPoint(previous, p);
  }
  return { current, previous };
}

function computeTrends(current, previous) {
  return {
    messages: computeTrend(current.messages, previous.messages),
    voice_seconds: computeTrend(current.voice_seconds, previous.voice_seconds),
    joins: computeTrend(current.joins, previous.joins),
    netGrowth: computeTrend(current.joins - current.leaves, previous.joins - previous.leaves),
    mod_actions: computeTrend(current.mod_actions, previous.mod_actions),
    commands: computeTrend(current.commands, previous.commands),
  };
}

// ── Recommendation metadata ──────────────────────────────────────────────────

const CATEGORY_ORDER = {
  growth: 0,
  activity: 1,
  moderation: 2,
  security: 3,
  optimization: 4,
};

const SEVERITY_RANK = {
  critical: 0,
  warning: 1,
  suggestion: 2,
  positive: 3,
};

// ── Recommendation thresholds (mirror lib/insights.ts) ───────────────────────

const MOD_SPIKE_MIN_ACTIONS = 5;
const MOD_SPIKE_PCT = 50;
const VOICE_SURGE_PCT = 25;
const ENGAGEMENT_DROP_PCT = 20;
const MAX_DANGEROUS_ROLE_CARDS = 4;
const BEST_TIME_MIN_MESSAGES = 20;

const WEEKDAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function hourLabel(hour) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function pctLabel(t) {
  const sign = t.changePct > 0 ? "+" : "";
  return `${sign}${t.changePct}%`;
}

function listPerms(perms) {
  if (perms.length === 0) return "elevated permissions";
  if (perms.length === 1) return perms[0];
  if (perms.length === 2) return `${perms[0]} and ${perms[1]}`;
  return `${perms.slice(0, -1).join(", ")} and ${perms[perms.length - 1]}`;
}

/** Severity first (critical→positive), then category order, then title. */
function sortRecommendations(recs) {
  return [...recs].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    const cat = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (cat !== 0) return cat;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Turn reduced server signals into a prioritised list of recommendations.
 * Pure and deterministic — the same signals always yield the same cards in the
 * same order. Mirrors generateRecommendations() rule-for-rule (ids, copy,
 * thresholds) so the health score derived from it matches the dashboard.
 */
function generateRecommendations(s) {
  const recs = [];
  const period = `the last ${s.windowDays} days`;

  // ── Security ────────────────────────────────────────────────────────────────
  for (const role of s.dangerousRoles.slice(0, MAX_DANGEROUS_ROLE_CARDS)) {
    recs.push({
      id: `danger-role-${role.id}`,
      category: "security",
      severity: "warning",
      title: `"${role.name}" has dangerous permissions`,
      detail: `This role grants ${listPerms(role.permissions)}. Review who holds it — these permissions can compromise the server if misassigned.`,
      action: { label: "Review roles", path: "/roles" },
    });
  }
  if (s.dangerousRoles.length > MAX_DANGEROUS_ROLE_CARDS) {
    const extra = s.dangerousRoles.length - MAX_DANGEROUS_ROLE_CARDS;
    recs.push({
      id: "danger-role-more",
      category: "security",
      severity: "suggestion",
      title: `${extra} more role${extra === 1 ? "" : "s"} with risky permissions`,
      detail: "Several other roles also grant high-impact permissions. Audit your role hierarchy to keep elevated access to a minimum.",
      action: { label: "Review roles", path: "/roles" },
    });
  }

  // ── Moderation ────────────────────────────────────────────────────────────────
  if (!s.pulseGuardEnabled) {
    recs.push({
      id: "enable-pulse-guard",
      category: "moderation",
      severity: "suggestion",
      title: "Turn on AutoMod with Pulse Guard",
      detail: "Pulse Guard isn't active. Enable it to automatically catch spam, scam links and toxicity before your moderators have to.",
      action: { label: "Enable Pulse Guard", path: "/ai-moderation" },
    });
  }
  if (
    s.trends.mod_actions.direction === "increasing" &&
    s.trends.mod_actions.changePct >= MOD_SPIKE_PCT &&
    s.current.mod_actions >= MOD_SPIKE_MIN_ACTIONS
  ) {
    recs.push({
      id: "mod-spike",
      category: "moderation",
      severity: "warning",
      title: "Moderation actions are unusually high",
      detail: `Moderation actions are up ${pctLabel(s.trends.mod_actions)} over ${period} (${s.current.mod_actions} total). This can signal a raid, a problem member or a rule that needs clarifying.`,
      action: { label: "Open moderation", path: "/moderation" },
    });
  }

  // ── Growth ──────────────────────────────────────────────────────────────────
  const netGrowth = s.current.joins - s.current.leaves;
  if (netGrowth < 0) {
    recs.push({
      id: "net-negative",
      category: "growth",
      severity: "warning",
      title: "More members left than joined",
      detail: `Over ${period} you gained ${s.current.joins} and lost ${s.current.leaves} members (net ${netGrowth}). Consider a welcome flow, events or announcements to retain new members.`,
      action: { label: "View statistics", path: "/statistics" },
    });
  }
  if (
    s.trends.messages.direction === "decreasing" &&
    s.trends.messages.changePct <= -ENGAGEMENT_DROP_PCT
  ) {
    recs.push({
      id: "engagement-decline",
      category: "growth",
      severity: "warning",
      title: "Engagement is trending down",
      detail: `Messages are down ${pctLabel(s.trends.messages)} versus the previous ${s.windowDays} days. Try scheduling an event or a recurring announcement to re-spark activity.`,
      action: { label: "Schedule something", path: "/scheduled" },
    });
  }
  if (!s.welcomeConfigured && s.current.joins > 0) {
    recs.push({
      id: "setup-welcome",
      category: "growth",
      severity: "suggestion",
      title: "Greet your new members",
      detail: `${s.current.joins} member${s.current.joins === 1 ? "" : "s"} joined over ${period}, but no welcome message is set up. A warm greeting boosts first-day retention.`,
      action: { label: "Set up welcome", path: "/onboarding" },
    });
  }

  // ── Activity ──────────────────────────────────────────────────────────────────
  if (
    s.trends.voice_seconds.direction === "increasing" &&
    s.trends.voice_seconds.changePct >= VOICE_SURGE_PCT &&
    s.current.voice_seconds > 0
  ) {
    recs.push({
      id: "voice-surge",
      category: "activity",
      severity: "positive",
      title: `Voice activity increased by ${s.trends.voice_seconds.changePct}%`,
      detail: "Members are spending more time in voice. Lean into it with voice events or a dedicated hangout channel while interest is high.",
      action: { label: "Create an event", path: "/events?new=1" },
    });
  }
  if (s.peakActivitySlot && s.current.messages >= BEST_TIME_MIN_MESSAGES) {
    const { dow, hour } = s.peakActivitySlot;
    recs.push({
      id: "best-time",
      category: "activity",
      severity: "suggestion",
      title: "Post when your members are online",
      detail: `Your server is most active on ${WEEKDAY_LABELS[dow]}s around ${hourLabel(hour)} (UTC). Schedule announcements or events for then to reach the most people.`,
      action: { label: "Schedule for peak time", path: "/scheduled" },
    });
  }

  // ── Optimization ──────────────────────────────────────────────────────────────
  if (s.inactiveChannels.length > 0) {
    const names = s.inactiveChannels.slice(0, 3).map((c) => `#${c.name}`).join(", ");
    const more = s.inactiveChannels.length - 3;
    recs.push({
      id: "inactive-channels",
      category: "optimization",
      severity: "suggestion",
      title: `${s.inactiveChannels.length} channel${s.inactiveChannels.length === 1 ? " looks" : "s look"} inactive`,
      detail: `${names}${more > 0 ? ` and ${more} more` : ""} ${s.inactiveChannels.length === 1 ? "has" : "have"} seen no messages in weeks. Archiving or merging quiet channels keeps your server easy to navigate.`,
      action: { label: "Manage channels", path: "/channels" },
    });
  }
  if (s.unusedRolesReliable && s.unusedRoles.length > 0) {
    const names = s.unusedRoles.slice(0, 3).map((r) => r.name).join(", ");
    const more = s.unusedRoles.length - 3;
    recs.push({
      id: "unused-roles",
      category: "optimization",
      severity: "suggestion",
      title: `${s.unusedRoles.length} role${s.unusedRoles.length === 1 ? " has" : "s have"} no members`,
      detail: `${names}${more > 0 ? ` and ${more} more` : ""} ${s.unusedRoles.length === 1 ? "is" : "are"} assigned to nobody. Removing unused roles declutters the role list and your permission model.`,
      action: { label: "Manage roles", path: "/roles" },
    });
  }
  if (s.onboardingStatus !== "completed") {
    recs.push({
      id: "finish-onboarding",
      category: "optimization",
      severity: "suggestion",
      title: "Set up member onboarding",
      detail: "New members don't get a guided welcome yet. Turn on Onboarding & Welcome to greet them, hand out self-roles, verify access and reward completion.",
      action: { label: "Set up onboarding", path: "/onboarding" },
    });
  }

  // ── Positive fallback ──────────────────────────────────────────────────────────
  const hasConcern = recs.some((r) => r.severity === "critical" || r.severity === "warning");
  if (!hasConcern) {
    recs.push({
      id: "all-clear",
      category: "activity",
      severity: "positive",
      title: "Your server looks healthy",
      detail: "No pressing issues right now. Activity, moderation and structure are all in good shape — keep it up!",
    });
  }

  return sortRecommendations(recs);
}

// ── Health score ─────────────────────────────────────────────────────────────

const SEVERITY_PENALTY = {
  critical: 18,
  warning: 9,
  suggestion: 2,
  positive: 0,
};

/**
 * Derive a 0–100 health score from the surfaced recommendations so the headline
 * number can never disagree with the cards beneath it. Mirrors
 * healthFromRecommendations().
 */
function healthFromRecommendations(recs) {
  let score = 100;
  for (const r of recs) score -= SEVERITY_PENALTY[r.severity];
  score = Math.max(5, Math.min(100, score));

  let band;
  if (score >= 85) band = "excellent";
  else if (score >= 65) band = "healthy";
  else if (score >= 45) band = "fair";
  else band = "attention";

  const meta = {
    excellent: { label: "Excellent" },
    healthy: { label: "Healthy" },
    fair: { label: "Fair" },
    attention: { label: "Needs attention" },
  };
  return { score, band, label: meta[band].label };
}

/** The single busiest day×hour cell, or null when there's no message data. */
function bestActivitySlot(cells) {
  let best = null;
  for (const c of cells) {
    const count = Number(c.message_count);
    if (count > 0 && (!best || count > Number(best.message_count))) best = c;
  }
  return best ? { dow: best.dow, hour: best.hour } : null;
}

module.exports = {
  computeTrend,
  computeTrends,
  emptyTotals,
  splitWindow,
  generateRecommendations,
  sortRecommendations,
  healthFromRecommendations,
  bestActivitySlot,
  WEEKDAY_LABELS,
  hourLabel,
  // thresholds re-exported for the parity test
  STABLE_THRESHOLD_PCT,
  MAX_CHANGE_PCT,
};

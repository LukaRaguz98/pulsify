// Management Analytics engine — bot side (PULSIFY-61).
//
// A CommonJS mirror of the staff-performance maths in
// pulsify-web-app/lib/management.ts, feeding the /management stats command.
// Same mirroring stance as src/insights-engine.js: the bot can't import the
// web app's TypeScript, so the aggregation is re-implemented here and pinned by
// test/management-engine.test.js so the numbers match the dashboard's
// Management Analytics view.
//
// The bot renders totals, the support summary, the leaderboards, the per-staff
// breakdowns and the insights — everything except the continuous activity
// timeline and the contribution-breakdown slices, which are chart-only and have
// no place in a Discord embed, so buildTimeline()/contributionBreakdown are not
// ported. Keep the action taxonomy, thresholds, ids and copy in sync with
// lib/management.ts.

const { computeTrend } = require("./insights-engine");

const DAY_MS = 86_400_000;

// ── Action taxonomy ───────────────────────────────────────────────────────────

const SUPPORT_KINDS = new Set(["ticket_claim", "ticket_close", "ticket_note"]);
const COMMUNITY_KINDS = new Set(["announcement", "giveaway", "event"]);

function categoryOfKind(kind) {
  if (SUPPORT_KINDS.has(kind)) return "support";
  if (COMMUNITY_KINDS.has(kind)) return "community";
  return "moderation";
}

// moderation_logs.action → kind. Anything not listed is a real moderation action
// that doesn't roll up to a headline counter (role/nickname/message/channel ops).
const MOD_ACTION_KIND = {
  warn: "warn",
  warning: "warn",
  timeout: "timeout",
  kick: "kick",
  ban: "ban",
  unban: "unban",
};
function modActionKind(action) {
  return MOD_ACTION_KIND[action] ?? "mod_other";
}

// ticket_events.type → the support action kind we attribute. Lifecycle events
// that aren't staff *work* are intentionally dropped. Mirrors the web route's
// TICKET_EVENT_KIND (the mapping lives in the route there, not the engine).
const TICKET_EVENT_KIND = {
  claimed: "ticket_claim",
  assigned: "ticket_claim",
  closed: "ticket_close",
  reopened: "ticket_note",
  note: "ticket_note",
};

// ── Accumulator ────────────────────────────────────────────────────────────────

function emptyAcc(id, name) {
  return {
    id,
    name,
    warnings: 0,
    timeouts: 0,
    kicks: 0,
    bans: 0,
    unbans: 0,
    moderationOther: 0,
    ticketsHandled: 0,
    ticketsResolved: 0,
    firstResponseSamples: [],
    resolutionSamples: [],
    announcements: 0,
    giveaways: 0,
    eventsCreated: 0,
    totalActions: 0,
    prevActions: 0,
    lastActiveAt: null,
    activeDayKeys: new Set(),
  };
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function average(samples) {
  if (samples.length === 0) return null;
  return Math.round(samples.reduce((s, v) => s + v, 0) / samples.length);
}

/** Pick a staff member's dominant role from their activity mix. */
function deriveRole(moderation, support, community) {
  if (moderation === 0 && support === 0 && community === 0) return "staff";
  if (community >= moderation && community >= support && community > 0) return "administrator";
  if (support >= moderation && support > 0) return "support";
  if (moderation > 0) return "moderator";
  return "staff";
}

const ROLE_LABELS = {
  moderator: "Moderator",
  support: "Support",
  administrator: "Administrator",
  staff: "Staff",
};

// ── Timeframe → window ─────────────────────────────────────────────────────────

// Days a timeframe spans. null for 'all' (no comparable previous period).
function timeframeWindowDays(timeframe) {
  switch (timeframe) {
    case "24h":
      return 1;
    case "7d":
      return 7;
    case "30d":
      return 30;
    default:
      return null; // 'all'
  }
}

// ── The engine ─────────────────────────────────────────────────────────────────

/**
 * Aggregate an attributed event stream + ticket records into per-staff stats,
 * totals, support timing, leaderboards and insights. Mirrors buildManagement().
 */
function buildManagement(input) {
  const { timeframe, now, events, tickets, directory, openTickets } = input;

  const fixedDays = timeframeWindowDays(timeframe);
  const comparison = fixedDays !== null;
  let earliest = now;
  for (const e of events) {
    const t = new Date(e.at).getTime();
    if (!Number.isNaN(t) && t < earliest) earliest = t;
  }
  const windowDays = comparison
    ? fixedDays
    : Math.max(1, Math.ceil((now - earliest) / DAY_MS));
  const cutoff = comparison ? now - windowDays * DAY_MS : -Infinity;
  const floor = comparison ? now - windowDays * 2 * DAY_MS : -Infinity;

  const dir = new Map(directory.map((d) => [d.id, d]));
  const accs = new Map();
  const accFor = (id, name) => {
    let a = accs.get(id);
    if (!a) {
      a = emptyAcc(id, name ?? dir.get(id)?.name ?? null);
      accs.set(id, a);
    } else if (!a.name && name) {
      a.name = name;
    }
    return a;
  };

  // Seed known support staff so a zero-activity moderator still surfaces.
  for (const d of directory) {
    if (d.isSupportRole) accFor(d.id, d.name);
  }

  // ── Fold the event stream ──────────────────────────────────────────────────
  let curMod = 0;
  let curSup = 0;
  let curCom = 0;
  let prevMod = 0;
  let prevSup = 0;
  let prevCom = 0;

  for (const e of events) {
    const t = new Date(e.at).getTime();
    if (Number.isNaN(t) || t < floor) continue;
    const isCurrent = t >= cutoff;
    const cat = categoryOfKind(e.kind);
    if (isCurrent) {
      if (cat === "moderation") curMod++;
      else if (cat === "support") curSup++;
      else curCom++;
    } else {
      if (cat === "moderation") prevMod++;
      else if (cat === "support") prevSup++;
      else prevCom++;
    }

    const a = accFor(e.actorId, e.actorName);
    if (!isCurrent) {
      a.prevActions++;
      continue;
    }
    a.totalActions++;
    a.activeDayKeys.add(dayKey(t));
    if (a.lastActiveAt === null || t > a.lastActiveAt) a.lastActiveAt = t;
    switch (e.kind) {
      case "warn":
        a.warnings++;
        break;
      case "timeout":
        a.timeouts++;
        break;
      case "kick":
        a.kicks++;
        break;
      case "ban":
        a.bans++;
        break;
      case "unban":
        a.unbans++;
        break;
      case "mod_other":
        a.moderationOther++;
        break;
      case "announcement":
        a.announcements++;
        break;
      case "giveaway":
        a.giveaways++;
        break;
      case "event":
        a.eventsCreated++;
        break;
      default:
        // ticket_* counters come from the ticket records below so handling time
        // can be attributed; the events still feed activity/trend above.
        break;
    }
  }

  // ── Support timing from ticket records ──────────────────────────────────────
  const globalFirstResponse = [];
  const globalResolution = [];
  let ticketsHandledTotal = 0;
  let ticketsResolvedTotal = 0;

  for (const tk of tickets) {
    const opened = new Date(tk.openedAt).getTime();
    if (tk.firstResponseAt && tk.responderId) {
      const responded = new Date(tk.firstResponseAt).getTime();
      const secs = Math.max(0, Math.round((responded - opened) / 1000));
      const a = accFor(tk.responderId, tk.responderName);
      a.ticketsHandled++;
      a.firstResponseSamples.push(secs);
      globalFirstResponse.push(secs);
      ticketsHandledTotal++;
    }
    if (tk.resolved && tk.closedAt && tk.closedById) {
      const closed = new Date(tk.closedAt).getTime();
      const secs = Math.max(0, Math.round((closed - opened) / 1000));
      const a = accFor(tk.closedById, tk.closedByName);
      a.ticketsResolved++;
      a.resolutionSamples.push(secs);
      globalResolution.push(secs);
      ticketsResolvedTotal++;
    }
  }

  // ── Materialise per-staff stats ─────────────────────────────────────────────
  const inactivityCutoff = now - Math.ceil(windowDays / 2) * DAY_MS;

  const staff = [];
  for (const a of accs.values()) {
    const moderationTotal =
      a.warnings + a.timeouts + a.kicks + a.bans + a.unbans + a.moderationOther;
    const communityTotal = a.announcements + a.giveaways + a.eventsCreated;
    const supportTotal = a.ticketsHandled + a.ticketsResolved;
    const known = dir.get(a.id)?.isSupportRole ?? false;

    const isInactive =
      (known || a.prevActions > 0) &&
      (a.lastActiveAt === null || a.lastActiveAt < inactivityCutoff);

    staff.push({
      id: a.id,
      name: a.name ?? `User ${a.id.slice(-4)}`,
      avatar: dir.get(a.id)?.avatar ?? null,
      role: deriveRole(moderationTotal, supportTotal, communityTotal),
      warnings: a.warnings,
      timeouts: a.timeouts,
      kicks: a.kicks,
      bans: a.bans,
      unbans: a.unbans,
      moderationOther: a.moderationOther,
      moderationTotal,
      ticketsHandled: a.ticketsHandled,
      ticketsResolved: a.ticketsResolved,
      avgFirstResponseSeconds: average(a.firstResponseSamples),
      avgResolutionSeconds: average(a.resolutionSamples),
      announcements: a.announcements,
      giveaways: a.giveaways,
      eventsCreated: a.eventsCreated,
      communityTotal,
      totalActions: a.totalActions,
      lastActiveAt: a.lastActiveAt ? new Date(a.lastActiveAt).toISOString() : null,
      activeDays: a.activeDayKeys.size,
      consistencyPct: Math.min(100, Math.round((a.activeDayKeys.size / windowDays) * 100)),
      trend: computeTrend(a.totalActions, a.prevActions),
      isInactive,
    });
  }

  staff.sort((x, y) => y.totalActions - x.totalActions || lastActiveMs(y) - lastActiveMs(x));

  // ── Totals + trends ─────────────────────────────────────────────────────────
  const activeStaff = staff.filter((s) => s.totalActions > 0).length;
  const prevActiveStaff = countPrevActive(accs);
  const curTotal = curMod + curSup + curCom;
  const prevTotal = prevMod + prevSup + prevCom;

  const totals = {
    activeStaff,
    moderationActions: curMod,
    supportActions: curSup,
    communityActions: curCom,
    totalActions: curTotal,
    trends: {
      totalActions: computeTrend(curTotal, prevTotal),
      moderationActions: computeTrend(curMod, prevMod),
      supportActions: computeTrend(curSup, prevSup),
      communityActions: computeTrend(curCom, prevCom),
      activeStaff: computeTrend(activeStaff, prevActiveStaff),
    },
  };

  // ── Support summary ─────────────────────────────────────────────────────────
  const support = {
    ticketsHandled: ticketsHandledTotal,
    ticketsResolved: ticketsResolvedTotal,
    resolutionRatePct:
      tickets.length > 0 ? Math.round((ticketsResolvedTotal / tickets.length) * 100) : 0,
    avgFirstResponseSeconds: average(globalFirstResponse),
    avgResolutionSeconds: average(globalResolution),
    openTickets,
  };

  const leaderboards = buildLeaderboards(staff);
  const insights = generateManagementInsights(staff, support, totals, windowDays);

  return {
    timeframe,
    windowDays,
    comparison,
    hasActivity: curTotal > 0 || prevTotal > 0,
    totals,
    staff,
    leaderboards,
    support,
    insights,
  };
}

function lastActiveMs(s) {
  return s.lastActiveAt ? new Date(s.lastActiveAt).getTime() : 0;
}

function countPrevActive(accs) {
  let n = 0;
  for (const a of accs.values()) if (a.prevActions > 0) n++;
  return n;
}

function entryOf(s, value, unit) {
  if (!s) return null;
  return { id: s.id, name: s.name, avatar: s.avatar, value, unit };
}

function buildLeaderboards(staff) {
  const maxBy = (sel) => {
    let best;
    for (const s of staff) {
      if (sel(s) <= 0) continue;
      if (!best || sel(s) > sel(best)) best = s;
    }
    return best;
  };
  const topContributor = maxBy((s) => s.totalActions);
  const mostMod = maxBy((s) => s.moderationTotal);
  const mostSup = maxBy((s) => s.ticketsHandled);
  const mostAdmin = maxBy((s) => s.communityTotal);
  const mostResolved = maxBy((s) => s.ticketsResolved);

  // Fastest responder = lowest average first-response, among those who responded
  // to at least two tickets (one sample is noise, not a track record).
  let fastest;
  for (const s of staff) {
    if (s.avgFirstResponseSeconds === null || s.ticketsHandled < 2) continue;
    if (!fastest || s.avgFirstResponseSeconds < (fastest.avgFirstResponseSeconds ?? Infinity)) {
      fastest = s;
    }
  }

  return {
    topContributor: entryOf(topContributor, topContributor?.totalActions ?? 0, "actions"),
    mostActiveModerator: entryOf(mostMod, mostMod?.moderationTotal ?? 0, "actions"),
    mostActiveSupport: entryOf(mostSup, mostSup?.ticketsHandled ?? 0, "tickets"),
    mostActiveAdministrator: entryOf(mostAdmin, mostAdmin?.communityTotal ?? 0, "actions"),
    fastestResponder: entryOf(fastest, fastest?.avgFirstResponseSeconds ?? 0, "avg response"),
    mostTicketsResolved: entryOf(mostResolved, mostResolved?.ticketsResolved ?? 0, "resolved"),
  };
}

const SLOW_RESPONSE_SECONDS = 3600;
const OVERLOAD_SHARE = 0.5;

const INSIGHT_SEVERITY_RANK = { critical: 0, warning: 1, suggestion: 2, positive: 3 };

function generateManagementInsights(staff, support, totals, windowDays) {
  const out = [];

  if (totals.moderationActions >= 10) {
    const topMod = staff.reduce((a, b) => (b.moderationTotal > a.moderationTotal ? b : a), staff[0]);
    const share = topMod.moderationTotal / totals.moderationActions;
    if (share >= OVERLOAD_SHARE && topMod.moderationTotal >= 8) {
      out.push({
        id: "overloaded-mod",
        severity: "warning",
        title: `${topMod.name} is carrying moderation`,
        body: `${topMod.name} performed ${Math.round(share * 100)}% of all moderation actions this period. Spread the load across more moderators to avoid burnout.`,
        staffId: topMod.id,
      });
    }
  }
  if (support.ticketsHandled >= 6) {
    const topSup = staff.reduce((a, b) => (b.ticketsHandled > a.ticketsHandled ? b : a), staff[0]);
    const share = topSup.ticketsHandled / support.ticketsHandled;
    if (share >= OVERLOAD_SHARE && topSup.ticketsHandled >= 5) {
      out.push({
        id: "overloaded-support",
        severity: "warning",
        title: `${topSup.name} is handling most tickets`,
        body: `${topSup.name} picked up ${Math.round(share * 100)}% of tickets. Consider rebalancing support coverage.`,
        staffId: topSup.id,
      });
    }
  }

  if (support.avgFirstResponseSeconds !== null && support.avgFirstResponseSeconds > SLOW_RESPONSE_SECONDS) {
    out.push({
      id: "slow-response",
      severity: "warning",
      title: "Support responses are slow",
      body: `The average first response is ${formatSeconds(support.avgFirstResponseSeconds)}. Add coverage during peak hours or set response expectations to keep members from waiting.`,
    });
  }
  if (support.openTickets >= 10 && support.openTickets > support.ticketsResolved) {
    out.push({
      id: "ticket-backlog",
      severity: "warning",
      title: "Tickets are piling up",
      body: `${support.openTickets} tickets are still open — more than were resolved this period. Clear the backlog before response quality slips.`,
    });
  }

  const inactive = staff.filter((s) => s.isInactive);
  if (inactive.length > 0) {
    out.push({
      id: "inactive-staff",
      severity: "suggestion",
      title: `${inactive.length} staff member${inactive.length === 1 ? "" : "s"} ${inactive.length === 1 ? "has" : "have"} gone quiet`,
      body: `${inactive.slice(0, 4).map((s) => s.name).join(", ")}${inactive.length > 4 ? ` +${inactive.length - 4} more` : ""} ${inactive.length === 1 ? "has" : "have"} had little to no activity in the last ${Math.ceil(windowDays / 2)} days. Check in or review their roles.`,
    });
  }

  const active = staff.filter((s) => s.totalActions > 0).sort((a, b) => b.totalActions - a.totalActions);
  if (active.length >= 2 && active[0].totalActions >= 15) {
    const lead = active[0];
    const runnerUp = active[1].totalActions;
    if (lead.totalActions >= runnerUp * 2) {
      out.push({
        id: "exceptional",
        severity: "positive",
        title: `${lead.name} is your standout this period`,
        body: `${lead.name} logged ${lead.totalActions} actions — more than double the next most active member. Recognise the contribution.`,
        staffId: lead.id,
      });
    }
  }

  if (totals.activeStaff > 0 && totals.activeStaff <= 2 && totals.totalActions >= 20) {
    out.push({
      id: "balance",
      severity: "suggestion",
      title: "Management rests on a few people",
      body: `Only ${totals.activeStaff} staff member${totals.activeStaff === 1 ? "" : "s"} did meaningful work this period. Recruit or empower more staff so the server isn't dependent on a single person.`,
    });
  }

  if (out.length === 0 && totals.totalActions > 0) {
    out.push({
      id: "healthy",
      severity: "positive",
      title: "Your team is running smoothly",
      body: "Workload is well distributed, response times are healthy and staff are active. Keep it up.",
    });
  }

  return out.sort((a, b) => INSIGHT_SEVERITY_RANK[a.severity] - INSIGHT_SEVERITY_RANK[b.severity]);
}

/** Compact human duration for insight copy (e.g. "2h 5m", "45m", "30s"). */
function formatSeconds(seconds) {
  if (seconds === null) return "—";
  if (seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

module.exports = {
  buildManagement,
  modActionKind,
  categoryOfKind,
  deriveRole,
  timeframeWindowDays,
  formatSeconds,
  ROLE_LABELS,
  TICKET_EVENT_KIND,
};

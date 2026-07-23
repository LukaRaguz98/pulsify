// Tests for the ported Management Analytics engine (src/management-engine.js).
//
// Pin the aggregation that must agree with the dashboard's lib/management.ts:
// the action taxonomy, per-staff folding, current-vs-previous trends, ticket
// timing, leaderboards and the management insights. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildManagement,
  modActionKind,
  categoryOfKind,
  deriveRole,
  formatSeconds,
} = require("../src/management-engine");

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-22T00:00:00Z");

test("modActionKind maps known actions and falls back to mod_other", () => {
  assert.equal(modActionKind("warn"), "warn");
  assert.equal(modActionKind("warning"), "warn");
  assert.equal(modActionKind("ban"), "ban");
  assert.equal(modActionKind("channel_lock"), "mod_other");
});

test("categoryOfKind files kinds into moderation / support / community", () => {
  assert.equal(categoryOfKind("warn"), "moderation");
  assert.equal(categoryOfKind("ticket_claim"), "support");
  assert.equal(categoryOfKind("announcement"), "community");
  assert.equal(categoryOfKind("event"), "community");
});

test("deriveRole picks the dominant activity lens", () => {
  assert.equal(deriveRole(0, 0, 0), "staff");
  assert.equal(deriveRole(5, 1, 0), "moderator");
  assert.equal(deriveRole(1, 4, 0), "support");
  assert.equal(deriveRole(1, 1, 3), "administrator");
});

test("folds moderation actions into per-staff totals and current/previous trends", () => {
  const events = [
    // 3 warns in the current 7-day window …
    { actorId: "mod1", actorName: "Mod One", kind: "warn", at: new Date(NOW - 1 * DAY).toISOString() },
    { actorId: "mod1", actorName: "Mod One", kind: "warn", at: new Date(NOW - 2 * DAY).toISOString() },
    { actorId: "mod1", actorName: "Mod One", kind: "ban", at: new Date(NOW - 3 * DAY).toISOString() },
    // … and 1 in the previous window (7-14 days ago).
    { actorId: "mod1", actorName: "Mod One", kind: "warn", at: new Date(NOW - 9 * DAY).toISOString() },
  ];
  const data = buildManagement({ timeframe: "7d", now: NOW, events, tickets: [], directory: [], openTickets: 0 });

  assert.equal(data.staff.length, 1);
  const mod = data.staff[0];
  assert.equal(mod.id, "mod1");
  assert.equal(mod.warnings, 2);
  assert.equal(mod.bans, 1);
  assert.equal(mod.moderationTotal, 3);
  assert.equal(mod.totalActions, 3);
  assert.equal(mod.role, "moderator");

  assert.equal(data.totals.moderationActions, 3);
  assert.equal(data.totals.totalActions, 3);
  assert.equal(data.totals.activeStaff, 1);
  // Current 3 vs previous 1 → +200%.
  assert.equal(data.totals.trends.totalActions.direction, "increasing");
  assert.equal(data.totals.trends.totalActions.changePct, 200);
  // topContributor leaderboard points at the only actor.
  assert.equal(data.leaderboards.topContributor.id, "mod1");
});

test("ticket timing attributes first-response and resolution seconds", () => {
  const opened = new Date(NOW - 2 * DAY).toISOString();
  const responded = new Date(NOW - 2 * DAY + 60_000).toISOString(); // +60s
  const closed = new Date(NOW - 2 * DAY + 3_600_000).toISOString(); // +1h
  const events = [
    { actorId: "sup1", actorName: "Support", kind: "ticket_claim", at: responded },
    { actorId: "sup1", actorName: "Support", kind: "ticket_close", at: closed },
  ];
  const tickets = [
    {
      id: "t1",
      openedAt: opened,
      firstResponseAt: responded,
      responderId: "sup1",
      responderName: "Support",
      resolved: true,
      closedAt: closed,
      closedById: "sup1",
      closedByName: "Support",
    },
  ];
  const data = buildManagement({ timeframe: "7d", now: NOW, events, tickets, directory: [], openTickets: 0 });

  assert.equal(data.support.ticketsHandled, 1);
  assert.equal(data.support.ticketsResolved, 1);
  assert.equal(data.support.resolutionRatePct, 100);
  assert.equal(data.support.avgFirstResponseSeconds, 60);
  assert.equal(data.support.avgResolutionSeconds, 3600);

  const sup = data.staff.find((s) => s.id === "sup1");
  assert.equal(sup.ticketsHandled, 1);
  assert.equal(sup.ticketsResolved, 1);
  assert.equal(sup.avgFirstResponseSeconds, 60);
});

test("known support staff seed the roster even with zero activity", () => {
  const data = buildManagement({
    timeframe: "7d",
    now: NOW,
    events: [],
    tickets: [],
    directory: [{ id: "quiet", name: "Quiet Mod", avatar: null, isSupportRole: true }],
    openTickets: 0,
  });
  const quiet = data.staff.find((s) => s.id === "quiet");
  assert.ok(quiet, "seeded staff should appear");
  assert.equal(quiet.totalActions, 0);
  assert.equal(data.hasActivity, false);
});

test("an overloaded moderator triggers a management insight", () => {
  // One moderator does 10 of 12 actions this period → >50% share, >=8 actions.
  const events = [];
  for (let i = 0; i < 10; i++) {
    events.push({ actorId: "carry", actorName: "Carry", kind: "warn", at: new Date(NOW - (i % 6) * DAY - 3600_000).toISOString() });
  }
  events.push({ actorId: "other", actorName: "Other", kind: "warn", at: new Date(NOW - 1 * DAY).toISOString() });
  events.push({ actorId: "other", actorName: "Other", kind: "kick", at: new Date(NOW - 1 * DAY).toISOString() });

  const data = buildManagement({ timeframe: "7d", now: NOW, events, tickets: [], directory: [], openTickets: 0 });
  assert.ok(data.totals.moderationActions >= 10);
  assert.ok(data.insights.some((i) => i.id === "overloaded-mod"));
});

test("formatSeconds renders compact durations", () => {
  assert.equal(formatSeconds(null), "—");
  assert.equal(formatSeconds(0), "0s");
  assert.equal(formatSeconds(45), "45s");
  assert.equal(formatSeconds(90), "1m");
  assert.equal(formatSeconds(3660), "1h 1m");
});

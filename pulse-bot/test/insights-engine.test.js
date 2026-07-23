// Tests for the ported Server Insights engine (src/insights-engine.js).
//
// These pin the maths that must agree with the dashboard's lib/insights.ts:
// trend classification, the current/previous window split, the recommendation
// rules (ids, severities, ordering) and the health score derived from them —
// the number /insights prints has to match what the dashboard shows. Run with
// `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeTrend,
  splitWindow,
  generateRecommendations,
  healthFromRecommendations,
  bestActivitySlot,
} = require("../src/insights-engine");

const DAY = 86_400_000;

test("computeTrend classifies direction, caps magnitude and flags 'new'", () => {
  assert.deepEqual(computeTrend(100, 50), { direction: "increasing", changePct: 100 });
  // 5% is below the 8% stable threshold → flat.
  assert.deepEqual(computeTrend(105, 100), { direction: "stable", changePct: 5 });
  // No prior baseline but current activity → new, not a fake percentage.
  assert.deepEqual(computeTrend(5, 0), { direction: "increasing", changePct: 0, isNew: true });
  assert.deepEqual(computeTrend(0, 0), { direction: "stable", changePct: 0 });
  assert.equal(computeTrend(3, 300).direction, "decreasing");
  // Tiny baseline can't produce a runaway number.
  assert.ok(computeTrend(100000, 1).changePct <= 999);
});

test("splitWindow sums current vs previous by bucket timestamp", () => {
  const now = Date.parse("2026-07-22T00:00:00Z");
  const series = [
    { bucket: new Date(now - 2 * DAY).toISOString(), messages: 10, joins: 2, leaves: 1, commands: 0, mod_actions: 0, voice_seconds: 0 },
    { bucket: new Date(now - 9 * DAY).toISOString(), messages: 4, joins: 1, leaves: 0, commands: 0, mod_actions: 0, voice_seconds: 0 },
    { bucket: new Date(now - 20 * DAY).toISOString(), messages: 999, joins: 0, leaves: 0, commands: 0, mod_actions: 0, voice_seconds: 0 },
  ];
  const { current, previous } = splitWindow(series, 7, now);
  assert.equal(current.messages, 10);
  assert.equal(current.joins, 2);
  assert.equal(previous.messages, 4);
  // The 20-day-old bucket is outside 2× the window and counts for neither.
});

/** A signals object with nothing wrong — used as the healthy baseline. */
function cleanSignals(overrides = {}) {
  return {
    windowDays: 7,
    current: { messages: 100, joins: 5, leaves: 1, commands: 20, mod_actions: 0, voice_seconds: 0 },
    previous: { messages: 90, joins: 4, leaves: 2, commands: 18, mod_actions: 0, voice_seconds: 0 },
    trends: {
      messages: computeTrend(100, 90),
      voice_seconds: computeTrend(0, 0),
      joins: computeTrend(5, 4),
      netGrowth: computeTrend(4, 2),
      mod_actions: computeTrend(0, 0),
      commands: computeTrend(20, 18),
    },
    activeUsers: 30,
    totalMembers: 100,
    inactiveChannels: [],
    unusedRoles: [],
    unusedRolesReliable: true,
    dangerousRoles: [],
    pulseGuardEnabled: true,
    welcomeConfigured: true,
    onboardingStatus: "completed",
    peakActivitySlot: null,
    ...overrides,
  };
}

test("a clean server yields the all-clear card and a perfect health score", () => {
  const recs = generateRecommendations(cleanSignals());
  assert.equal(recs.length, 1);
  assert.equal(recs[0].id, "all-clear");
  assert.equal(recs[0].severity, "positive");
  const health = healthFromRecommendations(recs);
  assert.equal(health.score, 100);
  assert.equal(health.band, "excellent");
});

test("a dangerous role surfaces a warning and dents the score by its penalty", () => {
  const recs = generateRecommendations(
    cleanSignals({ dangerousRoles: [{ id: "1", name: "Staff", permissions: ["Administrator"] }] }),
  );
  const danger = recs.find((r) => r.id === "danger-role-1");
  assert.ok(danger);
  assert.equal(danger.severity, "warning");
  assert.equal(danger.category, "security");
  // 100 - 9 (one warning). No positive fallback because a warning exists.
  assert.equal(healthFromRecommendations(recs).score, 91);
});

test("recommendations are ordered by severity (warnings before suggestions)", () => {
  const recs = generateRecommendations(
    cleanSignals({
      pulseGuardEnabled: false, // suggestion
      dangerousRoles: [{ id: "9", name: "Risky", permissions: ["Ban Members"] }], // warning
    }),
  );
  const firstWarning = recs.findIndex((r) => r.severity === "warning");
  const firstSuggestion = recs.findIndex((r) => r.severity === "suggestion");
  assert.ok(firstWarning !== -1 && firstSuggestion !== -1);
  assert.ok(firstWarning < firstSuggestion);
});

test("net-negative growth is flagged as a warning", () => {
  const recs = generateRecommendations(
    cleanSignals({ current: { messages: 100, joins: 1, leaves: 8, commands: 5, mod_actions: 0, voice_seconds: 0 } }),
  );
  assert.ok(recs.some((r) => r.id === "net-negative" && r.severity === "warning"));
});

test("bestActivitySlot picks the busiest cell, ignoring empties", () => {
  assert.equal(bestActivitySlot([]), null);
  const slot = bestActivitySlot([
    { dow: 0, hour: 9, message_count: 5 },
    { dow: 3, hour: 20, message_count: 42 },
    { dow: 6, hour: 2, message_count: 0 },
  ]);
  assert.deepEqual(slot, { dow: 3, hour: 20 });
});

test("health bands step down as penalties accumulate", () => {
  // One suggestion = 98 → excellent (>=85).
  assert.equal(healthFromRecommendations([{ severity: "suggestion" }]).band, "excellent");
  // Two warnings = 100 - 18 = 82 → healthy (>=65, <85).
  const twoWarnings = healthFromRecommendations([{ severity: "warning" }, { severity: "warning" }]);
  assert.equal(twoWarnings.score, 82);
  assert.equal(twoWarnings.band, "healthy");
  // Three criticals = 100 - 54 = 46 → fair (>=45, <65).
  const threeCritical = healthFromRecommendations([
    { severity: "critical" },
    { severity: "critical" },
    { severity: "critical" },
  ]);
  assert.equal(threeCritical.score, 46);
  assert.equal(threeCritical.band, "fair");
});

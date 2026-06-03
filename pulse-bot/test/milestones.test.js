// Tests for the pure milestone logic shared by the bot and the dashboard
// (pulse-bot/src/milestones.js mirrors pulsify-web-app/lib/milestones.ts). Run
// with `npm test` (zero dependencies — Node's built-in test runner).
//
// Covers normalisation (the clamping + reward dedupe behaviour), metric
// resolution + progress (the heart of "milestones are tracked correctly"),
// value/threshold formatting, message templating, and the analytics rollup.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_MILESTONE_MESSAGE,
  MILESTONE_LIMITS,
  isMilestoneMetric,
  normaliseRewards,
  normaliseMilestone,
  metricValue,
  isMet,
  milestoneProgress,
  formatMetricValue,
  describeThreshold,
  renderMilestoneMessage,
  metricsFromRow,
  computeMilestoneStats,
} = require("../src/milestones");

// ── Metric identity ───────────────────────────────────────────────────────────

test("isMilestoneMetric recognises the seven metrics and rejects junk", () => {
  for (const m of ["join_age", "messages", "voice_minutes", "events", "giveaways", "xp", "level"]) {
    assert.equal(isMilestoneMetric(m), true);
  }
  assert.equal(isMilestoneMetric("reputation"), false);
  assert.equal(isMilestoneMetric(""), false);
  assert.equal(isMilestoneMetric(null), false);
});

// ── Reward normalisation ────────────────────────────────────────────────────

test("normaliseRewards dedupes, drops blanks, and accepts string or object", () => {
  const out = normaliseRewards([
    "1",
    { role_id: "2" },
    { role_id: "1" }, // dup
    { role_id: "" }, // blank
    "2", // dup
    "3",
  ]);
  assert.deepEqual(out, [{ role_id: "1" }, { role_id: "2" }, { role_id: "3" }]);
});

test("normaliseRewards caps at the limit", () => {
  const many = Array.from({ length: MILESTONE_LIMITS.maxRewards + 5 }, (_, i) => `r${i}`);
  assert.equal(normaliseRewards(many).length, MILESTONE_LIMITS.maxRewards);
});

// ── Milestone normalisation ─────────────────────────────────────────────────

test("normaliseMilestone clamps threshold and fills defaults", () => {
  const m = normaliseMilestone({ id: "x", guild_id: "g", name: "Test", metric: "messages", threshold: 0 });
  assert.equal(m.threshold, 1); // clamped up from 0
  assert.equal(m.enabled, true);
  assert.equal(m.announce, "channel");
  assert.equal(m.message, DEFAULT_MILESTONE_MESSAGE);
  assert.equal(m.icon, "MessageSquare"); // metric default
});

test("normaliseMilestone falls back to messages for an unknown metric", () => {
  const m = normaliseMilestone({ id: "x", guild_id: "g", name: "Test", metric: "bogus", threshold: 5 });
  assert.equal(m.metric, "messages");
});

test("normaliseMilestone respects enabled=false and a custom message", () => {
  const m = normaliseMilestone({
    id: "x",
    guild_id: "g",
    name: "VIP",
    metric: "level",
    threshold: 25,
    enabled: false,
    message: "gg {user}",
    announce: "dm",
  });
  assert.equal(m.enabled, false);
  assert.equal(m.message, "gg {user}");
  assert.equal(m.announce, "dm");
});

// ── Metric resolution + progress ────────────────────────────────────────────

const SAMPLE = {
  join_age_days: 400,
  messages: 1500,
  voice_minutes: 90,
  events: 3,
  giveaways: 12,
  xp: 50000,
  level: 30,
};

test("metricValue reads the right field per metric", () => {
  assert.equal(metricValue(SAMPLE, "join_age"), 400);
  assert.equal(metricValue(SAMPLE, "messages"), 1500);
  assert.equal(metricValue(SAMPLE, "voice_minutes"), 90);
  assert.equal(metricValue(SAMPLE, "events"), 3);
  assert.equal(metricValue(SAMPLE, "giveaways"), 12);
  assert.equal(metricValue(SAMPLE, "xp"), 50000);
  assert.equal(metricValue(SAMPLE, "level"), 30);
});

test("isMet is an inclusive >= comparison", () => {
  assert.equal(isMet(100, 100), true);
  assert.equal(isMet(101, 100), true);
  assert.equal(isMet(99, 100), false);
});

test("milestoneProgress reports pct, met and remaining", () => {
  const p = milestoneProgress(50, 200);
  assert.equal(p.pct, 25);
  assert.equal(p.met, false);
  assert.equal(p.remaining, 150);

  const done = milestoneProgress(250, 200);
  assert.equal(done.pct, 100); // clamped
  assert.equal(done.met, true);
  assert.equal(done.remaining, 0);
});

// ── Formatting ────────────────────────────────────────────────────────────────

test("formatMetricValue humanises voice minutes and join age", () => {
  assert.equal(formatMetricValue("voice_minutes", 45), "45m");
  assert.equal(formatMetricValue("voice_minutes", 90), "1h 30m");
  assert.equal(formatMetricValue("voice_minutes", 120), "2h");
  assert.equal(formatMetricValue("join_age", 10), "10d");
  assert.equal(formatMetricValue("join_age", 90), "3mo");
  assert.equal(formatMetricValue("join_age", 400), "1y 1mo");
  assert.equal(formatMetricValue("level", 5), "Lvl 5");
});

test("describeThreshold reads naturally per metric", () => {
  // Use the runtime's own grouping so the test is locale-independent (the bot
  // uses toLocaleString(), which groups differently per host locale).
  const grp = (n) => n.toLocaleString();
  assert.equal(describeThreshold("messages", 1), "1 message");
  assert.equal(describeThreshold("messages", 1000), `${grp(1000)} messages`);
  assert.equal(describeThreshold("join_age", 365), "1y in server");
  assert.equal(describeThreshold("voice_minutes", 600), "10h in voice");
  assert.equal(describeThreshold("level", 25), "Level 25");
  assert.equal(describeThreshold("xp", 50000), `${grp(50000)} XP`);
});

// ── Message templating ────────────────────────────────────────────────────────

test("renderMilestoneMessage substitutes every placeholder", () => {
  const out = renderMilestoneMessage("{user} {mention} {milestone} {server} {value}", {
    user: "Ada",
    mention: "<@1>",
    milestone: "1 Year",
    server: "Guild",
    value: "1y",
  });
  assert.equal(out, "Ada <@1> 1 Year Guild 1y");
});

// ── metricsFromRow ──────────────────────────────────────────────────────────

test("metricsFromRow converts voice seconds to minutes and coalesces nulls", () => {
  const m = metricsFromRow({ messages: 10, voice_seconds: 3661, giveaways: 2 }, 12.9);
  assert.equal(m.messages, 10);
  assert.equal(m.voice_minutes, 61); // floor(3661/60)
  assert.equal(m.giveaways, 2);
  assert.equal(m.events, 0);
  assert.equal(m.xp, 0);
  assert.equal(m.join_age_days, 12); // floored
});

// ── Analytics rollup ──────────────────────────────────────────────────────────

test("computeMilestoneStats counts earned, active and most-earned", () => {
  const milestones = [
    { id: "a", name: "A", metric: "messages", enabled: true },
    { id: "b", name: "B", metric: "level", enabled: false },
    { id: "c", name: "C", metric: "join_age", enabled: true },
  ];
  const completions = [
    { milestone_id: "a", user_id: "u1" },
    { milestone_id: "a", user_id: "u2" },
    { milestone_id: "c", user_id: "u1" },
  ];
  const stats = computeMilestoneStats(milestones, completions);
  assert.equal(stats.total, 3);
  assert.equal(stats.active, 2);
  assert.equal(stats.totalEarned, 3);
  assert.equal(stats.membersRecognised, 2);
  assert.equal(stats.mostEarned.id, "a");
  assert.equal(stats.mostEarned.earned, 2);
});

test("computeMilestoneStats has no most-earned when nothing is earned", () => {
  const stats = computeMilestoneStats([{ id: "a", name: "A", metric: "xp", enabled: true }], []);
  assert.equal(stats.mostEarned, null);
});

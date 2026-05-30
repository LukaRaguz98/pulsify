// Tests for the bot's reputation scoring (pulse-bot/src/reputation.js), which
// MIRRORS pulsify-web-app/lib/reputation.ts. These lock the 0-100 score + tier
// math so the /profile embed agrees with the dashboard. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { computeReputation, tierForScore, daysSince } = require("../src/reputation");

test("tierForScore maps score bands to labels", () => {
  assert.equal(tierForScore(95), "Trusted");
  assert.equal(tierForScore(80), "Trusted");
  assert.equal(tierForScore(60), "Established");
  assert.equal(tierForScore(40), "Active");
  assert.equal(tierForScore(20), "Newcomer");
  assert.equal(tierForScore(0), "At risk");
});

test("computeReputation: a fresh account with no activity is near the baseline", () => {
  const r = computeReputation({});
  // baseline 15, everything else 0, no penalties → below the Newcomer band (20).
  assert.equal(r.score, 15);
  assert.equal(r.tier, "At risk");
});

test("computeReputation: an established, active member scores high", () => {
  const r = computeReputation({
    accountAgeDays: 800,
    tenureDays: 400,
    messages: 5000,
    voiceSeconds: 60 * 3600,
    commands: 100,
    activeChannels: 12,
    assignableRoles: 5,
  });
  assert.ok(r.score >= 80, `expected >=80, got ${r.score}`);
  assert.equal(r.tier, "Trusted");
});

test("computeReputation: heavy infractions push the score to zero (clamped)", () => {
  const r = computeReputation({
    accountAgeDays: 800,
    tenureDays: 400,
    messages: 5000,
    bans: 2,
    kicks: 1,
    warnings: 5,
  });
  assert.equal(r.score, 0);
  assert.equal(r.tier, "At risk");
});

test("daysSince floors a past timestamp and never goes negative", () => {
  assert.equal(daysSince(0), 0);
  assert.equal(daysSince(Date.now() + 100_000), 0); // future → 0
  const tenDaysAgo = Date.now() - 10 * 86_400_000;
  assert.equal(daysSince(tenDaysAgo), 10);
});

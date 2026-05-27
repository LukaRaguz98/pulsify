// Tests for the pure leveling logic shared by the bot and the dashboard
// (pulse-bot/src/leveling.js mirrors pulsify-web-app/lib/leveling.ts). Run with
// `npm test` (zero dependencies — Node's built-in test runner).
//
// Covers the curve math (the heart of "levels increase properly"), settings
// normalisation (the "on by default" + clamping behaviour), reward-role
// resolution (stacking vs. highest-only) and message templating.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_CURVE,
  xpToAdvance,
  xpForLevel,
  levelForXp,
  progressInLevel,
  defaultLevelingConfig,
  normaliseLevelingSettings,
  normaliseRewards,
  allRewardRoleIds,
  earnedRewardRoleIds,
  newlyEarnedRewards,
  renderLevelupMessage,
  progressBar,
} = require("../src/leveling");

// ── Curve math ────────────────────────────────────────────────────────────────

test("xpToAdvance follows the MEE6 polynomial for the default curve", () => {
  assert.equal(xpToAdvance(0), 100); // base only
  assert.equal(xpToAdvance(1), 5 + 50 + 100);
  assert.equal(xpToAdvance(2), 20 + 100 + 100);
});

test("xpForLevel is the cumulative sum and starts at 0", () => {
  assert.equal(xpForLevel(0), 0);
  assert.equal(xpForLevel(1), 100);
  assert.equal(xpForLevel(2), 255); // 100 + 155
  assert.equal(xpForLevel(3), 475); // 255 + 220
});

test("xpForLevel is strictly increasing", () => {
  let prev = -1;
  for (let l = 0; l <= 50; l++) {
    const xp = xpForLevel(l);
    assert.ok(xp > prev, `level ${l} xp ${xp} not greater than ${prev}`);
    prev = xp;
  }
});

test("levelForXp maps known boundaries correctly", () => {
  assert.equal(levelForXp(0), 0);
  assert.equal(levelForXp(99), 0);
  assert.equal(levelForXp(100), 1);
  assert.equal(levelForXp(254), 1);
  assert.equal(levelForXp(255), 2);
  assert.equal(levelForXp(474), 2);
  assert.equal(levelForXp(475), 3);
});

test("levelForXp / xpForLevel round-trip for many levels", () => {
  for (let l = 0; l <= 100; l++) {
    const start = xpForLevel(l);
    assert.equal(levelForXp(start), l, `at exact start of level ${l}`);
    if (l > 0) assert.equal(levelForXp(start - 1), l - 1, `one below start of level ${l}`);
  }
});

test("levelForXp never exceeds the cap and handles negatives", () => {
  assert.equal(levelForXp(-50), 0);
  assert.ok(levelForXp(Number.MAX_SAFE_INTEGER) <= 1000);
});

// ── Progress within a level ─────────────────────────────────────────────────────

test("progressInLevel is 0% at the start of a level", () => {
  const p = progressInLevel(255); // exact start of level 2
  assert.equal(p.level, 2);
  assert.equal(p.intoLevel, 0);
  assert.equal(p.span, 220);
  assert.equal(p.pct, 0);
  assert.equal(p.toNext, 220);
});

test("progressInLevel reports the half-way point", () => {
  const p = progressInLevel(255 + 110); // halfway through level 2 (span 220)
  assert.equal(p.level, 2);
  assert.equal(p.intoLevel, 110);
  assert.equal(p.pct, 50);
  assert.equal(p.toNext, 110);
  assert.equal(p.totalXp, 365);
});

test("progressInLevel respects a custom curve", () => {
  const curve = { base: 10, factor: 0, quadratic: 0 }; // flat 10 XP per level
  assert.equal(xpForLevel(5, curve), 50);
  assert.equal(levelForXp(50, curve), 5);
  assert.equal(progressInLevel(55, curve).pct, 50);
});

// ── Settings normalisation ──────────────────────────────────────────────────────

test("a missing row yields enabled defaults (XP on by default)", () => {
  const cfg = normaliseLevelingSettings(null);
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.curve, DEFAULT_CURVE);
  assert.equal(cfg.xp_per_message_min, 15);
  assert.equal(cfg.levelup_announce, "off");
});

test("normaliseLevelingSettings honours the enabled column", () => {
  assert.equal(normaliseLevelingSettings({ enabled: false, settings: {} }).enabled, false);
});

test("message XP min/max are swapped when inverted", () => {
  const cfg = normaliseLevelingSettings({ settings: { xp_per_message_min: 40, xp_per_message_max: 10 } });
  assert.equal(cfg.xp_per_message_min, 10);
  assert.equal(cfg.xp_per_message_max, 40);
});

test("out-of-range values clamp and bad enums fall back", () => {
  const cfg = normaliseLevelingSettings({
    settings: {
      message_cooldown_seconds: 999999,
      xp_multiplier: -5,
      levelup_announce: "nonsense",
      curve: { base: 0, factor: -10, quadratic: 999999 },
    },
  });
  assert.equal(cfg.message_cooldown_seconds, 86_400);
  assert.equal(cfg.xp_multiplier, 0);
  assert.equal(cfg.levelup_announce, "off");
  assert.equal(cfg.curve.base, 1); // clamped up from 0
  assert.equal(cfg.curve.factor, 0); // clamped up from -10
  assert.equal(cfg.curve.quadratic, 10_000); // clamped down
});

test("defaultLevelingConfig and a null row agree", () => {
  assert.deepEqual(normaliseLevelingSettings(null), defaultLevelingConfig());
});

// ── Reward roles ────────────────────────────────────────────────────────────────

test("normaliseRewards sorts, dedupes by level and drops invalid rows", () => {
  const rewards = normaliseRewards([
    { level: 10, role_id: "B" },
    { level: 5, role_id: "A" },
    { level: 5, role_id: "DUP" }, // duplicate level — dropped
    { level: 0, role_id: "X" }, // level < 1 — dropped
    { level: 3 }, // no role_id — dropped
  ]);
  assert.deepEqual(rewards, [
    { level: 5, role_id: "A" },
    { level: 10, role_id: "B" },
  ]);
});

test("earnedRewardRoleIds: highest-only vs. stacking", () => {
  const rewards = [
    { level: 5, role_id: "A" },
    { level: 10, role_id: "B" },
    { level: 20, role_id: "C" },
  ];
  // Highest-only at level 12 → just B.
  assert.deepEqual(earnedRewardRoleIds(12, rewards, false), ["B"]);
  // Stacking at level 12 → A and B.
  assert.deepEqual(earnedRewardRoleIds(12, rewards, true), ["A", "B"]);
  // Below the first reward → nothing.
  assert.deepEqual(earnedRewardRoleIds(4, rewards, false), []);
});

test("allRewardRoleIds dedupes shared roles", () => {
  const rewards = [
    { level: 5, role_id: "A" },
    { level: 10, role_id: "A" },
    { level: 20, role_id: "C" },
  ];
  assert.deepEqual(allRewardRoleIds(rewards).sort(), ["A", "C"]);
});

test("newlyEarnedRewards returns only rewards crossed in the jump", () => {
  const rewards = [
    { level: 5, role_id: "A" },
    { level: 10, role_id: "B" },
    { level: 20, role_id: "C" },
  ];
  assert.deepEqual(newlyEarnedRewards(4, 10, rewards), [
    { level: 5, role_id: "A" },
    { level: 10, role_id: "B" },
  ]);
  assert.deepEqual(newlyEarnedRewards(10, 12, rewards), []);
});

// ── Message templating + progress bar ─────────────────────────────────────────────

test("renderLevelupMessage substitutes every placeholder", () => {
  const out = renderLevelupMessage("{user} ({mention}) hit level {level} in {server}", {
    user: "Ana",
    mention: "<@1>",
    level: 7,
    server: "Pulse HQ",
  });
  assert.equal(out, "Ana (<@1>) hit level 7 in Pulse HQ");
});

test("progressBar fills proportionally and stays the requested width", () => {
  assert.equal(progressBar(0, 10), "░".repeat(10));
  assert.equal(progressBar(100, 10), "█".repeat(10));
  assert.equal(progressBar(50, 10).length, 10);
  assert.equal([...progressBar(50, 10)].filter((c) => c === "█").length, 5);
});

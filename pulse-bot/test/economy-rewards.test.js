// Tests for the pure economy-rewards logic shared by the bot and the dashboard
// (pulse-bot/src/economy-rewards.js mirrors pulsify-web-app/lib/economy-rewards.ts).
// Run with `npm test` (Node's built-in runner, zero dependencies).
//
// Covers settings normalisation/clamping, the multiplier stack (the "configurable
// multipliers" requirement, including the cap that protects economy integrity),
// streak resolution (daily/weekly claims + loyalty milestones + double-claim
// guard) and base-payout resolution (level-up scaling, giveaway multiplier).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  defaultRewardConfig,
  normaliseRewardSettings,
  combinedMultiplier,
  applyMultipliers,
  seasonalActive,
  resolveStreakClaim,
  baseAmountFor,
  dayIndex,
  weekIndex,
  REWARD_LIMITS,
} = require("../src/economy-rewards");

const DAY = 86_400_000;

test("defaults are sensible + enabled", () => {
  const c = defaultRewardConfig();
  assert.equal(c.enabled, true);
  assert.equal(c.activity.message.enabled, true);
  assert.ok(c.activity.message.amount > 0);
  assert.equal(c.giveaway.win.amount, 250); // preserves PULSIFY-45 rate
  assert.equal(c.progression.milestone.amount, 100);
});

test("normalise clamps out-of-range amounts + multipliers", () => {
  const cfg = normaliseRewardSettings({
    enabled: true,
    settings: {
      activity: { message: { amount: 9_999_999_999, cooldownSeconds: -5, dailyCap: -1 } },
      giveaway: { multiplier: 999 },
      multipliers: { booster: { value: 999 }, reputation: { maxBonusPct: 99999 } },
      antiAbuse: { minAccountAgeDays: -3 },
    },
  });
  assert.equal(cfg.activity.message.amount, REWARD_LIMITS.maxAmount);
  assert.equal(cfg.activity.message.cooldownSeconds, 0);
  assert.equal(cfg.activity.message.dailyCap, 0);
  assert.equal(cfg.giveaway.multiplier, REWARD_LIMITS.maxMultiplier);
  assert.equal(cfg.multipliers.booster.value, REWARD_LIMITS.maxMultiplier);
  assert.equal(cfg.multipliers.reputation.maxBonusPct, REWARD_LIMITS.maxBonusPct);
  assert.equal(cfg.antiAbuse.minAccountAgeDays, 0);
});

test("normalise falls back to defaults for a null row", () => {
  const c = normaliseRewardSettings(null);
  assert.deepEqual(c, defaultRewardConfig());
});

test("multipliers stack multiplicatively and are capped", () => {
  const cfg = defaultRewardConfig();
  cfg.multipliers.reputation = { enabled: true, maxBonusPct: 50 };
  cfg.multipliers.booster = { enabled: true, value: 1.5 };
  cfg.multipliers.event = { enabled: true, value: 2 };

  // rep 100 → 1.5×, booster → 1.5×, event (event category) → 2× ⇒ 4.5×
  const { factor } = combinedMultiplier(cfg, { category: "event", reputation: 100, isBooster: true });
  assert.ok(Math.abs(factor - 4.5) < 1e-9);

  // event multiplier should NOT apply to a non-event category
  const { factor: f2 } = combinedMultiplier(cfg, { category: "activity", reputation: 0, isBooster: true });
  assert.ok(Math.abs(f2 - 1.5) < 1e-9);

  // runaway config is clamped to the cap
  cfg.multipliers.seasonal = { enabled: true, value: 10, label: "x", startsAt: null, endsAt: null };
  const { factor: f3 } = combinedMultiplier(cfg, { category: "event", reputation: 100, isBooster: true });
  assert.equal(f3, REWARD_LIMITS.maxMultiplier);
});

test("applyMultipliers rounds and respects zero base", () => {
  const cfg = defaultRewardConfig();
  cfg.multipliers.booster = { enabled: true, value: 1.5 };
  assert.equal(applyMultipliers(10, cfg, { category: "activity", isBooster: true }), 15);
  assert.equal(applyMultipliers(0, cfg, { category: "activity", isBooster: true }), 0);
});

test("seasonalActive respects the window", () => {
  const now = Date.parse("2026-06-15T12:00:00Z");
  assert.equal(seasonalActive({ enabled: true, startsAt: null, endsAt: null }, now), true);
  assert.equal(seasonalActive({ enabled: false, startsAt: null, endsAt: null }, now), false);
  assert.equal(seasonalActive({ enabled: true, startsAt: "2026-06-16T00:00:00Z", endsAt: null }, now), false);
  assert.equal(seasonalActive({ enabled: true, startsAt: null, endsAt: "2026-06-14T00:00:00Z" }, now), false);
  assert.equal(seasonalActive({ enabled: true, startsAt: "2026-06-01T00:00:00Z", endsAt: "2026-06-30T00:00:00Z" }, now), true);
});

test("baseAmountFor scales level-up and applies the giveaway multiplier", () => {
  const cfg = defaultRewardConfig(); // levelUp base 25 + 5/level
  assert.equal(baseAmountFor(cfg, "progression", "levelUp", 1).base, 30);
  assert.equal(baseAmountFor(cfg, "progression", "levelUp", 10).base, 75);

  cfg.giveaway.multiplier = 2;
  assert.equal(baseAmountFor(cfg, "giveaway", "win").base, 500); // 250 × 2

  // a disabled/unknown source reports enabled:false, base:0
  assert.deepEqual(baseAmountFor(cfg, "giveaway", "multiplier"), { enabled: false, base: 0 });
});

test("resolveStreakClaim: first claim, consecutive, reset, milestone, double-claim", () => {
  const daily = { enabled: true, amount: 50, streakBonus: 5, streakMax: 200, milestones: [{ streak: 7, bonus: 100 }] };
  const t0 = 10 * DAY + 5_000; // somewhere inside day index 10

  // first claim → streak 1, no bonus
  const first = resolveStreakClaim(daily, t0, null, 0, dayIndex);
  assert.equal(first.claimable, true);
  assert.equal(first.streak, 1);
  assert.equal(first.amount, 50);

  // next day → streak 2, +5 bonus
  const next = resolveStreakClaim(daily, t0 + DAY, dayIndex(t0), 1, dayIndex);
  assert.equal(next.streak, 2);
  assert.equal(next.amount, 55);

  // same day again → not claimable
  const again = resolveStreakClaim(daily, t0 + 100, dayIndex(t0), 1, dayIndex);
  assert.equal(again.claimable, false);
  assert.equal(again.amount, 0);

  // skipped a day → reset to 1
  const skipped = resolveStreakClaim(daily, t0 + 3 * DAY, dayIndex(t0), 5, dayIndex);
  assert.equal(skipped.streak, 1);

  // hit the 7-day milestone exactly → base + 6×5 streak + 100 milestone
  const milestone = resolveStreakClaim(daily, t0 + DAY, dayIndex(t0), 6, dayIndex);
  assert.equal(milestone.streak, 7);
  assert.equal(milestone.milestoneBonus, 100);
  assert.equal(milestone.amount, 50 + 30 + 100);
});

test("weekly streak uses the week index", () => {
  const weekly = { enabled: true, amount: 250, streakBonus: 25, streakMax: 500, milestones: [] };
  const t0 = 100 * DAY;
  const first = resolveStreakClaim(weekly, t0, null, 0, weekIndex);
  assert.equal(first.streak, 1);
  // a day later is the SAME week → not claimable
  const sameWeek = resolveStreakClaim(weekly, t0 + DAY, weekIndex(t0), 1, weekIndex);
  assert.equal(sameWeek.claimable, false);
  // a week later → streak 2
  const nextWeek = resolveStreakClaim(weekly, t0 + 7 * DAY, weekIndex(t0), 1, weekIndex);
  assert.equal(nextWeek.streak, 2);
  assert.equal(nextWeek.amount, 275);
});

test("streak bonus is capped by streakMax", () => {
  const daily = { enabled: true, amount: 10, streakBonus: 5, streakMax: 12, milestones: [] };
  // streak 100 would be +495, capped to +12
  const r = resolveStreakClaim(daily, 50 * DAY, 50 * DAY / DAY - 1, 99, dayIndex);
  assert.equal(r.streak, 100);
  assert.equal(r.streakBonus, 12);
  assert.equal(r.amount, 22);
});

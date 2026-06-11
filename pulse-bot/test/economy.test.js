// Tests for the bot's global coin economy (pulse-bot/src/economy.js), which
// MIRRORS the rates in pulsify-web-app/lib/economy.ts. These lock the earning
// rates and the ledger descriptions so /wallet and the dashboard Economy view
// always agree. (Reputation is the existing 0-100 trust score — tested in
// reputation.test.js — so it isn't covered here.) Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  ECONOMY_RATES,
  coinsForXp,
  levelUpCoins,
  describeTransaction,
} = require("../src/economy");

test("coinsForXp: ceil(xp/5), zero for non-positive or invalid input", () => {
  assert.equal(coinsForXp(0), 0);
  assert.equal(coinsForXp(-10), 0);
  assert.equal(coinsForXp(NaN), 0);
  assert.equal(coinsForXp(1), 1); // ceil(1/5)
  assert.equal(coinsForXp(5), 1);
  assert.equal(coinsForXp(6), 2);
  assert.equal(coinsForXp(25), 5);
  assert.equal(coinsForXp(100), 20);
});

test("levelUpCoins: base + per-level bonus, floored at level 1", () => {
  const { levelUpBase, levelUpPerLevel } = ECONOMY_RATES;
  assert.equal(levelUpCoins(1), levelUpBase + levelUpPerLevel);
  assert.equal(levelUpCoins(10), levelUpBase + 10 * levelUpPerLevel);
  // Levels below 1 are clamped so the bonus never drops under the level-1 payout.
  assert.equal(levelUpCoins(0), levelUpCoins(1));
  assert.equal(levelUpCoins(-5), levelUpCoins(1));
});

test("describeTransaction: transfers name the counterparty", () => {
  assert.equal(
    describeTransaction({ kind: "transfer_in", counterparty_name: "Luka" }),
    "Transfer from Luka",
  );
  assert.equal(
    describeTransaction({ kind: "transfer_out", counterparty_name: null }),
    "Transfer to a member",
  );
});

test("describeTransaction: earns label the source and server", () => {
  assert.equal(
    describeTransaction({ kind: "earn", reason: "activity", guild_name: "Pulse HQ" }),
    "Server activity · Pulse HQ",
  );
  assert.equal(
    describeTransaction({ kind: "reward", reason: "giveaway_win", guild_name: null }),
    "Giveaway win",
  );
  assert.equal(describeTransaction({ kind: "earn", reason: "mystery" }), "Balance change");
});

test("rates sanity: coin awards and transfer cap are positive", () => {
  assert.ok(ECONOMY_RATES.giveawayWinCoins > 0);
  assert.ok(ECONOMY_RATES.milestoneCoins > 0);
  assert.ok(ECONOMY_RATES.onboardingCoins > 0);
  assert.ok(ECONOMY_RATES.maxTransfer > 0);
  assert.ok(ECONOMY_RATES.coinsPerXpDivisor > 0);
});

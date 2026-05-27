// Tests for the pure giveaway logic shared by the bot and the dashboard
// (pulse-bot/src/giveaways.js mirrors pulsify-web-app/lib/giveaways.ts). Run
// with `npm test` (zero dependencies — Node's built-in test runner).
//
// Covers the requirement scenarios called out in PULSIFY-25: no requirements,
// one requirement, multiple requirements, and the role / message-count /
// account-age requirements specifically — checking both the human-readable
// summary wording and the eligibility enforcement.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  describeRequirements,
  checkEligibility,
  pickWinners,
  hasRequirements,
  effectiveAccountAgeDays,
  normaliseRequirements,
} = require("../src/giveaways");

const DAY = 86_400_000;

/** A fully-shaped requirements object with the given fields overridden. */
const req = (overrides = {}) => normaliseRequirements(overrides);

/** Entrant facts that pass every gate, with overrides for the case under test. */
function facts(overrides = {}) {
  return {
    roleIds: [],
    accountCreatedAt: new Date(Date.now() - 365 * DAY),
    joinedAt: new Date(Date.now() - 365 * DAY),
    messageCount: 1000,
    ...overrides,
  };
}

// ── No requirements ────────────────────────────────────────────────────────────

test("no requirements: nothing to describe, everyone is eligible", () => {
  const r = req();
  assert.equal(hasRequirements(r), false);
  assert.deepEqual(describeRequirements(r), []);
  assert.deepEqual(checkEligibility(r, facts({ roleIds: [], messageCount: 0 })), { ok: true });
});

// ── Single requirements ─────────────────────────────────────────────────────────

test("message-count requirement: 'Minimum messages: N' + enforcement", () => {
  const r = req({ min_messages: 5 });
  assert.equal(hasRequirements(r), true);
  assert.deepEqual(describeRequirements(r), ["Minimum messages: 5"]);
  assert.equal(checkEligibility(r, facts({ messageCount: 4 })).ok, false);
  assert.equal(checkEligibility(r, facts({ messageCount: 5 })).ok, true);
});

test("account-age requirement: 'Account age: 7+ days' + enforcement", () => {
  const r = req({ min_account_age_days: 7 });
  assert.deepEqual(describeRequirements(r), ["Account age: 7+ days"]);
  assert.equal(
    checkEligibility(r, facts({ accountCreatedAt: new Date(Date.now() - 3 * DAY) })).ok,
    false,
  );
  assert.equal(
    checkEligibility(r, facts({ accountCreatedAt: new Date(Date.now() - 10 * DAY) })).ok,
    true,
  );
});

test("server-age requirement: 'In server: N+ days' + enforcement", () => {
  const r = req({ min_server_age_days: 3 });
  assert.deepEqual(describeRequirements(r), ["In server: 3+ days"]);
  assert.equal(checkEligibility(r, facts({ joinedAt: new Date(Date.now() - 1 * DAY) })).ok, false);
  assert.equal(checkEligibility(r, facts({ joinedAt: new Date(Date.now() - 5 * DAY) })).ok, true);
});

test("singular day labels read naturally", () => {
  assert.deepEqual(describeRequirements(req({ min_account_age_days: 1 })), ["Account age: 1+ day"]);
  assert.deepEqual(describeRequirements(req({ min_server_age_days: 1 })), ["In server: 1+ day"]);
});

// ── Role requirements ───────────────────────────────────────────────────────────

test("single role: name via resolver, mention by default", () => {
  const r = req({ required_role_ids: ["111"] });
  assert.deepEqual(describeRequirements(r, () => "Member"), ["Required role: Member"]);
  assert.deepEqual(describeRequirements(r), ["Required role: <@&111>"]);
  assert.equal(checkEligibility(r, facts({ roleIds: [] })).ok, false);
  assert.equal(checkEligibility(r, facts({ roleIds: ["111"] })).ok, true);
});

test("multiple roles: 'any' vs 'all' wording and logic", () => {
  const any = req({ required_role_ids: ["1", "2"], required_role_mode: "any" });
  assert.deepEqual(describeRequirements(any, (id) => `R${id}`), ["Required roles (any): R1, R2"]);
  assert.equal(checkEligibility(any, facts({ roleIds: ["2"] })).ok, true);
  assert.equal(checkEligibility(any, facts({ roleIds: ["9"] })).ok, false);

  const all = req({ required_role_ids: ["1", "2"], required_role_mode: "all" });
  assert.deepEqual(describeRequirements(all, (id) => `R${id}`), ["Required roles (all): R1, R2"]);
  assert.equal(checkEligibility(all, facts({ roleIds: ["1"] })).ok, false);
  assert.equal(checkEligibility(all, facts({ roleIds: ["1", "2"] })).ok, true);
});

// ── Anti-alt ────────────────────────────────────────────────────────────────────

test("anti-alt: enforces a 30-day account floor and labels it", () => {
  const r = req({ anti_alt: true });
  assert.equal(effectiveAccountAgeDays(r), 30);
  assert.deepEqual(describeRequirements(r), ["Account age: 30+ days"]);
  assert.equal(
    checkEligibility(r, facts({ accountCreatedAt: new Date(Date.now() - 10 * DAY) })).ok,
    false,
  );
});

test("explicit account age overrides the anti-alt default", () => {
  const r = req({ anti_alt: true, min_account_age_days: 60 });
  assert.equal(effectiveAccountAgeDays(r), 60);
  assert.deepEqual(describeRequirements(r), ["Account age: 60+ days"]);
});

// ── Multiple requirements ────────────────────────────────────────────────────────

test("multiple requirements: clean compact list, first failure wins", () => {
  const r = req({
    required_role_ids: ["9"],
    min_account_age_days: 7,
    min_server_age_days: 3,
    min_messages: 50,
  });
  assert.deepEqual(describeRequirements(r, () => "VIP"), [
    "Required role: VIP",
    "Account age: 7+ days",
    "In server: 3+ days",
    "Minimum messages: 50",
  ]);
  // Role is evaluated first, so a missing role surfaces the role reason.
  const verdict = checkEligibility(r, facts({ roleIds: [] }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /role/i);
  // Holding the role but lacking messages surfaces the message reason next.
  const v2 = checkEligibility(r, facts({ roleIds: ["9"], messageCount: 1 }));
  assert.equal(v2.ok, false);
  assert.match(v2.reason, /message/i);
  // Everything satisfied → eligible.
  assert.equal(checkEligibility(r, facts({ roleIds: ["9"] })).ok, true);
});

// ── Winner pick ──────────────────────────────────────────────────────────────────

test("pickWinners: honours count, dedupes entrants, excludes ids", () => {
  assert.equal(pickWinners(["a", "b", "c"], 2).length, 2);
  assert.equal(pickWinners(["a", "a", "b"], 5).length, 2); // de-duplicated pool
  const winners = pickWinners(["a", "b", "c"], 3, ["a"]);
  assert.ok(!winners.includes("a"));
  assert.equal(winners.length, 2);
  assert.deepEqual(pickWinners([], 3), []);
});

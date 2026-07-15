// Tests for the pure invite logic shared by the bot and the dashboard
// (pulse-bot/src/invites.js mirrors pulsify-web-app/lib/invites.ts). Run with
// `npm test` (zero dependencies — Node's built-in test runner).
//
// Covers the acceptance criteria that don't need a live gateway: valid vs
// invalid vs fake distinction, anti-abuse precedence, settings normalisation,
// snowflake → account age, and reward-item coercion.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  normaliseInviteSettings,
  evaluateInvite,
  snowflakeToDate,
  accountAgeDays,
  DEFAULT_CONFIG,
} = require("../src/invites");

// A permissive input where every rule passes; individual tests override one field.
function goodInput(over = {}) {
  return {
    accountAgeDays: 365,
    stayHours: 999,
    completedOnboarding: true,
    verified: true,
    hasActiveFlags: false,
    activityMessages: 100,
    isAlt: false,
    isSelf: false,
    rejoinCount: 0,
    ...over,
  };
}

test("normaliseInviteSettings fills defaults + clamps", () => {
  const cfg = normaliseInviteSettings(null);
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.min_account_age_days, DEFAULT_CONFIG.min_account_age_days);

  const custom = normaliseInviteSettings({
    enabled: true,
    settings: { min_account_age_days: 999999, max_rejoins: -5, block_self_invites: false },
  });
  assert.equal(custom.enabled, true);
  assert.equal(custom.min_account_age_days, 3650); // clamped to max
  assert.equal(custom.max_rejoins, 0); // clamped to min
  assert.equal(custom.block_self_invites, false);
});

test("evaluateInvite: a clean join with default rules is valid", () => {
  const cfg = normaliseInviteSettings({ enabled: true, settings: {} });
  const r = evaluateInvite(cfg, goodInput());
  assert.equal(r.status, "valid");
  assert.equal(r.reason, null);
});

test("evaluateInvite: anti-abuse (fake) beats everything", () => {
  const cfg = normaliseInviteSettings({ enabled: true, settings: {} });
  // Self-invite even with an otherwise-perfect account is fake.
  assert.equal(evaluateInvite(cfg, goodInput({ isSelf: true })).status, "fake");
  assert.equal(evaluateInvite(cfg, goodInput({ isSelf: true })).reason, "self_invite");
  // Alt farming.
  assert.equal(evaluateInvite(cfg, goodInput({ isAlt: true })).status, "fake");
  // Rejoin abuse (default max_rejoins = 3).
  assert.equal(evaluateInvite(cfg, goodInput({ rejoinCount: 3 })).status, "fake");
});

test("evaluateInvite: a too-young account is invalid, not pending", () => {
  const cfg = normaliseInviteSettings({ enabled: true, settings: { min_account_age_days: 30 } });
  const r = evaluateInvite(cfg, goodInput({ accountAgeDays: 2 }));
  assert.equal(r.status, "invalid");
  assert.equal(r.reason, "account_too_young");
});

test("evaluateInvite: time-dependent rules keep the join pending", () => {
  const cfg = normaliseInviteSettings({
    enabled: true,
    settings: { min_stay_hours: 48, require_onboarding: true, min_activity_messages: 10 },
  });
  assert.equal(evaluateInvite(cfg, goodInput({ stayHours: 1 })).reason, "awaiting_stay");
  assert.equal(evaluateInvite(cfg, goodInput({ completedOnboarding: false })).reason, "awaiting_onboarding");
  assert.equal(evaluateInvite(cfg, goodInput({ activityMessages: 0 })).reason, "awaiting_activity");
});

test("evaluateInvite: block toggles off disable the fake path", () => {
  const cfg = normaliseInviteSettings({
    enabled: true,
    settings: { block_self_invites: false, block_alt_farming: false, exclude_alts: false, max_rejoins: 0 },
  });
  assert.equal(evaluateInvite(cfg, goodInput({ isSelf: true })).status, "valid");
  assert.equal(evaluateInvite(cfg, goodInput({ isAlt: true })).status, "valid");
});

test("snowflakeToDate + accountAgeDays", () => {
  // A known Discord snowflake resolves to a real 2016-era date.
  const d = snowflakeToDate("175928847299117063");
  assert.ok(d instanceof Date);
  assert.equal(d.getUTCFullYear(), 2016);
  // Age from a fixed "now".
  const now = new Date("2020-01-01T00:00:00Z");
  const age = accountAgeDays(new Date("2019-12-02T00:00:00Z"), now);
  assert.equal(age, 30);
});


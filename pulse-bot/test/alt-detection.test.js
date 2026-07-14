// Tests for the pure alt-risk logic shared by the bot and the dashboard
// (pulse-bot/src/alt-detection.js mirrors pulsify-web-app/lib/alt-detection.ts).
// Run with `npm test` (zero dependencies — Node's built-in test runner).
//
// The calibration tests are the important ones. A risk model that flags every
// newcomer is worse than no model at all: moderators stop reading it. So these
// pin the two ends of the scale — a legitimate new member must NOT land in the
// actionable bands, and a throwaway account must — plus the correlation rules
// that decide when two accounts are "potentially linked" at all.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeAltRisk,
  correlateAccount,
  riskLevelForScore,
  isActionable,
  nameSimilarity,
  sharesNameStem,
  normaliseName,
  MIN_LINK_CONFIDENCE,
  MAX_AUTO_CONFIDENCE,
} = require("../src/alt-detection");

const NOW = new Date("2026-07-14T12:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const hoursAgo = (n) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

/** A clean baseline: every signal off, so each test only turns on what it means. */
function baseInput(overrides = {}) {
  return {
    accountCreatedAt: daysAgo(400),
    joinedAt: daysAgo(200),
    hasAvatar: true,
    messages: 0,
    voiceSeconds: 0,
    warnings: 0,
    timeouts: 0,
    kicks: 0,
    bans: 0,
    reputation: 50,
    coinBalance: 0,
    economyLifetime: 0,
    giveawayEntries: 0,
    applications: 0,
    onboardingEnabled: false,
    onboardingCompleted: false,
    onboardingVerified: false,
    guardFlags: 0,
    securityFlags: 0,
    priorConfirmedAlt: false,
    manualLinks: 0,
    now: NOW,
    ...overrides,
  };
}

const signalIds = (risk) => risk.signals.map((s) => s.id);

// ── Bands ─────────────────────────────────────────────────────────────────────

test("risk levels follow the published thresholds", () => {
  assert.equal(riskLevelForScore(0), "low");
  assert.equal(riskLevelForScore(24), "low");
  assert.equal(riskLevelForScore(25), "moderate");
  assert.equal(riskLevelForScore(49), "moderate");
  assert.equal(riskLevelForScore(50), "high");
  assert.equal(riskLevelForScore(74), "high");
  assert.equal(riskLevelForScore(75), "critical");
  assert.equal(riskLevelForScore(100), "critical");
});

test("only high and critical are actionable", () => {
  assert.equal(isActionable("low"), false);
  assert.equal(isActionable("moderate"), false);
  assert.equal(isActionable("high"), true);
  assert.equal(isActionable("critical"), true);
});

test("the score is clamped to 0-100", () => {
  // Everything bad at once.
  const worst = computeAltRisk(
    baseInput({
      accountCreatedAt: hoursAgo(2),
      joinedAt: hoursAgo(1),
      hasAvatar: false,
      bans: 2,
      kicks: 1,
      reputation: 0,
      guardFlags: 8,
      securityFlags: 3,
      priorConfirmedAlt: true,
      manualLinks: 2,
      onboardingEnabled: true,
    }),
  );
  assert.equal(worst.score, 100);
  assert.equal(worst.level, "critical");

  // Everything good at once — mitigations must not drive the score negative.
  const best = computeAltRisk(
    baseInput({
      accountCreatedAt: daysAgo(1500),
      messages: 5000,
      reputation: 95,
      economyLifetime: 50_000,
      applications: 2,
      onboardingEnabled: true,
      onboardingCompleted: true,
      onboardingVerified: true,
    }),
  );
  assert.equal(best.score, 0);
  assert.equal(best.level, "low");
});

// ── Calibration ───────────────────────────────────────────────────────────────

test("a legitimate new member stays out of the actionable bands", () => {
  // Real person: made an account a couple of days ago, joined today, set an
  // avatar, hasn't spoken yet (they just arrived), hasn't done onboarding yet.
  const risk = computeAltRisk(
    baseInput({
      accountCreatedAt: daysAgo(2),
      joinedAt: hoursAgo(1),
      hasAvatar: true,
      reputation: 18, // a fresh account always scores low here
      onboardingEnabled: true,
    }),
  );
  assert.equal(isActionable(risk.level), false, `expected non-actionable, got ${risk.level} (${risk.score})`);
  // The grace periods must have suppressed the "no activity" and onboarding
  // signals — an hour-old member has had no chance at either.
  assert.ok(!signalIds(risk).includes("no_activity"));
  assert.ok(!signalIds(risk).includes("onboarding_incomplete"));
  assert.ok(!signalIds(risk).includes("unverified"));
});

test("a throwaway account lands in high or critical", () => {
  // Day-old account, joined minutes later, default avatar, nothing anywhere.
  const risk = computeAltRisk(
    baseInput({
      accountCreatedAt: hoursAgo(30),
      joinedAt: hoursAgo(1),
      hasAvatar: false,
      reputation: 12,
    }),
  );
  assert.ok(isActionable(risk.level), `expected actionable, got ${risk.level} (${risk.score})`);
  assert.ok(signalIds(risk).includes("default_avatar"));
  assert.ok(signalIds(risk).includes("fresh_account_fresh_join"));
});

test("an established member scores low even with a stale profile", () => {
  const risk = computeAltRisk(
    baseInput({
      accountCreatedAt: daysAgo(1200),
      joinedAt: daysAgo(400),
      messages: 800,
      reputation: 78,
      economyLifetime: 1200,
    }),
  );
  assert.equal(risk.level, "low");
  assert.ok(signalIds(risk).includes("established_account"));
  assert.ok(signalIds(risk).includes("established_activity"));
  assert.ok(signalIds(risk).includes("trusted_reputation"));
});

test("a returning ban evader is dominated by its prior-alt history", () => {
  const input = baseInput({
    accountCreatedAt: daysAgo(10),
    joinedAt: hoursAgo(6),
    hasAvatar: false,
    reputation: 10,
    priorConfirmedAlt: true,
  });
  const risk = computeAltRisk(input);
  assert.ok(isActionable(risk.level), `expected actionable, got ${risk.level} (${risk.score})`);
  // A closed investigation that already confirmed this account is the single
  // heaviest signal in the model, so it must lead the factor list.
  assert.equal(risk.signals[0].id, "prior_alt");

  // And it must be what carries the account into the actionable bands: without
  // it, the same profile is only moderate.
  const without = computeAltRisk({ ...input, priorConfirmedAlt: false });
  assert.ok(risk.score - without.score >= 25);
});

// ── Individual signals ────────────────────────────────────────────────────────

test("activity signals wait out the grace period", () => {
  const fresh = computeAltRisk(baseInput({ joinedAt: hoursAgo(6), messages: 0 }));
  assert.ok(!signalIds(fresh).includes("no_activity"));

  const settled = computeAltRisk(baseInput({ joinedAt: daysAgo(30), messages: 0 }));
  assert.ok(signalIds(settled).includes("no_activity"));
});

test("onboarding signals are skipped when the guild doesn't run onboarding", () => {
  const off = computeAltRisk(baseInput({ onboardingEnabled: false }));
  assert.ok(!signalIds(off).includes("onboarding_incomplete"));
  assert.ok(!signalIds(off).includes("unverified"));

  const on = computeAltRisk(baseInput({ onboardingEnabled: true }));
  assert.ok(signalIds(on).includes("onboarding_incomplete"));
  assert.ok(signalIds(on).includes("unverified"));
});

test("giveaway farming only fires for accounts that enter but never talk", () => {
  const farmer = computeAltRisk(baseInput({ giveawayEntries: 4, messages: 1 }));
  assert.ok(signalIds(farmer).includes("giveaway_farming"));

  const participant = computeAltRisk(baseInput({ giveawayEntries: 4, messages: 300 }));
  assert.ok(!signalIds(participant).includes("giveaway_farming"));
});

test("mitigating signals carry negative points and are reported separately", () => {
  const risk = computeAltRisk(baseInput({ messages: 500, reputation: 90 }));
  const mitigating = risk.signals.filter((s) => s.tone === "mitigating");
  assert.ok(mitigating.length >= 2);
  assert.ok(mitigating.every((s) => s.points < 0));
  assert.ok(risk.mitigatingPoints > 0);
});

test("signals are ordered heaviest-risk first", () => {
  const risk = computeAltRisk(
    baseInput({ accountCreatedAt: hoursAgo(5), joinedAt: hoursAgo(1), hasAvatar: false, messages: 400 }),
  );
  const points = risk.signals.map((s) => s.points);
  assert.deepEqual(points, [...points].sort((a, b) => b - a));
});

test("an unknown account age simply omits the age signals", () => {
  const risk = computeAltRisk(baseInput({ accountCreatedAt: null }));
  assert.ok(!signalIds(risk).includes("new_account"));
  assert.ok(!signalIds(risk).includes("established_account"));
});

// ── Names ─────────────────────────────────────────────────────────────────────

test("normaliseName strips case and punctuation", () => {
  assert.equal(normaliseName("Luka_R!"), "lukar");
  assert.equal(normaliseName("nova.99"), "nova99");
});

test("nameSimilarity scores edit distance on normalised names", () => {
  assert.equal(nameSimilarity("luka", "luka"), 1);
  assert.ok(nameSimilarity("nightowl", "nightowls") > 0.85);
  assert.ok(nameSimilarity("nightowl", "petunia") < 0.4);
  assert.equal(nameSimilarity("", "luka"), 0);
});

test("sharesNameStem catches the numbered-alt pattern", () => {
  assert.equal(sharesNameStem("raguz", "raguz2"), true);
  assert.equal(sharesNameStem("nova", "nova99"), true);
  // Identical names aren't a "variant" — they're the same handle.
  assert.equal(sharesNameStem("nova", "nova"), false);
  // Different stems.
  assert.equal(sharesNameStem("nova", "petunia2"), false);
  // Too short to be meaningful.
  assert.equal(sharesNameStem("ab", "ab2"), false);
});

// ── Correlation ───────────────────────────────────────────────────────────────

const subject = {
  userId: "1",
  username: "nightowl",
  accountCreatedAt: daysAgo(300),
  joinedAt: daysAgo(30),
};

function candidate(overrides = {}) {
  return {
    userId: "2",
    username: "petunia",
    accountCreatedAt: daysAgo(900),
    joinedAt: daysAgo(500),
    risk: null,
    sharedModeration: null,
    sharedEconomy: 0,
    manualLink: null,
    ...overrides,
  };
}

test("an unrelated account produces no link", () => {
  assert.equal(correlateAccount(subject, candidate()), null);
});

test("a single weak coincidence is not a link", () => {
  // Joined the same day (weight 0.12) and nothing else — well under the floor.
  const link = correlateAccount(subject, candidate({ joinedAt: daysAgo(30) }));
  assert.equal(link, null);
});

test("a strong single indicator is enough", () => {
  const link = correlateAccount(subject, candidate({ username: "nightowl2" }));
  assert.ok(link);
  assert.ok(link.confidence >= MIN_LINK_CONFIDENCE);
  assert.equal(link.indicators[0].id, "username");
});

test("independent indicators compound", () => {
  const nameOnly = correlateAccount(subject, candidate({ username: "nightowl2" }));
  const nameAndJoin = correlateAccount(
    subject,
    candidate({ username: "nightowl2", joinedAt: subject.joinedAt }),
  );
  assert.ok(nameAndJoin.confidence > nameOnly.confidence);
  assert.equal(nameAndJoin.indicators.length, 2);
});

test("automatic confidence never claims certainty", () => {
  // Everything correlates at once.
  const link = correlateAccount(
    subject,
    candidate({
      username: "nightowl2",
      joinedAt: subject.joinedAt,
      accountCreatedAt: subject.accountCreatedAt,
      sharedModeration: { namesSubject: true },
      sharedEconomy: 12,
    }),
  );
  assert.ok(link.confidence <= MAX_AUTO_CONFIDENCE);
  assert.equal(link.manual, false);
});

test("a moderator-asserted link outranks the computed signals", () => {
  const link = correlateAccount(
    subject,
    candidate({ manualLink: { confidence: 100, note: "same person, admitted it" } }),
  );
  assert.equal(link.manual, true);
  assert.equal(link.confidence, 100);
  assert.equal(link.indicators[0].id, "manual");
});

test("an account is never linked to itself", () => {
  assert.equal(correlateAccount(subject, candidate({ userId: subject.userId })), null);
});

test("indicators are ordered strongest first", () => {
  const link = correlateAccount(
    subject,
    candidate({
      username: "nightowl2", // 0.5
      joinedAt: daysAgo(30), // same day → 0.12
      sharedEconomy: 5, // 0.4
    }),
  );
  const weights = link.indicators.map((i) => i.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
});

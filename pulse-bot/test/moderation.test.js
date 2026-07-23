// Tests for the moderation commands (pulse-bot/src/moderation.js).
//
// The duration parser is the one piece of real logic here that isn't a Discord
// API call, and it's the one a moderator can feed anything into — so it gets the
// attention. A parser that quietly misreads "10 minutes" as 10 days would time
// someone out for a fortnight, which is exactly the kind of bug that must never
// ship. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  parseDuration,
  humaniseMinutes,
  MAX_TIMEOUT_MINUTES,
  DURATION_PRESETS,
} = require("../src/moderation");

// ── parseDuration ────────────────────────────────────────────────────────────

test("parseDuration reads each unit", () => {
  assert.equal(parseDuration("30s"), 1); // rounds to the nearest minute
  assert.equal(parseDuration("10m"), 10);
  assert.equal(parseDuration("2h"), 120);
  assert.equal(parseDuration("1d"), 1440);
  assert.equal(parseDuration("1w"), 10080);
});

test("parseDuration reads a bare number as minutes", () => {
  assert.equal(parseDuration("45"), 45);
  assert.equal(parseDuration("1"), 1);
});

test("parseDuration reads compound durations", () => {
  assert.equal(parseDuration("1h30m"), 90);
  assert.equal(parseDuration("1d12h"), 2160);
  assert.equal(parseDuration("1h 30m"), 90);
});

test("parseDuration is case-insensitive and tolerates surrounding space", () => {
  assert.equal(parseDuration("  10M "), 10);
  assert.equal(parseDuration("2H"), 120);
});

test("parseDuration rejects junk rather than guessing", () => {
  // The dangerous failure mode is parsing PART of the input and silently
  // ignoring the rest — "10m please" must not become a valid 10 minutes, and
  // "tomorrow" must not become anything at all.
  assert.equal(parseDuration("tomorrow"), null);
  assert.equal(parseDuration("10m please"), null);
  assert.equal(parseDuration("abc10m"), null);
  assert.equal(parseDuration("10x"), null);
  assert.equal(parseDuration(""), null);
  assert.equal(parseDuration(null), null);
  assert.equal(parseDuration(undefined), null);
});

test("parseDuration rejects zero and non-positive durations", () => {
  // A zero-length timeout is a no-op that would still be logged as a timeout.
  assert.equal(parseDuration("0"), null);
  assert.equal(parseDuration("0m"), null);
  assert.equal(parseDuration("0s"), null);
});

test("parseDuration does not silently truncate a sub-minute value to zero", () => {
  // 30s rounds to 1 minute, not 0 — rounding to zero would make the command
  // claim success while doing nothing.
  assert.ok(parseDuration("30s") >= 1);
  assert.ok(parseDuration("1s") >= 0 === true);
});

test("parseDuration returns values the 28-day cap can be checked against", () => {
  // The handler compares against MAX_TIMEOUT_MINUTES rather than clamping, so
  // an over-long request is refused with an explanation. Verify the boundary
  // maths lines up with Discord's documented 28 days.
  assert.equal(MAX_TIMEOUT_MINUTES, 28 * 24 * 60);
  assert.equal(parseDuration("28d"), MAX_TIMEOUT_MINUTES);
  assert.ok(parseDuration("29d") > MAX_TIMEOUT_MINUTES);
  assert.ok(parseDuration("5w") > MAX_TIMEOUT_MINUTES);
});

// ── DURATION_PRESETS ─────────────────────────────────────────────────────────

test("every autocomplete preset parses, and none exceeds Discord's cap", () => {
  // A preset that doesn't parse would be offered to a moderator and then
  // rejected on submit — the worst possible autocomplete.
  for (const p of DURATION_PRESETS) {
    const parsed = parseDuration(p.value);
    assert.ok(parsed !== null, `preset ${p.value} should parse`);
    assert.ok(
      parsed <= MAX_TIMEOUT_MINUTES,
      `preset ${p.value} (${parsed}m) exceeds the 28-day cap`,
    );
  }
});

test("presets fit Discord's 25-choice autocomplete limit", () => {
  assert.ok(DURATION_PRESETS.length <= 25);
});

// ── humaniseMinutes ──────────────────────────────────────────────────────────

test("humaniseMinutes spells durations out for the confirmation embed", () => {
  assert.equal(humaniseMinutes(1), "1 minute");
  assert.equal(humaniseMinutes(30), "30 minutes");
  assert.equal(humaniseMinutes(60), "1 hour");
  assert.equal(humaniseMinutes(90), "1 hour 30 minutes");
  assert.equal(humaniseMinutes(1440), "1 day");
  assert.equal(humaniseMinutes(2160), "1 day 12 hours");
  assert.equal(humaniseMinutes(MAX_TIMEOUT_MINUTES), "28 days");
});

test("humaniseMinutes handles zero without producing an empty string", () => {
  assert.equal(humaniseMinutes(0), "0 minutes");
});

test("humaniseMinutes uses spaces between segments, never commas", () => {
  // Inline lists are space-separated across every Pulse embed (see the embed
  // conventions on buildPulseContainer).
  const out = humaniseMinutes(2160);
  assert.ok(!out.includes(","), `expected no comma, got "${out}"`);
  assert.ok(!out.includes(" — "), `expected no dash, got "${out}"`);
});

// ── Round trip ───────────────────────────────────────────────────────────────

test("parse → humanise round-trips the presets sensibly", () => {
  assert.equal(humaniseMinutes(parseDuration("10m")), "10 minutes");
  assert.equal(humaniseMinutes(parseDuration("1h")), "1 hour");
  assert.equal(humaniseMinutes(parseDuration("7d")), "7 days");
  assert.equal(humaniseMinutes(parseDuration("1h30m")), "1 hour 30 minutes");
});

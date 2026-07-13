// Tests for the pure birthday logic shared by the bot and the dashboard
// (pulse-bot/src/birthdays.js mirrors pulsify-web-app/lib/birthdays.ts). Run
// with `npm test` (zero dependencies — Node's built-in test runner).
//
// Covers the tricky bits: timezone-aware "today" evaluation, leap-day handling,
// day-until countdown, settings normalisation/clamping, and message templating —
// i.e. the acceptance criteria "announcements post on the right day" and
// "privacy options work correctly".

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_BIRTHDAY_MESSAGE,
  isLeapYear,
  isValidTimeZone,
  partsInTimeZone,
  birthdayOccursOn,
  daysUntilBirthday,
  ageInYear,
  formatBirthday,
  countdownLabel,
  validateBirthday,
  normaliseBirthdaySettings,
  renderBirthdayMessage,
} = require("../src/birthdays");

test("isLeapYear follows the Gregorian rule", () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2023), false);
  assert.equal(isLeapYear(1900), false); // divisible by 100, not 400
  assert.equal(isLeapYear(2000), true); // divisible by 400
});

test("isValidTimeZone accepts IANA zones and rejects junk", () => {
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(null), false);
});

test("partsInTimeZone returns wall-clock parts and normalises midnight hour", () => {
  // 2026-03-14 06:30 UTC → still Mar 14 in UTC.
  const d = new Date(Date.UTC(2026, 2, 14, 6, 30));
  const utc = partsInTimeZone(d, "UTC");
  assert.deepEqual({ year: utc.year, month: utc.month, day: utc.day }, { year: 2026, month: 3, day: 14 });
  // A far-east zone at the same instant may be on the next calendar day.
  const tokyo = partsInTimeZone(new Date(Date.UTC(2026, 2, 14, 20, 0)), "Asia/Tokyo");
  assert.equal(tokyo.day, 15); // 20:00 UTC + 9h = 05:00 next day
});

test("birthdayOccursOn matches the local day, folding Feb 29 to Feb 28 off-leap", () => {
  assert.equal(birthdayOccursOn(3, 14, { year: 2026, month: 3, day: 14, hour: 9 }), true);
  assert.equal(birthdayOccursOn(3, 14, { year: 2026, month: 3, day: 13, hour: 9 }), false);
  // Feb 29 birthday in a non-leap year celebrates on Feb 28.
  assert.equal(birthdayOccursOn(2, 29, { year: 2026, month: 2, day: 28, hour: 9 }), true);
  // ...but on the real Feb 29 in a leap year.
  assert.equal(birthdayOccursOn(2, 29, { year: 2028, month: 2, day: 29, hour: 9 }), true);
  assert.equal(birthdayOccursOn(2, 29, { year: 2028, month: 2, day: 28, hour: 9 }), false);
});

test("daysUntilBirthday counts whole days and wraps to next year", () => {
  const now = new Date(Date.UTC(2026, 2, 10, 12, 0)); // Mar 10
  assert.equal(daysUntilBirthday(3, 14, now, "UTC"), 4); // Mar 14
  assert.equal(daysUntilBirthday(3, 10, now, "UTC"), 0); // today
  assert.equal(daysUntilBirthday(3, 9, now, "UTC"), 364); // already passed → next year
});

test("ageInYear derives the age turned, or null without a birth year", () => {
  assert.equal(ageInYear(2000, 2026), 26);
  assert.equal(ageInYear(null, 2026), null);
  assert.equal(ageInYear(undefined, 2026), null);
});

test("formatBirthday honours the show-year flag", () => {
  assert.equal(formatBirthday(3, 14, 1998, true), "March 14, 1998");
  assert.equal(formatBirthday(3, 14, 1998, false), "March 14");
  assert.equal(formatBirthday(3, 14, null, true), "March 14");
});

test("countdownLabel reads naturally", () => {
  assert.equal(countdownLabel(0), "Today");
  assert.equal(countdownLabel(1), "Tomorrow");
  assert.equal(countdownLabel(3), "in 3 days");
  assert.equal(countdownLabel(14), "in 2 weeks");
  assert.equal(countdownLabel(60), "in 2 months");
});

test("validateBirthday rejects impossible dates and enforces the age floor", () => {
  assert.equal(validateBirthday(3, 14, 1998), null);
  assert.equal(validateBirthday(3, 14, null), null);
  assert.match(validateBirthday(13, 1, null), /valid month/);
  assert.match(validateBirthday(2, 30, null), /February only has 29 days/);
  assert.match(validateBirthday(2, 29, 1901), /not a leap year/);
  assert.match(validateBirthday(3, 14, 1800), /1900 or later/);
  assert.match(validateBirthday(3, 14, new Date().getUTCFullYear()), /at least 13/);
});

test("normaliseBirthdaySettings applies defaults, clamps and drops bad URLs", () => {
  const base = normaliseBirthdaySettings(null);
  assert.equal(base.enabled, false);
  assert.equal(base.announce_hour, 9);
  assert.equal(base.message, DEFAULT_BIRTHDAY_MESSAGE);

  const clamped = normaliseBirthdaySettings({
    enabled: true,
    settings: {
      announce_hour: 99,
      timezone: "Not/AZone",
      reward_coins: -5,
      role_duration_hours: 100000,
      image_url: "javascript:alert(1)",
      button_url: "https://example.com/celebrate",
      mention: "bogus",
      reward_role_ids: ["a", "a", "b", 3],
    },
  });
  assert.equal(clamped.enabled, true);
  assert.equal(clamped.announce_hour, 23); // clamped to 0-23
  assert.equal(clamped.timezone, "UTC"); // invalid tz → default
  assert.equal(clamped.reward_coins, 0); // clamped to >= 0
  assert.equal(clamped.role_duration_hours, 24 * 14); // clamped to max
  assert.equal(clamped.image_url, null); // non-http(s) scheme rejected
  assert.equal(clamped.button_url, "https://example.com/celebrate");
  assert.equal(clamped.mention, "user"); // invalid mention → default
  assert.deepEqual(clamped.reward_role_ids, ["a", "b"]); // deduped, non-strings dropped
});

test("renderBirthdayMessage substitutes every placeholder", () => {
  const out = renderBirthdayMessage("Happy birthday {mention} — {user} turns {age} on {date} in {server}!", {
    user: "Ada",
    mention: "@Ada",
    server: "Testville",
    age: 26,
    date: "March 14",
  });
  assert.equal(out, "Happy birthday @Ada — Ada turns 26 on March 14 in Testville!");
});

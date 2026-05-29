// Tests for the pure presence logic shared by the bot and the dashboard
// (pulse-bot/src/presence.js mirrors pulsify-web-app/lib/presence.ts). Run with
// `npm test` (zero dependencies — Node's built-in test runner).
//
// Covers the placeholder swap (dynamic {servers}/{members}/… resolution), the
// config normalisation (defaults, clamping, kind/status validation), uptime
// formatting and schedule-window matching — the bits that MUST agree between
// the two sides for "dynamic placeholders update live" and "rotating statuses
// function properly".

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolvePlaceholders,
  normalisePresenceConfig,
  formatUptime,
  scheduleMatches,
} = require("../src/presence");

test("resolvePlaceholders swaps known tokens and formats numbers", () => {
  const vars = { servers: 1234, members: 56789, tickets: 7, giveaways: 2, mod_actions: 0, uptime: "3d 4h" };
  assert.equal(resolvePlaceholders("In {servers} servers", vars), "In 1,234 servers");
  assert.equal(resolvePlaceholders("{members} members", vars), "56,789 members");
  assert.equal(resolvePlaceholders("up {uptime}", vars), "up 3d 4h");
  // mod_actions = 0 still renders (not blank).
  assert.equal(resolvePlaceholders("{mod_actions} actions", vars), "0 actions");
});

test("resolvePlaceholders leaves unknown tokens untouched and tolerates empties", () => {
  assert.equal(resolvePlaceholders("hello {unknown}", { servers: 1 }), "hello {unknown}");
  assert.equal(resolvePlaceholders("", {}), "");
  // A missing var collapses to empty string rather than literal undefined.
  assert.equal(resolvePlaceholders("a{members}b", {}), "ab");
});

test("normalisePresenceConfig applies defaults for a null row", () => {
  const cfg = normalisePresenceConfig(null, "g1");
  assert.equal(cfg.guildId, "g1");
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.status, "online");
  assert.deepEqual(cfg.activities, []);
  assert.equal(cfg.rotationEnabled, true);
  assert.equal(cfg.rotationIntervalSeconds, 30);
  assert.equal(cfg.maintenanceMode, false);
});

test("normalisePresenceConfig clamps interval and validates enums", () => {
  const cfg = normalisePresenceConfig(
    {
      enabled: true,
      status: "bogus",
      rotation_interval_seconds: 99999,
      activities: [
        { kind: "watching", text: "{members} members" },
        { kind: "nonsense", text: "" }, // dropped: no text + invalid → still kind defaults but empty text drops it
        { kind: "custom", text: "" }, // kept: custom may be empty
      ],
    },
    "g2",
  );
  assert.equal(cfg.status, "online"); // invalid → default
  assert.equal(cfg.rotationIntervalSeconds, 3600); // clamped to max
  // First activity kept, the empty non-custom dropped, custom-empty kept.
  assert.equal(cfg.activities.length, 2);
  assert.equal(cfg.activities[0].kind, "watching");
  assert.equal(cfg.activities[1].kind, "custom");
});

test("formatUptime renders compact human strings", () => {
  assert.equal(formatUptime(0), "0m");
  assert.equal(formatUptime(8 * 60 * 1000), "8m");
  assert.equal(formatUptime((5 * 60 + 12) * 60 * 1000), "5h 12m");
  assert.equal(formatUptime((3 * 1440 + 4 * 60) * 60 * 1000), "3d 4h");
});

test("scheduleMatches honours days and wrapping windows (UTC)", () => {
  // Wednesday 2026-06-03 10:30 UTC.
  const wed = new Date(Date.UTC(2026, 5, 3, 10, 30));
  assert.equal(scheduleMatches({ days: [], start: "09:00", end: "17:00", activity: {} }, wed), true);
  assert.equal(scheduleMatches({ days: [3], start: "09:00", end: "17:00", activity: {} }, wed), true);
  assert.equal(scheduleMatches({ days: [1], start: "09:00", end: "17:00", activity: {} }, wed), false);
  // Outside the window.
  assert.equal(scheduleMatches({ days: [], start: "11:00", end: "17:00", activity: {} }, wed), false);
  // Wrapping window (22:00 → 06:00) — 10:30 is outside.
  assert.equal(scheduleMatches({ days: [], start: "22:00", end: "06:00", activity: {} }, wed), false);
  // 02:00 UTC is inside a wrapping window.
  const lateNight = new Date(Date.UTC(2026, 5, 3, 2, 0));
  assert.equal(scheduleMatches({ days: [], start: "22:00", end: "06:00", activity: {} }, lateNight), true);
});

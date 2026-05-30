// Tests for the version / release-notes module (pulse-bot/src/version.js) that
// powers /version, /changelog, /release-notes and the startup banner. Run with
// `npm test` (zero dependencies — Node's built-in test runner).
//
// Covers the release-notes parser (header + lead + highlights + outro), version
// comparison/sorting, the disk loader (it should read the real
// resources/notes/ files and surface the newest release first), and the link
// helpers that the embed buttons depend on.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  parseRelease,
  compareVersion,
  loadReleases,
  getLatestRelease,
  getCurrentVersion,
  getReleaseNotesUrl,
  getDashboardUrl,
  getInviteUrl,
  PULSE_VERSION,
} = require("../src/version");

const SAMPLE = `**Pulsify v9.9.9 — Test Release**
A short lead description.

**What's new**
- **Feature A** — does a thing
- Plain bullet item

**Also**
- Another item

Closing line.
`;

test("parseRelease extracts version, title, description, highlights and outro", () => {
  const r = parseRelease(SAMPLE, new Date("2026-05-29T00:00:00Z"));
  assert.equal(r.version, "9.9.9");
  assert.equal(r.title, "Test Release");
  assert.equal(r.description, "A short lead description.");
  assert.deepEqual(r.highlights, [
    "**Feature A** — does a thing",
    "Plain bullet item",
    "Another item",
  ]);
  assert.equal(r.outro, "Closing line.");
});

test("parseRelease returns null when the header line is missing", () => {
  assert.equal(parseRelease("Just some text\n- a bullet", new Date()), null);
  assert.equal(parseRelease("", new Date()), null);
});

test("compareVersion orders semver-style versions numerically", () => {
  assert.ok(compareVersion("0.31.0", "0.30.0") > 0);
  assert.ok(compareVersion("0.9.0", "0.10.0") < 0);
  assert.equal(compareVersion("1.2.3", "1.2.3"), 0);
  // Missing segments are treated as 0.
  assert.ok(compareVersion("1.2", "1.2.0") === 0);
});

test("loadReleases reads the shared notes folder, newest first", async () => {
  const releases = await loadReleases({ force: true });
  assert.ok(Array.isArray(releases) && releases.length > 0);
  // Sorted descending by version.
  for (let i = 1; i < releases.length; i++) {
    assert.ok(compareVersion(releases[i - 1].version, releases[i].version) >= 0);
  }
  // The release shipped with this feature should be present.
  assert.ok(releases.some((r) => r.version === "0.31.0"));
});

test("getLatestRelease / getCurrentVersion agree and look like a version", async () => {
  const latest = await getLatestRelease();
  const current = await getCurrentVersion();
  assert.equal(latest.version, current);
  assert.match(current, /^\d+\.\d+\.\d+$/);
});

test("PULSE_VERSION constant is a valid semver string", () => {
  assert.match(PULSE_VERSION, /^\d+\.\d+\.\d+$/);
});

test("link helpers respect env and build valid URLs", () => {
  process.env.APP_URL = "https://example.com";
  process.env.DISCORD_CLIENT_ID = "123456789";

  assert.equal(getReleaseNotesUrl(), "https://example.com/release-notes");
  assert.equal(getDashboardUrl("g1"), "https://example.com/dashboard/g1");
  assert.equal(getDashboardUrl(), "https://example.com/dashboard");

  const invite = getInviteUrl("g1");
  assert.ok(invite.startsWith("https://discord.com/oauth2/authorize?"));
  assert.ok(invite.includes("client_id=123456789"));
  assert.ok(invite.includes("scope=bot+applications.commands"));
  assert.ok(invite.includes("guild_id=g1"));
});

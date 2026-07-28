// Tests for the Gaming Analytics presence tracker (PULSIFY-64).
//
// The module's whole value is that a play session's duration is real. That
// makes three things worth pinning: what counts as a game at all (Discord
// reports Spotify and custom statuses through the same field), who is excluded
// before anything is written, and the settings normaliser the bot and the
// dashboard must agree on. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ActivityType } = require("discord.js");

const {
  normaliseGamingSettings,
  gameKeyOf,
  pickGameActivity,
  isStreaming,
  exclusionReason,
  formatDuration,
  DEFAULT_CONFIG,
} = require("../src/gaming");
const { COMMANDS_BY_NAME } = require("../src/commands");
const featureGate = require("../src/feature-gate");

// ── Game key normalisation ───────────────────────────────────────────────

test("gameKeyOf folds the casing and whitespace Discord clients disagree about", () => {
  assert.equal(gameKeyOf("Counter-Strike 2"), "counter-strike 2");
  assert.equal(gameKeyOf("  Counter-Strike 2  "), "counter-strike 2");
  assert.equal(gameKeyOf("COUNTER-STRIKE   2"), "counter-strike 2");
  // Without this the same game splits into several rows in every ranking.
  assert.equal(gameKeyOf("PUBG"), gameKeyOf("pubg"));
  assert.equal(gameKeyOf(null), "");
});

// ── Activity selection ───────────────────────────────────────────────────

const presence = (...activities) => ({ activities });

test("pickGameActivity takes Playing and ignores Spotify, custom status and video", () => {
  const p = presence(
    { type: ActivityType.Custom, name: "hello world" },
    { type: ActivityType.Listening, name: "Spotify" },
    { type: ActivityType.Watching, name: "a video" },
    { type: ActivityType.Playing, name: "Helldivers 2", applicationId: "42" },
  );
  assert.deepEqual(pickGameActivity(p, DEFAULT_CONFIG), {
    name: "Helldivers 2",
    applicationId: "42",
  });
});

test("a custom status alone is never recorded as a game", () => {
  // The regression this guards: a member whose status reads "playing with fire"
  // must not appear on the leaderboard for a game of that name.
  const p = presence({ type: ActivityType.Custom, name: "playing with fire" });
  assert.equal(pickGameActivity(p, DEFAULT_CONFIG), null);
});

test("Spotify alone is never recorded as a game", () => {
  const p = presence({ type: ActivityType.Listening, name: "Spotify" });
  assert.equal(pickGameActivity(p, DEFAULT_CONFIG), null);
});

test("Competing counts by default and can be switched off per guild", () => {
  const p = presence({ type: ActivityType.Competing, name: "Rocket League" });
  assert.equal(pickGameActivity(p, DEFAULT_CONFIG).name, "Rocket League");
  assert.equal(pickGameActivity(p, { ...DEFAULT_CONFIG, track_competing: false }), null);
});

test("a stream still tells us what they're playing", () => {
  const p = presence({ type: ActivityType.Streaming, name: "Factorio" });
  assert.equal(pickGameActivity(p, DEFAULT_CONFIG).name, "Factorio");
  assert.equal(isStreaming(p), true);
  assert.equal(isStreaming(presence({ type: ActivityType.Playing, name: "Factorio" })), false);
});

test("Playing wins over a concurrent stream of something else", () => {
  const p = presence(
    { type: ActivityType.Streaming, name: "Just Chatting" },
    { type: ActivityType.Playing, name: "Deep Rock Galactic" },
  );
  assert.equal(pickGameActivity(p, DEFAULT_CONFIG).name, "Deep Rock Galactic");
});

test("an empty presence yields no game", () => {
  assert.equal(pickGameActivity(presence(), DEFAULT_CONFIG), null);
  assert.equal(pickGameActivity(null, DEFAULT_CONFIG), null);
});

// ── Write-time privacy ───────────────────────────────────────────────────

const member = (id, roleIds = [], bot = false) => ({
  id,
  user: { bot },
  roles: { cache: new Map(roleIds.map((r) => [r, {}])) },
});

test("exclusions are decided before anything is written", () => {
  const cfg = {
    ...DEFAULT_CONFIG,
    enabled: true,
    ignored_roles: ["role-staff"],
    ignored_members: ["member-quiet"],
    ignored_games: [gameKeyOf("Steam")],
  };

  assert.equal(exclusionReason(cfg, false, member("m1"), "helldivers 2"), null);
  assert.equal(exclusionReason(cfg, true, member("m1"), "helldivers 2"), "opted_out");
  assert.equal(exclusionReason(cfg, false, member("member-quiet"), "helldivers 2"), "ignored_member");
  assert.equal(exclusionReason(cfg, false, member("m1", ["role-staff"]), "helldivers 2"), "ignored_role");
  assert.equal(exclusionReason(cfg, false, member("m1"), gameKeyOf("Steam")), "ignored_game");
  assert.equal(exclusionReason(cfg, false, member("m1", [], true), "helldivers 2"), "bot");
  assert.equal(
    exclusionReason({ ...cfg, enabled: false }, false, member("m1"), "helldivers 2"),
    "disabled",
  );
});

test("ignored games are compared as keys, so the admin's casing doesn't matter", () => {
  // The dashboard stores what the admin typed; the normaliser lowercases it.
  const cfg = normaliseGamingSettings({
    enabled: true,
    settings: { ignored_games: ["Wallpaper Engine"] },
  });
  assert.equal(
    exclusionReason(cfg, false, member("m1"), gameKeyOf("WALLPAPER ENGINE")),
    "ignored_game",
  );
});

// ── Settings normalisation ───────────────────────────────────────────────

test("a missing settings row is tracking OFF — this module records personal data", () => {
  const cfg = normaliseGamingSettings(null);
  assert.equal(cfg.enabled, false);
  assert.equal(featureGate.MODULE_SOURCES.gaming.defaultEnabled, false);
});

test("normaliseGamingSettings clamps nonsense instead of trusting it", () => {
  const cfg = normaliseGamingSettings({
    enabled: true,
    settings: {
      retention_days: 99999,
      min_session_seconds: -40,
      ignored_roles: ["a", "", null, 7],
      anonymize_stats: 1,
    },
  });
  assert.equal(cfg.retention_days, 3650);
  assert.equal(cfg.min_session_seconds, 0);
  assert.deepEqual(cfg.ignored_roles, ["a", "7"]);
  assert.equal(cfg.anonymize_stats, true);
});

test("notification preferences are not gaming settings — stale keys are dropped", () => {
  // Which gaming events notify you is a per-user preference on Notification
  // settings, not a per-guild collection setting. Rows written before the move
  // still carry the old keys; normalisation must not carry them forward.
  const cfg = normaliseGamingSettings({
    enabled: true,
    settings: { notify_channel_id: "123", notify_on_popular_game: true },
  });
  assert.equal(cfg.notify_channel_id, undefined);
  assert.equal(cfg.notify_on_popular_game, undefined);
});

// ── Formatting ───────────────────────────────────────────────────────────

test("formatDuration reads at a glance and matches the dashboard", () => {
  assert.equal(formatDuration(35), "35s");
  assert.equal(formatDuration(60), "1m");
  assert.equal(formatDuration(2880), "48m");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(13320), "3h 42m");
  assert.equal(formatDuration(-5), "0s");
  assert.equal(formatDuration(null), "0s");
});

// ── Command catalog ──────────────────────────────────────────────────────

test("/gaming is an everyone-tier command gated on the gaming module", () => {
  const cmd = COMMANDS_BY_NAME.get("gaming");
  assert.ok(cmd, "/gaming is missing from the catalog");
  assert.equal(cmd.defaultPermission, "everyone");
  assert.equal(cmd.module, "gaming");
});

test("/gaming exposes the member-facing privacy subcommands", () => {
  const cmd = COMMANDS_BY_NAME.get("gaming");
  const subs = cmd.data.toJSON().options.map((o) => o.name);
  // opt-out/opt-in are the member's own decision — an admin cannot make it for
  // them, which is why they live on the command rather than the dashboard.
  for (const name of [
    "overview",
    "profile",
    "leaderboard",
    "games",
    "currently-playing",
    "opt-out",
    "opt-in",
  ]) {
    assert.ok(subs.includes(name), `/gaming ${name} is missing`);
  }
});

// ── Retention ────────────────────────────────────────────────────────────

test("the bot mirrors the same analytics retention the dashboard clamps to", () => {
  // /gaming must not quote a number the dashboard wouldn't show. This mirror
  // has to track pulsify-web-app/lib/billing.ts PLAN_LIMITS.analyticsRetentionDays.
  const { GUILD_LIMITS } = require("../src/billing");
  assert.deepEqual(GUILD_LIMITS.analyticsRetentionDays, {
    free: 7,
    pro: 30,
    business: 90,
    enterprise: 365,
  });
});

// Tests for the Server Timeline writer (PULSIFY-63).
//
// The timeline's whole value is that it never silently loses an event and never
// silently duplicates one, so these tests pin the two contracts that make that
// true: the row a record produces, and the notification→timeline mirror map
// (including its deliberate omissions). Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  recordTimelineEvent,
  recordTimelineEvents,
  mirrorNotificationToTimeline,
  timelineTypeForNotification,
  EVENT_DEFS,
  NOTIFICATION_TO_TIMELINE,
} = require("../src/timeline");
const { COMMANDS_BY_NAME } = require("../src/commands");

/** Minimal Supabase stub that captures what would have been inserted. */
function fakeSupabase({ error = null } = {}) {
  const inserts = [];
  return {
    inserts,
    from(table) {
      assert.equal(table, "timeline_events");
      return {
        insert(rows) {
          inserts.push(rows);
          return Promise.resolve({ error });
        },
      };
    },
  };
}

test("recordTimelineEvent fills category, module, severity and target type from the catalog", async () => {
  const supabase = fakeSupabase();
  await recordTimelineEvent(supabase, {
    guildId: "1",
    type: "role_renamed",
    title: "Role @Mod was renamed to @Staff",
  });

  const row = supabase.inserts[0];
  assert.equal(row.guild_id, "1");
  assert.equal(row.event_type, "role_renamed");
  assert.equal(row.category, "roles");
  assert.equal(row.module, "roles");
  assert.equal(row.severity, "info");
  assert.equal(row.target_type, "role");
  // The bot exists to witness Discord-side changes, so that's its default.
  assert.equal(row.source, "discord");
});

test("explicit fields override the catalog defaults", async () => {
  const supabase = fakeSupabase();
  await recordTimelineEvent(supabase, {
    guildId: "1",
    type: "settings_changed",
    title: "Verification raised",
    severity: "critical",
    source: "command",
    module: null,
    targetType: null,
  });

  const row = supabase.inserts[0];
  assert.equal(row.severity, "critical");
  assert.equal(row.source, "command");
  assert.equal(row.module, null);
  assert.equal(row.target_type, null);
});

test("an unknown event type still writes a row rather than throwing", async () => {
  const supabase = fakeSupabase();
  await recordTimelineEvent(supabase, {
    guildId: "1",
    type: "something_new_from_a_newer_deploy",
    title: "Future event",
  });

  const row = supabase.inserts[0];
  assert.equal(row.category, "configuration");
  assert.equal(row.severity, "info");
  assert.equal(row.event_type, "something_new_from_a_newer_deploy");
});

test("titles, descriptions and affected users are capped", async () => {
  const supabase = fakeSupabase();
  await recordTimelineEvent(supabase, {
    guildId: "1",
    type: "member_banned",
    title: "x".repeat(500),
    description: "y".repeat(5000),
    affectedUsers: Array.from({ length: 250 }, (_, i) => ({ id: String(i) })),
  });

  const row = supabase.inserts[0];
  assert.equal(row.title.length, 300);
  assert.equal(row.description.length, 2000);
  assert.equal(row.affected_users.length, 100);
});

test("a record without a guild or type is dropped, not written", async () => {
  const supabase = fakeSupabase();
  await recordTimelineEvent(supabase, { type: "role_created", title: "No guild" });
  await recordTimelineEvent(supabase, { guildId: "1", title: "No type" });
  assert.equal(supabase.inserts.length, 0);
});

test("an insert failure is swallowed so the caller's handler still completes", async () => {
  const supabase = fakeSupabase({ error: { message: "connection reset" } });
  await recordTimelineEvent(supabase, { guildId: "1", type: "role_created", title: "x" });
  // Reaching here without throwing is the assertion.
  assert.equal(supabase.inserts.length, 1);
});

test("recordTimelineEvents batches valid rows and skips invalid ones", async () => {
  const supabase = fakeSupabase();
  await recordTimelineEvents(supabase, [
    { guildId: "1", type: "role_created", title: "a" },
    { title: "invalid — no guild or type" },
    { guildId: "1", type: "role_deleted", title: "b" },
  ]);

  assert.equal(supabase.inserts.length, 1, "one round trip");
  assert.equal(supabase.inserts[0].length, 2);
});

test("recordTimelineEvents makes no round trip for an empty batch", async () => {
  const supabase = fakeSupabase();
  await recordTimelineEvents(supabase, []);
  await recordTimelineEvents(supabase, undefined);
  assert.equal(supabase.inserts.length, 0);
});

test("the mirror carries a notification's identity onto the timeline row", async () => {
  const supabase = fakeSupabase();
  await mirrorNotificationToTimeline(supabase, {
    guildId: "1",
    type: "mod_action",
    title: "Luka banned spammer",
    body: "Advertising",
    actorId: "10",
    actorName: "Luka",
    actorUsername: "luka",
    targetId: "20",
    targetName: "spammer",
    link: "/dashboard/1/moderation",
    metadata: { action: "ban" },
  });

  const row = supabase.inserts[0];
  assert.equal(row.event_type, "moderation_action");
  assert.equal(row.title, "Luka banned spammer");
  assert.equal(row.description, "Advertising");
  assert.equal(row.actor_id, "10");
  assert.equal(row.actor_username, "luka");
  assert.equal(row.target_name, "spammer");
  assert.deepEqual(row.metadata, { action: "ban" });
});

test("notification types outside the map produce no timeline row", async () => {
  const supabase = fakeSupabase();
  // These are the deliberate omissions: per-member noise that would drown the
  // history without describing how the server evolved.
  for (const type of ["level_up", "invite_valid", "invite_invalid", "bot_warning"]) {
    assert.equal(timelineTypeForNotification(type), null, type);
    await mirrorNotificationToTimeline(supabase, { guildId: "1", type, title: "x" });
  }
  assert.equal(supabase.inserts.length, 0);
});

test("every mapped notification type points at a known event definition", () => {
  for (const [notificationType, eventType] of Object.entries(NOTIFICATION_TO_TIMELINE)) {
    assert.ok(
      EVENT_DEFS[eventType],
      `${notificationType} maps to ${eventType}, which has no EVENT_DEFS entry`,
    );
  }
});

test("every event definition declares a category, severity and module slot", () => {
  const categories = new Set([
    "roles", "channels", "members", "moderation", "economy", "automation",
    "events", "configuration",
  ]);
  const severities = new Set(["info", "success", "warning", "critical"]);
  for (const [type, def] of Object.entries(EVENT_DEFS)) {
    assert.ok(categories.has(def.category), `${type} has an unknown category`);
    assert.ok(severities.has(def.severity), `${type} has an unknown severity`);
    assert.ok("module" in def, `${type} is missing a module slot`);
    assert.ok("targetType" in def, `${type} is missing a targetType slot`);
  }
});

test("/timeline is an admin-tier, module-null command with category + user filters", () => {
  const cmd = COMMANDS_BY_NAME.get("timeline");
  assert.ok(cmd, "/timeline is registered in the catalog");
  assert.equal(cmd.defaultPermission, "admin");
  // The timeline has no master switch to gate on — history is always readable.
  assert.equal(cmd.module, null);

  const json = cmd.data.toJSON();
  const names = json.options.map((o) => o.name);
  assert.deepEqual(names, ["category", "user"]);
  assert.equal(json.options[0].required, false);
  assert.equal(json.options[1].required, false);

  // The choices must match the timeline's categories exactly, or a filter can
  // be selected in Discord that the query will never match.
  const choices = json.options[0].choices.map((c) => c.value);
  assert.deepEqual(choices, [
    "roles", "channels", "members", "moderation", "economy", "automation",
    "events", "configuration",
  ]);
});

// Tests for the Events / Announcements / Automations slash commands (PULSIFY-61).
//
// The handlers are Discord + Supabase plumbing, so what's worth pinning is the
// catalog wiring: /event + /automation are Discord/scheduler-backed and module-
// null (no feature toggle), /announce is a moderator post while /announcements is
// an everyone-tier read, and /automation is served by the SCHEDULER engine (not a
// separate module). Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS_BY_NAME } = require("../src/commands");
const { createScheduler } = require("../src/scheduler");
const { createEvents } = require("../src/events");
const { createAnnouncements } = require("../src/announcements");

test("/event is moderator-tier, module-null, with list/info/create/cancel", () => {
  const def = COMMANDS_BY_NAME.get("event");
  assert.ok(def);
  assert.equal(def.defaultPermission, "moderator");
  assert.equal(def.module, null);
  const subs = (def.data.toJSON().options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  assert.deepEqual(subs.sort(), ["cancel", "create", "info", "list"]);
});

test("/event create requires name, location and start", () => {
  const json = COMMANDS_BY_NAME.get("event").data.toJSON();
  const create = (json.options ?? []).find((o) => o.name === "create");
  const required = (create.options ?? []).filter((o) => o.required).map((o) => o.name);
  assert.deepEqual(required.sort(), ["location", "name", "start"]);
});

test("/event info + cancel autocomplete the event", () => {
  const json = COMMANDS_BY_NAME.get("event").data.toJSON();
  for (const name of ["info", "cancel"]) {
    const sub = (json.options ?? []).find((o) => o.name === name);
    const opt = (sub.options ?? []).find((o) => o.name === "event");
    assert.equal(opt.required, true);
    assert.equal(opt.autocomplete, true);
  }
});

test("/announce posts (moderator) and /announcements reads (everyone) — distinct tiers", () => {
  const announce = COMMANDS_BY_NAME.get("announce");
  const list = COMMANDS_BY_NAME.get("announcements");
  assert.equal(announce.defaultPermission, "moderator");
  assert.equal(list.defaultPermission, "everyone");
  // /announce is a flat command requiring a message.
  const msg = (announce.data.toJSON().options ?? []).find((o) => o.name === "message");
  assert.ok(msg && msg.required, "/announce needs a required message");
  // /announcements is a group with just `recent`.
  const subs = (list.data.toJSON().options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  assert.deepEqual(subs, ["recent"]);
});

test("/automation is module-null with list/toggle/run/logs", () => {
  const def = COMMANDS_BY_NAME.get("automation");
  assert.equal(def.defaultPermission, "moderator");
  // Deliberately NOT the `automations` module (that's welcome/goodbye); scheduled
  // workflows have their own per-row enabled and no master switch.
  assert.equal(def.module, null);
  const subs = (def.data.toJSON().options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  assert.deepEqual(subs.sort(), ["list", "logs", "run", "toggle"]);
});

test("the backing modules expose their handlers", () => {
  const ev = createEvents({ client: {}, supabase: {} });
  for (const k of ["handleList", "handleInfo", "handleCreate", "handleCancel", "autocompleteEvent"]) {
    assert.ok(typeof ev[k] === "function", `events.${k} missing`);
  }
  const an = createAnnouncements({ client: {}, supabase: {} });
  for (const k of ["handleAnnounce", "handleRecent"]) {
    assert.ok(typeof an[k] === "function", `announcements.${k} missing`);
  }
  // /automation is served by the scheduler engine.
  const sc = createScheduler({ guilds: { cache: new Map() }, on() {} }, {});
  for (const k of ["handleAutomationCommand", "autocompleteAutomation"]) {
    assert.ok(typeof sc[k] === "function", `scheduler.${k} missing`);
  }
});

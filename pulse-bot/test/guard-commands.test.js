// Tests for the /guard slash command (PULSIFY-61) — Pulse Guard's Discord
// controls over the AI moderation engine.
//
// The handlers are Supabase reads + a whitelist upsert, all against the same
// ai_moderation_* tables the dashboard uses; detection policy stays web-side.
// What's worth pinning: this is the FIRST plan-gated command (minPlan "pro"), it
// gates on the pulse_guard module, and its label constants must mirror
// lib/ai-moderation.ts (a drift would show a raw slug to a moderator). Run with
// `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS_BY_NAME } = require("../src/commands");
const { createGuard, CATEGORY_IDS, CATEGORY_LABELS } = require("../src/guard");

test("/guard is moderator-tier, gated on pulse_guard, and Pro-plan-gated", () => {
  const def = COMMANDS_BY_NAME.get("guard");
  assert.ok(def, "/guard should be in the catalog");
  assert.equal(def.defaultPermission, "moderator");
  assert.equal(def.module, "pulse_guard");
  // The whole point here: the FIRST command with a plan gate. If this regresses,
  // the upgrade-prompt path stops being exercised anywhere.
  assert.equal(def.minPlan, "pro");
});

test("/guard exposes status, review and a whitelist add/remove group", () => {
  const json = COMMANDS_BY_NAME.get("guard").data.toJSON();
  const subs = (json.options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  assert.deepEqual(subs.sort(), ["review", "status"]);

  const group = (json.options ?? []).find((o) => o.type === 2 && o.name === "whitelist");
  assert.ok(group, "whitelist should be a subcommand group");
  const groupSubs = (group.options ?? []).map((o) => o.name);
  assert.deepEqual(groupSubs.sort(), ["add", "remove"]);
});

test("whitelist add/remove each take an optional user and role", () => {
  const json = COMMANDS_BY_NAME.get("guard").data.toJSON();
  const group = (json.options ?? []).find((o) => o.name === "whitelist");
  for (const name of ["add", "remove"]) {
    const sub = group.options.find((o) => o.name === name);
    const opts = (sub.options ?? []).map((o) => o.name).sort();
    assert.deepEqual(opts, ["role", "user"]);
    // Both optional — the handler enforces "exactly one".
    for (const o of sub.options) assert.notEqual(o.required, true);
  }
});

test("the category constants mirror lib/ai-moderation.ts", () => {
  // Ten detectors, each with a label — a missing one shows a raw slug in /guard
  // status / review.
  assert.equal(CATEGORY_IDS.length, 10);
  for (const id of CATEGORY_IDS) {
    assert.ok(CATEGORY_LABELS[id], `${id} needs a label`);
  }
});

test("guard exposes the three command handlers", () => {
  const g = createGuard({ client: {}, supabase: {} });
  for (const k of ["handleStatus", "handleWhitelist", "handleReview"]) {
    assert.ok(typeof g[k] === "function", `guard.${k} missing`);
  }
});

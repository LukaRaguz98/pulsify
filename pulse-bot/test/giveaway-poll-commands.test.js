// Tests for the /giveaway and /poll slash commands (PULSIFY-61) — the REST-side
// create/manage surface added on top of the existing Join / vote interaction
// systems in giveaways.js and polls.js.
//
// The handlers are mostly Supabase writes + Discord posts, so what's worth
// pinning is the CATALOG WIRING and the two decisions that keep the bot the
// single winner-drawer / vote-tallier: end + close must route through the
// request columns (never pick winners in the command), and the option sets a
// picker offers must match what the DB accepts. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS_BY_NAME } = require("../src/commands");
const { createGiveaways } = require("../src/giveaways");
const { createPolls } = require("../src/polls");

// ── Catalog wiring ───────────────────────────────────────────────────────────

for (const name of ["giveaway", "poll"]) {
  test(`/${name} is moderator-tier and module-null (no master switch)`, () => {
    const def = COMMANDS_BY_NAME.get(name);
    assert.ok(def, `/${name} should be in the catalog`);
    // Mirrors the dashboard's authorizeGuildModerator — creating/ending is a
    // moderator action, not something every member may do.
    assert.equal(def.defaultPermission, "moderator");
    // Neither feature has an on/off switch; a server with none simply has an
    // empty list (like /milestones), so they're always available.
    assert.equal(def.module, null);
    assert.ok(typeof def.autocomplete === "function", `/${name} needs autocomplete`);
  });
}

test("/giveaway exposes create, end, reroll and list", () => {
  const json = COMMANDS_BY_NAME.get("giveaway").data.toJSON();
  const subs = (json.options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  assert.deepEqual(subs.sort(), ["create", "end", "list", "reroll"]);
});

test("/poll exposes create, results and close", () => {
  const json = COMMANDS_BY_NAME.get("poll").data.toJSON();
  const subs = (json.options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  assert.deepEqual(subs.sort(), ["close", "create", "results"]);
});

test("/giveaway create requires a prize and a duration", () => {
  const json = COMMANDS_BY_NAME.get("giveaway").data.toJSON();
  const create = (json.options ?? []).find((o) => o.name === "create");
  const required = (create.options ?? []).filter((o) => o.required).map((o) => o.name);
  assert.deepEqual(required.sort(), ["duration", "prize"]);
});

test("/giveaway end + reroll autocomplete their target giveaway", () => {
  const json = COMMANDS_BY_NAME.get("giveaway").data.toJSON();
  for (const sub of ["end", "reroll"]) {
    const s = (json.options ?? []).find((o) => o.name === sub);
    const opt = (s.options ?? []).find((o) => o.name === "giveaway");
    assert.ok(opt, `/${sub} should take a giveaway option`);
    assert.equal(opt.required, true);
    assert.equal(opt.autocomplete, true);
  }
});

test("/poll create offers exactly the supported poll types", () => {
  // These must be a subset of lib/polls.ts poll types the bot's normalisePollType
  // accepts — an unknown value would fall back to 'single' silently.
  const json = COMMANDS_BY_NAME.get("poll").data.toJSON();
  const create = (json.options ?? []).find((o) => o.name === "create");
  const type = (create.options ?? []).find((o) => o.name === "type");
  assert.deepEqual(
    type.choices.map((c) => c.value),
    ["single", "multiple", "yes_no"],
  );
  assert.equal(type.required, true);
});

test("/poll close autocompletes its target poll", () => {
  const json = COMMANDS_BY_NAME.get("poll").data.toJSON();
  const close = (json.options ?? []).find((o) => o.name === "close");
  const opt = (close.options ?? []).find((o) => o.name === "poll");
  assert.equal(opt.required, true);
  assert.equal(opt.autocomplete, true);
});

// ── Handlers are wired ─────────────────────────────────────────────────────────

test("giveaways exposes the four command handlers + autocomplete", () => {
  // The catalog delegates to these by name — a rename makes the command a no-op
  // notice. Stub deps (client.on is touched at construction only).
  const g = createGiveaways({ on() {} }, {});
  for (const k of ["handleCreateCommand", "handleEndCommand", "handleRerollCommand", "handleListCommand", "autocompleteGiveaway"]) {
    assert.ok(typeof g[k] === "function", `giveaways.${k} missing`);
  }
});

test("polls exposes the three command handlers + autocomplete", () => {
  const p = createPolls({ on() {} }, {});
  for (const k of ["handleCreateCommand", "handleCloseCommand", "handleResultsCommand", "autocompletePoll"]) {
    assert.ok(typeof p[k] === "function", `polls.${k} missing`);
  }
});

// Tests for the Member & Community slash commands (PULSIFY-61): /rank,
// /reputation, /userinfo and /serverinfo.
//
// These handlers are almost entirely Discord reads + embed formatting, so the
// part worth pinning is the CATALOG WIRING — specifically the module-gating
// decisions, which are easy to get wrong and silently break a command in every
// server. /rank must gate on leveling (so it dies where XP is off), while
// /reputation must NOT gate on economy: reputation is a live 0-100 score that
// predates the economy and is always computable, so it stays available even
// where the economy module is switched off. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS_BY_NAME } = require("../src/commands");
const { createLeveling } = require("../src/leveling");
const { createEconomy } = require("../src/economy");

// The four commands are read-only and open to everyone.
for (const name of ["rank", "reputation", "userinfo", "serverinfo"]) {
  test(`/${name} is in the catalog, everyone-tier, in the information category`, () => {
    const def = COMMANDS_BY_NAME.get(name);
    assert.ok(def, `/${name} should be in the catalog`);
    assert.equal(def.defaultPermission, "everyone");
    assert.equal(def.category, "information");
    // Read-only: none default to a public reply (ephemeral is the default).
    assert.notEqual(def.defaultEphemeral, false);
    assert.ok(typeof def.execute === "function", `/${name} needs an execute`);
  });
}

test("/rank gates on the leveling module", () => {
  // Leveling defaults ON, but a server that switched XP off should not serve
  // /rank — the feature gate blocks it before execute.
  assert.equal(COMMANDS_BY_NAME.get("rank").module, "leveling");
});

test("/reputation is module-null so it survives the economy being off", () => {
  // Deliberate: reputation is computed live from activity + moderation history,
  // never stored, and predates the economy. Gating it on economy would hide it
  // in servers that never turned the economy on. Mirrors /profile.
  assert.equal(COMMANDS_BY_NAME.get("reputation").module, null);
});

test("/userinfo and /serverinfo are module-null (always available)", () => {
  assert.equal(COMMANDS_BY_NAME.get("userinfo").module, null);
  assert.equal(COMMANDS_BY_NAME.get("serverinfo").module, null);
});

test("/rank, /reputation and /userinfo take an optional user; /serverinfo takes none", () => {
  for (const name of ["rank", "reputation", "userinfo"]) {
    const json = COMMANDS_BY_NAME.get(name).data.toJSON();
    const user = (json.options ?? []).find((o) => o.name === "user");
    assert.ok(user, `/${name} should have a user option`);
    assert.notEqual(user.required, true, `/${name} user option must be optional`);
  }
  const server = COMMANDS_BY_NAME.get("serverinfo").data.toJSON();
  assert.deepEqual(server.options ?? [], []);
});

test("leveling exposes handleRankCommand and economy exposes handleReputationCommand", () => {
  // The catalog delegates to these — a rename would make the command a no-op
  // notice. Instantiated with stub deps (no network; we only inspect the API).
  const leveling = createLeveling({}, {});
  assert.ok(typeof leveling.handleRankCommand === "function");

  const economy = createEconomy({}, {});
  assert.ok(typeof economy.handleReputationCommand === "function");
});

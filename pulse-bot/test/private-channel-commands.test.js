// Tests for the /privatechannel slash command (PULSIFY-61) — the member
// self-service surface added on top of the existing owner control panel in
// private-channels.js.
//
// The handler is Discord permission-overwrite edits + Supabase writes, all
// shared with the panel (setChannelLock / setChannelName / grantAccess /
// revokeAccess). What's worth pinning is the CATALOG WIRING: it must be
// everyone-tier (any member manages their OWN channel; the handler enforces
// ownership) and gated on the private_channels module, with invite/kick taking a
// user and rename taking a name. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS_BY_NAME } = require("../src/commands");
const { createPrivateChannels } = require("../src/private-channels");

test("/privatechannel is everyone-tier and gated on the private_channels module", () => {
  const def = COMMANDS_BY_NAME.get("privatechannel");
  assert.ok(def, "/privatechannel should be in the catalog");
  // Member self-service — the handler (ownedEntry) enforces owner/staff, not the
  // permission ladder, so the command itself is open to everyone.
  assert.equal(def.defaultPermission, "everyone");
  // A server with Private Channels switched off must not serve it.
  assert.equal(def.module, "private_channels");
});

test("/privatechannel exposes lock, unlock, invite, kick and rename", () => {
  const json = COMMANDS_BY_NAME.get("privatechannel").data.toJSON();
  const subs = (json.options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  assert.deepEqual(subs.sort(), ["invite", "kick", "lock", "rename", "unlock"]);
});

test("invite + kick require a user; rename requires a name; lock/unlock take nothing", () => {
  const json = COMMANDS_BY_NAME.get("privatechannel").data.toJSON();
  const sub = (name) => (json.options ?? []).find((o) => o.name === name);

  for (const s of ["invite", "kick"]) {
    const user = (sub(s).options ?? []).find((o) => o.name === "user");
    assert.ok(user, `/privatechannel ${s} needs a user option`);
    assert.equal(user.required, true);
  }
  const name = (sub("rename").options ?? []).find((o) => o.name === "name");
  assert.ok(name, "/privatechannel rename needs a name option");
  assert.equal(name.required, true);

  for (const s of ["lock", "unlock"]) {
    assert.deepEqual(sub(s).options ?? [], [], `/privatechannel ${s} should take no options`);
  }
});

test("private-channels exposes the command handler", () => {
  // The catalog delegates to this by name — a rename makes the command a no-op
  // notice. Stub client (its user id + .on are touched at construction only).
  const pc = createPrivateChannels({ user: { id: "0" }, on() {} }, {});
  assert.ok(typeof pc.handlePrivateChannelCommand === "function");
});

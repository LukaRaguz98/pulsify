// Tests for the Server Settings & Assets slash commands (PULSIFY-61).
//
// Pins the catalog wiring (tiers + module-null + subcommands), the asset-list
// name formatting, and the /statchannel refresh reply paths. Also documents the
// two spec deviations: /presence is absent (operator-only feature) and
// /soundboard is list|info, not list|play (no voice dependency). Run with
// `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS_BY_NAME } = require("../src/commands");
const { createSettingsCommands, inlineNames, LIST_CAP } = require("../src/settings-commands");

// ── Catalog wiring ─────────────────────────────────────────────────────────

test("/serversettings is admin-tier, module-null, with a view subcommand", () => {
  const def = COMMANDS_BY_NAME.get("serversettings");
  assert.ok(def);
  assert.equal(def.defaultPermission, "admin");
  assert.equal(def.module, null);
  assert.deepEqual((def.data.toJSON().options ?? []).map((o) => o.name), ["view"]);
});

test("/statchannel is moderator-tier, module-null, with a refresh subcommand", () => {
  const def = COMMANDS_BY_NAME.get("statchannel");
  assert.ok(def);
  assert.equal(def.defaultPermission, "moderator");
  assert.equal(def.module, null);
  assert.deepEqual((def.data.toJSON().options ?? []).map((o) => o.name), ["refresh"]);
});

test("/emoji, /sticker, /soundboard are everyone-tier reads with list + info", () => {
  for (const name of ["emoji", "sticker", "soundboard"]) {
    const def = COMMANDS_BY_NAME.get(name);
    assert.ok(def, `${name} should exist`);
    assert.equal(def.defaultPermission, "everyone");
    assert.equal(def.module, null);
    assert.deepEqual((def.data.toJSON().options ?? []).map((o) => o.name).sort(), ["info", "list"]);
    assert.equal(typeof def.autocomplete, "function", `${name} info should autocomplete`);
  }
});

test("/presence is NOT registered — presence is operator-only (spec correction)", () => {
  assert.equal(COMMANDS_BY_NAME.get("presence"), undefined);
});

test("createSettingsCommands exposes every handler + autocomplete index.js dispatches to", () => {
  const s = createSettingsCommands({ client: {}, supabase: {}, statisticsChannels: {} });
  for (const h of [
    "handleServerSettings",
    "handleStatChannel",
    "handleEmoji",
    "handleSticker",
    "handleSoundboard",
    "autocompleteEmoji",
    "autocompleteSticker",
    "autocompleteSoundboard",
  ]) {
    assert.equal(typeof s[h], "function", `${h} should be exported`);
  }
});

// ── inlineNames ────────────────────────────────────────────────────────────

test("inlineNames wraps in backticks, caps the list and shows '+N more'", () => {
  assert.equal(inlineNames([]), "None");
  assert.equal(inlineNames(["wave", "blob"]), "`wave` `blob`");
  const many = Array.from({ length: LIST_CAP + 5 }, (_, i) => `e${i}`);
  const out = inlineNames(many);
  assert.match(out, /\+5 more$/);
  // Only LIST_CAP names are printed before the tail.
  assert.equal(out.split("`").length - 1, LIST_CAP * 2);
});

// ── /statchannel refresh reply paths ───────────────────────────────────────

function makeStatInteraction() {
  const payloads = [];
  return {
    deferred: false,
    replied: false,
    options: { getSubcommand: () => "refresh" },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(p) {
      payloads.push(p);
    },
    lastMessage() {
      const p = payloads[payloads.length - 1];
      return p?.components?.[0]?.components?.[0]?.content ?? "";
    },
  };
}

test("/statchannel refresh reports when nothing is configured", async () => {
  const s = createSettingsCommands({
    client: {},
    supabase: {},
    statisticsChannels: { refreshGuild: async () => ({ total: 0, enabled: 0 }) },
  });
  const interaction = makeStatInteraction();
  await s.handleStatChannel({ interaction, guild: { id: "g1" }, ephemeral: true });
  assert.match(interaction.lastMessage(), /No statistics channels/i);
});

test("/statchannel refresh confirms the number refreshed", async () => {
  const s = createSettingsCommands({
    client: {},
    supabase: {},
    statisticsChannels: { refreshGuild: async () => ({ total: 3, enabled: 2 }) },
  });
  const interaction = makeStatInteraction();
  await s.handleStatChannel({ interaction, guild: { id: "g1" }, ephemeral: true });
  assert.match(interaction.lastMessage(), /Refreshed 2 statistics channels/i);
});

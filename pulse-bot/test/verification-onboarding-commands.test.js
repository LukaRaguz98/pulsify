// Tests for the Verification & Onboarding slash commands (PULSIFY-61).
//
// Pins the catalog wiring and the two decisions worth guarding: /verify +
// /verification are module-null everyone-tier (self-verification is a core
// member action, and the handler gives a precise "not set up" message rather
// than a generic module-off one), while /onboarding is a MODERATOR group gated
// on the `onboarding` module (one tier for the whole group — resend is a staff
// helper, stats is a staff read). Plus the in-handler moderator elevation when
// /verify targets someone else. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS_BY_NAME } = require("../src/commands");
const { createOnboarding } = require("../src/onboarding");

// ── Catalog wiring ─────────────────────────────────────────────────────────

test("/verify is everyone-tier, module-null, with an optional user option", () => {
  const def = COMMANDS_BY_NAME.get("verify");
  assert.ok(def);
  assert.equal(def.defaultPermission, "everyone");
  assert.equal(def.module, null);
  const opts = def.data.toJSON().options ?? [];
  const user = opts.find((o) => o.name === "user");
  assert.ok(user);
  assert.equal(user.required, false);
});

test("/verification is everyone-tier, module-null, with a status subcommand", () => {
  const def = COMMANDS_BY_NAME.get("verification");
  assert.ok(def);
  assert.equal(def.defaultPermission, "everyone");
  assert.equal(def.module, null);
  const subs = (def.data.toJSON().options ?? []).map((o) => o.name);
  assert.deepEqual(subs, ["status"]);
});

test("/onboarding is moderator-tier, module 'onboarding', with resend + stats", () => {
  const def = COMMANDS_BY_NAME.get("onboarding");
  assert.ok(def);
  assert.equal(def.defaultPermission, "moderator");
  assert.equal(def.module, "onboarding");
  const subs = (def.data.toJSON().options ?? []).map((o) => o.name);
  assert.deepEqual(subs.sort(), ["resend", "stats"]);
  const resend = (def.data.toJSON().options ?? []).find((o) => o.name === "resend");
  assert.ok((resend.options ?? []).some((o) => o.name === "user"));
});

test("createOnboarding exposes the four command handlers", () => {
  const ob = createOnboarding({}, {}, null, null);
  for (const h of ["handleVerifyCommand", "handleVerificationStatus", "handleResend", "handleOnboardingStats"]) {
    assert.equal(typeof ob[h], "function", `${h} should be exported`);
  }
});

// ── Handler behaviour ──────────────────────────────────────────────────────

/** Minimal supabase stub whose guild_settings read returns `settings`. */
function makeSupabase(settings) {
  return {
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: settings === undefined ? null : { settings } }),
      };
      return chain;
    },
  };
}

/** Capture-only interaction; returns the last notice message text. */
function makeInteraction({ user = { id: "self", username: "self" }, member, options = {} } = {}) {
  const payloads = [];
  return {
    user,
    member,
    replied: false,
    deferred: false,
    options: {
      getUser: (n) => options[n] ?? null,
      getSubcommand: () => options.__sub,
    },
    async reply(p) {
      this.replied = true;
      payloads.push(p);
    },
    async followUp(p) {
      payloads.push(p);
    },
    async editReply(p) {
      payloads.push(p);
    },
    lastMessage() {
      const p = payloads[payloads.length - 1];
      // Notice container: { components: [{ type:17, components:[{ type:10, content }]}] }
      return p?.components?.[0]?.components?.[0]?.content ?? "";
    },
  };
}

const ENABLED = {
  member_onboarding: { enabled: true, verification: { enabled: true, role_id: "verified-role" } },
};

test("/verify says 'not set up' when verification is disabled", async () => {
  const ob = createOnboarding({}, makeSupabase(undefined), null, null);
  const interaction = makeInteraction({ member: { roles: { cache: new Map() }, permissions: { has: () => false } } });
  await ob.handleVerifyCommand({ interaction, guild: { id: "g1" }, ephemeral: true });
  assert.match(interaction.lastMessage(), /isn't set up/i);
});

test("/verify blocks a non-moderator from verifying someone else", async () => {
  const ob = createOnboarding({}, makeSupabase(ENABLED), null, null);
  const interaction = makeInteraction({
    user: { id: "self", username: "self" },
    member: { permissions: { has: () => false }, roles: { cache: new Map() } },
    options: { user: { id: "other" } },
  });
  await ob.handleVerifyCommand({ interaction, guild: { id: "g1" }, ephemeral: true });
  assert.match(interaction.lastMessage(), /moderators can verify other members/i);
});

test("/verification status reports 'not set up' when disabled", async () => {
  const ob = createOnboarding({}, makeSupabase(undefined), null, null);
  const interaction = makeInteraction({ member: { roles: { cache: new Map() } } });
  await ob.handleVerificationStatus({ interaction, guild: { id: "g1", name: "G" }, ephemeral: true });
  assert.match(interaction.lastMessage(), /isn't set up/i);
});

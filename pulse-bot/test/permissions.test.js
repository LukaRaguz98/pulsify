// Tests for the shared command permission ladder (pulse-bot/src/permissions.js).
// These lock the tier ordering + the support-role resolution that gates the
// expanded slash-command set (PULSIFY-61). Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");

const {
  TIERS,
  normaliseTier,
  isAdmin,
  isModerator,
  resolveTier,
  meetsTier,
  tierLabel,
  invalidateSupportRoles,
} = require("../src/permissions");

// ── Test doubles ─────────────────────────────────────────────────────────────

/** A member carrying `perms` (an array of PermissionFlagsBits) + role ids. */
function fakeMember(perms = [], roleIds = []) {
  const held = new Set(perms.map(String));
  return {
    permissions: { has: (flag) => held.has(String(flag)) },
    roles: { cache: new Map(roleIds.map((id) => [id, { id }])) },
  };
}

/**
 * A supabase double returning one ticket_configs row. `calls` counts reads so
 * the cache behaviour is observable.
 */
function fakeSupabase(row, calls = { n: 0 }) {
  return {
    calls,
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  calls.n += 1;
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

/** A supabase double whose reads always fail. */
function brokenSupabase() {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: null,
                  error: { message: "boom" },
                }),
              };
            },
          };
        },
      };
    },
  };
}

const ADMIN = fakeMember([PermissionFlagsBits.Administrator]);
const MANAGE_GUILD = fakeMember([PermissionFlagsBits.ManageGuild]);
const MOD = fakeMember([PermissionFlagsBits.ManageMessages]);
const SUPPORT = fakeMember([], ["role-support"]);
const PLAIN = fakeMember([], ["role-random"]);

const TICKET_ROW = {
  support_role_ids: ["role-support"],
  ticket_types: [{ support_role_ids: ["role-billing"] }],
};

// Each test uses its own guild id so the module-level support cache from one
// test can't leak into the next.
let guildSeq = 0;
const nextGuild = () => `guild-${++guildSeq}`;

// ── Ladder shape ─────────────────────────────────────────────────────────────

test("the ladder is ordered low to high", () => {
  assert.deepEqual(TIERS, ["member", "support", "moderator", "admin"]);
});

test("normaliseTier maps the stored 'everyone' alias onto member", () => {
  assert.equal(normaliseTier("everyone"), "member");
  assert.equal(normaliseTier("member"), "member");
  assert.equal(normaliseTier("support"), "support");
  assert.equal(normaliseTier("admin"), "admin");
});

test("normaliseTier falls back to member for unknown input", () => {
  // A command_configs row with a bogus permission_level must not accidentally
  // grant access — the safe fallback is the lowest tier.
  assert.equal(normaliseTier("wizard"), "member");
  assert.equal(normaliseTier(undefined), "member");
  assert.equal(normaliseTier(null), "member");
});

test("tierLabel renders each tier for help listings", () => {
  assert.equal(tierLabel("everyone"), "Everyone");
  assert.equal(tierLabel("support"), "Support staff");
  assert.equal(tierLabel("moderator"), "Mods");
  assert.equal(tierLabel("admin"), "Admins");
});

// ── Permission predicates ────────────────────────────────────────────────────

test("isAdmin accepts Administrator and Manage Server", () => {
  assert.equal(isAdmin(ADMIN), true);
  assert.equal(isAdmin(MANAGE_GUILD), true);
  assert.equal(isAdmin(MOD), false);
  assert.equal(isAdmin(PLAIN), false);
  assert.equal(isAdmin(null), false);
});

test("isModerator accepts any moderation permission, and admins", () => {
  assert.equal(isModerator(ADMIN), true);
  assert.equal(isModerator(fakeMember([PermissionFlagsBits.KickMembers])), true);
  assert.equal(isModerator(fakeMember([PermissionFlagsBits.BanMembers])), true);
  assert.equal(
    isModerator(fakeMember([PermissionFlagsBits.ModerateMembers])),
    true,
  );
  assert.equal(isModerator(PLAIN), false);
});

// ── resolveTier ──────────────────────────────────────────────────────────────

test("resolveTier returns the highest tier a member satisfies", async () => {
  const g = nextGuild();
  const db = fakeSupabase(TICKET_ROW);
  assert.equal(await resolveTier(db, g, ADMIN), "admin");
  assert.equal(await resolveTier(db, g, MOD), "moderator");
  assert.equal(await resolveTier(db, g, SUPPORT), "support");
  assert.equal(await resolveTier(db, g, PLAIN), "member");
});

test("resolveTier honours per-type support roles, not just the config list", async () => {
  // tickets.js unions config.support_role_ids with each type's own list when it
  // grants channel access; the tier check has to agree or a member could see a
  // ticket they can't act on.
  const g = nextGuild();
  const db = fakeSupabase(TICKET_ROW);
  const billingStaff = fakeMember([], ["role-billing"]);
  assert.equal(await resolveTier(db, g, billingStaff), "support");
});

// ── meetsTier ────────────────────────────────────────────────────────────────

test("meetsTier is inclusive — a higher tier satisfies a lower requirement", async () => {
  const g = nextGuild();
  const db = fakeSupabase(TICKET_ROW);
  for (const level of ["everyone", "support", "moderator", "admin"]) {
    assert.equal(await meetsTier(db, g, ADMIN, level), true, `admin vs ${level}`);
  }
  // A moderator clears support without holding a support role.
  assert.equal(await meetsTier(db, g, MOD, "support"), true);
  assert.equal(await meetsTier(db, g, MOD, "moderator"), true);
  assert.equal(await meetsTier(db, g, MOD, "admin"), false);
});

test("meetsTier does not let a lower tier climb", async () => {
  const g = nextGuild();
  const db = fakeSupabase(TICKET_ROW);
  assert.equal(await meetsTier(db, g, SUPPORT, "support"), true);
  assert.equal(await meetsTier(db, g, SUPPORT, "moderator"), false);
  assert.equal(await meetsTier(db, g, SUPPORT, "admin"), false);
  assert.equal(await meetsTier(db, g, PLAIN, "support"), false);
});

test("meetsTier lets everyone through the member tier", async () => {
  const g = nextGuild();
  const db = fakeSupabase(TICKET_ROW);
  assert.equal(await meetsTier(db, g, PLAIN, "everyone"), true);
  // Null member (an interaction without a resolved member) still passes the
  // open tier and fails every gated one.
  assert.equal(await meetsTier(db, g, null, "everyone"), true);
  assert.equal(await meetsTier(db, g, null, "support"), false);
});

test("meetsTier answers admin/moderator checks without reading the database", async () => {
  // The support tier is the only one that costs a query. Moderation commands
  // are the hot path, so they must not pay for a lookup they never use.
  const calls = { n: 0 };
  const db = fakeSupabase(TICKET_ROW, calls);
  const g = nextGuild();
  await meetsTier(db, g, ADMIN, "admin");
  await meetsTier(db, g, MOD, "moderator");
  await meetsTier(db, g, PLAIN, "moderator");
  await meetsTier(db, g, PLAIN, "everyone");
  assert.equal(calls.n, 0);
});

test("support role lookups are cached per guild", async () => {
  const calls = { n: 0 };
  const db = fakeSupabase(TICKET_ROW, calls);
  const g = nextGuild();
  await meetsTier(db, g, SUPPORT, "support");
  await meetsTier(db, g, SUPPORT, "support");
  await meetsTier(db, g, PLAIN, "support");
  assert.equal(calls.n, 1);

  invalidateSupportRoles(g);
  await meetsTier(db, g, SUPPORT, "support");
  assert.equal(calls.n, 2);
});

test("a failed support lookup fails closed", async () => {
  // If ticket_configs can't be read we must not fall open and hand the support
  // tier to everyone. Support staff degrade to member; admins/mods are
  // unaffected because they never consult the role list.
  const g = nextGuild();
  const db = brokenSupabase();
  assert.equal(await meetsTier(db, g, SUPPORT, "support"), false);
  assert.equal(await meetsTier(db, g, ADMIN, "support"), true);
});

test("a guild with no ticket config has no support staff", async () => {
  const g = nextGuild();
  const db = fakeSupabase(null);
  assert.equal(await meetsTier(db, g, SUPPORT, "support"), false);
  assert.equal(await meetsTier(db, g, MOD, "support"), true);
});

// Tests for module + subscription gating (pulse-bot/src/feature-gate.js) and
// the plan mirror (pulse-bot/src/billing.js).
//
// The module DEFAULTS are the valuable part here: leveling and economy default
// ON for an unconfigured server, everything else defaults OFF. Flipping either
// would silently break working commands in servers that never opened those
// settings pages, and no type checker will catch it. Run with `npm test`.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  isModuleEnabled,
  invalidateModules,
  getGuildPlan,
  invalidatePlan,
  check,
  checkLimit,
  moduleLabel,
} = require("../src/feature-gate");
const { effectivePlan, hasPlan, isEarlyAccess, limitFor } = require("../src/billing");

// ── Test doubles ─────────────────────────────────────────────────────────────

/**
 * A supabase double backed by `tables`: { tableName: rowOrNull }. Records the
 * tables it was asked for so cache behaviour is observable.
 */
function fakeSupabase(tables, reads = []) {
  return {
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  reads.push(table);
                  if (tables[table] === undefined) return { data: null, error: null };
                  return { data: tables[table], error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

function brokenSupabase() {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
              };
            },
          };
        },
      };
    },
  };
}

let guildSeq = 0;
const nextGuild = () => ({ id: `guild-${++guildSeq}`, ownerId: "owner-1" });

// The gate reads EARLY_ACCESS at call time. Neutralise it so plan tests assert
// real gating, and restore afterwards so we don't leak into other test files.
const savedEnv = {};
beforeEach(() => {
  savedEnv.EARLY_ACCESS = process.env.EARLY_ACCESS;
  savedEnv.NEXT_PUBLIC_EARLY_ACCESS = process.env.NEXT_PUBLIC_EARLY_ACCESS;
  delete process.env.EARLY_ACCESS;
  delete process.env.NEXT_PUBLIC_EARLY_ACCESS;
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ── Plan mirror ──────────────────────────────────────────────────────────────

test("hasPlan ranks plans free < pro < business < enterprise", () => {
  assert.equal(hasPlan("business", "pro"), true);
  assert.equal(hasPlan("pro", "pro"), true);
  assert.equal(hasPlan("free", "pro"), false);
  assert.equal(hasPlan("enterprise", "business"), true);
});

test("effectivePlan demotes a lapsed subscription to free", () => {
  assert.equal(effectivePlan("business", "active"), "business");
  assert.equal(effectivePlan("business", "trialing"), "business");
  // past_due still grants access — a failed payment shouldn't instantly cut a
  // server off mid-billing-cycle.
  assert.equal(effectivePlan("business", "past_due"), "business");
  assert.equal(effectivePlan("business", "canceled"), "free");
  assert.equal(effectivePlan("business", "unpaid"), "free");
  assert.equal(effectivePlan(null, "active"), "free");
  // A bogus plan slug from a bad webhook write must not grant anything.
  assert.equal(effectivePlan("wizard", "active"), "free");
});

test("limitFor mirrors the web caps and treats unlimited as Infinity", () => {
  assert.equal(limitFor("free", "maxConcurrentGiveaways"), 1);
  assert.equal(limitFor("pro", "maxActivePolls"), 15);
  assert.equal(limitFor("business", "maxScheduledEvents"), 100);
  // enterprise is null in the mirror → unlimited.
  assert.equal(limitFor("enterprise", "maxConcurrentGiveaways"), Infinity);
  // An unknown key never blocks a command.
  assert.equal(limitFor("free", "maxNope"), Infinity);
});

test("checkLimit blocks at the cap and allows under it, gated on the owner's plan", async () => {
  invalidatePlan();
  const freeGuild = { id: "lim-free", ownerId: "owner-1" };
  const supa = fakeSupabase({ subscriptions: { plan: "free", status: "active" } });
  // free maxConcurrentGiveaways = 1: 0 live is allowed, 1 live is blocked.
  const under = await checkLimit(supa, freeGuild, "maxConcurrentGiveaways", 0);
  assert.equal(under.allowed, true);
  invalidatePlan();
  const at = await checkLimit(supa, freeGuild, "maxConcurrentGiveaways", 1);
  assert.equal(at.allowed, false);
  assert.equal(at.status, "limit_reached");
  assert.match(at.reason, /plan limit/i);
});

test("checkLimit never blocks under early access (top tier is unlimited)", async () => {
  process.env.EARLY_ACCESS = "yes";
  invalidatePlan();
  const guild = { id: "lim-ea", ownerId: "owner-1" };
  const supa = fakeSupabase({ subscriptions: { plan: "free", status: "active" } });
  const res = await checkLimit(supa, guild, "maxConcurrentGiveaways", 9999);
  assert.equal(res.allowed, true);
});

test("isEarlyAccess reads the truthy spellings and the public mirror", () => {
  for (const v of ["yes", "true", "1", "on", "TRUE", " On "]) {
    process.env.EARLY_ACCESS = v;
    assert.equal(isEarlyAccess(), true, `EARLY_ACCESS=${v}`);
  }
  process.env.EARLY_ACCESS = "no";
  assert.equal(isEarlyAccess(), false);
  delete process.env.EARLY_ACCESS;
  assert.equal(isEarlyAccess(), false);
  process.env.NEXT_PUBLIC_EARLY_ACCESS = "true";
  assert.equal(isEarlyAccess(), true);
});

// ── Module enablement: the defaults ──────────────────────────────────────────

test("leveling and economy are ON for a server that never configured them", async () => {
  // A missing row means "enabled with defaults" on the bot side
  // (normaliseLevelingSettings / normaliseRewardSettings), so /rank and
  // /balance must work out of the box.
  const db = fakeSupabase({});
  const g = nextGuild();
  assert.equal(await isModuleEnabled(db, g.id, "leveling"), true);
  assert.equal(await isModuleEnabled(db, g.id, "economy"), true);
});

test("provisioning modules are OFF for a server that never configured them", async () => {
  const db = fakeSupabase({});
  const g = nextGuild();
  for (const key of ["tickets", "private_channels", "pulse_guard", "ddos_protection"]) {
    assert.equal(await isModuleEnabled(db, g.id, key), false, key);
  }
});

test("an explicit disable beats the module default", async () => {
  const db = fakeSupabase({ leveling_settings: { enabled: false } });
  const g = nextGuild();
  assert.equal(await isModuleEnabled(db, g.id, "leveling"), false);
});

test("an explicit enable turns a default-off module on", async () => {
  const db = fakeSupabase({ ticket_configs: { enabled: true } });
  const g = nextGuild();
  assert.equal(await isModuleEnabled(db, g.id, "tickets"), true);
});

test("a command with no module is always enabled", async () => {
  const db = fakeSupabase({});
  const g = nextGuild();
  // /help, /serverinfo — not tied to any toggleable feature.
  assert.equal(await isModuleEnabled(db, g.id, null), true);
  assert.equal(await isModuleEnabled(db, g.id, undefined), true);
  // An unknown key must not accidentally disable a command.
  assert.equal(await isModuleEnabled(db, g.id, "not-a-module"), true);
});

// ── Module enablement: the settings-blob features ────────────────────────────

test("onboarding reads its flag out of the guild_settings blob", async () => {
  const g = nextGuild();
  const on = fakeSupabase({
    guild_settings: { settings: { member_onboarding: { enabled: true } } },
  });
  assert.equal(await isModuleEnabled(on, g.id, "onboarding"), true);

  const g2 = nextGuild();
  const off = fakeSupabase({
    guild_settings: { settings: { member_onboarding: { enabled: false } } },
  });
  assert.equal(await isModuleEnabled(off, g2.id, "onboarding"), false);
});

test("automations counts as on when EITHER welcome or goodbye is enabled", async () => {
  // Automations has no single master switch — the dashboard and templates.ts
  // both treat it as on when either half is live.
  const g1 = nextGuild();
  const welcomeOnly = fakeSupabase({
    guild_settings: { settings: { welcome: { enabled: true }, goodbye: { enabled: false } } },
  });
  assert.equal(await isModuleEnabled(welcomeOnly, g1.id, "automations"), true);

  const g2 = nextGuild();
  const goodbyeOnly = fakeSupabase({
    guild_settings: { settings: { welcome: { enabled: false }, goodbye: { enabled: true } } },
  });
  assert.equal(await isModuleEnabled(goodbyeOnly, g2.id, "automations"), true);

  const g3 = nextGuild();
  const neither = fakeSupabase({
    guild_settings: { settings: { welcome: { enabled: false }, goodbye: { enabled: false } } },
  });
  assert.equal(await isModuleEnabled(neither, g3.id, "automations"), false);
});

test("a settings blob missing the key falls back to the module default", async () => {
  const g = nextGuild();
  const db = fakeSupabase({ guild_settings: { settings: { something_else: true } } });
  assert.equal(await isModuleEnabled(db, g.id, "onboarding"), false);
});

// ── Module enablement: caching + failure ─────────────────────────────────────

test("module state is cached per guild and invalidatable", async () => {
  const reads = [];
  const db = fakeSupabase({ ticket_configs: { enabled: true } }, reads);
  const g = nextGuild();
  await isModuleEnabled(db, g.id, "tickets");
  await isModuleEnabled(db, g.id, "tickets");
  assert.equal(reads.length, 1);

  invalidateModules(g.id, "tickets");
  await isModuleEnabled(db, g.id, "tickets");
  assert.equal(reads.length, 2);
});

test("a failed module read fails OPEN to the module default", async () => {
  // Deliberately the opposite of the permission ladder: a DB blip should not
  // tell every server their features are switched off.
  const g = nextGuild();
  const db = brokenSupabase();
  assert.equal(await isModuleEnabled(db, g.id, "leveling"), true);
  assert.equal(await isModuleEnabled(db, g.id, "tickets"), false);
});

// ── Plan resolution ──────────────────────────────────────────────────────────

test("a guild's plan comes from its OWNER's subscription", async () => {
  // Not the invoker's — a Free member in a Pro server gets Pro commands.
  const db = fakeSupabase({ subscriptions: { plan: "business", status: "active" } });
  const g = nextGuild();
  assert.equal(await getGuildPlan(db, g), "business");
});

test("a guild whose owner never subscribed is free", async () => {
  const db = fakeSupabase({});
  const g = nextGuild();
  assert.equal(await getGuildPlan(db, g), "free");
});

test("a guild whose owner cancelled falls back to free", async () => {
  const db = fakeSupabase({ subscriptions: { plan: "business", status: "canceled" } });
  const g = nextGuild();
  assert.equal(await getGuildPlan(db, g), "free");
});

test("early access resolves every guild to the top tier", async () => {
  process.env.EARLY_ACCESS = "true";
  const db = fakeSupabase({});
  const g = nextGuild();
  assert.equal(await getGuildPlan(db, g), "enterprise");
});

test("a failed plan read falls back to free", async () => {
  const g = nextGuild();
  assert.equal(await getGuildPlan(brokenSupabase(), g), "free");
  invalidatePlan(g.id);
});

// ── The combined gate ────────────────────────────────────────────────────────

test("check allows an ungated command", async () => {
  const db = fakeSupabase({});
  const g = nextGuild();
  const verdict = await check(db, g, { name: "help" });
  assert.equal(verdict.allowed, true);
});

test("check blocks a command whose module is off, naming the module", async () => {
  const db = fakeSupabase({ ticket_configs: { enabled: false } });
  const g = nextGuild();
  const verdict = await check(db, g, { name: "ticket", module: "tickets" });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.status, "module_disabled");
  assert.match(verdict.reason, /Tickets is turned off/);
});

test("check blocks a command above the server's plan with an upgrade prompt", async () => {
  const db = fakeSupabase({ subscriptions: { plan: "free", status: "active" } });
  const g = nextGuild();
  const verdict = await check(db, g, { name: "guard", minPlan: "pro" });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.status, "plan_gated");
  // The prompt must use the DISPLAY label — internal `pro` ships as "Plus", and
  // telling someone to buy the "pro plan" would point them at the wrong tier.
  assert.match(verdict.reason, /Plus plan/);
  assert.match(verdict.reason, /on Free/);
  assert.deepEqual(verdict.upgrade, { required: "pro", current: "free" });
});

test("check allows a plan-gated command when the server's plan covers it", async () => {
  const db = fakeSupabase({ subscriptions: { plan: "business", status: "active" } });
  const g = nextGuild();
  const verdict = await check(db, g, { name: "guard", minPlan: "pro" });
  assert.equal(verdict.allowed, true);
});

test("the module check runs before the plan check", async () => {
  // A server that deliberately switched a feature OFF should be told exactly
  // that — not sold an upgrade for something they turned off themselves.
  const db = fakeSupabase({
    ticket_configs: { enabled: false },
    subscriptions: { plan: "free", status: "active" },
  });
  const g = nextGuild();
  const verdict = await check(db, g, {
    name: "ticket",
    module: "tickets",
    minPlan: "business",
  });
  assert.equal(verdict.status, "module_disabled");
});

test("moduleLabel renders the member-facing feature name", () => {
  assert.equal(moduleLabel("pulse_guard"), "Pulse Guard");
  assert.equal(moduleLabel("private_channels"), "Private Channels");
  assert.equal(moduleLabel("leveling"), "Levels & XP");
});

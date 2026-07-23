// Tests for the Analytics & Insights slash commands (PULSIFY-61).
//
// The handlers are analytics-RPC + Discord plumbing; what's worth pinning is the
// catalog wiring and the decisions that are easy to get wrong: /stats is
// moderator-tier while /insights and /management are admin-tier, all three are
// module-null and — critically — carry NO plan gate (the web routes gate both
// Insights and Management at admin only, with no advancedAnalytics gate), and
// the module exposes the three handlers index.js dispatches to. Run with
// `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS_BY_NAME } = require("../src/commands");
const { createAnalytics } = require("../src/analytics-commands");

test("/stats is moderator-tier, module-null, no plan gate, with three views", () => {
  const def = COMMANDS_BY_NAME.get("stats");
  assert.ok(def);
  assert.equal(def.defaultPermission, "moderator");
  assert.equal(def.module, null);
  assert.equal(def.minPlan ?? "free", "free");
  assert.equal(def.category, "insights");
  const subs = (def.data.toJSON().options ?? []).map((o) => o.name);
  assert.deepEqual(subs.sort(), ["channels", "members", "overview"]);
});

test("every /stats subcommand offers the period selector", () => {
  const def = COMMANDS_BY_NAME.get("stats");
  for (const sub of def.data.toJSON().options ?? []) {
    const names = (sub.options ?? []).map((o) => o.name);
    assert.ok(names.includes("period"), `${sub.name} should have a period option`);
  }
});

test("/insights is admin-tier, module-null and NOT plan-gated (matches the web route)", () => {
  const def = COMMANDS_BY_NAME.get("insights");
  assert.ok(def);
  assert.equal(def.defaultPermission, "admin");
  assert.equal(def.module, null);
  // No minPlan: the dashboard's Insights route gates on admin only, with no
  // advancedAnalytics/plan check — gating the command would sell an upgrade for
  // a page the admin can already open.
  assert.equal(def.minPlan ?? "free", "free");
});

test("/management is admin-tier, module-null, not plan-gated, with a staff option", () => {
  const def = COMMANDS_BY_NAME.get("management");
  assert.ok(def);
  assert.equal(def.defaultPermission, "admin");
  assert.equal(def.module, null);
  assert.equal(def.minPlan ?? "free", "free");
  const stats = (def.data.toJSON().options ?? []).find((o) => o.name === "stats");
  assert.ok(stats, "should have a stats subcommand");
  const opts = (stats.options ?? []).map((o) => o.name);
  assert.ok(opts.includes("staff"));
  assert.ok(opts.includes("period"));
});

test("createAnalytics exposes the three handlers index.js dispatches to", () => {
  const mod = createAnalytics({ client: {}, supabase: {} });
  assert.equal(typeof mod.handleStats, "function");
  assert.equal(typeof mod.handleInsights, "function");
  assert.equal(typeof mod.handleManagement, "function");
});

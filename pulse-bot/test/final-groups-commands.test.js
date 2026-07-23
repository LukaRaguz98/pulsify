// Tests for the final command groups (PULSIFY-61):
// Backup · Integrations + Templates · Notifications + Feedback.
//
// Pins the catalog wiring (tiers, module-null, /backup's Business plan gate),
// the template-apply parity (preset profiles + the feature write-path mirror of
// the dashboard's applyFeatures), and feedback validation. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { COMMANDS_BY_NAME } = require("../src/commands");
const {
  FEATURE_KEYS,
  findBuiltin,
  featureKeysDecided,
  applyFeatures,
} = require("../src/template-apply");
const { validateFeedback } = require("../src/community-commands");

// ── Catalog wiring ─────────────────────────────────────────────────────────

test("/backup is admin-tier, module-null, Business-gated, with create + list", () => {
  const def = COMMANDS_BY_NAME.get("backup");
  assert.ok(def);
  assert.equal(def.defaultPermission, "admin");
  assert.equal(def.module, null);
  assert.equal(def.minPlan, "business");
  assert.deepEqual((def.data.toJSON().options ?? []).map((o) => o.name).sort(), ["create", "list"]);
});

test("/template is admin-tier, module-null, apply subcommand, autocompletes", () => {
  const def = COMMANDS_BY_NAME.get("template");
  assert.ok(def);
  assert.equal(def.defaultPermission, "admin");
  assert.equal(def.module, null);
  assert.equal(def.minPlan ?? "free", "free"); // per-feature gate is internal
  assert.deepEqual((def.data.toJSON().options ?? []).map((o) => o.name), ["apply"]);
  assert.equal(typeof def.autocomplete, "function");
});

test("/integrations + /notifications are read views at the right tiers", () => {
  const integ = COMMANDS_BY_NAME.get("integrations");
  assert.equal(integ.defaultPermission, "admin");
  assert.equal(integ.module, null);
  const notif = COMMANDS_BY_NAME.get("notifications");
  assert.equal(notif.defaultPermission, "moderator");
  assert.equal(notif.module, null);
});

test("/feedback is everyone-tier with a 1-5 rating + title + message", () => {
  const def = COMMANDS_BY_NAME.get("feedback");
  assert.equal(def.defaultPermission, "everyone");
  assert.equal(def.module, null);
  const submit = (def.data.toJSON().options ?? []).find((o) => o.name === "submit");
  const opts = (submit.options ?? []).map((o) => o.name);
  assert.deepEqual(opts.sort(), ["message", "rating", "title"]);
  const rating = submit.options.find((o) => o.name === "rating");
  assert.equal((rating.choices ?? []).length, 5);
});

// ── Template presets (parity with lib/templates.ts) ──────────────────────────

test("there are 9 feature keys and the Essentials preset matches", () => {
  assert.equal(FEATURE_KEYS.length, 9);
  const essentials = findBuiltin("builtin-essentials");
  assert.ok(essentials);
  const on = FEATURE_KEYS.filter((k) => essentials.features[k] === true).sort();
  assert.deepEqual(on, ["automations", "moderation_alerts", "onboarding", "pulse_guard"]);
  // Every feature is decided (on or off) in a preset — a full profile.
  assert.equal(featureKeysDecided(essentials.features).length, 9);
});

test("Full Community turns everything on", () => {
  const full = findBuiltin("builtin-community");
  assert.ok(FEATURE_KEYS.every((k) => full.features[k] === true));
});

// ── applyFeatures write-path (mirror of the dashboard) ───────────────────────

function makeCapturingSupabase() {
  const upserts = [];
  return {
    upserts,
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: null };
        },
        async upsert(payload) {
          upserts.push({ table, payload });
          return { error: null };
        },
      };
    },
  };
}

test("applyFeatures writes settings sub-keys and the right per-feature tables", async () => {
  const supabase = makeCapturingSupabase();
  const features = { automations: true, leveling: true, tickets: false };
  const keys = ["automations", "leveling", "tickets"];
  const { applied, warnings } = await applyFeatures(supabase, "g1", features, "actor1", keys);

  assert.equal(warnings.length, 0);

  // automations → guild_settings.settings.{welcome,goodbye}.enabled = true
  const settingsWrite = supabase.upserts.find((u) => u.table === "guild_settings");
  assert.ok(settingsWrite);
  assert.equal(settingsWrite.payload.settings.welcome.enabled, true);
  assert.equal(settingsWrite.payload.settings.goodbye.enabled, true);

  // leveling → leveling_settings.enabled = true (no updated_by)
  const lvl = supabase.upserts.find((u) => u.table === "leveling_settings");
  assert.equal(lvl.payload.enabled, true);

  // tickets → ticket_configs.enabled = false, stamped with the actor
  const tkt = supabase.upserts.find((u) => u.table === "ticket_configs");
  assert.equal(tkt.payload.enabled, false);
  assert.equal(tkt.payload.updated_by, "actor1");

  // Applied summary carries each decision.
  const byKey = Object.fromEntries(applied.map((a) => [a.key, a.enabled]));
  assert.deepEqual(byKey, { automations: true, leveling: true, tickets: false });
});

// ── Feedback validation ──────────────────────────────────────────────────────

test("validateFeedback accepts a good review and trims it", () => {
  const res = validateFeedback({ title: "  Love it  ", message: "Pulse transformed our server.", rating: 5 });
  assert.ok(res.ok);
  assert.equal(res.value.title, "Love it");
  assert.equal(res.value.rating, 5);
});

test("validateFeedback rejects a short title and a bad rating", () => {
  assert.equal(validateFeedback({ title: "hi", message: "long enough message here", rating: 5 }).ok, false);
  assert.equal(validateFeedback({ title: "Great tool", message: "long enough message here", rating: 9 }).ok, false);
  assert.equal(validateFeedback({ title: "Great tool", message: "short", rating: 4 }).ok, false);
});

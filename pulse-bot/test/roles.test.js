// Tests for the role commands (pulse-bot/src/roles.js).
//
// `categorizeRole` MIRRORS pulsify-web-app/lib/role-hierarchy.ts. If they drift,
// /role hierarchy and the dashboard's Role Hierarchy tab put the SAME role in
// different buckets — a user-visible contradiction that no type checker can
// catch, because the two live in different languages and packages. These tests
// are the only thing holding them together, so they encode the priority order
// explicitly rather than just spot-checking a few roles. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");

const {
  categorizeRole,
  CATEGORY_META,
  MANAGEMENT_PERMISSIONS,
  BOT_NAME_KEYWORDS,
  MANAGEMENT_NAME_KEYWORDS,
  TEMP_MAX_MINUTES,
  TEMP_PRESETS,
} = require("../src/roles");
const { parseDuration } = require("../src/moderation");

/** A role double. `perms` is an array of PermissionFlagsBits. */
function role(name, { perms = [], managed = false } = {}) {
  const held = new Set(perms.map(String));
  return {
    name,
    managed,
    permissions: { has: (flag) => held.has(String(flag)) },
  };
}

// ── Priority: bots beat everything ───────────────────────────────────────────

test("a managed role is Bots", () => {
  const r = categorizeRole(role("Rythm", { managed: true }));
  assert.equal(r.category, "bots");
  assert.equal(r.reason, "Managed integration role");
});

test("a bot-NAMED role is Bots even when unmanaged", () => {
  // Self-hosted bots often leave their role unmanaged.
  for (const kw of BOT_NAME_KEYWORDS) {
    const r = categorizeRole(role(`Some ${kw} thing`));
    assert.equal(r.category, "bots", `"${kw}" should read as a bot role`);
  }
});

test("the bot check beats management PERMISSIONS", () => {
  // This is the non-obvious one: a role named "Music Bot" that somehow holds
  // Manage Messages is still Bots, because step 1 runs before step 2. Get the
  // order wrong and every bot role with a moderation permission silently moves
  // to Management on one surface only.
  const r = categorizeRole(role("Music Bot", { perms: [PermissionFlagsBits.ManageMessages] }));
  assert.equal(r.category, "bots");
});

test("managed beats a management name", () => {
  const r = categorizeRole(role("Admin Bot", { managed: true }));
  assert.equal(r.category, "bots");
  assert.equal(r.reason, "Managed integration role");
});

// ── Priority: permissions beat names ─────────────────────────────────────────

test("Administrator is Management with its own reason", () => {
  const r = categorizeRole(role("Cool Cats", { perms: [PermissionFlagsBits.Administrator] }));
  assert.equal(r.category, "management");
  assert.equal(r.reason, "Has the Administrator permission");
});

test("every management permission marks a role as Management", () => {
  for (const p of MANAGEMENT_PERMISSIONS) {
    const r = categorizeRole(role("Totally Normal Role", { perms: [p.flag] }));
    assert.equal(r.category, "management", `${p.name} should mark Management`);
  }
});

test("a role that can ban is Management regardless of its name", () => {
  // Permissions win over names — a role called "Member" that can ban IS staff.
  const r = categorizeRole(role("Member", { perms: [PermissionFlagsBits.BanMembers] }));
  assert.equal(r.category, "management");
  assert.equal(r.reason, "Has moderation permissions");
});

test("a staff-NAMED role with no permissions is still Management", () => {
  for (const kw of MANAGEMENT_NAME_KEYWORDS) {
    const r = categorizeRole(role(`Server ${kw}`));
    assert.equal(r.category, "management", `"${kw}" should read as staff`);
    assert.match(r.reason, /^Name contains "/);
  }
});

test("keyword matching is first-match-wins, in list order", () => {
  // Not cosmetic: "administrator" contains "admin", which sits earlier in the
  // list, so the reason reads 'Name contains "admin"'. The web's matchKeyword
  // walks the same list in the same order and reports the same keyword. Sorting
  // or reordering either list would silently change the reason text on one
  // surface only.
  assert.equal(categorizeRole(role("Server administrator")).reason, 'Name contains "admin"');
  // Likewise "moderator" contains "mod", but "moderator" comes first here.
  assert.equal(categorizeRole(role("Server moderator")).reason, 'Name contains "moderator"');
});

// ── Community (the default bucket) ───────────────────────────────────────────

test("an ordinary role is Community", () => {
  const r = categorizeRole(role("Purple"));
  assert.equal(r.category, "community");
  assert.equal(r.reason, "General member role");
});

test("a community-keyword role gets a friendlier reason", () => {
  const r = categorizeRole(role("Server Booster"));
  assert.equal(r.category, "community");
  assert.equal(r.reason, 'Name contains "booster"');
});

test("a harmless permission does not promote a role to Management", () => {
  // Send Messages / Add Reactions are not management powers. If this fails,
  // someone widened MANAGEMENT_PERMISSIONS beyond the web's set.
  const r = categorizeRole(
    role("Chatty", { perms: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions] }),
  );
  assert.equal(r.category, "community");
});

test("categorisation is case-insensitive", () => {
  assert.equal(categorizeRole(role("ADMIN")).category, "management");
  assert.equal(categorizeRole(role("MusicBot")).category, "bots");
});

// ── Parity guards against lib/role-hierarchy.ts ──────────────────────────────

test("the management permission set matches the web's, exactly", () => {
  // MANAGEMENT_PERMISSION_KEYS in lib/role-hierarchy.ts. Two traps encoded here:
  // VIEW_AUDIT_LOG IS in the set, and MANAGE_EMOJIS is NOT. Both are easy to
  // "tidy" wrongly.
  const names = MANAGEMENT_PERMISSIONS.map((p) => p.name).sort();
  assert.deepEqual(names, [
    "Administrator",
    "Ban Members",
    "Kick Members",
    "Manage Channels",
    "Manage Messages",
    "Manage Nicknames",
    "Manage Roles",
    "Manage Server",
    "Manage Webhooks",
    "Timeout Members",
    "View Audit Log",
  ]);
  // Manage Expressions must NOT promote a role to Management.
  assert.equal(
    categorizeRole(role("Emoji Team", { perms: [PermissionFlagsBits.ManageEmojisAndStickers] }))
      .category,
    "community",
  );
  // View Audit Log must.
  assert.equal(
    categorizeRole(role("Auditors", { perms: [PermissionFlagsBits.ViewAuditLog] })).category,
    "management",
  );
});

test("the keyword lists match the web's, exactly", () => {
  assert.deepEqual(BOT_NAME_KEYWORDS, [
    "bot",
    "disboard",
    "music",
    "radio",
    "pulse",
    "webhook",
    "integration",
  ]);
  assert.deepEqual(MANAGEMENT_NAME_KEYWORDS, [
    "owner",
    "admin",
    "administrator",
    "moderator",
    "mod",
    "support",
    "staff",
    "helper",
    "manager",
  ]);
});

test("every hierarchy category has display copy", () => {
  for (const c of ["management", "bots", "community"]) {
    assert.ok(CATEGORY_META[c]?.label, `${c} needs a label`);
    assert.ok(CATEGORY_META[c]?.blurb, `${c} needs a blurb`);
  }
});

// ── /role temp durations ─────────────────────────────────────────────────────

test("temp presets all parse and fit the 4-year cap", () => {
  // A preset offered by autocomplete and then rejected on submit is the worst
  // possible outcome.
  for (const p of TEMP_PRESETS) {
    const parsed = parseDuration(p.value);
    assert.ok(parsed !== null, `preset ${p.value} should parse`);
    assert.ok(parsed <= TEMP_MAX_MINUTES, `preset ${p.value} exceeds the cap`);
  }
  assert.ok(TEMP_PRESETS.length <= 25, "autocomplete allows at most 25 choices");
});

test("the temp cap mirrors lib/temporary-roles.ts (4 years)", () => {
  assert.equal(TEMP_MAX_MINUTES, 4 * 365 * 24 * 60);
  assert.ok(parseDuration("365d") <= TEMP_MAX_MINUTES);
  // 5 years must be refused rather than clamped.
  assert.ok(parseDuration("1825d") > TEMP_MAX_MINUTES);
});

test("/role temp shares one duration grammar with /timeout", () => {
  // Both use parseDuration — a member who learns "7d" once should not find it
  // means something different per command.
  assert.equal(parseDuration("7d"), 7 * 24 * 60);
  assert.equal(parseDuration("12h"), 720);
  assert.equal(parseDuration("1h30m"), 90);
  assert.equal(parseDuration("nonsense"), null);
});

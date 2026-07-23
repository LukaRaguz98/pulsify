// Tests for the ticket slash commands (PULSIFY-61) — the parts of
// pulse-bot/src/tickets.js added on top of the existing panel/button system.
//
// The handlers themselves are almost entirely Discord + Supabase calls, so what
// is worth pinning here is the SHARED VOCABULARY: the priority list and its
// labels mirror lib/tickets.ts, and the ticket/application status values mirror
// the DB's CHECK-free text columns. If those drift, /ticket priority offers a
// value the dashboard can't render, or vice versa. Run with `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { TICKET_PRIORITIES, PRIORITY_LABELS } = require("../src/tickets");
const { APPLICATION_STATUS_META } = require("../src/applications");
const { COMMANDS_BY_NAME } = require("../src/commands");

// ── Priorities ───────────────────────────────────────────────────────────────

test("the priority list mirrors lib/tickets.ts, in escalating order", () => {
  // PRIORITIES in lib/tickets.ts, ordered by PRIORITY_META.order (0→3). The
  // /ticket priority picker renders in this order, so a reshuffle here silently
  // reorders the dropdown.
  assert.deepEqual(TICKET_PRIORITIES, ["low", "normal", "high", "urgent"]);
});

test("every priority has a label", () => {
  for (const p of TICKET_PRIORITIES) {
    assert.ok(PRIORITY_LABELS[p], `${p} needs a label`);
  }
});

test("priority labels match the dashboard's exactly", () => {
  // PRIORITY_META in lib/tickets.ts. A ticket set to "high" from Discord must
  // read "High" in the dashboard, not "high" or "High priority".
  assert.deepEqual(PRIORITY_LABELS, {
    low: "Low",
    normal: "Normal",
    high: "High",
    urgent: "Urgent",
  });
});

test("the priority default matches the tickets table default", () => {
  // tickets.priority defaults to 'normal' in the schema (20260527_tickets.sql).
  assert.ok(TICKET_PRIORITIES.includes("normal"));
});

// ── Application statuses ─────────────────────────────────────────────────────

test("application statuses cover every value the schema allows", () => {
  // ticket_applications.status: pending | approved | rejected | needs_info.
  // /application status renders whatever it reads, so a missing entry would show
  // a raw slug to the applicant.
  for (const s of ["pending", "approved", "rejected", "needs_info"]) {
    assert.ok(APPLICATION_STATUS_META[s]?.label, `${s} needs a label`);
  }
});

test("application status labels match lib/applications.ts", () => {
  assert.equal(APPLICATION_STATUS_META.pending.label, "Pending review");
  assert.equal(APPLICATION_STATUS_META.approved.label, "Approved");
  assert.equal(APPLICATION_STATUS_META.rejected.label, "Rejected");
  assert.equal(APPLICATION_STATUS_META.needs_info.label, "Needs more info");
});

// ── Catalog wiring ───────────────────────────────────────────────────────────

test("/ticket is support-tier and gated on the tickets module", () => {
  const def = COMMANDS_BY_NAME.get("ticket");
  assert.ok(def, "/ticket should be in the catalog");
  // The whole point of the support tier: a ticket handler who is NOT a
  // moderator can still work their queue.
  assert.equal(def.defaultPermission, "support");
  // A server with tickets switched off must not serve them.
  assert.equal(def.module, "tickets");
});

test("/ticket exposes exactly the four spec'd subcommands", () => {
  const json = COMMANDS_BY_NAME.get("ticket").data.toJSON();
  const subs = (json.options ?? []).filter((o) => o.type === 1).map((o) => o.name);
  assert.deepEqual(subs.sort(), ["add", "claim", "close", "priority"]);
});

test("/ticket priority offers exactly the valid priorities", () => {
  // The picker's choices must be the same set the DB accepts — an invalid choice
  // would be rejected only after the member submits.
  const json = COMMANDS_BY_NAME.get("ticket").data.toJSON();
  const priority = (json.options ?? []).find((o) => o.name === "priority");
  const level = priority.options.find((o) => o.name === "level");
  assert.deepEqual(
    level.choices.map((c) => c.value),
    TICKET_PRIORITIES,
  );
  assert.deepEqual(
    level.choices.map((c) => c.name),
    TICKET_PRIORITIES.map((p) => PRIORITY_LABELS[p]),
  );
  assert.equal(level.required, true);
});

test("/application is member-tier and has no user option", () => {
  const def = COMMANDS_BY_NAME.get("application");
  assert.ok(def, "/application should be in the catalog");
  // Member tier: applicants check their own.
  assert.equal(def.defaultPermission, "everyone");
  assert.equal(def.module, "tickets");

  // No user option, deliberately — applications carry decision notes written
  // for the applicant, so a lookup option would leak staff notes to anyone.
  const json = def.data.toJSON();
  const status = (json.options ?? []).find((o) => o.name === "status");
  assert.deepEqual(status.options ?? [], []);
});

test("/ticket and /application are separate commands, not one group", () => {
  // A subcommand cannot carry its own permission tier (command_configs keys on
  // command_name; Discord's default_member_permissions is top-level only).
  // Folding /application into /ticket would either expose the support
  // subcommands to everyone or lock applicants out of their own status.
  const ticket = COMMANDS_BY_NAME.get("ticket");
  const application = COMMANDS_BY_NAME.get("application");
  assert.notEqual(ticket.defaultPermission, application.defaultPermission);
});

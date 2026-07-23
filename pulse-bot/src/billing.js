// Plan definitions (bot side).
//
// This MIRRORS the plan half of pulsify-web-app/lib/billing.ts — keep the plan
// slugs, ranks, labels and the early-access behaviour in sync. Same mirroring
// stance as src/reputation.js ↔ lib/reputation.ts: the bot is CommonJS in a
// separate package and can't import the web app's TypeScript.
//
// Only what the bot needs to GATE is mirrored — plan identity, ordering, and
// which subscription statuses still grant access. Prices, Stripe wiring, the
// limits matrix and the marketing copy stay web-side; the bot never sells
// anything, it just needs to know whether a server may run a command.

/** Ordered free → enterprise. Mirrors PLANS in lib/billing.ts. */
const PLANS = ["free", "pro", "business", "enterprise"];

const PLAN_RANK = {
  free: 0,
  pro: 1,
  business: 2,
  enterprise: 3,
};

// Display labels are decoupled from the internal slugs — internal `pro` ships
// as "Plus" and internal `business` ships as "Pro". Upgrade prompts must use
// these, or we'd tell a member to buy a tier that doesn't exist by that name.
const PLAN_LABELS = {
  free: "Free",
  pro: "Plus",
  business: "Pro",
  enterprise: "Enterprise",
};

/** Statuses that still behave as the paid plan (grace for a failed payment). */
const ACCESS_GRANTING_STATUSES = ["active", "trialing", "past_due"];

/**
 * Early access: every plan resolves to the top tier, so nothing is gated until
 * the operator flips EARLY_ACCESS off. Mirrors isEarlyAccess() in lib/billing.ts
 * — including reading the NEXT_PUBLIC_ mirror, so a single shared env value
 * configures the web app and the bot identically.
 */
const EARLY_ACCESS_PLAN = "enterprise";

function isEarlyAccess() {
  const raw = process.env.EARLY_ACCESS ?? process.env.NEXT_PUBLIC_EARLY_ACCESS;
  if (!raw) return false;
  const v = String(raw).trim().toLowerCase();
  return v === "yes" || v === "true" || v === "1" || v === "on";
}

/** True if `current` is at least `required`. */
function hasPlan(current, required) {
  const a = PLAN_RANK[current] ?? 0;
  const b = PLAN_RANK[required] ?? 0;
  return a >= b;
}

function isActiveStatus(status) {
  return ACCESS_GRANTING_STATUSES.includes(status);
}

/**
 * Resolve a stored subscription row to the plan it actually grants. A lapsed
 * or cancelled subscription demotes to free. Mirrors effectivePlan().
 */
function effectivePlan(storedPlan, status) {
  if (!storedPlan) return "free";
  if (!PLANS.includes(storedPlan)) return "free";
  if (status && !isActiveStatus(status)) return "free";
  return storedPlan;
}

module.exports = {
  PLANS,
  PLAN_RANK,
  PLAN_LABELS,
  ACCESS_GRANTING_STATUSES,
  EARLY_ACCESS_PLAN,
  isEarlyAccess,
  hasPlan,
  isActiveStatus,
  effectivePlan,
};

// Module + subscription gating for Pulse slash commands (PULSIFY-61).
//
// Two independent questions a command must answer before it runs, on top of the
// Command Center's own checks (src/command-center.js) and the permission ladder
// (src/permissions.js):
//
//   1. Is the command's MODULE switched on for this server? A server that has
//      turned Levels & XP off shouldn't serve /rank. The dashboard's master
//      enable switches are the source of truth.
//   2. Does the server's PLAN include it? A Pro-only command should return a
//      clear upgrade prompt on Free, not a permission error.
//
// Both mirror logic that already exists on the web side. They're re-implemented
// here rather than imported because the bot is plain CommonJS and the web app is
// TypeScript in a separate package — the same reason src/reputation.js mirrors
// lib/reputation.ts. Keep them in sync; the tests pin the parts that matter.

const {
  hasPlan,
  PLAN_RANK,
  effectivePlan,
  isEarlyAccess,
  EARLY_ACCESS_PLAN,
  PLAN_LABELS,
} = require("./billing");

// ── Module enablement ────────────────────────────────────────────────────────
//
// Built on FEATURE_KEYS + the "where the flag lives" map documented at the top
// of pulsify-web-app/lib/templates.ts, but deliberately a SUPERSET of it.
// FEATURE_KEYS lists the nine features a *template* can flip; it is not the list
// of features that have a master switch. Birthdays and Invites both own an
// `enabled` column and both back slash commands, so they gate here too — a
// server with invite tracking off shouldn't serve /invite leaderboard. Anything
// added to FEATURE_KEYS later should be added here as well.
//
// Each feature stores its master switch in a different place, and — importantly
// — each has its own default for a server that has NEVER configured it:
//
//   • leveling / economy default ON. A missing row means "enabled with
//     defaults" (see normaliseLevelingSettings / normaliseRewardSettings), so
//     /rank and /balance must work in a server that never opened those settings.
//   • everything else defaults OFF. Tickets, private channels, Pulse Guard and
//     DDoS protection all provision Discord state; they only run once an admin
//     has deliberately set them up.
//
// Getting this backwards would silently disable working commands in every
// unconfigured server, so the defaults are pinned by tests.

const MODULE_SOURCES = {
  leveling: {
    table: "leveling_settings",
    column: "enabled",
    defaultEnabled: true,
    label: "Levels & XP",
    settingsPath: "leveling-settings",
  },
  economy: {
    table: "economy_reward_settings",
    column: "enabled",
    defaultEnabled: true,
    label: "Economy",
    settingsPath: "economy",
  },
  tickets: {
    table: "ticket_configs",
    column: "enabled",
    defaultEnabled: false,
    label: "Tickets",
    settingsPath: "tickets",
  },
  private_channels: {
    table: "private_channel_configs",
    column: "enabled",
    defaultEnabled: false,
    label: "Private Channels",
    settingsPath: "private-channels-settings",
  },
  pulse_guard: {
    table: "ai_moderation_settings",
    column: "enabled",
    defaultEnabled: false,
    label: "Pulse Guard",
    settingsPath: "ai-moderation",
  },
  ddos_protection: {
    table: "security_configs",
    column: "enabled",
    defaultEnabled: false,
    label: "DDoS Protection",
    settingsPath: "security",
  },
  // Not in FEATURE_KEYS (templates can't flip them) but both own a real master
  // switch that their commands must respect.
  birthdays: {
    table: "birthday_settings",
    column: "enabled",
    defaultEnabled: false,
    label: "Birthdays",
    settingsPath: "birthdays",
  },
  invites: {
    table: "invite_settings",
    column: "enabled",
    defaultEnabled: false,
    label: "Invite Tracking",
    settingsPath: "invite-settings",
  },
  // These three live inside the guild_settings.settings JSON blob rather than
  // their own table, so they're resolved by `settingsPath` into that object.
  onboarding: {
    settingsKey: ["member_onboarding", "enabled"],
    defaultEnabled: false,
    label: "Onboarding & Welcome",
    settingsPath: "onboarding",
  },
  moderation_alerts: {
    settingsKey: ["moderation_alerts", "enabled"],
    defaultEnabled: false,
    label: "Moderation Alerts",
    settingsPath: "moderation",
  },
  // Automations is the odd one: it has no single switch. The dashboard treats
  // it as on when EITHER the welcome or goodbye automation is enabled, which is
  // how templates.ts applies it too.
  automations: {
    anySettingsKey: [
      ["welcome", "enabled"],
      ["goodbye", "enabled"],
    ],
    defaultEnabled: false,
    label: "Automations",
    settingsPath: "automations",
  },
};

const MODULE_KEYS = Object.keys(MODULE_SOURCES);

const MODULE_CACHE_TTL_MS = 60_000;
// `${guildId}:${moduleKey}` -> { enabled, fetchedAt }
const moduleCache = new Map();

/** Walk a dotted path (as an array) through an object, tolerating gaps. */
function dig(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

async function readGuildSettings(supabase, guildId) {
  const { data, error } = await supabase
    .from("guild_settings")
    .select("settings")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.settings ?? null;
}

/**
 * Whether `moduleKey` is switched on for `guildId`. An unknown/absent module
 * key means the command isn't tied to a toggleable feature — always on.
 *
 * Fails OPEN (returns the module's default) on a read error: a DB blip should
 * degrade to "the command works" rather than telling every server their
 * features are off. This is the opposite stance to the permission ladder, which
 * fails closed — the asymmetry is deliberate. A wrongly-allowed /rank is a
 * cosmetic bug; a wrongly-allowed /ban is a security incident.
 */
async function isModuleEnabled(supabase, guildId, moduleKey) {
  if (!moduleKey) return true;
  const source = MODULE_SOURCES[moduleKey];
  if (!source) return true;

  const cacheKey = `${guildId}:${moduleKey}`;
  const cached = moduleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < MODULE_CACHE_TTL_MS) {
    return cached.enabled;
  }

  let enabled = source.defaultEnabled;
  try {
    if (source.table) {
      const { data, error } = await supabase
        .from(source.table)
        .select(source.column)
        .eq("guild_id", guildId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      // No row at all → the server never configured this feature, so the
      // module's own default decides.
      enabled = data ? Boolean(data[source.column]) : source.defaultEnabled;
    } else {
      const settings = await readGuildSettings(supabase, guildId);
      if (settings === null) {
        enabled = source.defaultEnabled;
      } else if (source.anySettingsKey) {
        enabled = source.anySettingsKey.some(
          (path) => dig(settings, path) === true,
        );
      } else {
        const value = dig(settings, source.settingsKey);
        enabled = typeof value === "boolean" ? value : source.defaultEnabled;
      }
    }
  } catch (err) {
    console.warn(
      `[Pulse] module check failed for ${moduleKey} in ${guildId}:`,
      err.message,
    );
    if (cached) return cached.enabled; // prefer a stale answer to a wrong one
    enabled = source.defaultEnabled;
  }

  moduleCache.set(cacheKey, { enabled, fetchedAt: Date.now() });
  return enabled;
}

/** Drop cached module state — call when the dashboard flips a switch. */
function invalidateModules(guildId, moduleKey) {
  if (moduleKey) {
    moduleCache.delete(`${guildId}:${moduleKey}`);
    return;
  }
  for (const key of MODULE_KEYS) moduleCache.delete(`${guildId}:${key}`);
}

function moduleLabel(moduleKey) {
  return MODULE_SOURCES[moduleKey]?.label ?? moduleKey;
}

function moduleSettingsPath(moduleKey) {
  return MODULE_SOURCES[moduleKey]?.settingsPath ?? null;
}

// ── Plan resolution ──────────────────────────────────────────────────────────
//
// WHOSE plan gates a slash command?
//
// Subscriptions are PER-USER (`subscriptions.user_id`) — there is no guild→plan
// link anywhere in the schema. On the dashboard that's unambiguous: the acting
// user's plan gates their own action. In Discord it isn't. Gating on the
// INVOKER would mean a Free member running /rank in a server whose owner pays
// for Pro gets told to upgrade — the server already has the feature, and the
// member can't buy it for them anyway.
//
// So a command is gated on the GUILD OWNER's plan: the person who would be
// paying for this server. Every member of a Pro server gets Pro commands.
//
// Note this is currently moot in practice — EARLY_ACCESS makes every plan
// resolve to the top tier (mirroring lib/billing-server.getUserPlan). It's
// built correctly so that flipping early access off does the right thing
// instead of locking members out of their own server's features.

const PLAN_CACHE_TTL_MS = 5 * 60_000;
// guildId -> { plan, fetchedAt }
const planCache = new Map();

/**
 * The effective plan for a guild, via its owner's subscription. Falls back to
 * 'free' when the owner has no row (never subscribed) or the read fails —
 * matching the web app, where a missing subscription row is simply free.
 */
async function getGuildPlan(supabase, guild) {
  if (isEarlyAccess()) return EARLY_ACCESS_PLAN;

  const cached = planCache.get(guild.id);
  if (cached && Date.now() - cached.fetchedAt < PLAN_CACHE_TTL_MS) {
    return cached.plan;
  }

  let plan = "free";
  try {
    const ownerId = guild.ownerId;
    if (ownerId) {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("plan, status")
        .eq("user_id", String(ownerId))
        .maybeSingle();
      if (error) throw new Error(error.message);
      // effectivePlan demotes a lapsed subscription to free, so a cancelled
      // Pro server stops serving Pro commands without any extra check here.
      plan = effectivePlan(data?.plan, data?.status);
    }
  } catch (err) {
    console.warn(`[Pulse] plan lookup failed for ${guild.id}:`, err.message);
    if (cached) return cached.plan;
    plan = "free";
  }

  planCache.set(guild.id, { plan, fetchedAt: Date.now() });
  return plan;
}

function invalidatePlan(guildId) {
  planCache.delete(guildId);
}

// ── The gate ─────────────────────────────────────────────────────────────────

/**
 * Resolve whether `def` may run in `guild`. Returns `{ allowed: true }` or a
 * blocked verdict carrying the status (for command_logs) + a member-facing
 * reason, so the caller can log and reply consistently.
 *
 * Order matters: the module check runs first. If a server has switched Tickets
 * off, "Tickets is turned off" is the honest answer — telling them to upgrade
 * for a feature they've deliberately disabled would be nonsense.
 */
async function check(supabase, guild, def) {
  const moduleKey = def.module ?? null;
  if (moduleKey && !(await isModuleEnabled(supabase, guild.id, moduleKey))) {
    return {
      allowed: false,
      status: "module_disabled",
      reason: `${moduleLabel(moduleKey)} is turned off in this server. An admin can switch it on from the Pulsify dashboard.`,
    };
  }

  const required = def.minPlan ?? "free";
  if (required !== "free") {
    const current = await getGuildPlan(supabase, guild);
    if (!hasPlan(current, required)) {
      return {
        allowed: false,
        status: "plan_gated",
        reason: upgradeMessage(def, required, current),
        upgrade: { required, current },
      };
    }
  }

  return { allowed: true };
}

/**
 * The upgrade prompt shown when a command is above the server's plan. Names the
 * command, the tier needed, and who can act — a member can't upgrade the server
 * themselves, so pointing them at a checkout page would be a dead end.
 */
function upgradeMessage(def, required, current) {
  const needed = PLAN_LABELS[required] ?? required;
  const have = PLAN_LABELS[current] ?? current;
  return `\`/${def.name}\` needs the ${needed} plan — this server is on ${have}. The server owner can upgrade from the Pulsify dashboard.`;
}

module.exports = {
  MODULE_SOURCES,
  MODULE_KEYS,
  isModuleEnabled,
  invalidateModules,
  moduleLabel,
  moduleSettingsPath,
  getGuildPlan,
  invalidatePlan,
  check,
  upgradeMessage,
  // Re-exported so callers don't need to know whether plan helpers live here or
  // in the billing mirror.
  hasPlan,
  PLAN_RANK,
};

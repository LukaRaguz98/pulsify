// Shared permission ladder for Pulse slash commands (PULSIFY-61).
//
// One tier ladder, one resolver, used by every command. Before this, the only
// access check lived inline in command-center.js and knew three tiers
// (everyone/moderator/admin). The expanded command set needs a fourth —
// SUPPORT — because ticket commands (/ticket claim, /ticket priority) should be
// runnable by support staff who are deliberately NOT moderators.
//
// ── The ladder ───────────────────────────────────────────────────────────────
//   member    — anyone in the guild
//   support   — ticket support staff, resolved from the roles admins already
//               configured in ticket_configs.support_role_ids (+ the per-type
//               support_role_ids). NOT a Discord permission — it's a role list,
//               which is why it needs a DB read and can't be answered from the
//               interaction alone.
//   moderator — holds any of the Discord moderation permissions
//   admin     — Administrator or Manage Server
//
// The ladder is INCLUSIVE and ordered: satisfying a tier satisfies every tier
// below it. An admin passes a support check without holding a support role,
// which is what admins expect. Note the ladder is about *capability*, not
// identity: a support-role holder who is also a moderator passes both.
//
// `everyone` is accepted as an alias for `member` because command_configs rows
// (and the existing catalog) already use that word. Keep both working — the
// stored data says 'everyone' and rewriting it would be a migration for no gain.

const { PermissionFlagsBits } = require("discord.js");

/** Ordered low → high. The index doubles as the rank comparison. */
const TIERS = ["member", "support", "moderator", "admin"];

const TIER_RANK = Object.fromEntries(TIERS.map((t, i) => [t, i]));

const TIER_LABELS = {
  member: "Everyone",
  support: "Support staff",
  moderator: "Mods",
  admin: "Admins",
};

/** Normalise a stored/authored tier onto the ladder. Unknown → member. */
function normaliseTier(level) {
  if (level === "everyone") return "member";
  return TIER_RANK[level] === undefined ? "member" : level;
}

const SUPPORT_CACHE_TTL_MS = 60_000;
// guildId -> { roleIds: Set<string>, fetchedAt }
const supportRoleCache = new Map();

/**
 * The guild's support-staff role ids: the ticket config's roles unioned with
 * every per-type override (mirrors how tickets.js:486 builds the list when it
 * grants channel access, so "can see tickets" and "passes a support check"
 * never disagree).
 *
 * Cached for a minute — this runs on every support-tier command and the role
 * list changes rarely. A failed read yields an empty set, which fails CLOSED:
 * support staff fall back to needing a moderator permission rather than the
 * check silently passing for everyone.
 */
async function getSupportRoleIds(supabase, guildId) {
  const cached = supportRoleCache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < SUPPORT_CACHE_TTL_MS) {
    return cached.roleIds;
  }
  let roleIds = new Set();
  try {
    const { data, error } = await supabase
      .from("ticket_configs")
      .select("support_role_ids, ticket_types")
      .eq("guild_id", guildId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    for (const id of data?.support_role_ids ?? []) roleIds.add(String(id));
    for (const type of data?.ticket_types ?? []) {
      for (const id of type?.support_role_ids ?? []) roleIds.add(String(id));
    }
  } catch (err) {
    console.warn(
      `[Pulse] support role lookup failed for ${guildId}:`,
      err.message,
    );
    // Serve a stale list if we have one rather than dropping support staff to
    // member on a transient DB blip.
    if (cached) return cached.roleIds;
    roleIds = new Set();
  }
  supportRoleCache.set(guildId, { roleIds, fetchedAt: Date.now() });
  return roleIds;
}

function invalidateSupportRoles(guildId) {
  supportRoleCache.delete(guildId);
}

function isAdmin(member) {
  const perms = member?.permissions;
  if (!perms) return false;
  return (
    perms.has(PermissionFlagsBits.Administrator) ||
    perms.has(PermissionFlagsBits.ManageGuild)
  );
}

function isModerator(member) {
  const perms = member?.permissions;
  if (!perms) return false;
  if (isAdmin(member)) return true;
  return (
    perms.has(PermissionFlagsBits.ManageMessages) ||
    perms.has(PermissionFlagsBits.KickMembers) ||
    perms.has(PermissionFlagsBits.BanMembers) ||
    perms.has(PermissionFlagsBits.ModerateMembers)
  );
}

/**
 * The highest tier this member satisfies. Needs `supabase` + `guildId` only to
 * answer the support tier; the rest come off the interaction's permissions.
 */
async function resolveTier(supabase, guildId, member) {
  if (!member) return "member";
  if (isAdmin(member)) return "admin";
  if (isModerator(member)) return "moderator";
  const supportRoles = await getSupportRoleIds(supabase, guildId);
  if (supportRoles.size > 0) {
    const held = member.roles?.cache ? [...member.roles.cache.keys()] : [];
    if (held.some((id) => supportRoles.has(String(id)))) return "support";
  }
  return "member";
}

/**
 * Whether `member` meets `required`. Inclusive — a higher tier passes a lower
 * requirement. The support tier is the only one that costs a DB read, so skip
 * it entirely when the requirement is member (nothing to check) or when a
 * cheaper permission check already settles it.
 */
async function meetsTier(supabase, guildId, member, required) {
  const want = normaliseTier(required);
  if (want === "member") return true;
  if (!member) return false;
  // Admin/moderator answer most checks without touching the DB.
  if (isAdmin(member)) return true;
  if (want === "admin") return false;
  if (isModerator(member)) return true;
  if (want === "moderator") return false;
  // want === 'support' and the member is neither admin nor moderator — now the
  // role list is the only thing that can grant it.
  return (await resolveTier(supabase, guildId, member)) === "support";
}

/** Human-readable tier name for help listings + denial messages. */
function tierLabel(level) {
  return TIER_LABELS[normaliseTier(level)];
}

/**
 * The denial message for a failed tier check. Phrased as what the member needs,
 * not what they lack, and consistent across every command (an acceptance
 * criterion — "returns consistent permission and validation errors").
 */
function tierDenialReason(level) {
  switch (normaliseTier(level)) {
    case "admin":
      return "This command is for server admins.";
    case "moderator":
      return "This command is for moderators.";
    case "support":
      return "This command is for support staff and moderators.";
    default:
      return "You can't use this command here.";
  }
}

module.exports = {
  TIERS,
  TIER_RANK,
  normaliseTier,
  getSupportRoleIds,
  invalidateSupportRoles,
  isAdmin,
  isModerator,
  resolveTier,
  meetsTier,
  tierLabel,
  tierDenialReason,
};

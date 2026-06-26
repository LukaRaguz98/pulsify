// Role hierarchy categorization + stats — pure, deterministic, testable.
//
// First-version categorization is intentionally simple and predictable: every
// role lands in exactly one of three buckets — Management, Bots, Community —
// using managed flags, permission bits and name keywords. No AI, no
// configuration. The reason string is surfaced in the UI so admins can see
// *why* a role was placed where it was. See [[temporary-roles]] for the sibling
// tab this lives next to inside Server › Roles.

import { roleColor, type DiscordRole } from './discord'
import { permissionKeysFromBits } from './discord-permissions'

export type RoleCategory = 'management' | 'bots' | 'community'

export const ROLE_CATEGORIES: RoleCategory[] = ['management', 'bots', 'community']

export const CATEGORY_META: Record<
  RoleCategory,
  { label: string; accent: string; description: string }
> = {
  management: {
    label: 'Management',
    accent: '#f59e0b',
    description: 'Owners, admins, moderators and any role with elevated permissions.',
  },
  bots: {
    label: 'Bots',
    accent: '#a855f7',
    description: 'Managed integration roles and roles that belong to bots.',
  },
  community: {
    label: 'Community',
    accent: '#22c55e',
    description: 'Members, boosters, streamers and everything else.',
  },
}

// Permission keys that mark a role as part of server management. ADMINISTRATOR
// is the obvious one; the rest are the day-to-day moderation/management powers.
const MANAGEMENT_PERMISSION_KEYS = new Set<string>([
  'ADMINISTRATOR',
  'KICK_MEMBERS',
  'BAN_MEMBERS',
  'MODERATE_MEMBERS',
  'MANAGE_ROLES',
  'MANAGE_GUILD',
  'MANAGE_CHANNELS',
  'MANAGE_MESSAGES',
  'MANAGE_NICKNAMES',
  'MANAGE_WEBHOOKS',
  'VIEW_AUDIT_LOG',
])

// Name fragments that strongly imply a bot, e.g. "Disboard Bot", "Music Bot".
const BOT_NAME_KEYWORDS = ['bot', 'disboard', 'music', 'radio', 'pulse', 'webhook', 'integration']

// Name fragments that imply a management/staff role.
const MANAGEMENT_NAME_KEYWORDS = [
  'owner',
  'admin',
  'administrator',
  'moderator',
  'mod',
  'support',
  'staff',
  'helper',
  'manager',
]

// Name fragments that read as ordinary community roles. These default to
// Community anyway — the list only exists to produce a friendlier reason.
const COMMUNITY_NAME_KEYWORDS = [
  'member',
  'booster',
  'streamer',
  'vip',
  'verified',
  'subscriber',
  'community',
]

function matchKeyword(name: string, keywords: string[]): string | null {
  for (const k of keywords) if (name.includes(k)) return k
  return null
}

export type RoleCategorization = { category: RoleCategory; reason: string }

/**
 * Deterministic single-role categorization. Evaluated in priority order:
 *   1. managed / bot-named  → Bots
 *   2. admin/mod permissions or staff-named → Management
 *   3. everything else → Community (the default bucket)
 */
export function categorizeRole(role: DiscordRole): RoleCategorization {
  const name = role.name.toLowerCase()

  // 1 — Bots. Managed roles are owned by an integration; a bot-ish name catches
  // the rest (some self-hosted bots leave roles unmanaged).
  if (role.managed) return { category: 'bots', reason: 'Managed integration role' }
  const botKeyword = matchKeyword(name, BOT_NAME_KEYWORDS)
  if (botKeyword) return { category: 'bots', reason: `Name contains "${botKeyword}"` }

  // 2 — Management. Permissions win over names: a role that can ban/kick/etc. is
  // management even if it's named something else.
  const perms = permissionKeysFromBits(role.permissions)
  if (perms.includes('ADMINISTRATOR')) {
    return { category: 'management', reason: 'Has the Administrator permission' }
  }
  if (perms.some((p) => MANAGEMENT_PERMISSION_KEYS.has(p))) {
    return { category: 'management', reason: 'Has moderation permissions' }
  }
  const mgmtKeyword = matchKeyword(name, MANAGEMENT_NAME_KEYWORDS)
  if (mgmtKeyword) return { category: 'management', reason: `Name contains "${mgmtKeyword}"` }

  // 3 — Community (default).
  const communityKeyword = matchKeyword(name, COMMUNITY_NAME_KEYWORDS)
  if (communityKeyword) return { category: 'community', reason: `Name contains "${communityKeyword}"` }
  return { category: 'community', reason: 'General member role' }
}

export type CategorizedRole = {
  role: DiscordRole
  category: RoleCategory
  reason: string
  memberCount: number
  /** Hex string for the swatch, falling back to Discord's default grey. */
  color: string
}

export type RoleHierarchyStats = {
  totalRoles: number
  managementCount: number
  botsCount: number
  communityCount: number
  emptyRoles: number
  rolesWithMembers: number
  highestRole: { name: string; color: string } | null
  mostAssignedRole: { name: string; color: string; count: number } | null
}

export type CategoryDistribution = {
  category: RoleCategory
  roleCount: number
  memberCount: number
}

export type RoleHierarchy = {
  groups: Record<RoleCategory, CategorizedRole[]>
  stats: RoleHierarchyStats
  distribution: CategoryDistribution[]
  /** Roles with zero members vs. roles with at least one — for the active gauge. */
  emptyVsActive: { empty: number; active: number }
}

/**
 * Categorize every role (excluding @everyone), group by bucket sorted top-down
 * by hierarchy position, and roll up the statistics the Hierarchy tab renders.
 */
export function computeRoleHierarchy(
  roles: DiscordRole[],
  memberCountByRole: Map<string, number>,
): RoleHierarchy {
  const real = roles.filter((r) => r.name !== '@everyone')

  const categorized: CategorizedRole[] = real.map((role) => {
    const { category, reason } = categorizeRole(role)
    return {
      role,
      category,
      reason,
      memberCount: memberCountByRole.get(role.id) ?? 0,
      color: roleColor(role.color),
    }
  })

  const groups: Record<RoleCategory, CategorizedRole[]> = {
    management: [],
    bots: [],
    community: [],
  }
  for (const c of categorized) groups[c.category].push(c)
  // Top-down: highest hierarchy position first within each card.
  for (const cat of ROLE_CATEGORIES) {
    groups[cat].sort((a, b) => b.role.position - a.role.position)
  }

  const withMembers = categorized.filter((c) => c.memberCount > 0)

  // Highest role overall by position; most-assigned by member count.
  let highest: CategorizedRole | null = null
  let mostAssigned: CategorizedRole | null = null
  for (const c of categorized) {
    if (!highest || c.role.position > highest.role.position) highest = c
    if (!mostAssigned || c.memberCount > mostAssigned.memberCount) mostAssigned = c
  }

  const stats: RoleHierarchyStats = {
    totalRoles: categorized.length,
    managementCount: groups.management.length,
    botsCount: groups.bots.length,
    communityCount: groups.community.length,
    emptyRoles: categorized.length - withMembers.length,
    rolesWithMembers: withMembers.length,
    highestRole: highest ? { name: highest.role.name, color: highest.color } : null,
    mostAssignedRole:
      mostAssigned && mostAssigned.memberCount > 0
        ? { name: mostAssigned.role.name, color: mostAssigned.color, count: mostAssigned.memberCount }
        : null,
  }

  const distribution: CategoryDistribution[] = ROLE_CATEGORIES.map((category) => ({
    category,
    roleCount: groups[category].length,
    memberCount: groups[category].reduce((sum, c) => sum + c.memberCount, 0),
  }))

  return {
    groups,
    stats,
    distribution,
    emptyVsActive: { empty: stats.emptyRoles, active: stats.rolesWithMembers },
  }
}

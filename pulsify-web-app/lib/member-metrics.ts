// Bridges the raw Discord member + activity + infraction data onto the
// reputation/risk scoring inputs. Shared by the member directory and the
// profile page so a member's score is identical wherever it's shown.

import { snowflakeToDate, type DiscordMember, type DiscordRole } from '@/lib/discord'
import {
  assessRisk,
  computeReputation,
  daysSince,
  type Reputation,
  type RiskAssessment,
} from '@/lib/reputation'
import type { MemberActivityStats, MemberInfractions } from '@/lib/member-profile'

/** Count of assignable roles (excludes @everyone and bot-managed roles). */
export function assignableRoleCount(member: DiscordMember, roles: DiscordRole[]): number {
  const assignable = new Set(
    roles.filter((r) => !r.managed && r.name !== '@everyone').map((r) => r.id),
  )
  return member.roles.filter((id) => assignable.has(id)).length
}

export function memberReputation(
  member: DiscordMember,
  roles: DiscordRole[],
  activity: MemberActivityStats,
  infractions: MemberInfractions,
  accountCreatedAt?: string | null,
): Reputation {
  const createdIso = accountCreatedAt ?? snowflakeToDate(member.user.id)?.toISOString() ?? null
  return computeReputation({
    accountAgeDays: daysSince(createdIso),
    tenureDays: daysSince(member.joined_at),
    messages: activity.message_count,
    voiceSeconds: activity.voice_seconds,
    commands: activity.command_count,
    activeChannels: 0, // not available in the directory aggregate; profile passes its own
    assignableRoles: assignableRoleCount(member, roles),
    warnings: infractions.active_warnings,
    timeouts: infractions.timeouts,
    kicks: infractions.kicks,
    bans: infractions.bans,
  })
}

export function memberRisk(infractions: MemberInfractions): RiskAssessment {
  return assessRisk({
    warnings: infractions.active_warnings,
    timeouts: infractions.timeouts,
    kicks: infractions.kicks,
    bans: infractions.bans,
    lastInfractionAt: infractions.last_infraction_at,
  })
}

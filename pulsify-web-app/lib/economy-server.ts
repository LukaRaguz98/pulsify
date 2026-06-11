import 'server-only'
import { createClient } from '@/lib/supabase-server'
import { snowflakeToDate } from '@/lib/discord'
import { computeReputation, assessRisk, daysSince, type Reputation, type RiskAssessment } from '@/lib/reputation'

// Server-side reads for the global economy & reputation (PULSIFY-45).
// Mirrors what the member-profile API route does, packaged for server
// components (the member Profile / Reputation pages render without a
// client fetch).

export type GlobalReputationBundle = {
  reputation: Reputation
  risk: RiskAssessment
  /** Raw global activity inputs, for the "how this was calculated" copy. */
  inputs: {
    messages: number
    voiceSeconds: number
    commands: number
    activeChannels: number
    firstSeen: string | null
  }
}

/**
 * Compute a member's GLOBAL reputation: the 0-100 trust score from their
 * activity + infractions aggregated across every Pulse server, plus account
 * age from the snowflake. Never stored — same maths as the profile API.
 */
export async function getGlobalReputationBundle(userId: string): Promise<GlobalReputationBundle> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_global_member_reputation', { p_user_id: userId })
  const row = ((Array.isArray(data) ? data[0] : data) ?? null) as Record<string, unknown> | null

  const accountCreated = snowflakeToDate(userId)
  const firstSeen = (row?.first_seen as string | null) ?? null
  const infractions = {
    warnings: Number(row?.warnings ?? 0),
    timeouts: Number(row?.timeouts ?? 0),
    kicks: Number(row?.kicks ?? 0),
    bans: Number(row?.bans ?? 0),
  }

  const reputation = computeReputation({
    accountAgeDays: daysSince(accountCreated ? accountCreated.toISOString() : null),
    tenureDays: daysSince(firstSeen),
    messages: Number(row?.message_count ?? 0),
    voiceSeconds: Number(row?.voice_seconds ?? 0),
    commands: Number(row?.command_count ?? 0),
    activeChannels: Number(row?.active_channels ?? 0),
    assignableRoles: 0, // per-guild / live-from-Discord — omitted globally
    ...infractions,
  })

  const risk = assessRisk({ ...infractions, lastInfractionAt: null })

  return {
    reputation,
    risk,
    inputs: {
      messages: Number(row?.message_count ?? 0),
      voiceSeconds: Number(row?.voice_seconds ?? 0),
      commands: Number(row?.command_count ?? 0),
      activeChannels: Number(row?.active_channels ?? 0),
      firstSeen,
    },
  }
}

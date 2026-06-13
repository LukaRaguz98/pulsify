import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getGuildAccess } from '@/lib/guild-access'
import { isCurrentUserOperator } from '@/lib/operator'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, CHANNEL_TYPES } from '@/lib/discord'
import { normaliseRewardSettings } from '@/lib/economy-rewards'
import { EarningContent } from '@/components/dashboard/economy/EarningContent'

/**
 * Earnings settings — the earning configuration (PULSIFY-47). OPERATOR-ONLY
 * (locked in the Economy Overview, same gate as Controls): earning rules mint
 * the GLOBAL Pulse Coin economy, so a single server's admin must not be able to
 * inflate it — only the Pulsify operator may edit. Reached from the Economy
 * Overview's locked "Earnings settings" button; the sidebar keeps the Earnings
 * (overview) item highlighted here via matchPrefixes. Reward *creation* (the
 * per-server shop catalogue) stays admin-managed in the Shop.
 */
export default async function EconomyEarningPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')
  // Operator gate — bounce non-operators back to the (member-visible) Earnings
  // overview, exactly like Economy Controls.
  if (!(await isCurrentUserOperator())) redirect(`/dashboard/${guildId}/economy`)

  const supabase = await createClient()

  const [guild, channels, roles, { data: row }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    supabase.from('economy_reward_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
  ])
  if (!guild) redirect('/dashboard')

  const textChannels = channels
    .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, name: c.name }))
  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))

  const config = normaliseRewardSettings(row ?? null)

  return (
    <EarningContent
      guildId={guildId}
      guildName={guild.name}
      initialConfig={config}
      channels={textChannels}
      roles={assignableRoles}
    />
  )
}

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildChannels, fetchGuildRoles } from '@/lib/discord'
import { normaliseSettings } from '@/lib/ai-moderation'
import { AIModerationSettingsContent } from '@/components/dashboard/ai-moderation/AIModerationSettingsContent'

// Pulse Guard configuration lives on its own page, reached from the "Settings"
// button on the Pulse Guard view (Safety nav) — the same pattern as Tickets ↔
// /ticket-settings. Sits at a sibling path so the Pulse Guard nav item stays
// highlighted (it prefix-matches /ai-moderation).
export default async function AIModerationSettingsPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const [channels, roles, { data: row }] = await Promise.all([
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    supabase
      .from('ai_moderation_settings')
      .select('enabled, sensitivity, settings')
      .eq('guild_id', guildId)
      .maybeSingle(),
  ])

  const rawSettings = (row?.settings as Record<string, unknown> | undefined) ?? {}
  const initialSettings = normaliseSettings({
    ...rawSettings,
    enabled: row?.enabled,
    sensitivity: row?.sensitivity as 'low' | 'medium' | 'aggressive' | undefined,
  })

  const textChannels = channels.filter((c) => c.type === 0)
  const visibleRoles = roles.filter((r) => r.name !== '@everyone')

  return (
    <AIModerationSettingsContent
      guildId={guildId}
      channels={textChannels}
      roles={visibleRoles}
      initialSettings={initialSettings}
    />
  )
}

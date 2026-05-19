import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildChannels } from '@/lib/discord'
import { normaliseSettings } from '@/lib/ai-moderation'
import { AIModerationContent } from '@/components/dashboard/AIModerationContent'

export default async function AIModerationPage({
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

  const [channels, { data: row }] = await Promise.all([
    fetchGuildChannels(guildId),
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
    sensitivity: (row?.sensitivity as 'low' | 'medium' | 'aggressive' | undefined),
  })

  const textChannels = channels.filter((c) => c.type === 0)

  return (
    <AIModerationContent
      guildId={guildId}
      channels={textChannels}
      initialSettings={initialSettings}
    />
  )
}

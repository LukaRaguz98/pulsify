import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildChannels, fetchGuildRoles } from '@/lib/discord'
import { AutomationsForm } from './AutomationsForm'

export default async function AutomationsPage({
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

  const [channels, roles, { data: settings }] = await Promise.all([
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle(),
  ])

  const textChannels = channels.filter((c) => c.type === 0)
  const visibleRoles = roles.filter((r) => r.name !== '@everyone')
  const currentSettings = (settings?.settings as Record<string, unknown>) ?? {}

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Automations</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Configure automated actions for your server. Changes take effect immediately via the Pulse bot.
        </p>
      </div>
      <AutomationsForm
        guildId={guildId}
        channels={textChannels}
        roles={visibleRoles}
        initialSettings={currentSettings}
      />
    </div>
  )
}

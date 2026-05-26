import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
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

  const [guild, channels, roles, { data: settings }] = await Promise.all([
    fetchGuild(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle(),
  ])

  const textChannels = channels.filter((c) => c.type === 0)
  const visibleRoles = roles.filter((r) => r.name !== '@everyone')
  const currentSettings = (settings?.settings as Record<string, unknown>) ?? {}

  return (
    <div className="page-content">
      <PageHeader
        title="Automations"
        description="Configure automated actions for your server. Changes take effect immediately via the Pulse bot."
        action={
          <Link
            href={`/dashboard/${guildId}/automations-settings`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <Settings size={12} />
            Automations settings
          </Link>
        }
      />
      <AutomationsForm
        guildId={guildId}
        guildName={guild?.name ?? ''}
        channels={textChannels}
        roles={visibleRoles}
        initialSettings={currentSettings}
      />
    </div>
  )
}

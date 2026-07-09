import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildRoles } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { PrivateChannelsSettings } from '@/components/dashboard/private-channels/PrivateChannelsSettings'
import { normalisePrivateChannelConfig } from '@/lib/private-channels'

// Configuration for Private Channels (trigger, naming, limits, permissions).
// Kept on a sibling path so the Private Channels nav item stays highlighted
// (prefix-matches /private-channels), mirroring Automations / Automations
// settings. The main Private Channels view stays a monitoring surface.
export default async function PrivateChannelsSettingsPage({
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

  const [roles, { data: configRow }] = await Promise.all([
    fetchGuildRoles(guildId),
    supabase.from('private_channel_configs').select('*').eq('guild_id', guildId).maybeSingle(),
  ])

  const config = normalisePrivateChannelConfig(configRow)
  const visibleRoles = roles.filter((r) => r.name !== '@everyone')

  return (
    <div className="page-content">
      <PageHeader
        title="Private channels settings"
        helpId="private-channels"
        description="Configure the join-to-create trigger, channel naming, limits and who can use it. Changes apply live through the Pulse bot."
        action={
          <Link
            href={`/dashboard/${guildId}/channels?tab=private`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to Private Channels
          </Link>
        }
      />
      <PrivateChannelsSettings guildId={guildId} roles={visibleRoles} initialConfig={config} />
    </div>
  )
}

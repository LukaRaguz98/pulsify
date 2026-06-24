import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildChannels, CHANNEL_TYPES } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { RulesForm } from '@/components/dashboard/security/RulesForm'
import { normaliseConfig } from '@/lib/security'

// Configuration for DDoS Protection (toggle, alert channel, protection rules,
// auto-lockdown). Kept on a sibling path so the DDoS Protection nav item stays
// highlighted (prefix-matches /security), mirroring Private Channels /
// Private channels settings. The main /security view stays a monitoring surface.
export default async function SecuritySettingsPage({
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

  const [channels, { data: configRow }] = await Promise.all([
    fetchGuildChannels(guildId),
    supabase.from('security_configs').select('*').eq('guild_id', guildId).maybeSingle(),
  ])

  const config = normaliseConfig(configRow as Record<string, unknown> | null)
  const textChannels = channels
    .filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT)
    .map((c) => ({ id: c.id, name: c.name }))

  return (
    <div className="page-content">
      <PageHeader
        title="DDoS Protection settings"
        helpId="ddos-protection"
        description="Enable protection, choose where alerts go, and tune the detection rules + automatic mitigations. Changes apply live through the Pulse bot."
        action={
          <Link
            href={`/dashboard/${guildId}/security`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to DDoS Protection
          </Link>
        }
      />
      <RulesForm guildId={guildId} initialConfig={config} channels={textChannels} />
    </div>
  )
}

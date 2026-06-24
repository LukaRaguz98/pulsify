import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild } from '@/lib/discord'
import { normaliseConfig, normaliseEvent, normaliseMitigationRow } from '@/lib/security'
import { SecurityContent } from '@/components/dashboard/security/SecurityContent'

export default async function SecurityPage({
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

  const [guild, { data: configRow }, { data: eventRows }, { data: mitigationRows }] =
    await Promise.all([
      fetchGuild(guildId),
      supabase.from('security_configs').select('*').eq('guild_id', guildId).maybeSingle(),
      supabase
        .from('security_events')
        .select('*')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('security_mitigations')
        .select('*')
        .eq('guild_id', guildId)
        .order('started_at', { ascending: false })
        .limit(500),
    ])

  const config = normaliseConfig(configRow as Record<string, unknown> | null)
  const events = (eventRows ?? []).map((r) => normaliseEvent(r as Record<string, unknown>))
  const mitigations = (mitigationRows ?? []).map((r) => normaliseMitigationRow(r as Record<string, unknown>))

  return (
    <SecurityContent
      guildId={guildId}
      guildName={guild?.name ?? ''}
      initialConfig={config}
      initialEvents={events}
      initialMitigations={mitigations}
      settingsHref={`/dashboard/${guildId}/security-settings`}
    />
  )
}

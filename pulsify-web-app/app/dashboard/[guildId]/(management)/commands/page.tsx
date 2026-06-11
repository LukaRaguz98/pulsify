import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildChannels, fetchGuildRoles } from '@/lib/discord'
import { normaliseConfig, type CommandConfig } from '@/lib/commands'
import { CommandsContent } from '@/components/dashboard/CommandsContent'

export default async function CommandsPage({
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

  const [channels, roles, { data: rows }] = await Promise.all([
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
    supabase
      .from('command_configs')
      .select('*')
      .eq('guild_id', guildId),
  ])

  // Map command name → normalised config. Commands without a row inherit the
  // catalog defaults, so we only store the overrides that exist.
  const initialConfigs: Record<string, CommandConfig> = {}
  for (const row of rows ?? []) {
    initialConfigs[row.command_name as string] = normaliseConfig(row as Partial<CommandConfig>)
  }

  // Text + announcement channels are the meaningful targets for channel
  // restrictions; voice/category channels can't carry slash commands.
  const textChannels = channels
    .filter((c) => c.type === 0 || c.type === 5)
    .sort((a, b) => a.position - b.position)

  // Drop @everyone and managed/bot roles from the role pickers — they aren't
  // useful as allow/deny targets.
  const assignableRoles = roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)

  return (
    <CommandsContent
      guildId={guildId}
      channels={textChannels}
      roles={assignableRoles}
      initialConfigs={initialConfigs}
    />
  )
}

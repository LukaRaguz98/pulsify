import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildRoles } from '@/lib/discord'
import { GamingSettingsContent } from '@/components/dashboard/gaming/GamingSettingsContent'

/**
 * Analytics › Gaming › Settings (PULSIFY-64).
 *
 * A sibling route rather than a tab, matching the pattern the other
 * data-collecting modules use (invite-settings, birthday-settings,
 * ticket-settings): the analytics page is for reading, this one is for
 * deciding what gets collected in the first place.
 *
 * Roles are fetched server-side so the ignore-list picker has real names
 * without the client needing Discord API access.
 */
export default async function GamingSettingsPage({
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

  const [guild, roles] = await Promise.all([fetchGuild(guildId), fetchGuildRoles(guildId)])

  return (
    <GamingSettingsContent
      guildId={guildId}
      guildName={guild?.name ?? 'this server'}
      roles={(roles ?? [])
        .filter((r) => r.name !== '@everyone')
        .map((r) => ({ id: r.id, name: r.name }))}
    />
  )
}

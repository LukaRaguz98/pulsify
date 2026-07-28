import { redirect } from 'next/navigation'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild } from '@/lib/discord'
import { GamingContent } from '@/components/dashboard/gaming/GamingContent'
import { MemberGaming } from '@/components/dashboard/member-view/MemberGaming'

/**
 * Analytics › Gaming (PULSIFY-64) — and Community › Gaming for members.
 *
 * This route sits OUTSIDE the (management) group and serves both audiences, the
 * same way Birthdays and Statistics do: admins get the full module, members get
 * a read-only community view built from a separate, narrower endpoint. Which
 * one you get is decided here and enforced again in the APIs — the admin routes
 * still require Manage Server, so this branch is presentation, not security.
 *
 * A thin shell on purpose: both views are filtered, sorted and re-windowed from
 * the client, so a server-rendered first payload would be thrown away the moment
 * the window changed.
 */
export default async function GamingPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params

  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  if (access.effectiveRole !== 'admin') {
    const guild = await fetchGuild(guildId)
    if (!guild) redirect('/dashboard')
    return <MemberGaming guildId={guildId} guildName={guild.name} />
  }

  return <GamingContent guildId={guildId} />
}

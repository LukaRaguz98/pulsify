import { redirect } from 'next/navigation'
import { getGuildAccess } from '@/lib/guild-access'
import { fetchGuild } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { MembersLeaderboard } from '@/components/dashboard/members/MembersLeaderboard'

/**
 * Standalone Leaderboards page — the member experience's ranking view
 * (admins have the same boards as a tab inside Members). Read-only: rows
 * never link to the admin member profiles unless the viewer manages the
 * server, and the API behind it only exposes community-safe fields.
 */
export default async function LeaderboardPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')

  const guild = await fetchGuild(guildId)
  if (!guild) redirect('/dashboard')

  return (
    <div className="page-content">
      <PageHeader
        title="Leaderboards"
        helpId="members"
        description={
          <>
            Server progression and global reputation rankings for{' '}
            <span className="font-medium text-foreground">{guild.name}</span>
          </>
        }
      />
      <MembersLeaderboard guildId={guildId} linkToProfiles={access.effectiveRole === 'admin'} />
    </div>
  )
}

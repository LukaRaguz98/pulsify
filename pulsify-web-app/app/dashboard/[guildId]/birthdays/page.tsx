import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getGuildAccess } from '@/lib/guild-access'
import {
  fetchGuild,
  fetchGuildMembers,
  avatarUrl,
  guildMemberAvatarUrl,
  defaultAvatarUrl,
} from '@/lib/discord'
import { normaliseBirthdaySettings, type MemberBirthday, type BirthdayEvent } from '@/lib/birthdays'
import { PageHeader } from '@/components/ui/page-header'
import { BirthdaysContent } from '@/components/dashboard/birthdays/BirthdaysContent'
import { MemberBirthdays } from '@/components/dashboard/member-view/MemberBirthdays'

export default async function BirthdaysPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  // Birthdays are a community surface, so this route sits OUTSIDE the
  // (management) group and serves both audiences: admins get the full module,
  // members get a read-only view. The write paths (settings, test post, removing
  // someone's birthday) are guarded in the actions themselves — hiding the
  // controls below is presentation, not security.
  const access = await getGuildAccess(guildId)
  if (!access) redirect('/dashboard')
  const isAdmin = access.effectiveRole === 'admin'

  const supabase = await createClient()

  const [guild, members, { data: settingsRow }, { data: birthdayRows }, { data: eventRows }] =
    await Promise.all([
      fetchGuild(guildId),
      fetchGuildMembers(guildId, 1000),
      supabase.from('birthday_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
      supabase.from('member_birthdays').select('*').eq('guild_id', guildId).limit(1000),
      // Celebration history records what each member was PAID (coins, XP, roles),
      // which is management data — members never see it, so it isn't even loaded.
      isAdmin
        ? supabase
            .from('birthday_events')
            .select('*')
            .eq('guild_id', guildId)
            .order('created_at', { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [] }),
    ])
  if (!guild) redirect('/dashboard')

  const config = normaliseBirthdaySettings(settingsRow ?? null)
  const birthdays = (birthdayRows ?? []) as MemberBirthday[]
  const events = (eventRows ?? []) as BirthdayEvent[]

  // Real Discord avatars for everyone shown on the page. Members who have since
  // left the guild fall back to the default avatar Discord itself would render.
  const memberById = new Map(members.map((m) => [m.user.id, m]))
  const avatars: Record<string, string> = {}
  for (const userId of new Set([...birthdays.map((b) => b.user_id), ...events.map((e) => e.user_id)])) {
    const m = memberById.get(userId)
    if (!m) {
      avatars[userId] = defaultAvatarUrl(userId)
      continue
    }
    avatars[userId] = m.avatar
      ? guildMemberAvatarUrl(guildId, m.user.id, m.avatar, 64)
      : avatarUrl(m.user.id, m.user.avatar, '0', 64)
  }

  if (!isAdmin) {
    return (
      <div className="page-content">
        <PageHeader
          title="Birthdays"
          helpId="birthdays"
          description={
            <>
              Who&apos;s celebrating in{' '}
              <span className="font-medium text-foreground">{guild.name}</span> — add yours from your
              profile so Pulse can celebrate you too
            </>
          }
        />
        <MemberBirthdays birthdays={birthdays} guildTz={config.timezone} avatars={avatars} />
      </div>
    )
  }

  return (
    <BirthdaysContent
      guildId={guildId}
      guildName={guild.name}
      initialConfig={config}
      initialBirthdays={birthdays}
      initialEvents={events}
      avatars={avatars}
    />
  )
}

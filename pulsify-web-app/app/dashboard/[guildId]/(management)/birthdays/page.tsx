import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import {
  fetchGuild,
  fetchGuildMembers,
  avatarUrl,
  guildMemberAvatarUrl,
  defaultAvatarUrl,
} from '@/lib/discord'
import { normaliseBirthdaySettings, type MemberBirthday, type BirthdayEvent } from '@/lib/birthdays'
import { BirthdaysContent } from '@/components/dashboard/birthdays/BirthdaysContent'

export default async function BirthdaysPage({
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

  const [guild, members, { data: settingsRow }, { data: birthdayRows }, { data: eventRows }] =
    await Promise.all([
      fetchGuild(guildId),
      fetchGuildMembers(guildId, 1000),
      supabase.from('birthday_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
      supabase.from('member_birthdays').select('*').eq('guild_id', guildId).limit(1000),
      supabase
        .from('birthday_events')
        .select('*')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false })
        .limit(200),
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

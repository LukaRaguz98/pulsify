import Image from 'next/image'
import { Cake, CalendarDays, PartyPopper } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { defaultAvatarUrl } from '@/lib/discord'
import { BirthdayCalendar } from '@/components/dashboard/birthdays/BirthdayCalendar'
import {
  upcomingBirthdays,
  formatBirthday,
  countdownLabel,
  type MemberBirthday,
  type UpcomingBirthday,
} from '@/lib/birthdays'

// Read-only birthday view for the member experience: who's celebrating today,
// who's next, and the month calendar. Nothing here creates or changes anything —
// members set their OWN birthday from their profile (or /birthday set), and the
// announcement channel, role and rewards stay admin-only.
//
// Privacy: the same rules the rest of the product honours. A member who hid
// their birth year has it hidden here (formatBirthday respects `show_year`), and
// the "opted out of announcements" flag is a private preference, so — unlike the
// admin view — it is never surfaced to other members.

type Props = {
  birthdays: MemberBirthday[]
  /** Guild default timezone — the fallback for members without their own. */
  guildTz: string
  /** Discord avatar URL per user id, resolved server-side. */
  avatars: Record<string, string>
}

export function MemberBirthdays({ birthdays, guildTz, avatars }: Props) {
  const avatarFor = (userId: string) => avatars[userId] ?? defaultAvatarUrl(userId)

  const upcoming = upcomingBirthdays(birthdays, { guildTimezone: guildTz })
  const today = upcoming.filter((u) => u.isToday)
  const soon = upcoming.filter((u) => !u.isToday).slice(0, 18)

  if (birthdays.length === 0) {
    return (
      <EmptyState
        icon={<Cake size={36} />}
        title="No birthdays yet"
        description="Nobody has shared a birthday in this server yet. Add yours from your profile, or with /birthday set in Discord."
      />
    )
  }

  return (
    <div className="space-y-8">
      {today.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <PartyPopper size={15} style={{ color: '#f472b6' }} /> Today’s birthdays
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {today.map((u) => (
              <BirthdayCard key={u.birthday.user_id} u={u} avatar={avatarFor(u.birthday.user_id)} />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <CalendarDays size={15} style={{ color: 'var(--p-1)' }} /> Upcoming
          </h2>
          {soon.length === 0 ? (
            <p className="text-sm text-subtle">
              No more birthdays coming up — check back after today’s celebrations.
            </p>
          ) : (
            <div className="space-y-2">
              {soon.map((u) => (
                <UpcomingRow key={u.birthday.user_id} u={u} avatar={avatarFor(u.birthday.user_id)} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <CalendarDays size={15} style={{ color: 'var(--p-1)' }} /> Calendar
          </h2>
          <BirthdayCalendar birthdays={birthdays} guildTz={guildTz} />
        </section>
      </div>
    </div>
  )
}

function Avatar({ url, name }: { url: string; name: string | null }) {
  return (
    <Image
      src={url}
      alt={name ?? 'Member'}
      width={36}
      height={36}
      unoptimized
      className="h-9 w-9 shrink-0 rounded-full object-cover"
    />
  )
}

function BirthdayCard({ u, avatar }: { u: UpcomingBirthday; avatar: string }) {
  const b = u.birthday
  return (
    <div
      className="flex items-center gap-3 rounded-xl border p-4"
      style={{ background: 'rgba(244,114,182,0.08)', borderColor: 'rgba(244,114,182,0.4)' }}
    >
      <Avatar url={avatar} name={b.user_name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{b.user_name ?? 'Unknown member'}</p>
        <p className="text-xs text-subtle">
          {formatBirthday(b.birth_month, b.birth_day, b.birth_year, b.show_year)}
          {u.age != null && b.show_year ? ` · turning ${u.age}` : ''}
        </p>
      </div>
      <span
        className="rounded-md px-2 py-0.5 text-[11px] font-medium"
        style={{ background: 'rgba(244,114,182,0.2)', color: '#f472b6' }}
      >
        {countdownLabel(u.daysUntil)}
      </span>
    </div>
  )
}

function UpcomingRow({ u, avatar }: { u: UpcomingBirthday; avatar: string }) {
  const b = u.birthday
  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <Avatar url={avatar} name={b.user_name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{b.user_name ?? 'Unknown member'}</p>
        <p className="text-xs text-subtle">
          {formatBirthday(b.birth_month, b.birth_day, b.birth_year, b.show_year)}
        </p>
      </div>
      <span className="text-xs font-medium text-subtle">{countdownLabel(u.daysUntil)}</span>
    </div>
  )
}

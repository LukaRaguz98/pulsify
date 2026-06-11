import { Megaphone, Clock } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import type { Announcement } from '@/lib/announcements'

// Read-only announcement feed for the member experience: only PUBLISHED
// announcements — drafts, schedules and failures are the composer's business.

export function MemberAnnouncements({ announcements }: { announcements: Announcement[] }) {
  const published = announcements
    .filter((a) => a.status === 'published')
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at))
    .slice(0, 30)

  if (published.length === 0) {
    return (
      <EmptyState
        icon={<Megaphone size={36} />}
        title="No announcements yet"
        description="Announcements published by the server team will appear here."
      />
    )
  }

  return (
    <div className="space-y-3">
      {published.map((a) => (
        <article
          key={a.id}
          className="rounded-xl border p-5"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="min-w-0 font-semibold text-foreground">{a.title}</h2>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-subtle">
              <Clock size={11} />
              {new Date(a.published_at ?? a.created_at).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
              {a.author_name && <> · {a.author_name}</>}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{a.content}</p>
        </article>
      ))}
    </div>
  )
}

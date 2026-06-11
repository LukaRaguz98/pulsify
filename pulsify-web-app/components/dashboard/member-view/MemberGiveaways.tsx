import { Clock, Gift, Trophy, Users } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { STATUS_META, type Giveaway } from '@/lib/giveaways'

// Read-only giveaway list for the member experience: what's running, what's
// coming, who won. Entering still happens in Discord via the Join button —
// management (create/cancel/re-roll) stays admin-only.

function endsIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'ending now'
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `ends in ${Math.max(1, Math.floor(ms / 60_000))}m`
  if (h < 48) return `ends in ${h}h`
  return `ends ${new Date(iso).toLocaleDateString()}`
}

export function MemberGiveaways({ giveaways }: { giveaways: Giveaway[] }) {
  const visible = giveaways
    .filter((g) => g.status !== 'cancelled')
    .sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || b.ends_at.localeCompare(a.ends_at))
    .slice(0, 30)

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<Gift size={36} />}
        title="No giveaways yet"
        description="Active and recent giveaways will appear here — join them with the button on the giveaway post in Discord."
      />
    )
  }

  return (
    <div className="space-y-3">
      {visible.map((g) => {
        const meta = STATUS_META[g.status]
        return (
          <div
            key={g.id}
            className="rounded-xl border p-4"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate font-semibold text-foreground">{g.title || g.prize}</p>
              <span
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                style={{
                  background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                  color: meta.color,
                }}
              >
                {meta.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <Gift size={13} className="mr-1 inline" style={{ color: 'var(--p-1)' }} />
              {g.prize}
              {g.winner_count > 1 && ` · ${g.winner_count} winners`}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
              <span className="inline-flex items-center gap-1">
                <Users size={12} />
                {g.entry_count.toLocaleString()} entered
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock size={12} />
                {g.status === 'active' || g.status === 'scheduled'
                  ? endsIn(g.ends_at)
                  : `ended ${new Date(g.ended_at ?? g.ends_at).toLocaleDateString()}`}
              </span>
              {g.status === 'ended' && g.winners.length > 0 && (
                <span className="inline-flex items-center gap-1" style={{ color: 'var(--amber)' }}>
                  <Trophy size={12} />
                  {g.winners.map((w) => w.name ?? 'A member').join(', ')}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

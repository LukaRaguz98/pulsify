'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, History, CheckCircle2, Search } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { computePollStats, type Poll } from '@/lib/polls'
import type { ActionResult } from '@/app/dashboard/[guildId]/polls/actions'
import { PollCard } from './PollCard'
import { PollDetail } from './PollDetail'
import { PollAnalytics } from './PollAnalytics'

type Channel = { id: string; name: string }
type Role = { id: string; name: string; color: number }

export function PollResultsContent({
  guildId,
  guildName,
  polls,
  channels,
  roles,
}: {
  guildId: string
  guildName: string
  polls: Poll[]
  channels: Channel[]
  roles: Role[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const roleNames = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])
  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels])

  // History = settled polls only (closed + archived), newest first.
  const history = useMemo(
    () => polls.filter((p) => p.status === 'closed' || p.status === 'archived'),
    [polls],
  )
  const stats = useMemo(() => computePollStats(polls), [polls])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return history
    return history.filter((p) => p.title.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
  }, [history, search])

  const selected = useMemo(() => polls.find((p) => p.id === selectedId) ?? null, [polls, selectedId])

  const runAction = useCallback(
    async <T,>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
      const result = await fn()
      if (result.ok) startTransition(() => router.refresh())
      return result
    },
    [router],
  )
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router])

  return (
    <div className="page-content">
      <PageHeader
        title="Poll Results"
        helpId="poll-results"
        description={
          <>
            Closed-poll history, participation and outcomes for{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={<RefreshButton onClick={refresh} refreshing={pending} />}
      />

      <div className="space-y-8">
        <CategorySection icon={<CheckCircle2 size={14} />} title="Engagement" description="How your community participates in voting.">
          <PollAnalytics stats={stats} />
        </CategorySection>

        <CategorySection icon={<History size={14} />} title="Poll history" description="Every poll that has closed, with its final result.">
          {history.length === 0 ? (
            <EmptyState
              icon={<BarChart3 size={26} />}
              variant="muted"
              title="No closed polls yet"
              description="Once a poll closes, its result and breakdown appear here."
            />
          ) : (
            <div className="space-y-5">
              <div className="relative max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search results…"
                  className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                />
              </div>
              {filtered.length === 0 ? (
                <EmptyState variant="muted" icon={<Search size={24} />} title="No matching results" description="Try a different search." />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((p) => (
                    <PollCard key={p.id} poll={p} onSelect={() => setSelectedId(p.id)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </CategorySection>
      </div>

      {selected && (
        <PollDetail
          guildId={guildId}
          poll={selected}
          roleNames={roleNames}
          channelName={channelNames.get(selected.channel_id)}
          runAction={runAction}
          onClose={() => setSelectedId(null)}
          onEdit={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

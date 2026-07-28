'use client'

import { useEffect, useState } from 'react'
import { Gamepad2, Users } from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { relativeTime } from '@/components/dashboard/gaming/gaming-style'
import { UpgradePrompt } from '@/components/billing/UpgradePrompt'
import { displayName, formatDuration, type CoplayPair, type Squad } from '@/lib/gaming'
import type { Plan } from '@/lib/billing'
import type { Timeframe } from '@/lib/analytics'

/**
 * Squad detection: who actually plays together.
 *
 * Fetches separately from the rest of the module because the underlying query
 * is a self-join over the session table — the most expensive thing here by a
 * distance. Loading it only when the tab is opened keeps the overview fast on
 * servers where it is slow.
 *
 * The threshold is exposed rather than hidden: "played the same game at the
 * same time for at least N minutes" is the entire definition of a squad, and an
 * admin who disagrees with the default should be able to move it.
 */

const THRESHOLDS = [5, 15, 30, 60] as const

type SquadsPayload = {
  enabled: boolean
  anonymise: boolean
  window: { timeframe: Timeframe; days: number | null; since: string | null; minMinutes: number }
  pairs: CoplayPair[]
  squads: Squad[]
}

export function GamingSquads({
  guildId,
  timeframe,
  locked,
  requiredPlan,
}: {
  guildId: string
  timeframe: Timeframe
  locked: boolean
  requiredPlan: Plan | null
}) {
  const [minMinutes, setMinMinutes] = useState<number>(15)
  const [data, setData] = useState<SquadsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // setState only ever happens after an await — changing the threshold is an
  // event handler, and the effect body itself is asynchronous throughout.
  useEffect(() => {
    if (locked) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/guilds/${guildId}/gaming/squads?timeframe=${timeframe}&minMinutes=${minMinutes}`,
          { cache: 'no-store' },
        )
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body.error ?? 'Squad detection could not be loaded.')
        setData(body as SquadsPayload)
        setError(null)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Squad detection could not be loaded.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [guildId, timeframe, minMinutes, locked])

  if (locked) {
    return (
      <UpgradePrompt
        requiredPlan={requiredPlan ?? 'pro'}
        feature="Squad detection"
        description="See which members actually play together — same game, same hours — grouped into the friend groups your server already has."
      />
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={<Users size={18} />}
        title="Couldn't detect squads"
        description={error}
        variant="muted"
      />
    )
  }

  if (loading && !data) return <TableSkeleton rows={5} columns={3} />
  if (!data) return null

  return (
    <div className="space-y-6">
      <CategorySection
        icon={<Users size={14} />}
        title="Suggested squads"
        description="Members who play the same games at the same time. Grouped transitively — if A plays with B and B plays with C, all three are one squad."
        action={
          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: 'var(--text-3)' }}>
              Min shared time
            </label>
            <select
              value={minMinutes}
              onChange={(e) => { setLoading(true); setMinMinutes(Number(e.target.value)) }}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-medium"
              style={{
                borderColor: 'var(--line-strong)',
                background: 'var(--bg-2)',
                color: 'var(--text)',
              }}
            >
              {THRESHOLDS.map((t) => (
                <option key={t} value={t}>
                  {t} min
                </option>
              ))}
            </select>
          </div>
        }
      >
        {data.squads.length === 0 ? (
          <EmptyState
            icon={<Users size={18} />}
            title="No squads detected"
            description={`Nobody shared more than ${data.window.minMinutes} minutes in the same game during this window. Try a lower threshold or a wider date range.`}
            variant="muted"
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.squads.slice(0, 20).map((squad) => (
              <div
                key={squad.id}
                className="rounded-xl border p-4"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {squad.members.length} member{squad.members.length === 1 ? '' : 's'}
                    </p>
                    <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-3)' }}>
                      last together {relativeTime(squad.lastTogetherAt)}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                  >
                    {formatDuration(squad.overlapSeconds)}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {squad.members.map((m, i) => (
                    <span
                      key={m.userId}
                      className="rounded-md px-2 py-1 text-xs font-medium"
                      style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
                    >
                      {displayName(m, data.anonymise, i + 1)}
                    </span>
                  ))}
                </div>

                <p className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                  <Gamepad2 size={12} />
                  {squad.sharedGames} shared game{squad.sharedGames === 1 ? '' : 's'} ·{' '}
                  {squad.sessionsTogether} overlapping session
                  {squad.sessionsTogether === 1 ? '' : 's'}
                </p>
              </div>
            ))}
          </div>
        )}
      </CategorySection>

      {data.pairs.length > 0 && (
        <CategorySection
          icon={<Users size={14} />}
          title="Closest pairs"
          description="The individual pairings behind the squads, by shared playtime."
        >
          <div
            className="overflow-x-auto rounded-xl border"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
          >
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr
                  className="text-left text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--text-3)' }}
                >
                  <th className="px-4 py-3">Pair</th>
                  <th className="px-4 py-3">Shared time</th>
                  <th className="px-4 py-3">Games</th>
                  <th className="px-4 py-3">Sessions</th>
                  <th className="px-4 py-3">Last together</th>
                </tr>
              </thead>
              <tbody>
                {data.pairs.slice(0, 25).map((p, i) => (
                  <tr
                    key={`${p.userA}-${p.userB}`}
                    className="border-t"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <td className="px-4 py-3 font-medium text-foreground" data-label="Pair">
                      {displayName({ userId: p.userA, userName: p.userAName }, data.anonymise, i * 2 + 1)}
                      {' & '}
                      {displayName({ userId: p.userB, userName: p.userBName }, data.anonymise, i * 2 + 2)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground" data-label="Shared time">
                      {formatDuration(p.overlapSeconds)}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-2)' }} data-label="Games">
                      {p.sharedGames}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-2)' }} data-label="Sessions">
                      {p.sessionsTogether}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-3)' }} data-label="Last together">
                      {relativeTime(p.lastTogetherAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CategorySection>
      )}
    </div>
  )
}

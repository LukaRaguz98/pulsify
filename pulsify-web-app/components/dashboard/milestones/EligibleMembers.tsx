'use client'

import { useMemo } from 'react'
import { Users } from 'lucide-react'
import {
  describeThresholdLong,
  formatMetricValueLong,
  milestoneProgress,
  type Milestone,
  type MilestoneCompletion,
  type MilestoneMetric,
} from '@/lib/milestones'
import type { MemberMetricRow } from '@/app/dashboard/[guildId]/(management)/milestones/page'
import { MilestoneIcon } from './icons'

// join_age has no per-member value in the metrics RPC (it's derived bot-side
// from the Discord join date), so we can't show an in-progress leaderboard for
// it — only the earned count.
function valueForMetric(row: MemberMetricRow, metric: MilestoneMetric): number | null {
  switch (metric) {
    case 'messages':
      return row.messages
    case 'voice_minutes':
      return row.voice_minutes
    case 'events':
      return row.events
    case 'giveaways':
      return row.giveaways
    case 'invites':
      return row.invites
    case 'xp':
      return row.xp
    case 'level':
      return row.level
    case 'join_age':
    default:
      return null
  }
}

export function EligibleMembers({
  milestones,
  metrics,
  completions,
}: {
  milestones: Milestone[]
  metrics: MemberMetricRow[]
  completions: MilestoneCompletion[]
}) {
  const enabled = useMemo(() => milestones.filter((m) => m.enabled), [milestones])

  const earnedByMilestone = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const c of completions) {
      const set = m.get(c.milestone_id) ?? new Set<string>()
      set.add(c.user_id)
      m.set(c.milestone_id, set)
    }
    return m
  }, [completions])

  if (enabled.length === 0) {
    return (
      <Empty
        title="No active milestones"
        body="Enable a milestone to see which members have earned it and who's closest to the next one."
      />
    )
  }
  if (metrics.length === 0) {
    return (
      <Empty
        title="No tracked activity yet"
        body="Once members start chatting, joining voice and entering giveaways, their progress toward each milestone will show up here."
      />
    )
  }

  return (
    <div className="space-y-4">
      {enabled.map((m) => {
        const earned = earnedByMilestone.get(m.id) ?? new Set<string>()

        // In-progress leaders: members with a value for this metric who haven't
        // earned it yet, ranked by how close they are.
        const leaders = metrics
          .map((row) => {
            const value = valueForMetric(row, m.metric)
            if (value === null) return null
            if (earned.has(row.user_id)) return null
            const prog = milestoneProgress(value, m.threshold)
            if (prog.met) return null // met but not yet recorded — the sweep will catch it
            return { row, prog }
          })
          .filter((x): x is { row: MemberMetricRow; prog: ReturnType<typeof milestoneProgress> } => x !== null)
          .sort((a, b) => b.prog.pct - a.prog.pct)
          .slice(0, 5)

        return (
          <div key={m.id} className="rounded-2xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                  <MilestoneIcon name={m.icon} size={15} />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{m.name}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--text-3)' }}>{describeThresholdLong(m.metric, m.threshold)}</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
                <Users size={12} />
                {earned.size.toLocaleString()} earned
              </span>
            </div>

            {m.metric === 'join_age' ? (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                Time-in-server progress is tracked automatically by Pulse and granted as members reach {describeThresholdLong('join_age', m.threshold)}.
              </p>
            ) : leaders.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No members in progress — everyone tracked has earned it or has no activity yet.</p>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Closest to earning</p>
                {leaders.map(({ row, prog }) => (
                  <div key={row.user_id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="truncate" style={{ color: 'var(--text-2)' }}>{row.user_name ?? row.user_id}</span>
                      <span className="shrink-0 text-xs" style={{ color: 'var(--text-3)' }}>
                        {formatMetricValueLong(m.metric, prog.value)} / {formatMetricValueLong(m.metric, m.threshold)} ({prog.pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(3, prog.pct)}%`, background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border py-16 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
        <Users size={26} />
      </div>
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>{body}</p>
    </div>
  )
}

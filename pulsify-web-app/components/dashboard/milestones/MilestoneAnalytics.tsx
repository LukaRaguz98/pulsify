'use client'

import { useMemo } from 'react'
import { TrendingUp, Award, Users, CheckCircle2 } from 'lucide-react'
import {
  computeMilestoneStats,
  type Milestone,
  type MilestoneCompletion,
} from '@/lib/milestones'
import { MilestoneIcon } from './icons'

export function MilestoneAnalytics({
  milestones,
  completions,
}: {
  milestones: Milestone[]
  completions: MilestoneCompletion[]
}) {
  const stats = useMemo(() => computeMilestoneStats(milestones, completions), [milestones, completions])
  const iconByMilestone = useMemo(() => new Map(milestones.map((m) => [m.id, m.icon])), [milestones])

  if (milestones.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border py-16 text-center" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
          <TrendingUp size={26} />
        </div>
        <p className="font-semibold text-foreground">No analytics yet</p>
        <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
          Create a milestone and recognition stats — completions, most-earned and trends — will show up here.
        </p>
      </div>
    )
  }

  const maxDay = Math.max(1, ...stats.series.map((s) => s.count))
  const topRanking = stats.byMilestone.filter((m) => m.earned > 0).slice(0, 6)

  return (
    <div className="grid gap-4">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Award size={15} />} label="Milestones" value={stats.total} />
        <Tile icon={<CheckCircle2 size={15} />} label="Active" value={stats.active} accent="#22c55e" />
        <Tile icon={<TrendingUp size={15} />} label="Total earned" value={stats.totalEarned} accent="#3b82f6" />
        <Tile icon={<Users size={15} />} label="Members recognised" value={stats.membersRecognised} accent="#a855f7" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Completions trend */}
        <div className="rounded-2xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <p className="mb-3 text-sm font-semibold text-foreground">Milestones earned · last 14 days</p>
          <div className="flex h-32 items-end gap-1">
            {stats.series.map((s) => (
              <div key={s.date} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${s.date}: ${s.count} earned`}>
                <div
                  className="w-full rounded-t"
                  style={{
                    height: `${Math.max(2, (s.count / maxDay) * 100)}%`,
                    background: 'linear-gradient(180deg, var(--p-1), var(--p-2))',
                    opacity: s.count > 0 ? 1 : 0.25,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
            <span>{stats.series[0]?.date.slice(5)}</span>
            <span>{stats.series[stats.series.length - 1]?.date.slice(5)}</span>
          </div>
        </div>

        {/* Most earned */}
        <div className="rounded-2xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <p className="mb-3 text-sm font-semibold text-foreground">Most earned milestones</p>
          {topRanking.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No milestones earned yet.</p>
          ) : (
            <div className="space-y-2.5">
              {topRanking.map((m, i) => {
                const top = topRanking[0].earned || 1
                return (
                  <div key={m.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5 truncate" style={{ color: 'var(--text-2)' }}>
                        <span className="shrink-0" style={{ color: 'var(--text-3)' }}>
                          <MilestoneIcon name={iconByMilestone.get(m.id) ?? 'Award'} size={13} />
                        </span>
                        <span className="mr-0.5 font-mono text-xs" style={{ color: 'var(--text-3)' }}>#{i + 1}</span>
                        {m.name}
                      </span>
                      <span className="shrink-0 font-semibold text-foreground">{m.earned.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, (m.earned / top) * 100)}%`, background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Tile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-2xl border p-3" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: accent ?? 'var(--text-3)' }}>
        {icon}
        {label}
      </div>
      <p className="mt-1 text-xl font-bold text-foreground">{value.toLocaleString()}</p>
    </div>
  )
}

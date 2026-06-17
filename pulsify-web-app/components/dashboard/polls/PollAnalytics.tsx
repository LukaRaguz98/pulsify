'use client'

import { BarChart3, Users, CheckCircle2, TrendingUp } from 'lucide-react'
import type { PollStats } from '@/lib/polls'

export function PollAnalytics({ stats }: { stats: PollStats }) {
  const maxVotes = Math.max(1, ...stats.series.map((s) => s.votes))

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={<BarChart3 size={16} />} label="Total votes" value={stats.totalVotes} color="#60a5fa" />
        <Metric icon={<Users size={16} />} label="Total voters" value={stats.totalVoters} color="#a855f7" />
        <Metric icon={<TrendingUp size={16} />} label="Avg voters / poll" value={stats.avgVoters} color="#22c55e" />
        <Metric icon={<CheckCircle2 size={16} />} label="Participation met" value={`${stats.participationRate}%`} color="#f59e0b" />
      </div>

      {/* Daily vote trend */}
      <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <p className="mb-4 text-sm font-semibold text-foreground">Votes over the last {stats.series.length} days</p>
        <div className="flex h-32 items-end gap-1">
          {stats.series.map((s) => (
            <div key={s.date} className="group relative flex flex-1 flex-col items-center justify-end" title={`${s.date}: ${s.votes} votes, ${s.polls} polls`}>
              <div
                className="w-full rounded-t transition-all"
                style={{ height: `${Math.max(2, (s.votes / maxVotes) * 100)}%`, background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', minHeight: 2 }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px]" style={{ color: 'var(--text-3)' }}>
          <span>{stats.series[0]?.date.slice(5)}</span>
          <span>{stats.series[stats.series.length - 1]?.date.slice(5)}</span>
        </div>
      </div>

      {/* Top polls by voters */}
      <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <p className="mb-3 text-sm font-semibold text-foreground">Most active polls</p>
        {stats.topByVoters.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>No polls yet.</p>
        ) : (
          <div className="space-y-2">
            {stats.topByVoters.map((p, i) => {
              const max = Math.max(1, stats.topByVoters[0].voters)
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="w-5 shrink-0 text-center text-xs font-bold" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" style={{ color: 'var(--text-2)' }}>{p.title}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(p.voters / max) * 100}%`, background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }} />
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-semibold text-foreground">{p.voters.toLocaleString()}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>{icon}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className="font-mono text-3xl font-bold text-foreground">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

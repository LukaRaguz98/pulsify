'use client'

import { Trophy, TrendingUp, CheckCircle2, Flag } from 'lucide-react'
import { type GiveawayStats } from '@/lib/giveaways'

export function GiveawayAnalytics({ stats }: { stats: GiveawayStats }) {
  if (stats.total === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border py-16 text-center"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
          <TrendingUp size={26} />
        </div>
        <p className="font-semibold text-foreground">No analytics yet</p>
        <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
          Run a giveaway and engagement stats — entries, participation and trends — will show up here.
        </p>
      </div>
    )
  }

  const maxEntries = Math.max(1, ...stats.series.map((s) => s.entries))

  return (
    <div className="insight-grid grid gap-4">
      {/* Stat tiles — only metrics not already shown in the At a glance section. */}
      <div className="insight-card grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Flag size={15} />} label="Ended" value={stats.ended} accent="#a855f7" />
        <Tile icon={<TrendingUp size={15} />} label="Avg entries / giveaway" value={stats.avgEntries} />
        <Tile icon={<Trophy size={15} />} label="Winners drawn" value={stats.totalWinners} accent="#f59e0b" />
        <Tile icon={<CheckCircle2 size={15} />} label="Completion rate" value={`${stats.completionRate}%`} accent="#3b82f6" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Entry trend */}
        <div className="insight-card rounded-2xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <p className="mb-3 text-sm font-semibold text-foreground">Entries · last 14 days</p>
          <div className="flex h-32 items-end gap-1">
            {stats.series.map((s) => (
              <div key={s.date} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${s.date}: ${s.entries} entries`}>
                <div
                  className="w-full rounded-t"
                  style={{
                    height: `${Math.max(2, (s.entries / maxEntries) * 100)}%`,
                    background: 'linear-gradient(180deg, var(--p-1), var(--p-2))',
                    opacity: s.entries > 0 ? 1 : 0.25,
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

        {/* Most active giveaways */}
        <div className="insight-card rounded-2xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <p className="mb-3 text-sm font-semibold text-foreground">Most active giveaways</p>
          {stats.topByEntries.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No entries recorded yet.</p>
          ) : (
            <div className="space-y-2.5">
              {stats.topByEntries.map((g, i) => {
                const top = stats.topByEntries[0].entries || 1
                return (
                  <div key={g.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="truncate" style={{ color: 'var(--text-2)' }}>
                        <span className="mr-1.5 font-mono text-xs" style={{ color: 'var(--text-3)' }}>#{i + 1}</span>
                        {g.title}
                      </span>
                      <span className="shrink-0 font-semibold text-foreground">{g.entries.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(4, (g.entries / top) * 100)}%`, background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }}
                      />
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

function Tile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl border p-3" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: accent ?? 'var(--text-3)' }}>
        {icon}
        {label}
      </div>
      <p className="mt-1 text-xl font-bold text-foreground">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

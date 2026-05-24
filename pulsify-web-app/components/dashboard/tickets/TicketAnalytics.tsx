'use client'

import { Ticket as TicketIco, CircleDot, CheckCircle2, Timer, Hand, Percent } from 'lucide-react'
import {
  PRIORITY_META,
  formatDuration,
  type TicketStats,
  type TicketConfig,
} from '@/lib/tickets'

export function TicketAnalytics({ stats, config }: { stats: TicketStats; config: TicketConfig }) {
  const maxSeries = Math.max(1, ...stats.series.map((s) => Math.max(s.opened, s.closed)))
  const maxType = Math.max(1, ...stats.byType.map((t) => t.count))
  const maxPriority = Math.max(1, ...stats.byPriority.map((p) => p.count))

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={<TicketIco size={16} />} label="Total tickets" value={stats.total} accent="var(--p-1)" />
        <StatCard icon={<CircleDot size={16} />} label="Open" value={stats.open} accent="#22c55e" />
        <StatCard icon={<CheckCircle2 size={16} />} label="Closed" value={stats.closed} accent="#94a3b8" />
        <StatCard icon={<Hand size={16} />} label="Claimed" value={stats.claimed} accent="#3b82f6" sub={`${stats.unclaimed} unclaimed`} />
        <StatCard
          icon={<Timer size={16} />}
          label="Avg. resolution"
          value={stats.avgResolutionMs != null ? formatDuration(stats.avgResolutionMs) : '—'}
          accent="#a855f7"
        />
        <StatCard icon={<Percent size={16} />} label="Resolution rate" value={`${stats.resolutionRate}%`} accent="#f59e0b" />
      </div>

      {/* Daily volume */}
      <Card title="Ticket volume" description="Opened vs. closed over the last 14 days">
        {stats.total === 0 ? (
          <Empty />
        ) : (
          <div className="flex items-end gap-1.5" style={{ height: 140 }}>
            {stats.series.map((s) => (
              <div key={s.date} className="flex flex-1 flex-col items-center gap-1" title={`${s.date}: ${s.opened} opened, ${s.closed} closed`}>
                <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 120 }}>
                  <div
                    className="w-1/2 rounded-t"
                    style={{ height: `${(s.opened / maxSeries) * 100}%`, minHeight: s.opened ? 3 : 0, background: 'var(--p-1)' }}
                  />
                  <div
                    className="w-1/2 rounded-t"
                    style={{ height: `${(s.closed / maxSeries) * 100}%`, minHeight: s.closed ? 3 : 0, background: 'color-mix(in srgb, var(--text-3) 60%, transparent)' }}
                  />
                </div>
                <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>{s.date.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
          <Legend color="var(--p-1)" label="Opened" />
          <Legend color="color-mix(in srgb, var(--text-3) 60%, transparent)" label="Closed" />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* By type */}
        <Card title="By type" description="Which categories members open most">
          {stats.byType.length === 0 ? (
            <Empty />
          ) : (
            <div className="space-y-2.5">
              {stats.byType.slice(0, 8).map((t) => (
                <BarRow key={t.id} label={t.label} count={t.count} pct={(t.count / maxType) * 100} color="var(--p-1)" />
              ))}
            </div>
          )}
        </Card>

        {/* By priority */}
        <Card title="By priority" description="Distribution across priority levels">
          {stats.total === 0 ? (
            <Empty />
          ) : (
            <div className="space-y-2.5">
              {stats.byPriority.map((p) => (
                <BarRow
                  key={p.priority}
                  label={PRIORITY_META[p.priority].label}
                  count={p.count}
                  pct={(p.count / maxPriority) * 100}
                  color={PRIORITY_META[p.priority].color}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {!config.enabled && (
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          The ticket system is currently turned off — these figures cover historical tickets.
        </p>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, accent, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; accent: string; sub?: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
          {icon}
        </span>
        <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <h3 className="font-semibold text-foreground">{title}</h3>
      {description && <p className="mb-4 mt-0.5 text-sm" style={{ color: 'var(--text-3)' }}>{description}</p>}
      <div className={description ? '' : 'mt-4'}>{children}</div>
    </section>
  )
}

function BarRow({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="truncate text-foreground">{label}</span>
        <span style={{ color: 'var(--text-3)' }}>{count}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, minWidth: count ? 4 : 0 }} />
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

function Empty() {
  return <p className="py-6 text-center text-sm" style={{ color: 'var(--text-3)' }}>No data yet.</p>
}

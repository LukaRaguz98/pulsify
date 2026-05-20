import {
  Users,
  Wifi,
  Hash,
  Crown,
  BarChart3,
  Activity,
  Shield,
  ShieldAlert,
  CalendarDays,
  LayoutGrid,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { MockWindow } from './landing-ui'

// Mirrors the real GuildSidebar: grouped nav with tiny uppercase group labels
// and one active item highlighted in the accent.
const NAV_GROUPS = [
  {
    title: 'Analytics',
    items: [
      { label: 'Overview', icon: BarChart3, active: true },
      { label: 'Statistics', icon: Activity, active: false },
    ],
  },
  {
    title: 'Server',
    items: [
      { label: 'Channels', icon: Hash, active: false },
      { label: 'Roles', icon: Crown, active: false },
      { label: 'Events', icon: CalendarDays, active: false },
    ],
  },
  {
    title: 'Safety',
    items: [
      { label: 'Moderation', icon: Shield, active: false },
      { label: 'Pulse Guard', icon: ShieldAlert, active: false },
    ],
  },
]

// Mirrors the real "At a Glance" StatsCards on the Overview page.
const STATS = [
  { label: 'Total Members', value: '24,318', sub: 'All server members', icon: Users, accent: 'var(--p-1)' },
  { label: 'Online Now', value: '3,902', sub: '16% of members', icon: Wifi, accent: 'var(--green)' },
  { label: 'Channels', value: '42', sub: '30 text · 12 voice', icon: Hash, accent: 'var(--cyan)' },
  { label: 'Roles', value: '18', sub: 'Excluding @everyone', icon: Crown, accent: 'var(--amber)' },
]

// Mirrors the "Channel Structure" bars on the Overview page.
const STRUCTURE = [
  { label: 'Text channels', count: 30, color: '#3b82f6' },
  { label: 'Voice channels', count: 12, color: 'var(--green)' },
  { label: 'Categories', count: 6, color: 'var(--amber)' },
]
const STRUCTURE_TOTAL = 48

// Member activity over the last 14 days — drives the Overview area chart.
const ACTIVITY = [28, 36, 30, 44, 38, 52, 46, 60, 54, 68, 62, 80, 73, 92]

/** Build the line + filled-area SVG paths for a value series in a 100×40 box. */
function buildArea(values: number[], w = 100, h = 40) {
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => [i * step, h - 2 - ((v - min) / range) * (h - 4)] as const)
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ')
  const area = `${line} L${w.toFixed(2)},${h} L0,${h} Z`
  return { line, area }
}
const ACT = buildArea(ACTIVITY)

function StatCard({ label, value, sub, icon: Icon, accent }: (typeof STATS)[number]) {
  return (
    <div className="rounded-xl border p-3.5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{label}</span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
        >
          <Icon size={13} />
        </span>
      </div>
      <p className="text-xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', color: 'var(--text)' }}>
        {value}
      </p>
      <p className="mt-1 text-[10px]" style={{ color: 'var(--text-3)' }}>{sub}</p>
    </div>
  )
}

export function DashboardPreview() {
  return (
    <div className="relative mx-auto -mt-4 max-w-5xl px-6 pb-8">
      <MockWindow label="Pulse Community · Overview" className="lp-fade-up-3" flush>
        <div className="flex">
          {/* Sidebar — replica of GuildSidebar */}
          <aside
            className="hidden w-48 shrink-0 flex-col sm:flex"
            style={{ background: 'linear-gradient(180deg, var(--bg-2), var(--bg))', borderRight: '1px solid var(--line-strong)' }}
          >
            <div className="flex items-center gap-2.5 border-b p-3" style={{ borderColor: 'var(--line-strong)' }}>
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
              >
                P
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-foreground">Pulse Community</p>
                <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>24,318 members</p>
              </div>
            </div>
            <div className="flex-1 space-y-3 p-2.5">
              {NAV_GROUPS.map((g) => (
                <div key={g.title}>
                  <p className="px-2 text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                    {g.title}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    {g.items.map((it) => (
                      <div
                        key={it.label}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium"
                        style={{
                          background: it.active ? 'var(--p-soft)' : 'transparent',
                          color: it.active ? 'var(--p-1)' : 'var(--text-3)',
                        }}
                      >
                        <it.icon size={13} />
                        {it.label}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* Main content — replica of the Server Overview page */}
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            {/* PageHeader */}
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold tracking-tight text-foreground">Server Overview</h1>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-2)' }}>Current snapshot of Pulse Community</p>
              </div>
              <span
                className="hidden shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium sm:inline-flex"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
              >
                <Activity size={11} /> View Statistics
              </span>
            </div>

            {/* At a Glance — CategorySection header */}
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-lg"
                style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
              >
                <LayoutGrid size={12} />
              </span>
              <h2 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>
                At a Glance
              </h2>
              <div className="h-px flex-1" style={{ background: 'var(--line-strong)' }} />
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {STATS.map((s) => (
                <StatCard key={s.label} {...s} />
              ))}
            </div>

            {/* Activity area chart */}
            <div className="mt-4 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                    <Activity size={14} />
                  </span>
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>Member Activity</h3>
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Messages per day · last 14 days</p>
                  </div>
                </div>
                <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--green)' }}>
                  <TrendingUp size={12} /> +18.4%
                </span>
              </div>
              <div className="h-28 w-full">
                <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full">
                  <defs>
                    <linearGradient id="lpOverviewArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" style={{ stopColor: 'var(--p-1)', stopOpacity: 0.32 }} />
                      <stop offset="100%" style={{ stopColor: 'var(--p-1)', stopOpacity: 0 }} />
                    </linearGradient>
                  </defs>
                  <path d={ACT.area} style={{ fill: 'url(#lpOverviewArea)' }} />
                  <path
                    d={ACT.line}
                    vectorEffect="non-scaling-stroke"
                    style={{ fill: 'none', stroke: 'var(--p-1)', strokeWidth: 1.75, strokeLinejoin: 'round', strokeLinecap: 'round' }}
                  />
                </svg>
              </div>
            </div>

            {/* Server Highlights — boost progress + channel structure */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                    Server Boosts
                  </span>
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: 'rgba(255,115,250,0.12)', color: '#ff8af5' }}
                  >
                    <Sparkles size={10} /> Tier 2
                  </span>
                </div>
                <p className="mb-2 text-base font-bold text-foreground">
                  9 <span className="text-xs font-normal" style={{ color: 'var(--text-3)' }}>boosts</span>
                </p>
                <div className="h-2 w-full rounded-full" style={{ background: 'var(--bg-2)' }}>
                  <div
                    className="h-2 rounded-full"
                    style={{ width: '64%', background: 'linear-gradient(90deg, #ff73fa, #c576ff)', boxShadow: '0 0 12px -2px rgba(255,115,250,0.55)' }}
                  />
                </div>
                <p className="mt-2 text-[10px]" style={{ color: 'var(--text-3)' }}>5 more boosts to reach Tier 3</p>
              </div>

              <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                  Channel Structure
                </span>
                <div className="mt-3 space-y-2.5">
                  {STRUCTURE.map((s) => (
                    <div key={s.label}>
                      <div className="mb-1 flex justify-between text-[11px]">
                        <span style={{ color: 'var(--text-2)' }}>{s.label}</span>
                        <span style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', color: 'var(--text)' }}>{s.count}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full" style={{ background: 'var(--bg-2)' }}>
                        <div className="h-1.5 rounded-full" style={{ width: `${(s.count / STRUCTURE_TOTAL) * 100}%`, background: s.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </MockWindow>
    </div>
  )
}

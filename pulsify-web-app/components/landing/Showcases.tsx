import type { ReactNode } from 'react'
import { Check, ShieldAlert, TrendingUp, Crown, MessageSquare, Users, Activity, GripVertical } from 'lucide-react'
import { Eyebrow, MockWindow } from './landing-ui'

const MONO = 'var(--font-jetbrains-mono, monospace)'

function ShowcaseRow({
  reverse,
  eyebrow,
  title,
  points,
  visual,
}: {
  reverse?: boolean
  eyebrow: string
  title: string
  points: string[]
  visual: ReactNode
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2">
      <div className={reverse ? 'lg:order-2' : ''}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h3 className="mt-4 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h3>
        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--text-2)' }}>
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
              >
                <Check size={12} />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={reverse ? 'lg:order-1' : ''}>{visual}</div>
    </div>
  )
}

function GuardVisual() {
  return (
    <MockWindow label="Pulse Guard · live">
      <div className="rounded-xl border-l-2 p-4" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', borderLeftColor: 'var(--pink)' }}>
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} style={{ color: 'var(--pink)' }} />
          <span className="text-sm font-semibold text-foreground">Toxicity detected</span>
          <span className="ml-auto text-xs font-medium" style={{ color: 'var(--text-3)' }}>92% confidence</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
          <p><span style={{ color: 'var(--text-3)' }}>Severity:</span> High</p>
          <p><span style={{ color: 'var(--text-3)' }}>Action:</span> Member warned</p>
        </div>
        <div className="mt-3 rounded-lg p-2.5 text-xs" style={{ background: 'var(--panel)', color: 'var(--text-3)' }}>
          Heuristics: slur / toxic phrase · Pulse Guard: targeted insult toward another member.
        </div>
        <div className="mt-3 flex gap-2">
          <span className="rounded-md px-2.5 py-1 text-xs font-medium text-white" style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}>Resolve</span>
          <span className="rounded-md border px-2.5 py-1 text-xs font-medium" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>Dismiss</span>
        </div>
      </div>
    </MockWindow>
  )
}

// Mirrors the Statistics page: Key Metrics StatsCards + an "Activity Breakdown"
// ChartCard with a legend.
function AnalyticsVisual() {
  const metrics = [
    { label: 'Total Messages', value: '128k', sub: 'Messages sent', icon: MessageSquare, accent: 'var(--p-1)' },
    { label: 'Active Users', value: '3,902', sub: 'Sent messages', icon: Users, accent: 'var(--cyan)' },
    { label: 'Net Growth', value: '+612', sub: 'Peak 8 PM', icon: TrendingUp, accent: 'var(--green)' },
  ]
  const days = [
    { m: 60, c: 26 }, { m: 72, c: 32 }, { m: 55, c: 22 }, { m: 84, c: 40 },
    { m: 68, c: 30 }, { m: 92, c: 44 }, { m: 100, c: 36 },
  ]
  return (
    <MockWindow label="Pulse Community · Statistics">
      <div className="grid grid-cols-3 gap-2.5">
        {metrics.map((s) => (
          <div key={s.label} className="rounded-xl border p-3" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px]" style={{ color: 'var(--text-2)' }}>{s.label}</span>
              <span
                className="flex h-6 w-6 items-center justify-center rounded-md"
                style={{ background: `color-mix(in srgb, ${s.accent} 14%, transparent)`, color: s.accent }}
              >
                <s.icon size={11} />
              </span>
            </div>
            <p className="text-base font-bold" style={{ fontFamily: MONO, color: 'var(--text)' }}>{s.value}</p>
            <p className="mt-0.5 text-[9px]" style={{ color: 'var(--text-3)' }}>{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
            <Activity size={14} />
          </span>
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-subtle">Activity Breakdown</h3>
            <p className="text-[10px] text-subtle">Messages &amp; commands per day</p>
          </div>
        </div>
        <div className="flex h-24 items-end gap-2">
          {days.map((d, i) => (
            <div key={i} className="flex flex-1 items-end gap-0.5">
              <div className="flex-1 rounded-t" style={{ height: `${d.m}%`, background: 'var(--p-1)', opacity: 0.85 }} />
              <div className="flex-1 rounded-t" style={{ height: `${d.c}%`, background: 'var(--amber)', opacity: 0.85 }} />
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex gap-4 text-[10px]" style={{ color: 'var(--text-3)' }}>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--p-1)' }} /> Messages</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--amber)' }} /> Commands</span>
        </div>
      </div>
    </MockWindow>
  )
}

// Mirrors the Roles page: a reorderable list of roles with colour swatches,
// property badges and member counts.
function CustomizationVisual() {
  const roles = [
    { name: 'Admin', color: 'var(--pink)', badge: 'Hoisted', members: '4' },
    { name: 'Moderator', color: 'var(--amber)', badge: 'Hoisted', members: '9' },
    { name: 'Contributor', color: 'var(--cyan)', badge: null, members: '38' },
    { name: 'VIP', color: 'var(--green)', badge: 'Managed', members: '12' },
    { name: 'Member', color: '#6b6d82', badge: null, members: '24.3k' },
  ]
  return (
    <MockWindow label="Pulse Community · Roles">
      <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
            <Crown size={14} />
          </span>
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-subtle">Roles</h3>
            <p className="text-[10px] text-subtle">5 roles · drag to reorder</p>
          </div>
        </div>
        <div className="space-y-1.5">
          {roles.map((r) => (
            <div
              key={r.name}
              className="flex items-center gap-2.5 rounded-lg border px-3 py-2"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
            >
              <GripVertical size={12} style={{ color: 'var(--text-3)' }} />
              <span className="h-3 w-3 shrink-0 rounded-full border" style={{ background: r.color, borderColor: 'var(--line-strong)' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text)' }}>{r.name}</span>
              {r.badge && (
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                  style={
                    r.badge === 'Managed'
                      ? { background: 'var(--p-soft)', color: 'var(--p-1)' }
                      : { background: 'var(--bg)', color: 'var(--text-3)' }
                  }
                >
                  {r.badge}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
                <Users size={10} /> {r.members}
              </span>
            </div>
          ))}
        </div>
      </div>
    </MockWindow>
  )
}

export function Showcases() {
  return (
    <section className="mx-auto max-w-7xl space-y-16 px-6 py-16">
      <ShowcaseRow
        eyebrow="AI Powered"
        title="Smart moderation that never sleeps"
        points={[
          'Heuristics + an LLM pass catch spam, scams, phishing, toxicity and NSFW.',
          'Per-category actions: flag, delete, warn or timeout — you stay in control.',
          'Warned members get a clean DM; your mod channel gets the full alert.',
          'Tunable sensitivity keeps false positives near zero.',
        ]}
        visual={<GuardVisual />}
      />
      <ShowcaseRow
        reverse
        eyebrow="Real-Time Analytics"
        title="Know your community at a glance"
        points={[
          'Live member, message and voice activity across any timeframe.',
          'Growth trends, peak hours and member leaderboards.',
          'Headline metrics — messages, active users, net growth and more.',
          'Everything updates in real time, no refresh required.',
        ]}
        visual={<AnalyticsVisual />}
      />
      <ShowcaseRow
        eyebrow="Customization"
        title="Make the server truly yours"
        points={[
          'Visual role editor with colour, hierarchy and permission presets.',
          'Welcome, goodbye and auto-role automations with rich embeds.',
          'Per-server bot branding — custom name and avatar.',
          'Channel organisation, cloning and fine-grained permissions.',
        ]}
        visual={<CustomizationVisual />}
      />
    </section>
  )
}

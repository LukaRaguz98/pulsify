import type { Metadata } from 'next'
import Image from 'next/image'
import { promises as fs } from 'fs'
import path from 'path'
import { CheckCircle2, Loader2, Circle, Sparkles, MessageCircle, Heart, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { guildIconUrl } from '@/lib/discord'
import { Eyebrow, SectionHeading } from '@/components/landing/landing-ui'
import { Reveal } from '@/components/landing/Reveal'
import { InvitePulseButton } from '@/components/landing/LandingCtas'
import { SITE } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Community · Pulsify',
  description:
    'Join the Pulsify community — Discord invite, product updates and changelog, roadmap preview, community showcase and ways to contribute.',
  alternates: { canonical: '/community' },
}

const CHANGELOG = [
  {
    version: 'v1.4',
    date: 'May 2026',
    title: 'Global search & command palette',
    items: ['⌘K command palette across the whole dashboard', 'Fuzzy global search for members, roles, channels, events and more'],
  },
  {
    version: 'v1.3',
    date: 'Apr 2026',
    title: 'Scheduled automations',
    items: ['Time-based workflows: announcements, role sync, channel locks and digests', 'Run history and per-workflow analytics'],
  },
  {
    version: 'v1.2',
    date: 'Apr 2026',
    title: 'Member profiles & reputation',
    items: ['Rich member profiles with activity heatmaps', 'Reputation scores and full moderation history'],
  },
  {
    version: 'v1.1',
    date: 'Mar 2026',
    title: 'Pulse Guard AI moderation',
    items: ['AI screening for spam, scams, toxicity and NSFW', 'Per-category actions and a review queue'],
  },
]

const ROADMAP: { status: 'shipped' | 'progress' | 'planned'; label: string; items: string[] }[] = [
  {
    status: 'shipped',
    label: 'Shipped',
    items: ['Command palette & global search', 'Scheduled automations', 'Pulse Guard AI moderation', 'Member profiles & reputation'],
  },
  {
    status: 'progress',
    label: 'In progress',
    items: ['Multi-server management', 'Deeper analytics insights', 'Custom bot branding'],
  },
  {
    status: 'planned',
    label: 'Planned',
    items: ['Public API & webhooks', 'Backup & restore', 'More automation actions', 'Mobile companion'],
  },
]

const SHOWCASE = ['A', 'B', 'C', 'D', 'E', 'F']

const PRIMARY_BTN =
  'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all active:translate-y-px'
const primaryStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
  color: '#fff',
  boxShadow: '0 6px 20px -6px var(--p-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
}

const ROADMAP_STYLE = {
  shipped: { icon: CheckCircle2, color: 'var(--green)' },
  progress: { icon: Loader2, color: 'var(--amber)' },
  planned: { icon: Circle, color: 'var(--text-3)' },
} as const

function DiscordGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.001.022.015.043.032.055a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}
function XGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}
function GithubGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.78 0 12.292c0 5.211 3.438 9.63 8.205 11.188.6.111.82-.254.82-.567 0-.28-.01-1.022-.015-2.005-3.338.711-4.042-1.582-4.042-1.582-.546-1.361-1.332-1.724-1.332-1.724-1.09-.731.083-.716.083-.716 1.205.082 1.838 1.215 1.838 1.215 1.07 1.803 2.809 1.282 3.495.981.108-.763.418-1.282.762-1.577-2.665-.295-5.466-1.309-5.466-5.827 0-1.287.465-2.339 1.235-3.164-.135-.297-.54-1.497.105-3.121 0 0 1.005-.31 3.3 1.209a11.62 11.62 0 0 1 3.003-.394c1.02.005 2.047.135 3.006.394 2.28-1.519 3.285-1.209 3.285-1.209.645 1.624.24 2.824.12 3.121.765.825 1.23 1.877 1.23 3.164 0 4.53-2.805 5.527-5.475 5.817.42.354.81 1.077.81 2.182 0 1.578-.015 2.846-.015 3.229 0 .309.21.678.825.561C20.565 21.917 24 17.495 24 12.292 24 5.78 18.627.5 12 .5z" />
    </svg>
  )
}

const SOCIALS = [
  { label: 'Discord', href: SITE.discordInvite, glyph: <DiscordGlyph /> },
  { label: 'X / Twitter', href: SITE.twitter, glyph: <XGlyph /> },
  { label: 'GitHub', href: SITE.github, glyph: <GithubGlyph /> },
]

function cmpVer(a: string, b: string) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

// Pull the most recent release notes (resources/notes/vX.Y.Z.txt). Each file
// starts with `**Pulsify vX.Y.Z — Title**` then a one-line description; the date
// comes from the file's modified time. Falls back to the static lists below if
// the directory can't be read (e.g. a deploy that doesn't ship resources/).
async function loadReleases(limit = 4) {
  try {
    const dir = path.join(process.cwd(), '..', 'resources', 'notes')
    const files = (await fs.readdir(dir)).filter((f) => /^v\d/.test(f) && f.endsWith('.txt'))
    const parsed = await Promise.all(
      files.map(async (f) => {
        const full = path.join(dir, f)
        const [content, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)])
        const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
        const m = lines[0]?.match(/v([\d.]+)\s*[—-]\s*(.+?)\*\*$/)
        return {
          version: m?.[1] ?? f.replace(/^v|\.txt$/g, ''),
          title: m?.[2] ?? '',
          description: lines[1] ?? '',
          date: stat.mtime.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        }
      }),
    )
    return parsed.sort((a, b) => cmpVer(b.version, a.version)).slice(0, limit)
  } catch {
    return []
  }
}

export default async function CommunityPage() {
  const releases = await loadReleases()
  const changelog = releases.length
    ? releases.map((r) => ({ version: `v${r.version}`, date: r.date, title: r.title, items: [r.description] }))
    : CHANGELOG
  const roadmap = ROADMAP.map((col) =>
    col.status === 'shipped' && releases.length
      ? { ...col, items: releases.map((r) => `v${r.version} — ${r.title}`) }
      : col,
  )

  // Real servers running Pulsify, from the bot's synced_guilds table.
  const supabase = await createClient()
  const { data: communityRows } = await supabase
    .from('synced_guilds')
    .select('guild_id, name, icon, member_count')
    .order('member_count', { ascending: false, nullsFirst: false })
    .limit(12)
  const communities = communityRows ?? []

  return (
    <div className="mx-auto max-w-6xl px-6 pb-14 pt-10 sm:pb-20 sm:pt-14">
      {/* Hero */}
      <header className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <Eyebrow>Community</Eyebrow>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Build Pulsify with us
        </h1>
        <p className="mt-5 text-base leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Pulsify is shaped by the people who run real Discord servers. Join the community to get help, share feedback and see what’s coming next.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href={SITE.discordInvite} target="_blank" rel="noopener noreferrer" className={PRIMARY_BTN} style={primaryStyle}>
            <DiscordGlyph size={16} />
            Join the Discord
          </a>
          <InvitePulseButton variant="secondary" size="md" />
        </div>
      </header>

      {/* Updates / changelog */}
      <Reveal className="mt-20">
        <SectionHeading eyebrow="Updates" title="What’s new?" subtitle="Recent improvements shipped to Pulsify." />
        <div className="mx-auto mt-10 max-w-3xl">
          <ol className="relative space-y-8 border-l pl-8" style={{ borderColor: 'var(--line-strong)' }}>
            {changelog.map((entry) => (
              <li key={entry.version} className="relative">
                <span
                  className="absolute -left-[2.75rem] flex h-6 w-6 items-center justify-center rounded-full"
                  style={{ background: 'var(--p-1)', color: '#fff', boxShadow: '0 0 0 4px var(--bg)' }}
                >
                  <Sparkles size={12} />
                </span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="rounded-md px-2 py-0.5 font-mono text-xs font-semibold" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                    {entry.version}
                  </span>
                  <h3 className="text-base font-semibold text-foreground">{entry.title}</h3>
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>{entry.date}</span>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {entry.items.map((it) => (
                    <li key={it} className="flex gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--p-1)' }} />
                      {it}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </Reveal>

      {/* Roadmap */}
      <Reveal className="mt-20">
        <SectionHeading eyebrow="Roadmap" title="Where we’re headed" subtitle="A preview of what’s shipped, in progress and planned. Indicative and subject to change." />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {roadmap.map((col) => {
            const meta = ROADMAP_STYLE[col.status]
            const Icon = meta.icon
            return (
              <div key={col.label} className="rounded-2xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <div className="flex items-center gap-2">
                  <Icon size={16} style={{ color: meta.color }} />
                  <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>{col.label}</h3>
                </div>
                <ul className="mt-4 space-y-2.5">
                  {col.items.map((it) => (
                    <li key={it} className="flex gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </Reveal>

      {/* Community showcase */}
      <Reveal className="mt-20">
        <SectionHeading eyebrow="Showcase" title="Communities on Pulsify" subtitle={communities.length ? 'Servers running Pulsify right now.' : 'Featured servers will appear here. Want to be one of them?'} />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {communities.length
            ? communities.map((g) => {
                const iconUrl = guildIconUrl(g.guild_id, g.icon, 64)
                return (
                  <div
                    key={g.guild_id}
                    className="flex items-center gap-4 rounded-2xl border p-5"
                    style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                  >
                    {iconUrl ? (
                      <Image src={iconUrl} alt={g.name ?? 'Server'} width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl" unoptimized />
                    ) : (
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white"
                        style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
                      >
                        {(g.name ?? '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{g.name ?? 'A Pulsify server'}</p>
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                        {g.member_count ? `${Number(g.member_count).toLocaleString()} members` : 'On Pulsify'}
                      </p>
                    </div>
                  </div>
                )
              })
            : SHOWCASE.map((initial) => (
                <div
                  key={initial}
                  className="flex items-center gap-4 rounded-2xl border border-dashed p-5"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                >
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white opacity-70"
                    style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
                  >
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>Your community here</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>Featured soon</p>
                  </div>
                </div>
              ))}
        </div>
        <p className="mt-6 text-center text-xs" style={{ color: 'var(--text-3)' }}>
          {communities.length
            ? 'Servers using Pulsify, ordered by member count.'
            : 'Showcase placeholders shown during early access — apply to be featured in our Discord.'}
        </p>
      </Reveal>

      {/* Contribute / feedback */}
      <Reveal className="mt-20">
        <div className="grid items-center gap-8 rounded-3xl border p-8 md:grid-cols-[1fr_1.1fr] sm:p-10" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <Heart size={24} />
            </span>
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-foreground">Contribute & shape Pulsify</h2>
            <p className="mt-3 text-base leading-relaxed" style={{ color: 'var(--text-2)' }}>
              The best ideas come from the community. Here’s how you can help make Pulsify better for everyone.
            </p>
            <a href={SITE.discordInvite} target="_blank" rel="noopener noreferrer" className={`${PRIMARY_BTN} mt-6`} style={primaryStyle}>
              <MessageCircle size={16} />
              Get involved
            </a>
          </div>
          <ul className="space-y-3">
            {[
              'Share feedback — tell us what works and what doesn’t.',
              'Report bugs — help us catch issues early.',
              'Suggest features — vote on and propose what we build next.',
              'Help other admins — answer questions in the community.',
              'Preview betas — try new features before they ship.',
            ].map((t) => (
              <li key={t} className="flex items-start gap-3 rounded-xl border p-3.5" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
                <ArrowRight size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--p-1)' }} />
                <span className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </div>
  )
}

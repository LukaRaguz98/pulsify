'use client'

import { useState } from 'react'
import {
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  ScrollText,
} from 'lucide-react'
import type { DiscordChannel } from '@/lib/discord'
import {
  type AIModerationSettings,
  type AnalysisVerdict,
  type AutoAction,
  AUTO_ACTION_LABELS,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  SEVERITY_COLORS,
  type CategoryId,
} from '@/lib/ai-moderation'
import { runAIAnalysis } from '@/app/dashboard/[guildId]/ai-moderation/actions'
import type { AIModerationEventRow } from '@/app/api/guilds/[guildId]/ai-moderation/events/route'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfidenceBadge, SignalList, rowConfidenceLabel } from './shared'

type Props = {
  guildId: string
  settings: AIModerationSettings
  channels: DiscordChannel[]
  recentEvents: AIModerationEventRow[]
  onAnalysisComplete: () => void
}

const SAMPLE_MESSAGES: { label: string; text: string }[] = [
  { label: 'Free Nitro scam', text: 'CLAIM YOUR FREE DISCORD NITRO HERE — only 50 spots left! https://discrod-gift.com/nitro' },
  { label: 'Mention flood', text: '@everyone hey hey hey @user1 @user2 @user3 @user4 @user5 LOOK AT THIS' },
  { label: 'Casual chat', text: "Hey folks, anyone up for a few ranked games tonight? I'm down to queue around 8pm." },
  { label: 'Toxic message', text: 'You are such a r3tard, kys, no one likes you here.' },
]

export function AIModerationOverview({
  guildId,
  settings,
  channels,
  recentEvents,
  onAnalysisComplete,
}: Props) {
  const [text, setText] = useState('')
  const [channelId, setChannelId] = useState<string>(channels[0]?.id ?? '')
  const [dryRun, setDryRun] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    verdict: AnalysisVerdict
    action: AutoAction
    eventId: string | null
    remaining: number
    limit: number
  } | null>(null)

  async function handleRun() {
    if (!text.trim()) { setError('Enter a message to analyse.'); return }
    setRunning(true)
    setError(null)
    const channelMeta = channels.find((c) => c.id === channelId)
    const res = await runAIAnalysis(guildId, {
      content: text,
      channelId: channelMeta?.id ?? null,
      channelName: channelMeta?.name ?? null,
      dryRun,
    })
    if (!res.ok) {
      setError(res.error)
      setRunning(false)
      return
    }
    setResult({
      verdict: res.data.verdict,
      action: res.data.action,
      eventId: res.data.eventId,
      remaining: res.data.remaining,
      limit: res.data.limit,
    })
    setRunning(false)
    if (!dryRun) onAnalysisComplete()
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      {/* Left: test analysis */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-4 flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
          >
            <Sparkles size={14} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Test analysis</h3>
            <p className="text-xs text-subtle">Run a message through the Pulse Guard to see what the Pulse would do.</p>
          </div>
        </div>

        <label className="block text-xs font-medium text-foreground mb-1.5">Message content</label>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null) }}
          rows={4}
          placeholder="Paste a Discord message to analyse…"
          className="w-full rounded-lg border px-3.5 py-2.5 text-sm text-foreground resize-none outline-none transition-colors placeholder:text-subtle"
          style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-widest text-subtle">Try:</span>
          {SAMPLE_MESSAGES.map((s) => (
            <button
              key={s.label}
              onClick={() => setText(s.text)}
              className="rounded-md border px-2 py-1 text-[11px] font-medium transition"
              style={{
                borderColor: 'var(--line-strong)',
                color: 'var(--text-3)',
                background: 'var(--bg-2)',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Source channel (optional)</label>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            >
              <option value="">No channel</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Mode</label>
            <div className="inline-flex w-full rounded-lg border p-1" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
              <ModeBtn active={dryRun} onClick={() => setDryRun(true)}>Dry-run</ModeBtn>
              <ModeBtn active={!dryRun} onClick={() => setDryRun(false)}>Record event</ModeBtn>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
            <AlertCircle size={13} className="shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          {result && (
            <span className="text-xs text-subtle">{result.remaining}/{result.limit} analyses remaining today</span>
          )}
          <button
            onClick={handleRun}
            disabled={running || !text.trim()}
            className="ml-auto inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50"
            style={{
              background: 'linear-gradient(180deg, var(--p-1), var(--p-2))',
              boxShadow: '0 4px 14px -4px var(--p-glow)',
            }}
          >
            {running ? <><Loader2 size={14} className="animate-spin" /> Analysing…</> : <><Sparkles size={14} /> Run analysis</>}
          </button>
        </div>

        {result && (
          <VerdictPanel verdict={result.verdict} action={result.action} sensitivity={settings.sensitivity} />
        )}
      </div>

      {/* Right: recent events */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-4 flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
          >
            <ScrollText size={14} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Recent activity</h3>
            <p className="text-xs text-subtle">Latest Pulse Guard events for this server.</p>
          </div>
        </div>

        {recentEvents.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={32} />}
            title="No Pulse Guard activity yet"
            description="Test an analysis on the left or wait for the bot to flag messages."
          />
        ) : (
          <ul className="space-y-2">
            {recentEvents.map((e) => (
              <li
                key={e.id}
                className="rounded-lg border p-3 text-sm"
                style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <CategoryPill category={(e.top_category as CategoryId | null) ?? undefined} />
                  <ConfidenceBadge confidence={e.confidence} label={rowConfidenceLabel(e)} />
                </div>
                <p className="line-clamp-2 text-sm text-foreground">{e.content}</p>
                <p className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-subtle">
                  <span>{e.channel_name ? `#${e.channel_name}` : 'No channel'} · {e.author_name ?? e.author_id ?? 'unknown'}</span>
                  <span className="font-mono">{new Date(e.created_at).toLocaleTimeString()}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition"
      style={{
        background: active ? 'var(--p-soft)' : 'transparent',
        color: active ? 'var(--p-1)' : 'var(--text-3)',
      }}
    >
      {children}
    </button>
  )
}

function CategoryPill({ category }: { category?: CategoryId }) {
  if (!category) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
        style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
        No category
      </span>
    )
  }
  const color = CATEGORY_COLORS[category]
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `${color}1f`, color }}>
      {CATEGORY_LABELS[category]}
    </span>
  )
}

function VerdictPanel({
  verdict,
  action,
  sensitivity,
}: {
  verdict: AnalysisVerdict
  action: AutoAction
  sensitivity: AIModerationSettings['sensitivity']
}) {
  const severityColor = SEVERITY_COLORS[verdict.severity]
  return (
    <div
      className="mt-5 rounded-xl border p-4"
      style={{
        borderColor: verdict.violates ? `${severityColor}55` : 'var(--line-strong)',
        background: verdict.violates
          ? `color-mix(in srgb, ${severityColor} 8%, transparent)`
          : 'var(--bg-2)',
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: `${severityColor}1f`, color: severityColor }}
        >
          {verdict.violates ? <ShieldAlert size={14} /> : <CheckCircle2 size={14} />}
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">
            {verdict.violates ? 'Violation detected' : 'No violation'}
          </p>
          <p className="text-[11px] text-subtle">
            Sensitivity: <span className="font-mono">{sensitivity}</span> · Recommended action: <span className="font-semibold" style={{ color: 'var(--text-2)' }}>{AUTO_ACTION_LABELS[action]}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-mono text-sm" style={{ color: severityColor }}>
            {verdict.severity} severity
          </span>
          <ConfidenceBadge confidence={verdict.confidence} label={verdict.confidenceLabel} />
        </div>
      </div>

      {verdict.categories.length > 0 && (
        <div className="space-y-1.5">
          {verdict.categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3">
              <span className="w-32 truncate text-xs" style={{ color: 'var(--text-2)' }}>{c.label}</span>
              <div className="flex-1 overflow-hidden rounded-full" style={{ background: 'var(--line-strong)', height: 6 }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(c.score * 100)}%`,
                    background: CATEGORY_COLORS[c.id as CategoryId] ?? 'var(--p-1)',
                  }}
                />
              </div>
              <span className="w-12 text-right font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>
                {Math.round(c.score * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {verdict.reasoning && (
        <p className="mt-3 rounded-md px-3 py-2 text-xs leading-relaxed"
          style={{ background: 'var(--panel)', color: 'var(--text-2)' }}>
          {verdict.reasoning}
        </p>
      )}

      {verdict.signals.length > 0 && (
        <div className="mt-3 rounded-md px-3 py-2" style={{ background: 'var(--panel)' }}>
          <p className="mb-1.5 text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
            Triggered signals
          </p>
          <SignalList signals={verdict.signals} max={8} />
        </div>
      )}
    </div>
  )
}

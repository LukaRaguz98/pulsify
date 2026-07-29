'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Hash, Loader2, Send, AlertCircle, CheckCircle2, Lock } from 'lucide-react'
import type { ChangelogRelease } from '@/lib/release-notes-types'
import { publishChangelog } from '@/app/dashboard/[guildId]/(management)/presence/actions'

type Channel = { id: string; name: string }

type Props = {
  guildId: string
  releases: ChangelogRelease[]
  channels: Channel[]
  disabled: boolean
}

const FIELD_CLASS = 'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-1'
const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

export function PublishChangelog({ guildId, releases, channels, disabled }: Props) {
  const router = useRouter()
  const [version, setVersion] = useState(releases[0]?.version ?? '')
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const release = releases.find((r) => r.version === version) ?? releases[0] ?? null
  const channelName = channels.find((c) => c.id === channelId)?.name

  if (releases.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-3)' }}>
        No release notes were found to publish.
      </p>
    )
  }

  const onPublish = () => {
    if (!channelId) {
      setError('Pick a channel to post the changelog to.')
      return
    }
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const res = await publishChangelog(guildId, { version, channelId })
      if (res.ok) {
        setSuccess(`Posted v${version} to #${channelName ?? 'channel'}.`)
        setTimeout(() => setSuccess(null), 4000)
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  const blocked = disabled || pending

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Controls */}
      <div className="flex flex-col gap-4 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>
          Post a release&apos;s changelog to a channel as a clean Pulse message — the
          identical <code>/changelog</code> embed, with no slash command shown in the server.
        </p>

        <div>
          <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            Release
          </label>
          <select
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            disabled={blocked}
            className={FIELD_CLASS}
            style={fieldStyle}
          >
            {releases.map((r) => (
              <option key={r.version} value={r.version}>
                v{r.version} — {r.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            Channel
          </label>
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            disabled={blocked}
            className={FIELD_CLASS}
            style={fieldStyle}
          >
            {channels.length === 0 && <option value="">No text channels found</option>}
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div
            className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
          >
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: '#23a55a', background: 'color-mix(in srgb, #23a55a 12%, transparent)', color: '#23a55a' }}
          >
            <CheckCircle2 size={15} className="shrink-0" /> {success}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--line-strong)' }}>
          <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
            <Hash size={11} /> Posts to <span style={{ color: 'var(--text-2)' }}>#{channelName ?? '—'}</span>
          </p>
          <button
            type="button"
            onClick={onPublish}
            disabled={blocked || !channelId}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))', boxShadow: '0 12px 30px -12px var(--p-glow)' }}
          >
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Publish to channel
          </button>
        </div>

        {disabled && (
          <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
            <Lock size={11} /> Only the Pulsify operator can publish a changelog.
          </p>
        )}
      </div>

      {/* Preview */}
      <div className="flex flex-col overflow-hidden rounded-xl border p-4" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
        {/* No "Preview" heading — the Discord-style mock speaks for itself. */}
        {release && <ChangelogPreview release={release} />}
      </div>
    </div>
  )
}

/**
 * A faithful-enough preview of the /changelog embed: violet accent bar, the
 * `Pulse` label + title beside the announcement badge, the version badge
 * subtitle, the lead description, a "What's new" bullet list, the optional
 * outro, the three link buttons, and the footer — mirroring
 * changelogContainer() in the presence action.
 */
function ChangelogPreview({ release }: { release: ChangelogRelease }) {
  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ background: 'var(--panel)', borderLeft: '4px solid #8b5cf6', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold" style={{ color: 'var(--text-2)' }}>
            Pulse
          </p>
          <p className="mt-0.5 break-words text-lg font-bold leading-snug text-foreground">{release.title}</p>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            Pulse <code className="rounded bg-black/20 px-1">v{release.version}</code> · Released {release.date}
          </p>

          {release.description && (
            <p className="mt-2.5 break-words text-[15px] font-semibold leading-snug text-foreground">{release.description}</p>
          )}

          {release.highlights.length > 0 && (
            <>
              <div className="mt-3 mb-1 border-t pt-2 text-xs font-bold text-foreground" style={{ borderColor: 'var(--line-strong)' }}>
                What&apos;s new
              </div>
              <ul className="space-y-1 text-sm" style={{ color: 'var(--text-2)' }}>
                {release.highlights.map((h, i) => (
                  <li key={i} className="break-words">
                    • <Bolded text={h} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {release.outro && (
            <p className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
              {release.outro}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {['View Release Notes', 'Open Dashboard', 'Invite Pulse'].map((label) => (
              <span
                key={label}
                className="rounded-md border px-2 py-1 text-[11px] font-medium"
                style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="mt-3 border-t pt-2 text-[11px]" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
            Pulse · Change Log
          </div>
        </div>
        {/* No badge thumbnail — the posted changelog doesn't carry one either
            (PULSE_BADGES_ENABLED in lib/pulse-icon.ts). */}
      </div>
    </div>
  )
}

/** Render the `**bold lead**` portion of a highlight bold, like Discord does. */
function Bolded({ text }: { text: string }) {
  const m = text.match(/^\*\*(.+?)\*\*\s*(.*)$/s)
  if (!m) return <>{text}</>
  return (
    <>
      <strong className="text-foreground">{m[1]}</strong>
      {m[2] ? ` ${m[2]}` : ''}
    </>
  )
}

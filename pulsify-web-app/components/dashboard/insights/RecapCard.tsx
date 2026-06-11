'use client'

import { useState } from 'react'
import { Send, Loader2, Check, AlertCircle, Hash } from 'lucide-react'
import { postInsightsRecap } from '@/app/dashboard/[guildId]/(management)/insights/actions'
import type { RecapItem } from '@/lib/insights'

type Props = {
  guildId: string
  windowDays: number
  /** Pre-built recap lines (the same content that gets posted to Discord). */
  items: RecapItem[]
  channels: { id: string; name: string }[]
}

export function RecapCard({ guildId, windowDays, items, channels }: Props) {
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '')
  const [posting, setPosting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  async function post() {
    if (!channelId || posting) return
    setPosting(true)
    setResult(null)
    try {
      const res = await postInsightsRecap(guildId, channelId, windowDays)
      setResult(res.ok ? { ok: true, msg: 'Recap posted to Discord.' } : { ok: false, msg: res.error })
    } catch {
      setResult({ ok: false, msg: 'Something went wrong posting the recap.' })
    } finally {
      setPosting(false)
    }
  }

  const selectedName = channels.find((c) => c.id === channelId)?.name

  return (
    <div
      className="insight-card grid gap-6 rounded-xl border p-5 lg:grid-cols-[1fr_auto]"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      {/* Plain-language summary — useful on its own, and exactly what gets posted. */}
      <div>
        <p className="mb-3 text-sm" style={{ color: 'var(--text-3)' }}>
          A snapshot of the last {windowDays} days — post it to your community in one click.
        </p>
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="text-sm">
              <span className="font-semibold text-foreground">{it.label}:</span>{' '}
              <span style={{ color: 'var(--text-2)' }}>{it.value}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Share controls */}
      <div className="flex flex-col gap-2.5 lg:w-64">
        {channels.length === 0 ? (
          <p className="text-sm text-subtle">No text channels available to post to.</p>
        ) : (
          <>
            <label className="text-xs font-medium text-subtle">Post this recap to</label>
            <div className="relative">
              <Hash
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-3)' }}
              />
              <select
                value={channelId}
                onChange={(e) => {
                  setChannelId(e.target.value)
                  setResult(null)
                }}
                disabled={posting}
                className="w-full appearance-none rounded-lg border py-2 pl-7 pr-3 text-sm outline-none disabled:opacity-50"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={post}
              disabled={posting || !channelId}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-transform disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              {posting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {posting ? 'Posting…' : selectedName ? `Post to #${selectedName}` : 'Post recap'}
            </button>

            {result && (
              <p
                className="flex items-center gap-1.5 text-xs"
                style={{ color: result.ok ? '#10b981' : '#f87171' }}
              >
                {result.ok ? <Check size={12} /> : <AlertCircle size={12} />}
                {result.msg}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

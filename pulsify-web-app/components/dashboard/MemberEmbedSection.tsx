'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Sparkles, Loader2, AlertCircle, Check,
  ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react'
import { DiscordEmbedPreview, type EmbedData } from '@/components/dashboard/DiscordEmbedPreview'
import { applyWelcomeEmbed, applyGoodbyeEmbed } from '@/app/dashboard/[guildId]/(management)/ai-setup/actions'

type EmbedResult = {
  color: string
  title: string
  description: string
  fields: { name: string; value: string; inline: boolean }[]
  footer_text: string
  banner_color: string
}

type DiscordChannel = { id: string; name: string; type: number }

type Variant = 'welcome' | 'goodbye'

type Props = {
  variant: Variant
  guildId: string
  guildName: string
  description: string
  tone: string
  customTone?: string
  language?: string
  embedColor?: string
  serverSize?: string
  contentDepth?: string
  includeEmojis?: boolean
  generateKey?: number
}

const VARIANT_META = {
  welcome: {
    title:        'Welcome Embed',
    subtitle:     'Pulse generated embed card shown when a member joins',
    emptyHint:    'create a beautiful Discord embed with a custom banner for welcoming new members.',
    crafting:     'Crafting your welcome embed…',
    applyLabel:   'Select channel to post welcome embeds:',
    applySuccess: 'Welcome embed applied and enabled.',
    storageKey:   (g: string) => `pulsify:welcome-embed:${g}`,
    apply:        applyWelcomeEmbed,
  },
  goodbye: {
    title:        'Goodbye Embed',
    subtitle:     'Pulse generated embed card shown when a member leaves',
    emptyHint:    'create a graceful Discord embed with a custom banner for members who leave.',
    crafting:     'Crafting your goodbye embed…',
    applyLabel:   'Select channel to post goodbye embeds:',
    applySuccess: 'Goodbye embed applied and enabled.',
    storageKey:   (g: string) => `pulsify:goodbye-embed:${g}`,
    apply:        applyGoodbyeEmbed,
  },
} as const

export function MemberEmbedSection({
  variant, guildId, guildName, description, tone, customTone,
  language = 'english', embedColor, serverSize = 'medium', contentDepth = 'standard',
  includeEmojis = true, generateKey = 0,
}: Props) {
  const meta = VARIANT_META[variant]

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EmbedResult | null>(null)

  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const [showApply, setShowApply] = useState(false)
  const [channels, setChannels] = useState<DiscordChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<'success' | 'error' | null>(null)
  const [applyError, setApplyError] = useState('')

  // Trigger regeneration when parent signals (e.g. main Generate button)
  const prevKeyRef = useRef(0)
  useEffect(() => {
    if (generateKey > 0 && generateKey !== prevKeyRef.current) {
      prevKeyRef.current = generateKey
      handleGenerate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generateKey])

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(meta.storageKey(guildId))
      if (!saved) return
      const data = JSON.parse(saved) as {
        result?: EmbedResult
        editTitle?: string
        editDesc?: string
      }
      if (data.result) {
        setResult(data.result)
        setEditTitle(data.editTitle ?? data.result.title)
        setEditDesc(data.editDesc ?? data.result.description)
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, variant])

  // Persist to localStorage whenever result or edits change
  useEffect(() => {
    if (!result) return
    try {
      localStorage.setItem(meta.storageKey(guildId), JSON.stringify({ result, editTitle, editDesc }))
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId, variant, result, editTitle, editDesc])

  const effectiveColor = embedColor ?? result?.color ?? '#6366f1'
  const effectiveBannerColor = effectiveColor.replace('#', '')

  const bannerUrl = result
    ? `/api/banner?name=${encodeURIComponent(guildName)}&color=${effectiveBannerColor}`
    : ''

  const previewEmbed: EmbedData | null = result
    ? { ...result, color: effectiveColor, title: editTitle, description: editDesc, banner_url: bannerUrl }
    : null

  async function handleGenerate() {
    if (!description.trim()) { setError('Please describe your server in the form above first.'); return }
    setLoading(true)
    setError(null)
    setShowApply(false)
    setApplyResult(null)

    try {
      const res = await fetch('/api/ai/generate-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant, guildId, guildName, description, tone, customTone, language, embedColor, serverSize, contentDepth, includeEmojis }),
      })
      const data = await res.json() as { result?: EmbedResult; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Generation failed. Please try again.')
        return
      }
      setResult(data.result!)
      setEditTitle(data.result!.title)
      setEditDesc(data.result!.description)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleLoadChannels() {
    setChannelsLoading(true)
    try {
      const res = await fetch(`/api/discord/guild/${guildId}/channels`, { cache: 'no-store' })
      if (res.ok) {
        const all: DiscordChannel[] = await res.json()
        const text = all.filter((c) => c.type === 0)
        setChannels(text)
        if (text.length > 0) setSelectedChannel(text[0].id)
      }
    } finally {
      setChannelsLoading(false)
    }
  }

  async function handleApply() {
    if (!selectedChannel || !result) return
    setApplying(true)
    setApplyResult(null)

    const res = await meta.apply(guildId, selectedChannel, {
      color: result.color,
      title: editTitle,
      description: editDesc,
      fields: result.fields,
      footer_text: result.footer_text,
      banner_color: result.banner_color,
    })

    if (res.ok) {
      setApplyResult('success')
    } else {
      setApplyResult('error')
      setApplyError(res.error)
    }
    setApplying(false)
  }

  function toggleApply() {
    if (!showApply && channels.length === 0) handleLoadChannels()
    setShowApply((v) => !v)
    setApplyResult(null)
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: '#6366f11a', color: '#6366f1' }}
          >
            <Sparkles size={15} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{meta.title}</h3>
            <p className="text-[11px] text-subtle">{meta.subtitle}</p>
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading || !description.trim()}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed${result ? ' border font-medium' : ' font-semibold text-white'}`}
          style={result
            ? { borderColor: 'var(--line-strong)', color: 'var(--text-3)' }
            : { background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }
          }
        >
          {loading
            ? <><Loader2 size={11} className="animate-spin" /> Generating…</>
            : result
            ? <><RefreshCw size={11} /> Generate</>
            : <><Sparkles size={11} /> Generate</>
          }
        </button>
      </div>

      {/* Body */}
      <div className="p-5" style={{ background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}>
        {error && (
          <div
            className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
          >
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        {!result && !loading && (
          <p className="text-sm text-subtle text-center py-6">
            Click <strong className="text-foreground">Generate</strong> to {meta.emptyHint}
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-subtle">
            <Loader2 size={14} className="animate-spin" />
            {meta.crafting}
          </div>
        )}

        {previewEmbed && !loading && (
          <div className="space-y-4">
            {/* Discord preview mockup */}
            <DiscordEmbedPreview
              embed={previewEmbed}
              serverName={guildName}
              footerFallback={variant === 'welcome' ? 'Pulse — Welcome' : 'Pulse — Goodbye'}
            />

            {/* Editable fields */}
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">Embed Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm text-foreground outline-none transition-colors"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">Embed Description</label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border px-3 py-2 text-sm text-foreground resize-none outline-none transition-colors"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
                />
                <p className="mt-1 text-xs text-subtle">
                  Use <code className="rounded px-1" style={{ background: 'var(--bg-2)' }}>{'{user}'}</code> for member name
                  and <code className="rounded px-1" style={{ background: 'var(--bg-2)' }}>{'{server}'}</code> for server name.
                </p>
              </div>
            </div>

            {/* Apply toggle */}
            <div className="flex justify-end">
              <button
                onClick={toggleApply}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all"
                style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
              >
                Apply to Discord
                {showApply ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>

            {showApply && (
              <div
                className="rounded-lg border p-4 space-y-3"
                style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
              >
                <p className="text-xs font-semibold text-foreground">{meta.applyLabel}</p>
                {channelsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-subtle">
                    <Loader2 size={13} className="animate-spin" /> Loading channels…
                  </div>
                ) : channels.length === 0 ? (
                  <p className="text-xs text-subtle">No text channels found.</p>
                ) : (
                  <select
                    value={selectedChannel}
                    onChange={(e) => setSelectedChannel(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  >
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>#{c.name}</option>
                    ))}
                  </select>
                )}
                {applyResult === 'success' && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: '#22c55e' }}>
                    <Check size={12} /> {meta.applySuccess}
                  </div>
                )}
                {applyResult === 'error' && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
                    <AlertCircle size={12} /> {applyError}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    onClick={handleApply}
                    disabled={applying || !selectedChannel || channelsLoading}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all disabled:opacity-50"
                    style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
                  >
                    {applying
                      ? <><Loader2 size={11} className="animate-spin" /> Applying…</>
                      : 'Submit'
                    }
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

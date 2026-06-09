'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Sparkles, Copy, Check, RefreshCw, Loader2, AlertCircle,
  MessageSquare, ShieldCheck, BookOpen, LayoutGrid, ChevronDown, ChevronUp,
  SlidersHorizontal, Globe, Palette, Users, Smile, AlignLeft,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { applyWelcomeMessage, applyRules, applyOnboarding, applyChannelsReference } from '@/app/dashboard/[guildId]/ai-setup/actions'
import { MemberEmbedSection } from '@/components/dashboard/MemberEmbedSection'
import { AppEmbedPreview } from '@/components/dashboard/AppEmbedPreview'
import { usePreferences } from '@/components/ThemeProvider'
import { THEMES } from '@/lib/themes'

type Tone = 'professional' | 'gaming' | 'community' | 'other' | 'friendly'
type GenerationResult = {
  welcome_message: string
  rules: string[]
  onboarding: string
  channels: { category: string; channels: string[] }[]
}
type DiscordChannel = { id: string; name: string; type: number; parent_id: string | null }

const TONES: { id: Tone; label: string; emoji: string }[] = [
  { id: 'friendly',     label: 'Friendly',     emoji: '😊' },
  { id: 'professional', label: 'Professional', emoji: '💼' },
  { id: 'gaming',       label: 'Gaming',       emoji: '🎮' },
  { id: 'community',    label: 'Community',    emoji: '🤝' },
  { id: 'other',        label: 'Other…',       emoji: '✏️' },
]

const LANGUAGES = [
  { id: 'english', label: 'English',  flag: '🇬🇧' },
  { id: 'spanish', label: 'Español',  flag: '🇪🇸' },
  { id: 'french',  label: 'Français', flag: '🇫🇷' },
  { id: 'german',  label: 'Deutsch',  flag: '🇩🇪' },
  { id: 'italian', label: 'Italiano', flag: '🇮🇹' },
  { id: 'custom',  label: 'Other…',   flag: '✏️'  },
]

const CONTENT_DEPTHS = [
  { id: 'brief'    as const, label: 'Brief',    sub: 'Short & punchy',      icon: '⚡' },
  { id: 'standard' as const, label: 'Standard', sub: 'Balanced',            icon: '✦' },
  { id: 'detailed' as const, label: 'Detailed', sub: 'Thorough & complete', icon: '📖' },
]

const SERVER_SIZES = [
  { id: 'small'  as const, label: 'Cozy',     sub: '< 100',   icon: '🌱' },
  { id: 'medium' as const, label: 'Growing',  sub: '100–1k',  icon: '🌿' },
  { id: 'large'  as const, label: 'Thriving', sub: '1k+',     icon: '🌳' },
]

const EMBED_COLORS = [
  '#8b5cf6', '#6366f1', '#a855f7', '#ec4899',
  '#f59e0b', '#10b981', '#3b82f6', '#ef4444',
]

function CopyButton({ text, id, copied, onCopy }: { text: string; id: string; copied: string | null; onCopy: (text: string, id: string) => void }) {
  return (
    <button
      onClick={() => onCopy(text, id)}
      title="Copy"
      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
      style={{ color: 'var(--text-3)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--text)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-3)' }}
    >
      {copied === id ? <Check size={13} style={{ color: '#22c55e' }} /> : <Copy size={13} />}
    </button>
  )
}

const STORAGE_KEY = (guildId: string) => `pulsify:ai-setup:${guildId}`

type Props = { guildId: string; guildName: string }

export function AISetupContent({ guildId, guildName }: Props) {
  const { theme } = usePreferences()
  const accentHex = THEMES.find((t) => t.id === theme)?.accent ?? '#8b5cf6'

  const [description, setDescription] = useState('')
  const [tone, setTone] = useState<Tone>('friendly')
  const [customTone, setCustomTone] = useState('')
  const [language, setLanguage] = useState('english')
  const [customLanguage, setCustomLanguage] = useState('')
  const [embedColor, setEmbedColor] = useState(accentHex)
  const [serverSize, setServerSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [contentDepth, setContentDepth] = useState<'brief' | 'standard' | 'detailed'>('standard')
  const [includeEmojis, setIncludeEmojis] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [limit, setLimit] = useState(10)
  const [copied, setCopied] = useState<string | null>(null)

  // Editable fields
  const [welcomeText, setWelcomeText] = useState('')
  const [rulesTitle, setRulesTitle] = useState('📜 Server Rules')
  const [rulesText, setRulesText] = useState('')
  const [onboardingTitle, setOnboardingTitle] = useState('📖 Onboarding Guide')
  const [onboardingText, setOnboardingText] = useState('')

  // Apply welcome
  const [showApply, setShowApply] = useState(false)
  const [channels, setChannels] = useState<DiscordChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<'success' | 'error' | null>(null)
  const [applyError, setApplyError] = useState('')

  // Apply rules
  const [showRulesApply, setShowRulesApply] = useState(false)
  const [rulesChannel, setRulesChannel] = useState('')
  const [applyingRules, setApplyingRules] = useState(false)
  const [rulesApplyResult, setRulesApplyResult] = useState<'success' | 'error' | null>(null)
  const [rulesApplyError, setRulesApplyError] = useState('')

  // Apply onboarding
  const [showOnboardApply, setShowOnboardApply] = useState(false)
  const [onboardChannel, setOnboardChannel] = useState('')
  const [applyingOnboard, setApplyingOnboard] = useState(false)
  const [onboardApplyResult, setOnboardApplyResult] = useState<'success' | 'error' | null>(null)
  const [onboardApplyError, setOnboardApplyError] = useState('')

  // Apply channels reference
  const [showChRefApply, setShowChRefApply] = useState(false)
  const [applyingChRef, setApplyingChRef] = useState(false)
  const [chRefApplyResult, setChRefApplyResult] = useState<'success' | 'error' | null>(null)
  const [chRefApplyError, setChRefApplyError] = useState('')

  const [embedGenerateKey, setEmbedGenerateKey] = useState(0)

  // Restore state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY(guildId))
      if (!saved) return
      const data = JSON.parse(saved) as {
        description?: string
        tone?: Tone
        customTone?: string
        language?: string
        customLanguage?: string
        embedColor?: string
        serverSize?: 'small' | 'medium' | 'large'
        contentDepth?: 'brief' | 'standard' | 'detailed'
        includeEmojis?: boolean
        result?: GenerationResult
        welcomeText?: string
        rulesTitle?: string
        rulesText?: string
        onboardingTitle?: string
        onboardingText?: string
      }
      if (data.description) setDescription(data.description)
      if (data.tone) setTone(data.tone)
      if (data.customTone) setCustomTone(data.customTone)
      if (data.language) setLanguage(data.language)
      if (data.customLanguage) setCustomLanguage(data.customLanguage)
      if (data.embedColor) setEmbedColor(data.embedColor)
      if (data.serverSize) setServerSize(data.serverSize)
      if (data.contentDepth) setContentDepth(data.contentDepth)
      if (data.includeEmojis !== undefined) setIncludeEmojis(data.includeEmojis)
      if (data.result) {
        setResult(data.result)
        setWelcomeText(data.welcomeText ?? data.result.welcome_message)
        if (data.rulesTitle) setRulesTitle(data.rulesTitle)
        setRulesText(data.rulesText ?? data.result.rules.join('\n'))
        if (data.onboardingTitle) setOnboardingTitle(data.onboardingTitle)
        setOnboardingText(data.onboardingText ?? data.result.onboarding)
      }
    } catch {}
  }, [guildId])

  // Persist to localStorage whenever result or edits change
  useEffect(() => {
    if (!result) return
    try {
      localStorage.setItem(STORAGE_KEY(guildId), JSON.stringify({
        description, tone, customTone, language, customLanguage, embedColor, serverSize, contentDepth, includeEmojis,
        result, welcomeText, rulesTitle, rulesText, onboardingTitle, onboardingText,
      }))
    } catch {}
  }, [guildId, description, tone, customTone, language, customLanguage, embedColor, serverSize, contentDepth, includeEmojis, result, welcomeText, rulesTitle, rulesText, onboardingTitle, onboardingText])

  const checkLimit = useCallback(async () => {
    const res = await fetch(`/api/ai/generate?guildId=${guildId}`)
    if (res.ok) {
      const data = await res.json() as { remaining: number; limit: number }
      setRemaining(data.remaining)
      setLimit(data.limit)
    }
  }, [guildId])

  useEffect(() => { checkLimit() }, [checkLimit])

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  function syncEditors(res: GenerationResult) {
    setWelcomeText(res.welcome_message)
    setRulesText(res.rules.map((r, i) => `${i + 1}. ${r}`).join('\n'))
    setOnboardingText(res.onboarding)
  }

  async function handleGenerate() {
    if (!description.trim()) { setError('Please describe your server first.'); return }
    setLoading(true)
    setError(null)
    setShowApply(false)
    setApplyResult(null)

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guildId, guildName, description, tone,
          customTone: tone === 'other' ? customTone.trim() : undefined,
          language: language === 'custom' ? (customLanguage.trim() || 'english') : language,
          serverSize,
          contentDepth,
          includeEmojis,
        }),
      })
      const data = await res.json() as {
        result?: GenerationResult
        remaining?: number
        limit?: number
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Generation failed. Please try again.')
        return
      }
      setResult(data.result!)
      syncEditors(data.result!)
      setRemaining(data.remaining ?? null)
      setLimit(data.limit ?? 10)
      setEmbedGenerateKey((v) => v + 1)
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
        if (text.length > 0) {
          const first = text[0].id
          setSelectedChannel((v) => v || first)
          setRulesChannel((v) => v || first)
          setOnboardChannel((v) => v || first)
        }
      }
    } finally {
      setChannelsLoading(false)
    }
  }

  function ensureChannels() {
    if (channels.length === 0 && !channelsLoading) handleLoadChannels()
  }

  async function handleApply() {
    if (!selectedChannel) return
    setApplying(true)
    setApplyResult(null)
    const res = await applyWelcomeMessage(guildId, selectedChannel, welcomeText)
    if (res.ok) {
      setApplyResult('success')
    } else {
      setApplyResult('error')
      setApplyError(res.error)
    }
    setApplying(false)
  }

  function toggleApply() {
    ensureChannels()
    setShowApply((v) => !v)
    setApplyResult(null)
  }

  async function handleApplyRules() {
    if (!rulesChannel) return
    setApplyingRules(true)
    setRulesApplyResult(null)
    const res = await applyRules(guildId, rulesChannel, rulesTitle, rulesText, embedColor)
    setRulesApplyResult(res.ok ? 'success' : 'error')
    if (!res.ok) setRulesApplyError(res.error)
    setApplyingRules(false)
  }

  function toggleRulesApply() {
    ensureChannels()
    setShowRulesApply((v) => !v)
    setRulesApplyResult(null)
  }

  async function handleApplyOnboard() {
    if (!onboardChannel) return
    setApplyingOnboard(true)
    setOnboardApplyResult(null)
    const res = await applyOnboarding(guildId, onboardChannel, onboardingTitle, onboardingText, embedColor)
    setOnboardApplyResult(res.ok ? 'success' : 'error')
    if (!res.ok) setOnboardApplyError(res.error)
    setApplyingOnboard(false)
  }

  function toggleOnboardApply() {
    ensureChannels()
    setShowOnboardApply((v) => !v)
    setOnboardApplyResult(null)
  }

  async function handleApplyChRef() {
    if (!result) return
    setApplyingChRef(true)
    setChRefApplyResult(null)
    const res = await applyChannelsReference(guildId, result.channels)
    setChRefApplyResult(res.ok ? 'success' : 'error')
    if (!res.ok) setChRefApplyError(res.error)
    setApplyingChRef(false)
  }

  function toggleChRefApply() {
    setShowChRefApply((v) => !v)
    setChRefApplyResult(null)
  }

  const channelsCopyText = result?.channels
    .map((cat) => `${cat.category}\n${cat.channels.map((c) => `  #${c}`).join('\n')}`)
    .join('\n\n') ?? ''

  const rulesCopyText = rulesText

  const canGenerate = description.trim().length > 0 && (remaining === null || remaining > 0) && !loading

  return (
    <div className="page-content">
      <PageHeader
        title="Pulse - Discord Server Assistant"
        helpId="ai-setup"
        description="Generate welcome messages, rules, onboarding guides and channel structures with AI."
      />

      {/* Input card */}
      <div className="rounded-xl border p-6 mb-6" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="mb-5">
          <label className="block text-sm font-semibold text-foreground mb-2">
            Describe your server
          </label>
          <textarea
            value={description}
            onChange={(e) => { setDescription(e.target.value); setError(null) }}
            rows={4}
            placeholder={`e.g. A competitive gaming community focused on Valorant and CS2. We host weekly tournaments, have an active ranked ladder, and welcome players of all skill levels.`}
            className="w-full rounded-lg border px-3.5 py-2.5 text-sm text-foreground resize-none outline-none transition-colors placeholder:text-subtle"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
          />
          <p className="mt-1.5 text-xs text-subtle">{description.length} / 500 characters</p>
        </div>

        {/* Generation Options */}
        <div className="mb-6">
          {/* Divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1" style={{ background: 'var(--line-strong)' }} />
            <div
              className="flex items-center gap-1.5 rounded-full border px-3 py-1"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
            >
              <SlidersHorizontal size={10} style={{ color: 'var(--p-1)' }} />
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                Options
              </span>
            </div>
            <div className="h-px flex-1" style={{ background: 'var(--line-strong)' }} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Tone & Style */}
            <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
              <div className="flex items-center gap-1.5 mb-3">
                <Sparkles size={12} style={{ color: 'var(--p-1)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Tone &amp; Style</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTone(t.id)}
                    className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all"
                    style={{
                      borderColor: tone === t.id ? 'var(--p-1)' : 'var(--line-strong)',
                      background: tone === t.id ? 'var(--p-soft)' : 'var(--panel)',
                      color: tone === t.id ? 'var(--p-1)' : 'var(--text-2)',
                    }}
                  >
                    <span>{t.emoji}</span>
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={customTone}
                onChange={(e) => setCustomTone(e.target.value)}
                placeholder="e.g. Anime, Chill, Corporate…"
                disabled={tone !== 'other'}
                className="mt-2 w-full rounded-lg border px-3 py-1.5 text-xs outline-none transition-all"
                style={{
                  background: 'var(--panel)',
                  borderColor: 'var(--line-strong)',
                  color: 'var(--text)',
                  opacity: tone === 'other' ? 1 : 0.35,
                  cursor: tone === 'other' ? 'text' : 'not-allowed',
                }}
                onFocus={(e) => { if (tone === 'other') e.currentTarget.style.borderColor = 'var(--p-1)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
              />
            </div>

            {/* Language */}
            <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
              <div className="flex items-center gap-1.5 mb-3">
                <Globe size={12} style={{ color: 'var(--p-1)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Language</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLanguage(l.id)}
                    className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all"
                    style={{
                      borderColor: language === l.id ? 'var(--p-1)' : 'var(--line-strong)',
                      background: language === l.id ? 'var(--p-soft)' : 'var(--panel)',
                      color: language === l.id ? 'var(--p-1)' : 'var(--text-2)',
                    }}
                  >
                    <span>{l.flag}</span>
                    {l.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 space-y-1.5">
                <input
                  type="text"
                  value={customLanguage}
                  onChange={(e) => setCustomLanguage(e.target.value)}
                  placeholder="e.g. Croatian, Korean…"
                  disabled={language !== 'custom'}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs outline-none transition-all"
                  style={{
                    background: 'var(--panel)',
                    borderColor: 'var(--line-strong)',
                    color: 'var(--text)',
                    opacity: language === 'custom' ? 1 : 0.35,
                    cursor: language === 'custom' ? 'text' : 'not-allowed',
                  }}
                  onFocus={(e) => { if (language === 'custom') e.currentTarget.style.borderColor = 'var(--p-1)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
                />
                {language === 'custom' && (
                  <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                    Results in less common languages may be inconsistent — review before applying.
                  </p>
                )}
              </div>
            </div>

            {/* Content Depth */}
            <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
              <div className="flex items-center gap-1.5 mb-3">
                <AlignLeft size={12} style={{ color: 'var(--p-1)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Content Depth</span>
              </div>
              <div className="flex gap-2">
                {CONTENT_DEPTHS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setContentDepth(d.id)}
                    className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border py-2 text-xs font-medium transition-all"
                    style={{
                      borderColor: contentDepth === d.id ? 'var(--p-1)' : 'var(--line-strong)',
                      background: contentDepth === d.id ? 'var(--p-soft)' : 'var(--panel)',
                      color: contentDepth === d.id ? 'var(--p-1)' : 'var(--text-2)',
                    }}
                  >
                    <span className="text-base leading-none">{d.icon}</span>
                    <span className="font-semibold">{d.label}</span>
                    <span className="text-[10px] opacity-60">{d.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Embed Color */}
            <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
              <div className="flex items-center gap-1.5 mb-3">
                <Palette size={12} style={{ color: 'var(--p-1)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Embed Color</span>
                <span
                  className="ml-auto rounded px-1.5 py-0.5 font-mono text-[10px]"
                  style={{ background: 'var(--panel)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
                >
                  {embedColor}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {EMBED_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setEmbedColor(c)}
                    title={c}
                    className="h-6 w-6 rounded-full transition-all hover:scale-110 flex-shrink-0"
                    style={{
                      background: c,
                      outline: embedColor === c ? `2px solid ${c}` : '2px solid transparent',
                      outlineOffset: '2px',
                    }}
                  />
                ))}
                {/* Rainbow custom picker */}
                <label
                  title="Custom color"
                  className="relative h-6 w-6 rounded-full cursor-pointer flex-shrink-0"
                  style={{
                    background: 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #ec4899, #f43f5e)',
                    outline: !EMBED_COLORS.includes(embedColor) ? `2px solid ${embedColor}` : '2px solid transparent',
                    outlineOffset: '2px',
                  }}
                >
                  <input
                    type="color"
                    value={embedColor}
                    onChange={(e) => setEmbedColor(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>
              </div>
            </div>

            {/* Server Size */}
            <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
              <div className="flex items-center gap-1.5 mb-3">
                <Users size={12} style={{ color: 'var(--p-1)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Server Size</span>
              </div>
              <div className="flex gap-2">
                {SERVER_SIZES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setServerSize(s.id)}
                    className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border py-2 text-xs font-medium transition-all"
                    style={{
                      borderColor: serverSize === s.id ? 'var(--p-1)' : 'var(--line-strong)',
                      background: serverSize === s.id ? 'var(--p-soft)' : 'var(--panel)',
                      color: serverSize === s.id ? 'var(--p-1)' : 'var(--text-2)',
                    }}
                  >
                    <span className="text-base leading-none">{s.icon}</span>
                    <span className="font-semibold">{s.label}</span>
                    <span className="text-[10px] opacity-60">{s.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Include Emojis */}
            <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
              <div className="flex items-center gap-1.5 mb-3">
                <Smile size={12} style={{ color: 'var(--p-1)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Emojis in Content</span>
              </div>
              <button
                onClick={() => setIncludeEmojis((v) => !v)}
                className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-xs transition-all"
                style={{
                  borderColor: includeEmojis ? 'var(--p-1)' : 'var(--line-strong)',
                  background: includeEmojis ? 'var(--p-soft)' : 'var(--panel)',
                }}
              >
                <span
                  className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200"
                  style={{ background: includeEmojis ? 'var(--p-1)' : 'var(--line-strong)' }}
                >
                  <span
                    className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
                    style={{ transform: includeEmojis ? 'translateX(18px)' : 'translateX(2px)' }}
                  />
                </span>
                <span style={{ color: includeEmojis ? 'var(--p-1)' : 'var(--text-2)' }}>
                  {includeEmojis ? 'Enabled — adds emoji flair ✨' : 'Disabled — clean text only'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-4">
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="
              inline-flex items-center justify-center gap-2
              rounded-xl px-5 py-3
              text-sm font-semibold text-white
              transition-all duration-200
              hover:scale-[1.02]
              active:scale-[0.98]
              disabled:opacity-50 disabled:cursor-not-allowed
            "
            style={{
              background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)',
              boxShadow: canGenerate ? '0 4px 20px -4px var(--p-glow)' : 'none',
            }}
          >
            {loading
              ? <><Loader2 size={15} className="animate-spin" /> Generating…</>
              : result
              ? <><RefreshCw size={15} /> Generate</>
              : <><Sparkles size={15} /> Generate</>
            }
          </button>

          {remaining !== null && (
            <span className="text-xs text-subtle whitespace-nowrap">
              {remaining}/{limit} remaining today
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-5">
          {/* Welcome Message */}
          <ResultCard
            icon={<MessageSquare size={15} />}
            title="Welcome Message"
            color="#6366f1"
            copyId="welcome"
            copyText={welcomeText}
            copied={copied}
            onCopy={copyText}
            extra={
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
              >
                <RefreshCw size={11} />
                Generate
              </button>
            }
          >
            <textarea
              value={welcomeText}
              onChange={(e) => setWelcomeText(e.target.value)}
              rows={4}
              className="w-full rounded-lg border px-3.5 py-2.5 text-sm text-foreground resize-none outline-none transition-colors"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
            />
            <p className="mt-1.5 text-xs text-subtle">
              Use <code className="rounded px-1" style={{ background: 'var(--bg-2)' }}>{'{user}'}</code> for member name
              and <code className="rounded px-1" style={{ background: 'var(--bg-2)' }}>{'{server}'}</code> for server name.
            </p>

            <div className="mt-4 flex justify-end">
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
              <div className="mt-4 rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                <p className="text-xs font-semibold text-foreground">Select channel to post welcome messages:</p>
                {channelsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-subtle"><Loader2 size={13} className="animate-spin" /> Loading channels…</div>
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
                    <Check size={12} /> Welcome message applied and enabled in Automations.
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
                    {applying ? <><Loader2 size={11} className="animate-spin" /> Applying…</> : 'Submit'}
                  </button>
                </div>
              </div>
            )}
          </ResultCard>

          {/* Welcome & Goodbye embeds — twin elements, side by side */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 items-start">
            <MemberEmbedSection
              variant="welcome"
              guildId={guildId}
              guildName={guildName}
              description={description}
              tone={tone}
              customTone={customTone}
              language={language === 'custom' ? (customLanguage.trim() || 'english') : language}
              embedColor={embedColor}
              serverSize={serverSize}
              contentDepth={contentDepth}
              includeEmojis={includeEmojis}
              generateKey={embedGenerateKey}
            />
            <MemberEmbedSection
              variant="goodbye"
              guildId={guildId}
              guildName={guildName}
              description={description}
              tone={tone}
              customTone={customTone}
              language={language === 'custom' ? (customLanguage.trim() || 'english') : language}
              embedColor={embedColor}
              serverSize={serverSize}
              contentDepth={contentDepth}
              includeEmojis={includeEmojis}
              generateKey={embedGenerateKey}
            />
          </div>

          {/* Server Rules */}
          <ResultCard
            icon={<ShieldCheck size={15} />}
            title="Server Rules"
            color="#f59e0b"
            copyId="rules"
            copyText={rulesCopyText}
            copied={copied}
            onCopy={copyText}
            extra={
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
              >
                <RefreshCw size={11} />
                Generate
              </button>
            }
          >
            <AppEmbedPreview title={rulesTitle} content={rulesText} color={embedColor} icon="/pulse-rules.png" footer="Pulse · Server Rules" />
            <div className="mt-3 space-y-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Embed Title</label>
                <input
                  type="text"
                  value={rulesTitle}
                  onChange={(e) => setRulesTitle(e.target.value)}
                  className="w-full rounded-lg border px-3.5 py-2 text-sm text-foreground outline-none transition-colors"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Edit content</label>
                <textarea
                  value={rulesText}
                  onChange={(e) => setRulesText(e.target.value)}
                  rows={6}
                  className="w-full rounded-lg border px-3.5 py-2.5 text-sm text-foreground resize-none outline-none transition-colors font-mono"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
                />
                <p className="mt-1 text-xs text-subtle">One rule per line. Edit to customise.</p>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={toggleRulesApply}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all"
                style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
              >
                Apply to Discord
                {showRulesApply ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>

            {showRulesApply && (
              <ApplyPanel
                label="Select channel to post server rules:"
                channels={channels}
                channelsLoading={channelsLoading}
                selectedChannel={rulesChannel}
                onSelectChannel={setRulesChannel}
                applying={applyingRules}
                applyResult={rulesApplyResult}
                applyError={rulesApplyError}
                onApply={handleApplyRules}
                successMessage="Server rules posted to Discord and saved to Automations."
              />
            )}
          </ResultCard>

          {/* Onboarding */}
          <ResultCard
            icon={<BookOpen size={15} />}
            title="Onboarding Guide"
            color="#10b981"
            copyId="onboarding"
            copyText={onboardingText}
            copied={copied}
            onCopy={copyText}
            extra={
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
              >
                <RefreshCw size={11} />
                Generate
              </button>
            }
          >
            <AppEmbedPreview title={onboardingTitle} content={onboardingText} color={embedColor} icon="/pulse-onboarding.png" footer="Pulse · Onboarding Guide" />
            <div className="mt-3 space-y-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Embed Title</label>
                <input
                  type="text"
                  value={onboardingTitle}
                  onChange={(e) => setOnboardingTitle(e.target.value)}
                  className="w-full rounded-lg border px-3.5 py-2 text-sm text-foreground outline-none transition-colors"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Edit content</label>
                <textarea
                  value={onboardingText}
                  onChange={(e) => setOnboardingText(e.target.value)}
                  rows={5}
                  className="w-full rounded-lg border px-3.5 py-2.5 text-sm text-foreground resize-none outline-none transition-colors"
                  style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={toggleOnboardApply}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all"
                style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
              >
                Apply to Discord
                {showOnboardApply ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>

            {showOnboardApply && (
              <ApplyPanel
                label="Select channel to post onboarding guide:"
                channels={channels}
                channelsLoading={channelsLoading}
                selectedChannel={onboardChannel}
                onSelectChannel={setOnboardChannel}
                applying={applyingOnboard}
                applyResult={onboardApplyResult}
                applyError={onboardApplyError}
                onApply={handleApplyOnboard}
                successMessage="Onboarding guide posted to Discord and saved to Automations."
              />
            )}
          </ResultCard>

          {/* Suggested Channels */}
          <ResultCard
            icon={<LayoutGrid size={15} />}
            title="Suggested Channels"
            color="#3b82f6"
            copyId="channels"
            copyText={channelsCopyText}
            copied={copied}
            onCopy={copyText}
            extra={
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
              >
                <RefreshCw size={11} />
                Generate
              </button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {result.channels.map((cat) => (
                <div key={cat.category} className="rounded-lg p-3" style={{ background: 'var(--bg-2)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-subtle mb-2">{cat.category}</p>
                  <div className="space-y-1">
                    {cat.channels.map((ch) => (
                      <div key={ch} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span className="text-subtle">#</span>
                        {ch}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={toggleChRefApply}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all"
                style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
              >
                Apply to Discord
                {showChRefApply ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>

            {showChRefApply && (
              <div className="mt-4 rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                <p className="text-xs font-semibold text-foreground">Create these channels on your Discord server:</p>
                <p className="text-xs text-subtle">Categories and text channels will be created as listed above. Existing channels are not affected.</p>
                {chRefApplyResult === 'success' && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: '#22c55e' }}>
                    <Check size={12} /> Channels created on Discord and saved to Automations.
                  </div>
                )}
                {chRefApplyResult === 'error' && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
                    <AlertCircle size={12} /> {chRefApplyError}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    onClick={handleApplyChRef}
                    disabled={applyingChRef}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all disabled:opacity-50"
                    style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
                  >
                    {applyingChRef ? <><Loader2 size={11} className="animate-spin" /> Creating…</> : 'Create Channels on Discord'}
                  </button>
                </div>
              </div>
            )}
          </ResultCard>

        </div>
      )}
    </div>
  )
}

// ─── ApplyPanel ─────────────────────────────────────────────────────────────

function ApplyPanel({
  label, channels, channelsLoading, selectedChannel, onSelectChannel,
  applying, applyResult, applyError, onApply, successMessage,
}: {
  label: string
  channels: DiscordChannel[]
  channelsLoading: boolean
  selectedChannel: string
  onSelectChannel: (v: string) => void
  applying: boolean
  applyResult: 'success' | 'error' | null
  applyError: string
  onApply: () => void
  successMessage: string
}) {
  return (
    <div className="mt-4 rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
      <p className="text-xs font-semibold text-foreground">{label}</p>
      {channelsLoading ? (
        <div className="flex items-center gap-2 text-sm text-subtle"><Loader2 size={13} className="animate-spin" /> Loading channels…</div>
      ) : channels.length === 0 ? (
        <p className="text-xs text-subtle">No text channels found.</p>
      ) : (
        <select
          value={selectedChannel}
          onChange={(e) => onSelectChannel(e.target.value)}
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
          <Check size={12} /> {successMessage}
        </div>
      )}
      {applyResult === 'error' && (
        <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
          <AlertCircle size={12} /> {applyError}
        </div>
      )}
      <div className="flex justify-end">
        <button
          onClick={onApply}
          disabled={applying || !selectedChannel || channelsLoading}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
        >
          {applying ? <><Loader2 size={11} className="animate-spin" /> Applying…</> : 'Submit'}
        </button>
      </div>
    </div>
  )
}

// ─── ResultCard ─────────────────────────────────────────────────────────────

function ResultCard({
  icon, title, color, copyId, copyText, copied, onCopy, extra, children,
}: {
  icon: React.ReactNode
  title: string
  color: string
  copyId: string
  copyText: string
  copied: string | null
  onCopy: (text: string, id: string) => void
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: `${color}1a`, color }}
          >
            {icon}
          </span>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {extra}
          <CopyButton text={copyText} id={copyId} copied={copied} onCopy={onCopy} />
        </div>
      </div>
      <div className="p-5" style={{ background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}>
        {children}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  MessageSquare, LogOut, ShieldCheck,
  AlertCircle, Sparkles, RotateCcw, Loader2, Check, Send,
} from 'lucide-react'
import {
  saveMemberMessages,
  type MemberEventConfig as MemberEventConfigBase,
  type PulseRulesConfig,
} from '@/app/dashboard/[guildId]/(management)/onboarding/actions'
import { applyRules } from '@/app/dashboard/[guildId]/(management)/ai-setup/actions'
import { AppEmbedPreview } from '@/components/dashboard/AppEmbedPreview'
import { DiscordEmbedPreview, type EmbedData } from '@/components/dashboard/DiscordEmbedPreview'
import { PreviewStage } from '@/components/dashboard/onboarding/PreviewStage'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import { usePreferences } from '@/components/ThemeProvider'
import { THEMES } from '@/lib/themes'
import { PULSE_PREFS_KEY, type PulsePrefs } from '@/components/dashboard/Pulse/PulseAssistantTab'

// Welcome / Goodbye greetings and the Server Rules embed used to live on the
// Automations view. They moved here (Server › Onboarding) because they're part
// of the member's first-touch experience. Storage shape is unchanged
// (guild_settings.welcome / .goodbye / .rules) so the Pulse bot is unaffected —
// see saveMemberMessages, which merges only the slices it's handed.

type Channel = { id: string; name: string }
type MemberEventConfig = MemberEventConfigBase & { type: 'message' | 'embed'; message: string }
type EmbedConfig = NonNullable<MemberEventConfig['embed']>

const selectClass = `
  w-full rounded-lg border px-3 py-2 text-sm text-foreground focus:outline-none transition
  bg-[var(--bg-2)] border-[var(--line-strong)] focus:border-[var(--p-1)]
`

type CardDef = {
  icon: ReactNode
  iconBg: string
  iconColor: string
  title: string
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
  extra: ReactNode
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      role="switch"
      aria-checked={enabled}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
      style={{
        background: enabled ? 'linear-gradient(90deg, var(--p-1), var(--p-2))' : 'var(--bg-2)',
        boxShadow: enabled ? '0 0 12px -2px var(--p-glow)' : 'none',
        border: enabled ? 'none' : '1px solid var(--line-strong)',
      }}
    >
      <span
        className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: enabled ? 'translateX(24px)' : 'translateX(4px)' }}
      />
    </button>
  )
}

export function MemberMessagesManager({
  guildId,
  guildName,
  channels,
  initialWelcome,
  initialGoodbye,
  initialRules,
}: {
  guildId: string
  guildName: string
  channels: Channel[]
  initialWelcome: Partial<MemberEventConfig> | undefined
  initialGoodbye: Partial<MemberEventConfig> | undefined
  initialRules: Partial<PulseRulesConfig> | undefined
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { theme } = usePreferences()
  const themeAccent = THEMES.find((t) => t.id === theme)?.accent ?? '#8b5cf6'

  // The Server Rules embed uses the configured Pulse embed colour (Server
  // Settings › Pulse Assistant) so it matches every other Pulse embed. Fall back
  // to the dashboard theme accent until prefs load.
  const [accentHex, setAccentHex] = useState(themeAccent)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PULSE_PREFS_KEY(guildId))
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<PulsePrefs>
        if (parsed?.embedColor) setAccentHex(parsed.embedColor)
      }
    } catch {}
  }, [guildId])

  const [welcome, setWelcome] = useState<MemberEventConfig>({
    enabled:    initialWelcome?.enabled    ?? false,
    channel_id: initialWelcome?.channel_id ?? '',
    message:    initialWelcome?.message    ?? 'Welcome to {server}, {user}! 🎉',
    type:       initialWelcome?.type       ?? 'message',
    embed:      initialWelcome?.embed,
  })
  const [goodbye, setGoodbye] = useState<MemberEventConfig>({
    enabled:    initialGoodbye?.enabled    ?? false,
    channel_id: initialGoodbye?.channel_id ?? '',
    message:    initialGoodbye?.message    ?? "We'll miss you, {user}. Thanks for being part of {server}! 👋",
    type:       initialGoodbye?.type       ?? 'message',
    embed:      initialGoodbye?.embed,
  })

  const [rulesVisible, setRulesVisible] = useState(initialRules?.enabled ?? false)
  const [rulesChannel, setRulesChannel] = useState(initialRules?.channel_id ?? (channels[0]?.id ?? ''))
  const [rulesTitle,   setRulesTitle]   = useState(initialRules?.title   ?? '📜 Server Rules')
  const [rulesContent, setRulesContent] = useState(initialRules?.content ?? '')
  const [applyingRules, setApplyingRules] = useState(false)
  const [rulesResult, setRulesResult] = useState<'success' | 'error' | null>(null)
  const [rulesError, setRulesError] = useState('')

  // Pulse generation
  const [generatingSection, setGeneratingSection] = useState<string | null>(null)
  const [pulseGenError, setPulseGenError] = useState<string | null>(null)
  const [pulseGenErrorSection, setPulseGenErrorSection] = useState<string | null>(null)

  type Snapshot = {
    welcome: MemberEventConfig
    goodbye: MemberEventConfig
    rulesVisible: boolean; rulesChannel: string; rulesTitle: string; rulesContent: string
  }
  const buildSnapshot = (): Snapshot => ({ welcome, goodbye, rulesVisible, rulesChannel, rulesTitle, rulesContent })
  const [snapshot, setSnapshot] = useState<Snapshot>(buildSnapshot)

  const current = buildSnapshot()
  const changedCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(snapshot) as (keyof Snapshot)[]) {
      if (JSON.stringify(current[k]) !== JSON.stringify(snapshot[k])) n += 1
    }
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, welcome, goodbye, rulesVisible, rulesChannel, rulesTitle, rulesContent])
  const dirty = changedCount > 0

  function clearFeedback() { setError(null) }

  function handleReset() {
    setWelcome(snapshot.welcome)
    setGoodbye(snapshot.goodbye)
    setRulesVisible(snapshot.rulesVisible)
    setRulesChannel(snapshot.rulesChannel)
    setRulesTitle(snapshot.rulesTitle)
    setRulesContent(snapshot.rulesContent)
    setError(null)
  }

  function validate(): string | null {
    if (welcome.enabled && !welcome.channel_id) return 'Welcome Message: please select a channel.'
    if (welcome.enabled && welcome.type !== 'embed' && !welcome.message.trim())
      return 'Welcome Message: message text cannot be empty.'
    if (goodbye.enabled && !goodbye.channel_id) return 'Goodbye Message: please select a channel.'
    if (goodbye.enabled && goodbye.type !== 'embed' && !goodbye.message.trim())
      return 'Goodbye Message: message text cannot be empty.'
    return null
  }

  async function handleSave(): Promise<void> {
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setSaving(true)
    const result = await saveMemberMessages(guildId, {
      welcome,
      goodbye,
      rules: { enabled: rulesVisible, channel_id: rulesChannel, title: rulesTitle, content: rulesContent },
    })
    setSaving(false)
    if (result.ok) {
      setError(null)
      setSnapshot(buildSnapshot())
    } else {
      setError(result.error)
    }
  }

  async function handleRepostRules() {
    setApplyingRules(true)
    setRulesResult(null)
    const res = await applyRules(guildId, rulesChannel, rulesTitle, rulesContent, accentHex)
    setRulesResult(res.ok ? 'success' : 'error')
    if (!res.ok) setRulesError(res.error)
    setApplyingRules(false)
  }

  function getPulsePrefs(): PulsePrefs | null {
    try {
      const saved = localStorage.getItem(PULSE_PREFS_KEY(guildId))
      if (!saved) return null
      return JSON.parse(saved) as PulsePrefs
    } catch { return null }
  }

  async function generateWithPulse(section: 'welcome' | 'goodbye' | 'rules') {
    const prefs = getPulsePrefs()
    if (!prefs?.description?.trim()) {
      setPulseGenError('Add a server description in Server Settings › Pulse Assistant to get started.')
      setPulseGenErrorSection(section)
      return
    }
    setGeneratingSection(section)
    setPulseGenError(null)
    setPulseGenErrorSection(null)

    try {
      if (section === 'welcome' || section === 'goodbye') {
        const res = await fetch('/api/ai/generate-embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variant: section,
            guildId, guildName,
            description: prefs.description,
            tone: prefs.tone,
            customTone: prefs.tone === 'other' ? prefs.customTone : undefined,
            language: prefs.language === 'custom' ? (prefs.customLanguage || 'english') : prefs.language,
            embedColor: prefs.embedColor,
            serverSize: prefs.serverSize,
            contentDepth: prefs.contentDepth,
            includeEmojis: prefs.includeEmojis,
          }),
        })
        const data = await res.json() as { result?: EmbedConfig; error?: string }
        if (!res.ok) { setPulseGenError(data.error ?? 'Generation failed.'); setPulseGenErrorSection(section); return }
        if (section === 'welcome') setWelcome((prev) => ({ ...prev, type: 'embed', embed: data.result }))
        else setGoodbye((prev) => ({ ...prev, type: 'embed', embed: data.result }))
        clearFeedback()
      } else {
        const res = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guildId, guildName,
            description: prefs.description,
            tone: prefs.tone,
            customTone: prefs.tone === 'other' ? prefs.customTone : undefined,
            language: prefs.language === 'custom' ? (prefs.customLanguage || 'english') : prefs.language,
            serverSize: prefs.serverSize,
            contentDepth: prefs.contentDepth,
            includeEmojis: prefs.includeEmojis,
          }),
        })
        const data = await res.json() as { result?: { rules: string[] }; error?: string }
        if (!res.ok) { setPulseGenError(data.error ?? 'Generation failed.'); setPulseGenErrorSection(section); return }
        setRulesContent(data.result!.rules.map((r, i) => `${i + 1}. ${r}`).join('\n'))
        setRulesVisible(true)
      }
    } catch {
      setPulseGenError('Network error. Please try again.')
      setPulseGenErrorSection(section)
    } finally {
      setGeneratingSection(null)
    }
  }

  const welcomeCard: CardDef = {
    icon: <MessageSquare size={16} />,
    iconBg: 'rgba(59,130,246,0.12)',
    iconColor: '#3b82f6',
    title: 'Welcome Message',
    description: welcome.type === 'embed'
      ? 'Sends an AI-generated embed card when a new member joins.'
      : 'Send a message when a new member joins.',
    enabled: welcome.enabled,
    onToggle: (v) => { setWelcome({ ...welcome, enabled: v }); clearFeedback() },
    extra: welcome.enabled && (
      <MemberEventExtra
        variant="welcome"
        config={welcome}
        onChange={(next) => { setWelcome(next); clearFeedback() }}
        guildName={guildName}
        channels={channels}
        generatingSection={generatingSection}
        onGenerate={() => generateWithPulse('welcome')}
        pulseGenError={pulseGenError}
        pulseGenErrorSection={pulseGenErrorSection}
      />
    ),
  }

  const goodbyeCard: CardDef = {
    icon: <LogOut size={16} />,
    iconBg: 'rgba(251,113,133,0.12)',
    iconColor: '#fb7185',
    title: 'Goodbye Message',
    description: goodbye.type === 'embed'
      ? 'Sends an AI-generated embed card when a member leaves.'
      : 'Send a message when a member leaves the server.',
    enabled: goodbye.enabled,
    onToggle: (v) => { setGoodbye({ ...goodbye, enabled: v }); clearFeedback() },
    extra: goodbye.enabled && (
      <MemberEventExtra
        variant="goodbye"
        config={goodbye}
        onChange={(next) => { setGoodbye(next); clearFeedback() }}
        guildName={guildName}
        channels={channels}
        generatingSection={generatingSection}
        onGenerate={() => generateWithPulse('goodbye')}
        pulseGenError={pulseGenError}
        pulseGenErrorSection={pulseGenErrorSection}
      />
    ),
  }

  const rulesCard: CardDef = {
    icon: <ShieldCheck size={16} />,
    iconBg: 'rgba(245,158,11,0.12)',
    iconColor: '#f59e0b',
    title: 'Server Rules',
    description: 'Post an AI-generated rules embed to a channel.',
    enabled: rulesVisible,
    onToggle: (v) => { setRulesVisible(v); clearFeedback() },
    extra: rulesVisible && (
      <PulseContentExtra
        channels={channels}
        channelId={rulesChannel}
        onChannelChange={setRulesChannel}
        title={rulesTitle}
        onTitleChange={setRulesTitle}
        content={rulesContent}
        onContentChange={setRulesContent}
        accentHex={accentHex}
        generatingSection={generatingSection}
        onGenerate={() => generateWithPulse('rules')}
        pulseGenError={pulseGenError}
        pulseGenErrorSection={pulseGenErrorSection}
        applying={applyingRules}
        applyResult={rulesResult}
        applyError={rulesError}
        onRepost={handleRepostRules}
      />
    ),
  }

  return (
    <div className="space-y-8">
      <CategorySection
        icon={<MessageSquare size={14} />}
        title="Welcome & Goodbye messages"
        description="Greet new members and send them off when they leave. Posted automatically by Pulse."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
          <CardItem card={welcomeCard} />
          <CardItem card={goodbyeCard} />
        </div>
      </CategorySection>

      <CategorySection
        icon={<ShieldCheck size={14} />}
        title="Server Rules"
        description="Generate and post a rules embed new members see before they take part."
      >
        <CardItem card={rulesCard} />
      </CategorySection>

      {error && (
        <div className="mt-6 flex items-start gap-2.5 rounded-xl border p-4 text-sm" style={{ background: 'rgba(239,68,68,0.07)', borderColor: 'rgba(239,68,68,0.25)', color: '#f87171' }}>
          <AlertCircle size={15} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <SaveBar
        dirty={dirty}
        changedCount={changedCount}
        saving={saving}
        saveLabel="Save messages"
        cleanText="All changes saved. Messages are posted by the Pulse bot."
        dirtyHintText="review and save to apply via the Pulse bot."
        confirmTitle="Save member messages?"
        confirmDescription="These changes will be applied by the Pulse bot immediately."
        confirmLabel="Save messages"
        onReset={handleReset}
        onSave={handleSave}
      />
    </div>
  )
}

// ─── CardItem ────────────────────────────────────────────────────────────────

function CardItem({ card }: { card: CardDef }) {
  return (
    <div className="rounded-xl border p-5 transition-colors h-full" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: card.iconBg, color: card.iconColor }}>
            {card.icon}
          </div>
          <div>
            <h2 className="font-semibold text-foreground">{card.title}</h2>
            <p className="text-sm text-subtle">{card.description}</p>
          </div>
        </div>
        <Toggle enabled={card.enabled} onChange={card.onToggle} />
      </div>
      {card.extra}
    </div>
  )
}

// ─── MemberEventExtra ────────────────────────────────────────────────────────
// Shared body for the Welcome and Goodbye cards — both are a plain message or an embed.

function MemberEventExtra({
  variant, config, onChange, guildName, channels,
  generatingSection, onGenerate, pulseGenError, pulseGenErrorSection,
}: {
  variant: 'welcome' | 'goodbye'
  config: MemberEventConfig
  onChange: (next: MemberEventConfig) => void
  guildName: string
  channels: Channel[]
  generatingSection: string | null
  onGenerate: () => void
  pulseGenError: string | null
  pulseGenErrorSection: string | null
}) {
  const isEmbed = config.type === 'embed'
  const embed = config.embed

  const bannerUrl = embed?.banner_color
    ? `/api/banner?name=${encodeURIComponent(guildName)}&color=${embed.banner_color}`
    : ''
  const previewEmbed: EmbedData | null = embed
    ? {
        color: embed.color,
        title: embed.title,
        description: embed.description,
        fields: embed.fields ?? [],
        footer_text: embed.footer_text ?? '',
        banner_url: bannerUrl,
      }
    : null

  const channelLabel = variant === 'welcome' ? 'Welcome Channel' : 'Goodbye Channel'
  const genLabel     = variant === 'welcome' ? 'Generate welcome embed with Pulse' : 'Generate goodbye embed with Pulse'
  const userHint     = variant === 'welcome' ? '{user} = mention' : '{user} = name'

  return (
    <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{channelLabel}</label>
        <select
          value={config.channel_id}
          onChange={(e) => onChange({ ...config, channel_id: e.target.value })}
          className={selectClass}
        >
          <option value="">Select a channel</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>#{c.name}</option>
          ))}
        </select>
      </div>

      {/* Pulse generate */}
      <div className="rounded-lg border p-3 flex items-center justify-between gap-3" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={12} style={{ color: 'var(--p-1)' }} />
          <p className="text-xs font-medium text-foreground truncate">{genLabel}</p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generatingSection !== null}
          className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
        >
          {generatingSection === variant
            ? <><Loader2 size={11} className="animate-spin" /> Generating…</>
            : <><Sparkles size={11} /> Generate</>}
        </button>
      </div>
      {pulseGenError && pulseGenErrorSection === variant && (
        <p className="text-xs" style={{ color: '#f87171' }}>{pulseGenError}</p>
      )}

      {isEmbed && previewEmbed && embed ? (
        <div className="space-y-3">
          <PreviewStage>
            <DiscordEmbedPreview
              embed={previewEmbed}
              serverName={guildName}
              footerFallback={variant === 'welcome' ? 'Pulse · Welcome' : 'Pulse · Goodbye'}
              floating
            />
          </PreviewStage>
          <div className="space-y-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Embed Title</label>
              <input
                type="text"
                value={embed.title}
                onChange={(e) => onChange({ ...config, embed: { ...embed, title: e.target.value } })}
                className={selectClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Embed Description <span className="text-subtle">({userHint}, {'{server}'} = server name)</span>
              </label>
              <textarea
                value={embed.description}
                onChange={(e) => onChange({ ...config, embed: { ...embed, description: e.target.value } })}
                rows={3}
                className={selectClass + ' resize-none'}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange({ ...config, type: 'message', embed: undefined })}
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: 'var(--text-3)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
          >
            <RotateCcw size={11} />
            Switch to plain text message
          </button>
        </div>
      ) : (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Message <span className="text-subtle">({userHint}, {'{server}'} = server name)</span>
          </label>
          <textarea
            value={config.message}
            onChange={(e) => onChange({ ...config, message: e.target.value })}
            rows={3}
            className={selectClass + ' resize-none'}
          />
        </div>
      )}
    </div>
  )
}

// ─── PulseContentExtra ────────────────────────────────────────────────────────
// Body for the Server Rules card — Pulse-generated content posted to a channel.

function PulseContentExtra({
  channels, channelId, onChannelChange,
  title, onTitleChange, content, onContentChange,
  accentHex, generatingSection, onGenerate,
  pulseGenError, pulseGenErrorSection,
  applying, applyResult, applyError, onRepost,
}: {
  channels: Channel[]
  channelId: string
  onChannelChange: (v: string) => void
  title: string
  onTitleChange: (v: string) => void
  content: string
  onContentChange: (v: string) => void
  accentHex: string
  generatingSection: string | null
  onGenerate: () => void
  pulseGenError: string | null
  pulseGenErrorSection: string | null
  applying: boolean
  applyResult: 'success' | 'error' | null
  applyError: string
  onRepost: () => void
}) {
  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Channel</label>
            <select value={channelId} onChange={(e) => onChannelChange(e.target.value)} className={selectClass}>
              <option value="">Select a channel</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}</option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border p-3 flex items-center justify-between gap-3" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={12} style={{ color: 'var(--p-1)' }} />
              <p className="text-xs font-medium text-foreground truncate">Generate rules with Pulse</p>
            </div>
            <button
              type="button"
              onClick={onGenerate}
              disabled={generatingSection !== null}
              className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
            >
              {generatingSection === 'rules'
                ? <><Loader2 size={11} className="animate-spin" /> Generating…</>
                : <><Sparkles size={11} /> Generate</>}
            </button>
          </div>
          {pulseGenError && pulseGenErrorSection === 'rules' && (
            <p className="text-xs" style={{ color: '#f87171' }}>{pulseGenError}</p>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Embed Title</label>
            <input type="text" value={title} onChange={(e) => onTitleChange(e.target.value)} className={selectClass} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Edit content</label>
            <textarea
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              className={selectClass + ' min-h-[20rem] flex-1 resize-none font-mono'}
            />
          </div>

          {applyResult === 'success' && (
            <div className="flex items-center gap-2 text-xs" style={{ color: '#22c55e' }}>
              <Check size={12} /> Posted to Discord successfully.
            </div>
          )}
          {applyResult === 'error' && (
            <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
              <AlertCircle size={12} /> {applyError}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onRepost}
              disabled={applying || !channelId}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
            >
              {applying
                ? <><Loader2 size={11} className="animate-spin" /> Posting…</>
                : <><Send size={11} /> Post to Discord</>}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Preview</label>
          <PreviewStage>
            <AppEmbedPreview title={title} content={content} color={accentHex} icon="/pulse-info.png" footer="Pulse · Server Rules" floating />
          </PreviewStage>
        </div>
      </div>
    </div>
  )
}

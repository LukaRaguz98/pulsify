'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { saveAutomations, removePulseContent, type AutomationSettings } from './actions'
import { applyRules, applyChannelsReference } from '@/app/dashboard/[guildId]/(management)/ai-setup/actions'
import type { DiscordChannel, DiscordRole } from '@/lib/discord'
import { AppEmbedPreview } from '@/components/dashboard/AppEmbedPreview'
import { DiscordEmbedPreview, type EmbedData } from '@/components/dashboard/DiscordEmbedPreview'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import { usePreferences } from '@/components/ThemeProvider'
import { THEMES } from '@/lib/themes'
import {
  MessageSquare, Star, Bell,
  AlertCircle, Sparkles, RotateCcw,
  ShieldCheck, LayoutGrid, Loader2, Check, Trash2, RefreshCw,
  UserPlus, Shield, FolderTree, LogOut, Send, Plus, X, Zap,
} from 'lucide-react'

type Props = {
  guildId: string
  guildName: string
  channels: DiscordChannel[]
  roles: DiscordRole[]
  initialSettings: Record<string, unknown>
}

type WelcomeConfig          = AutomationSettings['welcome']
type GoodbyeConfig          = AutomationSettings['goodbye']
type AutoRoleConfig         = AutomationSettings['auto_role']
type ModerationAlertsConfig = AutomationSettings['moderation_alerts']
// Welcome and Goodbye share the exact same shape — both can be a plain message or an embed.
type MemberEventConfig      = WelcomeConfig

type PulseRulesConfig      = { enabled: boolean; channel_id: string; title?: string; content: string }
type PulseChannelsConfig   = { enabled: boolean; structure: { category: string; channels: string[] }[] }

type GenerationResult = {
  welcome_message: string
  rules: string[]
  onboarding: string
  channels: { category: string; channels: string[] }[]
}

type EmbedConfig = NonNullable<MemberEventConfig['embed']>

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

const selectClass = `
  w-full rounded-lg border px-3 py-2 text-sm text-foreground focus:outline-none transition
  bg-[var(--bg-2)] border-[var(--line-strong)] focus:border-[var(--p-1)]
`

function validate(
  welcome: WelcomeConfig,
  goodbye: GoodbyeConfig,
  autoRole: AutoRoleConfig,
  modAlerts: ModerationAlertsConfig,
): string | null {
  if (welcome.enabled && !welcome.channel_id) return 'Welcome Message: please select a channel.'
  if (welcome.enabled && welcome.type !== 'embed' && !welcome.message.trim())
    return 'Welcome Message: message text cannot be empty.'
  if (goodbye.enabled && !goodbye.channel_id) return 'Goodbye Message: please select a channel.'
  if (goodbye.enabled && goodbye.type !== 'embed' && !goodbye.message.trim())
    return 'Goodbye Message: message text cannot be empty.'
  if (autoRole.enabled && !autoRole.role_id) return 'Auto-Role: please select a role.'
  if (modAlerts.enabled && !modAlerts.channel_id) return 'Moderation Alerts: please select a channel.'
  return null
}

export function AutomationsForm({ guildId, guildName, channels, roles, initialSettings }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const { theme } = usePreferences()
  const accentHex = THEMES.find((t) => t.id === theme)?.accent ?? '#8b5cf6'

  const rawWelcome   = initialSettings.welcome            as Partial<WelcomeConfig>          | undefined
  const rawGoodbye   = initialSettings.goodbye            as Partial<GoodbyeConfig>          | undefined
  const rawAutoRole  = initialSettings.auto_role          as Partial<AutoRoleConfig>         | undefined
  const rawModAlerts = initialSettings.moderation_alerts  as Partial<ModerationAlertsConfig> | undefined

  const rawRules   = initialSettings.rules             as PulseRulesConfig      | undefined
  const rawChRef   = initialSettings.channels_reference as PulseChannelsConfig  | undefined

  const [welcome, setWelcome] = useState<WelcomeConfig>({
    enabled:    rawWelcome?.enabled    ?? false,
    channel_id: rawWelcome?.channel_id ?? '',
    message:    rawWelcome?.message    ?? 'Welcome to {server}, {user}! 🎉',
    type:       rawWelcome?.type       ?? 'message',
    embed:      rawWelcome?.embed,
  })

  const [goodbye, setGoodbye] = useState<GoodbyeConfig>({
    enabled:    rawGoodbye?.enabled    ?? false,
    channel_id: rawGoodbye?.channel_id ?? '',
    message:    rawGoodbye?.message    ?? "We'll miss you, {user}. Thanks for being part of {server}! 👋",
    type:       rawGoodbye?.type       ?? 'message',
    embed:      rawGoodbye?.embed,
  })

  const [autoRole, setAutoRole] = useState<AutoRoleConfig>({
    enabled: rawAutoRole?.enabled ?? false,
    role_id: rawAutoRole?.role_id ?? '',
  })

  const [modAlerts, setModAlerts] = useState<ModerationAlertsConfig>({
    enabled:    rawModAlerts?.enabled    ?? false,
    channel_id: rawModAlerts?.channel_id ?? '',
  })

  // Pulse content sections
  const [rulesVisible,    setRulesVisible]    = useState(rawRules?.enabled    ?? false)
  const [rulesChannel,    setRulesChannel]    = useState(rawRules?.channel_id ?? (channels[0]?.id ?? ''))
  const [rulesTitle,      setRulesTitle]      = useState(rawRules?.title      ?? '📜 Server Rules')
  const [rulesContent,    setRulesContent]    = useState(rawRules?.content    ?? '')
  const [applyingRules,   setApplyingRules]   = useState(false)
  const [rulesResult,     setRulesResult]     = useState<'success' | 'error' | null>(null)
  const [rulesError,      setRulesError]      = useState('')

  const [chRefVisible,  setChRefVisible]  = useState(rawChRef?.enabled ?? false)
  const [chStructure,   setChStructure]   = useState<{ category: string; channels: string[] }[] | null>(rawChRef?.structure ?? null)
  const [creatingCh,    setCreatingCh]    = useState(false)
  const [createChResult, setCreateChResult] = useState<'success' | 'error' | null>(null)
  const [createChError,  setCreateChError]  = useState('')

  // Pulse generation
  const [generatingSection,    setGeneratingSection]    = useState<string | null>(null)
  const [pulseGenError,         setPulseGenError]         = useState<string | null>(null)
  const [pulseGenErrorSection,  setPulseGenErrorSection]  = useState<string | null>(null)

  // Snapshot of last-saved state for dirty tracking. SaveBar uses the diff
  // between this and the current values to render "N unsaved changes" and gate
  // the Save/Reset buttons. Reset restores all editable state from here.
  type Snapshot = {
    welcome: WelcomeConfig
    goodbye: GoodbyeConfig
    autoRole: AutoRoleConfig
    modAlerts: ModerationAlertsConfig
    rulesVisible: boolean; rulesChannel: string; rulesTitle: string; rulesContent: string
    chRefVisible: boolean; chStructure: { category: string; channels: string[] }[] | null
  }
  const buildSnapshot = (): Snapshot => ({
    welcome, goodbye, autoRole, modAlerts,
    rulesVisible, rulesChannel, rulesTitle, rulesContent,
    chRefVisible, chStructure,
  })
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    welcome, goodbye, autoRole, modAlerts,
    rulesVisible, rulesChannel, rulesTitle, rulesContent,
    chRefVisible, chStructure,
  }))

  const current = buildSnapshot()
  const changedCount = useMemo(() => {
    let n = 0
    const keys = Object.keys(snapshot) as (keyof Snapshot)[]
    for (const k of keys) {
      if (JSON.stringify(current[k]) !== JSON.stringify(snapshot[k])) n += 1
    }
    return n
    // current is rebuilt every render; comparison is cheap relative to render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, welcome, goodbye, autoRole, modAlerts,
    rulesVisible, rulesChannel, rulesTitle, rulesContent,
    chRefVisible, chStructure])
  const dirty = changedCount > 0

  function handleReset() {
    setWelcome(snapshot.welcome)
    setGoodbye(snapshot.goodbye)
    setAutoRole(snapshot.autoRole)
    setModAlerts(snapshot.modAlerts)
    setRulesVisible(snapshot.rulesVisible)
    setRulesChannel(snapshot.rulesChannel)
    setRulesTitle(snapshot.rulesTitle)
    setRulesContent(snapshot.rulesContent)
    setChRefVisible(snapshot.chRefVisible)
    setChStructure(snapshot.chStructure)
    setError(null)
  }

  function clearFeedback() { setError(null) }

  // Editing the suggested structure marks it as not-yet-created on Discord.
  function updateStructure(next: { category: string; channels: string[] }[]) {
    setChStructure(next)
    setChRefVisible(false)
    clearFeedback()
  }
  function renameCategory(ci: number, name: string) {
    if (!chStructure) return
    updateStructure(chStructure.map((c, i) => (i === ci ? { ...c, category: name } : c)))
  }
  function deleteCategory(ci: number) {
    if (!chStructure) return
    updateStructure(chStructure.filter((_, i) => i !== ci))
  }
  function addCategory() {
    updateStructure([...(chStructure ?? []), { category: 'new-category', channels: ['new-channel'] }])
  }
  function renameChannel(ci: number, chi: number, name: string) {
    if (!chStructure) return
    updateStructure(chStructure.map((c, i) =>
      i === ci ? { ...c, channels: c.channels.map((ch, j) => (j === chi ? name : ch)) } : c,
    ))
  }
  function deleteChannel(ci: number, chi: number) {
    if (!chStructure) return
    updateStructure(chStructure.map((c, i) =>
      i === ci ? { ...c, channels: c.channels.filter((_, j) => j !== chi) } : c,
    ))
  }
  function addChannel(ci: number) {
    if (!chStructure) return
    updateStructure(chStructure.map((c, i) =>
      i === ci ? { ...c, channels: [...c.channels, 'new-channel'] } : c,
    ))
  }

  function handleSave(): Promise<void> {
    const validationError = validate(welcome, goodbye, autoRole, modAlerts)
    if (validationError) { setError(validationError); return Promise.resolve() }

    return new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await saveAutomations(guildId, {
          welcome,
          goodbye,
          auto_role: autoRole,
          moderation_alerts: modAlerts,
          rules: { enabled: rulesVisible, channel_id: rulesChannel, title: rulesTitle, content: rulesContent },
          channels_reference: chStructure ? { enabled: chRefVisible, structure: chStructure } : undefined,
        })
        if (result.ok) {
          setError(null)
          // Snapshot the just-saved state so "dirty" resets to false and the
          // save bar shows "All changes saved."
          setSnapshot(buildSnapshot())
        } else {
          setError(result.error)
        }
        resolve()
      })
    })
  }

  async function handleRepostRules() {
    setApplyingRules(true)
    setRulesResult(null)
    const res = await applyRules(guildId, rulesChannel, rulesTitle, rulesContent, accentHex)
    setRulesResult(res.ok ? 'success' : 'error')
    if (!res.ok) setRulesError(res.error)
    setApplyingRules(false)
  }

  async function handleRemoveChRef() {
    const res = await removePulseContent(guildId, 'channels_reference')
    if (res.ok) { setChRefVisible(false); setChStructure(null) }
  }

  function getPulsePrefs() {
    try {
      const saved = localStorage.getItem(`pulsify:Pulse-prefs:${guildId}`)
      if (!saved) return null
      return JSON.parse(saved) as {
        description: string; tone: string; customTone: string; language: string; customLanguage: string;
        embedColor: string; serverSize: string; contentDepth: string; includeEmojis: boolean
      }
    } catch { return null }
  }

  async function generateWithPulse(section: string) {
    const prefs = getPulsePrefs()
    if (!prefs?.description?.trim()) {
      setPulseGenError('Add a server description in Automations settings to get started.')
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
        if (section === 'welcome') setWelcome(prev => ({ ...prev, type: 'embed', embed: data.result }))
        else setGoodbye(prev => ({ ...prev, type: 'embed', embed: data.result }))
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
        const data = await res.json() as { result?: GenerationResult; error?: string }
        if (!res.ok) { setPulseGenError(data.error ?? 'Generation failed.'); setPulseGenErrorSection(section); return }
        const result = data.result!
        if (section === 'rules') {
          setRulesContent(result.rules.map((r, i) => `${i + 1}. ${r}`).join('\n'))
          setRulesVisible(true)
        } else if (section === 'channels') {
          setChStructure(result.channels)
          setChRefVisible(false)
        }
      }
    } catch {
      setPulseGenError('Network error. Please try again.')
      setPulseGenErrorSection(section)
    } finally {
      setGeneratingSection(null)
    }
  }

  async function handleCreateChannels() {
    if (!chStructure) return
    setCreatingCh(true)
    setCreateChResult(null)
    const res = await applyChannelsReference(guildId, chStructure)
    if (res.ok) { setCreateChResult('success'); setChRefVisible(true) }
    else { setCreateChResult('error'); setCreateChError(res.error) }
    setCreatingCh(false)
  }

  const isEmbed = welcome.type === 'embed'
  const isGoodbyeEmbed = goodbye.type === 'embed'

  const welcomeCard: CardDef = {
    icon:        <MessageSquare size={16} />,
    iconBg:      'rgba(59,130,246,0.12)',
    iconColor:   '#3b82f6',
    title:       'Welcome Message',
    description: isEmbed
      ? 'Sends an AI-generated embed card when a new member joins.'
      : 'Send a message when a new member joins.',
    enabled:  welcome.enabled,
    onToggle: (v: boolean) => { setWelcome({ ...welcome, enabled: v }); clearFeedback() },
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
    icon:        <LogOut size={16} />,
    iconBg:      'rgba(251,113,133,0.12)',
    iconColor:   '#fb7185',
    title:       'Goodbye Message',
    description: isGoodbyeEmbed
      ? 'Sends an AI-generated embed card when a member leaves.'
      : 'Send a message when a member leaves the server.',
    enabled:  goodbye.enabled,
    onToggle: (v: boolean) => { setGoodbye({ ...goodbye, enabled: v }); clearFeedback() },
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
    icon:        <ShieldCheck size={16} />,
    iconBg:      'rgba(245,158,11,0.12)',
    iconColor:   '#f59e0b',
    title:       'Server Rules',
    description: 'Post an AI-generated rules embed to a channel.',
    enabled:  rulesVisible,
    onToggle: (v: boolean) => { setRulesVisible(v); clearFeedback() },
    extra: rulesVisible && (
      <PulseContentExtra
        section="rules"
        genLabel="rules"
        mono
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

  const autoRoleCard: CardDef = {
    icon:        <Star size={16} />,
    iconBg:      'rgba(16,185,129,0.12)',
    iconColor:   '#10b981',
    title:       'Auto-Role',
    description: 'Automatically assign a role to new members.',
    enabled:  autoRole.enabled,
    onToggle: (v: boolean) => { setAutoRole({ ...autoRole, enabled: v }); clearFeedback() },
    extra: autoRole.enabled && (
      <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Role to assign</label>
        <select
          value={autoRole.role_id}
          onChange={(e) => { setAutoRole({ ...autoRole, role_id: e.target.value }); clearFeedback() }}
          className={selectClass}
        >
          <option value="">Select a role</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
    ),
  }

  const modAlertsCard: CardDef = {
    icon:        <Bell size={16} />,
    iconBg:      'rgba(245,158,11,0.12)',
    iconColor:   '#f59e0b',
    title:       'Moderation Alerts',
    description: 'Get notified when moderation actions occur.',
    enabled:  modAlerts.enabled,
    onToggle: (v: boolean) => { setModAlerts({ ...modAlerts, enabled: v }); clearFeedback() },
    extra: modAlerts.enabled && (
      <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--line-strong)' }}>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Alert Channel</label>
        <select
          value={modAlerts.channel_id}
          onChange={(e) => { setModAlerts({ ...modAlerts, channel_id: e.target.value }); clearFeedback() }}
          className={selectClass}
        >
          <option value="">Select a channel</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>#{c.name}</option>
          ))}
        </select>
      </div>
    ),
  }

  return (
    <div className="space-y-8">
      {/* ── Joining & Welcome ───────────────────────────────────────────── */}
      <CategorySection
        icon={<UserPlus size={14} />}
        title="Joining & Welcome"
        description="Greet new members. For the full guided onboarding experience, see Server › Onboarding."
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <CardItem card={welcomeCard} />
          <CardItem card={goodbyeCard} />
          {/* Rules spans the full row so it doesn't leave an empty half-cell as
              the odd third card — and its expanded embed preview + content
              editor read better at full width. */}
          <div className="lg:col-span-2">
            <CardItem card={rulesCard} />
          </div>
        </div>
      </CategorySection>

      {/* ── Moderation ──────────────────────────────────────────────────── */}
      <CategorySection
        icon={<Shield size={14} />}
        title="Moderation"
        description="Automatic roles and alerts to keep your server in order."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <CardItem card={modAlertsCard} />
          <CardItem card={autoRoleCard} />
        </div>
      </CategorySection>

      {/* ── Server Structure ────────────────────────────────────────────── */}
      <CategorySection
        icon={<FolderTree size={14} />}
        title="Server Structure"
        description="An Pulse suggested category and channel layout for your server."
      >
        {chStructure ? (
          <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}>
                  <LayoutGrid size={16} />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground">Suggested Channels</h2>
                  <p className="text-sm text-subtle">
                    {chRefVisible ? 'Channels created on your server via Pulse.' : 'Rename, add or remove channels, then create them on Discord.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => generateWithPulse('channels')}
                  disabled={generatingSection !== null}
                  className="flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50"
                  style={{ color: 'var(--text-3)' }}
                  onMouseEnter={(e) => { if (!generatingSection) e.currentTarget.style.color = 'var(--text)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                >
                  {generatingSection === 'channels' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Re-generate
                </button>
                <button
                  type="button"
                  onClick={handleRemoveChRef}
                  className="flex items-center gap-1.5 text-xs transition-colors"
                  style={{ color: 'var(--text-3)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                >
                  <Trash2 size={12} /> Remove
                </button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {chStructure.map((cat, ci) => (
                <div key={ci} className="rounded-lg p-3" style={{ background: 'var(--bg-2)' }}>
                  <div className="mb-2 flex items-center gap-1.5">
                    <input
                      value={cat.category}
                      onChange={(e) => renameCategory(ci, e.target.value)}
                      placeholder="category-name"
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-[10px] font-bold uppercase tracking-widest outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--p-1)]"
                      style={{ color: 'var(--text-2)' }}
                    />
                    <button
                      type="button"
                      onClick={() => deleteCategory(ci)}
                      title="Delete category"
                      className="shrink-0 transition-colors"
                      style={{ color: 'var(--text-3)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {cat.channels.map((ch, chi) => (
                      <div key={chi} className="flex items-center gap-1">
                        <span className="text-xs text-subtle">#</span>
                        <input
                          value={ch}
                          onChange={(e) => renameChannel(ci, chi, e.target.value)}
                          placeholder="channel-name"
                          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--p-1)]"
                          style={{ color: 'var(--text-2)' }}
                        />
                        <button
                          type="button"
                          onClick={() => deleteChannel(ci, chi)}
                          title="Delete channel"
                          className="shrink-0 transition-colors"
                          style={{ color: 'var(--text-3)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addChannel(ci)}
                      className="mt-1 flex items-center gap-1 text-[11px] transition-colors"
                      style={{ color: 'var(--text-3)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}
                    >
                      <Plus size={11} /> Add channel
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addCategory}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-xs transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--p-1)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--line-strong)' }}
            >
              <Plus size={12} /> Add category
            </button>

            {!chRefVisible && (
              <div className="mt-4 pt-4 border-t space-y-2" style={{ borderColor: 'var(--line-strong)' }}>
                {createChResult === 'success' && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: '#22c55e' }}>
                    <Check size={12} /> Channels created on Discord.
                  </div>
                )}
                {createChResult === 'error' && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
                    <AlertCircle size={12} /> {createChError}
                  </div>
                )}
                <p className="text-xs text-subtle">Categories and text channels will be created as listed above. Existing channels are not affected.</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleCreateChannels}
                    disabled={creatingCh}
                    className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all disabled:opacity-50"
                    style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
                  >
                    {creatingCh ? <><Loader2 size={11} className="animate-spin" /> Creating…</> : <><Zap size={11} /> Create Channels on Discord</>}
                  </button>
                </div>
              </div>
            )}

            {pulseGenError && pulseGenErrorSection === 'channels' && (
              <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
                <AlertCircle size={12} /> {pulseGenError}
              </div>
            )}
          </div>
        ) : (
          <PulseEmptyState
            icon={<LayoutGrid size={16} />}
            iconBg="rgba(59,130,246,0.12)"
            iconColor="#3b82f6"
            title="Suggested Channels"
            description="Generate a suggested channel structure with Pulse."
            section="channels"
            generatingSection={generatingSection}
            pulseGenError={pulseGenError}
            pulseGenErrorSection={pulseGenErrorSection}
            onGenerate={() => generateWithPulse('channels')}
          />
        )}
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
        saving={isPending}
        saveLabel="Save Automations"
        cleanText="All changes saved. Automations apply through the Pulse bot."
        dirtyHintText="review and save to apply via the Pulse bot."
        confirmTitle="Save automations?"
        confirmDescription="These changes will be applied by the Pulse bot immediately."
        confirmLabel="Save Automations"
        onReset={handleReset}
        onSave={handleSave}
      />
    </div>
  )
}

// ─── CardItem ────────────────────────────────────────────────────────────────

function CardItem({ card }: { card: CardDef }) {
  return (
    <div
      className="rounded-xl border p-5 transition-colors h-full"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
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
  channels: DiscordChannel[]
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
      <div
        className="rounded-lg border p-3 flex items-center justify-between gap-3"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
      >
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
            : <><Sparkles size={11} /> Generate</>
          }
        </button>
      </div>
      {pulseGenError && pulseGenErrorSection === variant && (
        <p className="text-xs" style={{ color: '#f87171' }}>{pulseGenError}</p>
      )}

      {isEmbed && previewEmbed && embed ? (
        <div className="space-y-3">
          <DiscordEmbedPreview
            embed={previewEmbed}
            serverName={guildName}
            footerFallback={variant === 'welcome' ? 'Pulse · Welcome' : 'Pulse · Goodbye'}
          />
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
                Embed Description{' '}
                <span className="text-subtle">({userHint}, {'{server}'} = server name)</span>
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
            Message{' '}
            <span className="text-subtle">({userHint}, {'{server}'} = server name)</span>
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
// Shared body for the Rules and Onboarding cards — Pulse generated content posted
// to a channel as an embed. Mirrors the Welcome/Goodbye card layout.

function PulseContentExtra({
  section, genLabel, mono,
  channels, channelId, onChannelChange,
  title, onTitleChange, content, onContentChange,
  accentHex, generatingSection, onGenerate,
  pulseGenError, pulseGenErrorSection,
  applying, applyResult, applyError, onRepost,
}: {
  section: string
  genLabel: string
  mono: boolean
  channels: DiscordChannel[]
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
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* Left: controls — channel, generation, title/content, post. */}
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Channel</label>
            <select
              value={channelId}
              onChange={(e) => onChannelChange(e.target.value)}
              className={selectClass}
            >
              <option value="">Select a channel</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}</option>
              ))}
            </select>
          </div>

          {/* Pulse generate */}
          <div
            className="rounded-lg border p-3 flex items-center justify-between gap-3"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={12} style={{ color: 'var(--p-1)' }} />
              <p className="text-xs font-medium text-foreground truncate">Generate {genLabel} with Pulse</p>
            </div>
            <button
              type="button"
              onClick={onGenerate}
              disabled={generatingSection !== null}
              className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))' }}
            >
              {generatingSection === section
                ? <><Loader2 size={11} className="animate-spin" /> Generating…</>
                : <><Sparkles size={11} /> Generate</>
              }
            </button>
          </div>
          {pulseGenError && pulseGenErrorSection === section && (
            <p className="text-xs" style={{ color: '#f87171' }}>{pulseGenError}</p>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Embed Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              className={selectClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Edit content</label>
            <textarea
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              rows={8}
              className={selectClass + ' resize-none' + (mono ? ' font-mono' : '')}
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
                : <><Send size={11} /> Post to Discord</>
              }
            </button>
          </div>
        </div>

        {/* Right: live preview. */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Preview</label>
          <AppEmbedPreview
            title={title}
            content={content}
            color={accentHex}
            icon={section === 'rules' ? '/pulse-rules.png' : section === 'onboarding' ? '/pulse-onboarding.png' : undefined}
            footer={section === 'rules' ? 'Pulse · Server Rules' : section === 'onboarding' ? 'Pulse · Onboarding Guide' : undefined}
          />
        </div>
      </div>
    </div>
  )
}

// ─── PulseEmptyState ──────────────────────────────────────────────────────────

function PulseEmptyState({
  icon, iconBg, iconColor, title, description, section,
  generatingSection, pulseGenError, pulseGenErrorSection, onGenerate,
}: {
  icon: ReactNode; iconBg: string; iconColor: string
  title: string; description: string; section: string
  generatingSection: string | null
  pulseGenError: string | null
  pulseGenErrorSection: string | null
  onGenerate: () => void
}) {
  const isGenerating = generatingSection === section
  const hasError = pulseGenError !== null && pulseGenErrorSection === section

  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: iconBg, color: iconColor }}>
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-subtle">{description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generatingSection !== null}
          className="shrink-0 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
        >
          {isGenerating
            ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
            : <><Sparkles size={13} /> Generate</>
          }
        </button>
      </div>
      {hasError && (
        <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
          <AlertCircle size={12} /> {pulseGenError}
        </div>
      )}
    </div>
  )
}

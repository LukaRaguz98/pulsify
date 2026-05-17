'use client'

import { useMemo, useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { usePreferences } from '@/components/ThemeProvider'
import { THEMES } from '@/lib/themes'
import { SectionCard } from '@/components/ui/section-card'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import {
  Check, Moon, Sun, Maximize2, Minimize2, Zap, ZapOff, Palette, Sparkles, Crosshair,
  Server, Type, Aperture,
} from 'lucide-react'

// ─── Echo preferences ─────────────────────────────────────────────────────────

type EchoPrefs = {
  description: string
  tone: string
  customTone: string
  language: string
  customLanguage: string
  embedColor: string
  serverSize: 'small' | 'medium' | 'large'
  contentDepth: 'brief' | 'standard' | 'detailed'
  includeEmojis: boolean
}

const DEFAULT_ECHO_PREFS: EchoPrefs = {
  description: '',
  tone: 'friendly',
  customTone: '',
  language: 'english',
  customLanguage: '',
  embedColor: '#8b5cf6',
  serverSize: 'medium',
  contentDepth: 'standard',
  includeEmojis: true,
}

const ECHO_PREFS_KEY = (guildId: string) => `pulsify:echo-prefs:${guildId}`

const ECHO_TONES = [
  { id: 'friendly',     label: 'Friendly',     emoji: '😊' },
  { id: 'professional', label: 'Professional', emoji: '💼' },
  { id: 'gaming',       label: 'Gaming',       emoji: '🎮' },
  { id: 'community',    label: 'Community',    emoji: '🤝' },
  { id: 'other',        label: 'Other…',       emoji: '✏️' },
]

const ECHO_LANGUAGES = [
  { id: 'english', label: 'English',  flag: '🇬🇧' },
  { id: 'spanish', label: 'Español',  flag: '🇪🇸' },
  { id: 'french',  label: 'Français', flag: '🇫🇷' },
  { id: 'german',  label: 'Deutsch',  flag: '🇩🇪' },
  { id: 'italian', label: 'Italiano', flag: '🇮🇹' },
  { id: 'custom',  label: 'Other…',   flag: '✏️'  },
]

const ECHO_CONTENT_DEPTHS = [
  { id: 'brief'    as const, label: 'Brief',    sub: 'Short & punchy',      icon: '⚡' },
  { id: 'standard' as const, label: 'Standard', sub: 'Balanced',            icon: '✦' },
  { id: 'detailed' as const, label: 'Detailed', sub: 'Thorough & complete', icon: '📖' },
]

const ECHO_SERVER_SIZES = [
  { id: 'small'  as const, label: 'Cozy',     sub: '< 100',  icon: '🌱' },
  { id: 'medium' as const, label: 'Growing',  sub: '100–1k', icon: '🌿' },
  { id: 'large'  as const, label: 'Thriving', sub: '1k+',    icon: '🌳' },
]


// ─── Subtabs ──────────────────────────────────────────────────────────────────

type TabId = 'appearance' | 'echo'

const TABS: { id: TabId; label: string; description: string; icon: typeof Palette }[] = [
  {
    id: 'appearance',
    label: 'App Design',
    description: 'Customise the look and feel of your Pulsify dashboard.',
    icon: Palette,
  },
  {
    id: 'echo',
    label: 'Echo Assistant',
    description: 'Configure what Echo knows about your server when generating content.',
    icon: Sparkles,
  },
]

// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    theme, scheme, density, animations, cornerDeco, themeCustomColor, fontSize, ambientGlow,
    setTheme, setScheme, setDensity, setAnimations, setCornerDeco, setThemeCustomColor,
    setFontSize, setAmbientGlow,
  } = usePreferences()

  const params = useParams()
  const guildId = params.guildId as string

  const [activeTab, setActiveTab] = useState<TabId>('appearance')
  const [echoPrefs, setEchoPrefs] = useState<EchoPrefs>(DEFAULT_ECHO_PREFS)

  // ── App Design snapshot ─────────────────────────────────────────────────
  // App prefs persist live via ThemeProvider, but we still track a snapshot
  // so Reset can undo a session of theme tweaks and Save can clear the dirty
  // indicator. Captured once on first render and re-captured after Save.
  type AppPrefs = {
    theme: typeof theme; scheme: typeof scheme; density: typeof density
    animations: boolean; cornerDeco: boolean
    themeCustomColor: string | null
    fontSize: typeof fontSize; ambientGlow: boolean
  }
  const [appSnapshot, setAppSnapshot] = useState<AppPrefs>(() => ({
    theme, scheme, density, animations, cornerDeco, themeCustomColor, fontSize, ambientGlow,
  }))
  const appCurrent: AppPrefs = { theme, scheme, density, animations, cornerDeco, themeCustomColor, fontSize, ambientGlow }
  const appChangedCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(appSnapshot) as (keyof AppPrefs)[]) {
      if (appSnapshot[k] !== appCurrent[k]) n += 1
    }
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSnapshot, theme, scheme, density, animations, cornerDeco, themeCustomColor, fontSize, ambientGlow])
  const appDirty = appChangedCount > 0

  function handleResetAppPrefs() {
    setTheme(appSnapshot.theme)
    setScheme(appSnapshot.scheme)
    setDensity(appSnapshot.density)
    setAnimations(appSnapshot.animations)
    setCornerDeco(appSnapshot.cornerDeco)
    setThemeCustomColor(appSnapshot.themeCustomColor)
    setFontSize(appSnapshot.fontSize)
    setAmbientGlow(appSnapshot.ambientGlow)
  }

  function handleSaveAppPrefs() {
    // Preferences are already persisted live via ThemeProvider — Save just
    // commits the current values as the new baseline so the dirty indicator
    // clears and Reset starts comparing from here on.
    setAppSnapshot(appCurrent)
  }

  // ── Echo snapshot ──────────────────────────────────────────────────────
  const [echoSnapshot, setEchoSnapshot] = useState<EchoPrefs>(DEFAULT_ECHO_PREFS)
  const echoChangedCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(echoSnapshot) as (keyof EchoPrefs)[]) {
      if (echoSnapshot[k] !== echoPrefs[k]) n += 1
    }
    return n
  }, [echoSnapshot, echoPrefs])
  const echoDirty = echoChangedCount > 0

  function updatePref<K extends keyof EchoPrefs>(key: K, value: EchoPrefs[K]) {
    setEchoPrefs(prev => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    if (!guildId) return
    try {
      const saved = localStorage.getItem(ECHO_PREFS_KEY(guildId))
      if (saved) {
        const parsed = { ...DEFAULT_ECHO_PREFS, ...JSON.parse(saved) as EchoPrefs }
        setEchoPrefs(parsed)
        setEchoSnapshot(parsed)
      }
    } catch {}
  }, [guildId])

  function handleResetEchoPrefs() {
    setEchoPrefs(echoSnapshot)
  }

  function handleSaveEchoPrefs() {
    if (!guildId) return
    try {
      localStorage.setItem(ECHO_PREFS_KEY(guildId), JSON.stringify(echoPrefs))
      setEchoSnapshot(echoPrefs)
    } catch {}
  }

  const activeMeta = TABS.find((t) => t.id === activeTab)!

  return (
    <div className="page-content max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Preferences</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{activeMeta.description}</p>
      </div>

      {/* Subtab switcher */}
      <div
        className="mb-6 inline-flex w-full gap-1 rounded-xl border p-1 sm:w-auto"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 sm:flex-initial"
              style={{
                background: active ? 'var(--panel)' : 'transparent',
                color: active ? 'var(--p-1)' : 'var(--text-3)',
                boxShadow: active ? '0 1px 4px -1px rgba(0,0,0,0.3), 0 0 0 1px var(--line-strong)' : 'none',
              }}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ─── App Design tab ─────────────────────────────────────────────────── */}
      {activeTab === 'appearance' && (
        <div className="space-y-8">
          {/* ── Appearance ───────────────────────────────────────────────── */}
          <CategorySection
            icon={<Palette size={14} />}
            title="Appearance"
            description="Colour scheme, accent colour and layout density."
          >
          {/* Color Scheme — full-width on its own row so the two scheme
              buttons read clearly. */}
          <SectionCard title="Color Scheme" description="Switch between dark and light mode.">
            <div className="grid grid-cols-2 gap-3">
              {([
                { id: 'dark'  as const, label: 'Dark',  description: 'Easy on the eyes',  icon: <Moon size={18} /> },
                { id: 'light' as const, label: 'Light', description: 'Bright and clear',  icon: <Sun  size={18} /> },
              ] as const).map((option) => {
                const active = scheme === option.id
                return (
                  <button
                    key={option.id}
                    onClick={() => setScheme(option.id)}
                    className="relative flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-150"
                    style={{
                      background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                      borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                      boxShadow: active ? '0 0 0 1px var(--p-soft)' : 'none',
                    }}
                  >
                    <span style={{ color: active ? 'var(--p-1)' : 'var(--text-3)' }}>{option.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{option.label}</p>
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>{option.description}</p>
                    </div>
                    {active && (
                      <span className="absolute top-2.5 right-2.5 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: 'var(--p-1)' }}>
                        <Check size={9} strokeWidth={3} color="white" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </SectionCard>

          {/* Accent Colour — full-width below Color Scheme. Wider card lets
              the 7 presets + Custom sit in a single row with breathing space. */}
          <SectionCard title="Accent Colour" description="Choose an accent colour for the interface.">
            {/* Hex badge mirrors the Echo Assistant > Embed Color row.
                Reflects custom override if set, otherwise the active preset. */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-foreground">Accent Color</p>
              <span
                className="font-mono text-xs rounded px-1.5 py-0.5"
                style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
              >
                {themeCustomColor ?? THEMES.find((t) => t.id === theme)?.accent ?? '#8b5cf6'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
              {THEMES.map((t) => {
                // Preset is "active" only when no custom override is set,
                // otherwise the Custom swatch owns the active state.
                const active = !themeCustomColor && theme === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    title={t.name}
                    className="group relative flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150"
                    style={{
                      background: active ? `${t.accent}14` : 'var(--bg-2)',
                      borderColor: active ? t.accent : 'var(--line-strong)',
                      boxShadow: active ? `0 0 0 1px ${t.accent}40` : 'none',
                    }}
                  >
                    <div
                      className="h-8 w-8 rounded-full"
                      style={{
                        background: `linear-gradient(135deg, ${t.accent}cc, ${t.accent})`,
                        boxShadow: active ? `0 4px 12px -4px ${t.accent}80` : `0 2px 6px -4px ${t.accent}60`,
                      }}
                    />
                    {active && (
                      <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: t.accent }}>
                        <Check size={9} strokeWidth={3} color="white" />
                      </span>
                    )}
                    <p className="text-xs font-medium text-foreground leading-none">{t.name}</p>
                  </button>
                )
              })}

              {/* Custom — native color input behind a label, active when the
                  user has set a hex that's outside the preset palette. */}
              {(() => {
                const customActive = themeCustomColor !== null
                const display = themeCustomColor ?? '#8b5cf6'
                return (
                  <label
                    title="Custom color"
                    aria-label="Pick a custom accent color"
                    className="group relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150"
                    style={{
                      background: customActive ? `${display}14` : 'var(--bg-2)',
                      borderColor: customActive ? display : 'var(--line-strong)',
                      boxShadow: customActive ? `0 0 0 1px ${display}40` : 'none',
                    }}
                  >
                    <div
                      className="h-8 w-8 rounded-full"
                      style={{
                        background: customActive
                          ? `linear-gradient(135deg, ${display}cc, ${display})`
                          : 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #ec4899, #f43f5e)',
                        boxShadow: customActive
                          ? `0 4px 12px -4px ${display}80`
                          : '0 2px 6px -4px rgba(255,255,255,0.15)',
                      }}
                    />
                    {customActive && (
                      <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: display }}>
                        <Check size={9} strokeWidth={3} color="white" />
                      </span>
                    )}
                    <p className="text-xs font-medium text-foreground leading-none">Custom</p>
                    <input
                      type="color"
                      value={display}
                      onChange={(e) => setThemeCustomColor(e.target.value)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                )
              })()}
            </div>
            <div className="mt-5 rounded-lg border p-3 flex items-center gap-3" style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}>
              <div className="h-6 w-6 rounded-md shrink-0" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }} />
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--line-strong)' }}>
                <div className="h-2 rounded-full w-2/3" style={{ background: 'linear-gradient(90deg, var(--p-1), var(--p-2))', opacity: 0.7 }} />
              </div>
              <div className="h-6 px-3 rounded-md text-xs font-semibold text-white flex items-center shrink-0" style={{ background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }}>
                Preview
              </div>
            </div>
          </SectionCard>

          {/* Row — Layout Density + Font Size. Paired because they're both
              size/spacing controls. */}
          <div className="grid gap-4 md:grid-cols-2 items-start">
            <SectionCard title="Layout Density" description="Spacing and padding throughout the app.">
              <div className="grid grid-cols-2 gap-2.5">
                {([
                  { id: 'comfortable' as const, label: 'Comfortable', icon: <Maximize2 size={18} /> },
                  { id: 'compact'     as const, label: 'Compact',     icon: <Minimize2 size={18} /> },
                ] as const).map((option) => {
                  const active = density === option.id
                  return (
                    <button
                      key={option.id}
                      onClick={() => setDensity(option.id)}
                      className="relative flex flex-col items-center justify-center gap-2 rounded-xl border px-3 py-5 text-center transition-all duration-150"
                      style={{
                        background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                        borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                        boxShadow: active ? '0 0 0 1px var(--p-soft)' : 'none',
                      }}
                    >
                      <span style={{ color: active ? 'var(--p-1)' : 'var(--text-3)' }}>{option.icon}</span>
                      <p className="text-sm font-semibold text-foreground">{option.label}</p>
                      {active && (
                        <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: 'var(--p-1)' }}>
                          <Check size={9} strokeWidth={3} color="white" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </SectionCard>

            {/* Font Size scales the root font-size; live preview "Aa" shows
                each option at its actual rendered size. */}
            <SectionCard title="Font Size" description="Scale the entire interface up or down.">
              <div className="grid grid-cols-3 gap-2.5">
                {([
                  { id: 'small'  as const, label: 'Small',  preview: '14px' },
                  { id: 'medium' as const, label: 'Medium', preview: '16px' },
                  { id: 'large'  as const, label: 'Large',  preview: '18px' },
                ] as const).map((option) => {
                  const active = fontSize === option.id
                  const sampleSize = option.id === 'small' ? 16 : option.id === 'medium' ? 20 : 24
                  return (
                    <button
                      key={option.id}
                      onClick={() => setFontSize(option.id)}
                      className="relative flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-4 text-center transition-all duration-150"
                      style={{
                        background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                        borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                        boxShadow: active ? '0 0 0 1px var(--p-soft)' : 'none',
                      }}
                    >
                      <span
                        className="font-bold leading-none"
                        style={{ fontSize: sampleSize, color: active ? 'var(--p-1)' : 'var(--text-2)' }}
                      >
                        Aa
                      </span>
                      <p className="text-xs font-semibold text-foreground">{option.label}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{option.preview}</p>
                      {active && (
                        <span className="absolute top-1.5 right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ background: 'var(--p-1)' }}>
                          <Check size={8} strokeWidth={3} color="white" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </SectionCard>
          </div>

          </CategorySection>

          {/* ── Behaviour ────────────────────────────────────────────────── */}
          <CategorySection
            icon={<Zap size={14} />}
            title="Behaviour"
            description="Motion effects and activity notifications."
          >
          {/* Animations & Effects */}
          <SectionCard title="Animations & Effects" description="Control motion and decorative visual elements.">
            <div>
              {/* Row 1 — UI animations */}
              <div
                className="flex items-center justify-between pb-4 border-b"
                style={{ borderColor: 'var(--line-strong)' }}
              >
                <div className="flex items-center gap-3">
                  <span style={{ color: animations ? 'var(--p-1)' : 'var(--text-3)' }}>
                    {animations ? <Zap size={18} /> : <ZapOff size={18} />}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">UI Animations</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {animations ? 'Hover effects and transitions active' : 'Motion reduced for accessibility'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setAnimations(!animations)}
                  className="relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200"
                  style={{ background: animations ? 'var(--p-1)' : 'var(--line-strong)' }}
                  aria-checked={animations}
                  role="switch"
                >
                  <span
                    className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                    style={{ transform: animations ? 'translateX(20px)' : 'translateX(0)' }}
                  />
                </button>
              </div>

              {/* Row 2 — Corner decorations */}
              <div
                className="flex items-center justify-between py-4 border-b"
                style={{ borderColor: 'var(--line-strong)' }}
              >
                <div className="flex items-center gap-3">
                  <span style={{ color: cornerDeco ? 'var(--p-1)' : 'var(--text-3)' }}>
                    <Crosshair size={18} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Corner Decorations</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {cornerDeco ? 'Animated HUD lines visible in dashboard corners' : 'Corner decorations hidden'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setCornerDeco(!cornerDeco)}
                  className="relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200"
                  style={{ background: cornerDeco ? 'var(--p-1)' : 'var(--line-strong)' }}
                  aria-checked={cornerDeco}
                  role="switch"
                >
                  <span
                    className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                    style={{ transform: cornerDeco ? 'translateX(20px)' : 'translateX(0)' }}
                  />
                </button>
              </div>

              {/* Row 3 — Background glow (new). Toggles the radial gradient
                  baked into body::before via the --glow-opacity var. */}
              <div className="flex items-center justify-between pt-4">
                <div className="flex items-center gap-3">
                  <span style={{ color: ambientGlow ? 'var(--p-1)' : 'var(--text-3)' }}>
                    <Aperture size={18} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Background Glow</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      {ambientGlow ? 'Soft accent-tinted glow in the page background' : 'Background glow hidden — flat backdrop'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setAmbientGlow(!ambientGlow)}
                  className="relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200"
                  style={{ background: ambientGlow ? 'var(--p-1)' : 'var(--line-strong)' }}
                  aria-checked={ambientGlow}
                  role="switch"
                >
                  <span
                    className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                    style={{ transform: ambientGlow ? 'translateX(20px)' : 'translateX(0)' }}
                  />
                </button>
              </div>
            </div>
          </SectionCard>

          {/* Notifications */}
          <SectionCard
            title="Notifications"
            description="Manage how Pulsify notifies you about server activity."
            footer={<p className="text-xs" style={{ color: 'var(--text-3)' }}>Push notification support is coming soon. Stay tuned for updates.</p>}
          >
            <div className="space-y-3">
              {[
                { label: 'Server alerts',      description: 'Critical events like raids or mass bans' },
                { label: 'Moderation actions', description: 'Bans, kicks, and warning summaries' },
                { label: 'Weekly digest',      description: 'Server health and activity summary' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-lg p-3" style={{ background: 'var(--bg-2)' }}>
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>{item.description}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: 'var(--bg)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}>
                    Soon
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
          </CategorySection>

          <SaveBar
            dirty={appDirty}
            changedCount={appChangedCount}
            saveLabel="Save Preferences"
            cleanText="All preferences saved. Changes preview live as you edit."
            dirtyHintText="review and save to keep these preferences."
            confirmTitle="Save preferences?"
            confirmDescription="Your dashboard preferences will be kept across sessions."
            confirmLabel="Save Preferences"
            onReset={handleResetAppPrefs}
            onSave={handleSaveAppPrefs}
          />
        </div>
      )}

      {/* ─── Echo Assistant tab ─────────────────────────────────────────────── */}
      {activeTab === 'echo' && (
        <div className="space-y-8">
          {/* ── Server Context ───────────────────────────────────────────── */}
          <CategorySection
            icon={<Server size={14} />}
            title="Server Context"
            description="What Echo knows about your server when generating content."
          >
          {/* Server Profile */}
          <SectionCard
            title="Server Profile"
            description="Tell Echo what your server is about. Used as context for every generation."
          >
            <textarea
              value={echoPrefs.description}
              onChange={(e) => updatePref('description', e.target.value)}
              rows={3}
              placeholder="e.g. A competitive gaming community focused on Valorant and CS2. We host weekly tournaments and welcome players of all skill levels."
              className="w-full rounded-lg border px-3.5 py-2.5 text-sm resize-none outline-none transition-colors placeholder:text-subtle"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--p-1)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
            />
          </SectionCard>
          </CategorySection>

          {/* ── Writing Style ────────────────────────────────────────────── */}
          <CategorySection
            icon={<Type size={14} />}
            title="Writing Style"
            description="Tone, language and how much detail Echo produces."
          >
          {/* Voice & Language */}
          <SectionCard
            title="Voice & Language"
            description="Set the tone and language Echo writes in."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-semibold text-foreground mb-2">Tone & Style</p>
                <div className="flex flex-wrap gap-1.5">
                  {ECHO_TONES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => updatePref('tone', t.id)}
                      className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all"
                      style={{
                        borderColor: echoPrefs.tone === t.id ? 'var(--p-1)' : 'var(--line-strong)',
                        background:  echoPrefs.tone === t.id ? 'var(--p-soft)' : 'var(--bg-2)',
                        color:       echoPrefs.tone === t.id ? 'var(--p-1)' : 'var(--text-2)',
                      }}
                    >
                      <span>{t.emoji}</span>{t.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={echoPrefs.customTone}
                  onChange={(e) => updatePref('customTone', e.target.value)}
                  placeholder="e.g. Anime, Chill, Corporate…"
                  disabled={echoPrefs.tone !== 'other'}
                  className="mt-2 w-full rounded-lg border px-3 py-1.5 text-xs outline-none transition-all"
                  style={{
                    background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)',
                    opacity: echoPrefs.tone === 'other' ? 1 : 0.35,
                    cursor:  echoPrefs.tone === 'other' ? 'text' : 'not-allowed',
                  }}
                  onFocus={(e) => { if (echoPrefs.tone === 'other') e.currentTarget.style.borderColor = 'var(--p-1)' }}
                  onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
                />
              </div>

              <div>
                <p className="text-sm font-semibold text-foreground mb-2">Language</p>
                <div className="flex flex-wrap gap-1.5">
                  {ECHO_LANGUAGES.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => updatePref('language', l.id)}
                      className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all"
                      style={{
                        borderColor: echoPrefs.language === l.id ? 'var(--p-1)' : 'var(--line-strong)',
                        background:  echoPrefs.language === l.id ? 'var(--p-soft)' : 'var(--bg-2)',
                        color:       echoPrefs.language === l.id ? 'var(--p-1)' : 'var(--text-2)',
                      }}
                    >
                      <span>{l.flag}</span>{l.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 space-y-1">
                  <input
                    type="text"
                    value={echoPrefs.customLanguage}
                    onChange={(e) => updatePref('customLanguage', e.target.value)}
                    placeholder="e.g. Croatian, Korean…"
                    disabled={echoPrefs.language !== 'custom'}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs outline-none transition-all"
                    style={{
                      background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)',
                      opacity: echoPrefs.language === 'custom' ? 1 : 0.35,
                      cursor:  echoPrefs.language === 'custom' ? 'text' : 'not-allowed',
                    }}
                    onFocus={(e) => { if (echoPrefs.language === 'custom') e.currentTarget.style.borderColor = 'var(--p-1)' }}
                    onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
                  />
                  {echoPrefs.language === 'custom' && (
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                      Results in less common languages may be inconsistent — review before applying.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Generation Style */}
          <SectionCard
            title="Generation Style"
            description="Tune how much detail Echo produces and who it's writing for."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-semibold text-foreground mb-2">Content Depth</p>
                <div className="grid grid-cols-3 gap-2">
                  {ECHO_CONTENT_DEPTHS.map((d) => {
                    const active = echoPrefs.contentDepth === d.id
                    return (
                      <button
                        key={d.id}
                        onClick={() => updatePref('contentDepth', d.id)}
                        className="relative flex flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition-all duration-150"
                        style={{
                          background:  active ? 'var(--p-soft)' : 'var(--bg-2)',
                          borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                        }}
                      >
                        <span className="text-lg leading-none">{d.icon}</span>
                        <span className="text-xs font-semibold text-foreground">{d.label}</span>
                        <span className="text-[10px] text-foreground opacity-60">{d.sub}</span>
                        {active && (
                          <span className="absolute top-1.5 right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ background: 'var(--p-1)' }}>
                            <Check size={8} strokeWidth={3} color="white" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-foreground mb-2">Server Size</p>
                <div className="grid grid-cols-3 gap-2">
                  {ECHO_SERVER_SIZES.map((s) => {
                    const active = echoPrefs.serverSize === s.id
                    return (
                      <button
                        key={s.id}
                        onClick={() => updatePref('serverSize', s.id)}
                        className="relative flex flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition-all duration-150"
                        style={{
                          background:  active ? 'var(--p-soft)' : 'var(--bg-2)',
                          borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                        }}
                      >
                        <span className="text-lg leading-none">{s.icon}</span>
                        <span className="text-xs font-semibold text-foreground">{s.label}</span>
                        <span className="text-[10px] text-foreground opacity-60">{s.sub}</span>
                        {active && (
                          <span className="absolute top-1.5 right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ background: 'var(--p-1)' }}>
                            <Check size={8} strokeWidth={3} color="white" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Emojis */}
            <div
              className="mt-4 flex items-center justify-between rounded-xl border p-4"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
            >
              <div>
                <p className="text-sm font-semibold text-foreground">Emojis in Generated Content</p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
                  {echoPrefs.includeEmojis
                    ? 'Emojis will be added throughout generated content'
                    : 'Generated content will use plain text only'}
                </p>
              </div>
              <button
                onClick={() => updatePref('includeEmojis', !echoPrefs.includeEmojis)}
                className="relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200"
                style={{ background: echoPrefs.includeEmojis ? 'var(--p-1)' : 'var(--line-strong)' }}
                aria-checked={echoPrefs.includeEmojis}
                role="switch"
              >
                <span
                  className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                  style={{ transform: echoPrefs.includeEmojis ? 'translateX(20px)' : 'translateX(0)' }}
                />
              </button>
            </div>
          </SectionCard>
          </CategorySection>

          {/* ── Discord Output ───────────────────────────────────────────── */}
          <CategorySection
            icon={<Palette size={14} />}
            title="Discord Output"
            description="How Echo's embeds appear when posted to Discord."
          >
          {/* Embed Appearance */}
          <SectionCard
            title="Embed Appearance"
            description="The accent colour applied to embeds Echo posts to Discord."
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-foreground">Embed Color</p>
              <span className="font-mono text-xs rounded px-1.5 py-0.5" style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}>
                {echoPrefs.embedColor}
              </span>
            </div>
            {/* Identical layout to App Design › Accent Colour so the two pickers
                feel like one component. THEMES is the shared palette source. */}
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
              {THEMES.map((t) => {
                const active = echoPrefs.embedColor.toLowerCase() === t.accent.toLowerCase()
                return (
                  <button
                    key={t.id}
                    onClick={() => updatePref('embedColor', t.accent)}
                    title={t.name}
                    className="group relative flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150"
                    style={{
                      background: active ? `${t.accent}14` : 'var(--bg-2)',
                      borderColor: active ? t.accent : 'var(--line-strong)',
                      boxShadow: active ? `0 0 0 1px ${t.accent}40` : 'none',
                    }}
                  >
                    <div
                      className="h-8 w-8 rounded-full"
                      style={{
                        background: `linear-gradient(135deg, ${t.accent}cc, ${t.accent})`,
                        boxShadow: active ? `0 4px 12px -4px ${t.accent}80` : `0 2px 6px -4px ${t.accent}60`,
                      }}
                    />
                    {active && (
                      <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: t.accent }}>
                        <Check size={9} strokeWidth={3} color="white" />
                      </span>
                    )}
                    <p className="text-xs font-medium text-foreground leading-none">{t.name}</p>
                  </button>
                )
              })}

              {/* Custom — active when the current embed color is outside the
                  THEMES palette. Mirrors the App Design custom card. */}
              {(() => {
                const presetHits = THEMES.some(
                  (t) => t.accent.toLowerCase() === echoPrefs.embedColor.toLowerCase(),
                )
                const customActive = !presetHits
                const display = echoPrefs.embedColor
                return (
                  <label
                    title="Custom color"
                    aria-label="Pick a custom embed color"
                    className="group relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all duration-150"
                    style={{
                      background: customActive ? `${display}14` : 'var(--bg-2)',
                      borderColor: customActive ? display : 'var(--line-strong)',
                      boxShadow: customActive ? `0 0 0 1px ${display}40` : 'none',
                    }}
                  >
                    <div
                      className="h-8 w-8 rounded-full"
                      style={{
                        background: customActive
                          ? `linear-gradient(135deg, ${display}cc, ${display})`
                          : 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #ec4899, #f43f5e)',
                        boxShadow: customActive
                          ? `0 4px 12px -4px ${display}80`
                          : '0 2px 6px -4px rgba(255,255,255,0.15)',
                      }}
                    />
                    {customActive && (
                      <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: display }}>
                        <Check size={9} strokeWidth={3} color="white" />
                      </span>
                    )}
                    <p className="text-xs font-medium text-foreground leading-none">Custom</p>
                    <input
                      type="color"
                      value={display}
                      onChange={(e) => updatePref('embedColor', e.target.value)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                )
              })()}
            </div>
          </SectionCard>
          </CategorySection>

          <SaveBar
            dirty={echoDirty}
            changedCount={echoChangedCount}
            saveLabel="Save Preferences"
            cleanText="All Echo preferences saved."
            dirtyHintText="review and save to keep these preferences."
            confirmTitle="Save Echo preferences?"
            confirmDescription="Echo will use these settings for every generation in this server."
            confirmLabel="Save Preferences"
            onReset={handleResetEchoPrefs}
            onSave={handleSaveEchoPrefs}
          />
        </div>
      )}
    </div>
  )
}

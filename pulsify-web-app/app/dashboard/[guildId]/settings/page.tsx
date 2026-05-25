'use client'

import { useMemo, useState } from 'react'
import { usePreferences } from '@/components/ThemeProvider'
import { THEMES } from '@/lib/themes'
import { SectionCard } from '@/components/ui/section-card'
import { CategorySection } from '@/components/ui/category-section'
import { highlightBrand } from '@/components/ui/brand-text'
import { SaveBar } from '@/components/ui/save-bar'
import { RestartOnboardingCard } from '@/components/dashboard/onboarding/RestartOnboardingCard'
import {
  Check, Moon, Sun, Maximize2, Minimize2, Zap, ZapOff, Palette, Crosshair,
  Aperture, Gauge,
} from 'lucide-react'

// Preferences = dashboard look & feel only. Notification settings moved to their
// own page (`/notification-settings`), reached from the bell dropdown's gear.
// Feature settings live with their features (Pulse Guard → /ai-moderation-settings,
// Pulse assistant → /automations-settings, Tickets → /ticket-settings).

export default function SettingsPage() {
  const {
    theme, scheme, density, animations, cornerDeco, themeCustomColor, fontSize, ambientGlow, pingIndicator,
    setTheme, setScheme, setDensity, setAnimations, setCornerDeco, setThemeCustomColor,
    setFontSize, setAmbientGlow, setPingIndicator,
  } = usePreferences()

  // ── App Design snapshot ─────────────────────────────────────────────────
  // App prefs persist live via ThemeProvider, but we still track a snapshot
  // so Reset can undo a session of theme tweaks and Save can clear the dirty
  // indicator. Captured once on first render and re-captured after Save.
  type AppPrefs = {
    theme: typeof theme; scheme: typeof scheme; density: typeof density
    animations: boolean; cornerDeco: boolean
    themeCustomColor: string | null
    fontSize: typeof fontSize; ambientGlow: boolean; pingIndicator: boolean
  }
  const [appSnapshot, setAppSnapshot] = useState<AppPrefs>(() => ({
    theme, scheme, density, animations, cornerDeco, themeCustomColor, fontSize, ambientGlow, pingIndicator,
  }))
  const appCurrent: AppPrefs = { theme, scheme, density, animations, cornerDeco, themeCustomColor, fontSize, ambientGlow, pingIndicator }
  const appChangedCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(appSnapshot) as (keyof AppPrefs)[]) {
      if (appSnapshot[k] !== appCurrent[k]) n += 1
    }
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSnapshot, theme, scheme, density, animations, cornerDeco, themeCustomColor, fontSize, ambientGlow, pingIndicator])
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
    setPingIndicator(appSnapshot.pingIndicator)
  }

  function handleSaveAppPrefs() {
    // Preferences are already persisted live via ThemeProvider — Save just
    // commits the current values as the new baseline so the dirty indicator
    // clears and Reset starts comparing from here on.
    setAppSnapshot(appCurrent)
  }

  return (
    <div className="page-content max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Preferences</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{highlightBrand('Customise the look and feel of your Pulsify dashboard.')}</p>
      </div>

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
          {/* Hex badge mirrors the Pulse Assistant > Embed Color row.
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
          description="Dashboard interactions, motion, and live indicators."
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

            {/* Row 3 — Background glow. Toggles the radial gradient baked
                into body::before via the --glow-opacity var. */}
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

        {/* Status indicators — not motion/decoration, so they live in their
            own card rather than inside Animations & Effects. */}
        <SectionCard title="Status Indicators" description="Live system signals shown in the dashboard chrome.">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span style={{ color: pingIndicator ? 'var(--p-1)' : 'var(--text-3)' }}>
                <Gauge size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Ping Indicator</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {pingIndicator
                    ? 'Live Discord latency chip in the bottom-right corner'
                    : 'Latency chip hidden — no polling happens'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setPingIndicator(!pingIndicator)}
              className="relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200"
              style={{ background: pingIndicator ? 'var(--p-1)' : 'var(--line-strong)' }}
              aria-checked={pingIndicator}
              role="switch"
            >
              <span
                className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: pingIndicator ? 'translateX(20px)' : 'translateX(0)' }}
              />
            </button>
          </div>
        </SectionCard>

        </CategorySection>

        <RestartOnboardingCard />

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
    </div>
  )
}

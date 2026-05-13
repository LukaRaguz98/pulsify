'use client'

import { usePreferences } from '@/components/ThemeProvider'
import { THEMES } from '@/lib/themes'
import { SectionCard } from '@/components/ui/section-card'
import { Check, Moon, Sun, Maximize2, Minimize2, Zap, ZapOff } from 'lucide-react'

export default function SettingsPage() {
  const {
    theme,
    scheme,
    density,
    animations,
    setTheme,
    setScheme,
    setDensity,
    setAnimations,
  } = usePreferences()

  return (
    <div className="page-content max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Preferences</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Customise the look and feel of your Pulsify dashboard.
        </p>
      </div>

      <div className="space-y-5">
        {/* Color Scheme */}
        <SectionCard
          title="Color Scheme"
          description="Switch between dark and light mode."
        >
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { id: 'dark' as const, label: 'Dark', description: 'Easy on the eyes', icon: <Moon size={18} /> },
                { id: 'light' as const, label: 'Light', description: 'Bright and clear', icon: <Sun size={18} /> },
              ] as const
            ).map((option) => {
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
                  <span style={{ color: active ? 'var(--p-1)' : 'var(--text-3)' }}>
                    {option.icon}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{option.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>{option.description}</p>
                  </div>
                  {active && (
                    <span
                      className="absolute top-2.5 right-2.5 flex h-4 w-4 items-center justify-center rounded-full"
                      style={{ background: 'var(--p-1)' }}
                    >
                      <Check size={9} strokeWidth={3} color="white" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </SectionCard>

        {/* Accent Color */}
        <SectionCard
          title="Accent Colour"
          description="Choose an accent colour for the interface. Saved locally."
        >
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {THEMES.map((t) => {
              const active = theme === t.id
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
                    className="h-8 w-8 rounded-lg"
                    style={{
                      background: `linear-gradient(135deg, ${t.accent}cc, ${t.accent})`,
                      boxShadow: active ? `0 4px 12px -4px ${t.accent}80` : `0 2px 6px -4px ${t.accent}60`,
                    }}
                  />
                  {active && (
                    <span
                      className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full"
                      style={{ background: t.accent }}
                    >
                      <Check size={9} strokeWidth={3} color="white" />
                    </span>
                  )}
                  <p className="text-xs font-medium text-foreground leading-none">{t.name}</p>
                </button>
              )
            })}
          </div>

          {/* Live preview bar */}
          <div
            className="mt-5 rounded-lg border p-3 flex items-center gap-3"
            style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
          >
            <div
              className="h-6 w-6 rounded-md shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            />
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--line-strong)' }}>
              <div
                className="h-2 rounded-full w-2/3"
                style={{ background: 'linear-gradient(90deg, var(--p-1), var(--p-2))', opacity: 0.7 }}
              />
            </div>
            <div
              className="h-6 px-3 rounded-md text-xs font-semibold text-white flex items-center shrink-0"
              style={{ background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }}
            >
              Preview
            </div>
          </div>
        </SectionCard>

        {/* Layout Density */}
        <SectionCard
          title="Layout Density"
          description="Control the spacing and padding of the dashboard."
        >
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                {
                  id: 'comfortable' as const,
                  label: 'Comfortable',
                  description: 'More breathing room',
                  icon: <Maximize2 size={18} />,
                },
                {
                  id: 'compact' as const,
                  label: 'Compact',
                  description: 'More content on screen',
                  icon: <Minimize2 size={18} />,
                },
              ] as const
            ).map((option) => {
              const active = density === option.id
              return (
                <button
                  key={option.id}
                  onClick={() => setDensity(option.id)}
                  className="relative flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-150"
                  style={{
                    background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                    borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                    boxShadow: active ? '0 0 0 1px var(--p-soft)' : 'none',
                  }}
                >
                  <span style={{ color: active ? 'var(--p-1)' : 'var(--text-3)' }}>
                    {option.icon}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{option.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>{option.description}</p>
                  </div>
                  {active && (
                    <span
                      className="absolute top-2.5 right-2.5 flex h-4 w-4 items-center justify-center rounded-full"
                      style={{ background: 'var(--p-1)' }}
                    >
                      <Check size={9} strokeWidth={3} color="white" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </SectionCard>

        {/* Animations */}
        <SectionCard
          title="Animations & Transitions"
          description="Enable or disable motion effects across the dashboard."
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span style={{ color: animations ? 'var(--p-1)' : 'var(--text-3)' }}>
                {animations ? <Zap size={18} /> : <ZapOff size={18} />}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {animations ? 'Animations enabled' : 'Animations disabled'}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {animations ? 'Hover effects, transitions and motion are active' : 'All motion reduced for accessibility'}
                </p>
              </div>
            </div>

            {/* Toggle */}
            <button
              onClick={() => setAnimations(!animations)}
              className="relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200"
              style={{
                background: animations ? 'var(--p-1)' : 'var(--line-strong)',
              }}
              aria-checked={animations}
              role="switch"
            >
              <span
                className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: animations ? 'translateX(20px)' : 'translateX(0)' }}
              />
            </button>
          </div>
        </SectionCard>

        {/* Notification preferences (UI-only) */}
        <SectionCard
          title="Notifications"
          description="Manage how Pulsify notifies you about server activity."
          footer={
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Push notification support is coming soon. Stay tuned for updates.
            </p>
          }
        >
          <div className="space-y-3">
            {[
              { label: 'Server alerts', description: 'Critical events like raids or mass bans' },
              { label: 'Moderation actions', description: 'Bans, kicks, and warning summaries' },
              { label: 'Weekly digest', description: 'Server health and activity summary' },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-lg p-3"
                style={{ background: 'var(--bg-2)' }}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>{item.description}</p>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded-full font-medium"
                  style={{ background: 'var(--bg)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
                >
                  Soon
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

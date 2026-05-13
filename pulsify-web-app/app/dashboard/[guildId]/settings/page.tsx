'use client'

import { useTheme } from '@/components/ThemeProvider'
import { THEMES } from '@/lib/themes'
import { Check } from 'lucide-react'

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Preferences</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Customise the look and feel of your Pulsify dashboard.
        </p>
      </div>

      {/* Theme picker */}
      <section className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <h2 className="font-semibold text-foreground mb-1">Colour Theme</h2>
        <p className="text-sm text-subtle mb-5">
          Choose an accent colour for the interface. Your selection is saved locally.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {THEMES.map((t) => {
            const active = theme === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className="group relative flex flex-col items-center gap-3 rounded-xl border p-4 text-center transition-all duration-150"
                style={{
                  background: active ? `${t.accent}14` : 'var(--bg-2)',
                  borderColor: active ? t.accent : 'var(--line-strong)',
                  boxShadow: active ? `0 0 0 1px ${t.accent}40` : 'none',
                }}
              >
                {/* Colour swatch */}
                <div
                  className="h-10 w-10 rounded-xl shadow-lg"
                  style={{
                    background: `linear-gradient(135deg, ${t.accent}cc, ${t.accent})`,
                    boxShadow: active ? `0 4px 16px -4px ${t.accent}80` : `0 2px 8px -4px ${t.accent}60`,
                  }}
                />

                {/* Active check */}
                {active && (
                  <span
                    className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full"
                    style={{ background: t.accent }}
                  >
                    <Check size={11} strokeWidth={3} color="white" />
                  </span>
                )}

                <div>
                  <p className="text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-subtle leading-tight mt-0.5">{t.description}</p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Preview bar */}
        <div
          className="mt-5 rounded-lg border p-3 flex items-center gap-3"
          style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
        >
          <div
            className="h-6 w-6 rounded-md shrink-0"
            style={{ background: `linear-gradient(135deg, var(--p-1), var(--p-2))` }}
          />
          <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--line-strong)' }}>
            <div className="h-2 rounded-full w-2/3" style={{ background: `linear-gradient(90deg, var(--p-1), var(--p-2))`, opacity: 0.7 }} />
          </div>
          <div
            className="h-6 px-3 rounded-md text-xs font-semibold text-white flex items-center"
            style={{ background: 'linear-gradient(90deg, var(--p-1), var(--p-2))' }}
          >
            Preview
          </div>
        </div>
      </section>
    </div>
  )
}

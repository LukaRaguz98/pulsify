'use client'

import { Check, Palette, Server, Type } from 'lucide-react'
import { THEMES } from '@/lib/themes'
import { SectionCard } from '@/components/ui/section-card'
import { CategorySection } from '@/components/ui/category-section'

// Pulse assistant preferences — what Pulse knows about the server when it
// generates content, and how its embeds look. Everything except the embed
// colour is client-only (localStorage); the embed colour is persisted to
// guild_settings.embed_color so the Pulse bot can apply it to every embed.
// These sections now live inside Server Settings (see ServerSettingsContent).

export type PulsePrefs = {
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

export const DEFAULT_PULSE_PREFS: PulsePrefs = {
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

export const PULSE_PREFS_KEY = (guildId: string) => `pulsify:Pulse-prefs:${guildId}`

const PULSE_TONES = [
  { id: 'friendly',     label: 'Friendly',     emoji: '😊' },
  { id: 'professional', label: 'Professional', emoji: '💼' },
  { id: 'gaming',       label: 'Gaming',       emoji: '🎮' },
  { id: 'community',    label: 'Community',    emoji: '🤝' },
  { id: 'other',        label: 'Other…',       emoji: '✏️' },
]

const PULSE_LANGUAGES = [
  { id: 'english', label: 'English',  flag: '🇬🇧' },
  { id: 'spanish', label: 'Español',  flag: '🇪🇸' },
  { id: 'french',  label: 'Français', flag: '🇫🇷' },
  { id: 'german',  label: 'Deutsch',  flag: '🇩🇪' },
  { id: 'italian', label: 'Italiano', flag: '🇮🇹' },
  { id: 'custom',  label: 'Other…',   flag: '✏️'  },
]

const PULSE_CONTENT_DEPTHS = [
  { id: 'brief'    as const, label: 'Brief',    sub: 'Short & punchy',      icon: '⚡' },
  { id: 'standard' as const, label: 'Standard', sub: 'Balanced',            icon: '✦' },
  { id: 'detailed' as const, label: 'Detailed', sub: 'Thorough & complete', icon: '📖' },
]

const PULSE_SERVER_SIZES = [
  { id: 'small'  as const, label: 'Cozy',     sub: '< 100',  icon: '🌱' },
  { id: 'medium' as const, label: 'Growing',  sub: '100–1k', icon: '🌿' },
  { id: 'large'  as const, label: 'Thriving', sub: '1k+',    icon: '🌳' },
]

type SectionsProps = {
  prefs: PulsePrefs
  updatePref: <K extends keyof PulsePrefs>(key: K, value: PulsePrefs[K]) => void
}

export function PulseAssistantSections({ prefs, updatePref }: SectionsProps) {
  return (
    <>
      {/* ── Server Context ───────────────────────────────────────────── */}
      <CategorySection
        icon={<Server size={14} />}
        title="Pulse Assistant — Server Context"
        description="What Pulse knows about your server when generating content."
      >
        <SectionCard
          title="Server Profile"
          description="Tell Pulse what your server is about. Used as context for every generation."
        >
          <textarea
            value={prefs.description}
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
        title="Pulse Assistant — Writing Style"
        description="Tone, language and how much detail Pulse produces."
      >
        <SectionCard title="Voice & Language" description="Set the tone and language Pulse writes in.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground mb-2">Tone &amp; Style</p>
              <div className="flex flex-wrap gap-1.5">
                {PULSE_TONES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => updatePref('tone', t.id)}
                    className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all"
                    style={{
                      borderColor: prefs.tone === t.id ? 'var(--p-1)' : 'var(--line-strong)',
                      background:  prefs.tone === t.id ? 'var(--p-soft)' : 'var(--bg-2)',
                      color:       prefs.tone === t.id ? 'var(--p-1)' : 'var(--text-2)',
                    }}
                  >
                    <span>{t.emoji}</span>{t.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={prefs.customTone}
                onChange={(e) => updatePref('customTone', e.target.value)}
                placeholder="e.g. Anime, Chill, Corporate…"
                disabled={prefs.tone !== 'other'}
                className="mt-2 w-full rounded-lg border px-3 py-1.5 text-xs outline-none transition-all"
                style={{
                  background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)',
                  opacity: prefs.tone === 'other' ? 1 : 0.35,
                  cursor:  prefs.tone === 'other' ? 'text' : 'not-allowed',
                }}
                onFocus={(e) => { if (prefs.tone === 'other') e.currentTarget.style.borderColor = 'var(--p-1)' }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-foreground mb-2">Language</p>
              <div className="flex flex-wrap gap-1.5">
                {PULSE_LANGUAGES.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => updatePref('language', l.id)}
                    className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all"
                    style={{
                      borderColor: prefs.language === l.id ? 'var(--p-1)' : 'var(--line-strong)',
                      background:  prefs.language === l.id ? 'var(--p-soft)' : 'var(--bg-2)',
                      color:       prefs.language === l.id ? 'var(--p-1)' : 'var(--text-2)',
                    }}
                  >
                    <span>{l.flag}</span>{l.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 space-y-1">
                <input
                  type="text"
                  value={prefs.customLanguage}
                  onChange={(e) => updatePref('customLanguage', e.target.value)}
                  placeholder="e.g. Croatian, Korean…"
                  disabled={prefs.language !== 'custom'}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs outline-none transition-all"
                  style={{
                    background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)',
                    opacity: prefs.language === 'custom' ? 1 : 0.35,
                    cursor:  prefs.language === 'custom' ? 'text' : 'not-allowed',
                  }}
                  onFocus={(e) => { if (prefs.language === 'custom') e.currentTarget.style.borderColor = 'var(--p-1)' }}
                  onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--line-strong)' }}
                />
                {prefs.language === 'custom' && (
                  <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                    Results in less common languages may be inconsistent — review before applying.
                  </p>
                )}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Generation Style"
          description="Tune how much detail Pulse produces and who it's writing for."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground mb-2">Content Depth</p>
              <div className="grid grid-cols-3 gap-2">
                {PULSE_CONTENT_DEPTHS.map((d) => {
                  const active = prefs.contentDepth === d.id
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
                {PULSE_SERVER_SIZES.map((s) => {
                  const active = prefs.serverSize === s.id
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
                {prefs.includeEmojis
                  ? 'Emojis will be added throughout generated content'
                  : 'Generated content will use plain text only'}
              </p>
            </div>
            <button
              onClick={() => updatePref('includeEmojis', !prefs.includeEmojis)}
              className="relative shrink-0 h-6 w-11 rounded-full transition-colors duration-200"
              style={{ background: prefs.includeEmojis ? 'var(--p-1)' : 'var(--line-strong)' }}
              aria-checked={prefs.includeEmojis}
              role="switch"
            >
              <span
                className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: prefs.includeEmojis ? 'translateX(20px)' : 'translateX(0)' }}
              />
            </button>
          </div>
        </SectionCard>
      </CategorySection>

      {/* ── Discord Output ───────────────────────────────────────────── */}
      <CategorySection
        icon={<Palette size={14} />}
        title="Embed Appearance"
        description="The accent colour Pulse applies to every embed it posts to Discord."
      >
        <SectionCard
          title="Embed Color"
          description="Applied to all Pulse embeds across Discord — announcements, welcome, rules, polls, giveaways, tickets and more."
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-foreground">Accent Color</p>
            <span
              className="font-mono text-xs rounded px-1.5 py-0.5"
              style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
            >
              {prefs.embedColor}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
            {THEMES.map((t) => {
              const active = prefs.embedColor.toLowerCase() === t.accent.toLowerCase()
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

            {/* Custom — active when the embed color isn't in the THEMES palette. */}
            {(() => {
              const presetHits = THEMES.some(
                (t) => t.accent.toLowerCase() === prefs.embedColor.toLowerCase(),
              )
              const customActive = !presetHits
              const display = prefs.embedColor
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
    </>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { Bell, Hash, ShieldOff } from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import { SecurityIcon } from '@/components/dashboard/security/icons'
import { saveSecurityConfig } from '@/app/dashboard/[guildId]/(management)/security/actions'
import {
  ALL_PATTERNS,
  PATTERN_META,
  MITIGATION_META,
  ALL_MITIGATIONS,
  SEVERITY_META,
  SECURITY_PRESETS,
  applyPreset,
  formatWindow,
  type SecurityConfig,
  type SecurityPattern,
  type SecurityRule,
  type SecuritySeverity,
  type MitigationAction,
} from '@/lib/security'

type Channel = { id: string; name: string }

const SEVERITIES: SecuritySeverity[] = ['low', 'medium', 'high', 'critical']

export function RulesForm({
  guildId,
  initialConfig,
  channels,
}: {
  guildId: string
  initialConfig: SecurityConfig
  channels: Channel[]
}) {
  const [enabled, setEnabled] = useState(initialConfig.enabled)
  const [alertChannel, setAlertChannel] = useState(initialConfig.alert_channel_id ?? '')
  const [rules, setRules] = useState<Record<SecurityPattern, SecurityRule>>(initialConfig.rules)
  const [autoLockdown, setAutoLockdown] = useState(initialConfig.auto_lockdown)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const snapshot = useMemo(
    () => JSON.stringify({ enabled: initialConfig.enabled, alertChannel: initialConfig.alert_channel_id ?? '', rules: initialConfig.rules, autoLockdown: initialConfig.auto_lockdown }),
    [initialConfig],
  )
  const current = JSON.stringify({ enabled, alertChannel, rules, autoLockdown })
  const dirty = current !== snapshot

  function patchRule(pattern: SecurityPattern, patch: Partial<SecurityRule>) {
    setRules((prev) => ({ ...prev, [pattern]: { ...prev[pattern], ...patch } }))
  }

  function toggleAction(pattern: SecurityPattern, action: MitigationAction) {
    setRules((prev) => {
      const rule = prev[pattern]
      const has = rule.actions.includes(action)
      const actions = has ? rule.actions.filter((a) => a !== action) : [...rule.actions, action]
      return { ...prev, [pattern]: { ...rule, actions } }
    })
  }

  function selectPreset(presetId: string) {
    const preset = SECURITY_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const { rules: nextRules, auto_lockdown } = applyPreset(preset)
    setRules(nextRules)
    setAutoLockdown(auto_lockdown)
  }

  function reset() {
    setEnabled(initialConfig.enabled)
    setAlertChannel(initialConfig.alert_channel_id ?? '')
    setRules(initialConfig.rules)
    setAutoLockdown(initialConfig.auto_lockdown)
    setError(null)
  }

  async function save() {
    setError(null)
    setSaving(true)
    const res = await saveSecurityConfig(guildId, {
      enabled,
      alert_channel_id: alertChannel || null,
      rules,
      auto_lockdown: autoLockdown,
    })
    setSaving(false)
    if (!res.ok) setError(res.error)
  }

  const inputStyle: React.CSSProperties = { background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }

  return (
    <div className="space-y-8">
      {/* Enable + alert destination */}
      <CategorySection icon={<Bell size={14} />} title="Protection & alerts" description="Turn the module on and choose where security alerts are delivered.">
        <div className="space-y-4 rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold text-foreground">Enable DDoS Protection</span>
              <span className="block text-xs" style={{ color: 'var(--text-3)' }}>
                When on, Pulse monitors traffic, detects abuse and applies the mitigations below.
              </span>
            </span>
            <Toggle on={enabled} onChange={setEnabled} />
          </label>

          <div className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
              <Hash size={12} /> Security alert channel
            </label>
            <select value={alertChannel} onChange={(e) => setAlertChannel(e.target.value)} className="w-full max-w-sm rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--p-1)]" style={inputStyle}>
              <option value="">Dashboard only (no Discord channel)</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
              Alerts always show in the dashboard. Pick a private admin / security channel to also receive them in Discord.
            </p>
          </div>
        </div>
      </CategorySection>

      {/* Presets */}
      <CategorySection icon={<SecurityIcon name="Shield" size={14} />} title="Quick presets" description="Apply a tuned profile, then fine-tune individual rules below.">
        <div className="grid gap-3 sm:grid-cols-3">
          {SECURITY_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPreset(p.id)}
              className="rounded-xl border p-4 text-left transition hover:border-[var(--p-1)]"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
            >
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                <SecurityIcon name={p.icon} size={16} />
              </span>
              <span className="block text-sm font-semibold text-foreground">{p.label}</span>
              <span className="mt-1 block text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>{p.description}</span>
            </button>
          ))}
        </div>
      </CategorySection>

      {/* Per-pattern rules */}
      <CategorySection icon={<SecurityIcon name="Activity" size={14} />} title="Protection rules" description="Each rule trips when its threshold is crossed inside the window, then applies the chosen mitigations.">
        <div className="space-y-3">
          {ALL_PATTERNS.map((pattern) => {
            const rule = rules[pattern]
            const meta = PATTERN_META[pattern]
            return (
              <div key={pattern} className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', opacity: rule.enabled ? 1 : 0.6 }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--bg-2)', color: SEVERITY_META[rule.severity].color }}>
                      <SecurityIcon name={meta.icon} size={17} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{meta.label}</p>
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>{meta.description}</p>
                    </div>
                  </div>
                  <Toggle on={rule.enabled} onChange={(v) => patchRule(pattern, { enabled: v })} />
                </div>

                {rule.enabled && (
                  <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-3" style={{ borderColor: 'var(--line)' }}>
                    <NumberField label={`Threshold (${meta.scope === 'user' ? 'per member' : 'total'})`} value={rule.threshold} min={2} onChange={(v) => patchRule(pattern, { threshold: v })} />
                    <NumberField label="Window (seconds)" value={rule.window_seconds} min={5} onChange={(v) => patchRule(pattern, { window_seconds: v })} hint={`= ${formatWindow(rule.window_seconds)}`} />
                    <div>
                      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-2)' }}>Severity</label>
                      <select value={rule.severity} onChange={(e) => patchRule(pattern, { severity: e.target.value as SecuritySeverity })} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--p-1)]" style={inputStyle}>
                        {SEVERITIES.map((s) => (<option key={s} value={s}>{SEVERITY_META[s].label}</option>))}
                      </select>
                    </div>

                    <div className="sm:col-span-3">
                      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-2)' }}>Automatic mitigations</label>
                      <div className="flex flex-wrap gap-1.5">
                        {ALL_MITIGATIONS.filter((a) => a !== 'lockdown').map((action) => {
                          const active = rule.actions.includes(action)
                          return (
                            <button
                              key={action}
                              type="button"
                              onClick={() => toggleAction(pattern, action)}
                              title={MITIGATION_META[action].description}
                              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition"
                              style={{ background: active ? 'var(--p-soft)' : 'var(--bg-2)', borderColor: active ? 'var(--p-1)' : 'var(--line-strong)', color: active ? 'var(--p-1)' : 'var(--text-2)' }}
                            >
                              <SecurityIcon name={MITIGATION_META[action].icon} size={12} />
                              {MITIGATION_META[action].label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {rule.actions.some((a) => a !== 'notify') && (
                      <NumberField label="Mitigation duration (seconds, 0 = until lifted)" value={rule.mitigation_seconds} min={0} onChange={(v) => patchRule(pattern, { mitigation_seconds: v })} hint={rule.mitigation_seconds > 0 ? `= ${formatWindow(rule.mitigation_seconds)}` : 'until lifted'} className="sm:col-span-3" />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CategorySection>

      {/* Auto-lockdown */}
      <CategorySection icon={<ShieldOff size={14} />} title="Auto-lockdown" description="Automatically lock the server down when a burst of detections lands — the strongest, last-resort mitigation.">
        <div className="space-y-4 rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold text-foreground">Enable auto-lockdown</span>
              <span className="block text-xs" style={{ color: 'var(--text-3)' }}>Block all Pulse actions automatically during a sustained attack. You lift it manually.</span>
            </span>
            <Toggle on={autoLockdown.enabled} onChange={(v) => setAutoLockdown({ ...autoLockdown, enabled: v })} />
          </label>
          {autoLockdown.enabled && (
            <div className="grid gap-4 border-t pt-4 sm:grid-cols-3" style={{ borderColor: 'var(--line)' }}>
              <NumberField label="Events to trigger" value={autoLockdown.event_threshold} min={2} onChange={(v) => setAutoLockdown({ ...autoLockdown, event_threshold: v })} />
              <NumberField label="Window (seconds)" value={autoLockdown.window_seconds} min={5} onChange={(v) => setAutoLockdown({ ...autoLockdown, window_seconds: v })} hint={`= ${formatWindow(autoLockdown.window_seconds)}`} />
              <div>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-2)' }}>Minimum severity counted</label>
                <select value={autoLockdown.min_severity} onChange={(e) => setAutoLockdown({ ...autoLockdown, min_severity: e.target.value as SecuritySeverity })} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--p-1)]" style={inputStyle}>
                  {SEVERITIES.map((s) => (<option key={s} value={s}>{SEVERITY_META[s].label}</option>))}
                </select>
              </div>
            </div>
          )}
        </div>
      </CategorySection>

      {error && (
        <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>
      )}

      <SaveBar
        dirty={dirty}
        saving={saving}
        saveLabel="Save settings"
        confirmTitle="Save DDoS Protection settings?"
        confirmDescription="The Pulse bot picks up the new rules, alert channel and auto-lockdown trigger immediately."
        onReset={reset}
        onSave={save}
      />
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
      style={{ background: on ? 'var(--p-1)' : 'var(--line-strong)' }}
    >
      <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" style={{ transform: on ? 'translateX(24px)' : 'translateX(4px)' }} />
    </button>
  )
}

function NumberField({
  label,
  value,
  min,
  onChange,
  hint,
  className,
}: {
  label: string
  value: number
  min: number
  onChange: (v: number) => void
  hint?: string
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-2)' }}>{label}</label>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--p-1)]"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
      />
      {hint && <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>{hint}</p>}
    </div>
  )
}

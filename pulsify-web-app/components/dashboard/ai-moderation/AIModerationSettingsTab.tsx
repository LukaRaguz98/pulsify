'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  Bell,
  Check,
  CheckCircle2,
  Hash,
  Palette,
  Shield,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import type { DiscordChannel, DiscordRole } from '@/lib/discord'
import {
  AUTO_ACTION_LABELS,
  CATEGORY_COLORS,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_IDS,
  CATEGORY_LABELS,
  type AIModerationSettings,
  type AutoAction,
  type CategoryId,
  SENSITIVITY_DESCRIPTIONS,
  SENSITIVITY_LABELS,
  SENSITIVITY_LEVELS,
} from '@/lib/ai-moderation'
import { THEMES } from '@/lib/themes'
import { saveAIModerationSettings } from '@/app/dashboard/[guildId]/(management)/ai-moderation/actions'
import { SaveBar } from '@/components/ui/save-bar'

type Props = {
  guildId: string
  channels: DiscordChannel[]
  roles: DiscordRole[]
  initialSettings: AIModerationSettings
  onSaved: (settings: AIModerationSettings) => void
}

const ACTION_OPTIONS: AutoAction[] = ['none', 'flag', 'delete', 'warn', 'timeout']

export function AIModerationSettingsTab({
  guildId,
  channels,
  roles,
  initialSettings,
  onSaved,
}: Props) {
  const [pending, startTransition] = useTransition()
  const [snapshot, setSnapshot] = useState(initialSettings)
  const [draft, setDraft] = useState<AIModerationSettings>(initialSettings)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [userIdsInput, setUserIdsInput] = useState(initialSettings.whitelisted_user_ids.join(', '))

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(snapshot), [draft, snapshot])
  const changedCount = useMemo(() => {
    if (!dirty) return 0
    let n = 0
    if (draft.enabled !== snapshot.enabled) n++
    if (draft.sensitivity !== snapshot.sensitivity) n++
    if (draft.alert_channel_id !== snapshot.alert_channel_id) n++
    if (draft.timeout_minutes !== snapshot.timeout_minutes) n++
    if (draft.realtime_alerts !== snapshot.realtime_alerts) n++
    if (draft.embed_color !== snapshot.embed_color) n++
    for (const id of CATEGORY_IDS) {
      if (
        draft.categories[id].enabled !== snapshot.categories[id].enabled ||
        draft.categories[id].action !== snapshot.categories[id].action
      ) n++
    }
    if (JSON.stringify(draft.whitelisted_user_ids) !== JSON.stringify(snapshot.whitelisted_user_ids)) n++
    if (JSON.stringify(draft.whitelisted_role_ids) !== JSON.stringify(snapshot.whitelisted_role_ids)) n++
    if (JSON.stringify(draft.ignored_channel_ids) !== JSON.stringify(snapshot.ignored_channel_ids)) n++
    return n
  }, [draft, snapshot, dirty])

  function update<K extends keyof AIModerationSettings>(key: K, value: AIModerationSettings[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function updateCategory(id: CategoryId, patch: Partial<AIModerationSettings['categories'][CategoryId]>) {
    setDraft((prev) => ({
      ...prev,
      categories: {
        ...prev.categories,
        [id]: { ...prev.categories[id], ...patch },
      },
    }))
    setSaved(false)
  }

  function toggleListMember(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
  }

  function handleReset() {
    setDraft(snapshot)
    setUserIdsInput(snapshot.whitelisted_user_ids.join(', '))
    setError(null)
    setSaved(false)
  }

  function handleSave() {
    // Parse the comma/space-separated user IDs at save time so the user can
    // type freely without re-parsing on every keystroke.
    const parsedUserIds = userIdsInput
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{10,}$/.test(s))
    const next: AIModerationSettings = { ...draft, whitelisted_user_ids: parsedUserIds }

    startTransition(async () => {
      setError(null)
      const res = await saveAIModerationSettings(guildId, next)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSnapshot(next)
      setDraft(next)
      setUserIdsInput(parsedUserIds.join(', '))
      setSaved(true)
      onSaved(next)
    })
  }

  return (
    <div className="space-y-8">
      {/* ── Activation ──────────────────────────────────────────────── */}
      <CategorySection
        icon={<Shield size={14} />}
        title="Activation"
        description="Turn Pulse Guard on and pick where alerts land."
      >
      {/* Master enable + alert channel */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
            >
              <Shield size={16} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Enable Pulse moderation</h3>
              <p className="mt-0.5 max-w-md text-xs text-subtle">
                When enabled, new messages are analysed in real time and your configured auto-actions execute automatically.
              </p>
            </div>
          </div>
          <Toggle enabled={draft.enabled} onChange={(v) => update('enabled', v)} />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Alert channel</label>
            <select
              value={draft.alert_channel_id ?? ''}
              onChange={(e) => update('alert_channel_id', e.target.value || null)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            >
              <option value="">Don&apos;t post alerts</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-subtle">
              Flagged content posts a Discord alert here in addition to the dashboard feed.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Auto-timeout duration</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={40320}
                value={draft.timeout_minutes}
                onChange={(e) => update('timeout_minutes', Math.max(1, Number(e.target.value) || 1))}
                className="w-32 rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
              <span className="text-xs text-subtle">minutes</span>
            </div>
            <p className="mt-1 text-[11px] text-subtle">Applied when a category&apos;s action is &quot;Timeout member&quot;.</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <div className="flex items-center gap-2">
            <Bell size={14} style={{ color: 'var(--p-1)' }} />
            <div>
              <p className="text-sm font-medium text-foreground">Real-time dashboard alerts</p>
              <p className="text-[11px] text-subtle">Post flagged content to the activity feed and notification bell.</p>
            </div>
          </div>
          <Toggle enabled={draft.realtime_alerts} onChange={(v) => update('realtime_alerts', v)} />
        </div>
      </div>
      </CategorySection>

      {/* ── Detection ───────────────────────────────────────────────── */}
      <CategorySection
        icon={<ShieldAlert size={14} />}
        title="Detection"
        helpId="pulse-guard-detection"
        description="How aggressive Pulse Guard is and which categories it watches for."
      >
      {/* Sensitivity */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Sensitivity</h3>
          <p className="text-xs text-subtle">Raises or lowers the confidence threshold every detector uses before flagging content.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {SENSITIVITY_LEVELS.map((s) => (
            <button
              key={s}
              onClick={() => update('sensitivity', s)}
              className="rounded-lg border p-3 text-left transition"
              style={{
                borderColor: draft.sensitivity === s ? 'var(--p-1)' : 'var(--line-strong)',
                background: draft.sensitivity === s ? 'var(--p-soft)' : 'var(--bg-2)',
              }}
            >
              <p className="text-sm font-semibold" style={{ color: draft.sensitivity === s ? 'var(--p-1)' : 'var(--text)' }}>
                {SENSITIVITY_LABELS[s]}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                {SENSITIVITY_DESCRIPTIONS[s]}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Detectors */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Detectors &amp; auto-actions</h3>
            <p className="text-xs text-subtle">Pick which categories Pulse Guard watches and what happens when one trips.</p>
          </div>
        </div>
        <div className="space-y-2">
          {CATEGORY_IDS.map((id) => {
            const cfg = draft.categories[id]
            const color = CATEGORY_COLORS[id]
            return (
              <div
                key={id}
                className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    style={{ background: `${color}1f`, color }}
                  >
                    <Shield size={11} />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{CATEGORY_LABELS[id]}</p>
                    <p className="text-[11px] leading-relaxed text-subtle">{CATEGORY_DESCRIPTIONS[id]}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={cfg.action}
                    onChange={(e) => updateCategory(id, { action: e.target.value as AutoAction })}
                    disabled={!cfg.enabled}
                    className="rounded-md border px-2 py-1 text-xs outline-none disabled:opacity-50"
                    style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
                  >
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a} value={a}>{AUTO_ACTION_LABELS[a]}</option>
                    ))}
                  </select>
                  <Toggle enabled={cfg.enabled} onChange={(v) => updateCategory(id, { enabled: v })} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      </CategorySection>

      {/* ── Discord Output ──────────────────────────────────────────── */}
      <CategorySection
        icon={<Palette size={14} />}
        title="Discord Output"
        description="How Pulse Guard's alerts appear when posted to Discord."
      >
      {/* Embed Appearance — accent colour for the alert container + the
          tinted moderation icon. Mirrors the Pulse Assistant > Embed
          Appearance picker so the two settings panels feel like one
          component. */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Embed Appearance</h3>
          <p className="text-xs text-subtle">Accent colour applied to the alert container and the Pulse Guard icon.</p>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Embed Color</p>
          <span
            className="font-mono text-xs rounded px-1.5 py-0.5"
            style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}
          >
            {draft.embed_color}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
          {THEMES.map((t) => {
            const active = draft.embed_color.toLowerCase() === t.accent.toLowerCase()
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => update('embed_color', t.accent)}
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

          {/* Custom — active when the embed colour is outside the preset
              palette. Mirrors the Pulse Assistant custom card. */}
          {(() => {
            const presetHits = THEMES.some(
              (t) => t.accent.toLowerCase() === draft.embed_color.toLowerCase(),
            )
            const customActive = !presetHits
            const display = draft.embed_color
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
                  onChange={(e) => update('embed_color', e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            )
          })()}
        </div>
      </div>

      </CategorySection>

      {/* ── Exclusions ──────────────────────────────────────────────── */}
      <CategorySection
        icon={<Users size={14} />}
        title="Exclusions"
        helpId="pulse-guard-exclusions"
        description="Members, roles, and channels Pulse Guard never touches."
      >
      {/* Whitelists */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Whitelists &amp; exclusions</h3>
          <p className="text-xs text-subtle">Members, roles, and channels that bypass Pulse Guard entirely.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Users */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Users size={12} /> Trusted member IDs
            </label>
            <textarea
              value={userIdsInput}
              onChange={(e) => { setUserIdsInput(e.target.value); setSaved(false) }}
              rows={4}
              placeholder="123456789012345678, 987654321098765432"
              className="w-full rounded-lg border px-3 py-2 text-xs font-mono outline-none placeholder:text-subtle"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            />
            <p className="mt-1 text-[10px] text-subtle">
              Comma-separated Discord user IDs. Only numeric IDs ≥ 10 digits are kept.
            </p>
          </div>

          {/* Roles */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Shield size={12} /> Trusted roles
            </label>
            <div
              className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-2"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
            >
              {roles.length === 0 ? (
                <p className="px-2 py-1 text-[11px] text-subtle">No roles found.</p>
              ) : roles.map((r) => {
                const checked = draft.whitelisted_role_ids.includes(r.id)
                return (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:bg-[color-mix(in_srgb,var(--panel)_60%,transparent)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => update('whitelisted_role_ids', toggleListMember(draft.whitelisted_role_ids, r.id))}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate text-foreground">{r.name}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Channels */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Hash size={12} /> Ignored channels
            </label>
            <div
              className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-2"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
            >
              {channels.length === 0 ? (
                <p className="px-2 py-1 text-[11px] text-subtle">No text channels found.</p>
              ) : channels.map((c) => {
                const checked = draft.ignored_channel_ids.includes(c.id)
                return (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:bg-[color-mix(in_srgb,var(--panel)_60%,transparent)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => update('ignored_channel_ids', toggleListMember(draft.ignored_channel_ids, c.id))}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate text-foreground">#{c.name}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      </CategorySection>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
          <XCircle size={14} className="shrink-0" />
          {error}
        </div>
      )}
      {saved && !dirty && (
        <div className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#22c55e' }}>
          <CheckCircle2 size={14} className="shrink-0" />
          Pulse Guard settings saved.
        </div>
      )}

      <SaveBar
        dirty={dirty}
        changedCount={changedCount}
        saving={pending}
        saveLabel="Save Settings"
        confirmTitle="Save Pulse settings?"
        confirmDescription="These settings drive real-time auto-actions. Changes take effect immediately."
        onReset={handleReset}
        onSave={handleSave}
      />
    </div>
  )
}

function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (v: boolean) => void
}) {
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

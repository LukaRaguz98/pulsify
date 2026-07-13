'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2, Mic2, RefreshCw } from 'lucide-react'
import type { DiscordRole } from '@/lib/discord'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import {
  type PrivateChannelConfig,
  DEFAULT_PRIVATE_CHANNEL_CONFIG,
  PRIVATE_CHANNEL_LIMITS,
  formatPrivateChannelName,
  validatePrivateChannelConfig,
} from '@/lib/private-channels'
import { savePrivateChannels, reprovisionPrivateChannels } from '@/app/dashboard/[guildId]/(management)/private-channels/actions'

const fieldStyle = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text-1)',
} as const

const fieldClass =
  'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--p-1)]'

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
      style={{
        background: enabled ? 'linear-gradient(90deg, var(--p-1), var(--p-2))' : 'var(--bg-2)',
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

function RoleMultiSelect({
  label,
  roles,
  selected,
  onChange,
  emptyHint,
}: {
  label: string
  roles: DiscordRole[]
  selected: string[]
  onChange: (ids: string[]) => void
  emptyHint: string
}) {
  const byId = new Map(roles.map((r) => [r.id, r]))
  const available = roles.filter((r) => !selected.includes(r.id))
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <label className="mb-2 block text-xs font-medium text-muted-foreground">{label}</label>
      {selected.length === 0 ? (
        <p className="mb-2 text-xs text-subtle">{emptyHint}</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
              style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}
            >
              {byId.get(id)?.name ?? id}
              <button type="button" onClick={() => onChange(selected.filter((s) => s !== id))} className="opacity-60 hover:opacity-100">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onChange([...selected, e.target.value])
        }}
        disabled={available.length === 0}
        className={`${fieldClass} disabled:opacity-50`}
        style={fieldStyle}
      >
        <option value="">{available.length === 0 ? 'Nothing left to add' : 'Add…'}</option>
        {available.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </div>
  )
}

function ToggleRow({
  label,
  hint,
  enabled,
  onChange,
}: {
  label: string
  hint?: string
  enabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
          {label}
        </p>
        {hint && <p className="text-xs text-subtle">{hint}</p>}
      </div>
      <Toggle enabled={enabled} onChange={onChange} />
    </div>
  )
}

export function PrivateChannelsSettings({
  guildId,
  roles,
  initialConfig,
}: {
  guildId: string
  roles: DiscordRole[]
  initialConfig: PrivateChannelConfig
}) {
  const [config, setConfig] = useState<PrivateChannelConfig>({ ...DEFAULT_PRIVATE_CHANNEL_CONFIG, ...initialConfig })
  const [snapshot, setSnapshot] = useState<PrivateChannelConfig>({ ...DEFAULT_PRIVATE_CHANNEL_CONFIG, ...initialConfig })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reprovisioning, startReprovision] = useTransition()
  const [reprovisionNotice, setReprovisionNotice] = useState<string | null>(null)

  function set<K extends keyof PrivateChannelConfig>(key: K, value: PrivateChannelConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }))
    setError(null)
    setReprovisionNotice(null)
  }

  function handleReprovision() {
    setError(null)
    setReprovisionNotice(null)
    startReprovision(async () => {
      const res = await reprovisionPrivateChannels(guildId)
      if (res.ok) {
        setReprovisionNotice('Re-created the category and trigger channel — refresh Discord if you don’t see them yet.')
      } else {
        setError(res.error)
      }
    })
  }

  const changedCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(snapshot) as (keyof PrivateChannelConfig)[]) {
      if (JSON.stringify(config[k]) !== JSON.stringify(snapshot[k])) n += 1
    }
    return n
  }, [config, snapshot])
  const dirty = changedCount > 0

  const namePreview = formatPrivateChannelName(config.name_format, { username: 'govadroth', display: 'Govadroth' })

  function handleReset() {
    setConfig(snapshot)
    setError(null)
  }

  async function handleSave(): Promise<void> {
    const invalid = validatePrivateChannelConfig(config)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    const res = await savePrivateChannels(guildId, config)
    setSaving(false)
    if (res.ok) {
      setError(null)
      setSnapshot(config)
    } else {
      setError(res.error)
    }
  }

  return (
    <div className="space-y-8">
      <CategorySection
        icon={<Mic2 size={14} />}
        title="Configuration"
        description="Join-to-create temporary voice channels. Pulse makes a category + a trigger channel; joining the trigger spins up a private channel for the member."
      >
        {/* Master enable + the names Pulse provisions on Discord. The toggle
            lives inside this card (not in the section title) — same layout as
            Pulse Guard's "Enable Pulse moderation" activation card. */}
        <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                <Mic2 size={16} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Enable Private Channels</h3>
                <p className="mt-0.5 max-w-md text-xs text-subtle">
                  When enabled, Pulse creates a category and a join-to-create trigger channel — members spin up their own private voice channels by joining it.
                </p>
              </div>
            </div>
            <Toggle enabled={config.enabled} onChange={(v) => set('enabled', v)} />
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Category name" hint="Pulse creates and owns this category.">
              <input
                value={config.category_name}
                maxLength={PRIVATE_CHANNEL_LIMITS.nameMax}
                onChange={(e) => set('category_name', e.target.value)}
                className={fieldClass}
                style={fieldStyle}
              />
            </Field>
            <Field label="Trigger channel name" hint="Members join this voice channel to create their own.">
              <input
                value={config.trigger_name}
                maxLength={PRIVATE_CHANNEL_LIMITS.nameMax}
                onChange={(e) => set('trigger_name', e.target.value)}
                className={fieldClass}
                style={fieldStyle}
              />
            </Field>
          </div>

          {/* Recovery: a re-save can't run on an unchanged config, so when the
              feature is already enabled we expose an explicit re-create — for
              when the category/trigger were deleted in Discord and didn't come
              back on their own. */}
          {snapshot.enabled && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>Trigger channel missing?</p>
                <p className="text-xs text-subtle">If you deleted the category or trigger in Discord, have Pulse re-create them.</p>
              </div>
              <button
                type="button"
                onClick={handleReprovision}
                disabled={reprovisioning}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
              >
                {reprovisioning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {reprovisioning ? 'Re-creating…' : 'Re-create channels'}
              </button>
            </div>
          )}

          {reprovisionNotice && (
            <div className="mt-3 flex items-start gap-2 text-xs" style={{ color: '#22c55e' }}>
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
              <span>{reprovisionNotice}</span>
            </div>
          )}
        </div>

        <div className="space-y-4">
            <Field label="Created channel name format" hint="Tokens: {display} (server display name), {username}.">
              <input
                value={config.name_format}
                maxLength={PRIVATE_CHANNEL_LIMITS.nameMax}
                onChange={(e) => set('name_format', e.target.value)}
                className={fieldClass}
                style={fieldStyle}
              />
              <p className="mt-1 text-xs text-subtle">
                Preview: <span style={{ color: 'var(--text-2)' }}>🔊 {namePreview}</span>
              </p>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="User limit" hint="0 = unlimited (max 99).">
                <input
                  type="number"
                  min={0}
                  max={PRIVATE_CHANNEL_LIMITS.userLimitMax}
                  value={config.user_limit}
                  onChange={(e) => set('user_limit', Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
                  className={fieldClass}
                  style={fieldStyle}
                />
              </Field>
              <Field label="Max channels per member" hint="0 = unlimited.">
                <input
                  type="number"
                  min={0}
                  max={PRIVATE_CHANNEL_LIMITS.perUserMax}
                  value={config.per_user_limit}
                  onChange={(e) => set('per_user_limit', Math.max(0, Math.min(25, Number(e.target.value) || 0)))}
                  className={fieldClass}
                  style={fieldStyle}
                />
              </Field>
            </div>

            <div className="space-y-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <ToggleRow
                label="Start locked"
                hint="New channels are hidden from joining until the owner unlocks them."
                enabled={config.default_locked}
                onChange={(v) => set('default_locked', v)}
              />
              <ToggleRow
                label="Allow owner management"
                hint="Posts a control panel in the channel so the owner can rename, lock, set a limit, invite/remove, transfer, or delete it."
                enabled={config.allow_owner_management}
                onChange={(v) => set('allow_owner_management', v)}
              />
              <ToggleRow
                label="Auto-delete empty channels"
                enabled={config.auto_delete}
                onChange={(v) => set('auto_delete', v)}
              />
              {config.auto_delete && (
                <Field label="Auto-delete delay (seconds)" hint={`Between ${PRIVATE_CHANNEL_LIMITS.autoDeleteDelayMin} and ${PRIVATE_CHANNEL_LIMITS.autoDeleteDelayMax}.`}>
                  <input
                    type="number"
                    min={PRIVATE_CHANNEL_LIMITS.autoDeleteDelayMin}
                    max={PRIVATE_CHANNEL_LIMITS.autoDeleteDelayMax}
                    value={config.auto_delete_delay}
                    onChange={(e) => set('auto_delete_delay', Math.max(10, Math.min(3600, Number(e.target.value) || 60)))}
                    className={`${fieldClass} max-w-[160px]`}
                    style={fieldStyle}
                  />
                </Field>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <RoleMultiSelect
                label="Allowed roles (empty = everyone)"
                roles={roles}
                selected={config.allowed_role_ids}
                onChange={(ids) => set('allowed_role_ids', ids)}
                emptyHint="Everyone can use the trigger."
              />
              <RoleMultiSelect
                label="Ignored roles"
                roles={roles}
                selected={config.ignored_role_ids}
                onChange={(ids) => set('ignored_role_ids', ids)}
                emptyHint="No roles are ignored."
              />
            </div>

            <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>
                Pulse needs <strong>Manage Channels</strong>, <strong>Move Members</strong>, and{' '}
                <strong>View Channels</strong> / <strong>Connect</strong>. Created channels grant the owner Connect,
                Manage Channel and Move Members; {config.allowed_role_ids.length > 0 ? 'allowed roles can join; ' : ''}
                {config.default_locked ? 'everyone else is blocked until unlocked.' : 'everyone else can join unless locked.'}
              </span>
            </div>
        </div>
      </CategorySection>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border p-4 text-sm" style={{ background: 'rgba(239,68,68,0.07)', borderColor: 'rgba(239,68,68,0.25)', color: '#f87171' }}>
          <AlertCircle size={15} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <SaveBar
        dirty={dirty}
        changedCount={changedCount}
        saving={saving}
        saveLabel="Save settings"
        cleanText="All changes saved. Private Channels apply through the Pulse bot."
        dirtyHintText="review and save to apply via the Pulse bot."
        confirmTitle="Save Private Channels?"
        confirmDescription="Pulse will create or update the category and trigger channel on your server."
        onReset={handleReset}
        onSave={handleSave}
      />
    </div>
  )
}

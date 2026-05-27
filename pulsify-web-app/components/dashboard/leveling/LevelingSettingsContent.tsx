'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Sparkles,
  ChevronLeft,
  AlertCircle,
  MessageSquare,
  Mic,
  Terminal,
  Gift,
  CalendarDays,
  Bell,
  Plus,
  X,
  Trophy,
  Gauge,
  Ban,
  Hash,
  Award,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import {
  xpForLevel,
  renderLevelupMessage,
  type LevelingConfig,
  type LevelupAnnounce,
  type LevelReward,
} from '@/lib/leveling'
import { saveLevelingSettings } from '@/app/dashboard/[guildId]/leveling-settings/actions'

type Option = { id: string; name: string; color?: number }
type Props = {
  guildId: string
  guildName: string
  initialConfig: LevelingConfig
  channels: Option[]
  roles: Option[]
}

const ANNOUNCE_OPTIONS: { value: LevelupAnnounce; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Don’t announce level-ups' },
  { value: 'current', label: 'Same channel', hint: 'Where the member was active' },
  { value: 'channel', label: 'A channel', hint: 'Always post to one channel' },
  { value: 'dm', label: 'Direct message', hint: 'DM the member privately' },
]

const PREVIEW_LEVELS = [1, 5, 10, 25, 50]

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

export function LevelingSettingsContent({ guildId, guildName, initialConfig, channels, roles }: Props) {
  const [config, setConfig] = useState<LevelingConfig>(initialConfig)
  // Baseline snapshot for dirty tracking + Reset — same pattern as the Pulse
  // assistant / Server Settings save bar.
  const [snapshot, setSnapshot] = useState<LevelingConfig>(initialConfig)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof LevelingConfig>(key: K, value: LevelingConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }))
  }
  function setCurve<K extends keyof LevelingConfig['curve']>(key: K, value: number) {
    setConfig((c) => ({ ...c, curve: { ...c.curve, [key]: value } }))
  }

  const roleName = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])

  const curvePreview = useMemo(
    () => PREVIEW_LEVELS.map((lvl) => ({ lvl, xp: xpForLevel(lvl, config.curve) })),
    [config.curve],
  )

  const messagePreview = renderLevelupMessage(config.levelup_message, {
    user: 'Ada',
    mention: '@Ada',
    level: 5,
    server: guildName,
  })

  // Count changed top-level keys (JSON-compare handles nested curve/arrays).
  const changedCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(snapshot) as (keyof LevelingConfig)[]) {
      if (JSON.stringify(snapshot[k]) !== JSON.stringify(config[k])) n += 1
    }
    return n
  }, [snapshot, config])
  const dirty = changedCount > 0

  function handleReset() {
    setConfig(snapshot)
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await saveLevelingSettings(guildId, config)
    if (res.ok) setSnapshot(config)
    else setError(res.error)
    setSaving(false)
  }

  return (
    <div className="page-content">
      <Link
        href={`/dashboard/${guildId}/members`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ChevronLeft size={16} /> Back to Members
      </Link>

      <PageHeader
        title="Level settings"
        description={
          <>
            Configure XP, levels and rewards for{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
      />

      {error && (
        <div
          className="mb-6 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="space-y-8">
        {/* Master switch */}
        <CategorySection icon={<Sparkles size={14} />} title="XP tracking" description="Award XP for member activity and turn the progression system on or off.">
          <Toggle
            label="Enable XP & levels"
            description="When off, no XP is awarded and level-ups are paused. Existing XP is kept."
            checked={config.enabled}
            onChange={(v) => set('enabled', v)}
          />
        </CategorySection>

        {/* XP rates */}
        <CategorySection icon={<Gauge size={14} />} title="XP rates" description="How much XP each activity earns, with anti-spam cooldowns.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField icon={<MessageSquare size={14} />} label="XP per message (min)" value={config.xp_per_message_min} onChange={(v) => set('xp_per_message_min', v)} min={0} max={1000} />
            <NumberField icon={<MessageSquare size={14} />} label="XP per message (max)" value={config.xp_per_message_max} onChange={(v) => set('xp_per_message_max', v)} min={0} max={1000} />
            <NumberField icon={<MessageSquare size={14} />} label="Message cooldown" value={config.message_cooldown_seconds} onChange={(v) => set('message_cooldown_seconds', v)} min={0} max={3600} suffix="sec" />
            <NumberField icon={<Mic size={14} />} label="XP per voice minute" value={config.xp_per_voice_minute} onChange={(v) => set('xp_per_voice_minute', v)} min={0} max={1000} />
            <NumberField icon={<Terminal size={14} />} label="XP per command" value={config.xp_per_command} onChange={(v) => set('xp_per_command', v)} min={0} max={1000} />
            <NumberField icon={<Terminal size={14} />} label="Command cooldown" value={config.command_cooldown_seconds} onChange={(v) => set('command_cooldown_seconds', v)} min={0} max={3600} suffix="sec" />
            <NumberField icon={<Gift size={14} />} label="XP per giveaway entry" value={config.xp_per_giveaway_entry} onChange={(v) => set('xp_per_giveaway_entry', v)} min={0} max={10000} />
            <NumberField icon={<CalendarDays size={14} />} label="XP per event interest" value={config.xp_per_event} onChange={(v) => set('xp_per_event', v)} min={0} max={10000} />
            <NumberField icon={<Gauge size={14} />} label="Global multiplier" value={config.xp_multiplier} onChange={(v) => set('xp_multiplier', v)} min={0} max={100} step={0.1} />
          </div>
        </CategorySection>

        {/* Curve */}
        <CategorySection icon={<Trophy size={14} />} title="Level curve" description="The XP needed for each level. Higher values = slower progression.">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField label="Base" value={config.curve.base} onChange={(v) => setCurve('base', v)} min={1} max={100000} />
              <NumberField label="Linear" value={config.curve.factor} onChange={(v) => setCurve('factor', v)} min={0} max={100000} />
              <NumberField label="Quadratic" value={config.curve.quadratic} onChange={(v) => setCurve('quadratic', v)} min={0} max={10000} />
            </div>
            <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
              <p className="mb-3 text-xs font-medium text-muted-foreground">XP needed to reach</p>
              <div className="space-y-1.5">
                {curvePreview.map((p) => (
                  <div key={p.lvl} className="flex items-center justify-between text-sm">
                    <span className="text-subtle">Level {p.lvl}</span>
                    <span className="font-mono text-foreground">{p.xp.toLocaleString()} XP</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CategorySection>

        {/* Ignored */}
        <CategorySection icon={<Ban size={14} />} title="Ignored channels & roles" description="Activity in these channels, or by members with these roles, earns no XP.">
          <div className="grid gap-5 lg:grid-cols-2">
            <TokenMultiSelect
              icon={<Hash size={14} />}
              label="Ignored channels"
              options={channels}
              selected={config.ignored_channel_ids}
              onChange={(ids) => set('ignored_channel_ids', ids)}
              emptyHint="No ignored channels."
            />
            <TokenMultiSelect
              icon={<Ban size={14} />}
              label="Ignored roles"
              options={roles}
              selected={config.ignored_role_ids}
              onChange={(ids) => set('ignored_role_ids', ids)}
              emptyHint="No ignored roles."
            />
          </div>
        </CategorySection>

        {/* Level-up announcements */}
        <CategorySection icon={<Bell size={14} />} title="Level-up announcements" description="Tell members when they level up.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ANNOUNCE_OPTIONS.map((o) => {
              const active = config.levelup_announce === o.value
              return (
                <button
                  key={o.value}
                  onClick={() => set('levelup_announce', o.value)}
                  className="rounded-xl border p-3 text-left transition"
                  style={{ borderColor: active ? 'var(--p-1)' : 'var(--line-strong)', background: active ? 'var(--p-soft)' : 'var(--panel)' }}
                >
                  <p className="text-sm font-semibold" style={{ color: active ? 'var(--p-1)' : 'var(--text)' }}>{o.label}</p>
                  <p className="mt-0.5 text-[11px] text-subtle">{o.hint}</p>
                </button>
              )
            })}
          </div>

          {config.levelup_announce === 'channel' && (
            <div className="mt-4 max-w-sm">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Announcement channel</label>
              <select
                value={config.levelup_channel_id ?? ''}
                onChange={(e) => set('levelup_channel_id', e.target.value || null)}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={fieldStyle}
              >
                <option value="">Select a channel…</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>#{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {config.levelup_announce !== 'off' && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Message template</label>
                <textarea
                  value={config.levelup_message}
                  onChange={(e) => set('levelup_message', e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                  style={fieldStyle}
                />
                <p className="mt-1.5 text-[11px] text-subtle">
                  Placeholders: <code>{'{user}'}</code> <code>{'{mention}'}</code> <code>{'{level}'}</code> <code>{'{server}'}</code>
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Preview</label>
                <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', borderLeft: '3px solid var(--p-1)' }}>
                  <p className="text-xs font-semibold" style={{ color: 'var(--p-1)' }}>Level 5</p>
                  <p className="mt-1 text-sm text-foreground">{messagePreview}</p>
                  <p className="mt-2 text-[11px] text-subtle">Pulse · Level up</p>
                </div>
              </div>
            </div>
          )}
        </CategorySection>

        {/* Reward roles */}
        <CategorySection icon={<Award size={14} />} title="Reward roles" description="Automatically grant a role when a member reaches a level.">
          <Toggle
            label="Stack reward roles"
            description="Keep every reward role earned (on) vs. only the highest, removing lower ones (off)."
            checked={config.stack_rewards}
            onChange={(v) => set('stack_rewards', v)}
          />
          <div className="mt-4">
            <RewardsEditor rewards={config.rewards} roles={roles} roleName={roleName} onChange={(r) => set('rewards', r)} />
          </div>
        </CategorySection>

        <SaveBar
          dirty={dirty}
          changedCount={changedCount}
          saving={saving}
          saveLabel="Save settings"
          cleanText="All level settings saved."
          dirtyHintText="review and save to apply them."
          confirmTitle="Save level settings?"
          confirmDescription="These XP rates, curve, rewards and announcement settings take effect immediately."
          confirmLabel="Save settings"
          onReset={handleReset}
          onSave={handleSave}
        />
      </div>
    </div>
  )
}

// ── Inline field helpers ──────────────────────────────────────────────────────

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  icon,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
  icon?: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </label>
      <div className="relative">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min)
          }}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
          style={fieldStyle}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle">{suffix}</span>}
      </div>
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200"
        style={{ background: checked ? 'var(--p-1)' : 'var(--line-strong)' }}
        role="switch"
        aria-checked={checked}
      >
        <span
          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  )
}

function TokenMultiSelect({
  label,
  options,
  selected,
  onChange,
  emptyHint,
  icon,
}: {
  label: string
  options: Option[]
  selected: string[]
  onChange: (ids: string[]) => void
  emptyHint: string
  icon?: React.ReactNode
}) {
  const byId = new Map(options.map((o) => [o.id, o]))
  const available = options.filter((o) => !selected.includes(o.id))
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </label>
      {selected.length === 0 ? (
        <p className="mb-2 text-xs text-subtle">{emptyHint}</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
              {byId.get(id)?.name ?? id}
              <button onClick={() => onChange(selected.filter((s) => s !== id))} className="opacity-60 hover:opacity-100">
                <X size={11} />
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
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-50"
        style={fieldStyle}
      >
        <option value="">{available.length === 0 ? 'Nothing left to add' : 'Add…'}</option>
        {available.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  )
}

function RewardsEditor({
  rewards,
  roles,
  roleName,
  onChange,
}: {
  rewards: LevelReward[]
  roles: Option[]
  roleName: Map<string, string>
  onChange: (r: LevelReward[]) => void
}) {
  function update(index: number, patch: Partial<LevelReward>) {
    onChange(rewards.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }
  function add() {
    const nextLevel = rewards.length > 0 ? Math.max(...rewards.map((r) => r.level)) + 5 : 5
    onChange([...rewards, { level: nextLevel, role_id: roles[0]?.id ?? '' }])
  }
  return (
    <div className="space-y-2">
      {rewards.length === 0 && <p className="text-xs text-subtle">No reward roles yet. Add one to grant a role at a chosen level.</p>}
      {rewards.map((r, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border p-2" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <span className="text-xs text-subtle">At level</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={r.level}
            onChange={(e) => update(i, { level: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })}
            className="w-20 rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
            style={fieldStyle}
          />
          <span className="text-xs text-subtle">grant</span>
          <select
            value={r.role_id}
            onChange={(e) => update(i, { role_id: e.target.value })}
            className="flex-1 rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
            style={fieldStyle}
          >
            {!roleName.has(r.role_id) && <option value={r.role_id}>{r.role_id ? `Unknown role (${r.role_id})` : 'Select a role…'}</option>}
            {roles.map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
          <button onClick={() => onChange(rewards.filter((_, idx) => idx !== i))} className="shrink-0 rounded-md p-1.5 text-subtle hover:text-foreground" title="Remove reward">
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        disabled={roles.length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}
      >
        <Plus size={14} /> Add reward role
      </button>
    </div>
  )
}

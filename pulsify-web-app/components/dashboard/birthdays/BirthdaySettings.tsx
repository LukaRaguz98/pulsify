'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Cake,
  Bell,
  Clock,
  Globe,
  MessageSquare,
  Image as ImageIcon,
  Link2,
  AlertCircle,
  ArrowLeft,
  X,
  Coins,
  Sparkles,
  Send,
  CheckCircle2,
  Gift,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { SaveBar } from '@/components/ui/save-bar'
import { AppEmbedPreview } from '@/components/dashboard/AppEmbedPreview'
import {
  renderBirthdayMessage,
  formatBirthday,
  MENTION_OPTIONS,
  TIMEZONE_OPTIONS,
  BIRTHDAY_LIMITS,
  type BirthdayConfig,
  type BirthdayMention,
} from '@/lib/birthdays'
import {
  saveBirthdaySettings,
  testBirthdayAnnouncement,
} from '@/app/dashboard/[guildId]/birthdays/actions'

type Option = { id: string; name: string; color?: number }
type Props = {
  guildId: string
  guildName: string
  initialConfig: BirthdayConfig
  channels: Option[]
  roles: Option[]
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function formatHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display}:00 ${period}`
}

export function BirthdaySettings({ guildId, guildName, initialConfig, channels, roles }: Props) {
  const [config, setConfig] = useState<BirthdayConfig>(initialConfig)
  const [snapshot, setSnapshot] = useState<BirthdayConfig>(initialConfig)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testFeedback, setTestFeedback] = useState<string | null>(null)

  function set<K extends keyof BirthdayConfig>(key: K, value: BirthdayConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }))
  }

  const mentionSample =
    config.mention === 'everyone' ? '@everyone' : config.mention === 'here' ? '@here' : '@Ada'
  const messagePreview = renderBirthdayMessage(config.message, {
    user: 'Ada',
    mention: mentionSample,
    server: guildName,
    age: 21,
    date: formatBirthday(3, 14, 2004, true),
  })

  const changedCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(snapshot) as (keyof BirthdayConfig)[]) {
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
    const res = await saveBirthdaySettings(guildId, config)
    if (res.ok) setSnapshot(config)
    else setError(res.error)
    setSaving(false)
  }

  async function handleTest() {
    if (!config.channel_id) {
      setError('Pick an announcement channel first.')
      return
    }
    setTesting(true)
    setTestFeedback(null)
    setError(null)
    const res = await testBirthdayAnnouncement(guildId, config, config.channel_id)
    if (res.ok) setTestFeedback('Test birthday announcement posted.')
    else setError(res.error)
    setTesting(false)
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Birthday settings"
        helpId="birthdays"
        description={
          <>
            Configure birthday announcements, roles and rewards for{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={
          <Link
            href={`/dashboard/${guildId}/birthdays`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to Birthdays
          </Link>
        }
      />

      <div className="space-y-8">
      {error && (
        <div
          className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}
      {testFeedback && (
        <div
          className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.08)', color: '#34d399' }}
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{testFeedback}</span>
          <button onClick={() => setTestFeedback(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Master switch */}
      <CategorySection icon={<Cake size={14} />} title="Birthday celebrations" description="Turn automatic birthday announcements and rewards on or off for this server.">
        <Toggle
          label="Enable birthdays"
          description="When on, Pulse posts a birthday announcement on each member's day. Members set their own birthday with /birthday or from their profile."
          checked={config.enabled}
          onChange={(v) => set('enabled', v)}
        />
      </CategorySection>

      {/* Announcement */}
      <CategorySection icon={<Bell size={14} />} title="Announcement" description="Where and when Pulse celebrates, and what it says.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Bell size={14} /> Channel</label>
            <select
              value={config.channel_id ?? ''}
              onChange={(e) => set('channel_id', e.target.value || null)}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={fieldStyle}
            >
              <option value="">Select a channel…</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Clock size={14} /> Announce time</label>
            <select
              value={config.announce_hour}
              onChange={(e) => set('announce_hour', Number(e.target.value))}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={fieldStyle}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{formatHour(h)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Globe size={14} /> Timezone</label>
            <select
              value={config.timezone}
              onChange={(e) => set('timezone', e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={fieldStyle}
            >
              {TIMEZONE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Mention</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MENTION_OPTIONS.map((o) => {
              const active = config.mention === o.value
              return (
                <button
                  key={o.value}
                  onClick={() => set('mention', o.value as BirthdayMention)}
                  className="rounded-xl border p-3 text-left text-xs font-semibold transition"
                  style={{ borderColor: active ? 'var(--p-1)' : 'var(--line-strong)', background: active ? 'var(--p-soft)' : 'var(--panel)', color: active ? 'var(--p-1)' : 'var(--text)' }}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><MessageSquare size={14} /> Message template</label>
            <textarea
              value={config.message}
              onChange={(e) => set('message', e.target.value.slice(0, BIRTHDAY_LIMITS.maxMessage))}
              rows={4}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={fieldStyle}
            />
            <p className="mt-1.5 text-[11px] text-subtle">
              Placeholders: <code>{'{user}'}</code> <code>{'{mention}'}</code> <code>{'{server}'}</code> <code>{'{age}'}</code> <code>{'{date}'}</code>
            </p>
          </div>
          <div>
            {/* No "Preview" heading — the Discord-style mock speaks for itself,
                the same way the polls / announcements previews read. */}
            <AppEmbedPreview
              title="Happy Birthday"
              content={`${messagePreview}\n-# Turning 21 today`}
              footer="Pulse — Birthday"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <TextField icon={<ImageIcon size={14} />} label="Image URL (optional)" placeholder="https://…" value={config.image_url ?? ''} onChange={(v) => set('image_url', v || null)} />
          <div className="grid grid-cols-2 gap-3">
            <TextField icon={<Link2 size={14} />} label="Button label" placeholder="Celebrate" value={config.button_label ?? ''} onChange={(v) => set('button_label', v || null)} />
            <TextField icon={<Link2 size={14} />} label="Button URL" placeholder="https://…" value={config.button_url ?? ''} onChange={(v) => set('button_url', v || null)} />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing || !config.channel_id}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}
          >
            <Send size={14} /> {testing ? 'Sending…' : 'Send test announcement'}
          </button>
          <span className="text-[11px] text-subtle">Posts a sample to the selected channel.</span>
        </div>
      </CategorySection>

      {/* Birthday role */}
      <CategorySection icon={<Gift size={14} />} title="Birthday role" description="Optionally give members a special role on their birthday that Pulse removes automatically.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Birthday role</label>
            <select
              value={config.role_id ?? ''}
              onChange={(e) => set('role_id', e.target.value || null)}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={fieldStyle}
            >
              <option value="">No birthday role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          {config.role_id && config.role_auto_remove && (
            <NumberField
              icon={<Clock size={14} />}
              label="Keep the role for"
              value={config.role_duration_hours}
              onChange={(v) => set('role_duration_hours', v)}
              min={1}
              max={BIRTHDAY_LIMITS.maxRoleDurationHours}
              suffix="hours"
            />
          )}
        </div>
        {config.role_id && (
          <div className="mt-4 grid gap-3">
            <Toggle
              label="Assign automatically on the day"
              checked={config.role_auto_assign}
              onChange={(v) => set('role_auto_assign', v)}
            />
            <Toggle
              label="Remove automatically after the duration"
              description="When off, the birthday role is kept permanently."
              checked={config.role_auto_remove}
              onChange={(v) => set('role_auto_remove', v)}
            />
          </div>
        )}
      </CategorySection>

      {/* Rewards */}
      <CategorySection icon={<Coins size={14} />} title="Rewards" helpId="birthdays" description="Optional birthday gifts. Reputation stays a computed trust score, so it can't be granted here.">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField icon={<Coins size={14} />} label="Pulse Coins" value={config.reward_coins} onChange={(v) => set('reward_coins', v)} min={0} max={BIRTHDAY_LIMITS.maxRewardCoins} />
          <NumberField icon={<Sparkles size={14} />} label="XP bonus" value={config.reward_xp} onChange={(v) => set('reward_xp', v)} min={0} max={BIRTHDAY_LIMITS.maxRewardXp} />
        </div>
        <div className="mt-4">
          <TokenMultiSelect
            icon={<Gift size={14} />}
            label="Custom reward roles (granted permanently)"
            options={roles}
            selected={config.reward_role_ids}
            onChange={(ids) => set('reward_role_ids', ids.slice(0, BIRTHDAY_LIMITS.maxRewardRoles))}
            emptyHint="No custom reward roles."
          />
        </div>
      </CategorySection>

      <SaveBar
        dirty={dirty}
        changedCount={changedCount}
        saving={saving}
        saveLabel="Save settings"
        cleanText="All birthday settings saved."
        dirtyHintText="review and save to apply them."
        confirmTitle="Save birthday settings?"
        confirmDescription="The channel, time, role and rewards take effect immediately."
        confirmLabel="Save settings"
        onReset={handleReset}
        onSave={handleSave}
      />
      </div>
    </div>
  )
}

// ── Inline field helpers (mirror LevelingSettingsContent) ──────────────────────

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

function TextField({
  label,
  value,
  onChange,
  placeholder,
  icon,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  icon?: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
        style={fieldStyle}
      />
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

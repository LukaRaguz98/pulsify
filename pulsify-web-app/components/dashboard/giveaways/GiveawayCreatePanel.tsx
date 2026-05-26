'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, Gift, Users, AlertCircle, Eye, Sparkles, Plus } from 'lucide-react'
import {
  GIVEAWAY_PRESETS,
  defaultDraft,
  defaultRequirements,
  describeRequirements,
  hasRequirements,
  formatDuration,
  type GiveawayDraft,
  type GiveawayRequirements,
  type Giveaway,
} from '@/lib/giveaways'
import { createGiveaway, updateGiveaway } from '@/app/dashboard/[guildId]/giveaways/actions'
import { GiveawayIcon } from './icons'

type Channel = { id: string; name: string }
type Role = { id: string; name: string; color: number }

type Props = {
  guildId: string
  channels: Channel[]
  roles: Role[]
  editing: Giveaway | null
  onClose: () => void
}

// Minutes presets for the duration picker. `short` is the abbreviation shown as
// a hint so it's obvious the dropdown on the right picks the time unit (m/h/d).
const DURATION_UNITS: { label: string; short: string; minutes: number }[] = [
  { label: 'Minutes', short: 'm', minutes: 1 },
  { label: 'Hours', short: 'h', minutes: 60 },
  { label: 'Days', short: 'd', minutes: 60 * 24 },
]

function splitDuration(minutes: number): { value: number; unit: number } {
  for (const u of [...DURATION_UNITS].reverse()) {
    if (minutes % u.minutes === 0 && minutes >= u.minutes) return { value: minutes / u.minutes, unit: u.minutes }
  }
  return { value: minutes, unit: 1 }
}

// Day-based units for the account-age / server-age requirement pickers. Same
// shape as the duration picker: a number input sits left of this dropdown, and
// the chosen unit multiplies up to the days the bot stores + enforces.
const DAY_UNITS: { label: string; short: string; days: number }[] = [
  { label: 'Days', short: 'd', days: 1 },
  { label: 'Weeks', short: 'w', days: 7 },
  { label: 'Months', short: 'mo', days: 30 },
]

function splitDays(days: number): { value: number; unit: number } {
  for (const u of [...DAY_UNITS].reverse()) {
    if (days % u.days === 0 && days >= u.days) return { value: days / u.days, unit: u.days }
  }
  return { value: days, unit: 1 }
}

export function GiveawayCreatePanel({ guildId, channels, roles, editing, onClose }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const isEdit = editing !== null

  // While the slide-over is open, flag the body so globals.css hides the app
  // footer + top-right corner chrome (otherwise they paint over the panel — the
  // universal `z-index: 1` rule traps the drawer in <main>'s stacking context).
  useEffect(() => {
    document.body.classList.add('slide-over-open')
    return () => document.body.classList.remove('slide-over-open')
  }, [])

  const [draft, setDraft] = useState<GiveawayDraft>(() => {
    if (editing) {
      return {
        title: editing.title,
        description: editing.description ?? '',
        prize: editing.prize,
        channel_id: editing.channel_id,
        winner_count: editing.winner_count,
        duration_minutes: 60 * 24,
        start_delay_minutes: 0,
        requirements: editing.requirements,
        blacklist_user_ids: editing.blacklist_user_ids,
      }
    }
    const d = defaultDraft()
    d.channel_id = channels[0]?.id ?? ''
    return d
  })

  const [durValue, setDurValue] = useState(() => splitDuration(draft.duration_minutes).value)
  const [durUnit, setDurUnit] = useState(() => splitDuration(draft.duration_minutes).unit)
  // Account-age / server-age are stored in days; the form lets the user pick a
  // bigger unit (weeks/months) beside the value, so we keep value + unit split.
  const [acctAge, setAcctAge] = useState(() => splitDays(draft.requirements.min_account_age_days))
  const [serverAge, setServerAge] = useState(() => splitDays(draft.requirements.min_server_age_days))
  const [scheduleStart, setScheduleStart] = useState(false)
  const [startValue, setStartValue] = useState(1)
  const [startUnit, setStartUnit] = useState(60)
  const [blacklistText, setBlacklistText] = useState(() => editing?.blacklist_user_ids.join('\n') ?? '')

  const set = <K extends keyof GiveawayDraft>(key: K, value: GiveawayDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const setReq = <K extends keyof GiveawayRequirements>(key: K, value: GiveawayRequirements[K]) =>
    setDraft((d) => ({ ...d, requirements: { ...d.requirements, [key]: value } }))

  // value × unit → days kept on the draft (the single source of truth the
  // preview + submit read), with the value/unit split mirrored into local state.
  function changeAcctAge(value: number, unit: number) {
    setAcctAge({ value, unit })
    setReq('min_account_age_days', Math.max(0, Math.round(value * unit)))
  }
  function changeServerAge(value: number, unit: number) {
    setServerAge({ value, unit })
    setReq('min_server_age_days', Math.max(0, Math.round(value * unit)))
  }

  function applyPreset(presetId: string) {
    const p = GIVEAWAY_PRESETS.find((x) => x.id === presetId)
    if (!p) return
    const requirements = { ...defaultRequirements(), ...p.requirements }
    setDraft((d) => ({
      ...d,
      title: p.title,
      description: p.description,
      prize: p.prize,
      winner_count: p.winner_count,
      duration_minutes: p.duration_minutes,
      requirements,
    }))
    const split = splitDuration(p.duration_minutes)
    setDurValue(split.value)
    setDurUnit(split.unit)
    setAcctAge(splitDays(requirements.min_account_age_days))
    setServerAge(splitDays(requirements.min_server_age_days))
  }

  function toggleRole(roleId: string) {
    setReq(
      'required_role_ids',
      draft.requirements.required_role_ids.includes(roleId)
        ? draft.requirements.required_role_ids.filter((r) => r !== roleId)
        : [...draft.requirements.required_role_ids, roleId],
    )
  }

  const durationMinutes = Math.max(1, Math.round(durValue * durUnit))
  const startDelayMinutes = scheduleStart ? Math.max(0, Math.round(startValue * startUnit)) : 0

  async function submit() {
    setError(null)
    setSaving(true)
    const blacklist = blacklistText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    const result = isEdit
      ? await updateGiveaway(guildId, editing!.id, {
          title: draft.title,
          description: draft.description,
          prize: draft.prize,
          winner_count: draft.winner_count,
          requirements: draft.requirements,
          blacklist_user_ids: blacklist,
        })
      : await createGiveaway(guildId, {
          ...draft,
          duration_minutes: durationMinutes,
          start_delay_minutes: startDelayMinutes,
          blacklist_user_ids: blacklist,
        })

    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    startTransition(() => router.refresh())
    onClose()
  }

  const busy = saving || pending

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={() => !busy && onClose()}
      />

      <aside
        role="dialog"
        aria-modal="true"
        className="gw-drawer fixed inset-y-0 right-0 z-[70] flex w-full max-w-[560px] flex-col border-l shadow-2xl"
        style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <Gift size={16} />
            </div>
            <h2 className="font-semibold text-foreground">{isEdit ? 'Edit giveaway' : 'New giveaway'}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 transition-colors" style={{ color: 'var(--text-3)' }}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {!isEdit && (
              <div>
                <Label icon={<Sparkles size={13} />}>Start from a template</Label>
                <div className="flex flex-wrap gap-2">
                  {GIVEAWAY_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
                      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                    >
                      <GiveawayIcon name={p.icon} size={13} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Field label="Title">
              <input
                value={draft.title}
                maxLength={100}
                onChange={(e) => set('title', e.target.value)}
                className="gw-input"
                placeholder="🎉 Giveaway"
              />
            </Field>

            <Field label="Prize">
              <input
                value={draft.prize}
                maxLength={200}
                onChange={(e) => set('prize', e.target.value)}
                className="gw-input"
                placeholder="Discord Nitro (1 month)"
              />
            </Field>

            <Field label="Description" hint="optional">
              <textarea
                value={draft.description}
                maxLength={1500}
                rows={3}
                onChange={(e) => set('description', e.target.value)}
                className="gw-input resize-none"
                placeholder="Tell members what this is about…"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Channel">
                <select
                  value={draft.channel_id}
                  disabled={isEdit}
                  onChange={(e) => set('channel_id', e.target.value)}
                  className="gw-input disabled:opacity-60"
                >
                  {channels.length === 0 && <option value="">No channels</option>}
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Winners">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={draft.winner_count}
                  onChange={(e) => set('winner_count', Math.max(1, Number(e.target.value) || 1))}
                  className="gw-input"
                />
              </Field>
            </div>

            {!isEdit && (
              <>
                <Field label="Duration">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={durValue}
                      onChange={(e) => setDurValue(Math.max(1, Number(e.target.value) || 1))}
                      className="gw-input flex-1"
                      style={{ minWidth: 0 }}
                      aria-label="Duration amount"
                    />
                    <select
                      value={durUnit}
                      onChange={(e) => setDurUnit(Number(e.target.value))}
                      className="gw-input flex-1"
                      style={{ minWidth: 0 }}
                      aria-label="Duration time unit"
                    >
                      {DURATION_UNITS.map((u) => (
                        <option key={u.label} value={u.minutes}>
                          {u.label} ({u.short})
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>

                <label className="flex items-center gap-2.5 text-sm" style={{ color: 'var(--text-2)' }}>
                  <input type="checkbox" checked={scheduleStart} onChange={(e) => setScheduleStart(e.target.checked)} />
                  Schedule the start for later
                </label>
                {scheduleStart && (
                  <Field label="Starts in">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={1}
                        value={startValue}
                        onChange={(e) => setStartValue(Math.max(1, Number(e.target.value) || 1))}
                        className="gw-input flex-1"
                        style={{ minWidth: 0 }}
                        aria-label="Start delay amount"
                      />
                      <select
                        value={startUnit}
                        onChange={(e) => setStartUnit(Number(e.target.value))}
                        className="gw-input flex-1"
                        style={{ minWidth: 0 }}
                        aria-label="Start delay time unit"
                      >
                        {DURATION_UNITS.map((u) => (
                          <option key={u.label} value={u.minutes}>
                            {u.label} ({u.short})
                          </option>
                        ))}
                      </select>
                    </div>
                  </Field>
                )}
              </>
            )}

            {/* Requirements */}
            <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--line-strong)' }}>
              <p className="mb-3 text-sm font-semibold text-foreground">Entry requirements</p>

              <Field label="Required roles" hint="leave empty for everyone">
                <div
                  className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border p-2"
                  style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}
                >
                  {roles.length === 0 && <span className="text-xs" style={{ color: 'var(--text-3)' }}>No roles</span>}
                  {roles.map((r) => {
                    const on = draft.requirements.required_role_ids.includes(r.id)
                    const color = r.color ? `#${r.color.toString(16).padStart(6, '0')}` : 'var(--text-2)'
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => toggleRole(r.id)}
                        className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors"
                        style={{
                          borderColor: on ? color : 'var(--line-strong)',
                          background: on ? `${r.color ? color : 'var(--p-1)'}22` : 'transparent',
                          color: on ? color : 'var(--text-3)',
                        }}
                      >
                        {r.name}
                      </button>
                    )
                  })}
                </div>
              </Field>

              {draft.requirements.required_role_ids.length > 1 && (
                <label className="mb-3 mt-3 flex items-center gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
                  <span className="shrink-0">Member must have</span>
                  <select
                    value={draft.requirements.required_role_mode}
                    onChange={(e) => setReq('required_role_mode', e.target.value === 'all' ? 'all' : 'any')}
                    className="gw-input flex-1 px-2 py-1 text-xs"
                  >
                    <option value="any">any of these roles</option>
                    <option value="all">all of these roles</option>
                  </select>
                </label>
              )}

              <div className="mt-3 space-y-3">
                <Field label="Min account age">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      value={acctAge.value}
                      onChange={(e) => changeAcctAge(Math.max(0, Number(e.target.value) || 0), acctAge.unit)}
                      className="gw-input flex-1"
                      style={{ minWidth: 0 }}
                      aria-label="Minimum account age"
                    />
                    <select
                      value={acctAge.unit}
                      onChange={(e) => changeAcctAge(acctAge.value, Number(e.target.value))}
                      className="gw-input flex-1"
                      style={{ minWidth: 0 }}
                      aria-label="Account age unit"
                    >
                      {DAY_UNITS.map((u) => (
                        <option key={u.label} value={u.days}>
                          {u.label} ({u.short})
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>
                <Field label="Min in server">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      value={serverAge.value}
                      onChange={(e) => changeServerAge(Math.max(0, Number(e.target.value) || 0), serverAge.unit)}
                      className="gw-input flex-1"
                      style={{ minWidth: 0 }}
                      aria-label="Minimum time in server"
                    />
                    <select
                      value={serverAge.unit}
                      onChange={(e) => changeServerAge(serverAge.value, Number(e.target.value))}
                      className="gw-input flex-1"
                      style={{ minWidth: 0 }}
                      aria-label="Time in server unit"
                    >
                      {DAY_UNITS.map((u) => (
                        <option key={u.label} value={u.days}>
                          {u.label} ({u.short})
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>
                <Field label="Min messages">
                  <input
                    type="number"
                    min={0}
                    value={draft.requirements.min_messages}
                    onChange={(e) => setReq('min_messages', Math.max(0, Number(e.target.value) || 0))}
                    className="gw-input"
                  />
                </Field>
              </div>

              <label className="mt-3 flex items-center gap-2.5 text-sm" style={{ color: 'var(--text-2)' }}>
                <input
                  type="checkbox"
                  checked={draft.requirements.anti_alt}
                  onChange={(e) => setReq('anti_alt', e.target.checked)}
                />
                Anti-alt protection
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>(account &gt; 30 days unless a stricter age is set)</span>
              </label>
            </div>

            {/* Blacklist */}
            <Field label="Blacklist" hint="user IDs, one per line — barred from entering">
              <textarea
                value={blacklistText}
                rows={2}
                onChange={(e) => setBlacklistText(e.target.value)}
                className="gw-input resize-none font-mono text-xs"
                placeholder="123456789012345678"
              />
            </Field>
          {/* ── Live preview ──────────────────────────────────────── */}
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
            <Label icon={<Eye size={13} />}>Preview</Label>
            <GiveawayPreview draft={draft} durationMinutes={durationMinutes} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3.5" style={{ borderColor: 'var(--line-strong)' }}>
          {error ? (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: '#f87171' }}>
              <AlertCircle size={14} />
              {error}
            </span>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {isEdit ? 'Channel and timing stay as set.' : scheduleStart ? 'Posts when the start time arrives.' : 'Posts to Discord immediately.'}
            </span>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border px-3.5 py-2 text-sm font-medium"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              {isEdit ? <Plus size={15} /> : <Gift size={15} />}
              {busy ? 'Saving…' : isEdit ? 'Save changes' : scheduleStart ? 'Schedule giveaway' : 'Launch giveaway'}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

// ── Live preview (a Discord-style mock of the giveaway message) ───────────────

function GiveawayPreview({ draft, durationMinutes }: { draft: GiveawayDraft; durationMinutes: number }) {
  const req = draft.requirements
  const endLabel = useMemo(() => formatDuration(durationMinutes * 60_000), [durationMinutes])

  return (
    <div className="rounded-xl border-l-4 p-3.5" style={{ borderColor: 'var(--p-1)', background: 'var(--panel)' }}>
      <p className="font-bold text-foreground">🎉 {draft.title || 'Giveaway'}</p>
      {draft.description && (
        <p className="mt-1 whitespace-pre-wrap text-sm" style={{ color: 'var(--text-2)' }}>
          {draft.description}
        </p>
      )}
      <div className="mt-2 space-y-0.5 text-sm" style={{ color: 'var(--text-2)' }}>
        <p>
          <span className="font-semibold text-foreground">Prize:</span> {draft.prize || '—'}
        </p>
        <p>
          <span className="font-semibold text-foreground">Winners:</span> {draft.winner_count}
        </p>
        <p>
          <span className="font-semibold text-foreground">Ends:</span> in {endLabel}
        </p>
      </div>
      {hasRequirements(req) && (
        <div className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
          <p>🔒 Requirements:</p>
          <ul className="mt-0.5 space-y-0.5">
            {describeRequirements(req).map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
          style={{ background: '#5865f2' }}
        >
          <Gift size={13} /> Join Giveaway
        </span>
        <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
          <Users size={12} /> 0 entries
        </span>
      </div>
    </div>
  )
}

// ── Small form primitives ─────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          {label}
        </label>
        {hint && (
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function Label({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
      {icon}
      {children}
    </p>
  )
}

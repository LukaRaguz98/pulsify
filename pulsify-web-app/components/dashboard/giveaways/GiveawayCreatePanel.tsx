'use client'

import { useMemo, useState, useTransition } from 'react'
import Image from 'next/image'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import { useRouter } from 'next/navigation'
import { PreviewStage } from '@/components/dashboard/onboarding/PreviewStage'
import {
  X,
  Gift,
  Users,
  AlertCircle,
  Eye,
  Sparkles,
  Loader2,
  Clock,
  Shield,
  Ban,
} from 'lucide-react'
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

// Shared field look — matches the dashboard's other editors (AutomationEditPanel):
// a darker var(--bg-2) inset sitting on the var(--panel) drawer, so fields read
// clearly in both light and dark themes (the old var(--panel)-on-var(--bg) layout
// made fields blend into the drawer).
const FIELD_CLASS =
  'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-1'
const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}
const errorFieldStyle: React.CSSProperties = { ...fieldStyle, borderColor: 'rgba(239,68,68,0.6)' }

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
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const isEdit = editing !== null

  // While the slide-over is open, flag the body so globals.css hides the app
  // footer + top-right corner chrome (otherwise they paint over the panel — the
  // universal `z-index: 1` rule traps the drawer in <main>'s stacking context).
  useDialogDismiss(onClose, saving || pending)

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

  const roleNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of roles) m.set(r.id, r.name)
    return m
  }, [roles])

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

  // Per-field validation, surfaced inline once a field is touched / on submit.
  const fieldErrors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!draft.title.trim()) e.title = 'Give your giveaway a title.'
    if (!draft.prize.trim()) e.prize = 'Describe the prize.'
    if (!isEdit && !draft.channel_id) e.channel_id = 'Pick a channel to post in.'
    return e
  }, [draft.title, draft.prize, draft.channel_id, isEdit])

  const markTouched = (key: string) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  const showError = (key: string) => touched[key] && fieldErrors[key]

  async function submit() {
    setError(null)
    if (Object.keys(fieldErrors).length > 0) {
      setTouched({ title: true, prize: true, channel_id: true })
      setError('Fix the highlighted fields before publishing.')
      return
    }
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
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit giveaway' : 'New giveaway'}
        className="relative flex w-full max-w-2xl max-h-[90vh] flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <Gift size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">{isEdit ? 'Edit giveaway' : 'New giveaway'}</h2>
              <p className="truncate text-xs text-subtle">
                {isEdit ? 'Update the details — channel and timing stay as set.' : 'Set it up, preview the embed, and publish to Discord.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Templates */}
          {!isEdit && (
            <Section icon={<Sparkles size={13} />} label="Start from a template" description="Pre-fill the form for a common giveaway, then tweak it.">
              <div className="flex flex-wrap gap-2">
                {GIVEAWAY_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
                    style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}
                  >
                    <GiveawayIcon name={p.icon} size={13} />
                    {p.label}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* Details */}
          <Section icon={<Gift size={13} />} label="Details" description="What members are entering for.">
            <Field label="Title" error={showError('title') ? fieldErrors.title : undefined}>
              <input
                value={draft.title}
                maxLength={100}
                onChange={(e) => set('title', e.target.value)}
                onBlur={() => markTouched('title')}
                className={FIELD_CLASS}
                style={showError('title') ? errorFieldStyle : fieldStyle}
                placeholder="🎉 Giveaway"
              />
            </Field>

            <Field label="Prize" error={showError('prize') ? fieldErrors.prize : undefined}>
              <input
                value={draft.prize}
                maxLength={200}
                onChange={(e) => set('prize', e.target.value)}
                onBlur={() => markTouched('prize')}
                className={FIELD_CLASS}
                style={showError('prize') ? errorFieldStyle : fieldStyle}
                placeholder="Discord Nitro (1 month)"
              />
            </Field>

            <Field label="Description" hint="optional">
              <textarea
                value={draft.description}
                maxLength={1500}
                rows={3}
                onChange={(e) => set('description', e.target.value)}
                className={`${FIELD_CLASS} resize-none`}
                style={fieldStyle}
                placeholder="Tell members what this is about…"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Channel" error={showError('channel_id') ? fieldErrors.channel_id : undefined}>
                <select
                  value={draft.channel_id}
                  disabled={isEdit}
                  onChange={(e) => set('channel_id', e.target.value)}
                  onBlur={() => markTouched('channel_id')}
                  className={`${FIELD_CLASS} disabled:opacity-60`}
                  style={showError('channel_id') ? errorFieldStyle : fieldStyle}
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
                  className={FIELD_CLASS}
                  style={fieldStyle}
                />
              </Field>
            </div>
          </Section>

          {/* Timing (create only) */}
          {!isEdit && (
            <Section icon={<Clock size={13} />} label="Timing" description="How long it runs, and when it starts.">
              <Field label="Duration">
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={durValue}
                    onChange={(e) => setDurValue(Math.max(1, Number(e.target.value) || 1))}
                    className={`${FIELD_CLASS} flex-1`}
                    style={{ ...fieldStyle, minWidth: 0 }}
                    aria-label="Duration amount"
                  />
                  <select
                    value={durUnit}
                    onChange={(e) => setDurUnit(Number(e.target.value))}
                    className={`${FIELD_CLASS} flex-1`}
                    style={{ ...fieldStyle, minWidth: 0 }}
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
                <input type="checkbox" className="accent-[var(--p-1)]" checked={scheduleStart} onChange={(e) => setScheduleStart(e.target.checked)} />
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
                      className={`${FIELD_CLASS} flex-1`}
                      style={{ ...fieldStyle, minWidth: 0 }}
                      aria-label="Start delay amount"
                    />
                    <select
                      value={startUnit}
                      onChange={(e) => setStartUnit(Number(e.target.value))}
                      className={`${FIELD_CLASS} flex-1`}
                      style={{ ...fieldStyle, minWidth: 0 }}
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
            </Section>
          )}

          {/* Requirements */}
          <Section icon={<Shield size={13} />} label="Entry requirements" description="Optional gates an entrant must pass to join.">
            <Field label="Required roles" hint="leave empty for everyone">
              <div
                className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border p-2"
                style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
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
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
                <span className="shrink-0">Member must have</span>
                <select
                  value={draft.requirements.required_role_mode}
                  onChange={(e) => setReq('required_role_mode', e.target.value === 'all' ? 'all' : 'any')}
                  className={`${FIELD_CLASS} flex-1 px-2 py-1 text-xs`}
                  style={fieldStyle}
                >
                  <option value="any">any of these roles</option>
                  <option value="all">all of these roles</option>
                </select>
              </label>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Min account age">
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    value={acctAge.value}
                    onChange={(e) => changeAcctAge(Math.max(0, Number(e.target.value) || 0), acctAge.unit)}
                    className={`${FIELD_CLASS} flex-1`}
                    style={{ ...fieldStyle, minWidth: 0 }}
                    aria-label="Minimum account age"
                  />
                  <select
                    value={acctAge.unit}
                    onChange={(e) => changeAcctAge(acctAge.value, Number(e.target.value))}
                    className={`${FIELD_CLASS} flex-1`}
                    style={{ ...fieldStyle, minWidth: 0 }}
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
                    className={`${FIELD_CLASS} flex-1`}
                    style={{ ...fieldStyle, minWidth: 0 }}
                    aria-label="Minimum time in server"
                  />
                  <select
                    value={serverAge.unit}
                    onChange={(e) => changeServerAge(serverAge.value, Number(e.target.value))}
                    className={`${FIELD_CLASS} flex-1`}
                    style={{ ...fieldStyle, minWidth: 0 }}
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
            </div>

            <Field label="Min messages" hint="tracked messages sent in this server">
              <input
                type="number"
                min={0}
                value={draft.requirements.min_messages}
                onChange={(e) => setReq('min_messages', Math.max(0, Number(e.target.value) || 0))}
                className={FIELD_CLASS}
                style={fieldStyle}
              />
            </Field>

            <label className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}>
              <input
                type="checkbox"
                className="accent-[var(--p-1)]"
                checked={draft.requirements.anti_alt}
                onChange={(e) => setReq('anti_alt', e.target.checked)}
              />
              <span className="min-w-0">
                Anti-alt protection
                <span className="ml-1 text-xs" style={{ color: 'var(--text-3)' }}>(account 30+ days unless a stricter age is set)</span>
              </span>
            </label>
          </Section>

          {/* Blacklist */}
          <Section icon={<Ban size={13} />} label="Blacklist" description="User IDs barred from entering — one per line.">
            <textarea
              value={blacklistText}
              rows={2}
              onChange={(e) => setBlacklistText(e.target.value)}
              className={`${FIELD_CLASS} resize-none font-mono text-xs`}
              style={fieldStyle}
              placeholder="123456789012345678"
            />
          </Section>

          {/* Live preview */}
          <Section icon={<Eye size={13} />} label="Preview" description="How the giveaway appears in Discord.">
            <GiveawayPreview draft={draft} durationMinutes={durationMinutes} roleNameById={roleNameById} />
          </Section>
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-between gap-3 border-t px-5 py-3.5"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          {error ? (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: '#f87171' }}>
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </span>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {isEdit ? 'Channel and timing stay as set.' : scheduleStart ? 'Posts when the start time arrives.' : 'Posts to Discord immediately.'}
            </span>
          )}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Gift size={15} />}
              {busy ? 'Saving…' : isEdit ? 'Save changes' : scheduleStart ? 'Schedule giveaway' : 'Launch giveaway'}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}

// ── Live preview ──────────────────────────────────────────────────────────────
// Renders the giveaway on the shared Pulse embed stage — the same bot-avatar
// row + translucent glass V2 container the onboarding, self-roles and message
// previews use — so the giveaway preview reads identically to every other embed
// preview in the app. Kept in lock-step with the embed built in actions.ts /
// giveaways.js: title, description, Prize / Winners / Ends fields, a compact
// requirements line, the Join button, and the `Pulse — Giveaway` footer.

function GiveawayPreview({
  draft,
  durationMinutes,
  roleNameById,
}: {
  draft: GiveawayDraft
  durationMinutes: number
  roleNameById: Map<string, string>
}) {
  const req = draft.requirements
  const accent = 'var(--p-1)'
  const endLabel = useMemo(() => formatDuration(durationMinutes * 60_000), [durationMinutes])
  const reqText = useMemo(
    () => describeRequirements(req, (id) => roleNameById.get(id) ?? 'a role').join(' · '),
    [req, roleNameById],
  )
  // Client-only clock — computed once at mount (this preview only ever renders
  // inside the create modal, never on the server), the same way the self-roles
  // preview does it, so there's no SSR/CSR drift and no effect.
  const [timeStr] = useState(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))

  const fields: { name: string; value: string }[] = [
    { name: 'Prize', value: draft.prize || '—' },
    { name: 'Winners', value: String(draft.winner_count) },
    { name: 'Ends', value: `in ${endLabel}` },
  ]

  return (
    <PreviewStage>
      <div style={{ fontFamily: "'gg sans', 'Noto Sans', Arial, sans-serif" }}>
        <div className="flex items-start gap-2.5 sm:gap-4">
          {/* Bot avatar */}
          <Image
            src="/logo.png"
            alt="Pulse"
            width={40}
            height={40}
            className="h-9 w-9 sm:h-10 sm:w-10"
            style={{ flexShrink: 0, borderRadius: '50%', marginTop: '2px', objectFit: 'cover' }}
          />

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Username row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: '14px' }}>Pulse</span>
              <span style={{
                background: '#5865f2', color: '#ffffff',
                borderRadius: '3px', padding: '1px 5px',
                fontSize: '9px', fontWeight: 700,
                letterSpacing: '0.4px', textTransform: 'uppercase', lineHeight: '1.4',
              }}>APP</span>
              <span style={{ color: 'var(--text-3)', fontSize: '12px' }}>Today at {timeStr}</span>
            </div>

            {/* Translucent glass V2 container with the left accent stripe */}
            <div style={{
              background: 'color-mix(in srgb, var(--panel-2) 55%, transparent)',
              border: '1px solid var(--line)',
              borderLeftWidth: '3px',
              borderLeftColor: accent,
              borderRadius: '8px',
              overflow: 'hidden',
              maxWidth: '432px',
              padding: '12px 16px',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 20px 55px -26px color-mix(in srgb, var(--text) 30%, transparent)',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
            }}>
              {/* Pulse label — matches the `**Pulse**` line the bot opens with. */}
              <div style={{ color: 'var(--text-2)', fontWeight: 700, fontSize: '12px', marginBottom: '2px' }}>Pulse</div>

              {/* Title — H1 heading */}
              <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '20px', margin: '0 0 6px', lineHeight: '1.3' }}>
                {draft.title || 'Giveaway'}
              </div>

              {/* Description — falls back to the posted embed's default blurb */}
              <div style={{ color: 'var(--text-2)', fontSize: '14px', margin: '0 0 10px', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                {draft.description || 'Click Join Giveaway below for your chance to win!'}
              </div>

              {/* Prize / Winners / Ends — stacked bold-label blocks, matching
                  the DiscordEmbedPreview field layout used elsewhere. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
                {fields.map((f) => (
                  <div key={f.name}>
                    <div style={{ color: 'var(--text)', fontSize: '14px', fontWeight: 700, margin: '0 0 2px' }}>{f.name}</div>
                    <div style={{ color: 'var(--text-2)', fontSize: '14px', lineHeight: '1.45' }}>{f.value}</div>
                  </div>
                ))}
              </div>

              {/* Requirements — one compact subtext line (no emoji, per the
                  embed house style). */}
              {hasRequirements(req) && (
                <div style={{ color: 'var(--text-3)', fontSize: '12px', lineHeight: '1.4', marginBottom: '10px' }}>
                  <strong style={{ color: 'var(--text-2)' }}>Requirements:</strong> {reqText}
                </div>
              )}

              {/* Join button + entries counter — the message's action row,
                  rendered as pills the same way self-roles renders its role
                  buttons inside the container. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  borderRadius: '4px', padding: '8px 14px',
                  fontSize: '13px', fontWeight: 600, color: '#ffffff',
                  background: '#5865f2',
                }}>
                  <Gift size={14} /> Join Giveaway
                </span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  fontSize: '12px', color: 'var(--text-3)',
                }}>
                  <Users size={12} /> 0 entries
                </span>
              </div>

              {/* Divider + footer — the standardized Pulse v2 close. */}
              <div style={{ borderTop: '1px solid var(--line-strong)', margin: '12px 0 8px' }} />
              <div style={{ color: 'var(--text-3)', fontSize: '12px', lineHeight: '1.3' }}>Pulse — Giveaway</div>
            </div>
          </div>
        </div>
      </div>
    </PreviewStage>
  )
}

// ── Small form primitives ─────────────────────────────────────────────────────

function Section({
  icon,
  label,
  description,
  children,
}: {
  icon: React.ReactNode
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--bg-2)', color: 'var(--text-3)', border: '1px solid var(--line-strong)' }}>
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>{label}</h3>
          {description && <p className="text-xs text-subtle">{description}</p>}
        </div>
        <div className="ml-1 h-px flex-1" style={{ background: 'var(--line-strong)' }} />
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        {hint && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{hint}</span>}
      </div>
      {children}
      {error && (
        <p className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: '#f87171' }}>
          <AlertCircle size={11} />
          {error}
        </p>
      )}
    </div>
  )
}

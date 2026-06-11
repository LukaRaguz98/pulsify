'use client'

import { useEffect, useMemo, useState } from 'react'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import {
  X,
  Loader2,
  Save,
  Power,
  Clock,
  Zap,
  SlidersHorizontal,
  Gauge,
  AlertTriangle,
  Check,
  CalendarClock,
  Play,
  Globe,
} from 'lucide-react'
import type { DiscordChannel, DiscordRole } from '@/lib/discord'
import { roleColor } from '@/lib/discord'
import {
  ACTION_CATALOG,
  ACTION_BY_TYPE,
  SCHEDULE_META,
  WEEKDAY_LABELS,
  computeNextRun,
  validateDraft,
  defaultActionConfig,
  defaultDraft,
  isValidCron,
  normaliseDraft,
  type Automation,
  type AutomationDraft,
  type ActionType,
  type ScheduleType,
  type IntervalUnit,
  type ActionFieldDef,
} from '@/lib/automations'
import { ActionIcon } from './icons'
import { saveAutomation, runAutomationNow } from '@/app/dashboard/[guildId]/(management)/scheduled/actions'

type Props = {
  guildId: string
  channels: DiscordChannel[]
  roles: DiscordRole[]
  /** The workflow being edited, or null when creating a new one. */
  automation: Automation | null
  /** Optional preset draft to seed a brand-new workflow. */
  seed?: AutomationDraft | null
  onClose: () => void
  onSaved: () => void
}

function toDraft(a: Automation): AutomationDraft {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    action_type: a.action_type,
    action_config: { ...a.action_config },
    schedule_type: a.schedule_type,
    schedule_config: { ...a.schedule_config },
    timezone: a.timezone,
    conditions: { ...a.conditions },
    cooldown_minutes: a.cooldown_minutes,
    max_retries: a.max_retries,
  }
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

export function AutomationEditPanel({
  guildId,
  channels,
  roles,
  automation,
  seed,
  onClose,
  onSaved,
}: Props) {
  // The schedule's wall-clock times are interpreted in the viewer's own
  // timezone, captured automatically from the browser — there's no picker to
  // fuss with. The bot stores this IANA zone and resolves fire times against it.
  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }, [])
  const initial = useMemo<AutomationDraft>(() => {
    const base = automation ? toDraft(automation) : seed ?? defaultDraft()
    return { ...base, timezone: browserTz }
  }, [automation, seed, browserTz])
  const [draft, setDraft] = useState<AutomationDraft>(initial)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useDialogDismiss(onClose, busy)

  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(null), 3000)
    return () => clearTimeout(t)
  }, [success])

  function patch(p: Partial<AutomationDraft>) {
    setDraft((d) => ({ ...d, ...p }))
    setError(null)
  }

  function patchAction(key: string, value: unknown) {
    setDraft((d) => ({ ...d, action_config: { ...d.action_config, [key]: value } }))
    setError(null)
  }

  function patchSchedule(p: Partial<AutomationDraft['schedule_config']>) {
    setDraft((d) => ({ ...d, schedule_config: { ...d.schedule_config, ...p } }))
    setError(null)
  }

  function changeActionType(type: ActionType) {
    // Reset to that action's defaults — keeps the config valid for the new type.
    patch({ action_type: type, action_config: defaultActionConfig(type) })
  }

  function changeScheduleType(type: ScheduleType) {
    const base =
      type === 'daily'
        ? { time: '09:00' }
        : type === 'weekly'
          ? { time: '09:00', days: [1] }
          : type === 'monthly'
            ? { time: '09:00', day: 1 }
            : type === 'interval'
              ? { every: 6, unit: 'hours' as IntervalUnit }
              : { expr: '0 9 * * 1-5' }
    patch({ schedule_type: type, schedule_config: base })
  }

  // Live next-run preview, recomputed from the current draft.
  const nextRun = useMemo(() => {
    try {
      return computeNextRun(draft.schedule_type, draft.schedule_config, draft.timezone)
    } catch {
      return null
    }
  }, [draft.schedule_type, draft.schedule_config, draft.timezone])

  async function persist(): Promise<string | null> {
    // Check the name on the raw draft first — normalisation would otherwise
    // auto-fill a blank name and hide the "name required" feedback.
    if (!draft.name.trim()) {
      setError('Give your workflow a name.')
      return null
    }
    const validationError = validateDraft(normaliseDraft(draft))
    if (validationError) {
      setError(validationError)
      return null
    }
    const res = await saveAutomation(guildId, draft)
    if (!res.ok) {
      setError(res.error)
      return null
    }
    return res.data.id
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSuccess(null)
    const id = await persist()
    setBusy(false)
    if (!id) return
    setSuccess('Workflow saved.')
    onSaved()
    onClose()
  }

  // Test = save (so the bot has the latest config) then request a one-off run.
  async function test() {
    setTesting(true)
    setError(null)
    setSuccess(null)
    const id = await persist()
    if (!id) {
      setTesting(false)
      return
    }
    const res = await runAutomationNow(guildId, id)
    setTesting(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSuccess('Test run requested — watch the Logs tab for the result.')
    onSaved()
  }

  const actionDef = ACTION_BY_TYPE[draft.action_type]

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && !testing && onClose()}
    >
      <aside
        role="dialog"
        aria-label={automation ? `Edit ${automation.name}` : 'New workflow'}
        className="relative flex w-full max-w-2xl max-h-[90vh] flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-foreground">
              {automation ? 'Edit workflow' : 'New workflow'}
            </h2>
            <p className="truncate text-xs text-subtle">
              Pick a schedule and an action. Pulse runs it automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy || testing}
            className="rounded p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <Banner tone="error">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </Banner>
          )}
          {success && (
            <Banner tone="success">
              <Check size={12} className="mt-0.5 shrink-0" />
              <span>{success}</span>
            </Banner>
          )}

          {/* Basics */}
          <Section icon={<Power size={13} />} label="Basics" description="Name your workflow and choose whether it's active.">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Workflow name</label>
              <input
                type="text"
                value={draft.name}
                maxLength={100}
                disabled={busy}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Daily good-morning post"
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={fieldStyle}
              />
            </div>
            <PanelToggle
              label="Enabled"
              description="When off, the workflow is saved but won't run on its schedule."
              checked={draft.enabled}
              disabled={busy}
              onChange={(v) => patch({ enabled: v })}
            />
          </Section>

          {/* Trigger / schedule */}
          <Section icon={<Clock size={13} />} label="Trigger" description="When should this run?">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Schedule</label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(SCHEDULE_META) as ScheduleType[]).map((st) => (
                  <button
                    key={st}
                    type="button"
                    disabled={busy}
                    onClick={() => changeScheduleType(st)}
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium transition"
                    style={
                      draft.schedule_type === st
                        ? { borderColor: 'var(--p-1)', background: 'var(--p-soft)', color: 'var(--p-1)' }
                        : { borderColor: 'var(--line-strong)', color: 'var(--text-3)' }
                    }
                  >
                    {SCHEDULE_META[st].label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-subtle">{SCHEDULE_META[draft.schedule_type].description}</p>
            </div>

            <ScheduleFields draft={draft} disabled={busy} onTime={(t) => patchSchedule({ time: t })} patchSchedule={patchSchedule} />

            {/* No timezone picker — times resolve in the viewer's own
                (auto-detected) local zone. Shown here for transparency. */}
            {draft.schedule_type !== 'interval' && (
              <p className="flex items-center gap-1.5 text-[11px] text-subtle">
                <Globe size={11} />
                Times are in your local timezone ({draft.timezone}).
              </p>
            )}

            {/* Next-run preview */}
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
            >
              <CalendarClock size={13} style={{ color: 'var(--p-1)' }} />
              {nextRun ? (
                <span style={{ color: 'var(--text-2)' }}>
                  Next run: <span className="font-medium text-foreground">{nextRun.toLocaleString()}</span>
                  <span className="text-subtle"> (your local time)</span>
                </span>
              ) : (
                <span style={{ color: '#f87171' }}>Schedule is incomplete or invalid — no next run.</span>
              )}
            </div>
          </Section>

          {/* Action */}
          <Section icon={<Zap size={13} />} label="Action" description="What should Pulse do when it runs?">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
              {ACTION_CATALOG.map((a) => {
                const active = draft.action_type === a.type
                return (
                  <button
                    key={a.type}
                    type="button"
                    disabled={busy}
                    onClick={() => changeActionType(a.type)}
                    className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition"
                    style={
                      active
                        ? { borderColor: a.color, background: `${a.color}14` }
                        : { borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }
                    }
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${a.color}1f`, color: a.color }}>
                      <ActionIcon name={a.icon} size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-foreground">{a.label}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-subtle">{actionDef.description}</p>

            <div className="space-y-3 border-t pt-3" style={{ borderColor: 'var(--line-strong)' }}>
              {actionDef.fields.map((f) => (
                <ActionFieldInput
                  key={f.key}
                  field={f}
                  value={draft.action_config[f.key]}
                  channels={channels}
                  roles={roles}
                  disabled={busy}
                  onChange={(v) => patchAction(f.key, v)}
                  // Hide the inactivity role picker unless "remove a role" is chosen.
                  hidden={
                    draft.action_type === 'inactivity_cleanup' &&
                    f.key === 'role_id' &&
                    draft.action_config.mode !== 'remove_role'
                  }
                />
              ))}
            </div>
          </Section>

          {/* Conditions */}
          <Section icon={<SlidersHorizontal size={13} />} label="Conditions" description="Optionally gate the run on the server's size.">
            <div className="grid gap-3 sm:grid-cols-2">
              <ConditionField
                label="Min. members"
                hint="Skip if the server is smaller. Blank = no minimum."
                value={draft.conditions.min_members}
                disabled={busy}
                onChange={(v) => patch({ conditions: { ...draft.conditions, min_members: v } })}
              />
              <ConditionField
                label="Max. members"
                hint="Skip if the server is larger. Blank = no maximum."
                value={draft.conditions.max_members}
                disabled={busy}
                onChange={(v) => patch({ conditions: { ...draft.conditions, max_members: v } })}
              />
            </div>
          </Section>

          {/* Limits */}
          <Section icon={<Gauge size={13} />} label="Reliability" description="Throttle reruns and retry on failure.">
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Cooldown (minutes)"
                hint="Minimum minutes between runs. 0 = none."
                value={draft.cooldown_minutes}
                min={0}
                max={525600}
                disabled={busy}
                onChange={(v) => patch({ cooldown_minutes: v })}
              />
              <NumberField
                label="Retries on failure"
                hint="Extra attempts if the action errors. 0–5."
                value={draft.max_retries}
                min={0}
                max={5}
                disabled={busy}
                onChange={(v) => patch({ max_retries: v })}
              />
            </div>
          </Section>
        </div>

        <footer
          className="flex items-center justify-between gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
        >
          <button
            type="button"
            onClick={test}
            disabled={busy || testing}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            title="Save and trigger a one-off run now"
          >
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {testing ? 'Testing…' : 'Test run'}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy || testing}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || testing}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50"
              style={{ background: 'linear-gradient(180deg, var(--p-1) 0%, var(--p-2) 100%)', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {busy ? 'Saving…' : automation ? 'Save changes' : 'Create workflow'}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}

// ── Schedule sub-fields ────────────────────────────────────────────────────────

function ScheduleFields({
  draft,
  disabled,
  onTime,
  patchSchedule,
}: {
  draft: AutomationDraft
  disabled: boolean
  onTime: (t: string) => void
  patchSchedule: (p: Partial<AutomationDraft['schedule_config']>) => void
}) {
  const sc = draft.schedule_config
  if (draft.schedule_type === 'interval') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Every"
          value={sc.every ?? 1}
          min={1}
          max={sc.unit === 'minutes' ? 10080 : sc.unit === 'days' ? 365 : 8760}
          disabled={disabled}
          onChange={(v) => patchSchedule({ every: v })}
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Unit</label>
          <select
            value={sc.unit ?? 'hours'}
            disabled={disabled}
            onChange={(e) => patchSchedule({ unit: e.target.value as IntervalUnit })}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
            style={fieldStyle}
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </div>
      </div>
    )
  }

  if (draft.schedule_type === 'cron') {
    const valid = isValidCron(sc.expr ?? '')
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Cron expression</label>
        <input
          type="text"
          value={sc.expr ?? ''}
          disabled={disabled}
          onChange={(e) => patchSchedule({ expr: e.target.value })}
          placeholder="0 9 * * 1-5"
          className="w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1"
          style={{ ...fieldStyle, borderColor: valid ? 'var(--line-strong)' : 'rgba(239,68,68,0.5)' }}
        />
        <p className="mt-1 text-[11px] text-subtle">
          5 fields: minute hour day-of-month month day-of-week. Example{' '}
          <code className="font-mono">0 9 * * 1-5</code> = 9:00 on weekdays.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {draft.schedule_type === 'weekly' && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Days</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, i) => {
              const selected = (sc.days ?? []).includes(i)
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const days = new Set(sc.days ?? [])
                    if (days.has(i)) days.delete(i)
                    else days.add(i)
                    patchSchedule({ days: [...days].sort((a, b) => a - b) })
                  }}
                  className="h-9 w-11 rounded-lg border text-xs font-medium transition"
                  style={
                    selected
                      ? { borderColor: 'var(--p-1)', background: 'var(--p-soft)', color: 'var(--p-1)' }
                      : { borderColor: 'var(--line-strong)', color: 'var(--text-3)' }
                  }
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {draft.schedule_type === 'monthly' && (
        <NumberField
          label="Day of month"
          hint="1–31. Months shorter than this run on their last day."
          value={sc.day ?? 1}
          min={1}
          max={31}
          disabled={disabled}
          onChange={(v) => patchSchedule({ day: v })}
        />
      )}

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Time</label>
        <input
          type="time"
          value={sc.time ?? '09:00'}
          disabled={disabled}
          onChange={(e) => onTime(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
          style={fieldStyle}
        />
      </div>
    </div>
  )
}

// ── Action field input ─────────────────────────────────────────────────────────

function ActionFieldInput({
  field,
  value,
  channels,
  roles,
  disabled,
  hidden,
  onChange,
}: {
  field: ActionFieldDef
  value: unknown
  channels: DiscordChannel[]
  roles: DiscordRole[]
  disabled: boolean
  hidden?: boolean
  onChange: (v: unknown) => void
}) {
  if (hidden) return null
  const labelEl = (
    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
      {field.label}
      {field.required && <span className="ml-1 text-[#f87171]">*</span>}
    </label>
  )

  let control: React.ReactNode
  if (field.kind === 'channel') {
    control = (
      <select value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
        <option value="">Select a channel</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>#{c.name}</option>
        ))}
      </select>
    )
  } else if (field.kind === 'role') {
    control = (
      <select value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
        <option value="">Select a role</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id} style={r.color ? { color: roleColor(r.color) } : undefined}>{r.name}</option>
        ))}
      </select>
    )
  } else if (field.kind === 'select') {
    control = (
      <select value={String(value ?? field.default ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle}>
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  } else if (field.kind === 'message') {
    control = (
      <textarea value={String(value ?? '')} disabled={disabled} rows={3} maxLength={4000} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
    )
  } else if (field.kind === 'number') {
    control = (
      <input
        type="number"
        value={Number(value ?? field.default ?? 0)}
        min={field.min}
        max={field.max}
        disabled={disabled}
        onChange={(e) => {
          const n = Math.floor(Number(e.target.value))
          const lo = field.min ?? 0
          const hi = field.max ?? 1_000_000
          onChange(Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo)
        }}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
        style={fieldStyle}
      />
    )
  } else {
    control = (
      <input type="text" value={String(value ?? '')} disabled={disabled} maxLength={200} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1" style={fieldStyle} />
    )
  }

  return (
    <div>
      {labelEl}
      {control}
      {field.hint && <p className="mt-1 text-[11px] text-subtle">{field.hint}</p>}
    </div>
  )
}

// ── Shared bits (mirrors CommandEditPanel) ─────────────────────────────────────

function Banner({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const styles =
    tone === 'error'
      ? { borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }
      : { borderColor: 'rgba(74,222,128,0.35)', background: 'rgba(74,222,128,0.08)', color: '#4ade80' }
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={styles}>
      {children}
    </div>
  )
}

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

function PanelToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[var(--p-1)]" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>}
      </div>
    </label>
  )
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const n = Math.floor(Number(e.target.value))
          onChange(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min)
        }}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
        style={fieldStyle}
      />
      {hint && <p className="mt-1 text-[11px] text-subtle">{hint}</p>}
    </div>
  )
}

function ConditionField({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  value: number | undefined
  disabled?: boolean
  onChange: (v: number | undefined) => void
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value ?? ''}
        min={0}
        disabled={disabled}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') return onChange(undefined)
          const n = Math.floor(Number(raw))
          onChange(Number.isFinite(n) ? Math.max(0, n) : undefined)
        }}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
        style={fieldStyle}
      />
      {hint && <p className="mt-1 text-[11px] text-subtle">{hint}</p>}
    </div>
  )
}

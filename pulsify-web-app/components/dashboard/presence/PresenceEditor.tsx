'use client'

import { Plus, Wrench } from 'lucide-react'
import {
  STATUS_OPTIONS,
  ACTIVITY_KINDS,
  PRESENCE_LIMITS,
  MAINTENANCE_DEFAULT_TEXT,
  normaliseTime,
  type PresenceDraft,
  type PresenceActivity,
  type PresenceSchedule,
  type ActivityKind,
} from '@/lib/presence'
import { ActivityRow } from './ActivityRow'

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type FieldProps = {
  draft: PresenceDraft
  setDraft: (next: PresenceDraft) => void
  disabled?: boolean
}

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{ background: checked ? 'var(--p-1)' : 'var(--line-strong)' }}
    >
      <span
        className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(24px)' : 'translateX(4px)' }}
      />
    </button>
  )
}

// ── Status + activities ──────────────────────────────────────────────────────

export function StatusActivitiesField({ draft, setDraft, disabled }: FieldProps) {
  const patch = (p: Partial<PresenceDraft>) => setDraft({ ...draft, ...p })

  const setActivity = (i: number, next: PresenceActivity) => {
    const activities = draft.activities.slice()
    activities[i] = next
    patch({ activities })
  }
  const removeActivity = (i: number) => patch({ activities: draft.activities.filter((_, j) => j !== i) })
  const moveActivity = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= draft.activities.length) return
    const activities = draft.activities.slice()
    ;[activities[i], activities[j]] = [activities[j], activities[i]]
    patch({ activities })
  }
  const addActivity = () => {
    if (draft.activities.length >= PRESENCE_LIMITS.maxActivities) return
    patch({ activities: [...draft.activities, { kind: 'playing', text: '' }] })
  }

  return (
    <div className="space-y-6 rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      {/* Status */}
      <div>
        <label className="block text-sm font-semibold text-foreground">Status</label>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
          The coloured dot shown on Pulse&apos;s avatar.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((s) => {
            const active = draft.status === s.value
            return (
              <button
                key={s.value}
                type="button"
                disabled={disabled}
                onClick={() => patch({ status: s.value })}
                className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all disabled:opacity-50"
                style={{
                  background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                  borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                  color: active ? 'var(--text)' : 'var(--text-2)',
                }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Activities */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-semibold text-foreground">Activities</label>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
              What Pulse is &quot;playing / watching / …&quot;. Use placeholders for live counts.
            </p>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            {draft.activities.length}/{PRESENCE_LIMITS.maxActivities}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {draft.activities.map((a, i) => (
            <ActivityRow
              key={i}
              activity={a}
              index={i}
              total={draft.activities.length}
              disabled={disabled}
              onChange={(next) => setActivity(i, next)}
              onRemove={() => removeActivity(i)}
              onMove={(dir) => moveActivity(i, dir)}
            />
          ))}
          {draft.activities.length === 0 && (
            <p className="rounded-lg border border-dashed py-4 text-center text-sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
              No activities yet.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={addActivity}
          disabled={disabled || draft.activities.length >= PRESENCE_LIMITS.maxActivities}
          className="mt-2 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          <Plus size={14} /> Add activity
        </button>
      </div>
    </div>
  )
}

// ── Rotation + schedule windows ──────────────────────────────────────────────

export function RotationScheduleField({ draft, setDraft, disabled }: FieldProps) {
  const patch = (p: Partial<PresenceDraft>) => setDraft({ ...draft, ...p })

  const setSchedule = (i: number, next: PresenceSchedule) => {
    const schedules = draft.schedules.slice()
    schedules[i] = next
    patch({ schedules })
  }
  const removeSchedule = (i: number) => patch({ schedules: draft.schedules.filter((_, j) => j !== i) })
  const addSchedule = () => {
    if (draft.schedules.length >= PRESENCE_LIMITS.maxSchedules) return
    patch({
      schedules: [
        ...draft.schedules,
        { days: [], start: '09:00', end: '17:00', activity: { kind: 'playing', text: '' } },
      ],
    })
  }

  return (
    <div className="space-y-6">
      {/* Rotation */}
      <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Rotate activities</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
              Cycle through the list. Off shows only the first activity.
            </p>
          </div>
          <Switch checked={draft.rotationEnabled} onChange={(v) => patch({ rotationEnabled: v })} disabled={disabled} label="Rotate activities" />
        </div>
        {draft.rotationEnabled && (
          <div className="mt-4 flex items-center gap-3">
            <label className="text-sm" style={{ color: 'var(--text-2)' }}>
              Interval
            </label>
            <input
              type="range"
              min={PRESENCE_LIMITS.minIntervalSeconds}
              max={300}
              step={5}
              value={Math.min(300, draft.rotationIntervalSeconds)}
              disabled={disabled}
              onChange={(e) => patch({ rotationIntervalSeconds: Number(e.target.value) })}
              className="flex-1 accent-[var(--p-1)]"
            />
            <span className="w-14 text-right text-sm font-medium text-foreground">{draft.rotationIntervalSeconds}s</span>
          </div>
        )}
      </div>

      {/* Schedule windows */}
      <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-semibold text-foreground">Schedule windows</label>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
              Override the rotation with a specific status during a UTC time window.
            </p>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
            {draft.schedules.length}/{PRESENCE_LIMITS.maxSchedules}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {draft.schedules.map((s, i) => (
            <div key={i} className="rounded-xl border p-3" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}>
              <div className="flex flex-wrap items-center gap-1.5">
                {DAY_LABELS.map((d, di) => {
                  const on = s.days.includes(di)
                  return (
                    <button
                      key={di}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setSchedule(i, {
                          ...s,
                          days: on ? s.days.filter((x) => x !== di) : [...s.days, di],
                        })
                      }
                      className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
                      style={{
                        background: on ? 'var(--p-soft)' : 'var(--panel)',
                        color: on ? 'var(--p-1)' : 'var(--text-3)',
                        border: `1px solid ${on ? 'var(--p-1)' : 'var(--line-strong)'}`,
                      }}
                    >
                      {d}
                    </button>
                  )
                })}
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {s.days.length === 0 ? '(every day)' : ''}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  value={s.start}
                  disabled={disabled}
                  onChange={(e) => setSchedule(i, { ...s, start: normaliseTime(e.target.value) })}
                  className="rounded-lg border px-2 py-1.5 text-sm outline-none disabled:opacity-60"
                  style={fieldStyle}
                />
                <span style={{ color: 'var(--text-3)' }}>→</span>
                <input
                  type="time"
                  value={s.end}
                  disabled={disabled}
                  onChange={(e) => setSchedule(i, { ...s, end: normaliseTime(e.target.value) })}
                  className="rounded-lg border px-2 py-1.5 text-sm outline-none disabled:opacity-60"
                  style={fieldStyle}
                />
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  UTC
                </span>
                <button
                  type="button"
                  onClick={() => removeSchedule(i)}
                  disabled={disabled}
                  className="ml-auto text-xs font-medium disabled:opacity-50"
                  style={{ color: '#f23f43' }}
                >
                  Remove
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={s.activity.kind}
                  disabled={disabled}
                  onChange={(e) => setSchedule(i, { ...s, activity: { ...s.activity, kind: e.target.value as ActivityKind } })}
                  className="rounded-lg border px-2.5 py-1.5 text-sm outline-none disabled:opacity-60"
                  style={fieldStyle}
                >
                  {ACTIVITY_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={s.activity.text}
                  disabled={disabled}
                  onChange={(e) =>
                    setSchedule(i, { ...s, activity: { ...s.activity, text: e.target.value.slice(0, PRESENCE_LIMITS.maxTextLength) } })
                  }
                  placeholder="Activity text"
                  className="min-w-[140px] flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none disabled:opacity-60"
                  style={fieldStyle}
                  maxLength={PRESENCE_LIMITS.maxTextLength}
                />
              </div>
            </div>
          ))}
          {draft.schedules.length === 0 && (
            <p className="rounded-lg border border-dashed py-4 text-center text-sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
              No schedule windows.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={addSchedule}
          disabled={disabled || draft.schedules.length >= PRESENCE_LIMITS.maxSchedules}
          className="mt-2 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
        >
          <Plus size={14} /> Add window
        </button>
      </div>
    </div>
  )
}

// ── Maintenance mode ─────────────────────────────────────────────────────────

export function MaintenanceField({ draft, setDraft, disabled }: FieldProps) {
  const patch = (p: Partial<PresenceDraft>) => setDraft({ ...draft, ...p })

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: draft.maintenanceMode ? 'color-mix(in srgb, #f23f43 8%, var(--panel))' : 'var(--panel)',
        borderColor: draft.maintenanceMode ? '#f23f43' : 'var(--line-strong)',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, #f23f43 18%, transparent)', color: '#f23f43' }}>
            <Wrench size={16} />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Maintenance mode</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-3)' }}>
              Forces a Do-Not-Disturb status and a downtime message, ignoring the rotation.
            </p>
          </div>
        </div>
        <Switch checked={draft.maintenanceMode} onChange={(v) => patch({ maintenanceMode: v })} disabled={disabled} label="Maintenance mode" />
      </div>
      {draft.maintenanceMode && (
        <input
          type="text"
          value={draft.maintenanceText}
          disabled={disabled}
          onChange={(e) => patch({ maintenanceText: e.target.value.slice(0, PRESENCE_LIMITS.maxTextLength) })}
          placeholder={MAINTENANCE_DEFAULT_TEXT}
          className="mt-3 w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-60"
          style={fieldStyle}
          maxLength={PRESENCE_LIMITS.maxTextLength}
        />
      )}
    </div>
  )
}

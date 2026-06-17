'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { X, Plus, Trash2, AlertCircle, Loader2, GripVertical } from 'lucide-react'
import {
  defaultDraft,
  validateDraft,
  POLL_TYPE_META,
  POLL_PRESETS,
  POLL_LIMITS,
  pollControlsMeta,
  type PollDraft,
  type PollType,
  type PollOption,
  type Poll,
} from '@/lib/polls'
import { createPoll, updatePoll } from '@/app/dashboard/[guildId]/polls/actions'
import { PollIcon } from './icons'

type Channel = { id: string; name: string }
type Role = { id: string; name: string; color: number }

const fieldStyle = { background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-1)' } as const
const fieldClass = 'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--p-1)]'

const DURATIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '6 hours', minutes: 360 },
  { label: '12 hours', minutes: 720 },
  { label: '1 day', minutes: 1440 },
  { label: '3 days', minutes: 4320 },
  { label: '1 week', minutes: 10080 },
  { label: 'No auto-close', minutes: 0 },
]
const START_DELAYS = [
  { label: 'Publish now', minutes: 0 },
  { label: 'In 1 hour', minutes: 60 },
  { label: 'In 6 hours', minutes: 360 },
  { label: 'In 1 day', minutes: 1440 },
]

let optionSeq = 0
const newOption = (): PollOption => ({ id: `opt-${Date.now()}-${optionSeq++}`, label: '' })

function draftFromPoll(p: Poll): PollDraft {
  const base = defaultDraft()
  return {
    ...base,
    title: p.title,
    description: p.description ?? '',
    poll_type: p.poll_type,
    options: p.poll_type === 'yes_no' || p.poll_type === 'rating' ? base.options : p.options.map((o) => ({ ...o })),
    rating_scale: p.poll_type === 'rating' ? p.options.length : base.rating_scale,
    anonymous: p.anonymous,
    allow_change: p.allow_change,
    max_choices: p.max_choices,
    channel_id: p.channel_id,
    requirements: { ...p.requirements },
    governance: { ...p.governance },
  }
}

export function PollCreatePanel({
  guildId,
  channels,
  roles,
  editing,
  onClose,
  onDone,
}: {
  guildId: string
  channels: Channel[]
  roles: Role[]
  editing: Poll | null
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const router = useRouter()
  const isEdit = editing !== null
  const [draft, setDraft] = useState<PollDraft>(() =>
    editing ? draftFromPoll(editing) : { ...defaultDraft(), channel_id: channels[0]?.id ?? '' },
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof PollDraft>(key: K, value: PollDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    setError(null)
  }

  const needsOptions = draft.poll_type === 'single' || draft.poll_type === 'multiple' || draft.poll_type === 'feature'
  const filledOptions = draft.options.filter((o) => o.label.trim()).length
  const { multi } = pollControlsMeta(draft.poll_type, filledOptions, draft.max_choices)

  function applyPreset(presetId: string) {
    const preset = POLL_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setDraft((d) => ({
      ...defaultDraft(),
      channel_id: d.channel_id,
      ...preset.draft,
      // Ensure options carry stable ids for the editor.
      options: (preset.draft.options ?? defaultDraft().options).map((o) => ({ ...o })),
    }))
    setError(null)
  }

  function updateOption(id: string, label: string) {
    setDraft((d) => ({ ...d, options: d.options.map((o) => (o.id === id ? { ...o, label } : o)) }))
  }
  function addOption() {
    if (draft.options.length >= POLL_LIMITS.maxOptions) return
    setDraft((d) => ({ ...d, options: [...d.options, newOption()] }))
  }
  function removeOption(id: string) {
    setDraft((d) => ({ ...d, options: d.options.filter((o) => o.id !== id) }))
  }

  async function submit() {
    const err = validateDraft(draft)
    if (err) {
      setError(err)
      return
    }
    setSaving(true)
    const res = isEdit
      ? await updatePoll(guildId, editing!.id, {
          title: draft.title,
          description: draft.description,
          options: draft.options,
          anonymous: draft.anonymous,
          allow_change: draft.allow_change,
          max_choices: draft.max_choices,
          requirements: draft.requirements,
          governance: draft.governance,
        })
      : await createPoll(guildId, draft)
    setSaving(false)
    if (res.ok) {
      onDone(isEdit ? 'Poll updated.' : 'Poll created.')
      router.refresh()
      onClose()
    } else {
      setError(res.error)
    }
  }

  const maxChoiceCap = Math.max(2, filledOptions || 2)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-2xl max-h-[92vh] flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="font-semibold text-foreground">{isEdit ? 'Edit poll' : 'New poll'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5" style={{ color: 'var(--text-3)' }}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {/* Presets */}
          {!isEdit && (
            <div>
              <Label>Start from a template</Label>
              <div className="flex flex-wrap gap-2">
                {POLL_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-[var(--p-1)]"
                    style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
                  >
                    <PollIcon name={p.icon} size={13} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Type */}
          <div>
            <Label>Poll type</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.keys(POLL_TYPE_META) as PollType[]).map((t) => {
                const m = POLL_TYPE_META[t]
                const active = draft.poll_type === t
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={isEdit}
                    onClick={() => set('poll_type', t)}
                    className="flex items-start gap-2 rounded-lg border p-2.5 text-left transition disabled:opacity-50"
                    style={{
                      borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                      background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                    }}
                  >
                    <span style={{ color: active ? 'var(--p-1)' : 'var(--text-3)' }}>
                      <PollIcon name={m.icon} size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold" style={{ color: active ? 'var(--p-1)' : 'var(--text-1)' }}>
                        {m.label}
                      </span>
                      <span className="block text-[10px] leading-tight" style={{ color: 'var(--text-3)' }}>
                        {m.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            {isEdit && <Hint>Poll type, channel and schedule can&apos;t change after creation.</Hint>}
          </div>

          {/* Question + description */}
          <Field label="Question">
            <input
              value={draft.title}
              maxLength={POLL_LIMITS.maxTitle}
              onChange={(e) => set('title', e.target.value)}
              placeholder="What should we decide?"
              className={fieldClass}
              style={fieldStyle}
            />
          </Field>
          <Field label="Description" hint="Optional context shown under the question.">
            <textarea
              value={draft.description}
              maxLength={POLL_LIMITS.maxDescription}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              className={`${fieldClass} resize-none`}
              style={fieldStyle}
            />
          </Field>

          {/* Options */}
          {needsOptions && (
            <div>
              <Label>Options</Label>
              <div className="space-y-2">
                {draft.options.map((o, i) => (
                  <div key={o.id} className="flex items-center gap-2">
                    <GripVertical size={14} style={{ color: 'var(--text-3)' }} />
                    <input
                      value={o.label}
                      maxLength={POLL_LIMITS.maxOptionLabel}
                      onChange={(e) => updateOption(o.id, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      className={fieldClass}
                      style={fieldStyle}
                    />
                    {draft.options.length > POLL_LIMITS.minOptions && (
                      <button
                        type="button"
                        onClick={() => removeOption(o.id)}
                        className="shrink-0 rounded-lg border p-2 transition-colors hover:bg-[rgba(239,68,68,0.1)]"
                        style={{ borderColor: 'var(--line-strong)', color: '#f87171' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {draft.options.length < POLL_LIMITS.maxOptions && (
                <button
                  type="button"
                  onClick={addOption}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-xs font-medium transition-colors hover:border-[var(--p-1)]"
                  style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                >
                  <Plus size={13} /> Add option
                </button>
              )}
            </div>
          )}

          {draft.poll_type === 'rating' && (
            <Field label="Rating scale" hint={`Voters rate from 1 to N (max ${POLL_LIMITS.ratingMax}).`}>
              <input
                type="number"
                min={POLL_LIMITS.ratingMin}
                max={POLL_LIMITS.ratingMax}
                value={draft.rating_scale}
                onChange={(e) => set('rating_scale', clamp(Number(e.target.value), POLL_LIMITS.ratingMin, POLL_LIMITS.ratingMax))}
                className={`${fieldClass} max-w-[120px]`}
                style={fieldStyle}
              />
            </Field>
          )}

          {multi && (
            <Field label="Max selections" hint="How many options each voter may pick.">
              <input
                type="number"
                min={1}
                max={maxChoiceCap}
                value={draft.max_choices}
                onChange={(e) => set('max_choices', clamp(Number(e.target.value), 1, maxChoiceCap))}
                className={`${fieldClass} max-w-[120px]`}
                style={fieldStyle}
              />
            </Field>
          )}

          {/* Channel + schedule (create only) */}
          {!isEdit && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Channel">
                <select value={draft.channel_id} onChange={(e) => set('channel_id', e.target.value)} className={fieldClass} style={fieldStyle}>
                  <option value="">Pick a channel…</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Publish">
                <select
                  value={draft.start_delay_minutes}
                  onChange={(e) => set('start_delay_minutes', Number(e.target.value))}
                  className={fieldClass}
                  style={fieldStyle}
                >
                  {START_DELAYS.map((s) => (
                    <option key={s.minutes} value={s.minutes}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Runs for" hint="Pulse closes the poll automatically and tallies the result.">
                <select
                  value={draft.duration_minutes}
                  onChange={(e) => set('duration_minutes', Number(e.target.value))}
                  className={fieldClass}
                  style={fieldStyle}
                >
                  {DURATIONS.map((d) => (
                    <option key={d.minutes} value={d.minutes}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {/* Behaviour toggles */}
          <div className="space-y-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <ToggleRow
              label="Anonymous"
              hint="Votes are tracked by Pulse but voter names aren't shown."
              enabled={draft.anonymous}
              onChange={(v) => set('anonymous', v)}
            />
            <ToggleRow
              label="Allow changing vote"
              hint="Let voters change their choice while the poll is open."
              enabled={draft.allow_change}
              onChange={(v) => set('allow_change', v)}
            />
          </div>

          {/* Restrictions */}
          <Section title="Who can vote">
            <RoleMultiSelect
              label="Required roles (empty = everyone)"
              roles={roles}
              selected={draft.requirements.required_role_ids}
              onChange={(ids) => set('requirements', { ...draft.requirements, required_role_ids: ids })}
            />
            {draft.requirements.required_role_ids.length > 1 && (
              <Field label="Role match">
                <select
                  value={draft.requirements.required_role_mode}
                  onChange={(e) => set('requirements', { ...draft.requirements, required_role_mode: e.target.value as 'any' | 'all' })}
                  className={`${fieldClass} max-w-[160px]`}
                  style={fieldStyle}
                >
                  <option value="any">Any of them</option>
                  <option value="all">All of them</option>
                </select>
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <NumField
                label="Min account age (days)"
                value={draft.requirements.min_account_age_days}
                max={3650}
                onChange={(v) => set('requirements', { ...draft.requirements, min_account_age_days: v })}
              />
              <NumField
                label="Min level"
                value={draft.requirements.min_level}
                max={1000}
                onChange={(v) => set('requirements', { ...draft.requirements, min_level: v })}
              />
              <NumField
                label="Min reputation"
                value={draft.requirements.min_reputation}
                max={100}
                onChange={(v) => set('requirements', { ...draft.requirements, min_reputation: v })}
              />
            </div>
          </Section>

          {/* Governance */}
          <Section title="Community governance">
            <ToggleRow
              label="Weighted voting"
              hint="Give trusted members more say — weight each vote by reputation or level."
              enabled={draft.governance.weighted}
              onChange={(v) => set('governance', { ...draft.governance, weighted: v })}
            />
            {draft.governance.weighted && (
              <Field label="Weight by">
                <select
                  value={draft.governance.weight_basis}
                  onChange={(e) => set('governance', { ...draft.governance, weight_basis: e.target.value as 'reputation' | 'level' })}
                  className={`${fieldClass} max-w-[180px]`}
                  style={fieldStyle}
                >
                  <option value="reputation">Reputation</option>
                  <option value="level">Level</option>
                </select>
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField
                label="Approval threshold (%)"
                hint="Leading option must reach this share to pass. 0 = off."
                value={draft.governance.approval_threshold}
                max={100}
                onChange={(v) => set('governance', { ...draft.governance, approval_threshold: v })}
              />
              <NumField
                label="Min participation (voters)"
                hint="Distinct voters needed for the result to count. 0 = off."
                value={draft.governance.min_participation}
                max={1000000}
                onChange={(v) => set('governance', { ...draft.governance, min_participation: v })}
              />
            </div>
          </Section>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--line-strong)' }}>
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {isEdit ? 'Save changes' : draft.start_delay_minutes > 0 ? 'Schedule poll' : 'Create & post'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Small field primitives ────────────────────────────────────────────────────

function Label({ children }: { children: ReactNode }) {
  return <label className="mb-2 block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{children}</label>
}
function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-xs text-subtle">{children}</p>
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-2)' }}>{label}</label>
      {children}
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: 'var(--line-strong)' }}>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{title}</p>
      {children}
    </div>
  )
}
function NumField({ label, hint, value, max, onChange }: { label: string; hint?: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value), 0, max))}
        className={fieldClass}
        style={fieldStyle}
      />
    </Field>
  )
}
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
      style={{ background: enabled ? 'linear-gradient(90deg, var(--p-1), var(--p-2))' : 'var(--bg-2)', border: enabled ? 'none' : '1px solid var(--line-strong)' }}
    >
      <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform" style={{ transform: enabled ? 'translateX(24px)' : 'translateX(4px)' }} />
    </button>
  )
}
function ToggleRow({ label, hint, enabled, onChange }: { label: string; hint?: string; enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{label}</p>
        {hint && <p className="text-xs text-subtle">{hint}</p>}
      </div>
      <Toggle enabled={enabled} onChange={onChange} />
    </div>
  )
}
function RoleMultiSelect({ label, roles, selected, onChange }: { label: string; roles: Role[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const byId = new Map(roles.map((r) => [r.id, r]))
  const available = roles.filter((r) => !selected.includes(r.id))
  return (
    <Field label={label}>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
              {byId.get(id)?.name ?? id}
              <button type="button" onClick={() => onChange(selected.filter((s) => s !== id))} className="opacity-60 hover:opacity-100">×</button>
            </span>
          ))}
        </div>
      )}
      <select
        value=""
        onChange={(e) => { if (e.target.value) onChange([...selected, e.target.value]) }}
        disabled={available.length === 0}
        className={`${fieldClass} disabled:opacity-50`}
        style={fieldStyle}
      >
        <option value="">{available.length === 0 ? 'Nothing left to add' : 'Add a role…'}</option>
        {available.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
    </Field>
  )
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}

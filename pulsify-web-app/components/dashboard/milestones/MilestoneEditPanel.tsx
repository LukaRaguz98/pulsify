'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  X,
  Award,
  AlertCircle,
  Eye,
  Sparkles,
  Loader2,
  Target,
  Gift,
  Megaphone,
  Send,
  CheckCircle2,
} from 'lucide-react'
import {
  METRIC_META,
  MILESTONE_METRICS,
  MILESTONE_PRESETS,
  MILESTONE_LIMITS,
  DEFAULT_MILESTONE_MESSAGE,
  describeThresholdLong,
  formatMetricValueLong,
  renderMilestoneMessage,
  type MilestoneDraft,
  type MilestoneMetric,
  type Milestone,
  type AnnounceMode,
} from '@/lib/milestones'
import { createMilestone, updateMilestone, testMilestone } from '@/app/dashboard/[guildId]/milestones/actions'
import { MilestoneIcon, MILESTONE_ICON_CHOICES } from './icons'

type Channel = { id: string; name: string }
type Role = { id: string; name: string; color: number }

type Props = {
  guildId: string
  guildName: string
  channels: Channel[]
  roles: Role[]
  editing: Milestone | null
  onClose: () => void
}

const FIELD_CLASS =
  'w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-1'
const fieldStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}
const errorFieldStyle: React.CSSProperties = { ...fieldStyle, borderColor: 'rgba(239,68,68,0.6)' }

function defaultDraft(channels: Channel[]): MilestoneDraft {
  return {
    name: '',
    description: '',
    metric: 'messages',
    threshold: 1000,
    enabled: true,
    icon: METRIC_META.messages.icon,
    rewards: [],
    announce: 'channel',
    announce_channel_id: channels[0]?.id ?? null,
    message: DEFAULT_MILESTONE_MESSAGE,
  }
}

const ANNOUNCE_OPTIONS: { value: AnnounceMode; label: string; hint: string }[] = [
  { value: 'channel', label: 'Channel', hint: 'Post in a channel' },
  { value: 'dm', label: 'Direct message', hint: 'DM the member' },
  { value: 'off', label: 'Off', hint: 'No announcement' },
]

export function MilestoneEditPanel({ guildId, guildName, channels, roles, editing, onClose }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testFeedback, setTestFeedback] = useState<string | null>(null)
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const isEdit = editing !== null

  useEffect(() => {
    document.body.classList.add('slide-over-open')
    return () => document.body.classList.remove('slide-over-open')
  }, [])

  const [draft, setDraft] = useState<MilestoneDraft>(() => {
    if (editing) {
      return {
        name: editing.name,
        description: editing.description ?? '',
        metric: editing.metric,
        threshold: editing.threshold,
        enabled: editing.enabled,
        icon: editing.icon,
        rewards: editing.rewards,
        announce: editing.announce,
        announce_channel_id: editing.announce_channel_id ?? channels[0]?.id ?? null,
        message: editing.message,
      }
    }
    return defaultDraft(channels)
  })

  const roleNameById = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles])

  const set = <K extends keyof MilestoneDraft>(key: K, value: MilestoneDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  function changeMetric(metric: MilestoneMetric) {
    setDraft((d) => ({
      ...d,
      metric,
      // Snap the icon to the metric default unless the user already picked one
      // that isn't a metric default; pick a sensible starting threshold too.
      icon: METRIC_META[metric].icon,
      threshold: METRIC_META[metric].suggestions[Math.min(2, METRIC_META[metric].suggestions.length - 1)] ?? d.threshold,
    }))
  }

  function applyPreset(name: string) {
    const p = MILESTONE_PRESETS.find((x) => x.name === name)
    if (!p) return
    setDraft((d) => ({
      ...d,
      name: p.name,
      description: p.description,
      metric: p.metric,
      threshold: p.threshold,
      icon: p.icon,
    }))
  }

  function toggleReward(roleId: string) {
    setDraft((d) => ({
      ...d,
      rewards: d.rewards.some((r) => r.role_id === roleId)
        ? d.rewards.filter((r) => r.role_id !== roleId)
        : d.rewards.length >= MILESTONE_LIMITS.maxRewards
          ? d.rewards
          : [...d.rewards, { role_id: roleId }],
    }))
  }

  const fieldErrors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!draft.name.trim()) e.name = 'Give your milestone a name.'
    if (!Number.isFinite(draft.threshold) || draft.threshold < 1) e.threshold = 'Must be at least 1.'
    if (draft.announce === 'channel' && !draft.announce_channel_id) e.announce_channel_id = 'Pick a channel.'
    return e
  }, [draft.name, draft.threshold, draft.announce, draft.announce_channel_id])

  const markTouched = (key: string) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  const showError = (key: string) => touched[key] && fieldErrors[key]

  async function submit() {
    setError(null)
    if (Object.keys(fieldErrors).length > 0) {
      setTouched({ name: true, threshold: true, announce_channel_id: true })
      setError('Fix the highlighted fields before saving.')
      return
    }
    setSaving(true)
    const result = isEdit
      ? await updateMilestone(guildId, editing!.id, draft)
      : await createMilestone(guildId, draft)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    startTransition(() => router.refresh())
    onClose()
  }

  // "Send test" posts the sample embed to the announce channel (or the first
  // channel when announcing off/DM) so the admin can see the real output.
  const testChannelId = draft.announce === 'channel' ? draft.announce_channel_id : channels[0]?.id ?? null
  async function sendTest() {
    setTestFeedback(null)
    setError(null)
    if (!testChannelId) {
      setError('No channel available to send a test to.')
      return
    }
    if (!draft.name.trim()) {
      setTouched((t) => ({ ...t, name: true }))
      setError('Name the milestone before sending a test.')
      return
    }
    setTesting(true)
    const res = await testMilestone(guildId, draft, testChannelId)
    setTesting(false)
    if (res.ok) {
      const ch = channels.find((c) => c.id === testChannelId)
      setTestFeedback(`Sent a test to #${ch?.name ?? 'channel'}.`)
    } else {
      setError(res.error)
    }
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
        aria-label={isEdit ? 'Edit milestone' : 'New milestone'}
        className="relative flex w-full max-w-3xl max-h-[90vh] flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <Award size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">{isEdit ? 'Edit milestone' : 'New milestone'}</h2>
              <p className="truncate text-xs text-subtle">
                {isEdit ? 'Update the trigger, rewards and announcement.' : 'Define a threshold, pick rewards, and how to celebrate it.'}
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
            <Section icon={<Sparkles size={13} />} label="Start from a template" description="Pre-fill a common milestone, then tweak it.">
              <div className="flex flex-wrap gap-2">
                {MILESTONE_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => applyPreset(p.name)}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors"
                    style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-2)' }}
                  >
                    <MilestoneIcon name={p.icon} size={13} />
                    {p.name}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* Details */}
          <Section icon={<Award size={13} />} label="Details" description="What members are recognised for.">
            <Field label="Name" error={showError('name') ? fieldErrors.name : undefined}>
              <input
                value={draft.name}
                maxLength={MILESTONE_LIMITS.maxName}
                onChange={(e) => set('name', e.target.value)}
                onBlur={() => markTouched('name')}
                className={FIELD_CLASS}
                style={showError('name') ? errorFieldStyle : fieldStyle}
                placeholder="1 Year Member"
              />
            </Field>

            <Field label="Description" hint="optional">
              <textarea
                value={draft.description}
                maxLength={MILESTONE_LIMITS.maxDescription}
                rows={2}
                onChange={(e) => set('description', e.target.value)}
                className={`${FIELD_CLASS} resize-none`}
                style={fieldStyle}
                placeholder="A full year in the community."
              />
            </Field>

            <Field label="Icon">
              <div className="flex flex-wrap gap-1.5 rounded-lg border p-2" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                {MILESTONE_ICON_CHOICES.map((name) => {
                  const on = draft.icon === name
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => set('icon', name)}
                      aria-label={name}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
                      style={{
                        borderColor: on ? 'var(--p-1)' : 'var(--line-strong)',
                        background: on ? 'var(--p-soft)' : 'transparent',
                        color: on ? 'var(--p-1)' : 'var(--text-3)',
                      }}
                    >
                      <MilestoneIcon name={name} size={15} />
                    </button>
                  )
                })}
              </div>
            </Field>
          </Section>

          {/* Trigger */}
          <Section icon={<Target size={13} />} label="Trigger" description="The metric and threshold a member must cross.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Tracks">
                <select
                  value={draft.metric}
                  onChange={(e) => changeMetric(e.target.value as MilestoneMetric)}
                  className={FIELD_CLASS}
                  style={fieldStyle}
                >
                  {MILESTONE_METRICS.map((m) => (
                    <option key={m} value={m}>
                      {METRIC_META[m].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Threshold (${METRIC_META[draft.metric].unit}s)`} error={showError('threshold') ? fieldErrors.threshold : undefined}>
                <input
                  type="number"
                  min={1}
                  max={MILESTONE_LIMITS.maxThreshold}
                  value={draft.threshold}
                  onChange={(e) => set('threshold', Math.max(1, Number(e.target.value) || 1))}
                  onBlur={() => markTouched('threshold')}
                  className={FIELD_CLASS}
                  style={showError('threshold') ? errorFieldStyle : fieldStyle}
                />
              </Field>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{METRIC_META[draft.metric].hint}</p>
            <div className="flex flex-wrap gap-1.5">
              {METRIC_META[draft.metric].suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set('threshold', s)}
                  className="rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    borderColor: draft.threshold === s ? 'var(--p-1)' : 'var(--line-strong)',
                    background: draft.threshold === s ? 'var(--p-soft)' : 'var(--bg-2)',
                    color: draft.threshold === s ? 'var(--p-1)' : 'var(--text-3)',
                  }}
                >
                  {describeThresholdLong(draft.metric, s)}
                </button>
              ))}
            </div>
          </Section>

          {/* Rewards */}
          <Section icon={<Gift size={13} />} label="Reward roles" description="Roles granted automatically on completion (optional, multiple allowed).">
            <div
              className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-lg border p-2"
              style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
            >
              {roles.length === 0 && <span className="text-xs" style={{ color: 'var(--text-3)' }}>No roles</span>}
              {roles.map((r) => {
                const on = draft.rewards.some((x) => x.role_id === r.id)
                const color = r.color ? `#${r.color.toString(16).padStart(6, '0')}` : 'var(--text-2)'
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleReward(r.id)}
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
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {draft.rewards.length} role{draft.rewards.length === 1 ? '' : 's'} selected
            </p>
          </Section>

          {/* Announcement */}
          <Section icon={<Megaphone size={13} />} label="Announcement" description="How the milestone is celebrated.">
            <Field label="Mode">
              <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
                {ANNOUNCE_OPTIONS.map((o) => {
                  const on = draft.announce === o.value
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => set('announce', o.value)}
                      className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{ background: on ? 'var(--p-soft)' : 'transparent', color: on ? 'var(--p-1)' : 'var(--text-3)' }}
                      title={o.hint}
                    >
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </Field>

            {draft.announce === 'channel' && (
              <Field label="Channel" error={showError('announce_channel_id') ? fieldErrors.announce_channel_id : undefined}>
                <select
                  value={draft.announce_channel_id ?? ''}
                  onChange={(e) => set('announce_channel_id', e.target.value || null)}
                  onBlur={() => markTouched('announce_channel_id')}
                  className={FIELD_CLASS}
                  style={showError('announce_channel_id') ? errorFieldStyle : fieldStyle}
                >
                  {channels.length === 0 && <option value="">No channels</option>}
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {draft.announce !== 'off' && (
              <Field label="Message" hint="{user} {mention} {milestone} {server} {value}">
                <textarea
                  value={draft.message}
                  maxLength={MILESTONE_LIMITS.maxMessage}
                  rows={2}
                  onChange={(e) => set('message', e.target.value)}
                  className={`${FIELD_CLASS} resize-none`}
                  style={fieldStyle}
                  placeholder={DEFAULT_MILESTONE_MESSAGE}
                />
              </Field>
            )}
          </Section>

          {/* Preview */}
          <Section icon={<Eye size={13} />} label="Preview" description="How the milestone appears in Discord.">
            <MilestonePreview draft={draft} guildName={guildName} roleNameById={roleNameById} />
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
          ) : testFeedback ? (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: '#4ade80' }}>
              <CheckCircle2 size={14} className="shrink-0" />
              {testFeedback}
            </span>
          ) : (
            <button
              type="button"
              onClick={sendTest}
              disabled={busy || testing || !testChannelId}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {testing ? 'Sending…' : 'Send test'}
            </button>
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
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Award size={15} />}
              {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create milestone'}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}

// ── Live preview (a Discord-style mock of the milestone message) ───────────────
// Mirrors the embed built in actions.ts / milestones.js: badge + name, the
// rendered congratulations message, an Unlocked-roles line, and the Pulse footer.

function MilestonePreview({
  draft,
  guildName,
  roleNameById,
}: {
  draft: MilestoneDraft
  guildName: string
  roleNameById: Map<string, string>
}) {
  const rendered = useMemo(
    () =>
      renderMilestoneMessage(draft.message || DEFAULT_MILESTONE_MESSAGE, {
        user: 'Member',
        mention: '@Member',
        milestone: draft.name || 'Milestone',
        server: guildName || 'this server',
        value: formatMetricValueLong(draft.metric, draft.threshold),
      }),
    [draft.message, draft.name, draft.metric, draft.threshold, guildName],
  )

  if (draft.announce === 'off') {
    return (
      <div className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-3)' }}>
        Announcements are off — members still earn this milestone and its reward roles silently.
      </div>
    )
  }

  return (
    <div className="rounded-xl border-l-4 p-4" style={{ borderColor: 'var(--p-1)', background: 'var(--bg-2)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>Pulse</p>
          <p className="break-words font-bold text-foreground">{draft.name || 'Milestone'}</p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
          <MilestoneIcon name={draft.icon} size={16} />
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: 'var(--text-2)' }}>{rendered}</p>

      {draft.rewards.length > 0 && (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
          🎁 Unlocked: {draft.rewards.map((r) => `@${roleNameById.get(r.role_id) ?? 'role'}`).join(', ')}
        </p>
      )}

      <p className="mt-2.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
        Pulse · Milestone {draft.announce === 'dm' ? '· sent as a DM' : ''}
      </p>
    </div>
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

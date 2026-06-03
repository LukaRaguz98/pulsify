'use client'

import { useMemo, useState } from 'react'
import {
  X,
  Pencil,
  Trash2,
  Power,
  Send,
  Loader2,
  Users,
  Gift,
  Megaphone,
  Target,
  AlertCircle,
} from 'lucide-react'
import {
  METRIC_META,
  describeThresholdLong,
  formatMetricValueLong,
  type Milestone,
  type MilestoneCompletion,
} from '@/lib/milestones'
import {
  toggleMilestone,
  deleteMilestone,
  testMilestone,
  type ActionResult,
} from '@/app/dashboard/[guildId]/milestones/actions'
import { MilestoneIcon } from './icons'

type Channel = { id: string; name: string }

export function MilestoneDetail({
  guildId,
  milestone,
  completions,
  roleNames,
  channels,
  runAction,
  onClose,
  onEdit,
}: {
  guildId: string
  milestone: Milestone
  completions: MilestoneCompletion[]
  roleNames?: Map<string, string>
  channels: Channel[]
  runAction: <T>(fn: () => Promise<ActionResult<T>>, successMsg?: string) => Promise<ActionResult<T>>
  onClose: () => void
  onEdit: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const earners = useMemo(
    () => completions.filter((c) => c.milestone_id === milestone.id),
    [completions, milestone.id],
  )

  const channelName = milestone.announce_channel_id
    ? channels.find((c) => c.id === milestone.announce_channel_id)?.name
    : undefined

  const testChannelId = milestone.announce_channel_id ?? channels[0]?.id ?? null

  async function onToggle() {
    setBusy('toggle')
    await runAction(() => toggleMilestone(guildId, milestone.id, !milestone.enabled), milestone.enabled ? 'Milestone disabled.' : 'Milestone enabled.')
    setBusy(null)
  }

  async function onDelete() {
    setBusy('delete')
    const res = await runAction(() => deleteMilestone(guildId, milestone.id), 'Milestone deleted.')
    setBusy(null)
    if (res.ok) onClose()
  }

  async function onTest() {
    setLocalError(null)
    if (!testChannelId) {
      setLocalError('No channel available to send a test to.')
      return
    }
    setBusy('test')
    const ch = channels.find((c) => c.id === testChannelId)
    await runAction(
      () =>
        testMilestone(
          guildId,
          {
            name: milestone.name,
            description: milestone.description ?? '',
            metric: milestone.metric,
            threshold: milestone.threshold,
            enabled: milestone.enabled,
            icon: milestone.icon,
            rewards: milestone.rewards,
            announce: milestone.announce,
            announce_channel_id: milestone.announce_channel_id,
            message: milestone.message,
          },
          testChannelId,
        ),
      `Sent a test to #${ch?.name ?? 'channel'}.`,
    )
    setBusy(null)
  }

  const meta = METRIC_META[milestone.metric]

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => !busy && onClose()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={milestone.name}
        className="relative flex w-full max-w-lg max-h-[90vh] flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <MilestoneIcon name={milestone.icon} size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">{milestone.name}</h2>
              <p className="truncate text-xs text-subtle">{describeThresholdLong(milestone.metric, milestone.threshold)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {milestone.description && (
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>{milestone.description}</p>
          )}

          {/* Facts */}
          <div className="grid grid-cols-2 gap-3">
            <Fact icon={<Target size={13} />} label="Tracks" value={meta.label} />
            <Fact icon={<MilestoneIcon name={meta.icon} size={13} />} label="Threshold" value={describeThresholdLong(milestone.metric, milestone.threshold)} />
            <Fact icon={<Users size={13} />} label="Earned by" value={`${earners.length.toLocaleString()} member${earners.length === 1 ? '' : 's'}`} />
            <Fact
              icon={<Megaphone size={13} />}
              label="Announce"
              value={milestone.announce === 'off' ? 'Off' : milestone.announce === 'dm' ? 'Direct message' : channelName ? `#${channelName}` : 'Channel'}
            />
          </div>

          {/* Reward roles */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>
              <Gift size={12} /> Reward roles
            </h3>
            {milestone.rewards.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No reward roles — recognition only.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {milestone.rewards.map((r) => (
                  <span key={r.role_id} className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: 'var(--bg-2)', color: 'var(--text-2)' }}>
                    @{roleNames?.get(r.role_id) ?? 'role'}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Recent earners (reward-history log) */}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>
              <Users size={12} /> Recent earners
            </h3>
            {earners.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No one has earned this yet.</p>
            ) : (
              <div className="space-y-1.5">
                {earners.slice(0, 12).map((e) => (
                  <div
                    key={`${e.user_id}-${e.completed_at}`}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm"
                    style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
                  >
                    <span className="truncate" style={{ color: 'var(--text-2)' }}>{e.user_name ?? e.user_id}</span>
                    <span className="shrink-0 text-xs" style={{ color: 'var(--text-3)' }}>
                      {formatMetricValueLong(milestone.metric, e.value)} · {new Date(e.completed_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
                {earners.length > 12 && (
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>+{earners.length - 12} more</p>
                )}
              </div>
            )}
          </div>

          {localError && (
            <p className="flex items-center gap-1.5 text-sm" style={{ color: '#f87171' }}>
              <AlertCircle size={14} /> {localError}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <div className="flex items-center gap-2">
            <FooterButton onClick={onToggle} busy={busy === 'toggle'} icon={<Power size={14} />}>
              {milestone.enabled ? 'Disable' : 'Enable'}
            </FooterButton>
            <FooterButton onClick={onTest} busy={busy === 'test'} icon={<Send size={14} />} disabled={!testChannelId}>
              Test
            </FooterButton>
          </div>
          <div className="flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>Sure?</span>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={busy === 'delete'}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: '#ef4444' }}
                >
                  {busy === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border px-3 py-2 text-sm font-medium"
                  style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <FooterButton onClick={() => setConfirmDelete(true)} icon={<Trash2 size={14} />} danger>
                  Delete
                </FooterButton>
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white transition-all"
                  style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
                >
                  <Pencil size={14} /> Edit
                </button>
              </>
            )}
          </div>
        </footer>
      </aside>
    </div>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
        {icon}
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function FooterButton({
  onClick,
  busy,
  icon,
  children,
  danger,
  disabled,
}: {
  onClick: () => void
  busy?: boolean
  icon: React.ReactNode
  children: React.ReactNode
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
      style={{ borderColor: 'var(--line-strong)', color: danger ? '#f87171' : 'var(--text-2)' }}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

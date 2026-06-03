'use client'

import { Users, Power } from 'lucide-react'
import {
  METRIC_META,
  describeThresholdLong,
  type Milestone,
} from '@/lib/milestones'
import { MilestoneIcon } from './icons'

export function MilestoneCard({
  milestone,
  earned,
  roleNames,
  onSelect,
  onToggle,
  busy,
}: {
  milestone: Milestone
  earned: number
  roleNames?: Map<string, string>
  onSelect: () => void
  onToggle: (enabled: boolean) => void
  busy?: boolean
}) {
  const meta = METRIC_META[milestone.metric]
  const rewardChips = milestone.rewards.slice(0, 3)
  const extraRewards = milestone.rewards.length - rewardChips.length

  return (
    <button
      type="button"
      onClick={onSelect}
      className="milestone-card group flex flex-col rounded-2xl border p-4 text-left transition-all"
      style={{
        background: 'var(--panel)',
        borderColor: 'var(--line-strong)',
        opacity: milestone.enabled ? 1 : 0.7,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--p-1)'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line-strong)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      {/* Header: metric pill + enable toggle */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ color: 'var(--p-1)', background: 'var(--p-soft)' }}
        >
          <MilestoneIcon name={meta.icon} size={12} />
          {meta.label}
        </span>
        <span
          role="switch"
          aria-checked={milestone.enabled}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            if (!busy) onToggle(!milestone.enabled)
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !busy) {
              e.stopPropagation()
              e.preventDefault()
              onToggle(!milestone.enabled)
            }
          }}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors"
          style={{
            color: milestone.enabled ? '#22c55e' : 'var(--text-3)',
            background: milestone.enabled ? 'rgba(34,197,94,0.12)' : 'var(--bg-2)',
            cursor: busy ? 'wait' : 'pointer',
          }}
          title={milestone.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
        >
          <Power size={11} />
          {milestone.enabled ? 'On' : 'Off'}
        </span>
      </div>

      {/* Icon + name + threshold */}
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
        >
          <MilestoneIcon name={milestone.icon} size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{milestone.name}</p>
          <p className="truncate text-sm" style={{ color: 'var(--text-2)' }}>
            {describeThresholdLong(milestone.metric, milestone.threshold)}
          </p>
        </div>
      </div>

      {/* Reward roles */}
      {milestone.rewards.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {rewardChips.map((r) => (
            <span
              key={r.role_id}
              className="truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium"
              style={{ background: 'var(--bg-2)', color: 'var(--text-2)', maxWidth: '11rem' }}
            >
              @{roleNames?.get(r.role_id) ?? 'role'}
            </span>
          ))}
          {extraRewards > 0 && (
            <span className="rounded-md px-1.5 py-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
              +{extraRewards}
            </span>
          )}
        </div>
      )}

      {/* Footer: earned count */}
      <div
        className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-xs"
        style={{ borderColor: 'var(--line-strong)' }}
      >
        <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
          <Users size={13} />
          {earned.toLocaleString()} earned
        </span>
        <span style={{ color: 'var(--text-3)' }}>
          {milestone.announce === 'off' ? 'No announce' : milestone.announce === 'dm' ? 'DM' : 'Channel'}
        </span>
      </div>
    </button>
  )
}

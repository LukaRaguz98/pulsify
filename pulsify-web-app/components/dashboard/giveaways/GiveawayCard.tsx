'use client'

import { Gift, Users, Trophy } from 'lucide-react'
import {
  STATUS_META,
  hasRequirements,
  describeRequirements,
  timeAgo,
  type Giveaway,
} from '@/lib/giveaways'
import { GiveawayIcon } from './icons'
import { Countdown } from './Countdown'

export function GiveawayCard({
  giveaway,
  roleNames,
  onSelect,
}: {
  giveaway: Giveaway
  roleNames?: Map<string, string>
  onSelect: () => void
}) {
  const meta = STATUS_META[giveaway.status]
  const req = giveaway.requirements
  const gated = hasRequirements(req)
  const reqText = describeRequirements(req, (id) => roleNames?.get(id) ?? 'a role').join(' · ')

  return (
    <button
      type="button"
      onClick={onSelect}
      className="giveaway-card group flex flex-col rounded-2xl border p-4 text-left transition-all"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--p-1)'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--line-strong)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      {/* Header: status pill + entry count */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ color: meta.color, background: `${meta.color}1f` }}
        >
          <GiveawayIcon name={meta.icon} size={12} />
          {meta.label}
        </span>
        <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}>
          <Users size={13} />
          {giveaway.entry_count.toLocaleString()}
        </span>
      </div>

      {/* Title + prize */}
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
        >
          <Gift size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{giveaway.title}</p>
          <p className="truncate text-sm" style={{ color: 'var(--text-2)' }}>
            {giveaway.prize}
          </p>
        </div>
      </div>

      {/* Footer: time + winners */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-xs" style={{ borderColor: 'var(--line-strong)' }}>
        {giveaway.status === 'active' && (
          <span className="font-medium" style={{ color: meta.color }}>
            <Countdown target={giveaway.ends_at} endedLabel="Ending…" prefix="Ends in " />
          </span>
        )}
        {giveaway.status === 'scheduled' && (
          <span style={{ color: 'var(--text-3)' }}>
            Starts {giveaway.starts_at ? <Countdown target={giveaway.starts_at} endedLabel="now" prefix="in " /> : 'soon'}
          </span>
        )}
        {giveaway.status === 'ended' && (
          <span className="inline-flex items-center gap-1" style={{ color: meta.color }}>
            <Trophy size={13} />
            {giveaway.winners.length > 0
              ? `${giveaway.winners.length} winner${giveaway.winners.length === 1 ? '' : 's'}`
              : 'No winners'}
          </span>
        )}
        {giveaway.status === 'cancelled' && (
          <span style={{ color: 'var(--text-3)' }}>Cancelled {giveaway.ended_at ? timeAgo(giveaway.ended_at) : ''}</span>
        )}

        <span style={{ color: 'var(--text-3)' }}>
          {giveaway.winner_count} winner{giveaway.winner_count === 1 ? '' : 's'}
        </span>
      </div>

      {gated && (
        <p className="mt-2 truncate text-[11px]" style={{ color: 'var(--text-3)' }} title={reqText}>
          🔒 {reqText}
        </p>
      )}
    </button>
  )
}

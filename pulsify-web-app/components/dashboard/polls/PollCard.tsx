'use client'

import { Users, BarChart3, Clock, Trophy } from 'lucide-react'
import {
  STATUS_META,
  POLL_TYPE_META,
  timeAgo,
  type Poll,
} from '@/lib/polls'
import { PollIcon } from './icons'
import { Countdown } from './Countdown'

export function PollCard({ poll, onSelect }: { poll: Poll; onSelect: () => void }) {
  const meta = STATUS_META[poll.status]
  const typeMeta = POLL_TYPE_META[poll.poll_type]
  const winner =
    poll.results && poll.results.winner_ids.length > 0
      ? poll.results.options.find((o) => poll.results!.winner_ids.includes(o.id))
      : null

  return (
    <button
      onClick={onSelect}
      className="group flex w-full flex-col rounded-xl border p-4 text-left transition-colors hover:border-[var(--p-1)]"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
        >
          <PollIcon name={typeMeta.icon} size={11} />
          {typeMeta.label}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ color: meta.color, background: `${meta.color}1f` }}
        >
          <PollIcon name={meta.icon} size={10} />
          {meta.label}
        </span>
      </div>

      <h3 className="line-clamp-2 font-semibold text-foreground">{poll.title}</h3>
      {poll.description && (
        <p className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--text-3)' }}>
          {poll.description}
        </p>
      )}

      {winner && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: '#a855f7' }}>
          <Trophy size={12} /> {winner.label} — {winner.pct}%
        </p>
      )}

      <div className="mt-3 flex items-center gap-3 text-xs" style={{ color: 'var(--text-3)' }}>
        <span className="inline-flex items-center gap-1">
          <BarChart3 size={12} /> {poll.vote_count.toLocaleString()}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users size={12} /> {poll.voter_count.toLocaleString()}
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Clock size={12} />
          {poll.status === 'active' && poll.ends_at ? (
            <Countdown target={poll.ends_at} endedLabel="closing" prefix="" />
          ) : poll.status === 'active' ? (
            'open'
          ) : poll.status === 'scheduled' && poll.starts_at ? (
            <Countdown target={poll.starts_at} endedLabel="now" prefix="opens in " />
          ) : poll.closed_at ? (
            timeAgo(poll.closed_at)
          ) : (
            timeAgo(poll.created_at)
          )}
        </span>
      </div>
    </button>
  )
}

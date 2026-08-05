import Link from 'next/link'
import { Trophy } from 'lucide-react'
import type { BoardId } from '@/lib/member-profile'

/**
 * "Visit the leaderboard" entry point.
 *
 * Every ranking lives on one page (Leaderboards / Members › Leaderboard), so
 * the modules that FEED a board — gaming, invites, the economy, leveling,
 * reputation — link to their own board rather than repeating the table. One
 * component owns the hrefs and the labels so a board renamed here changes
 * everywhere at once.
 *
 * Plain markup (no hooks), so server and client pages can both render it.
 */

const BOARD_LABELS: Record<BoardId, string> = {
  level: 'Level leaderboard',
  reputation: 'Reputation leaderboard',
  active: 'Activity leaderboard',
  richest: 'Richest leaderboard',
  invites: 'Top inviters leaderboard',
  gaming: 'Gaming leaderboard',
}

type Props = {
  guildId: string
  board: BoardId
  /** Overrides the default label for the board. */
  label?: string
  /** `button` matches the bordered actions in a PageHeader; `inline` is the
   *  quiet accent link used inside a card that already shows a top-five. */
  variant?: 'button' | 'inline'
  /** Bordered buttons match their neighbours: `sm` = text-xs (default), `md` = text-sm. */
  size?: 'sm' | 'md'
  className?: string
}

export function LeaderboardLink({
  guildId,
  board,
  label,
  variant = 'button',
  size = 'sm',
  className,
}: Props) {
  const href = `/dashboard/${guildId}/leaderboard?board=${board}`
  const text = label ?? BOARD_LABELS[board]

  if (variant === 'inline') {
    return (
      <Link
        href={href}
        className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${className ?? ''}`}
        style={{ color: 'var(--p-1)' }}
      >
        <Trophy size={12} />
        {text}
      </Link>
    )
  }

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium transition-colors ${
        size === 'md' ? 'text-sm' : 'text-xs'
      } ${className ?? ''}`}
      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
      title="Every ranking lives on the Leaderboards page"
    >
      <Trophy size={12} style={{ color: 'var(--p-1)' }} />
      {text}
    </Link>
  )
}

import { cn } from '@/lib/utils'

/**
 * Leaderboard rank indicator. The top three ranks get an accent-coloured
 * numbered circle (replacing the old 🥇🥈🥉 medal emoji); ranks 4+ fall back
 * to a muted neutral circle. Shared across every leaderboard so the rank
 * treatment stays consistent.
 */
export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const top = rank <= 3
  return (
    <span
      aria-label={`Rank ${rank}`}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums',
        className,
      )}
      style={
        top
          ? {
              background: 'var(--p-soft)',
              color: 'var(--p-1)',
              // Inset ring instead of `border` so the circle keeps its exact
              // 28px footprint regardless of the ring width.
              boxShadow: 'inset 0 0 0 1.5px var(--p-1)',
            }
          : { background: 'var(--bg-2)', color: 'var(--text-3)' }
      }
    >
      {rank}
    </span>
  )
}

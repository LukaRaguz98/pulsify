type Props = {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  /**
   * Visual tone of the icon badge:
   * - `accent` (default) — brand-tinted, for true-empty states ("nothing here
   *   yet"), usually paired with a primary call-to-action.
   * - `muted` — neutral, for "no results / no matches" states after a search or
   *   filter, where the data simply isn't in the current view.
   */
  variant?: 'accent' | 'muted'
  className?: string
}

/**
 * Shared empty-state card. One look for every "there's nothing to show" moment
 * across the app: a tinted icon badge, a title, an optional description and an
 * optional action. Use `variant` to signal whether it's a genuinely empty
 * resource (accent + CTA) or just an empty filtered view (muted).
 */
export function EmptyState({ icon, title, description, action, variant = 'accent', className }: Props) {
  const badge =
    variant === 'muted'
      ? { background: 'var(--bg-2)', color: 'var(--text-3)' }
      : { background: 'var(--p-soft)', color: 'var(--p-1)' }

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border px-6 py-16 text-center ${className ?? ''}`}
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      {icon && (
        <div
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={badge}
        >
          {icon}
        </div>
      )}
      <p className="font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

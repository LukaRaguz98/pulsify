type Props = {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border py-16 text-center ${className ?? ''}`}
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      {icon && (
        <div className="mb-4" style={{ color: 'var(--text-3)' }}>{icon}</div>
      )}
      <p className="font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-2 text-sm max-w-sm" style={{ color: 'var(--text-3)' }}>{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

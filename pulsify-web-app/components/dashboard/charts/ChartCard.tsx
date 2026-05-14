import type { ReactNode } from 'react'

type Props = {
  title: string
  subtitle?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}

export function ChartCard({ title, subtitle, icon, action, className, children }: Props) {
  return (
    <div
      className={`rounded-xl border p-5 ${className ?? ''}`}
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {icon && (
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
            >
              {icon}
            </span>
          )}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-subtle">
              {title}
            </h3>
            {subtitle && <p className="mt-0.5 text-xs text-subtle">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  )
}

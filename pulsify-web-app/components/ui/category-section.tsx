import type { ReactNode } from 'react'

type Props = {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
  /** Optional controls rendered on the right of the header line (after the rule). */
  action?: ReactNode
}

export function CategorySection({ icon, title, description, children, action }: Props) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: 'var(--bg-2)',
            color: 'var(--text-3)',
            border: '1px solid var(--line-strong)',
          }}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h2
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--text-2)' }}
          >
            {title}
          </h2>
          <p className="text-xs text-subtle">{description}</p>
        </div>
        <div className="ml-1 h-px flex-1" style={{ background: 'var(--line-strong)' }} />
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

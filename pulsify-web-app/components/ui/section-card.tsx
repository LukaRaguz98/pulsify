import { cn } from '@/lib/utils'

type Props = {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  footer?: React.ReactNode
}

export function SectionCard({ title, description, children, className, footer }: Props) {
  return (
    <section
      className={cn('rounded-xl border overflow-hidden', className)}
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="p-6">
        <h2 className="font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-1 text-sm" style={{ color: 'var(--text-3)' }}>{description}</p>
        )}
        <div className="mt-5">{children}</div>
      </div>
      {footer && (
        <div className="border-t px-6 py-4" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          {footer}
        </div>
      )}
    </section>
  )
}

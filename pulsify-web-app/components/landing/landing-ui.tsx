import type { ReactNode } from 'react'
import Image from 'next/image'

/** Small accent eyebrow label used above section titles. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider"
      style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
    >
      {children}
    </span>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'center',
}: {
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  align?: 'center' | 'left'
}) {
  const alignClass = align === 'center' ? 'items-center text-center mx-auto' : 'items-start text-left'
  return (
    <div className={`flex max-w-2xl flex-col gap-4 ${alignClass}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h2>
      {subtitle && (
        <p className="text-base leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}

/**
 * App-window frame used to present mockups. Branded Pulsify titlebar (no
 * macOS traffic-light dots). `flush` renders the body on the app canvas
 * colour (var(--bg)) with no padding — used for the full dashboard preview so
 * inner panels contrast the way they do in the real app.
 */
export function MockWindow({
  label,
  children,
  className,
  flush,
}: {
  label?: string
  children: ReactNode
  className?: string
  flush?: boolean
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border shadow-2xl ${className ?? ''}`}
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div
        className="flex items-center gap-2 border-b px-4 py-2.5"
        style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}
      >
        <Image src="/logo.png" alt="" width={15} height={15} />
        {label && (
          <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            {label}
          </span>
        )}
      </div>
      <div className={flush ? '' : 'p-4 sm:p-5'} style={flush ? { background: 'var(--bg)' } : undefined}>
        {children}
      </div>
    </div>
  )
}

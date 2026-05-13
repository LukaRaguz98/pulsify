type Props = {
  label: string
  value: string | number
  sub?: string
  icon: React.ReactNode
  accent?: string
}

export function StatsCard({ label, value, sub, icon, accent }: Props) {
  return (
    <div
      className="rounded-xl border p-5 transition-all duration-150 hover:-translate-y-0.5"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{
            background: accent ? `${accent}1a` : 'var(--p-soft)',
            color: accent ?? 'var(--p-1)',
          }}
        >
          {icon}
        </span>
      </div>
      <p
        className="text-3xl font-bold tracking-tight"
        style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', color: 'var(--text)' }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-subtle">{sub}</p>}
    </div>
  )
}

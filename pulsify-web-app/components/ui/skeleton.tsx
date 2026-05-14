export function Skeleton({
  className,
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={`animate-pulse rounded-lg ${className ?? ''}`}
      style={{ background: 'var(--bg-2)', ...style }}
    />
  )
}

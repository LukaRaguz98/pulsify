import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import {
  CATEGORY_META,
  SEVERITY_META,
  type Recommendation,
} from '@/lib/insights'
import { InsightIcon } from './icons'

type Props = {
  guildId: string
  rec: Recommendation
}

/**
 * A single recommendation: severity-coloured accent + icon, category tag, the
 * finding, and an optional quick-fix deep-link to the page that resolves it.
 */
export function RecommendationCard({ guildId, rec }: Props) {
  const severity = SEVERITY_META[rec.severity]
  const category = CATEGORY_META[rec.category]

  return (
    <div
      className="insight-card relative flex flex-col overflow-hidden rounded-xl border p-5 pl-6 transition-all duration-150 hover:-translate-y-0.5"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      {/* Severity rail */}
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: severity.accent }}
        aria-hidden
      />

      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: `color-mix(in srgb, ${severity.accent} 16%, transparent)`,
            color: severity.accent,
          }}
        >
          <InsightIcon name={rec.icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{
                background: `color-mix(in srgb, ${severity.accent} 14%, transparent)`,
                color: severity.accent,
              }}
            >
              <InsightIcon name={severity.icon} size={10} />
              {severity.label}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
            >
              <InsightIcon name={category.icon} size={10} />
              {category.label}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">{rec.title}</h3>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
        {rec.detail}
      </p>

      {rec.action && (
        <div className="mt-4 flex">
          <Link
            href={`/dashboard/${guildId}${rec.action.path}`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--p-soft)'
              e.currentTarget.style.borderColor = 'var(--p-1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = ''
              e.currentTarget.style.borderColor = 'var(--line-strong)'
            }}
          >
            {rec.action.label}
            <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </div>
  )
}

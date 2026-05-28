'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Search, Sparkles, FileText } from 'lucide-react'
import {
  RELEASE_CATEGORY_COLOR,
  RELEASE_CATEGORY_LABEL,
  type Release,
  type ReleaseCategory,
} from '@/lib/release-notes-types'

import { renderInline } from './inline-format'

const ALL_CATEGORIES: ReleaseCategory[] = ['feature', 'improvement', 'fix', 'uiux', 'performance']

/**
 * Interactive release timeline. The release data is loaded server-side (so
 * the public page stays cache-friendly) and rendered into this client
 * component, which owns the local UI state: search query, category filter,
 * expanded/collapsed entries.
 */
export function ReleaseTimeline({ releases }: { releases: Release[] }) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<'all' | ReleaseCategory>('all')
  // Newest release expanded by default so the page lands with content visible.
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    releases.length > 0 ? new Set([releases[0].versionKey]) : new Set(),
  )

  function toggle(versionKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(versionKey)) next.delete(versionKey)
      else next.add(versionKey)
      return next
    })
  }

  // Build a filtered view of releases. A release passes the filter when its
  // version/title/section-titles/items match the query AND it contains at
  // least one section in the selected category. Items inside sections that
  // don't match the active category are hidden — the section itself is
  // dropped when it ends up empty.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return releases
      .map((r) => {
        const sections = r.sections
          .filter((s) => activeCategory === 'all' || s.category === activeCategory)
          .map((s) => ({
            ...s,
            items: q
              ? s.items.filter((i) => (i.lead ?? '').toLowerCase().includes(q) || i.body.toLowerCase().includes(q))
              : s.items,
          }))
          .filter((s) => s.items.length > 0)

        if (q && sections.length === 0) {
          // When the user is searching, also match against the release
          // header itself so a query like "workspace" surfaces the whole
          // entry even if no section title matched.
          const headerHit =
            r.title.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            r.version.includes(q)
          if (!headerHit) return null
        }

        return { release: r, sections }
      })
      .filter((x): x is { release: Release; sections: typeof releases[number]['sections'] } => x !== null)
  }, [releases, query, activeCategory])

  if (releases.length === 0) {
    return (
      <div
        className="mx-auto mt-12 max-w-2xl rounded-2xl border p-10 text-center"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
          <FileText size={22} />
        </span>
        <p className="mt-4 text-base font-semibold text-foreground">No releases yet</p>
        <p className="mt-1.5 text-sm" style={{ color: 'var(--text-3)' }}>
          Release notes will appear here as Pulsify ships new versions.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto mt-12 max-w-4xl">
      {/* Search + category filter row. Wraps on mobile so the chips drop
          below the search input. */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search releases…"
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip label="All" active={activeCategory === 'all'} color="var(--p-1)" onClick={() => setActiveCategory('all')} />
          {ALL_CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              label={RELEASE_CATEGORY_LABEL[c]}
              active={activeCategory === c}
              color={RELEASE_CATEGORY_COLOR[c]}
              onClick={() => setActiveCategory(c)}
            />
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div
          className="rounded-2xl border p-8 text-center"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <p className="text-sm font-semibold text-foreground">No matches</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>
            Try a different keyword or clear the category filter.
          </p>
        </div>
      ) : (
        <ol className="relative space-y-6 border-l pl-8" style={{ borderColor: 'var(--line-strong)' }}>
          {visible.map(({ release, sections }) => {
            const open = expanded.has(release.versionKey)
            return (
              <li key={release.versionKey} className="relative">
                {/* Timeline dot — bright for the latest release, muted otherwise. */}
                <span
                  className="absolute -left-[2.75rem] flex h-6 w-6 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-110"
                  style={{
                    background: open ? 'var(--p-1)' : 'var(--panel)',
                    color: open ? '#fff' : 'var(--p-1)',
                    border: '2px solid var(--p-1)',
                    boxShadow: '0 0 0 4px var(--bg)',
                  }}
                  aria-hidden
                >
                  <Sparkles size={11} />
                </span>

                <article
                  className="overflow-hidden rounded-2xl border transition-all duration-200"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                >
                  <button
                    type="button"
                    onClick={() => toggle(release.versionKey)}
                    className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors"
                    aria-expanded={open}
                    aria-controls={`release-${release.versionKey}-body`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span
                          className="rounded-md px-2 py-0.5 font-mono text-xs font-semibold"
                          style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
                        >
                          v{release.version}
                        </span>
                        <h3 className="text-base font-semibold text-foreground">{release.title}</h3>
                        <span className="text-xs" style={{ color: 'var(--text-3)' }}>{release.date}</span>
                      </div>
                      {release.description && (
                        <p className="mt-2 line-clamp-2 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                          {renderInline(release.description)}
                        </p>
                      )}
                    </div>
                    <ChevronDown
                      size={18}
                      className="mt-1 shrink-0 transition-transform duration-200"
                      style={{
                        color: 'var(--text-3)',
                        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </button>

                  {/* Collapsible body — grid-template-rows 0fr/1fr animates
                      the height even when the content height is unknown. */}
                  <div
                    id={`release-${release.versionKey}-body`}
                    style={{
                      display: 'grid',
                      gridTemplateRows: open ? '1fr' : '0fr',
                      opacity: open ? 1 : 0,
                      transition: 'grid-template-rows 0.24s ease, opacity 0.2s ease',
                    }}
                    aria-hidden={!open}
                    inert={!open}
                  >
                    <div style={{ overflow: 'hidden', minHeight: 0 }}>
                      <div className="border-t px-5 py-5" style={{ borderColor: 'var(--line-strong)' }}>
                        {sections.length === 0 && release.outro && (
                          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{renderInline(release.outro)}</p>
                        )}
                        <div className="space-y-6">
                          {sections.map((section) => {
                            const color = RELEASE_CATEGORY_COLOR[section.category]
                            return (
                              <section key={section.title}>
                                <div className="mb-3 flex flex-wrap items-center gap-2">
                                  <span
                                    className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                                    style={{
                                      background: `${color}1f`,
                                      color,
                                      border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
                                    }}
                                  >
                                    {RELEASE_CATEGORY_LABEL[section.category]}
                                  </span>
                                  <h4 className="text-sm font-semibold text-foreground">{section.title}</h4>
                                </div>
                                <ul className="space-y-2">
                                  {section.items.map((item, idx) => (
                                    <li key={idx} className="flex gap-3 text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                                      <span
                                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                                        style={{ background: color }}
                                      />
                                      <span>
                                        {item.lead && (
                                          <strong className="font-semibold text-foreground">{item.lead}</strong>
                                        )}
                                        {item.lead && ' — '}
                                        {renderInline(item.body)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </section>
                            )
                          })}
                        </div>
                        {release.outro && sections.length > 0 && (
                          <p className="mt-6 border-t pt-4 text-sm leading-relaxed" style={{ color: 'var(--text-3)', borderColor: 'var(--line-strong)' }}>
                            {renderInline(release.outro)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function FilterChip({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
      style={{
        background: active ? `${color}1f` : 'var(--bg-2)',
        borderColor: active ? color : 'var(--line-strong)',
        color: active ? color : 'var(--text-2)',
      }}
    >
      {label}
    </button>
  )
}

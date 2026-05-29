'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  Search, X, CornerDownLeft, ArrowUp, ArrowDown, Clock3, History, Clock,
  Compass, Home, Server, Users, UserRound, UserPlus, StickyNote, ListChecks,
  ShieldAlert, LineChart, Zap, Plus, Eye, RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import {
  runWorkspaceSearch, groupWorkspaceResults,
  type WsSearchResult, type WsSearchCategory,
} from '@/lib/workspace-command-palette'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspaceCommandPalette, type WsRecentOpened } from './WorkspaceCommandPaletteProvider'

const ICONS: Record<string, LucideIcon> = {
  Compass, Home, Server, Users, UserRound, UserPlus, StickyNote, ListChecks,
  ShieldAlert, LineChart, Zap, Plus, Eye, History, Search, RefreshCw, Clock,
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Compass
  return <C size={size} />
}

// Discriminated row model: the same flat list drives rendering and keyboard nav,
// so the highlighted index always lines up with the DOM.
type Row =
  | { kind: 'header'; key: string; label: string; icon: string; accent: string; hint?: string }
  | { kind: 'result'; key: string; result: WsSearchResult }
  | { kind: 'recent-search'; key: string; query: string }

function isSelectable(r: Row): boolean {
  return r.kind !== 'header'
}

function recentToResult(item: WsRecentOpened): WsSearchResult {
  return {
    id: `recent-${item.href}`,
    category: item.category,
    title: item.title,
    icon: item.icon,
    action: { kind: 'navigate', href: item.href },
    score: 0,
  }
}

export function WorkspaceCommandPalette() {
  const router = useRouter()
  const {
    workspaceId, role, closePalette, index, status, initialQuery,
    recentSearches, recentOpened, pushRecentSearch, pushRecentOpened,
  } = useWorkspaceCommandPalette()

  const [query, setQuery] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const [selected, setSelected] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Grab focus and drop the cursor at the end of any seeded text.
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [])

  // Debounce the query that feeds the (local) search.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query)
      setSelected(0)
    }, 110)
    return () => clearTimeout(t)
  }, [query])

  const hasQuery = debounced.trim().length > 0

  // ── Build the flat row list ────────────────────────────────────────────────
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []

    // Empty state: recents first, then the static launcher (actions + nav).
    if (!hasQuery) {
      if (recentOpened.length > 0) {
        out.push({ kind: 'header', key: 'h-recent-open', label: 'Recently opened', icon: 'Clock', accent: 'var(--text-2)' })
        for (const item of recentOpened) {
          out.push({ kind: 'result', key: `ro-${item.href}`, result: recentToResult(item) })
        }
      }
      if (recentSearches.length > 0) {
        out.push({ kind: 'header', key: 'h-recent-search', label: 'Recent searches', icon: 'History', accent: 'var(--text-2)' })
        for (const q of recentSearches) out.push({ kind: 'recent-search', key: `rs-${q}`, query: q })
      }
    }

    const results = runWorkspaceSearch(debounced, index, workspaceId, role)
    const grouped = groupWorkspaceResults(results, hasQuery)
    for (const g of grouped) {
      const overflow = g.total - g.items.length
      out.push({
        kind: 'header',
        key: `h-${g.category}`,
        label: g.label,
        icon: g.icon,
        accent: g.accent,
        hint: overflow > 0 ? `+${overflow} more` : undefined,
      })
      for (const item of g.items) out.push({ kind: 'result', key: item.id, result: item })
    }
    return out
  }, [debounced, hasQuery, index, workspaceId, role, recentOpened, recentSearches])

  const selectableIdx = useMemo(
    () => rows.map((r, i) => (isSelectable(r) ? i : -1)).filter((i) => i >= 0),
    [rows],
  )

  const clampedSelected = selectableIdx.length ? Math.min(selected, selectableIdx.length - 1) : 0

  // Scroll the highlighted row into view as the user arrows through.
  useEffect(() => {
    const rowIndex = selectableIdx[clampedSelected]
    if (rowIndex == null) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-row="${rowIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [clampedSelected, selectableIdx])

  // ── Activation ───────────────────────────────────────────────────────────
  function activateRow(row: Row) {
    if (row.kind === 'result') handleResult(row.result)
    else if (row.kind === 'recent-search') setQuery(row.query)
  }

  function handleResult(r: WsSearchResult) {
    if (hasQuery) pushRecentSearch(debounced)
    pushRecentOpened({ title: r.title, href: r.action.href, icon: r.icon, category: r.category })
    closePalette()
    router.push(r.action.href)
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(selectableIdx.length ? (clampedSelected + 1) % selectableIdx.length : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(selectableIdx.length ? (clampedSelected - 1 + selectableIdx.length) % selectableIdx.length : 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const rowIndex = selectableIdx[clampedSelected]
      if (rowIndex != null) activateRow(rows[rowIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closePalette()
    }
  }

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) closePalette()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [closePalette])

  if (typeof document === 'undefined') return null

  const loadingFirstTime = status === 'loading' && index.generatedAt === ''
  const highlightedRowIndex = selectableIdx[clampedSelected]

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', animation: 'cmdk-fade 0.12s ease' }}
    >
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label="Workspace command palette"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          background: 'var(--panel)',
          borderColor: 'var(--line-strong)',
          animation: 'cmdk-pop 0.16s cubic-bezier(0.16,1,0.3,1)',
        }}
        onKeyDown={onKeyDown}
      >
        {/* Search field */}
        <div className="flex items-center gap-3 border-b px-4" style={{ borderColor: 'var(--line-strong)' }}>
          <span className="shrink-0" style={{ color: 'var(--text-3)' }}>
            <Search size={18} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search servers, team, notes, tasks, or jump to…"
            spellCheck={false}
            autoComplete="off"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-3)]"
            style={{ color: 'var(--text)' }}
          />
          <button
            type="button"
            onClick={closePalette}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 transition-colors hover:text-foreground"
            style={{ color: 'var(--text-3)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto px-2 py-2">
          {loadingFirstTime ? (
            <LoadingRows />
          ) : status === 'error' && index.generatedAt === '' ? (
            <EmptyMessage
              icon="RefreshCw"
              title="Couldn’t load search"
              hint="Check your connection and reopen the palette."
            />
          ) : rows.length === 0 ? (
            <EmptyMessage
              icon="Search"
              title={hasQuery ? `No results for “${debounced.trim()}”` : 'Start typing to search'}
              hint="Search servers, team, notes, tasks, incidents and more."
            />
          ) : (
            rows.map((row, i) => {
              if (row.kind === 'header') {
                return (
                  <div
                    key={row.key}
                    className="flex items-center gap-2 px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider first:pt-1"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <span style={{ color: row.accent }}><Icon name={row.icon} size={12} /></span>
                    <span className="flex-1">{row.label}</span>
                    {row.hint && <span className="font-medium normal-case tracking-normal">{row.hint}</span>}
                  </div>
                )
              }
              const active = i === highlightedRowIndex
              const selIdx = selectableIdx.indexOf(i)
              if (row.kind === 'recent-search') {
                return (
                  <RowButton key={row.key} rowIndex={i} active={active} onActivate={() => activateRow(row)} onHover={() => setSelected(selIdx)}>
                    <span className="shrink-0" style={{ color: 'var(--text-3)' }}><Clock3 size={15} /></span>
                    <span className="flex-1 truncate" style={{ color: 'var(--text-2)' }}>{row.query}</span>
                  </RowButton>
                )
              }
              return (
                <ResultRow
                  key={row.key}
                  rowIndex={i}
                  result={row.result}
                  active={active}
                  onActivate={() => activateRow(row)}
                  onHover={() => setSelected(selIdx)}
                />
              )
            })
          )}
        </div>

        {/* Footer hints */}
        <div
          className="flex items-center gap-4 border-t px-4 py-2.5 text-[11px]"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)', color: 'var(--text-3)' }}
        >
          <FooterKey icon={<ArrowUp size={11} />} extra={<ArrowDown size={11} />} label="Navigate" />
          <FooterKey icon={<CornerDownLeft size={11} />} label="Open" />
          <FooterKey kbd="Esc" label="Close" />
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Row primitives ────────────────────────────────────────────────────────────

function RowButton({
  rowIndex, active, onActivate, onHover, children,
}: {
  rowIndex: number
  active: boolean
  onActivate: () => void
  onHover: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-row={rowIndex}
      onClick={onActivate}
      onMouseMove={onHover}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors"
      style={{ background: active ? 'var(--p-soft)' : 'transparent', boxShadow: active ? 'inset 0 0 0 1px var(--p-soft)' : 'none' }}
    >
      {children}
    </button>
  )
}

function ResultRow({
  rowIndex, result, active, onActivate, onHover,
}: {
  rowIndex: number
  result: WsSearchResult
  active: boolean
  onActivate: () => void
  onHover: () => void
}) {
  const accent = result.accent ?? categoryAccent(result.category)
  return (
    <RowButton rowIndex={rowIndex} active={active} onActivate={onActivate} onHover={onHover}>
      {result.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={result.imageUrl} alt="" width={26} height={26} className="h-[26px] w-[26px] shrink-0 rounded-full object-cover" />
      ) : (
        <span
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'color-mix(in srgb, ' + accent + ' 16%, transparent)', color: accent }}
        >
          <Icon name={result.icon} size={15} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm" style={{ color: 'var(--text)' }}>{result.title}</span>
        {result.subtitle && (
          <span className="block truncate text-xs" style={{ color: 'var(--text-3)' }}>{result.subtitle}</span>
        )}
      </span>
      {result.badge && <Tag>{result.badge}</Tag>}
      {active && (
        <span className="shrink-0" style={{ color: 'var(--text-3)' }}><CornerDownLeft size={13} /></span>
      )}
    </RowButton>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide leading-none"
      style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
    >
      {children}
    </span>
  )
}

function FooterKey({ icon, extra, kbd, label }: { icon?: React.ReactNode; extra?: React.ReactNode; kbd?: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-center gap-0.5">
        {kbd ? (
          <kbd className="rounded border px-1 py-0.5 font-mono text-[10px] leading-none" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>{kbd}</kbd>
        ) : (
          <>
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded border" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>{icon}</span>
            {extra && <span className="flex h-[18px] w-[18px] items-center justify-center rounded border" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>{extra}</span>}
          </>
        )}
      </span>
      {label}
    </span>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-1 p-1">
      <Skeleton className="mb-2 h-3 w-24" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="h-[26px] w-[26px] rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5" style={{ width: `${55 - i * 6}%` }} />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyMessage({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span style={{ color: 'var(--text-3)' }}><Icon name={icon} size={26} /></span>
      <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</p>
      <p className="max-w-xs text-xs" style={{ color: 'var(--text-3)' }}>{hint}</p>
    </div>
  )
}

const CATEGORY_ACCENTS: Record<WsSearchCategory, string> = {
  action: 'var(--p-1)', navigation: 'var(--text-2)', server: '#22d3ee',
  member: '#60a5fa', note: '#a855f7', task: '#10b981', incident: '#f87171',
}
function categoryAccent(c: WsSearchCategory): string {
  return CATEGORY_ACCENTS[c] ?? 'var(--text-2)'
}

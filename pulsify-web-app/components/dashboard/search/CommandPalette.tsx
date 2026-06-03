'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  Search, X, CornerDownLeft, ArrowUp, ArrowDown, Loader2, History, Clock3,
  BarChart2, Activity, Hash, UserRound, Users, CalendarDays, Command as CommandIcon,
  Zap, CalendarClock, Shield, ShieldAlert, Bell, Server, SlidersHorizontal, Sparkles,
  CalendarPlus, Plus, AlertCircle, Clock, LineChart, RefreshCw, Compass,
  Bot, Volume2, Folder, Megaphone, Radio, MessagesSquare, Image as ImageIcon,
  Lightbulb, LifeBuoy, Gift, Trophy, Plug, Award,
  type LucideIcon,
} from 'lucide-react'
import {
  runSearch, groupResults, searchMembers,
  type SearchResult, type SearchCategory, type IndexMember,
} from '@/lib/command-palette'
import { ConfirmDialog, type FieldDef } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  warnMember, timeoutMember,
  type ActionResult, type ActionTarget,
} from '@/app/dashboard/[guildId]/moderation/actions'
import { triggerGuildSync } from '@/app/dashboard/[guildId]/search/actions'
import { useCommandPalette, type RecentOpened } from './CommandPaletteProvider'

const ICONS: Record<string, LucideIcon> = {
  BarChart2, Activity, Hash, UserRound, Users, CalendarDays, Command: CommandIcon,
  Zap, CalendarClock, Shield, ShieldAlert, Bell, Server, SlidersHorizontal, Sparkles,
  CalendarPlus, Plus, AlertCircle, Clock, LineChart, RefreshCw, Compass, History,
  Bot, Volume2, Folder, Megaphone, Radio, MessagesSquare, Image: ImageIcon,
  Lightbulb, LifeBuoy, Gift, Trophy, Plug, Award,
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? Compass
  return <C size={size} />
}

const TIMEOUT_OPTIONS = [
  { label: '60 seconds', value: '1' },
  { label: '5 minutes', value: '5' },
  { label: '10 minutes', value: '10' },
  { label: '1 hour', value: '60' },
  { label: '1 day', value: '1440' },
  { label: '1 week', value: '10080' },
]

type Mode = { kind: 'search' } | { kind: 'pick-member'; action: 'warn' | 'timeout' }

// Discriminated row model: the same flat list drives both rendering and
// keyboard navigation, so the highlighted index always lines up with the DOM.
type Row =
  | { kind: 'header'; key: string; label: string; icon: string; accent: string; hint?: string }
  | { kind: 'result'; key: string; result: SearchResult }
  | { kind: 'recent-search'; key: string; query: string }
  | { kind: 'member'; key: string; member: IndexMember }

function isSelectable(r: Row): boolean {
  return r.kind !== 'header'
}

function recentToResult(item: RecentOpened): SearchResult {
  return {
    id: `recent-${item.href}`,
    category: item.category,
    title: item.title,
    icon: item.icon,
    action: { kind: 'navigate', href: item.href },
    score: 0,
  }
}

export function CommandPalette() {
  const router = useRouter()
  const {
    guildId, closePalette, index, status, initialQuery,
    recentSearches, recentOpened, pushRecentSearch, pushRecentOpened,
  } = useCommandPalette()

  // Seeded from the sidebar field's hand-off, or '' for ⌘K. The provider mounts
  // this fresh per open, so reading initialQuery once at mount is correct.
  const [query, setQuery] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const [mode, setMode] = useState<Mode>({ kind: 'search' })
  const [selected, setSelected] = useState(0)
  const [pending, setPending] = useState<{ member: IndexMember; action: 'warn' | 'timeout' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // The provider mounts this fresh on each open, so initial state is already a
  // clean slate — grab focus and drop the cursor at the end of any seeded text.
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [])

  // Debounce the query that feeds the (local) search so fast typing doesn't
  // thrash re-renders on large indexes. Resetting the highlight here (in the
  // async callback) keeps it off the synchronous effect body.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query)
      setSelected(0)
    }, 110)
    return () => clearTimeout(t)
  }, [query])

  // Auto-dismiss the action feedback pill.
  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => setFeedback(null), 2600)
    return () => clearTimeout(t)
  }, [feedback])

  const hasQuery = debounced.trim().length > 0

  // ── Build the flat row list ────────────────────────────────────────────────
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []

    if (mode.kind === 'pick-member') {
      const members = searchMembers(debounced, index)
      out.push({
        kind: 'header',
        key: 'pick-header',
        label: `Select a member to ${mode.action === 'warn' ? 'warn' : 'time out'}`,
        icon: mode.action === 'warn' ? 'AlertCircle' : 'Clock',
        accent: 'var(--p-1)',
        hint: members.length ? `${members.length} match${members.length === 1 ? '' : 'es'}` : undefined,
      })
      for (const m of members) out.push({ kind: 'member', key: `pm-${m.id}`, member: m })
      return out
    }

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

    const results = runSearch(debounced, index, guildId)
    const grouped = groupResults(results, hasQuery)
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
  }, [mode, debounced, hasQuery, index, guildId, recentOpened, recentSearches])

  // Selectable row indices, and a clamp so `selected` always lands on one.
  const selectableIdx = useMemo(
    () => rows.map((r, i) => (isSelectable(r) ? i : -1)).filter((i) => i >= 0),
    [rows],
  )

  // Clamp at render rather than via a reset effect — the stored index may run
  // ahead of a shrinking list (e.g. as the index finishes loading), so every
  // read goes through the clamped value.
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
    else if (row.kind === 'member') setPending({ member: row.member, action: (mode as { action: 'warn' | 'timeout' }).action })
  }

  function handleResult(r: SearchResult) {
    const a = r.action
    if (a.kind === 'navigate') {
      if (hasQuery) pushRecentSearch(debounced)
      pushRecentOpened({ title: r.title, href: a.href, icon: r.icon, category: r.category })
      closePalette()
      router.push(a.href)
    } else if (a.kind === 'command') {
      if (a.commandId === 'sync') void runSync()
    } else if (a.kind === 'pick-member') {
      setMode({ kind: 'pick-member', action: a.memberAction })
      setQuery('')
      setDebounced('')
      setSelected(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  async function runSync() {
    setBusy(true)
    setFeedback(null)
    const res = await triggerGuildSync(guildId)
    setBusy(false)
    if (res.ok) {
      setFeedback({
        kind: 'ok',
        text: res.memberCount != null
          ? `Server synced — ${res.memberCount.toLocaleString()} members.`
          : 'Server synced.',
      })
      router.refresh()
    } else {
      setFeedback({ kind: 'err', text: res.error })
    }
  }

  function exitPickMode() {
    setMode({ kind: 'search' })
    setQuery('')
    setDebounced('')
    setSelected(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // ── Member action dialog ───────────────────────────────────────────────────
  async function runMemberAction(values: Record<string, string>) {
    if (!pending) return
    setBusy(true)
    setDialogError(null)
    const target: ActionTarget = {
      id: pending.member.id,
      displayName: pending.member.name,
      username: pending.member.handle,
    }
    const reason = values.reason?.trim() || undefined

    let result: ActionResult
    if (pending.action === 'warn') {
      if (!reason) { setBusy(false); setDialogError('A reason is required for warnings.'); return }
      result = await warnMember(guildId, target, reason)
    } else {
      const minutes = Number(values.duration) || 0
      if (minutes <= 0) { setBusy(false); setDialogError('Pick a duration.'); return }
      result = await timeoutMember(guildId, target, minutes, reason)
    }

    setBusy(false)
    if (!result.ok) { setDialogError(result.error); return }
    // The moderation action records a notification, so the global Toaster
    // surfaces the confirmation — just dismiss the palette here.
    setPending(null)
    closePalette()
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    if (pending) return // ConfirmDialog owns the keyboard while it's open
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
      if (mode.kind === 'pick-member') exitPickMode()
      else closePalette()
    } else if (e.key === 'Backspace' && query === '' && mode.kind === 'pick-member') {
      e.preventDefault()
      exitPickMode()
    }
  }

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (pending) return
      if (!rootRef.current?.contains(e.target as Node)) closePalette()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [pending, closePalette])

  if (typeof document === 'undefined') return null

  const loadingFirstTime = status === 'loading' && index.generatedAt === ''
  const highlightedRowIndex = selectableIdx[clampedSelected]

  const placeholder =
    mode.kind === 'pick-member'
      ? `Search a member to ${mode.action === 'warn' ? 'warn' : 'time out'}…`
      : 'Search members, channels, commands, or jump to…'

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', animation: 'cmdk-fade 0.12s ease' }}
      >
        <div
          ref={rootRef}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
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
            {mode.kind === 'pick-member' ? (
              <button
                type="button"
                onClick={exitPickMode}
                aria-label="Back to search"
                className="shrink-0 rounded-md p-1 transition-colors"
                style={{ color: 'var(--p-1)' }}
              >
                <Icon name={mode.action === 'warn' ? 'AlertCircle' : 'Clock'} size={18} />
              </button>
            ) : (
              <span className="shrink-0" style={{ color: 'var(--text-3)' }}>
                <Search size={18} />
              </span>
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              autoComplete="off"
              className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-3)]"
              style={{ color: 'var(--text)' }}
            />
            {status === 'loading' && index.generatedAt !== '' && (
              <Loader2 size={15} className="animate-spin shrink-0" style={{ color: 'var(--text-3)' }} />
            )}
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
                hint={
                  mode.kind === 'pick-member'
                    ? 'No members match that name.'
                    : 'Search members, roles, channels, events, commands and more.'
                }
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
                if (row.kind === 'member') {
                  const m = row.member
                  return (
                    <RowButton key={row.key} rowIndex={i} active={active} onActivate={() => activateRow(row)} onHover={() => setSelected(selIdx)}>
                      <MemberAvatar member={m} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm" style={{ color: 'var(--text)' }}>{m.name}</span>
                        <span className="block truncate text-xs" style={{ color: 'var(--text-3)' }}>@{m.handle}</span>
                      </span>
                      {m.inTimeout && <Tag>TIMEOUT</Tag>}
                      {m.bot && !m.inTimeout && <Tag>BOT</Tag>}
                    </RowButton>
                  )
                }
                // result
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
            <FooterKey kbd="Esc" label={mode.kind === 'pick-member' ? 'Back' : 'Close'} />
            {busy && (
              <span className="ml-auto flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
                <Loader2 size={12} className="animate-spin" /> Working…
              </span>
            )}
            {!busy && feedback && (
              <span className="ml-auto font-medium" style={{ color: feedback.kind === 'ok' ? 'var(--green)' : '#f87171' }}>
                {feedback.text}
              </span>
            )}
          </div>
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          title={`${pending.action === 'warn' ? 'Warn' : 'Timeout'} ${pending.member.name}`}
          description={
            pending.action === 'warn'
              ? 'Recorded in moderation history and visible to other moderators.'
              : `${pending.member.name} won’t be able to send messages, react, or join voice for the chosen duration.`
          }
          tone="warning"
          confirmLabel={pending.action === 'warn' ? 'Save warning' : 'Apply timeout'}
          fields={memberActionFields(pending.action)}
          busy={busy}
          error={dialogError}
          onCancel={() => { if (!busy) { setPending(null); setDialogError(null) } }}
          onConfirm={runMemberAction}
        />
      )}
    </>,
    document.body,
  )
}

function memberActionFields(action: 'warn' | 'timeout'): FieldDef[] {
  const reason: FieldDef = { key: 'reason', kind: 'text', label: 'Reason (optional)', placeholder: 'Shown in the audit log', maxLength: 500 }
  if (action === 'warn') {
    return [{ key: 'reason', kind: 'textarea', label: 'Reason', placeholder: 'What did they do?', required: true, maxLength: 500 }]
  }
  return [{ key: 'duration', kind: 'select', label: 'Duration', defaultValue: '10', options: TIMEOUT_OPTIONS }, reason]
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
  result: SearchResult
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

function MemberAvatar({ member }: { member: IndexMember }) {
  if (member.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.avatar} alt="" width={26} height={26} className="h-[26px] w-[26px] shrink-0 rounded-full object-cover" />
  }
  return (
    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>
      <UserRound size={14} />
    </span>
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

const CATEGORY_ACCENTS: Record<SearchCategory, string> = {
  action: 'var(--p-1)', navigation: 'var(--text-2)', member: '#60a5fa', role: '#a855f7',
  channel: '#22d3ee', event: '#818cf8', command: '#10b981', automation: '#f59e0b',
  moderation: '#f87171', notification: '#ec4899',
}
function categoryAccent(c: SearchCategory): string {
  return CATEGORY_ACCENTS[c] ?? 'var(--text-2)'
}

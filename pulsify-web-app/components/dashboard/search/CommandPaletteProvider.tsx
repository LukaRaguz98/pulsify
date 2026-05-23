'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { EMPTY_INDEX, type SearchCategory, type SearchIndex } from '@/lib/command-palette'
import { CommandPalette } from './CommandPalette'

/** A destination the user has opened from search — replayed in the empty state. */
export type RecentOpened = {
  title: string
  href: string
  icon: string
  category: SearchCategory
}

export type IndexStatus = 'idle' | 'loading' | 'ready' | 'error'

type ContextValue = {
  guildId: string
  open: boolean
  openPalette: () => void
  /** Open the palette pre-seeded with a query (sidebar field hand-off). */
  openWith: (query: string) => void
  closePalette: () => void
  /** Query the palette should start with on its next open. */
  initialQuery: string
  index: SearchIndex
  status: IndexStatus
  /** Kick off an index fetch if the cache is empty or stale. */
  ensureIndex: () => void
  recentSearches: string[]
  recentOpened: RecentOpened[]
  pushRecentSearch: (query: string) => void
  pushRecentOpened: (item: RecentOpened) => void
  clearRecents: () => void
}

const Ctx = createContext<ContextValue | null>(null)

// Client-side index cache lifetime. Within this window, reopening the palette
// reuses the snapshot instead of re-fetching — the Discord reads behind it are
// also cached server-side for 60s, so this keeps the two in step.
const INDEX_TTL_MS = 60_000
const MAX_RECENT_SEARCHES = 6
const MAX_RECENT_OPENED = 6

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function lsSet(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / privacy mode — recents are best-effort */
  }
}

export function CommandPaletteProvider({
  guildId,
  children,
}: {
  guildId: string
  children: React.ReactNode
}) {
  const searchesKey = `pulsify:cmdk:searches:${guildId}`
  const openedKey = `pulsify:cmdk:opened:${guildId}`

  const [open, setOpen] = useState(false)
  const [initialQuery, setInitialQuery] = useState('')
  const [index, setIndex] = useState<SearchIndex>(EMPTY_INDEX)
  const [status, setStatus] = useState<IndexStatus>('idle')
  // Lazy-read recents from localStorage. lsGet is SSR-safe (returns the
  // fallback on the server), and these values aren't rendered until the palette
  // opens — well after hydration — so this can't cause a hydration mismatch.
  const [recentSearches, setRecentSearches] = useState<string[]>(() => lsGet<string[]>(searchesKey, []))
  const [recentOpened, setRecentOpened] = useState<RecentOpened[]>(() => lsGet<RecentOpened[]>(openedKey, []))

  const fetchedAtRef = useRef(0)
  const inFlightRef = useRef(false)
  // Mirror `open` in a ref so the global key handler can read the latest value
  // without re-subscribing or risking a stale closure.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const ensureIndex = useCallback(() => {
    const fresh = Date.now() - fetchedAtRef.current < INDEX_TTL_MS
    if (inFlightRef.current || (fresh && status === 'ready')) return
    inFlightRef.current = true
    setStatus((s) => (s === 'ready' ? s : 'loading'))
    fetch(`/api/guilds/${guildId}/search`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as SearchIndex
        setIndex(data)
        fetchedAtRef.current = Date.now()
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
      .finally(() => {
        inFlightRef.current = false
      })
  }, [guildId, status])

  const openPalette = useCallback(() => {
    setInitialQuery('')
    setOpen(true)
    ensureIndex()
  }, [ensureIndex])

  const openWith = useCallback((query: string) => {
    setInitialQuery(query)
    setOpen(true)
    ensureIndex()
  }, [ensureIndex])

  const closePalette = useCallback(() => setOpen(false), [])

  // Global ⌘K / Ctrl+K toggle — always opens empty (for browsing); the sidebar
  // field is what seeds a query via openWith.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isToggle = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')
      if (!isToggle) return
      e.preventDefault()
      if (openRef.current) closePalette()
      else openPalette()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPalette, closePalette])

  const pushRecentSearch = useCallback(
    (query: string) => {
      const q = query.trim()
      if (q.length < 2) return
      setRecentSearches((prev) => {
        const next = [q, ...prev.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(
          0,
          MAX_RECENT_SEARCHES,
        )
        lsSet(searchesKey, next)
        return next
      })
    },
    [searchesKey],
  )

  const pushRecentOpened = useCallback(
    (item: RecentOpened) => {
      setRecentOpened((prev) => {
        const next = [item, ...prev.filter((r) => r.href !== item.href)].slice(0, MAX_RECENT_OPENED)
        lsSet(openedKey, next)
        return next
      })
    },
    [openedKey],
  )

  const clearRecents = useCallback(() => {
    setRecentSearches([])
    setRecentOpened([])
    lsSet(searchesKey, [])
    lsSet(openedKey, [])
  }, [searchesKey, openedKey])

  const value = useMemo<ContextValue>(
    () => ({
      guildId,
      open,
      openPalette,
      openWith,
      closePalette,
      initialQuery,
      index,
      status,
      ensureIndex,
      recentSearches,
      recentOpened,
      pushRecentSearch,
      pushRecentOpened,
      clearRecents,
    }),
    [
      guildId,
      open,
      openPalette,
      openWith,
      closePalette,
      initialQuery,
      index,
      status,
      ensureIndex,
      recentSearches,
      recentOpened,
      pushRecentSearch,
      pushRecentOpened,
      clearRecents,
    ],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Mounted only while open, so each open starts from a clean slate
          (fresh state) without a reset effect, and the entrance animation
          replays. */}
      {open && <CommandPalette />}
    </Ctx.Provider>
  )
}

export function useCommandPalette(): ContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCommandPalette must be used inside <CommandPaletteProvider>')
  return ctx
}

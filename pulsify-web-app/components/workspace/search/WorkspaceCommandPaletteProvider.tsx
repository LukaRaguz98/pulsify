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
import type { WorkspaceRole } from '@/lib/workspace'
import {
  WS_EMPTY_INDEX,
  type WorkspaceSearchIndex,
  type WsSearchCategory,
} from '@/lib/workspace-command-palette'
import { WorkspaceCommandPalette } from './WorkspaceCommandPalette'

/** A destination the user has opened from search — replayed in the empty state. */
export type WsRecentOpened = {
  title: string
  href: string
  icon: string
  category: WsSearchCategory
}

export type WsIndexStatus = 'idle' | 'loading' | 'ready' | 'error'

type ContextValue = {
  workspaceId: string
  role: WorkspaceRole
  open: boolean
  openPalette: () => void
  /** Open the palette pre-seeded with a query (sidebar field hand-off). */
  openWith: (query: string) => void
  closePalette: () => void
  /** Query the palette should start with on its next open. */
  initialQuery: string
  index: WorkspaceSearchIndex
  status: WsIndexStatus
  /** Kick off an index fetch if the cache is empty or stale. */
  ensureIndex: () => void
  recentSearches: string[]
  recentOpened: WsRecentOpened[]
  pushRecentSearch: (query: string) => void
  pushRecentOpened: (item: WsRecentOpened) => void
  clearRecents: () => void
}

const Ctx = createContext<ContextValue | null>(null)

// Mirrors the per-guild palette: a short client-side cache so reopening reuses
// the snapshot instead of re-fetching.
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

export function WorkspaceCommandPaletteProvider({
  workspaceId,
  role,
  children,
}: {
  workspaceId: string
  role: WorkspaceRole
  children: React.ReactNode
}) {
  const searchesKey = `pulsify:wcmdk:searches:${workspaceId}`
  const openedKey = `pulsify:wcmdk:opened:${workspaceId}`

  const [open, setOpen] = useState(false)
  const [initialQuery, setInitialQuery] = useState('')
  const [index, setIndex] = useState<WorkspaceSearchIndex>(WS_EMPTY_INDEX)
  const [status, setStatus] = useState<WsIndexStatus>('idle')
  const [recentSearches, setRecentSearches] = useState<string[]>(() => lsGet<string[]>(searchesKey, []))
  const [recentOpened, setRecentOpened] = useState<WsRecentOpened[]>(() => lsGet<WsRecentOpened[]>(openedKey, []))

  const fetchedAtRef = useRef(0)
  const inFlightRef = useRef(false)
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const ensureIndex = useCallback(() => {
    const fresh = Date.now() - fetchedAtRef.current < INDEX_TTL_MS
    if (inFlightRef.current || (fresh && status === 'ready')) return
    inFlightRef.current = true
    setStatus((s) => (s === 'ready' ? s : 'loading'))
    fetch(`/api/workspaces/${workspaceId}/search`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as WorkspaceSearchIndex
        setIndex(data)
        fetchedAtRef.current = Date.now()
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
      .finally(() => {
        inFlightRef.current = false
      })
  }, [workspaceId, status])

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

  // Global ⌘K / Ctrl+K toggle — opens empty (for browsing); the sidebar field
  // is what seeds a query via openWith.
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
        const next = [q, ...prev.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_SEARCHES)
        lsSet(searchesKey, next)
        return next
      })
    },
    [searchesKey],
  )

  const pushRecentOpened = useCallback(
    (item: WsRecentOpened) => {
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
      workspaceId,
      role,
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
      workspaceId,
      role,
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
      {/* Mounted only while open, so each open starts from a clean slate. */}
      {open && <WorkspaceCommandPalette />}
    </Ctx.Provider>
  )
}

export function useWorkspaceCommandPalette(): ContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useWorkspaceCommandPalette must be used inside <WorkspaceCommandPaletteProvider>')
  return ctx
}

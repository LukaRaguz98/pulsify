'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Smile, Sticker, Volume2, Upload, Download, Trash2, Search, LayoutGrid, List as ListIcon,
  Loader2, AlertCircle, ShieldAlert, Pencil, X, Package, CheckCircle2, Sparkles, Settings2,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CategorySection } from '@/components/ui/category-section'
import { Pagination } from '@/components/ui/pagination'
import {
  computeAssetStats, matchesQuery, usagePct,
  EMOJI_FILTERS, STICKER_FILTERS,
  type AssetsPayload, type SortKey, type EmojiFilter, type StickerFilter,
} from '@/lib/assets'
import { sanitizeExpressionName, type AssetLimits } from '@/lib/discord'
import { AssetTile } from './AssetTile'
import { AssetPreviewModal } from './AssetPreviewModal'
import { ImportPanel } from './ImportPanel'
import { emojiToItem, stickerToItem, soundToItem, exportRefFor, type AssetItem } from './types'
import type { AssetKind } from '@/lib/assets'

type Props = { guildId: string }
type Toast = { kind: 'ok' | 'err'; text: string }
type Dialog =
  | { type: 'rename'; item: AssetItem }
  | { type: 'delete'; item: AssetItem }
  | { type: 'bulkDelete' }
  | { type: 'bulkRename' }
  | null

const TRANSIENT_ERROR_HINT = "Couldn't verify your Discord access"
const MAX_TRANSIENT_RETRIES = 15

const TABS: { kind: AssetKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'emoji', label: 'Emojis', icon: <Smile size={15} /> },
  { kind: 'sticker', label: 'Stickers', icon: <Sticker size={15} /> },
  { kind: 'sound', label: 'Soundboard', icon: <Volume2 size={15} /> },
]

// Plural endpoint segment + singular display noun for a kind.
const ENDPOINT: Record<AssetKind, string> = { emoji: 'emojis', sticker: 'stickers', sound: 'soundboard' }
const NOUN: Record<AssetKind, string> = { emoji: 'emoji', sticker: 'sticker', sound: 'sound' }

async function downloadResponse(res: Response, fallback: string) {
  const blob = await res.blob()
  const cd = res.headers.get('content-disposition') ?? ''
  const m = /filename="([^"]+)"/.exec(cd)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = m?.[1] ?? fallback
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function StatCard({ label, value, sub, used, cap }: { label: string; value: string; sub?: string; used?: number; cap?: number }) {
  const pct = used != null && cap != null ? usagePct(used, cap) : null
  const near = pct != null && pct >= 80
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs" style={{ color: 'var(--text-3)' }}>{sub}</p>}
      {pct != null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-2)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: near ? '#f59e0b' : 'var(--p-1)' }} />
        </div>
      )}
    </div>
  )
}

export function AssetsContent({ guildId }: Props) {
  const [payload, setPayload] = useState<AssetsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [tab, setTab] = useState<AssetKind>('emoji')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [query, setQuery] = useState('')
  const [emojiFilter, setEmojiFilter] = useState<EmojiFilter>('all')
  const [stickerFilter, setStickerFilter] = useState<StickerFilter>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Grid fits ~4 rows before paging; default page size keeps the list compact.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(24)

  const [preview, setPreview] = useState<AssetItem | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Loop rather than self-recursion so the retry path doesn't reference
  // `fetchAll` before it's declared. Transient Discord blips keep the spinner
  // up and retry silently with linear backoff.
  const fetchAll = useCallback(async (): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`/api/discord/guild/${guildId}/assets`, { cache: 'no-store' })
      if (res.ok) {
        setPayload((await res.json()) as AssetsPayload)
        setError(null)
        setLoading(false)
        return
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (data.error?.includes(TRANSIENT_ERROR_HINT) && attempt < MAX_TRANSIENT_RETRIES) {
        const delay = Math.min(2000, 600 + attempt * 200)
        await new Promise<void>((resolve) => { retryTimer.current = setTimeout(resolve, delay) })
        continue
      }
      setError(data.error ?? 'Could not load server assets.')
      setLoading(false)
      return
    }
  }, [guildId])

  useEffect(() => {
    fetchAll()
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current) }
  }, [fetchAll])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Selection + search are tab-scoped, so reset them on a tab switch.
  function changeTab(kind: AssetKind) {
    setTab(kind)
    setSelected(new Set())
    setQuery('')
    setPage(1)
  }

  const stats = useMemo(() => (payload ? computeAssetStats(payload) : null), [payload])

  // Normalise the active tab's assets to the shared shape, then filter + sort.
  const allItems = useMemo<AssetItem[]>(() => {
    if (!payload) return []
    if (tab === 'emoji') return payload.emojis.map(emojiToItem)
    if (tab === 'sticker') return payload.stickers.map(stickerToItem)
    return payload.sounds.map(soundToItem)
  }, [payload, tab])

  const items = useMemo(() => {
    let list = allItems.filter((i) => matchesQuery(i.name, query))
    if (tab === 'emoji' && emojiFilter !== 'all') {
      list = list.filter((i) => (emojiFilter === 'animated' ? i.animated : !i.animated))
    }
    if (tab === 'sticker' && stickerFilter !== 'all') {
      const fmt = { png: 1, apng: 2, gif: 4, lottie: 3 }[stickerFilter]
      list = list.filter((i) => i.format === fmt)
    }
    const sorted = [...list]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'newest') sorted.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    else sorted.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    return sorted
  }, [allItems, query, tab, emojiFilter, stickerFilter, sort])

  // Clamp the page in case the active list shrank (filter, delete) below it,
  // then slice out just the current page's items.
  const safePage = Math.min(page, Math.max(1, Math.ceil(items.length / pageSize)))
  const pagedItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  )

  const selectedItems = useMemo(() => allItems.filter((i) => selected.has(i.id)), [allItems, selected])
  const existingNames = useMemo(() => new Set(allItems.map((i) => i.name.toLowerCase())), [allItems])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selected.size === items.length) setSelected(new Set())
    else setSelected(new Set(items.map((i) => i.id)))
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  async function renameAsset(item: AssetItem, name: string) {
    setActing(true)
    setActionError(null)
    const res = await fetch(`/api/discord/guild/${guildId}/assets/${ENDPOINT[item.kind]}/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setActing(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setActionError(data.error ?? 'Rename failed.')
      return
    }
    setDialog(null)
    setPreview(null)
    setToast({ kind: 'ok', text: `Renamed to ${name}.` })
    await fetchAll()
  }

  async function deleteAsset(item: AssetItem) {
    setActing(true)
    setActionError(null)
    const res = await fetch(`/api/discord/guild/${guildId}/assets/${ENDPOINT[item.kind]}/${item.id}`, { method: 'DELETE' })
    setActing(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setActionError(data.error ?? 'Delete failed.')
      return
    }
    setDialog(null)
    setPreview(null)
    setToast({ kind: 'ok', text: `Deleted ${item.name}.` })
    await fetchAll()
  }

  async function duplicateEmoji(item: AssetItem) {
    setActing(true)
    const res = await fetch(`/api/discord/guild/${guildId}/assets/emojis/${item.id}/duplicate`, { method: 'POST' })
    setActing(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Duplicate failed.' })
      return
    }
    setPreview(null)
    setToast({ kind: 'ok', text: `Duplicated ${item.name}.` })
    await fetchAll()
  }

  async function exportItems(refs: AssetItem[], packageName?: string, fallback = 'asset') {
    if (refs.length === 0) return
    setToast({ kind: 'ok', text: `Preparing ${refs.length} asset${refs.length === 1 ? '' : 's'}…` })
    const res = await fetch(`/api/discord/guild/${guildId}/assets/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: refs.map(exportRefFor), packageName }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Export failed.' })
      return
    }
    await downloadResponse(res, fallback)
  }

  async function bulkDelete() {
    setActing(true)
    let failures = 0
    for (const item of selectedItems) {
      const res = await fetch(`/api/discord/guild/${guildId}/assets/${ENDPOINT[item.kind]}/${item.id}`, { method: 'DELETE' })
      if (!res.ok) failures++
    }
    setActing(false)
    setDialog(null)
    setSelected(new Set())
    setToast(failures
      ? { kind: 'err', text: `${failures} of ${selectedItems.length} could not be deleted.` }
      : { kind: 'ok', text: `Deleted ${selectedItems.length} ${NOUN[tab]}s.` })
    await fetchAll()
  }

  async function bulkRename(base: string) {
    setActing(true)
    setActionError(null)
    const clean = tab === 'sticker' ? base.trim().slice(0, 28) : sanitizeExpressionName(base)
    let i = 1
    let failures = 0
    for (const item of selectedItems) {
      const name = tab === 'sticker' ? `${clean} ${i}`.slice(0, 30) : `${clean}_${i}`.slice(0, 32)
      const res = await fetch(`/api/discord/guild/${guildId}/assets/${ENDPOINT[item.kind]}/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) failures++
      i++
    }
    setActing(false)
    setDialog(null)
    setSelected(new Set())
    setToast(failures
      ? { kind: 'err', text: `${failures} of ${selectedItems.length} could not be renamed.` }
      : { kind: 'ok', text: `Renamed ${selectedItems.length} ${NOUN[tab]}s.` })
    await fetchAll()
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={22} className="animate-spin" style={{ color: 'var(--p-1)' }} />
      </div>
    )
  }

  if (error || !payload || !stats) {
    return (
      <div className="page-content">
        <PageHeader title="Assets" helpId="assets" />
        <EmptyState icon={<AlertCircle size={24} />} title="Couldn't load assets" description={error ?? 'Please try again.'} variant="muted" />
      </div>
    )
  }

  const limits: AssetLimits = payload.limits
  const noPermission = payload.permissions != null && !payload.permissions.manage
  const allCount = payload.emojis.length + payload.stickers.length + payload.sounds.length
  const freeForTab = tab === 'emoji' ? stats.freeEmojiStatic + stats.freeEmojiAnimated : tab === 'sticker' ? stats.freeStickers : stats.freeSounds

  const filters = tab === 'emoji'
    ? EMOJI_FILTERS.map((f) => ({ value: f, label: f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1) }))
    : tab === 'sticker'
      ? STICKER_FILTERS.map((f) => ({ value: f, label: f === 'all' ? 'All' : f.toUpperCase() }))
      : []
  const activeFilter = tab === 'emoji' ? emojiFilter : stickerFilter

  return (
    <div className="page-content">
      <PageHeader
        title="Assets"
        helpId="assets"
        description="Manage your server's emojis, stickers and soundboard sounds — upload, rename, export and clean up in bulk."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => exportItems([...payload.emojis.map(emojiToItem), ...payload.stickers.map(stickerToItem), ...payload.sounds.map(soundToItem)], 'pulsify-assets', 'pulsify-assets.zip')}
              disabled={allCount === 0}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)' }}
            >
              <Package size={15} /> Export all
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition"
              style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}
            >
              <Upload size={15} /> Import
            </button>
          </div>
        }
      />

      {noPermission && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>Pulse is missing the <strong>Manage Expressions</strong> permission. You can browse and export assets, but uploads, renames and deletes will fail until it&apos;s granted.</span>
        </div>
      )}

      <div className="space-y-8">
        <CategorySection icon={<Sparkles size={14} />} title="At a glance" description="Your emojis, stickers and sounds, with slot usage by boost tier.">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Emojis" value={String(stats.totalEmojis)} sub={`${stats.staticEmojis} static · ${stats.animatedEmojis} animated`} used={stats.staticEmojis} cap={limits.emojiStatic} />
            <StatCard label="Animated" value={String(stats.animatedEmojis)} sub={`${stats.freeEmojiAnimated} of ${limits.emojiAnimated} free`} used={stats.animatedEmojis} cap={limits.emojiAnimated} />
            <StatCard label="Stickers" value={`${stats.totalStickers} / ${limits.stickers}`} sub={`${stats.freeStickers} free`} used={stats.totalStickers} cap={limits.stickers} />
            <StatCard label="Soundboard" value={`${stats.totalSounds} / ${limits.soundboard}`} sub={`${stats.freeSounds} free`} used={stats.totalSounds} cap={limits.soundboard} />
          </div>
        </CategorySection>

        <CategorySection icon={<Settings2 size={14} />} title="Manage" description="Browse, import, export and organise your server assets.">
          {/* Category tabs */}
          <div className="inline-flex flex-wrap gap-1 rounded-xl border p-1" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            {TABS.map((t) => {
              const count = t.kind === 'emoji' ? payload.emojis.length : t.kind === 'sticker' ? payload.stickers.length : payload.sounds.length
              const active = tab === t.kind
              return (
                <button
                  key={t.kind}
                  type="button"
                  onClick={() => changeTab(t.kind)}
                  className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
                  style={active ? { background: 'var(--p-soft)', color: 'var(--text)' } : { color: 'var(--text-2)' }}
                >
                  <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{t.icon}</span>
                  {t.label}
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>{count}</span>
                </button>
              )
            })}
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1) }}
                placeholder={`Search ${TABS.find((t) => t.kind === tab)?.label.toLowerCase()}…`}
                className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </div>

            {filters.length > 0 && (
              <select
                value={activeFilter}
                onChange={(e) => { if (tab === 'emoji') setEmojiFilter(e.target.value as EmojiFilter); else setStickerFilter(e.target.value as StickerFilter); setPage(1) }}
                className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
                style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              >
                {filters.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            )}

            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value as SortKey); setPage(1) }}
              className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
            >
              <option value="name">Name</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>

            {items.length > 0 && (
              <button
                type="button"
                onClick={selectAll}
                className="rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
                style={{ borderColor: 'var(--line-strong)' }}
              >
                {selected.size === items.length ? 'Clear' : 'Select all'}
              </button>
            )}

            <div className="flex overflow-hidden rounded-lg border" style={{ borderColor: 'var(--line-strong)' }}>
              {(['grid', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-label={`${v} view`}
                  className="flex h-9 w-9 items-center justify-center transition-colors"
                  style={{ background: view === v ? 'var(--p-soft)' : 'var(--panel)', color: view === v ? 'var(--p-1)' : 'var(--text-3)' }}
                >
                  {v === 'grid' ? <LayoutGrid size={15} /> : <ListIcon size={15} />}
                </button>
              ))}
            </div>
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2.5" style={{ borderColor: 'var(--p-1)', background: 'var(--p-soft)' }}>
              <span className="text-sm font-medium text-foreground">{selected.size} selected</span>
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                <button type="button" onClick={() => exportItems(selectedItems, `pulsify-${NOUN[tab]}s`, `pulsify-${NOUN[tab]}s.zip`)} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                  <Download size={13} /> Export
                </button>
                <button type="button" onClick={() => { setActionError(null); setDialog({ type: 'bulkRename' }) }} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
                  <Pencil size={13} /> Rename
                </button>
                <button type="button" onClick={() => { setActionError(null); setDialog({ type: 'bulkDelete' }) }} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                  <Trash2 size={13} /> Delete
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground" aria-label="Clear selection">
                  <X size={13} />
                </button>
              </div>
            </div>
          )}

          {/* Grid / list */}
          {items.length === 0 ? (
            <EmptyState
              icon={tab === 'emoji' ? <Smile size={24} /> : tab === 'sticker' ? <Sticker size={24} /> : <Volume2 size={24} />}
              title={query || activeFilter !== 'all' ? 'No matches' : `No ${TABS.find((t) => t.kind === tab)?.label.toLowerCase()} yet`}
              description={query || activeFilter !== 'all' ? 'Try a different search or filter.' : `Import your first ${NOUN[tab]} to get started — Pulse uploads it straight to Discord.`}
              variant={query || activeFilter !== 'all' ? 'muted' : 'accent'}
              action={!query && activeFilter === 'all' ? (
                <button type="button" onClick={() => setImportOpen(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
                  <Upload size={15} /> Import {NOUN[tab]}s
                </button>
              ) : undefined}
            />
          ) : (
            <div className="space-y-4">
              {view === 'grid' ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {pagedItems.map((item) => (
                    <AssetTile key={item.id} item={item} view="grid" selected={selected.has(item.id)} onToggleSelect={toggleSelect} onOpen={setPreview} />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {pagedItems.map((item) => (
                    <AssetTile key={item.id} item={item} view="list" selected={selected.has(item.id)} onToggleSelect={toggleSelect} onOpen={setPreview} />
                  ))}
                </div>
              )}

              {items.length > pageSize && (
                <Pagination
                  page={safePage}
                  pageSize={pageSize}
                  total={items.length}
                  pageSizeOptions={[12, 24, 48, 96]}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
                  className="rounded-xl border"
                />
              )}
            </div>
          )}
        </CategorySection>
      </div>

      {/* Preview modal */}
      {preview && (
        <AssetPreviewModal
          item={preview}
          busy={acting}
          onClose={() => setPreview(null)}
          onRename={(item) => { setActionError(null); setDialog({ type: 'rename', item }) }}
          onDuplicate={duplicateEmoji}
          onExport={(item) => exportItems([item], undefined, item.name)}
          onDelete={(item) => { setActionError(null); setDialog({ type: 'delete', item }) }}
        />
      )}

      {/* Import */}
      {importOpen && (
        <ImportPanel
          kind={tab}
          guildId={guildId}
          existingNames={existingNames}
          freeSlots={freeForTab}
          onClose={() => setImportOpen(false)}
          onUploaded={() => { void fetchAll(); setToast({ kind: 'ok', text: 'Assets imported.' }) }}
        />
      )}

      {/* Dialogs */}
      {dialog?.type === 'rename' && (
        <ConfirmDialog
          title={`Rename ${dialog.item.name}`}
          confirmLabel="Save"
          busy={acting}
          error={actionError}
          fields={[{ key: 'name', kind: 'text', label: 'Name', required: true, defaultValue: dialog.item.name, maxLength: dialog.item.kind === 'sound' ? 32 : dialog.item.kind === 'sticker' ? 30 : 32 }]}
          onCancel={() => setDialog(null)}
          onConfirm={(v) => renameAsset(dialog.item, v.name.trim())}
        />
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title={`Delete ${dialog.item.name}?`}
          description={`This removes the ${NOUN[dialog.item.kind]} from Discord. This can't be undone.`}
          confirmLabel="Delete"
          tone="destructive"
          busy={acting}
          error={actionError}
          onCancel={() => setDialog(null)}
          onConfirm={() => deleteAsset(dialog.item)}
        />
      )}
      {dialog?.type === 'bulkDelete' && (
        <ConfirmDialog
          title={`Delete ${selected.size} ${NOUN[tab]}${selected.size === 1 ? '' : 's'}?`}
          description="These are removed from Discord and can't be recovered."
          confirmLabel={`Delete ${selected.size}`}
          tone="destructive"
          busy={acting}
          onCancel={() => setDialog(null)}
          onConfirm={bulkDelete}
        />
      )}
      {dialog?.type === 'bulkRename' && (
        <ConfirmDialog
          title={`Rename ${selected.size} ${NOUN[tab]}${selected.size === 1 ? '' : 's'}`}
          description={tab === 'sticker' ? 'Each selected sticker becomes "Base 1", "Base 2", …' : 'Each selected item becomes "base_1", "base_2", …'}
          confirmLabel="Rename"
          busy={acting}
          error={actionError}
          fields={[{ key: 'base', kind: 'text', label: 'Base name', required: true, placeholder: tab === 'sticker' ? 'My sticker' : 'my_emoji' }]}
          onCancel={() => setDialog(null)}
          onConfirm={(v) => bulkRename(v.base.trim())}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-xl" style={{ background: 'var(--panel)', borderColor: toast.kind === 'ok' ? 'var(--p-1)' : 'rgba(239,68,68,0.5)', color: 'var(--text)' }}>
          {toast.kind === 'ok' ? <CheckCircle2 size={14} style={{ color: 'var(--p-1)' }} /> : <AlertCircle size={14} style={{ color: '#f87171' }} />}
          {toast.text}
        </div>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, Search, AlertCircle, CheckCircle2, TrendingUp, BarChart3, RefreshCw,
  GripVertical, Pencil, Copy, Trash2, Volume2, Hash, Clock, AlertTriangle, Activity, Lock,
} from 'lucide-react'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  STAT_TYPES, statMeta, normaliseStatChannel, renderStatName, formatStatValue,
  type StatChannel, type StatType,
} from '@/lib/statistics-channels'
import type { StatValues } from '@/lib/statistics-values'
import { StatChannelEditor } from './StatChannelEditor'

type Toast = { kind: 'ok' | 'err'; text: string }
type Filter = 'all' | 'active' | 'disabled'
type CategoryOption = { id: string; name: string }

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'disabled', label: 'Disabled' },
]

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0 || Number.isNaN(diff)) return 'just now'
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function StatisticsChannelsContent({ guildId }: { guildId: string; guildName?: string }) {
  const [channels, setChannels] = useState<StatChannel[]>([])
  const [values, setValues] = useState<StatValues>({})
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const [editor, setEditor] = useState<{ channel: StatChannel | null } | null>(null)
  const [confirm, setConfirm] = useState<{ ids: string[]; busy?: boolean; error?: string | null; label: string } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    const [statsRes, chansRes] = await Promise.all([
      fetch(`/api/discord/guild/${guildId}/statistics-channels`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/channels`, { cache: 'no-store' }),
    ])
    if (!statsRes.ok) {
      const data = (await statsRes.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Could not load statistic channels.')
      setLoading(false)
      setRefreshing(false)
      return
    }
    const data = (await statsRes.json()) as { channels: Record<string, unknown>[]; values: StatValues }
    setChannels(data.channels.map(normaliseStatChannel))
    setValues(data.values ?? {})
    if (chansRes.ok) {
      const all = (await chansRes.json()) as { id: string; name: string; type: number }[]
      setCategories(all.filter((c) => c.type === 4).map((c) => ({ id: c.id, name: c.name })))
    }
    setError(null)
    setLoading(false)
    setRefreshing(false)
  }, [guildId])

  useEffect(() => { fetchAll(true) }, [fetchAll])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const overview = useMemo(() => {
    const active = channels.filter((c) => c.enabled).length
    const disabled = channels.length - active
    const lastSync = channels.reduce<string | null>((acc, c) => {
      if (!c.last_synced_at) return acc
      return !acc || c.last_synced_at > acc ? c.last_synced_at : acc
    }, null)
    return { active, disabled, total: channels.length, lastSync }
  }, [channels])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return channels
      .filter((c) => (filter === 'all' ? true : filter === 'active' ? c.enabled : !c.enabled))
      .filter((c) => {
        if (!q) return true
        const label = statMeta(c.stat_type)?.label.toLowerCase() ?? ''
        return label.includes(q) || c.name_template.toLowerCase().includes(q)
      })
  }, [channels, filter, query])

  const existingStatTypes = useMemo<StatType[]>(() => channels.map((c) => c.stat_type), [channels])

  function upsert(row: StatChannel, isNew: boolean) {
    setChannels((prev) => (isNew ? [...prev, row] : prev.map((c) => (c.id === row.id ? row : c))))
  }

  function onSaved(raw: StatChannel, isNew: boolean) {
    upsert(normaliseStatChannel(raw as unknown as Record<string, unknown>), isNew)
    setToast({ kind: 'ok', text: isNew ? 'Statistic channel created — Pulse is provisioning it.' : 'Statistic channel saved.' })
    setEditor(null)
    // The bot provisions/renames within a second or two via realtime — pull the
    // fresh channel id + first value in shortly so the card reflects it.
    setTimeout(() => fetchAll(true), 5000)
  }

  async function toggleEnabled(row: StatChannel) {
    const next = !row.enabled
    upsert({ ...row, enabled: next }, false)
    const res = await fetch(`/api/discord/guild/${guildId}/statistics-channels/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
    if (!res.ok) {
      upsert(row, false)
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Could not update the channel.' })
    }
  }

  async function bulk(action: 'enable' | 'disable' | 'delete' | 'duplicate' | 'sync', ids: string[]) {
    setBulkBusy(true)
    const res = await fetch(`/api/discord/guild/${guildId}/statistics-channels/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ids }),
    })
    setBulkBusy(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setToast({ kind: 'err', text: data.error ?? 'Bulk action failed.' })
      return false
    }
    if (action === 'duplicate') {
      const data = (await res.json()) as { channels: Record<string, unknown>[] }
      const created = (data.channels ?? []).map(normaliseStatChannel)
      setChannels((prev) => [...prev, ...created])
      setToast({ kind: 'ok', text: `Duplicated ${created.length} channel${created.length === 1 ? '' : 's'} (disabled).` })
    } else if (action === 'delete') {
      setChannels((prev) => prev.filter((c) => !ids.includes(c.id)))
      setToast({ kind: 'ok', text: `Deleted ${ids.length} channel${ids.length === 1 ? '' : 's'}.` })
    } else if (action === 'enable' || action === 'disable') {
      setChannels((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, enabled: action === 'enable' } : c)))
      setToast({ kind: 'ok', text: `${action === 'enable' ? 'Enabled' : 'Disabled'} ${ids.length} channel${ids.length === 1 ? '' : 's'}.` })
    } else if (action === 'sync') {
      setToast({ kind: 'ok', text: 'Sync requested — Pulse will refresh shortly.' })
      setTimeout(() => fetchAll(true), 6000)
    }
    setSelected(new Set())
    return true
  }

  async function doDelete() {
    if (!confirm) return
    setConfirm({ ...confirm, busy: true, error: null })
    // Single vs. bulk both funnel here.
    if (confirm.ids.length === 1) {
      const res = await fetch(`/api/discord/guild/${guildId}/statistics-channels/${confirm.ids[0]}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setConfirm({ ...confirm, busy: false, error: data.error ?? 'Could not delete the channel.' })
        return
      }
      setChannels((prev) => prev.filter((c) => c.id !== confirm.ids[0]))
      setToast({ kind: 'ok', text: 'Statistic channel deleted.' })
    } else {
      const ok = await bulk('delete', confirm.ids)
      if (!ok) { setConfirm({ ...confirm, busy: false, error: 'Could not delete the channels.' }); return }
    }
    setConfirm(null)
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = filtered.map((c) => c.id)
    const from = ids.indexOf(active.id as string)
    const to = ids.indexOf(over.id as string)
    if (from === -1 || to === -1) return
    const newOrderIds = arrayMove(ids, from, to)
    // Reflect immediately, then persist the full ordering.
    const orderIndex = new Map(newOrderIds.map((id, i) => [id, i]))
    setChannels((prev) => [...prev].sort((a, b) => (orderIndex.get(a.id) ?? a.position) - (orderIndex.get(b.id) ?? b.position)))
    const res = await fetch(`/api/discord/guild/${guildId}/statistics-channels/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reorder', order: newOrderIds }),
    })
    if (!res.ok) setToast({ kind: 'err', text: 'Could not save the new order.' })
  }

  if (loading) return <TableSkeleton rows={5} columns={3} className="mt-6" />

  return (
    <div className="space-y-8">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
          <AlertCircle size={14} className="shrink-0" /> {error}
        </div>
      )}
      {toast && (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: toast.kind === 'ok' ? 'rgba(74,222,128,0.35)' : 'rgba(239,68,68,0.35)', background: toast.kind === 'ok' ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)', color: toast.kind === 'ok' ? '#4ade80' : '#f87171' }}>
          {toast.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {toast.text}
        </div>
      )}

      {/* At a glance */}
      <CategorySection icon={<TrendingUp size={14} />} title="At a glance" description="Live counter channels and when they last refreshed.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={<BarChart3 size={16} />} label="Active" value={String(overview.active)} accent="#22c55e" />
          <Stat icon={<Activity size={16} />} label="Disabled" value={String(overview.disabled)} accent="var(--text-3)" />
          <Stat icon={<Hash size={16} />} label="Total" value={String(overview.total)} accent="var(--p-1)" />
          <Stat icon={<Clock size={16} />} label="Last update" value={timeAgo(overview.lastSync)} accent="#3b82f6" />
        </div>
      </CategorySection>

      {/* Channels */}
      <CategorySection
        icon={<BarChart3 size={14} />}
        title="Statistic channels"
        description="Create channels whose names show live server stats. Drag to reorder; Pulse keeps the numbers in sync."
      >
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full sm:w-[340px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search statistic channels…" className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: 'var(--line-strong)' }}>
              {FILTERS.map((f) => (
                <button key={f.key} type="button" onClick={() => setFilter(f.key)} className="rounded-md px-2.5 py-1 text-xs font-medium transition" style={{ background: filter === f.key ? 'var(--p-soft)' : 'transparent', color: filter === f.key ? 'var(--p-1)' : 'var(--text-3)' }}>
                  {f.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => fetchAll()} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
            <button type="button" onClick={() => channels.length > 0 && bulk('sync', channels.map((c) => c.id))} disabled={bulkBusy || channels.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
              <Clock size={12} /> Sync now
            </button>
            <button type="button" onClick={() => setEditor({ channel: null })} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition" style={{ background: 'var(--p-1)' }}>
              <Plus size={14} /> New channel
            </button>
          </div>
        </div>

        {/* Bulk toolbar */}
        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--p-1)', background: 'var(--p-soft)' }}>
            <span className="font-medium" style={{ color: 'var(--text)' }}>{selected.size} selected</span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <BulkBtn onClick={() => bulk('enable', [...selected])} disabled={bulkBusy}>Enable</BulkBtn>
              <BulkBtn onClick={() => bulk('disable', [...selected])} disabled={bulkBusy}>Disable</BulkBtn>
              <BulkBtn onClick={() => bulk('duplicate', [...selected])} disabled={bulkBusy}>Duplicate</BulkBtn>
              <BulkBtn onClick={() => setConfirm({ ids: [...selected], label: `${selected.size} statistic channels` })} disabled={bulkBusy} danger>Delete</BulkBtn>
              <button type="button" onClick={() => setSelected(new Set())} className="rounded-md px-2 py-1 text-xs" style={{ color: 'var(--text-3)' }}>Clear</button>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={36} />}
            title={channels.length === 0 ? 'No statistic channels yet' : 'No channels match'}
            description={channels.length === 0 ? 'Create a channel whose name shows a live server stat — member counts, boosts, roles, messages and more.' : 'Try a different search or filter.'}
            action={channels.length === 0 ? <button type="button" onClick={() => setEditor({ channel: null })} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white" style={{ background: 'var(--p-1)' }}><Plus size={14} /> New channel</button> : undefined}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filtered.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {filtered.map((c) => (
                  <StatRow
                    key={c.id}
                    row={c}
                    value={values[c.stat_type] ?? c.last_value ?? undefined}
                    selected={selected.has(c.id)}
                    onSelect={() => toggleSelect(c.id)}
                    onToggle={() => toggleEnabled(c)}
                    onEdit={() => setEditor({ channel: c })}
                    onDuplicate={() => bulk('duplicate', [c.id])}
                    onDelete={() => setConfirm({ ids: [c.id], label: statMeta(c.stat_type)?.label ?? 'this channel' })}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CategorySection>

      {editor && (
        <StatChannelEditor
          guildId={guildId}
          channel={editor.channel}
          categories={categories}
          values={values}
          existingStatTypes={existingStatTypes}
          onClose={() => setEditor(null)}
          onSaved={onSaved}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title="Delete statistic channel?"
          description={`This removes ${confirm.label} and deletes the Discord channel Pulse created for it. This can't be undone.`}
          confirmLabel="Delete"
          tone="destructive"
          busy={confirm.busy}
          error={confirm.error ?? undefined}
          onConfirm={doDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────

function StatRow({
  row, value, selected, onSelect, onToggle, onEdit, onDuplicate, onDelete,
}: {
  row: StatChannel
  value: number | string | null | undefined
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id })
  const meta = statMeta(row.stat_type)
  const formatted = value === undefined ? '…' : formatStatValue(row.stat_type, value)
  const previewName = renderStatName(row.name_template, row.stat_type, formatted)

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: 'var(--panel)',
    borderColor: selected ? 'var(--p-1)' : 'var(--line-strong)',
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 rounded-xl border p-3">
      <button type="button" className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing" {...attributes} {...listeners} aria-label="Drag to reorder">
        <GripVertical size={15} />
      </button>
      <input type="checkbox" checked={selected} onChange={onSelect} className="h-3.5 w-3.5 accent-[var(--p-1)]" />

      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base" style={{ background: 'var(--bg-2)' }}>
        {meta?.emoji ?? '📊'}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{meta?.label ?? row.stat_type}</span>
          {!row.enabled && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>Disabled</span>}
          {row.update_mode === 'manual' && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}>Manual</span>}
          {row.visibility === 'admins' && <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}><Lock size={9} /> Admin only</span>}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
          {row.channel_type === 'category' ? <Hash size={12} /> : row.visibility === 'admins' ? <Lock size={12} /> : <Volume2 size={12} />}
          <span className="truncate" style={{ color: 'var(--text-2)' }}>{previewName}</span>
        </div>
        {row.last_error ? (
          <p className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: '#f59e0b' }}><AlertTriangle size={11} /> {row.last_error}</p>
        ) : (
          <p className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-3)' }}><Clock size={11} /> Updated {timeAgo(row.last_synced_at)}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={onToggle} title={row.enabled ? 'Disable' : 'Enable'} className="relative inline-flex h-5 w-9 items-center rounded-full transition" style={{ background: row.enabled ? 'var(--p-1)' : 'var(--line-strong)' }}>
          <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform" style={{ transform: row.enabled ? 'translateX(18px)' : 'translateX(3px)' }} />
        </button>
        <IconBtn title="Edit" onClick={onEdit}><Pencil size={14} /></IconBtn>
        <IconBtn title="Duplicate" onClick={onDuplicate}><Copy size={14} /></IconBtn>
        <IconBtn title="Delete" onClick={onDelete} danger><Trash2 size={14} /></IconBtn>
      </div>
    </div>
  )
}

function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} className="rounded-lg p-2 transition" style={{ color: 'var(--text-3)' }}
      onMouseEnter={(e) => { e.currentTarget.style.color = danger ? '#f87171' : 'var(--text)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)' }}>
      {children}
    </button>
  )
}

function BulkBtn({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: danger ? '#f87171' : 'var(--text-2)' }}>
      {children}
    </button>
  )
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
        <span style={{ color: accent }}>{icon}</span> {label}
      </div>
      <p className="mt-1.5 text-xl font-bold text-foreground">{value}</p>
    </div>
  )
}

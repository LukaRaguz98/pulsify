'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Loader2,
  Plus,
  AlertCircle,
  CheckCircle2,
  Hash,
  Volume2,
  Megaphone,
  Mic2,
  MessageSquare,
  Image as ImageIcon,
  Folder,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Lock,
  AlertTriangle,
  TrendingUp,
  Activity,
} from 'lucide-react'
import {
  CHANNEL_TYPES,
  snowflakeToDate,
  type DiscordChannel,
  type DiscordRole,
  type CreatableChannelType,
  type BotPermissions,
} from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { CategorySection } from '@/components/ui/category-section'
import { ChannelEditPanel } from './channels/ChannelEditPanel'

const TRANSIENT_ERROR_HINT = "Couldn't verify your Discord access"
const MAX_TRANSIENT_RETRIES = 15

type Toast = { kind: 'ok' | 'err'; text: string }
type TypeFilter = 'all' | 'text' | 'voice' | 'forum' | 'stage'

type Props = { guildId: string }

export function ChannelsContent({ guildId }: Props) {
  const [channels, setChannels] = useState<DiscordChannel[]>([])
  const [roles, setRoles] = useState<DiscordRole[]>([])
  const [botPerms, setBotPerms] = useState<BotPermissions | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [reordering, setReordering] = useState(false)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const [editing, setEditing] = useState<DiscordChannel | null>(null)
  const [createDraft, setCreateDraft] = useState<{ type: CreatableChannelType; parentId: string | null } | null>(null)

  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const fetchAll = useCallback(async (attempt = 0, silent = false): Promise<void> => {
    if (!silent) setRefreshing(true)
    const [chRes, rolesRes, botRes] = await Promise.all([
      fetch(`/api/discord/guild/${guildId}/channels`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/roles`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/bot-permissions`, { cache: 'no-store' }),
    ])

    if (!chRes.ok) {
      const data = (await chRes.json().catch(() => ({}))) as { error?: string }
      if (data.error?.includes(TRANSIENT_ERROR_HINT) && attempt < MAX_TRANSIENT_RETRIES) {
        const delay = Math.min(2000, 600 + attempt * 200)
        retryRef.current = setTimeout(() => fetchAll(attempt + 1, silent), delay)
        return
      }
      setError(data.error ?? 'Could not load channels.')
      setLoading(false)
      setRefreshing(false)
      return
    }

    setChannels((await chRes.json()) as DiscordChannel[])
    if (rolesRes.ok) setRoles((await rolesRes.json()) as DiscordRole[])
    if (botRes.ok) setBotPerms(await botRes.json())

    setError(null)
    setLoading(false)
    setRefreshing(false)
  }, [guildId])

  useEffect(() => {
    fetchAll()
    return () => { if (retryRef.current) clearTimeout(retryRef.current) }
  }, [fetchAll])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Bot permission gate. We only block client-side; Discord enforces too.
  const canManage = botPerms === null
    || botPerms.administrator
    || botPerms.manageChannels

  // Tree: categories with their children + uncategorized roots.
  const tree = useMemo(() => buildTree(channels, search.trim().toLowerCase(), typeFilter), [channels, search, typeFilter])

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openCreate(type: CreatableChannelType, parentId: string | null = null) {
    setEditing(null)
    setCreateDraft({ type, parentId })
  }

  function closeEditor() {
    setEditing(null)
    setCreateDraft(null)
  }

  function handleSaved(saved: DiscordChannel, isNew: boolean) {
    setChannels((prev) =>
      isNew ? [...prev, saved] : prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)),
    )
    setToast({ kind: 'ok', text: isNew ? 'Channel created.' : 'Channel saved.' })
    closeEditor()
  }

  function handleDeleted(id: string) {
    setChannels((prev) => prev.filter((c) => c.id !== id))
    setToast({ kind: 'ok', text: 'Channel deleted.' })
    closeEditor()
  }

  function handleDuplicated(channel: DiscordChannel) {
    setChannels((prev) => [...prev, channel])
    setToast({ kind: 'ok', text: 'Channel duplicated.' })
    setEditing(channel)
    setCreateDraft(null)
  }

  // Reorder within a single sortable group: either categories themselves, or
  // children of one category. Computes new positions and PATCHes Discord.
  async function reorderGroup(groupKey: string, fromId: string, toId: string) {
    if (fromId === toId) return

    const group = groupKey === '__categories__'
      ? channels.filter((c) => c.type === CHANNEL_TYPES.CATEGORY).sort((a, b) => a.position - b.position)
      : channels.filter((c) => (c.parent_id ?? '__none__') === groupKey && c.type !== CHANNEL_TYPES.CATEGORY)
          .sort((a, b) => a.position - b.position)

    const fromIndex = group.findIndex((c) => c.id === fromId)
    const toIndex = group.findIndex((c) => c.id === toId)
    if (fromIndex === -1 || toIndex === -1) return

    const reordered = arrayMove(group, fromIndex, toIndex)
    // Re-assign positions monotonically (Discord requires unique-per-parent).
    const updates: { id: string; position: number }[] = []
    reordered.forEach((c, i) => {
      if (c.position !== i) updates.push({ id: c.id, position: i })
    })
    if (updates.length === 0) return

    const original = channels
    setChannels((prev) => {
      const m = new Map(updates.map((u) => [u.id, u.position]))
      return prev.map((c) => (m.has(c.id) ? { ...c, position: m.get(c.id)! } : c))
    })

    setReordering(true)
    const res = await fetch(`/api/discord/guild/${guildId}/channels`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
    setReordering(false)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Could not save new order.')
      setChannels(original)
      return
    }
    setToast({ kind: 'ok', text: 'Order saved.' })
  }

  if (loading) {
    return (
      <div className="page-content">
        <PageHeader title="Channels" helpId="channels" description="Manage Discord channels and categories from the dashboard." />
        <TableSkeleton rows={8} columns={3} className="mt-6" />
      </div>
    )
  }

  const stats = computeStats(channels)

  return (
    <div className="page-content">
      <PageHeader
        title="Channels"
        helpId="channels"
        description="Browse, organize, and configure every channel on this server."
        action={
          <button
            onClick={() => fetchAll()}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {!canManage && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Bot is missing Manage Channels.</p>
            <p className="mt-0.5 text-xs opacity-90">
              Channels are read-only until the Pulsify bot role gets the Manage Channels permission on this server.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
        >
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {toast && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: toast.kind === 'ok' ? 'rgba(74,222,128,0.35)' : 'rgba(239,68,68,0.35)',
            background: toast.kind === 'ok' ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)',
            color: toast.kind === 'ok' ? '#4ade80' : '#f87171',
          }}
        >
          {toast.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {toast.text}
        </div>
      )}

      <div className="space-y-8">
        <CategorySection icon={<TrendingUp size={14} />} title="At a glance" description="Snapshot of the server's channel structure.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat icon={<Folder size={16} />} label="Categories" value={stats.categories} accent="var(--p-1)" />
            <Stat icon={<Hash size={16} />} label="Text" value={stats.text} accent="#3b82f6" />
            <Stat icon={<Volume2 size={16} />} label="Voice" value={stats.voice} accent="#10b981" />
            <Stat icon={<MessageSquare size={16} />} label="Forum" value={stats.forum} accent="#f59e0b" />
            <Stat icon={<Activity size={16} />} label="Active 7d" value={stats.recentlyActive} accent="#a855f7" />
          </div>
        </CategorySection>

        <CategorySection
          icon={<Hash size={14} />}
          title="Server structure"
          description="Drag rows to reorder. Click any channel to edit name, topic, permissions, and more."
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search channels…"
                className="w-full rounded-lg border py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1"
                style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              />
            </div>
            {reordering && (
              <span className="inline-flex items-center gap-1.5 text-xs text-subtle">
                <Loader2 size={11} className="animate-spin" /> Saving order…
              </span>
            )}
            <div className="ml-auto inline-flex rounded-lg border p-1" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
              {(['all', 'text', 'voice', 'forum', 'stage'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setTypeFilter(f)}
                  className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition capitalize"
                  style={{
                    background: typeFilter === f ? 'var(--p-soft)' : 'transparent',
                    color: typeFilter === f ? 'var(--p-1)' : 'var(--text-3)',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
            <button
              onClick={() => openCreate(CHANNEL_TYPES.CATEGORY)}
              disabled={!canManage}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <Folder size={14} />
              New category
            </button>
            <button
              onClick={() => openCreate(CHANNEL_TYPES.TEXT)}
              disabled={!canManage}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50"
              style={{ background: 'var(--p-1)', color: '#fff' }}
            >
              <Plus size={14} />
              New channel
            </button>
          </div>

          {tree.categories.length === 0 && tree.uncategorized.length === 0 ? (
            <EmptyState
              icon={<Hash size={36} />}
              title="No channels match"
              description="Try clearing your search or filter, or create your first channel."
            />
          ) : (
            <div className="space-y-4">
              {/* Orphans — channels without a category. */}
              {tree.uncategorized.length > 0 && (
                <ChannelGroup
                  groupKey="__none__"
                  label="Uncategorized"
                  channels={tree.uncategorized}
                  sensors={sensors}
                  onReorder={reorderGroup}
                  onChannelClick={(c) => { setCreateDraft(null); setEditing(c) }}
                  canManage={canManage}
                />
              )}

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e: DragEndEvent) => {
                  if (!e.over || e.active.id === e.over.id) return
                  void reorderGroup('__categories__', String(e.active.id), String(e.over.id))
                }}
              >
                <SortableContext items={tree.categories.map((cat) => cat.id)} strategy={verticalListSortingStrategy}>
                  {tree.categories.map((cat) => (
                    <SortableCategory
                      key={cat.id}
                      category={cat.channel}
                      childrenChannels={cat.children}
                      collapsed={collapsed.has(cat.id)}
                      onToggle={() => toggleCollapsed(cat.id)}
                      onClickCategory={() => { setCreateDraft(null); setEditing(cat.channel) }}
                      onClickChannel={(c) => { setCreateDraft(null); setEditing(c) }}
                      onAddChannel={(type) => openCreate(type, cat.id)}
                      onReorder={reorderGroup}
                      sensors={sensors}
                      canManage={canManage}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}
        </CategorySection>
      </div>

      {(editing || createDraft) && (
        <ChannelEditPanel
          // Key on the panel forces a clean remount when the user clicks
          // between channels, so we can derive state from props in useState's
          // initializer instead of syncing via useEffect.
          key={editing?.id ?? `new-${createDraft?.type}-${createDraft?.parentId ?? 'root'}`}
          guildId={guildId}
          channel={editing}
          createDraft={createDraft}
          channels={channels}
          roles={roles}
          onClose={closeEditor}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onDuplicated={handleDuplicated}
        />
      )}
    </div>
  )
}

// ---------- Tree building & stats ----------

type TreeNode = { id: string; channel: DiscordChannel; children: DiscordChannel[] }
type Tree = { categories: TreeNode[]; uncategorized: DiscordChannel[] }

function buildTree(all: DiscordChannel[], search: string, typeFilter: TypeFilter): Tree {
  const typeMatches = (c: DiscordChannel): boolean => {
    if (typeFilter === 'all') return true
    if (typeFilter === 'text') return c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT
    if (typeFilter === 'voice') return c.type === CHANNEL_TYPES.VOICE
    if (typeFilter === 'forum') return c.type === CHANNEL_TYPES.FORUM || c.type === CHANNEL_TYPES.MEDIA
    if (typeFilter === 'stage') return c.type === CHANNEL_TYPES.STAGE
    return true
  }
  const nameMatches = (c: DiscordChannel): boolean => {
    if (!search) return true
    return c.name.toLowerCase().includes(search) || (c.topic ?? '').toLowerCase().includes(search)
  }

  const categories = all
    .filter((c) => c.type === CHANNEL_TYPES.CATEGORY)
    .sort((a, b) => a.position - b.position)

  const childrenOf = (parentId: string | null) =>
    all
      .filter((c) => (c.parent_id ?? null) === parentId && c.type !== CHANNEL_TYPES.CATEGORY)
      .sort((a, b) => a.position - b.position)

  // A category stays visible if it matches the filter itself OR has any
  // matching child. This keeps context when a search hit is buried.
  const visibleCategories: TreeNode[] = []
  for (const cat of categories) {
    const matchingChildren = childrenOf(cat.id).filter((c) => typeMatches(c) && nameMatches(c))
    const catItselfMatches = nameMatches(cat) && (typeFilter === 'all')
    if (matchingChildren.length > 0 || catItselfMatches) {
      visibleCategories.push({ id: cat.id, channel: cat, children: matchingChildren })
    }
  }

  const uncategorized = childrenOf(null).filter((c) => typeMatches(c) && nameMatches(c))
  return { categories: visibleCategories, uncategorized }
}

function computeStats(all: DiscordChannel[]) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  let recentlyActive = 0
  for (const c of all) {
    if (!c.last_message_id) continue
    const d = snowflakeToDate(c.last_message_id)
    if (d && d.getTime() >= cutoff) recentlyActive += 1
  }
  return {
    categories: all.filter((c) => c.type === CHANNEL_TYPES.CATEGORY).length,
    text: all.filter((c) => c.type === CHANNEL_TYPES.TEXT || c.type === CHANNEL_TYPES.ANNOUNCEMENT).length,
    voice: all.filter((c) => c.type === CHANNEL_TYPES.VOICE).length,
    forum: all.filter((c) => c.type === CHANNEL_TYPES.FORUM || c.type === CHANNEL_TYPES.MEDIA).length,
    stage: all.filter((c) => c.type === CHANNEL_TYPES.STAGE).length,
    recentlyActive,
  }
}

// ---------- Presentational helpers ----------

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold leading-none text-foreground">{value.toLocaleString()}</p>
        <p className="mt-1 text-xs text-subtle">{label}</p>
      </div>
    </div>
  )
}

export function channelTypeIcon(type: number, size = 13) {
  switch (type) {
    case CHANNEL_TYPES.TEXT: return <Hash size={size} />
    case CHANNEL_TYPES.VOICE: return <Volume2 size={size} />
    case CHANNEL_TYPES.ANNOUNCEMENT: return <Megaphone size={size} />
    case CHANNEL_TYPES.STAGE: return <Mic2 size={size} />
    case CHANNEL_TYPES.FORUM: return <MessageSquare size={size} />
    case CHANNEL_TYPES.MEDIA: return <ImageIcon size={size} />
    case CHANNEL_TYPES.CATEGORY: return <Folder size={size} />
    default: return <Hash size={size} />
  }
}

// ---------- Categories & rows ----------

function SortableCategory({
  category, childrenChannels, collapsed, onToggle, onClickCategory, onClickChannel,
  onAddChannel, onReorder, sensors, canManage,
}: {
  category: DiscordChannel
  childrenChannels: DiscordChannel[]
  collapsed: boolean
  onToggle: () => void
  onClickCategory: () => void
  onClickChannel: (c: DiscordChannel) => void
  onAddChannel: (type: CreatableChannelType) => void
  onReorder: (groupKey: string, fromId: string, toId: string) => void
  sensors: ReturnType<typeof useSensors>
  canManage: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="overflow-hidden rounded-xl border"
      // Borders/bg via inline so the design-system vars apply at runtime.
    >
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
      >
        <button
          {...attributes}
          {...listeners}
          className="flex h-5 w-5 cursor-grab items-center justify-center text-muted-foreground transition active:cursor-grabbing disabled:opacity-30"
          aria-label={`Drag ${category.name}`}
          disabled={!canManage}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={13} />
        </button>
        <button type="button" onClick={onToggle} className="flex h-5 w-5 items-center justify-center text-muted-foreground" aria-label="Toggle">
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <button
          type="button"
          onClick={onClickCategory}
          className="flex flex-1 items-center gap-2 truncate text-left text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--text-2)' }}
        >
          <Folder size={12} />
          <span className="truncate">{category.name}</span>
          <span className="text-[10px] font-normal lowercase text-subtle">
            ({childrenChannels.length} channel{childrenChannels.length === 1 ? '' : 's'})
          </span>
        </button>
        <div className="flex items-center gap-1">
          <CategoryAdd disabled={!canManage} onPick={onAddChannel} />
        </div>
      </div>

      {!collapsed && (
        <div className="divide-y" style={{ background: 'var(--panel)' }}>
          {childrenChannels.length === 0 ? (
            <p className="px-4 py-3 text-xs italic text-subtle">No channels in this category.</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e: DragEndEvent) => {
                if (!e.over || e.active.id === e.over.id) return
                onReorder(category.id, String(e.active.id), String(e.over.id))
              }}
            >
              <SortableContext items={childrenChannels.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {childrenChannels.map((c) => (
                  <SortableChannelRow
                    key={c.id}
                    channel={c}
                    onClick={() => onClickChannel(c)}
                    canManage={canManage}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}
    </div>
  )
}

function ChannelGroup({
  groupKey, label, channels, sensors, onReorder, onChannelClick, canManage,
}: {
  groupKey: string
  label: string
  channels: DiscordChannel[]
  sensors: ReturnType<typeof useSensors>
  onReorder: (groupKey: string, fromId: string, toId: string) => void
  onChannelClick: (c: DiscordChannel) => void
  canManage: boolean
}) {
  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line-strong)' }}>
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)' }}
      >
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-2)' }}>
          {label}
        </span>
      </div>
      <div className="divide-y" style={{ background: 'var(--panel)' }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e: DragEndEvent) => {
            if (!e.over || e.active.id === e.over.id) return
            onReorder(groupKey, String(e.active.id), String(e.over.id))
          }}
        >
          <SortableContext items={channels.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {channels.map((c) => (
              <SortableChannelRow key={c.id} channel={c} onClick={() => onChannelClick(c)} canManage={canManage} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}

function SortableChannelRow({
  channel, onClick, canManage,
}: {
  channel: DiscordChannel
  onClick: () => void
  canManage: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: channel.id,
    disabled: !canManage,
  })

  const lastActive = channel.last_message_id ? snowflakeToDate(channel.last_message_id) : null
  const isPrivate = (channel.permission_overwrites ?? []).some((ow) => {
    // Heuristic: @everyone with VIEW_CHANNEL denied → channel is private.
    // The everyone role id equals the guild id; we don't have guildId here,
    // so use the standard signal — overwrite with deny bit 1<<10 (0x400).
    try {
      return ow.type === 0 && (BigInt(ow.deny) & (1n << 10n)) !== 0n
    } catch { return false }
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="group flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-colors hover:bg-[var(--bg-2)]"
      onClick={onClick}
    >
      <button
        {...attributes}
        {...listeners}
        className="flex h-5 w-5 cursor-grab items-center justify-center text-muted-foreground opacity-0 transition group-hover:opacity-100 active:cursor-grabbing disabled:opacity-30"
        aria-label={`Drag ${channel.name}`}
        disabled={!canManage}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={13} />
      </button>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
        {channelTypeIcon(channel.type)}
      </span>
      <span className="min-w-0 truncate font-medium text-foreground">{channel.name}</span>
      {isPrivate && (
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-subtle" title="Private channel">
          <Lock size={9} />
          Private
        </span>
      )}
      {channel.nsfw && (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
          NSFW
        </span>
      )}
      {channel.topic && (
        <span className="ml-2 hidden truncate text-xs text-subtle sm:inline">— {channel.topic}</span>
      )}
      {lastActive && (
        <span className="ml-auto shrink-0 text-[10px] text-subtle" title={lastActive.toLocaleString()}>
          {formatRelative(lastActive)}
        </span>
      )}
    </div>
  )
}

function CategoryAdd({ disabled, onPick }: { disabled: boolean; onPick: (type: CreatableChannelType) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        disabled={disabled}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-[var(--panel)] hover:text-foreground disabled:opacity-30"
        title="Add channel to this category"
      >
        <Plus size={13} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-7 z-20 w-44 overflow-hidden rounded-lg border text-sm shadow-lg"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          {[
            { type: CHANNEL_TYPES.TEXT, label: 'Text channel', icon: <Hash size={12} /> },
            { type: CHANNEL_TYPES.VOICE, label: 'Voice channel', icon: <Volume2 size={12} /> },
            { type: CHANNEL_TYPES.ANNOUNCEMENT, label: 'Announcement', icon: <Megaphone size={12} /> },
            { type: CHANNEL_TYPES.STAGE, label: 'Stage', icon: <Mic2 size={12} /> },
            { type: CHANNEL_TYPES.FORUM, label: 'Forum', icon: <MessageSquare size={12} /> },
          ].map((opt) => (
            <button
              key={opt.type}
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onPick(opt.type as CreatableChannelType) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-[var(--bg-2)]"
            >
              <span className="text-muted-foreground">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  return d.toLocaleDateString()
}

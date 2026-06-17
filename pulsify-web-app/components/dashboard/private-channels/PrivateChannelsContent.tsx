'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Mic2, Search, Trash2, Pencil, Lock, Unlock, Settings, ListChecks, CircleSlash, Radio } from 'lucide-react'
import { createClient as createSupabase } from '@/lib/supabase'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PRIVATE_CHANNEL_LIMITS } from '@/lib/private-channels'
import { deletePrivateChannel, renamePrivateChannel } from '@/app/dashboard/[guildId]/(management)/private-channels/actions'

export type ActiveChannel = {
  id: string
  channel_id: string
  owner_id: string
  owner_name: string | null
  name: string | null
  channel_type: string
  locked: boolean
  user_limit: number
  created_at: string
  empty_since: string | null
}

type Filter = 'all' | 'locked' | 'unlocked' | 'in_use' | 'empty'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'in_use', label: 'In use' },
  { value: 'empty', label: 'Empty' },
  { value: 'locked', label: 'Locked' },
  { value: 'unlocked', label: 'Unlocked' },
]

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function PrivateChannelsContent({
  guildId,
  guildName,
  enabled,
  settingsHref,
  initialChannels,
}: {
  guildId: string
  guildName: string
  enabled: boolean
  settingsHref: string
  initialChannels: ActiveChannel[]
}) {
  const router = useRouter()
  const [channels, setChannels] = useState<ActiveChannel[]>(initialChannels)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [isPending, startTransition] = useTransition()
  const [refreshing, startRefresh] = useTransition()

  const [deleting, setDeleting] = useState<ActiveChannel | null>(null)
  const [renaming, setRenaming] = useState<ActiveChannel | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)

  // Live refresh: re-pull the guild's channels whenever the bot/dashboard
  // creates or deletes one. Debounced so a burst collapses into one fetch.
  const supabase = useMemo(() => createSupabase(), [])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from('private_channels')
      .select('id, channel_id, owner_id, owner_name, name, channel_type, locked, user_limit, created_at, empty_since')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(500)
    if (data) setChannels(data as ActiveChannel[])
  }, [supabase, guildId])

  useEffect(() => {
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void refetch(), 600)
    }
    const channel = supabase
      .channel(`private-channels:${guildId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'private_channels', filter: `guild_id=eq.${guildId}` },
        schedule,
      )
      .subscribe()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [supabase, guildId, refetch])

  const refresh = useCallback(() => {
    startRefresh(async () => {
      await refetch()
      router.refresh()
    })
  }, [refetch, router])

  const stats = useMemo(() => {
    let inUse = 0
    let empty = 0
    let locked = 0
    for (const c of channels) {
      if (c.empty_since) empty += 1
      else inUse += 1
      if (c.locked) locked += 1
    }
    return { total: channels.length, inUse, empty, locked }
  }, [channels])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return channels.filter((c) => {
      if (filter === 'locked' && !c.locked) return false
      if (filter === 'unlocked' && c.locked) return false
      if (filter === 'in_use' && c.empty_since) return false
      if (filter === 'empty' && !c.empty_since) return false
      if (!q) return true
      return (
        (c.name ?? '').toLowerCase().includes(q) ||
        (c.owner_name ?? '').toLowerCase().includes(q) ||
        c.owner_id.includes(q)
      )
    })
  }, [channels, search, filter])

  const pageItems = filtered.slice(page * pageSize, page * pageSize + pageSize)

  function doDelete() {
    if (!deleting) return
    setDialogError(null)
    startTransition(async () => {
      const res = await deletePrivateChannel(guildId, deleting.channel_id)
      if (res.ok) {
        setChannels((cs) => cs.filter((c) => c.channel_id !== deleting.channel_id))
        setDeleting(null)
      } else {
        setDialogError(res.error)
      }
    })
  }

  function doRename(values: Record<string, string>) {
    if (!renaming) return
    setDialogError(null)
    const name = values.name ?? ''
    startTransition(async () => {
      const res = await renamePrivateChannel(guildId, renaming.channel_id, name)
      if (res.ok) {
        setChannels((cs) => cs.map((c) => (c.channel_id === renaming.channel_id ? { ...c, name } : c)))
        setRenaming(null)
      } else {
        setDialogError(res.error)
      }
    })
  }

  const settingsLink = (
    <Link
      href={settingsHref}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
    >
      <Settings size={12} />
      Private channels settings
    </Link>
  )

  const header = (
    <PageHeader
      title="Private Channels"
      helpId="private-channels"
      description={
        <>
          Join-to-create temporary voice channels in{' '}
          <span className="font-medium text-foreground">{guildName || 'this server'}</span> — Pulse makes a
          category + trigger channel, and members spin up their own private channels by joining the trigger.
        </>
      }
      action={
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)', color: 'var(--text-2)' }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: enabled ? '#22c55e' : 'var(--text-3)' }} />
            {enabled ? 'Enabled' : 'Off'}
          </span>
          {settingsLink}
          <RefreshButton onClick={refresh} refreshing={refreshing} />
        </div>
      }
    />
  )

  // Not configured and nothing live → point the admin at Settings, the same way
  // other modules send you to their config surface before there's data.
  if (!enabled && channels.length === 0) {
    return (
      <div className="page-content">
        {header}
        <EmptyState
          icon={<Mic2 size={26} />}
          title="Private Channels is off"
          description="Turn it on in Private channels settings — Pulse will add a category and a join-to-create trigger, and member-created channels show up here."
          action={
            <Link
              href={settingsHref}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(180deg, var(--p-1), var(--p-2))', boxShadow: '0 4px 14px -4px var(--p-glow)' }}
            >
              <Settings size={15} /> Configure in settings
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="page-content">
      {header}

      <div className="space-y-8">
        {/* At a glance */}
        <CategorySection
          icon={<Mic2 size={14} />}
          title="At a glance"
          description="Live member-created channels across this server."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Mic2 size={16} />} label="Total" value={stats.total} color="#60a5fa" />
            <StatCard icon={<Radio size={16} />} label="In use" value={stats.inUse} color="#22c55e" />
            <StatCard icon={<CircleSlash size={16} />} label="Empty" value={stats.empty} color="#94a3b8" />
            <StatCard icon={<Lock size={16} />} label="Locked" value={stats.locked} color="#f59e0b" />
          </div>
        </CategorySection>

        {/* Manage */}
        <CategorySection
          icon={<ListChecks size={14} />}
          title="Active channels"
          description="Member-created channels appear here as they're opened. Force-rename or delete any of them."
        >
          {channels.length === 0 ? (
            <EmptyState
              icon={<Mic2 size={20} />}
              title="No private channels right now"
              description={`When members join the trigger channel in ${guildName || 'this server'}, their channels appear here.`}
              variant="muted"
            />
          ) : (
            <div className="space-y-4">
              {/* Controls */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative max-w-xs flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value)
                      setPage(0)
                    }}
                    placeholder="Search by channel or owner…"
                    className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--p-1)]"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-1)' }}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTERS.map((f) => {
                    const active = filter === f.value
                    return (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => {
                          setFilter(f.value)
                          setPage(0)
                        }}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium transition"
                        style={{
                          background: active ? 'var(--p-soft)' : 'var(--bg-2)',
                          borderColor: active ? 'var(--p-1)' : 'var(--line-strong)',
                          color: active ? 'var(--p-1)' : 'var(--text-2)',
                        }}
                      >
                        {f.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {filtered.length === 0 ? (
                <EmptyState
                  icon={<Search size={20} />}
                  title="Nothing matches your filters"
                  description="Try a different search or filter."
                  variant="muted"
                />
              ) : (
                <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line-strong)' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-subtle" style={{ background: 'var(--bg-2)' }}>
                        <th className="px-4 py-2.5 font-medium">Channel</th>
                        <th className="px-4 py-2.5 font-medium">Owner</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Created</th>
                        <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((c) => (
                        <tr key={c.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: 'var(--text-1)' }}>
                              <Mic2 size={13} className="text-subtle" />
                              {c.name || 'Private channel'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5" style={{ color: 'var(--text-2)' }}>
                            {c.owner_name || `<@${c.owner_id}>`}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-2 text-xs">
                              <span className="inline-flex items-center gap-1" style={{ color: c.locked ? '#f59e0b' : 'var(--text-3)' }}>
                                {c.locked ? <Lock size={12} /> : <Unlock size={12} />}
                                {c.locked ? 'Locked' : 'Unlocked'}
                              </span>
                              <span style={{ color: c.empty_since ? 'var(--text-3)' : '#22c55e' }}>
                                {c.empty_since ? 'Empty' : 'In use'}
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-3)' }}>
                            {formatWhen(c.created_at)}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setDialogError(null)
                                  setRenaming(c)
                                }}
                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition hover:bg-[var(--bg-2)]"
                                style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
                              >
                                <Pencil size={12} />
                                Rename
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDialogError(null)
                                  setDeleting(c)
                                }}
                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition hover:bg-[rgba(239,68,68,0.1)]"
                                style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
                              >
                                <Trash2 size={12} />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {filtered.length > pageSize && (
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={filtered.length}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => {
                    setPageSize(s)
                    setPage(0)
                  }}
                />
              )}
            </div>
          )}
        </CategorySection>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete private channel?"
          description={`This permanently deletes “${deleting.name || 'this channel'}” from Discord and disconnects anyone inside. This can't be undone.`}
          confirmLabel="Delete channel"
          tone="destructive"
          busy={isPending}
          error={dialogError}
          onCancel={() => setDeleting(null)}
          onConfirm={doDelete}
        />
      )}

      {renaming && (
        <ConfirmDialog
          title="Rename private channel"
          confirmLabel="Rename"
          busy={isPending}
          error={dialogError}
          fields={[
            {
              key: 'name',
              kind: 'text',
              label: 'New channel name',
              required: true,
              maxLength: PRIVATE_CHANNEL_LIMITS.nameMax,
              defaultValue: renaming.name ?? '',
            },
          ]}
          onCancel={() => setRenaming(null)}
          onConfirm={doRename}
        />
      )}
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
}) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}1f`, color }}>
          {icon}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className="font-mono text-3xl font-bold text-foreground">{value.toLocaleString()}</p>
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  Server, Plus, Search, Tag, Trash2, ExternalLink, Shield, Users, LifeBuoy,
  X, Check, Loader2, TrendingUp, Bot,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { guildIconUrl } from '@/lib/discord'
import { tagColor, type EnrichedServer } from '@/lib/workspace'
import { useWorkspace } from '@/components/workspace/WorkspaceProvider'
import { useRunAction, FeedbackBanner } from '@/components/workspace/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { addServers, removeServer, updateServerTags } from '@/app/workspace/[workspaceId]/servers/actions'
import type { PickableGuild } from '@/components/workspace/WorkspacePicker'

export function ServersContent({ servers, available }: { servers: EnrichedServer[]; available: PickableGuild[] }) {
  const { workspace, can } = useWorkspace()
  const router = useRouter()
  const { busy, feedback, setFeedback, run } = useRunAction()
  const canManage = can('manageServers')

  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editTags, setEditTags] = useState<EnrichedServer | null>(null)
  const [removing, setRemoving] = useState<EnrichedServer | null>(null)

  const allTags = useMemo(() => [...new Set(servers.flatMap((s) => s.tags))].sort(), [servers])

  const filtered = servers.filter((s) => {
    if (activeTag && !s.tags.includes(activeTag)) return false
    if (query && !s.name.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  const connectedCount = servers.filter((s) => s.memberCount != null).length
  const totalMembers = servers.reduce((acc, s) => acc + (s.memberCount ?? 0), 0)
  const taggedCount = servers.filter((s) => s.tags.length > 0).length

  const stats = [
    { label: 'Servers', value: servers.length, icon: <Server size={16} /> },
    { label: 'Connected to Pulse', value: connectedCount, icon: <Bot size={16} /> },
    { label: 'Total members', value: totalMembers.toLocaleString(), icon: <Users size={16} /> },
    { label: 'Tagged', value: taggedCount, icon: <Tag size={16} /> },
  ]

  return (
    <div className="page-content">
      <PageHeader
        title="Servers"
        helpId="workspace-servers"
        description="Manage every Discord server in this workspace from one place."
        action={canManage ? (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            <Plus size={15} /> Add server
          </button>
        ) : undefined}
      />

      <FeedbackBanner feedback={feedback} onClose={() => setFeedback(null)} />

      {servers.length === 0 ? (
        <EmptyState
          icon={<Server size={30} />}
          title="No servers yet"
          description={canManage ? 'Add the Discord servers you want to manage together.' : 'An admin hasn’t added any servers yet.'}
          action={canManage ? <button type="button" onClick={() => setAdding(true)} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>Add server</button> : undefined}
        />
      ) : (
        <div className="space-y-8">
          <CategorySection
            icon={<TrendingUp size={14} />}
            title="At a glance"
            description="Snapshot of the servers grouped into this workspace."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                  <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><span style={{ color: 'var(--p-1)' }}>{s.icon}</span>{s.label}</div>
                  <p className="mt-2 text-2xl font-bold text-foreground">{s.value}</p>
                </div>
              ))}
            </div>
          </CategorySection>

          <CategorySection
            icon={<Server size={14} />}
            title="Connected servers"
            description="Search, filter by tag, and jump into a server's dashboard from anywhere in the workspace."
          >
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search servers…" className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
            </div>
            {allTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => setActiveTag(null)} className="rounded-full border px-2.5 py-1 text-xs font-medium transition" style={{ borderColor: activeTag === null ? 'var(--p-1)' : 'var(--line-strong)', background: activeTag === null ? 'var(--p-soft)' : 'transparent', color: activeTag === null ? 'var(--p-1)' : 'var(--text-2)' }}>All</button>
                {allTags.map((t) => (
                  <button key={t} type="button" onClick={() => setActiveTag(activeTag === t ? null : t)} className="rounded-full border px-2.5 py-1 text-xs font-medium transition" style={{ borderColor: activeTag === t ? tagColor(t) : 'var(--line-strong)', background: activeTag === t ? `${tagColor(t)}22` : 'transparent', color: activeTag === t ? tagColor(t) : 'var(--text-2)' }}>{t}</button>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s) => {
              const icon = guildIconUrl(s.guild_id, s.icon, 64)
              return (
                <div key={s.guild_id} className="flex flex-col rounded-xl border p-4" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                  <div className="flex items-start gap-3">
                    {icon ? (
                      <Image src={icon} alt={s.name} width={40} height={40} className="h-10 w-10 rounded-xl" unoptimized />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>{s.name.charAt(0)}</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-foreground">{s.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>{s.memberCount != null ? `${s.memberCount.toLocaleString()} members` : 'Bot not connected'}</p>
                    </div>
                    {canManage && (
                      <button type="button" onClick={() => setRemoving(s)} aria-label="Remove server" className="rounded-md p-1 transition hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>

                  {/* Tags */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {s.tags.map((t) => (
                      <span key={t} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${tagColor(t)}22`, color: tagColor(t) }}>{t}</span>
                    ))}
                    {canManage && (
                      <button type="button" onClick={() => setEditTags(s)} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[10px] font-medium transition" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}>
                        <Tag size={10} /> {s.tags.length ? 'Edit' : 'Add tags'}
                      </button>
                    )}
                  </div>

                  {/* Cross-server quick actions */}
                  <div className="mt-4 grid grid-cols-2 gap-1.5 border-t pt-3" style={{ borderColor: 'var(--line-strong)' }}>
                    <QuickLink href={`/dashboard/${s.guild_id}`} icon={<ExternalLink size={13} />} label="Dashboard" />
                    <QuickLink href={`/dashboard/${s.guild_id}/moderation`} icon={<Shield size={13} />} label="Moderation" />
                    <QuickLink href={`/dashboard/${s.guild_id}/members`} icon={<Users size={13} />} label="Members" />
                    <QuickLink href={`/dashboard/${s.guild_id}/tickets`} icon={<LifeBuoy size={13} />} label="Tickets" />
                  </div>
                </div>
              )
            })}
          </div>
          {filtered.length === 0 && (
            <p className="py-12 text-center text-sm" style={{ color: 'var(--text-3)' }}>No servers match your filters.</p>
          )}
          </CategorySection>
        </div>
      )}

      {adding && (
        <AddServerModal
          available={available}
          busy={busy}
          onClose={() => setAdding(false)}
          onAdd={async (ids) => {
            const res = await run(() => addServers(workspace.id, ids), `Added ${ids.length} server${ids.length === 1 ? '' : 's'}.`)
            if (res.ok) { setAdding(false); router.refresh() }
          }}
        />
      )}

      {editTags && (
        <ConfirmDialog
          title={`Tags for ${editTags.name}`}
          description="Comma-separated labels used to group and filter servers."
          confirmLabel="Save tags"
          fields={[{ key: 'tags', kind: 'text', label: 'Tags', placeholder: 'Main, Partner, Staging', defaultValue: editTags.tags.join(', ') }]}
          busy={busy}
          error={feedback?.kind === 'error' ? feedback.text : null}
          onCancel={() => setEditTags(null)}
          onConfirm={async (vals) => {
            const tags = (vals.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean)
            const res = await run(() => updateServerTags(workspace.id, editTags.guild_id, tags), 'Tags updated.')
            if (res.ok) { setEditTags(null); router.refresh() }
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          description="This only removes the server from this workspace. Pulse stays in the Discord server and its data is untouched."
          confirmLabel="Remove server"
          tone="destructive"
          busy={busy}
          error={feedback?.kind === 'error' ? feedback.text : null}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const res = await run(() => removeServer(workspace.id, removing.guild_id), 'Server removed.')
            if (res.ok) { setRemoving(null); router.refresh() }
          }}
        />
      )}
    </div>
  )
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-2)' }}>
      <span style={{ color: 'var(--p-1)' }}>{icon}</span>{label}
    </Link>
  )
}

function AddServerModal({
  available, busy, onClose, onAdd,
}: {
  available: PickableGuild[]
  busy: boolean
  onClose: () => void
  onAdd: (ids: string[]) => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  if (typeof document === 'undefined') return null

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="font-semibold text-foreground">Add servers</h2>
          <button type="button" onClick={onClose} disabled={busy} className="rounded p-1 text-muted-foreground transition hover:text-foreground" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4">
          {available.length === 0 ? (
            <p className="py-6 text-center text-sm" style={{ color: 'var(--text-3)' }}>
              You don&apos;t manage any other servers, or they&apos;re all added already.
            </p>
          ) : (
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {available.map((g) => {
                const on = picked.has(g.id)
                const icon = guildIconUrl(g.id, g.icon, 48)
                return (
                  <button key={g.id} type="button" onClick={() => toggle(g.id)} className="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition" style={{ background: on ? 'var(--p-soft)' : 'var(--bg-2)', borderColor: on ? 'var(--p-1)' : 'var(--line-strong)' }}>
                    {icon ? <Image src={icon} alt={g.name} width={28} height={28} className="h-7 w-7 rounded-lg" unoptimized /> : <div className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>{g.name.charAt(0)}</div>}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{g.name}</span>
                    {!g.botInstalled && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>no bot</span>}
                    <span className="flex h-5 w-5 items-center justify-center rounded-md border" style={{ borderColor: on ? 'var(--p-1)' : 'var(--line-strong)', background: on ? 'var(--p-1)' : 'transparent' }}>{on && <Check size={12} className="text-white" />}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground" style={{ borderColor: 'var(--line-strong)' }}>Cancel</button>
          <button type="button" onClick={() => onAdd([...picked])} disabled={busy || picked.size === 0} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            {busy && <Loader2 size={14} className="animate-spin" />}{busy ? 'Adding…' : `Add ${picked.size || ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

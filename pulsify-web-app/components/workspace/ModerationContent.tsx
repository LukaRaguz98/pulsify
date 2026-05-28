'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, Shield, Plus, Trash2, X, Loader2, AlertOctagon, TrendingUp } from 'lucide-react'
import {
  WATCHLIST_KINDS, WATCHLIST_KIND_LABELS, SEVERITIES, SEVERITY_COLOR, timeAgo,
  type Severity, type WatchlistEntry, type WatchlistKind,
} from '@/lib/workspace'
import { useWorkspace } from '@/components/workspace/WorkspaceProvider'
import { useRealtimeRows } from '@/components/workspace/use-realtime'
import { useRunAction, FeedbackBanner } from '@/components/workspace/feedback'
import { PageHeader } from '@/components/ui/page-header'
import { CategorySection } from '@/components/ui/category-section'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { addWatchlistEntry, removeWatchlistEntry } from '@/app/workspace/[workspaceId]/moderation/actions'

export type ModLogRow = {
  id: string
  guild_id: string
  action: string
  target_user_id: string | null
  target_username: string | null
  moderator_username: string | null
  reason: string | null
  created_at: string
}

const KIND_COLOR: Record<WatchlistKind, string> = { watch: '#fbbf24', scam: '#fb923c', banned: '#f87171' }

export function ModerationContent({
  logs, initialWatchlist, serverNames, hasServers,
}: {
  logs: ModLogRow[]
  initialWatchlist: WatchlistEntry[]
  serverNames: Record<string, string>
  hasServers: boolean
}) {
  const { workspace, can } = useWorkspace()
  const { rows: watchlist } = useRealtimeRows<WatchlistEntry>('workspace_watchlist', workspace.id, initialWatchlist)
  const { busy, feedback, setFeedback, run } = useRunAction()
  const canManage = can('manageWatchlist')

  const [tab, setTab] = useState<'activity' | 'watchlist'>('watchlist')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<WatchlistEntry | null>(null)

  const watchCount = watchlist.filter((w) => w.kind === 'watch').length
  const scamCount = watchlist.filter((w) => w.kind === 'scam').length
  const bannedCount = watchlist.filter((w) => w.kind === 'banned').length

  const stats = [
    { label: 'Watchlist', value: watchlist.length, icon: <Eye size={16} /> },
    { label: 'Watching', value: watchCount, icon: <Eye size={16} /> },
    { label: 'Scammers', value: scamCount, icon: <AlertOctagon size={16} /> },
    { label: 'Banned', value: bannedCount, icon: <Shield size={16} /> },
  ]

  return (
    <div className="page-content">
      <PageHeader
        title="Moderation"
        description="A cross-server view of recent moderation and a shared watchlist of risky users."
        action={canManage && tab === 'watchlist' ? (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white transition" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            <Plus size={15} /> Add to watchlist
          </button>
        ) : undefined}
      />
      <FeedbackBanner feedback={feedback} onClose={() => setFeedback(null)} />

      <div className="space-y-8">
      <CategorySection
        icon={<TrendingUp size={14} />}
        title="At a glance"
        description="Snapshot of flagged users grouped by kind."
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
        icon={<Shield size={14} />}
        title="Moderation"
        description="Cross-server activity log and the shared watchlist of risky users."
      >
      <div className="flex gap-1.5">
        <TabButton active={tab === 'watchlist'} onClick={() => setTab('watchlist')} icon={<AlertOctagon size={14} />} label={`Watchlist · ${watchlist.length}`} />
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')} icon={<Shield size={14} />} label="Cross-server activity" />
      </div>

      {tab === 'watchlist' ? (
        watchlist.length === 0 ? (
          <EmptyState icon={<Eye size={30} />} title="Watchlist is empty" description={canManage ? 'Flag scammers, banned users, or members to keep an eye on across all servers.' : 'Flagged users will appear here.'} />
        ) : (
          <div className="space-y-5">
            {WATCHLIST_KINDS.map((kind) => {
              const items = watchlist.filter((w) => w.kind === kind)
              if (items.length === 0) return null
              return (
                <section key={kind}>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[kind] }} />{WATCHLIST_KIND_LABELS[kind]} <span className="font-normal" style={{ color: 'var(--text-3)' }}>· {items.length}</span>
                  </h3>
                  <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line-strong)' }}>
                    {items.map((w, i) => (
                      <div key={w.id} className="flex items-center gap-3 px-4 py-3" style={{ background: 'var(--panel)', borderTop: i ? '1px solid var(--line-strong)' : 'none' }}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[w.severity] }} title={w.severity} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{w.user_name ?? 'Unknown user'} <span className="font-normal" style={{ color: 'var(--text-3)' }}>· {w.user_id}</span></p>
                          {w.reason && <p className="truncate text-xs" style={{ color: 'var(--text-3)' }}>{w.reason}</p>}
                        </div>
                        <span className="hidden text-xs sm:block" style={{ color: 'var(--text-3)' }}>{w.added_by_name ?? 'staff'} · {timeAgo(w.created_at)}</span>
                        {canManage && <button type="button" onClick={() => setRemoving(w)} title="Remove" className="rounded-md p-1.5 transition hover:bg-[var(--bg-2)]" style={{ color: 'var(--text-3)' }}><Trash2 size={15} /></button>}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )
      ) : (
        !hasServers ? (
          <EmptyState icon={<Shield size={30} />} title="No servers connected" description="Add servers to this workspace to see their moderation activity here." />
        ) : logs.length === 0 ? (
          <EmptyState icon={<Shield size={30} />} title="No recent actions" description="Moderation actions taken in your servers will show up here." />
        ) : (
          <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line-strong)' }}>
            {logs.map((l, i) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-3" style={{ background: 'var(--panel)', borderTop: i ? '1px solid var(--line-strong)' : 'none' }}>
                <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize" style={{ background: 'var(--bg-2)', color: 'var(--p-1)' }}>{l.action.replace(/_/g, ' ')}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    <span className="font-medium">{l.target_username ?? l.target_user_id ?? 'a user'}</span>
                    {l.reason ? <span style={{ color: 'var(--text-3)' }}> — {l.reason}</span> : null}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>{serverNames[l.guild_id] ?? 'Server'} · by {l.moderator_username ?? 'system'} · {timeAgo(l.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )
      )}
      </CategorySection>
      </div>

      {adding && (
        <WatchlistModal
          busy={busy}
          error={feedback?.kind === 'error' ? feedback.text : null}
          onClose={() => setAdding(false)}
          onAdd={async (input) => { const res = await run(() => addWatchlistEntry(workspace.id, input), 'Added to watchlist.'); if (res.ok) setAdding(false) }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Remove from watchlist?"
          description={`${removing.user_name ?? removing.user_id} will no longer be flagged.`}
          confirmLabel="Remove"
          tone="destructive"
          busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => { const res = await run(() => removeWatchlistEntry(workspace.id, removing.id), 'Removed.'); if (res.ok) setRemoving(null) }}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition" style={active ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-2)' }}>
      {icon}{label}
    </button>
  )
}

function WatchlistModal({
  busy, error, onClose, onAdd,
}: {
  busy: boolean
  error: string | null
  onClose: () => void
  onAdd: (input: { userId: string; userName?: string; kind: string; severity?: string; reason?: string }) => void
}) {
  const [userId, setUserId] = useState('')
  const [userName, setUserName] = useState('')
  const [kind, setKind] = useState<WatchlistKind>('watch')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [reason, setReason] = useState('')

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <h2 className="font-semibold text-foreground">Add to watchlist</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground transition hover:text-foreground" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Discord user ID <span className="text-[#f87171]">*</span></label>
              <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="123456789012345678" autoFocus className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Username</label>
              <input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="optional" className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">List</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as WatchlistKind)} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                {WATCHLIST_KINDS.map((k) => <option key={k} value={k}>{WATCHLIST_KIND_LABELS[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Severity</label>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className="w-full rounded-lg border px-3 py-2 text-sm capitalize focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Reason</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this user flagged?" rows={2} maxLength={500} className="w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
          </div>
          {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg-2)' }}>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground" style={{ borderColor: 'var(--line-strong)' }}>Cancel</button>
          <button type="button" disabled={busy || !userId.trim()} onClick={() => onAdd({ userId, userName: userName || undefined, kind, severity, reason: reason || undefined })} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            {busy && <Loader2 size={14} className="animate-spin" />}Add
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

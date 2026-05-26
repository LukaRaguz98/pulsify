'use client'

import { useEffect, useState } from 'react'
import {
  X, Gift, Users, Trophy, Clock, Hash, Pencil, Repeat, Ban, Trash2, Download, Shield,
} from 'lucide-react'
import {
  STATUS_META,
  describeRequirements,
  hasRequirements,
  timeAgo,
  type Giveaway,
} from '@/lib/giveaways'
import {
  getGiveawayEntries,
  endGiveawayNow,
  rerollGiveaway,
  cancelGiveaway,
  deleteGiveaway,
  type ActionResult,
} from '@/app/dashboard/[guildId]/giveaways/actions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { GiveawayIcon } from './icons'
import { Countdown } from './Countdown'

type Entry = { user_id: string; user_name: string | null; entered_at: string; is_winner: boolean }

type Props = {
  guildId: string
  giveaway: Giveaway
  onEdit: () => void
  onClose: () => void
  runAction: <T>(fn: () => Promise<ActionResult<T>>, successMsg?: string) => Promise<ActionResult<T>>
}

type ConfirmKind = 'end' | 'reroll' | 'cancel' | 'delete' | null

export function GiveawayDetail({ guildId, giveaway, onEdit, onClose, runAction }: Props) {
  const meta = STATUS_META[giveaway.status]
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [confirm, setConfirm] = useState<ConfirmKind>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getGiveawayEntries(guildId, giveaway.id).then((res) => {
      if (active && res.ok) setEntries(res.data.entries)
    })
    return () => {
      active = false
    }
  }, [guildId, giveaway.id])

  // Flag the body while the drawer is open so globals.css hides the app footer
  // + corner chrome that would otherwise paint over it (universal z-index:1
  // traps the drawer in <main>'s stacking context).
  useEffect(() => {
    document.body.classList.add('slide-over-open')
    return () => document.body.classList.remove('slide-over-open')
  }, [])

  function exportCsv() {
    const rows = [['user_id', 'user_name', 'entered_at', 'is_winner']]
    for (const e of entries ?? []) {
      rows.push([e.user_id, (e.user_name ?? '').replace(/"/g, "'"), e.entered_at, String(e.is_winner)])
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `giveaway-${giveaway.id.slice(0, 8)}-entries.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function run(kind: Exclude<ConfirmKind, null>) {
    setBusy(true)
    const map = {
      end: () => endGiveawayNow(guildId, giveaway.id),
      reroll: () => rerollGiveaway(guildId, giveaway.id),
      cancel: () => cancelGiveaway(guildId, giveaway.id),
      delete: () => deleteGiveaway(guildId, giveaway.id),
    } as const
    const msg = {
      end: 'Drawing winners now…',
      reroll: 'Rerolling winners…',
      cancel: 'Giveaway cancelled.',
      delete: 'Giveaway deleted.',
    }[kind]
    const res = await runAction(map[kind], msg)
    setBusy(false)
    setConfirm(null)
    if (res.ok && (kind === 'delete' || kind === 'cancel')) onClose()
  }

  const winnerIds = new Set(giveaway.winners.map((w) => w.id))

  return (
    <>
      <button aria-label="Close" onClick={onClose} className="fixed inset-0 z-[60]" style={{ background: 'rgba(0,0,0,0.5)' }} />
      <aside
        role="dialog"
        aria-modal="true"
        className="gw-drawer fixed right-0 top-0 z-[70] flex h-full w-full max-w-md flex-col border-l shadow-2xl"
        style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--line-strong)' }}>
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
              <Gift size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">{giveaway.title}</h2>
              <span
                className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ color: meta.color, background: `${meta.color}1f` }}
              >
                <GiveawayIcon name={meta.icon} size={11} />
                {meta.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5" style={{ color: 'var(--text-3)' }}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Key facts */}
          <div className="grid grid-cols-2 gap-2.5">
            <Fact icon={<Gift size={14} />} label="Prize" value={giveaway.prize} />
            <Fact icon={<Trophy size={14} />} label="Winners" value={String(giveaway.winner_count)} />
            <Fact icon={<Users size={14} />} label="Entries" value={giveaway.entry_count.toLocaleString()} />
            <Fact
              icon={<Clock size={14} />}
              label={giveaway.status === 'active' ? 'Ends' : giveaway.status === 'scheduled' ? 'Starts' : 'Ended'}
              value={
                giveaway.status === 'active' ? (
                  <Countdown target={giveaway.ends_at} endedLabel="now" prefix="in " />
                ) : giveaway.status === 'scheduled' && giveaway.starts_at ? (
                  <Countdown target={giveaway.starts_at} endedLabel="now" prefix="in " />
                ) : giveaway.ended_at ? (
                  timeAgo(giveaway.ended_at)
                ) : (
                  '—'
                )
              }
            />
          </div>

          {giveaway.description && (
            <p className="whitespace-pre-wrap rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}>
              {giveaway.description}
            </p>
          )}

          <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
            <Hash size={12} /> Posted in <span style={{ color: 'var(--text-2)' }}>#{giveaway.channel_id}</span>
          </p>

          {/* Requirements */}
          {hasRequirements(giveaway.requirements) && (
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--line-strong)' }}>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                <Shield size={13} /> Requirements
              </p>
              <ul className="space-y-0.5 text-sm" style={{ color: 'var(--text-3)' }}>
                {describeRequirements(giveaway.requirements).map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Winners */}
          {giveaway.winners.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                <Trophy size={13} /> Winners
              </p>
              <div className="space-y-1.5">
                {giveaway.winners.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm"
                    style={{ borderColor: 'rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.08)', color: 'var(--text)' }}
                  >
                    <Trophy size={13} style={{ color: '#a855f7' }} />
                    {w.name ?? w.id}
                    <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>{w.id}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Entrants */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                <Users size={13} /> Entrants {entries ? `(${entries.length})` : ''}
              </p>
              {entries && entries.length > 0 && (
                <button onClick={exportCsv} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--p-1)' }}>
                  <Download size={12} /> Export CSV
                </button>
              )}
            </div>
            {entries === null ? (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading entrants…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No entries yet.</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border p-2" style={{ borderColor: 'var(--line-strong)' }}>
                {entries.map((e) => (
                  <div key={e.user_id} className="flex items-center gap-2 px-1.5 py-1 text-sm" style={{ color: 'var(--text-2)' }}>
                    {winnerIds.has(e.user_id) || e.is_winner ? (
                      <Trophy size={12} style={{ color: '#a855f7' }} />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--text-3)' }} />
                    )}
                    <span className="truncate">{e.user_name ?? e.user_id}</span>
                    <span className="ml-auto shrink-0 text-[10px]" style={{ color: 'var(--text-3)' }}>{timeAgo(e.entered_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2 border-t p-4" style={{ borderColor: 'var(--line-strong)' }}>
          {(giveaway.status === 'scheduled' || giveaway.status === 'active') && (
            <ActionBtn onClick={onEdit} icon={<Pencil size={14} />} label="Edit" />
          )}
          {giveaway.status === 'active' && (
            <ActionBtn onClick={() => setConfirm('end')} icon={<Trophy size={14} />} label="Draw now" accent />
          )}
          {giveaway.status === 'ended' && (
            <ActionBtn onClick={() => setConfirm('reroll')} icon={<Repeat size={14} />} label="Reroll" accent />
          )}
          {(giveaway.status === 'scheduled' || giveaway.status === 'active') && (
            <ActionBtn onClick={() => setConfirm('cancel')} icon={<Ban size={14} />} label="Cancel" />
          )}
          <ActionBtn onClick={() => setConfirm('delete')} icon={<Trash2 size={14} />} label="Delete" danger />
        </div>
      </aside>

      {confirm === 'end' && (
        <ConfirmDialog
          title="Draw winners now?"
          description="This ends the giveaway immediately and picks the winners. This can't be undone."
          confirmLabel="Draw winners"
          busy={busy}
          onConfirm={() => run('end')}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'reroll' && (
        <ConfirmDialog
          title="Reroll winners?"
          description="New winners will be drawn, excluding the current ones. The previous winners keep their record."
          confirmLabel="Reroll"
          busy={busy}
          onConfirm={() => run('reroll')}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'cancel' && (
        <ConfirmDialog
          title="Cancel giveaway?"
          description="No winners will be drawn and the Discord message is marked cancelled."
          confirmLabel="Cancel giveaway"
          tone="warning"
          busy={busy}
          onConfirm={() => run('cancel')}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title="Delete giveaway?"
          description="Permanently removes this giveaway, all its entries, and its Discord message."
          confirmLabel="Delete"
          tone="destructive"
          busy={busy}
          onConfirm={() => run('delete')}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-2.5" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
        {icon}
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function ActionBtn({
  onClick,
  icon,
  label,
  accent,
  danger,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  accent?: boolean
  danger?: boolean
}) {
  const style = accent
    ? { background: 'linear-gradient(135deg, var(--p-1), var(--p-2))', color: '#fff', border: 'none' }
    : danger
      ? { borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }
      : { borderColor: 'var(--line-strong)', color: 'var(--text-2)' }
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
      style={style}
    >
      {icon}
      {label}
    </button>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { X, Trophy, ChevronRight } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useDialogDismiss } from '@/components/ui/use-dialog-dismiss'
import {
  aggregateInviters,
  buildLeaderboard,
  bonusByUser,
  periodSince,
  PERIOD_OPTIONS,
  statusLabel,
  reasonLabel,
  type InvitePeriod,
  type InvitedMember,
  type InviteAdjustment,
  type InviteLeaderRow,
} from '@/lib/invites'
import { STATUS_COLOR } from './icons'

type Props = {
  members: InvitedMember[]
  adjustments: InviteAdjustment[]
  roleNames: Map<string, string>
}

export function InviteLeaderboard({ members, adjustments, roleNames }: Props) {
  const [period, setPeriod] = useState<InvitePeriod>('all')
  const [openInviter, setOpenInviter] = useState<InviteLeaderRow | null>(null)

  const board = useMemo(() => {
    const since = periodSince(period)
    const agg = aggregateInviters(members, since)
    return buildLeaderboard(agg, {
      bonusByUser: bonusByUser(adjustments),
      // Bonus credits are lifetime, so only fold them into the all-time board.
      includeBonus: period === 'all',
    })
  }, [members, adjustments, period])

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border p-1" style={{ borderColor: 'var(--line-strong)', background: 'var(--panel)' }}>
        {PERIOD_OPTIONS.map((p) => {
          const active = period === p.value
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              style={active ? { background: 'var(--p-soft)', color: 'var(--p-1)' } : { color: 'var(--text-2)' }}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {board.length === 0 ? (
        <EmptyState icon={<Trophy size={22} />} title="No ranked inviters yet" description="The leaderboard fills in as members join through tracked invites." variant="muted" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--line)' }}>
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-subtle" style={{ borderColor: 'var(--line)' }}>
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">Inviter</th>
                <th className="px-4 py-3 text-right font-semibold">Score</th>
                <th className="px-4 py-3 text-right font-semibold">Valid</th>
                <th className="px-4 py-3 text-right font-semibold">Retained</th>
                <th className="px-4 py-3 text-right font-semibold">Fake</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {board.map((r) => (
                <tr
                  key={r.inviter_id}
                  className="cursor-pointer border-b transition-colors last:border-0 hover:bg-[var(--bg-2)]"
                  style={{ borderColor: 'var(--line)' }}
                  onClick={() => setOpenInviter(r)}
                >
                  <td className="px-4 py-3">
                    <span className="font-bold" style={{ color: r.rank <= 3 ? 'var(--p-1)' : 'var(--text-3)' }}>{r.rank}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="truncate font-medium text-foreground">{r.inviter_name ?? `User ${r.inviter_id.slice(0, 8)}`}</div>
                    <div className="text-xs text-subtle">{r.retentionRate}% retention</div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold" style={{ color: 'var(--p-1)' }}>{r.score}</td>
                  <td className="px-4 py-3 text-right text-foreground">{r.valid}</td>
                  <td className="px-4 py-3 text-right text-foreground">{r.retained}</td>
                  <td className="px-4 py-3 text-right" style={{ color: r.fake > 0 ? '#ef4444' : 'var(--text-3)' }}>{r.fake}</td>
                  <td className="px-2 py-3 text-right text-subtle"><ChevronRight size={15} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openInviter && (
        <InviterDrawer row={openInviter} members={members} roleNames={roleNames} onClose={() => setOpenInviter(null)} />
      )}
    </div>
  )
}

// ── Inviter profile drawer ──────────────────────────────────────────────────

function InviterDrawer({
  row,
  members,
  onClose,
}: {
  row: InviteLeaderRow
  members: InvitedMember[]
  roleNames: Map<string, string>
  onClose: () => void
}) {
  useDialogDismiss(onClose)
  const invited = useMemo(
    () => members.filter((m) => m.inviter_id === row.inviter_id && !m.is_bonus).slice(0, 50),
    [members, row.inviter_id],
  )

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col border-l shadow-2xl" style={{ background: 'var(--bg)', borderColor: 'var(--line-strong)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--line)' }}>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">{row.inviter_name ?? `User ${row.inviter_id.slice(0, 10)}`}</h3>
            <p className="text-xs text-subtle">Rank #{row.rank} · score {row.score}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-subtle hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { l: 'Valid', v: row.valid, c: '#22c55e' },
              { l: 'Retained', v: row.retained, c: '#a78bfa' },
              { l: 'Fake', v: row.fake, c: '#ef4444' },
              { l: 'Bonus', v: row.bonus, c: '#38bdf8' },
              { l: 'Left', v: row.left, c: '#94a3b8' },
              { l: 'Invalid', v: row.invalid, c: '#94a3b8' },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border p-2.5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                <div className="text-lg font-bold" style={{ color: s.c }}>{s.v}</div>
                <div className="text-[11px] text-subtle">{s.l}</div>
              </div>
            ))}
          </div>

          <p className="text-xs text-subtle">Reward this inviter automatically with an invite milestone in Engagement › Milestones.</p>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Invited members ({invited.length})</h4>
            {invited.length === 0 ? (
              <p className="text-sm text-subtle">No attributed joins in the loaded window.</p>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {invited.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground">{m.user_name ?? `User ${m.user_id.slice(0, 8)}`}</span>
                    {m.fake_reason && <span className="text-[11px] text-subtle">{reasonLabel(m.fake_reason)}</span>}
                    <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${STATUS_COLOR[m.status]}1f`, color: STATUS_COLOR[m.status] }}>{statusLabel(m.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

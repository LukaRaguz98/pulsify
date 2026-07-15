'use client'

import { useState, useTransition } from 'react'
import { Coins, RotateCcw, History } from 'lucide-react'
import { SectionCard } from '@/components/ui/section-card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { InviteAdjustment } from '@/lib/invites'
import { adjustBonusCredits, resetInviterStats } from '@/app/dashboard/[guildId]/(management)/invites/actions'
import type { Feedback } from './InvitesContent'

type Props = {
  guildId: string
  adjustments: InviteAdjustment[]
  setFeedback: (f: Feedback) => void
  onDone: () => void
}

const KIND_LABEL: Record<InviteAdjustment['kind'], string> = {
  bonus: 'Bonus credit',
  invalidate: 'Invalidated',
  approve: 'Approved',
  grant_reward: 'Reward granted',
  reset: 'Stats reset',
}

const inputStyle: React.CSSProperties = {
  borderRadius: '0.5rem',
  border: '1px solid var(--line-strong)',
  background: 'var(--panel)',
  color: 'var(--text)',
  padding: '0.4rem 0.6rem',
  fontSize: '0.875rem',
}

export function InviteAdmin({ guildId, adjustments, setFeedback, onDone }: Props) {
  const [creditUser, setCreditUser] = useState('')
  const [creditAmount, setCreditAmount] = useState(5)
  const [creditReason, setCreditReason] = useState('')
  const [resetUser, setResetUser] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, startTransition] = useTransition()

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string, after?: () => void) {
    startTransition(async () => {
      const res = await fn()
      if (res.ok) { setFeedback({ kind: 'success', msg: success }); after?.(); onDone() }
      else setFeedback({ kind: 'error', msg: res.error })
    })
  }

  return (
    <SectionCard title="Manual management" description="Adjust an inviter’s credits by their Discord user ID, or reset their stats. Every change is logged below.">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Bonus credits */}
        <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground"><Coins size={15} style={{ color: '#38bdf8' }} /> Bonus credits</div>
          <input placeholder="Inviter user ID" value={creditUser} onChange={(e) => setCreditUser(e.target.value.trim())} style={inputStyle} className="mb-2 w-full outline-none" />
          <div className="mb-2 flex items-center gap-2">
            <input type="number" value={creditAmount} onChange={(e) => setCreditAmount(Math.trunc(Number(e.target.value) || 0))} style={inputStyle} className="w-24 outline-none" />
            <span className="text-xs text-subtle">(negative removes)</span>
          </div>
          <input placeholder="Reason (optional)" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} style={inputStyle} className="mb-2 w-full outline-none" />
          <button type="button" disabled={busy || !creditUser} onClick={() => run(() => adjustBonusCredits(guildId, creditUser, null, creditAmount, creditReason || null), 'Bonus credits updated.', () => { setCreditUser(''); setCreditReason('') })} className="w-full rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))' }}>
            Apply credits
          </button>
        </div>

        {/* Reset stats */}
        <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground"><RotateCcw size={15} style={{ color: '#f87171' }} /> Reset stats</div>
          <p className="mb-2 text-xs text-subtle">Clears an inviter’s attributed joins and bonus credits.</p>
          <input placeholder="Inviter user ID" value={resetUser} onChange={(e) => setResetUser(e.target.value.trim())} style={inputStyle} className="mb-2 w-full outline-none" />
          <button type="button" disabled={busy || !resetUser} onClick={() => setConfirmReset(true)} className="w-full rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}>
            Reset inviter
          </button>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground"><History size={15} /> Audit log</div>
        {adjustments.length === 0 ? (
          <p className="py-2 text-sm text-subtle">No manual changes yet.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {adjustments.slice(0, 40).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>{KIND_LABEL[a.kind]}</span>
                <span className="text-foreground">
                  {a.kind === 'bonus' && `${a.amount > 0 ? '+' : ''}${a.amount} for ${a.user_name ?? a.user_id?.slice(0, 8) ?? 'inviter'}`}
                  {(a.kind === 'invalidate' || a.kind === 'approve') && `${a.target_name ?? a.target_user_id?.slice(0, 8) ?? 'a member'}`}
                  {a.kind === 'reset' && `${a.user_name ?? a.user_id?.slice(0, 8) ?? 'inviter'}`}
                  {a.kind === 'grant_reward' && `${a.user_name ?? a.user_id?.slice(0, 8) ?? 'inviter'}`}
                </span>
                {a.reason && <span className="text-xs text-subtle">— {a.reason}</span>}
                <span className="ml-auto text-xs text-subtle">{a.created_by_name ?? 'admin'} · {new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Reset this inviter’s stats?"
          description="Their attributed joins and bonus credits are permanently deleted. This cannot be undone."
          confirmLabel="Reset"
          tone="destructive"
          busy={busy}
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => run(() => resetInviterStats(guildId, resetUser, null), 'Inviter stats reset.', () => { setResetUser(''); setConfirmReset(false) })}
        />
      )}
    </SectionCard>
  )
}

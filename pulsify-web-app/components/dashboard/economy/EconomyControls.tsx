'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Coins, Info, Loader2, ShieldCheck } from 'lucide-react'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/table-skeleton'
import { ADMIN_ADJUST_LIMITS, formatCoins, type EconomyTransaction } from '@/lib/economy'

type Props = {
  guildId: string
  operators: { id: string; name: string }[]
  onAdjusted?: () => void
}

type Action = 'grant_coins' | 'remove_coins'

const ACTION_OPTIONS: { value: Action; label: string }[] = [
  { value: 'grant_coins', label: 'Grant coins' },
  { value: 'remove_coins', label: 'Remove coins' },
]

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line-strong)',
  color: 'var(--text)',
}

/**
 * Operator-only economy controls: grant or remove global coins for any member
 * (recorded against the acting operator), plus the audit log of every
 * administrative adjustment — the economy moderation log. The economy is
 * bot-wide, so this is gated to the Pulsify operator, not server admins.
 * Reputation is the computed trust score, not a grantable value, so it has no
 * controls here.
 */
export function EconomyControls({ guildId, operators, onAdjusted }: Props) {
  const [action, setAction] = useState<Action>('grant_coins')
  const [userId, setUserId] = useState('')
  const [userName, setUserName] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [audit, setAudit] = useState<EconomyTransaction[] | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)

  const loadAudit = useCallback(async () => {
    setAuditError(null)
    try {
      const res = await fetch(
        `/api/guilds/${guildId}/economy/transactions?scope=guild&audit=1&limit=20`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const json = (await res.json()) as { rows: EconomyTransaction[] }
      setAudit(json.rows)
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to load the audit log.')
      setAudit([])
    }
  }, [guildId])

  useEffect(() => {
    loadAudit()
  }, [loadAudit])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setResult(null)

    const id = userId.trim()
    const amt = Number(amount)
    if (!/^\d{5,25}$/.test(id)) {
      setResult({ ok: false, message: 'Enter a valid Discord user ID (right-click a member → Copy User ID).' })
      return
    }
    if (!Number.isInteger(amt) || amt < 1 || amt > ADMIN_ADJUST_LIMITS.maxCoins) {
      setResult({ ok: false, message: `Amount must be between 1 and ${ADMIN_ADJUST_LIMITS.maxCoins.toLocaleString()}.` })
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/guilds/${guildId}/economy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          userId: id,
          userName: userName.trim() || undefined,
          amount: amt,
          note: note.trim() || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; balance?: number }
      if (!res.ok) {
        setResult({ ok: false, message: json.error ?? 'Adjustment failed. Try again.' })
        return
      }
      setResult({ ok: true, message: `Done. New balance: ${formatCoins(json.balance)} coins.` })
      setAmount('')
      setNote('')
      loadAudit()
      onAdjusted?.()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Bot-wide notice + who can see/manage this surface (mirrors Presence). */}
      <div
        className="flex items-start gap-2.5 rounded-xl border p-3.5 text-sm"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
      >
        <Info size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--p-1)' }} />
        <div className="space-y-2">
          <p>
            The Pulse economy is <strong className="text-foreground">bot-wide</strong> — one balance
            per member across every server — so adjustments aren&apos;t editable per server admin.
            Every adjustment is recorded with your name.
          </p>
          <p className="flex flex-wrap items-center gap-1.5">
            <ShieldCheck size={13} className="shrink-0" style={{ color: 'var(--p-1)' }} />
            <span>Visible &amp; editable only to Pulsify {operators.length === 1 ? 'operator' : 'operators'}:</span>
            {operators.length === 0 ? (
              <span style={{ color: 'var(--text-3)' }}>none configured</span>
            ) : (
              operators.map((op) => (
                <span
                  key={op.id}
                  className="rounded-md border px-1.5 py-0.5 text-xs font-medium text-foreground"
                  style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
                >
                  {op.name}
                </span>
              ))
            )}
          </p>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <SectionCard
          title="Adjust a member"
        description="Grant or remove global coins. Every adjustment is recorded with your name in the audit log."
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Action</span>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as Action)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={inputStyle}
              >
                {ACTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Amount <span className="text-subtle">(max {ADMIN_ADJUST_LIMITS.maxCoins.toLocaleString()})</span>
              </span>
              <input
                type="number"
                min={1}
                max={ADMIN_ADJUST_LIMITS.maxCoins}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 500"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={inputStyle}
                required
              />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">User ID</span>
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="123456789012345678"
                className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
                style={inputStyle}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Display name <span className="text-subtle">(optional)</span>
              </span>
              <input
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Shown in the ledger"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={inputStyle}
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Reason <span className="text-subtle">(optional, shown in the audit log)</span>
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={ADMIN_ADJUST_LIMITS.maxNote}
              placeholder="e.g. Event prize payout"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={inputStyle}
            />
          </label>

          {result && (
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: result.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
                color: result.ok ? 'var(--green)' : '#f87171',
              }}
            >
              {result.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              <span className="text-muted-foreground">{result.message}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
            style={{ background: 'var(--p-1)' }}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Apply adjustment
          </button>
          <p className="text-xs text-subtle">
            Operator-only — the economy is global, so coins aren&apos;t editable per server admin.
            Removals can&apos;t push a balance below zero.
          </p>
        </form>
      </SectionCard>

      <SectionCard
        title="Economy moderation log"
        description="The last administrative coin adjustments made from this server."
      >
        {audit === null ? (
          <TableSkeleton rows={5} columns={3} />
        ) : auditError ? (
          <p className="text-sm text-muted-foreground">{auditError}</p>
        ) : audit.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={22} />}
            title="No adjustments yet"
            description="Administrative grants and removals made from this server will appear here."
            variant="muted"
          />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {audit.map((row) => {
              const positive = row.amount >= 0
              return (
                <li key={row.id} className="flex items-center gap-3 py-3">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'var(--bg-2)', color: positive ? 'var(--green)' : 'var(--red)' }}
                  >
                    <Coins size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      <span className="font-medium">{row.actor_name ?? 'An operator'}</span>{' '}
                      {positive ? 'granted' : 'removed'}{' '}
                      <span className="font-mono">{formatCoins(Math.abs(row.amount))} coins</span>{' '}
                      {positive ? 'to' : 'from'} {row.user_name ?? row.user_id}
                    </p>
                    <p className="truncate text-xs text-subtle">
                      {[row.note, new Date(row.created_at).toLocaleString()].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        </SectionCard>
      </div>
    </div>
  )
}

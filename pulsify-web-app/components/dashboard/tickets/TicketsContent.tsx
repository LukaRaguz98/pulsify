'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LifeBuoy, Inbox, Settings, BarChart3, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { computeTicketStats, type Ticket, type TicketConfig } from '@/lib/tickets'
import type { ActionResult } from '@/app/dashboard/[guildId]/tickets/actions'
import { TicketList } from './TicketList'
import { TicketDetail } from './TicketDetail'
import { TicketAnalytics } from './TicketAnalytics'

type Props = {
  guildId: string
  guildName: string
  config: TicketConfig
  initialTickets: Ticket[]
}

type Tab = 'tickets' | 'analytics'
export type Feedback = { kind: 'success' | 'error'; msg: string }

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'tickets', label: 'Tickets', icon: <Inbox size={15} /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={15} /> },
]

export function TicketsContent({
  guildId,
  guildName,
  config,
  initialTickets,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('tickets')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [pending, startTransition] = useTransition()

  const selected = useMemo(
    () => initialTickets.find((t) => t.id === selectedId) ?? null,
    [initialTickets, selectedId],
  )
  const stats = useMemo(() => computeTicketStats(initialTickets), [initialTickets])

  /**
   * Run a server action with consistent busy / feedback / refresh handling.
   * Returns the result so callers can read `.data` and decide whether to close
   * a dialog. Success refreshes the route so the server-rendered list updates.
   */
  const runAction = useCallback(
    async <T,>(
      fn: () => Promise<ActionResult<T>>,
      successMsg?: string,
    ): Promise<ActionResult<T>> => {
      const result = await fn()
      if (result.ok) {
        if (successMsg) setFeedback({ kind: 'success', msg: successMsg })
        startTransition(() => router.refresh())
      } else {
        setFeedback({ kind: 'error', msg: result.error })
      }
      return result
    },
    [router],
  )

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router])

  return (
    <div className="page-content">
      <PageHeader
        title="Tickets"
        description={
          <>
            Discord-native support tickets for{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={
          <div className="flex items-center gap-3">
            {!config.enabled && (
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.12)' }}
              >
                System off
              </span>
            )}
            <Link
              href={`/dashboard/${guildId}/ticket-settings`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
            >
              <Settings size={12} />
              Tickets settings
            </Link>
            <RefreshButton onClick={refresh} refreshing={pending} />
          </div>
        }
      />

      {/* Tab bar */}
      <div
        className="mb-6 inline-flex rounded-xl border p-1"
        style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
      >
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors"
              style={
                active
                  ? { background: 'var(--p-soft)', color: 'var(--text)', boxShadow: 'inset 0 0 0 1px var(--p-soft)' }
                  : { color: 'var(--text-2)' }
              }
            >
              <span style={active ? { color: 'var(--p-1)' } : { color: 'var(--text-3)' }}>{t.icon}</span>
              {t.label}
              {t.id === 'tickets' && (
                <span
                  className="ml-1 rounded-full px-1.5 text-[10px] font-bold"
                  style={{ background: 'var(--bg-2)', color: 'var(--text-3)' }}
                >
                  {stats.open}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {feedback && (
        <div
          className="mb-5 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={
            feedback.kind === 'success'
              ? { borderColor: 'rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#4ade80' }
              : { borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }
          }
        >
          {feedback.kind === 'success' ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
          )}
          <span className="flex-1">{feedback.msg}</span>
          <button onClick={() => setFeedback(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {tab === 'tickets' &&
        (initialTickets.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center rounded-xl border py-16 text-center"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <div
              className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}
            >
              <LifeBuoy size={26} />
            </div>
            <p className="font-semibold text-foreground">No tickets yet</p>
            <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
              {config.enabled
                ? 'When members open a ticket from your Discord panel, it will appear here.'
                : 'Turn the ticket system on in Settings and post a panel so members can open tickets.'}
            </p>
            <Link
              href={`/dashboard/${guildId}/ticket-settings`}
              className="mt-4 rounded-lg px-3.5 py-2 text-sm font-medium"
              style={{ background: 'var(--p-1)', color: '#fff' }}
            >
              {config.enabled ? 'Open settings' : 'Set up tickets'}
            </Link>
          </div>
        ) : (
          <TicketList
            tickets={initialTickets}
            config={config}
            onSelect={(id) => setSelectedId(id)}
          />
        ))}

      {tab === 'analytics' && <TicketAnalytics stats={stats} config={config} />}

      {selected && (
        <TicketDetail
          guildId={guildId}
          ticket={selected}
          onClose={() => setSelectedId(null)}
          runAction={runAction}
        />
      )}
    </div>
  )
}

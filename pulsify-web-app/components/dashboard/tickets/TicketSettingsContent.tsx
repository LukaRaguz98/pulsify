'use client'

import { useCallback, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import type { DiscordChannel, DiscordRole } from '@/lib/discord'
import type { TicketConfig } from '@/lib/tickets'
import type { ActionResult } from '@/app/dashboard/[guildId]/tickets/actions'
import { TicketSettings } from './TicketSettings'

type Props = {
  guildId: string
  guildName: string
  config: TicketConfig
  channels: DiscordChannel[]
  categories: DiscordChannel[]
  roles: DiscordRole[]
}

type Feedback = { kind: 'success' | 'error'; msg: string }

export function TicketSettingsContent({ guildId, guildName, config, channels, categories, roles }: Props) {
  const router = useRouter()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [, startTransition] = useTransition()

  const runAction = useCallback(
    async <T,>(fn: () => Promise<ActionResult<T>>, successMsg?: string): Promise<ActionResult<T>> => {
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

  return (
    <div className="page-content">
      <PageHeader
        title="Ticket settings"
        description={
          <>
            Configure the ticket system for{' '}
            <span className="font-medium text-foreground">{guildName}</span>
          </>
        }
        action={
          <Link
            href={`/dashboard/${guildId}/tickets`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-2)' }}
          >
            <ArrowLeft size={12} />
            Back to tickets
          </Link>
        }
      />

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

      <TicketSettings
        guildId={guildId}
        config={config}
        channels={channels}
        categories={categories}
        roles={roles}
        runAction={runAction}
      />
    </div>
  )
}

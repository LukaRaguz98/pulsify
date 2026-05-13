'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { unbanMember } from '@/app/dashboard/[guildId]/moderation/actions'
import { ShieldOff, Loader2 } from 'lucide-react'

type Props = {
  guildId: string
  userId: string
  username: string
}

export function UnbanButton({ guildId, userId, username }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleUnban() {
    if (!confirm(`Unban ${username}? They will be able to rejoin the server.`)) return
    setError(null)
    startTransition(async () => {
      const result = await unbanMember(guildId, userId)
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error)
        setTimeout(() => setError(null), 5000)
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs" style={{ color: '#f87171' }}>{error}</span>
      )}
      <button
        onClick={handleUnban}
        disabled={isPending}
        title={`Unban ${username}`}
        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
        style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
        onMouseEnter={(e) => {
          if (!isPending) {
            e.currentTarget.style.background = 'rgba(239,68,68,0.08)'
            e.currentTarget.style.borderColor = 'rgba(239,68,68,0.35)'
            e.currentTarget.style.color = '#f87171'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = ''
          e.currentTarget.style.borderColor = 'var(--line-strong)'
          e.currentTarget.style.color = 'var(--text-3)'
        }}
      >
        {isPending
          ? <Loader2 size={12} className="animate-spin" />
          : <ShieldOff size={12} />
        }
        {isPending ? 'Unbanning…' : 'Unban'}
      </button>
    </div>
  )
}

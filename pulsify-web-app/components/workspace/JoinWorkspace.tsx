'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { acceptInvite } from '@/app/workspace/actions'

export function JoinWorkspace({ code }: { code: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await acceptInvite(code)
    if (res.ok) {
      router.push(`/workspace/${res.data.workspaceId}`)
      router.refresh()
    } else {
      setError(res.error)
      setBusy(false)
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg, var(--p-1), var(--p-2))', boxShadow: '0 6px 20px var(--p-glow)' }}
      >
        {busy && <Loader2 size={15} className="animate-spin" />}
        {busy ? 'Joining…' : 'Accept invite'}
      </button>
      {error && <p className="mt-3 text-xs" style={{ color: '#f87171' }}>{error}</p>}
    </div>
  )
}

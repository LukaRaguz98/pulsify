'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { Shield, Ban, RefreshCw, ShieldOff, Loader2, AlertCircle } from 'lucide-react'
import { avatarUrl } from '@/lib/discord'
import { createClient } from '@/lib/supabase'
import { unbanMember } from '@/app/dashboard/[guildId]/moderation/actions'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'

type Ban = {
  reason: string | null
  user: { id: string; username: string; avatar: string | null; discriminator: string }
}

type Warning = {
  id: string
  user_id: string
  username: string | null
  reason: string | null
  moderator_username: string | null
  moderator_id: string | null
  created_at: string
}

type Props = { guildId: string }

const POLL_INTERVAL = 15_000

export function ModerationContent({ guildId }: Props) {
  const [bans, setBans] = useState<Ban[]>([])
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [unbanPending, setUnbanPending] = useState<Set<string>>(new Set())
  const [unbanErrors, setUnbanErrors] = useState<Record<string, string>>({})
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const supabase = createClient()
      const [bansRes, { data: warningsData }] = await Promise.all([
        fetch(`/api/discord/guild/${guildId}/bans`, { cache: 'no-store' }),
        supabase
          .from('guild_warnings')
          .select('*')
          .eq('guild_id', guildId)
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      if (bansRes.ok) {
        const bansData: Ban[] = await bansRes.json()
        setBans(bansData)
      }
      if (warningsData) setWarnings(warningsData)
      setLastUpdated(new Date())
      setSecondsAgo(0)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [guildId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // polling
  useEffect(() => {
    timerRef.current = setInterval(() => fetchData(true), POLL_INTERVAL)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [fetchData])

  // "X seconds ago" counter
  useEffect(() => {
    const id = setInterval(() => {
      if (lastUpdated) {
        setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  async function handleUnban(userId: string, username: string) {
    if (!confirm(`Unban ${username}? They will be able to rejoin the server.`)) return
    setUnbanPending((prev) => new Set(prev).add(userId))
    setUnbanErrors((prev) => { const n = { ...prev }; delete n[userId]; return n })

    // optimistic removal
    setBans((prev) => prev.filter((b) => b.user.id !== userId))

    const result = await unbanMember(guildId, userId)
    if (!result.ok) {
      // rollback optimistic removal by re-fetching
      setUnbanErrors((prev) => ({ ...prev, [userId]: result.error }))
      fetchData(true)
      setTimeout(() => setUnbanErrors((prev) => { const n = { ...prev }; delete n[userId]; return n }), 5000)
    }
    setUnbanPending((prev) => { const n = new Set(prev); n.delete(userId); return n })
  }

  const updatedLabel = lastUpdated
    ? secondsAgo < 5 ? 'Just now' : `${secondsAgo}s ago`
    : null

  if (loading) {
    return (
      <div className="page-content">
        <PageHeader title="Moderation" description="Overview of moderation actions and bans for this server." />
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Moderation"
        description="Overview of moderation actions and bans for this server."
        action={
          <div className="flex items-center gap-3">
            {updatedLabel && (
              <span className="text-xs text-subtle">Updated {updatedLabel}</span>
            )}
            <button
              onClick={() => fetchData()}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--text-3)' }}
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 mb-8">
        <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
              <Ban size={16} />
            </span>
            <span className="text-sm text-muted-foreground">Active Bans</span>
          </div>
          <p className="text-3xl font-bold text-foreground font-mono">{bans.length}</p>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
              <Shield size={16} />
            </span>
            <span className="text-sm text-muted-foreground">Active Warnings</span>
          </div>
          <p className="text-3xl font-bold text-foreground font-mono">{warnings.length}</p>
        </div>
      </div>

      {warnings.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
            Recent Warnings
          </h2>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Reason</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Moderator</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Date</th>
                </tr>
              </thead>
              <tbody>
                {warnings.map((w) => (
                  <tr key={w.id} className="border-b" style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}>
                    <td className="px-4 py-3 text-foreground">{w.username ?? w.user_id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{w.reason ?? '—'}</td>
                    <td className="px-4 py-3 text-subtle">{w.moderator_username ?? w.moderator_id}</td>
                    <td className="px-4 py-3 text-subtle text-xs font-mono">
                      {new Date(w.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-subtle">
          Ban List ({bans.length})
        </h2>
        {bans.length === 0 ? (
          <EmptyState
            icon={<Shield size={36} />}
            title="No active bans"
            description="This server has no banned users."
          />
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Reason</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-subtle">Action</th>
                </tr>
              </thead>
              <tbody>
                {bans.map((ban) => {
                  const av = avatarUrl(ban.user.id, ban.user.avatar, ban.user.discriminator)
                  const isPending = unbanPending.has(ban.user.id)
                  const err = unbanErrors[ban.user.id]
                  return (
                    <tr key={ban.user.id} className="border-b" style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {av ? (
                            <Image src={av} alt={ban.user.username} width={28} height={28} className="rounded-full shrink-0" unoptimized />
                          ) : (
                            <div className="h-7 w-7 rounded-full shrink-0" style={{ background: 'var(--bg-2)' }} />
                          )}
                          <div>
                            <p className="text-foreground">{ban.user.username}</p>
                            <p className="text-xs text-subtle font-mono">{ban.user.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{ban.reason ?? 'No reason provided'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {err && (
                            <span className="flex items-center gap-1 text-xs" style={{ color: '#f87171' }}>
                              <AlertCircle size={10} />
                              {err}
                            </span>
                          )}
                          <button
                            onClick={() => handleUnban(ban.user.id, ban.user.username)}
                            disabled={isPending}
                            title={`Unban ${ban.user.username}`}
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
                            {isPending ? <Loader2 size={12} className="animate-spin" /> : <ShieldOff size={12} />}
                            {isPending ? 'Unbanning…' : 'Unban'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

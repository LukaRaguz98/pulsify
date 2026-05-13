'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronUp, ChevronDown, Loader2, Crown, AlertCircle } from 'lucide-react'
import { roleColor } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { OpenInDiscordButton } from '@/components/ui/open-in-discord'

type Role = {
  id: string
  name: string
  color: number
  position: number
  permissions: string
  managed: boolean
  mentionable: boolean
  hoist: boolean
}

type Member = {
  user: { id: string }
  roles: string[]
}

type Props = { guildId: string }

export function RolesContent({ guildId }: Props) {
  const [roles, setRoles] = useState<Role[]>([])
  const [memberCountByRole, setMemberCountByRole] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const [rolesRes, membersRes] = await Promise.all([
      fetch(`/api/discord/guild/${guildId}/roles`, { cache: 'no-store' }),
      fetch(`/api/discord/guild/${guildId}/members?limit=1000`, { cache: 'no-store' }),
    ])
    if (rolesRes.ok) {
      const data: Role[] = await rolesRes.json()
      setRoles(data)
    }
    if (membersRes.ok) {
      const members: Member[] = await membersRes.json()
      const counts = new Map<string, number>()
      for (const m of members) {
        for (const rid of m.roles) counts.set(rid, (counts.get(rid) ?? 0) + 1)
      }
      setMemberCountByRole(counts)
    }
    setLoading(false)
  }, [guildId])

  useEffect(() => { fetchData() }, [fetchData])

  const sorted = roles
    .filter((r) => r.name !== '@everyone')
    .sort((a, b) => b.position - a.position)

  async function move(index: number, direction: 'up' | 'down') {
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= sorted.length) return

    const roleA = sorted[index]
    const roleB = sorted[swapIndex]

    // optimistic update: swap position values in state
    const newPositions = new Map(roles.map((r) => [r.id, r.position]))
    newPositions.set(roleA.id, roleB.position)
    newPositions.set(roleB.id, roleA.position)
    setRoles((prev) => prev.map((r) => ({ ...r, position: newPositions.get(r.id) ?? r.position })))

    setMovingId(roleA.id)
    setError(null)

    const res = await fetch(`/api/discord/guild/${guildId}/roles`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        positions: [
          { id: roleA.id, position: roleB.position },
          { id: roleB.id, position: roleA.position },
        ],
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      setError(body.error ?? 'Failed to update role position.')
      // rollback: re-fetch real state
      fetchData()
      setTimeout(() => setError(null), 5000)
    }

    setMovingId(null)
  }

  if (loading) {
    return (
      <div className="page-content">
        <PageHeader title="Roles" description="View and manage the roles configured on your server." />
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Roles"
        description="View and manage the roles configured on your server."
      />

      <div className="mb-5 flex items-center gap-4 text-sm">
        <span className="text-muted-foreground">{sorted.length} roles total</span>
        <span className="text-subtle">·</span>
        <span className="text-muted-foreground">{sorted.filter((r) => r.hoist).length} hoisted</span>
        <span className="text-subtle">·</span>
        <span className="text-muted-foreground">{sorted.filter((r) => r.managed).length} managed</span>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Crown size={36} />}
          title="No custom roles"
          description="This server only has the @everyone role."
        />
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--line-strong)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Members</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Properties</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-subtle">Position</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-subtle">Order</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((role, i) => {
                const color = roleColor(role.color)
                const memberCount = memberCountByRole.get(role.id) ?? 0
                const isMoving = movingId === role.id
                const canMove = !role.managed
                const isFirst = i === 0
                const isLast = i === sorted.length - 1

                return (
                  <tr
                    key={role.id}
                    className="group border-b transition-colors"
                    style={{
                      borderColor: 'var(--line-strong)',
                      background: 'color-mix(in srgb, var(--panel) 50%, transparent)',
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-3.5 w-3.5 rounded-full border shrink-0"
                          style={{ backgroundColor: color, borderColor: 'var(--line-strong)' }}
                        />
                        <span
                          className="font-medium"
                          style={{ color: role.color !== 0 ? color : 'var(--text)' }}
                        >
                          @{role.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono">
                      {memberCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {role.hoist && (
                          <span className="rounded px-1.5 py-0.5 text-xs text-muted-foreground" style={{ background: 'var(--bg-2)' }}>
                            Hoisted
                          </span>
                        )}
                        {role.mentionable && (
                          <span className="rounded px-1.5 py-0.5 text-xs text-muted-foreground" style={{ background: 'var(--bg-2)' }}>
                            Mentionable
                          </span>
                        )}
                        {role.managed && (
                          <span className="rounded px-1.5 py-0.5 text-xs" style={{ background: 'var(--p-soft)', color: 'var(--p-1)' }}>
                            Managed
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-subtle font-mono text-xs">
                      #{role.position}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {isMoving ? (
                          <Loader2 size={14} className="animate-spin text-muted-foreground" />
                        ) : canMove ? (
                          <>
                            <button
                              onClick={() => move(i, 'up')}
                              disabled={isFirst || !!movingId}
                              title="Move up"
                              className="flex h-6 w-6 items-center justify-center rounded transition-all opacity-0 group-hover:opacity-100 disabled:opacity-0"
                              style={{ color: 'var(--text-3)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--text)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-3)' }}
                            >
                              <ChevronUp size={14} />
                            </button>
                            <button
                              onClick={() => move(i, 'down')}
                              disabled={isLast || !!movingId}
                              title="Move down"
                              className="flex h-6 w-6 items-center justify-center rounded transition-all opacity-0 group-hover:opacity-100 disabled:opacity-0"
                              style={{ color: 'var(--text-3)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2)'; e.currentTarget.style.color = 'var(--text)' }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-3)' }}
                            >
                              <ChevronDown size={14} />
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-subtle opacity-0 group-hover:opacity-100">managed</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <h2 className="mb-2 font-semibold text-foreground">Role Sync</h2>
        <p className="text-sm text-subtle mb-4">
          Configure how roles are synchronized between your Discord server and Pulsify.
          Role sync allows the bot to automatically manage roles based on member activity and events.
        </p>
        <OpenInDiscordButton
          webUrl={`https://discord.com/channels/${guildId}`}
          label="Manage roles on Discord"
        />
      </div>
    </div>
  )
}

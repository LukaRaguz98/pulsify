import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildRoles, fetchGuildMembers, roleColor } from '@/lib/discord'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Crown } from 'lucide-react'

export default async function RolesPage({
  params,
}: {
  params: Promise<{ guildId: string }>
}) {
  const { guildId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const [roles, members] = await Promise.all([
    fetchGuildRoles(guildId),
    fetchGuildMembers(guildId, 1000),
  ])

  const sortedRoles = roles
    .filter((r) => r.name !== '@everyone')
    .sort((a, b) => b.position - a.position)

  const memberCountByRole = new Map<string, number>()
  for (const member of members) {
    for (const roleId of member.roles) {
      memberCountByRole.set(roleId, (memberCountByRole.get(roleId) ?? 0) + 1)
    }
  }

  return (
    <div className="page-content">
      <PageHeader
        title="Roles"
        description="View and manage the roles configured on your server."
      />

      <div className="mb-5 flex items-center gap-4 text-sm">
        <span className="text-muted-foreground">{sortedRoles.length} roles total</span>
        <span className="text-subtle">·</span>
        <span className="text-muted-foreground">{sortedRoles.filter((r) => r.hoist).length} hoisted</span>
        <span className="text-subtle">·</span>
        <span className="text-muted-foreground">{sortedRoles.filter((r) => r.managed).length} managed</span>
      </div>

      {sortedRoles.length === 0 ? (
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
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-subtle">Position</th>
              </tr>
            </thead>
            <tbody>
              {sortedRoles.map((role) => {
                const color = roleColor(role.color)
                const memberCount = memberCountByRole.get(role.id) ?? 0
                return (
                  <tr
                    key={role.id}
                    className="border-b transition-colors hover:bg-[var(--panel-2)]"
                    style={{ borderColor: 'var(--line-strong)', background: 'color-mix(in srgb, var(--panel) 50%, transparent)' }}
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
                      {members.length > 0 ? memberCount.toLocaleString() : '—'}
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
                    <td className="px-4 py-3 text-subtle font-mono text-xs">
                      #{role.position}
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
        <a
          href={`https://discord.com/channels/${guildId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-[var(--text-3)] transition"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          Manage roles on Discord
        </a>
      </div>
    </div>
  )
}

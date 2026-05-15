import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { fetchGuildRoles, createGuildRole } from '@/lib/discord'

// Clones an existing role's name/color/permissions/hoist/mentionable. The new
// role lands at position 1 by default — the client reorders if needed.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string; roleId: string }> },
) {
  const { guildId, roleId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { reason?: string }

  const roles = await fetchGuildRoles(guildId)
  const source = roles.find((r) => r.id === roleId)
  if (!source) return NextResponse.json({ error: 'Source role not found.' }, { status: 404 })

  const result = await createGuildRole(
    guildId,
    {
      name: `${source.name} copy`.slice(0, 100),
      color: source.color,
      permissions: source.permissions,
      hoist: source.hoist,
      mentionable: source.mentionable,
    },
    body.reason ?? `Duplicated from ${source.name}`,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.role)
}

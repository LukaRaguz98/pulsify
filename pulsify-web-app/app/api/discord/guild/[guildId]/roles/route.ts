import { NextResponse } from 'next/server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { fetchGuildRoles, reorderGuildRoles, createGuildRole, type RoleMutation } from '@/lib/discord'
import { ALL_PERMISSION_BITS } from '@/lib/discord-permissions'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const roles = await fetchGuildRoles(guildId)
  return NextResponse.json(roles)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as RoleMutation & { reason?: string }
  const mutation = sanitizeMutation(body)
  const result = await createGuildRole(guildId, mutation, body.reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result.role)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = (await req.json()) as { positions: { id: string; position: number }[] }
  if (!Array.isArray(body?.positions)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const result = await reorderGuildRoles(guildId, body.positions)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}

// Strips unknown bits from the permissions string so we never send forward-
// incompatible flags to Discord, and clamps name length.
export function sanitizeMutation(body: RoleMutation): RoleMutation {
  const out: RoleMutation = {}
  if (typeof body.name === 'string') out.name = body.name.trim().slice(0, 100)
  if (typeof body.color === 'number' && Number.isFinite(body.color)) {
    out.color = Math.max(0, Math.min(0xffffff, Math.floor(body.color)))
  }
  if (typeof body.permissions === 'string') {
    try {
      out.permissions = (BigInt(body.permissions) & ALL_PERMISSION_BITS).toString()
    } catch {
      // ignore — fall through with no permissions update
    }
  }
  if (typeof body.hoist === 'boolean') out.hoist = body.hoist
  if (typeof body.mentionable === 'boolean') out.mentionable = body.mentionable
  return out
}

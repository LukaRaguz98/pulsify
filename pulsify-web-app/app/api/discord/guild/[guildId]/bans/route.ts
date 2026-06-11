import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireGuildRole } from '@/lib/guild-access'
import {
  fetchGuildBans,
  fetchGuildAuditLog,
  AUDIT_LOG_ACTION,
  type EnrichedBan,
} from '@/lib/discord'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params

  // Management data — requires Manage Server / Administrator on this guild.
  const auth = await requireGuildRole(guildId, 'admin')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  // Pull bans, recent ban audit-log entries, and any dashboard-issued bans in parallel.
  const [bans, auditLog, modLogs] = await Promise.all([
    fetchGuildBans(guildId),
    fetchGuildAuditLog(guildId, AUDIT_LOG_ACTION.MEMBER_BAN_ADD, 100),
    supabase
      .from('moderation_logs')
      .select('target_user_id, moderator_id, moderator_username, created_at')
      .eq('guild_id', guildId)
      .eq('action', 'ban')
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  // Index audit-log entries by target user ID. Discord returns the most recent
  // entries first, so the first hit per target is authoritative.
  const auditByTarget = new Map<string, { user_id: string | null; id: string }>()
  const auditUsers = new Map<string, { username: string; global_name: string | null }>()
  if (auditLog) {
    for (const u of auditLog.users) {
      auditUsers.set(u.id, { username: u.username, global_name: u.global_name })
    }
    for (const entry of auditLog.audit_log_entries) {
      if (entry.target_id && !auditByTarget.has(entry.target_id)) {
        auditByTarget.set(entry.target_id, { user_id: entry.user_id, id: entry.id })
      }
    }
  }

  // Index dashboard bans by target user ID (newest wins).
  const dashboardByTarget = new Map<
    string,
    { moderator_id: string; moderator_username: string | null; created_at: string }
  >()
  for (const log of modLogs.data ?? []) {
    if (log.target_user_id && !dashboardByTarget.has(log.target_user_id)) {
      dashboardByTarget.set(log.target_user_id, {
        moderator_id: log.moderator_id,
        moderator_username: log.moderator_username,
        created_at: log.created_at,
      })
    }
  }

  const enriched: EnrichedBan[] = bans.map((ban) => {
    const dash = dashboardByTarget.get(ban.user.id)
    if (dash) {
      return {
        ...ban,
        moderator: {
          id: dash.moderator_id,
          username: dash.moderator_username ?? dash.moderator_id,
        },
        banned_at: dash.created_at,
        source: 'pulsify',
      }
    }
    const audit = auditByTarget.get(ban.user.id)
    if (audit?.user_id) {
      const u = auditUsers.get(audit.user_id)
      // Discord audit-log entry IDs are snowflakes — first 42 bits encode the timestamp.
      const ts = snowflakeToIso(audit.id)
      return {
        ...ban,
        moderator: {
          id: audit.user_id,
          username: u ? (u.global_name ?? u.username) : audit.user_id,
        },
        banned_at: ts,
        source: 'audit_log',
      }
    }
    return { ...ban, moderator: null, banned_at: null, source: null }
  })

  return NextResponse.json(enriched)
}

const DISCORD_EPOCH = BigInt('1420070400000')
function snowflakeToIso(id: string): string | null {
  try {
    const ms = (BigInt(id) >> BigInt(22)) + DISCORD_EPOCH
    return new Date(Number(ms)).toISOString()
  } catch {
    return null
  }
}

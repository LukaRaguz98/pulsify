import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchGuildAuditLog, AUDIT_LOG_ACTION } from '@/lib/discord'

export type TimeoutMeta = {
  user_id: string
  moderator: { id: string; username: string } | null
  reason: string | null
  issued_at: string | null
  source: 'pulsify' | 'audit_log' | null
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ guildId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { guildId } = await params

  const [auditLog, modLogs] = await Promise.all([
    fetchGuildAuditLog(guildId, AUDIT_LOG_ACTION.MEMBER_UPDATE, 100),
    supabase
      .from('moderation_logs')
      .select('target_user_id, moderator_id, moderator_username, reason, created_at, metadata')
      .eq('guild_id', guildId)
      .eq('action', 'timeout')
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  // Audit log: keep MEMBER_UPDATE entries that *added* a timeout (new_value
  // for communication_disabled_until is non-null). Most-recent-first is the
  // Discord default.
  type AuditMeta = { user_id: string | null; entry_id: string; reason: string | null }
  const auditByTarget = new Map<string, AuditMeta>()
  const auditUsers = new Map<string, { username: string; global_name: string | null }>()
  if (auditLog) {
    for (const u of auditLog.users) {
      auditUsers.set(u.id, { username: u.username, global_name: u.global_name })
    }
    for (const entry of auditLog.audit_log_entries) {
      if (!entry.target_id || auditByTarget.has(entry.target_id)) continue
      const change = entry.changes?.find((c) => c.key === 'communication_disabled_until')
      if (!change || change.new_value === null || change.new_value === undefined) continue
      auditByTarget.set(entry.target_id, {
        user_id: entry.user_id,
        entry_id: entry.id,
        reason: entry.reason,
      })
    }
  }

  // Dashboard logs (newest wins per user).
  const dashByTarget = new Map<
    string,
    { moderator_id: string; moderator_username: string | null; reason: string | null; created_at: string }
  >()
  for (const log of modLogs.data ?? []) {
    if (!log.target_user_id || dashByTarget.has(log.target_user_id)) continue
    dashByTarget.set(log.target_user_id, {
      moderator_id: log.moderator_id,
      moderator_username: log.moderator_username,
      reason: log.reason,
      created_at: log.created_at,
    })
  }

  // Merge into one entry per user. Dashboard logs are authoritative when
  // present; otherwise we use the audit log entry.
  const targetIds = new Set<string>([...dashByTarget.keys(), ...auditByTarget.keys()])
  const result: TimeoutMeta[] = []
  for (const userId of targetIds) {
    const dash = dashByTarget.get(userId)
    if (dash) {
      result.push({
        user_id: userId,
        moderator: { id: dash.moderator_id, username: dash.moderator_username ?? dash.moderator_id },
        reason: dash.reason,
        issued_at: dash.created_at,
        source: 'pulsify',
      })
      continue
    }
    const audit = auditByTarget.get(userId)
    if (audit?.user_id) {
      const u = auditUsers.get(audit.user_id)
      result.push({
        user_id: userId,
        moderator: { id: audit.user_id, username: u ? (u.global_name ?? u.username) : audit.user_id },
        reason: audit.reason,
        issued_at: snowflakeToIso(audit.entry_id),
        source: 'audit_log',
      })
    }
  }

  return NextResponse.json(result)
}

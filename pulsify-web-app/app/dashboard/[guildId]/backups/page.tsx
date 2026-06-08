import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { fetchGuild, fetchGuildChannels, fetchGuildRoles, CHANNEL_TYPES } from '@/lib/discord'
import { getCurrentUserPlan } from '@/lib/billing-server'
import { PLAN_LIMITS } from '@/lib/billing'
import { UpgradePrompt } from '@/components/billing/UpgradePrompt'
import { BackupsContent } from '@/components/dashboard/backups/BackupsContent'
import {
  BACKUP_SECTION_KEYS,
  RECOVERY_LOG_PAGE_SIZE,
  normaliseBackup,
  normaliseSchedule,
  normaliseLog,
  type ServerBackup,
  type BackupSchedule,
  type RecoveryLogEntry,
  type BackupSectionKey,
} from '@/lib/backups'

/** A lightweight snapshot of which sections currently hold something worth
 *  capturing on this server, plus live counts for the create panel. */
export type CaptureSnapshot = {
  capturable: BackupSectionKey[]
  counts: Partial<Record<BackupSectionKey, number>>
}

function settingsHasAny(settings: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => {
    const v = settings[k]
    if (v == null) return false
    if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length > 0
    return true
  })
}

export default async function BackupsPage({
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

  const guild = await fetchGuild(guildId)
  if (!guild) redirect('/dashboard')

  // Premium gate (Business+). Early access unlocks it for everyone — the server
  // actions re-verify, so this is the UX half of the gate.
  const plan = await getCurrentUserPlan()
  if (!PLAN_LIMITS[plan].backupRestore) {
    return (
      <div className="page-content">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Backup &amp; Restore</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-2)' }}>
            Versioned snapshots of your server configuration — restore from accidental changes in a few clicks.
          </p>
        </div>
        <UpgradePrompt
          requiredPlan="business"
          feature="Backup &amp; Restore"
          description="Capture versioned snapshots of your roles, channels and feature configuration, schedule automatic backups, and restore safely when something goes wrong."
        />
      </div>
    )
  }

  const [channels, roles, { data: settingsRow }, { data: aiRow }, { data: ticketRow }, counts, lists] =
    await Promise.all([
      fetchGuildChannels(guildId),
      fetchGuildRoles(guildId),
      supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle(),
      supabase.from('ai_moderation_settings').select('enabled, settings').eq('guild_id', guildId).maybeSingle(),
      supabase.from('ticket_configs').select('enabled, ticket_types').eq('guild_id', guildId).maybeSingle(),
      Promise.all([
        supabase
          .from('giveaways')
          .select('id', { count: 'exact', head: true })
          .eq('guild_id', guildId)
          .in('status', ['scheduled', 'active']),
        supabase.from('announcements').select('id', { count: 'exact', head: true }).eq('guild_id', guildId),
      ]),
      Promise.all([
        supabase
          .from('server_backups')
          .select('*')
          .eq('guild_id', guildId)
          .order('created_at', { ascending: false })
          .limit(60),
        supabase.from('backup_schedules').select('*').eq('guild_id', guildId).maybeSingle(),
        supabase
          .from('recovery_logs')
          .select('*')
          .eq('guild_id', guildId)
          .order('created_at', { ascending: false })
          .limit(RECOVERY_LOG_PAGE_SIZE),
      ]),
    ])

  const settings = (settingsRow?.settings as Record<string, unknown>) ?? {}
  const assignableRoles = roles.filter((r) => r.id !== guildId && !r.managed)
  const [giveawayCount, announcementCount] = counts

  const capturable: BackupSectionKey[] = []
  const countMap: Partial<Record<BackupSectionKey, number>> = {}

  if (assignableRoles.length) {
    capturable.push('roles')
    countMap.roles = assignableRoles.length
  }
  if (channels.length) {
    capturable.push('channels')
    countMap.channels = channels.length
  }
  if (settingsHasAny(settings, ['welcome', 'goodbye', 'auto_role'])) capturable.push('automations')
  if (settingsHasAny(settings, ['moderation_alerts'])) capturable.push('moderation')
  if (settingsHasAny(settings, ['onboarding', 'member_onboarding'])) capturable.push('onboarding')
  if (aiRow && (aiRow.enabled || aiRow.settings)) capturable.push('pulse_guard')
  if (ticketRow && (ticketRow.enabled || (Array.isArray(ticketRow.ticket_types) && ticketRow.ticket_types.length)))
    capturable.push('tickets')
  if ((giveawayCount.count ?? 0) > 0) {
    capturable.push('giveaways')
    countMap.giveaways = giveawayCount.count ?? 0
  }
  if (channels.filter((c) => c.type !== CHANNEL_TYPES.CATEGORY).length) {
    // Events are fetched live in capture; we can't cheaply count them here, so
    // offer the section whenever the guild is set up (it just captures 0 if none).
    capturable.push('events')
  }
  if ((announcementCount.count ?? 0) > 0) {
    capturable.push('announcements')
    countMap.announcements = announcementCount.count ?? 0
  }

  // Preserve the catalog order regardless of detection order.
  const orderedCapturable = BACKUP_SECTION_KEYS.filter((k) => capturable.includes(k))

  const [backupRows, scheduleRow, logRows] = lists
  const backups: ServerBackup[] = ((backupRows.data as Record<string, unknown>[] | null) ?? []).map((r) =>
    normaliseBackup(r),
  )
  const schedule: BackupSchedule = normaliseSchedule(
    (scheduleRow.data as Record<string, unknown> | null) ?? null,
    guildId,
  )
  const logs: RecoveryLogEntry[] = ((logRows.data as Record<string, unknown>[] | null) ?? []).map((r) =>
    normaliseLog(r),
  )

  const snapshot: CaptureSnapshot = { capturable: orderedCapturable, counts: countMap }

  return (
    <BackupsContent
      guildId={guildId}
      guildName={guild.name ?? ''}
      backups={backups}
      schedule={schedule}
      logs={logs}
      logsHasMore={logs.length === RECOVERY_LOG_PAGE_SIZE}
      snapshot={snapshot}
    />
  )
}

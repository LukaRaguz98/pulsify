'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { authorizeGuildModerator } from '@/lib/moderation-auth'
import { requireFeature } from '@/lib/billing-server'
import { recordNotification } from '@/lib/notifications-server'
import {
  fetchGuildChannels,
  fetchGuildRoles,
  fetchGuildEvents,
  createGuildRole,
  createGuildChannel,
  deleteGuildRole,
  deleteChannel,
  getBotHighestRolePosition,
  CHANNEL_TYPES,
  type CreatableChannelType,
} from '@/lib/discord'
import {
  BACKUP_SECTION_KEYS,
  BACKUP_LIMITS,
  SECTION_META,
  CURRENT_BACKUP_VERSION,
  RECOVERY_LOG_PAGE_SIZE,
  isRestorable,
  normaliseBackup,
  normaliseLog,
  sectionKeysPresent,
  sectionsByteSize,
  diffSections,
  clampRetention,
  validateBackupImport,
  type BackupSections,
  type BackupSectionKey,
  type BackupRole,
  type BackupChannel,
  type BackupType,
  type BackupFrequency,
  type BackupDiff,
  type RecoveryAction,
  type RecoveryStatus,
  type RecoveryLogEntry,
  type ServerBackup,
} from '@/lib/backups'

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string }

function revalidate(guildId: string) {
  revalidatePath(`/dashboard/${guildId}/backups`)
}

/** Gate: a guild moderator AND a plan that unlocks backups (Business+). The
 *  page already hides the feature, but actions re-verify — gating is a security
 *  boundary, not just UI. */
async function authorize(guildId: string) {
  const auth = await authorizeGuildModerator(guildId)
  if (!auth.ok) return { ok: false as const, error: auth.error }
  const gate = await requireFeature('backupRestore')
  if (!gate.ok) return { ok: false as const, error: gate.error }
  return { ok: true as const, moderator: auth.moderator }
}

// ── Recovery log: paginated read for the Logs tab ──────────────────────────────

export type RecoveryLogPage = {
  entries: RecoveryLogEntry[]
  /** True when another page likely exists (a full page was returned). */
  hasMore: boolean
}

/** Fetch one page of recovery-log entries, newest first, starting at `offset`. */
export async function loadRecoveryLogs(
  guildId: string,
  offset: number,
): Promise<ActionResult<RecoveryLogPage>> {
  const auth = await authorize(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const start = Math.max(0, Math.floor(offset))
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('recovery_logs')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .range(start, start + RECOVERY_LOG_PAGE_SIZE - 1)

  if (error) return { ok: false, error: `Failed to load logs: ${error.message}` }
  const rows = (data as Record<string, unknown>[] | null) ?? []
  return {
    ok: true,
    data: {
      entries: rows.map((r) => normaliseLog(r)),
      hasMore: rows.length === RECOVERY_LOG_PAGE_SIZE,
    },
  }
}

// ── Recovery log helper ────────────────────────────────────────────────────────

async function logRecovery(entry: {
  guildId: string
  action: RecoveryAction
  status?: RecoveryStatus
  backupId?: string | null
  backupName?: string | null
  backupType?: string | null
  sectionKeys?: BackupSectionKey[]
  actorId?: string | null
  actorName?: string | null
  detail?: string | null
}) {
  try {
    const supabase = await createClient()
    await supabase.from('recovery_logs').insert({
      guild_id: entry.guildId,
      action: entry.action,
      status: entry.status ?? 'success',
      backup_id: entry.backupId ?? null,
      backup_name: entry.backupName ?? null,
      backup_type: entry.backupType ?? null,
      section_keys: entry.sectionKeys ?? [],
      actor_id: entry.actorId ?? null,
      actor_name: entry.actorName ?? null,
      detail: entry.detail ?? null,
    })
  } catch {
    // Logging is best-effort — never fail the operation because the audit
    // write hiccuped.
  }
}

// ── Capture ──────────────────────────────────────────────────────────────────

/** Build a `sections` snapshot by reading each requested section straight from
 *  where the feature stores it (DB tables) plus the live Discord structure.
 *  Used by manual backups AND by restore-preview (to snapshot the *current*
 *  state for the diff). */
export async function captureSections(
  guildId: string,
  keys: BackupSectionKey[],
): Promise<BackupSections> {
  const supabase = await createClient()
  const sections: BackupSections = {}

  const needsSettings = keys.some((k) => ['automations', 'moderation', 'onboarding'].includes(k))
  const [settingsRow, aiRow, ticketRow, giveawayRows, announcementRows, channels, roles, events] =
    await Promise.all([
      needsSettings
        ? supabase.from('guild_settings').select('settings').eq('guild_id', guildId).maybeSingle()
        : Promise.resolve({ data: null }),
      keys.includes('pulse_guard')
        ? supabase
            .from('ai_moderation_settings')
            .select('enabled, sensitivity, settings')
            .eq('guild_id', guildId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      keys.includes('tickets')
        ? supabase.from('ticket_configs').select('*').eq('guild_id', guildId).maybeSingle()
        : Promise.resolve({ data: null }),
      keys.includes('giveaways')
        ? supabase
            .from('giveaways')
            .select('id, title, prize, description, winner_count, status, requirements, starts_at, ends_at, channel_id')
            .eq('guild_id', guildId)
            .in('status', ['scheduled', 'active'])
        : Promise.resolve({ data: null }),
      keys.includes('announcements')
        ? supabase
            .from('announcements')
            .select('id, title, content, channel_id, status, scheduled_for')
            .eq('guild_id', guildId)
        : Promise.resolve({ data: null }),
      keys.includes('channels') ? fetchGuildChannels(guildId) : Promise.resolve([]),
      keys.includes('roles') ? fetchGuildRoles(guildId) : Promise.resolve([]),
      keys.includes('events') ? fetchGuildEvents(guildId) : Promise.resolve([]),
    ])

  const settings = ((settingsRow?.data as { settings?: Record<string, unknown> } | null)?.settings) ?? {}
  const pick = (obj: Record<string, unknown>, srcKeys: string[]) => {
    const out: Record<string, unknown> = {}
    for (const k of srcKeys) if (obj[k] != null) out[k] = obj[k]
    return out
  }

  for (const key of keys) {
    switch (key) {
      case 'roles': {
        const captured: BackupRole[] = (roles as Awaited<ReturnType<typeof fetchGuildRoles>>)
          .filter((r) => r.id !== guildId && !r.managed)
          .sort((a, b) => b.position - a.position)
          .slice(0, BACKUP_LIMITS.maxRoles)
          .map((r) => ({
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            permissions: r.permissions,
            position: r.position,
          }))
        if (captured.length) sections.roles = captured
        break
      }
      case 'channels': {
        const list = channels as Awaited<ReturnType<typeof fetchGuildChannels>>
        const nameById = new Map(list.map((c) => [c.id, c.name]))
        const captured: BackupChannel[] = list
          .sort((a, b) => a.position - b.position)
          .slice(0, BACKUP_LIMITS.maxChannels)
          .map((c) => ({
            name: c.name,
            type: c.type,
            parent: c.parent_id ? nameById.get(c.parent_id) ?? null : null,
            position: c.position,
            topic: c.topic ?? null,
            nsfw: c.nsfw,
            rate_limit_per_user: c.rate_limit_per_user,
            bitrate: c.bitrate,
            user_limit: c.user_limit,
            overwrites: Array.isArray(c.permission_overwrites) ? c.permission_overwrites.length : 0,
          }))
        if (captured.length) sections.channels = captured
        break
      }
      case 'automations': {
        const v = pick(settings, ['welcome', 'goodbye', 'auto_role'])
        if (Object.keys(v).length) sections.automations = v
        break
      }
      case 'moderation': {
        const v = pick(settings, ['moderation_alerts'])
        if (Object.keys(v).length) sections.moderation = v
        break
      }
      case 'onboarding': {
        const v = pick(settings, ['onboarding', 'member_onboarding'])
        if (Object.keys(v).length) sections.onboarding = v
        break
      }
      case 'pulse_guard': {
        const row = aiRow?.data as
          | { enabled?: boolean; sensitivity?: string; settings?: Record<string, unknown> }
          | null
        if (row) {
          sections.pulse_guard = {
            enabled: row.enabled ?? false,
            sensitivity: row.sensitivity ?? 'medium',
            settings: (row.settings as Record<string, unknown>) ?? {},
          }
        }
        break
      }
      case 'tickets': {
        const row = ticketRow?.data as Record<string, unknown> | null
        if (row) {
          sections.tickets = {
            enabled: row.enabled ?? false,
            panel: row.panel ?? {},
            ticket_types: row.ticket_types ?? [],
            support_role_ids: row.support_role_ids ?? [],
            naming_format: row.naming_format ?? 'ticket-{number}',
            opening_message: row.opening_message ?? null,
            auto_close: row.auto_close ?? {},
            per_user_limit: row.per_user_limit ?? 1,
            ping_support: row.ping_support ?? true,
          }
        }
        break
      }
      case 'giveaways': {
        const rows = (giveawayRows?.data as Record<string, unknown>[] | null) ?? []
        if (rows.length) sections.giveaways = rows
        break
      }
      case 'announcements': {
        const rows = (announcementRows?.data as Record<string, unknown>[] | null) ?? []
        if (rows.length) sections.announcements = rows
        break
      }
      case 'events': {
        const list = (events as Awaited<ReturnType<typeof fetchGuildEvents>>).map((e) => ({
          id: e.id,
          name: e.name,
          description: e.description,
          scheduled_start_time: e.scheduled_start_time,
          scheduled_end_time: e.scheduled_end_time,
          entity_type: e.entity_type,
          location: e.entity_metadata?.location ?? null,
        }))
        if (list.length) sections.events = list
        break
      }
    }
  }

  return sections
}

// ── Create (manual / on-demand) ────────────────────────────────────────────────

export type CreateBackupInput = {
  name: string
  sectionKeys: BackupSectionKey[]
  type?: BackupType
}

/** Next per-guild sequence number ("Backup #N"). */
async function nextVersion(guildId: string): Promise<number> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('server_backups')
    .select('version')
    .eq('guild_id', guildId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (Number((data as { version?: number } | null)?.version ?? 0) || 0) + 1
}

/** Trim the guild's backups down to the hard per-guild cap, oldest first. */
async function enforceBackupCap(guildId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('server_backups')
    .select('id')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
  const rows = (data as { id: string }[] | null) ?? []
  if (rows.length <= BACKUP_LIMITS.maxBackupsPerGuild) return
  const toDelete = rows.slice(BACKUP_LIMITS.maxBackupsPerGuild).map((r) => r.id)
  if (toDelete.length) await supabase.from('server_backups').delete().in('id', toDelete)
}

export async function createBackup(
  guildId: string,
  input: CreateBackupInput,
): Promise<ActionResult<ServerBackup>> {
  const auth = await authorize(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const name = input.name.trim().slice(0, BACKUP_LIMITS.nameMax)
  if (!name) return { ok: false, error: 'Give the backup a name.' }
  const keys = input.sectionKeys.filter((k) => BACKUP_SECTION_KEYS.includes(k))
  if (keys.length === 0) return { ok: false, error: 'Select at least one section to back up.' }

  const sections = await captureSections(guildId, keys)
  if (sectionKeysPresent(sections).length === 0)
    return { ok: false, error: 'None of the selected sections had anything to capture.' }

  const presentKeys = sectionKeysPresent(sections)
  const supabase = await createClient()
  const version = await nextVersion(guildId)
  const { data, error } = await supabase
    .from('server_backups')
    .insert({
      guild_id: guildId,
      name,
      type: input.type ?? 'manual',
      version,
      format_version: CURRENT_BACKUP_VERSION,
      sections,
      section_keys: presentKeys,
      size_bytes: sectionsByteSize(sections),
      created_by: auth.moderator.userId,
      created_by_name: auth.moderator.username,
    })
    .select('*')
    .single()

  if (error || !data)
    return { ok: false, error: `Failed to save backup: ${error?.message ?? 'unknown error'}` }

  await enforceBackupCap(guildId)
  await logRecovery({
    guildId,
    action: 'backup_created',
    backupId: String((data as { id: string }).id),
    backupName: name,
    backupType: input.type ?? 'manual',
    sectionKeys: presentKeys,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: `Captured ${presentKeys.length} section${presentKeys.length === 1 ? '' : 's'}.`,
  })

  revalidate(guildId)
  return { ok: true, data: normaliseBackup(data as Record<string, unknown>) }
}

// ── Import (clone a shared backup into this server's library) ──────────────────

export async function importBackup(
  guildId: string,
  raw: unknown,
): Promise<ActionResult<ServerBackup>> {
  const auth = await authorize(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const parsed = validateBackupImport(raw)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const sections = parsed.value.sections
  const presentKeys = sectionKeysPresent(sections)
  const supabase = await createClient()
  const version = await nextVersion(guildId)
  const { data, error } = await supabase
    .from('server_backups')
    .insert({
      guild_id: guildId,
      name: parsed.value.name,
      type: 'manual',
      version,
      format_version: CURRENT_BACKUP_VERSION,
      sections,
      section_keys: presentKeys,
      size_bytes: sectionsByteSize(sections),
      created_by: auth.moderator.userId,
      created_by_name: auth.moderator.username,
    })
    .select('*')
    .single()

  if (error || !data)
    return { ok: false, error: `Failed to import backup: ${error?.message ?? 'unknown error'}` }

  await enforceBackupCap(guildId)
  await logRecovery({
    guildId,
    action: 'backup_created',
    backupId: String((data as { id: string }).id),
    backupName: parsed.value.name,
    backupType: 'manual',
    sectionKeys: presentKeys,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: parsed.value.sourceGuildName
      ? `Imported from "${parsed.value.sourceGuildName}" — ${presentKeys.length} section${presentKeys.length === 1 ? '' : 's'}.`
      : `Imported — ${presentKeys.length} section${presentKeys.length === 1 ? '' : 's'}.`,
  })

  revalidate(guildId)
  return { ok: true, data: normaliseBackup(data as Record<string, unknown>) }
}

export async function deleteBackup(guildId: string, backupId: string): Promise<ActionResult> {
  const auth = await authorize(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const supabase = await createClient()
  const { data: row } = await supabase
    .from('server_backups')
    .select('name, type')
    .eq('id', backupId)
    .eq('guild_id', guildId)
    .maybeSingle()
  const { error } = await supabase.from('server_backups').delete().eq('id', backupId).eq('guild_id', guildId)
  if (error) return { ok: false, error: `Failed to delete backup: ${error.message}` }
  await logRecovery({
    guildId,
    action: 'backup_deleted',
    backupName: (row as { name?: string } | null)?.name ?? null,
    backupType: (row as { type?: string } | null)?.type ?? null,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
  })
  revalidate(guildId)
  return { ok: true }
}

// ── Schedule + retention ───────────────────────────────────────────────────────

export type ScheduleInput = {
  enabled: boolean
  frequency: BackupFrequency
  retention: number
  sectionKeys: BackupSectionKey[]
}

function computeNextRun(frequency: BackupFrequency, from = new Date()): string {
  const next = new Date(from)
  next.setUTCHours(4, 0, 0, 0) // 04:00 UTC — a quiet hour for the first run
  // Always schedule for the future.
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1)
  if (frequency === 'weekly') {
    // Roll forward to the next 7-day boundary from the daily anchor.
    next.setUTCDate(next.getUTCDate() + 6)
  }
  return next.toISOString()
}

export async function updateSchedule(
  guildId: string,
  input: ScheduleInput,
): Promise<ActionResult> {
  const auth = await authorize(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const frequency: BackupFrequency = input.frequency === 'daily' ? 'daily' : 'weekly'
  const retention = clampRetention(input.retention)
  const keys = input.sectionKeys.filter((k) => BACKUP_SECTION_KEYS.includes(k))
  const sectionKeys = keys.length ? keys : [...BACKUP_SECTION_KEYS]

  const supabase = await createClient()
  const { error } = await supabase.from('backup_schedules').upsert(
    {
      guild_id: guildId,
      enabled: input.enabled,
      frequency,
      retention,
      section_keys: sectionKeys,
      // Only (re)arm the next run when enabling; clear it when disabling.
      next_backup_at: input.enabled ? computeNextRun(frequency) : null,
      updated_at: new Date().toISOString(),
      updated_by: auth.moderator.userId,
    },
    { onConflict: 'guild_id' },
  )
  if (error) return { ok: false, error: `Failed to save schedule: ${error.message}` }

  await logRecovery({
    guildId,
    action: 'schedule_updated',
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: input.enabled
      ? `Automatic ${frequency} backups on · keep ${retention}.`
      : 'Automatic backups turned off.',
  })
  revalidate(guildId)
  return { ok: true }
}

// ── Compare two backups ──────────────────────────────────────────────────────

export type CompareResult = {
  diff: BackupDiff
  base: { id: string; name: string; version: number; createdAt: string }
  target: { id: string; name: string; version: number; createdAt: string }
}

async function loadBackup(guildId: string, id: string): Promise<ServerBackup | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('server_backups')
    .select('*')
    .eq('id', id)
    .eq('guild_id', guildId)
    .maybeSingle()
  return data ? normaliseBackup(data as Record<string, unknown>) : null
}

export async function compareBackups(
  guildId: string,
  baseId: string,
  targetId: string,
): Promise<ActionResult<CompareResult>> {
  const auth = await authorize(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }
  if (baseId === targetId) return { ok: false, error: 'Pick two different backups to compare.' }

  const [base, target] = await Promise.all([loadBackup(guildId, baseId), loadBackup(guildId, targetId)])
  if (!base || !target) return { ok: false, error: 'One of the backups could not be found.' }

  return {
    ok: true,
    data: {
      diff: diffSections(base.sections, target.sections),
      base: { id: base.id, name: base.name, version: base.version, createdAt: base.createdAt },
      target: { id: target.id, name: target.name, version: target.version, createdAt: target.createdAt },
    },
  }
}

// ── Restore preview (diff backup → live) ────────────────────────────────────────

export type RestorePreview = {
  diff: BackupDiff
  /** Restorable section keys present in the backup (what the wizard can toggle). */
  restorableKeys: BackupSectionKey[]
  /** Snapshot-only keys present in the backup (shown but not restorable). */
  snapshotOnlyKeys: BackupSectionKey[]
  warnings: string[]
}

export async function previewRestore(
  guildId: string,
  backupId: string,
  sectionKeys: BackupSectionKey[],
  pruneExtras = false,
): Promise<ActionResult<RestorePreview>> {
  const auth = await authorize(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const backup = await loadBackup(guildId, backupId)
  if (!backup) return { ok: false, error: 'Backup not found.' }

  const present = sectionKeysPresent(backup.sections)
  const restorableKeys = present.filter(isRestorable)
  const snapshotOnlyKeys = present.filter((k) => !isRestorable(k))

  // The diff only covers the sections the user actually intends to restore (and
  // only restorable ones) — that's what "changes that will occur" means here.
  const requested = sectionKeys.filter((k) => restorableKeys.includes(k))
  const keys = requested.length ? requested : restorableKeys
  if (keys.length === 0)
    return { ok: false, error: 'This backup has no sections that can be restored.' }

  // Snapshot the CURRENT live + DB state for those sections, then diff
  // backup→live so the preview reads as "what restoring would do".
  const live = await captureSections(guildId, keys)
  const subset = (sections: BackupSections): BackupSections => {
    const out: BackupSections = {}
    for (const k of keys) if (sections[k] != null) (out as Record<string, unknown>)[k] = sections[k]
    return out
  }
  const diff = diffSections(subset(backup.sections), live)

  const warnings: string[] = []
  const touchesStructure = keys.includes('roles') || keys.includes('channels')
  // Only roles/channels are actually deleted by the prune — config sections are
  // merged, never key-deleted — so count those sections' "removed" specifically.
  const structuralRemoved = diff.sections
    .filter((s) => s.key === 'roles' || s.key === 'channels')
    .reduce((n, s) => n + s.removed.length, 0)
  if (touchesStructure && !pruneExtras)
    warnings.push('Restore only creates missing roles/channels — it never deletes existing ones. New roles are created at the bottom with no permissions; reorder and grant access afterwards.')
  if (touchesStructure && pruneExtras && structuralRemoved > 0)
    warnings.push(`"Remove extras" is on: ${structuralRemoved} role/channel${structuralRemoved === 1 ? '' : 's'} marked "Only live" (not in this backup) WILL BE DELETED. Deleting a channel also deletes its messages — this cannot be undone.`)
  if (diff.totals.modified > 0)
    warnings.push(`${diff.totals.modified} setting${diff.totals.modified === 1 ? '' : 's'} differ from the backup and will be overwritten.`)

  return { ok: true, data: { diff, restorableKeys, snapshotOnlyKeys, warnings } }
}

// ── Restore (additive-safe) ────────────────────────────────────────────────────

export type RestoreSummary = {
  applied: { key: BackupSectionKey; label: string; detail: string }[]
  warnings: string[]
}

const CREATABLE_TYPES = new Set<number>([
  CHANNEL_TYPES.TEXT,
  CHANNEL_TYPES.VOICE,
  CHANNEL_TYPES.CATEGORY,
  CHANNEL_TYPES.ANNOUNCEMENT,
  CHANNEL_TYPES.STAGE,
  CHANNEL_TYPES.FORUM,
  CHANNEL_TYPES.MEDIA,
])

export async function restoreBackup(
  guildId: string,
  backupId: string,
  sectionKeys: BackupSectionKey[],
  pruneExtras = false,
): Promise<ActionResult<RestoreSummary>> {
  const auth = await authorize(guildId)
  if (!auth.ok) return { ok: false, error: auth.error }

  const backup = await loadBackup(guildId, backupId)
  if (!backup) return { ok: false, error: 'Backup not found.' }

  const present = sectionKeysPresent(backup.sections)
  const keys = sectionKeys.filter((k) => present.includes(k) && isRestorable(k))
  if (keys.length === 0) return { ok: false, error: 'Select at least one restorable section.' }

  const supabase = await createClient()
  const applied: RestoreSummary['applied'] = []
  const warnings: string[] = []

  // Target server's id sets, for reference sanitisation + duplicate detection.
  const needsRefs = keys.some((k) => ['automations', 'moderation', 'pulse_guard', 'tickets', 'channels'].includes(k))
  const needsRoles = keys.some((k) => ['automations', 'pulse_guard', 'tickets', 'roles'].includes(k))
  const [channels, roles] = await Promise.all([
    needsRefs || keys.includes('channels') ? fetchGuildChannels(guildId) : Promise.resolve([]),
    needsRoles ? fetchGuildRoles(guildId) : Promise.resolve([]),
  ])
  const channelIds = new Set(channels.map((c) => c.id))
  const roleIds = new Set(roles.map((r) => r.id))
  const keepRoleList = (ids: unknown): string[] =>
    Array.isArray(ids)
      ? ((ids as unknown[]).filter((id) => typeof id === 'string' && roleIds.has(id)) as string[])
      : []

  let droppedRefs = 0
  const sanitiseChannel = (obj: Record<string, unknown> | undefined, field = 'channel_id') => {
    if (!obj || typeof obj[field] !== 'string' || !obj[field]) return
    if (!channelIds.has(obj[field] as string)) {
      obj[field] = ''
      droppedRefs++
    }
  }

  try {
    // ── guild_settings-backed sections (automations / moderation / onboarding) ──
    const settingsKeys = keys.filter((k) => ['automations', 'moderation', 'onboarding'].includes(k))
    if (settingsKeys.length) {
      const { data: existing } = await supabase
        .from('guild_settings')
        .select('settings')
        .eq('guild_id', guildId)
        .maybeSingle()
      const merged: Record<string, unknown> = { ...((existing?.settings as Record<string, unknown>) ?? {}) }

      for (const key of settingsKeys) {
        const block = JSON.parse(JSON.stringify(backup.sections[key] ?? {})) as Record<string, unknown>
        if (key === 'automations') {
          sanitiseChannel(block.welcome as Record<string, unknown> | undefined)
          sanitiseChannel(block.goodbye as Record<string, unknown> | undefined)
          const autoRole = block.auto_role as Record<string, unknown> | undefined
          if (autoRole && typeof autoRole.role_id === 'string' && autoRole.role_id && !roleIds.has(autoRole.role_id)) {
            autoRole.role_id = ''
            autoRole.enabled = false
            droppedRefs++
          }
        } else if (key === 'moderation') {
          sanitiseChannel(block.moderation_alerts as Record<string, unknown> | undefined)
        }
        Object.assign(merged, block)
        const n = Object.keys(block).length
        applied.push({
          key,
          label: SECTION_META[key].label,
          detail: `${n} setting${n === 1 ? '' : 's'} restored`,
        })
      }

      const { error } = await supabase
        .from('guild_settings')
        .upsert({ guild_id: guildId, settings: merged, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
      if (error) throw new Error(`settings: ${error.message}`)
    }

    // ── Pulse Guard ──
    if (keys.includes('pulse_guard') && backup.sections.pulse_guard) {
      const pg = JSON.parse(JSON.stringify(backup.sections.pulse_guard)) as {
        enabled?: boolean
        sensitivity?: string
        settings?: Record<string, unknown>
      }
      const s = (pg.settings ?? {}) as Record<string, unknown>
      if (typeof s.alert_channel_id === 'string' && !channelIds.has(s.alert_channel_id)) {
        s.alert_channel_id = null
        droppedRefs++
      }
      s.whitelisted_role_ids = keepRoleList(s.whitelisted_role_ids)
      s.ignored_channel_ids = Array.isArray(s.ignored_channel_ids)
        ? (s.ignored_channel_ids as unknown[]).filter((id) => typeof id === 'string' && channelIds.has(id))
        : []
      s.whitelisted_user_ids = Array.isArray(s.whitelisted_user_ids) ? s.whitelisted_user_ids : []

      const { error } = await supabase.from('ai_moderation_settings').upsert(
        {
          guild_id: guildId,
          enabled: pg.enabled ?? false,
          sensitivity: pg.sensitivity ?? 'medium',
          settings: s,
          updated_by: auth.moderator.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'guild_id' },
      )
      if (error) throw new Error(`pulse_guard: ${error.message}`)
      applied.push({
        key: 'pulse_guard',
        label: SECTION_META.pulse_guard.label,
        detail: pg.enabled ? 'Restored (enabled)' : 'Restored (disabled)',
      })
    }

    // ── Tickets ──
    if (keys.includes('tickets') && backup.sections.tickets) {
      const t = JSON.parse(JSON.stringify(backup.sections.tickets)) as Record<string, unknown>
      const supportRoles = keepRoleList(t.support_role_ids)
      const { error } = await supabase.from('ticket_configs').upsert(
        {
          guild_id: guildId,
          enabled: t.enabled === true,
          panel: t.panel ?? {},
          ticket_types: t.ticket_types ?? [],
          support_role_ids: supportRoles,
          naming_format: typeof t.naming_format === 'string' ? t.naming_format : 'ticket-{number}',
          opening_message: (t.opening_message as string | null) ?? null,
          auto_close: t.auto_close ?? {},
          per_user_limit: Number(t.per_user_limit ?? 1),
          ping_support: t.ping_support !== false,
          updated_by: auth.moderator.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'guild_id' },
      )
      if (error) throw new Error(`tickets: ${error.message}`)
      const typeCount = Array.isArray(t.ticket_types) ? t.ticket_types.length : 0
      applied.push({
        key: 'tickets',
        label: SECTION_META.tickets.label,
        detail: `Panel + ${typeCount} type${typeCount === 1 ? '' : 's'}`,
      })
    }

    // ── Roles (additive create missing by name) ──
    if (keys.includes('roles') && Array.isArray(backup.sections.roles)) {
      const botTop = await getBotHighestRolePosition(guildId)
      const existingNames = new Set(roles.map((r) => r.name.toLowerCase()))
      let created = 0
      let skipped = 0
      let failed = 0
      // Lowest position first so the created order roughly mirrors the backup.
      for (const r of [...backup.sections.roles].sort((a, b) => a.position - b.position)) {
        if (existingNames.has(r.name.toLowerCase())) {
          skipped++
          continue
        }
        const res = await createGuildRole(
          guildId,
          {
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            mentionable: r.mentionable,
            // Safe-by-default: don't blindly re-grant captured permission bits.
            permissions: '0',
          },
          `Restored from backup "${backup.name}"`,
        )
        if (res.ok) {
          created++
          existingNames.add(r.name.toLowerCase())
        } else {
          failed++
        }
      }
      // Opt-in: delete live roles that aren't in the backup (a true "revert").
      // Only roles below the bot's hierarchy line, never @everyone or
      // integration/bot-managed roles.
      let removed = 0
      let removeFailed = 0
      if (pruneExtras) {
        const backupNames = new Set(backup.sections.roles.map((r) => r.name.toLowerCase()))
        for (const r of roles) {
          if (r.id === guildId || r.managed) continue
          if (botTop != null && r.position >= botTop) continue
          if (backupNames.has(r.name.toLowerCase())) continue
          const res = await deleteGuildRole(guildId, r.id, `Restore (remove extras) from backup "${backup.name}"`)
          if (res.ok) removed++
          else removeFailed++
        }
      }

      const parts: string[] = []
      if (created) parts.push(`${created} created`)
      if (removed) parts.push(`${removed} removed`)
      if (skipped) parts.push(`${skipped} already existed`)
      if (failed || removeFailed) parts.push(`${failed + removeFailed} failed`)
      applied.push({ key: 'roles', label: SECTION_META.roles.label, detail: parts.join(', ') || 'No changes' })
      if (failed)
        warnings.push(`${failed} role${failed === 1 ? '' : 's'} could not be created — check the bot's role position and permissions.`)
      if (removeFailed)
        warnings.push(`${removeFailed} extra role${removeFailed === 1 ? '' : 's'} could not be deleted — they may sit above the bot's highest role.`)
      if (created)
        warnings.push('New roles were created at the bottom of the list with no permissions — reorder and grant access as needed.')
      if (botTop == null) warnings.push("Couldn't confirm the bot's role position; some roles may not have been created or removed.")
    }

    // ── Channels & categories (additive create missing by name) ──
    if (keys.includes('channels') && Array.isArray(backup.sections.channels)) {
      const all = backup.sections.channels
      // Map existing category NAME → id so we can re-parent restored channels.
      const categoryIdByName = new Map<string, string>()
      for (const c of channels) {
        if (c.type === CHANNEL_TYPES.CATEGORY) categoryIdByName.set(c.name.toLowerCase(), c.id)
      }
      // Existing channel identity = name + type (avoids clobbering a text vs voice
      // channel that share a name).
      const existingKey = new Set(channels.map((c) => `${c.name.toLowerCase()}::${c.type}`))

      let created = 0
      let skipped = 0
      let failed = 0
      const createChannel = async (c: BackupChannel, parentId: string | null) => {
        if (!CREATABLE_TYPES.has(c.type)) {
          skipped++
          return
        }
        if (existingKey.has(`${c.name.toLowerCase()}::${c.type}`)) {
          skipped++
          return
        }
        const res = await createGuildChannel(
          guildId,
          {
            name: c.name,
            type: c.type as CreatableChannelType,
            parent_id: parentId,
            topic: c.topic ?? undefined,
            nsfw: c.nsfw,
            rate_limit_per_user: c.rate_limit_per_user,
            bitrate: c.bitrate,
            user_limit: c.user_limit,
          },
          `Restored from backup "${backup.name}"`,
        )
        if (res.ok) {
          created++
          existingKey.add(`${c.name.toLowerCase()}::${c.type}`)
          if (c.type === CHANNEL_TYPES.CATEGORY) categoryIdByName.set(c.name.toLowerCase(), res.channel.id)
        } else {
          failed++
        }
      }

      // Categories first so children can be parented to freshly-created ones.
      for (const c of all.filter((c) => c.type === CHANNEL_TYPES.CATEGORY).sort((a, b) => a.position - b.position)) {
        await createChannel(c, null)
      }
      for (const c of all.filter((c) => c.type !== CHANNEL_TYPES.CATEGORY).sort((a, b) => a.position - b.position)) {
        const parentId = c.parent ? categoryIdByName.get(c.parent.toLowerCase()) ?? null : null
        await createChannel(c, parentId)
      }

      // Opt-in: delete live channels/categories not in the backup. Non-category
      // channels first so a removed category doesn't orphan its children mid-run.
      let removed = 0
      let removeFailed = 0
      if (pruneExtras) {
        const backupKeys = new Set(all.map((c) => `${c.name.toLowerCase()}::${c.type}`))
        const isExtra = (c: (typeof channels)[number]) =>
          !backupKeys.has(`${c.name.toLowerCase()}::${c.type}`)
        const ordered = [
          ...channels.filter((c) => c.type !== CHANNEL_TYPES.CATEGORY && isExtra(c)),
          ...channels.filter((c) => c.type === CHANNEL_TYPES.CATEGORY && isExtra(c)),
        ]
        for (const c of ordered) {
          const res = await deleteChannel(c.id, `Restore (remove extras) from backup "${backup.name}"`)
          if (res.ok) removed++
          else removeFailed++
        }
      }

      const parts: string[] = []
      if (created) parts.push(`${created} created`)
      if (removed) parts.push(`${removed} removed`)
      if (skipped) parts.push(`${skipped} already existed`)
      if (failed || removeFailed) parts.push(`${failed + removeFailed} failed`)
      applied.push({ key: 'channels', label: SECTION_META.channels.label, detail: parts.join(', ') || 'No changes' })
      if (failed)
        warnings.push(`${failed} channel${failed === 1 ? '' : 's'} could not be created — check the bot's permissions.`)
      if (removeFailed)
        warnings.push(`${removeFailed} extra channel${removeFailed === 1 ? '' : 's'} could not be deleted — check the bot's permissions.`)
      if (removed)
        warnings.push(`${removed} channel${removed === 1 ? '' : 's'} not in the backup ${removed === 1 ? 'was' : 'were'} deleted, along with any messages in them.`)
      if (created)
        warnings.push('Restored channels were created empty (no messages or permission overwrites) — set channel permissions afterwards.')
    }

    if (droppedRefs > 0)
      warnings.push(`${droppedRefs} channel/role reference${droppedRefs === 1 ? '' : 's'} no longer exist and ${droppedRefs === 1 ? 'was' : 'were'} cleared — reselect them in each feature.`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error'
    await logRecovery({
      guildId,
      action: 'restore',
      status: 'failure',
      backupId: backup.id,
      backupName: backup.name,
      backupType: backup.type,
      sectionKeys: keys,
      actorId: auth.moderator.userId,
      actorName: auth.moderator.username,
      detail: `Restore failed: ${detail}`,
    })
    return { ok: false, error: `Restore failed while applying ${detail}. Some sections may have been partially restored.` }
  }

  await logRecovery({
    guildId,
    action: 'restore',
    status: warnings.length ? 'partial' : 'success',
    backupId: backup.id,
    backupName: backup.name,
    backupType: backup.type,
    sectionKeys: keys,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    detail: applied.map((a) => `${a.label}: ${a.detail}`).join(' · '),
  })

  await recordNotification({
    guildId,
    type: 'server_settings_changed',
    severity: 'info',
    title: `Restored from backup "${backup.name}"`,
    body: `${applied.map((a) => a.label).join(', ')} restored.`,
    link: `/dashboard/${guildId}/backups`,
    actorId: auth.moderator.userId,
    actorName: auth.moderator.username,
    actorUsername: auth.moderator.handle,
  })

  revalidate(guildId)
  return { ok: true, data: { applied, warnings } }
}

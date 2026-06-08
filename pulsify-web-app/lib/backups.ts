// Server Recovery & Backup System (PULSIFY-42) — shared types, the section
// catalog, and the pure helpers that summarise, size and DIFF backups. No
// server-only or JSX imports live here so it can be pulled into client
// components, server actions and (mirrored) the bot alike — same stance as
// lib/templates.ts / lib/command-palette.ts (icons are lucide names, resolved
// in the UI).
//
// A *backup* is a versioned, point-in-time snapshot of selected configuration
// *sections* captured from a server. The section keys map to where each feature
// actually stores its config (see the capture/apply paths in the route's
// actions.ts and the bot's backups.js):
//   • roles         → live Discord role structure
//   • channels      → live channels + categories (incl. permission overwrites)
//   • automations   → guild_settings.settings { welcome, goodbye, auto_role }
//   • moderation    → guild_settings.settings { moderation_alerts }
//   • onboarding    → guild_settings.settings { onboarding, member_onboarding }
//   • pulse_guard   → ai_moderation_settings
//   • tickets       → ticket_configs
//   • giveaways     → giveaways rows         (snapshot — not auto-restored)
//   • events        → Discord scheduled events (snapshot — not auto-restored)
//   • announcements → announcements rows     (snapshot — not auto-restored)
//
// Restore is ADDITIVE-SAFE: config sections are written back to the tables the
// bot reads, and missing roles/channels are created via the Discord REST API.
// Restore never deletes live resources — the "removed" items a diff surfaces are
// informational only.

// ── Sections ─────────────────────────────────────────────────────────────────

export const BACKUP_SECTION_KEYS = [
  'roles',
  'channels',
  'automations',
  'moderation',
  'onboarding',
  'pulse_guard',
  'tickets',
  'giveaways',
  'events',
  'announcements',
] as const

export type BackupSectionKey = (typeof BACKUP_SECTION_KEYS)[number]

/** Sections a restore can safely write back. Config sections upsert into their
 *  tables; roles/channels are additively created by name. The rest (giveaways,
 *  events, announcements) are time-sensitive live objects captured for the
 *  record, comparison and disaster documentation — never auto-restored. */
export const RESTORABLE_SECTION_KEYS: BackupSectionKey[] = [
  'roles',
  'channels',
  'automations',
  'moderation',
  'onboarding',
  'pulse_guard',
  'tickets',
]

export function isRestorable(key: BackupSectionKey): boolean {
  return RESTORABLE_SECTION_KEYS.includes(key)
}

export const SECTION_META: Record<
  BackupSectionKey,
  {
    label: string
    description: string
    icon: string
    accent: string
    /** Where the section is read from / written to. */
    source: 'discord' | 'database'
  }
> = {
  roles: {
    label: 'Roles',
    description: 'Role names, colours, permissions & display options.',
    icon: 'Users',
    accent: '#a855f7',
    source: 'discord',
  },
  channels: {
    label: 'Channels & categories',
    description: 'Channel structure, categories, topics & permission overwrites.',
    icon: 'Hash',
    accent: '#22d3ee',
    source: 'discord',
  },
  automations: {
    label: 'Automations',
    description: 'Welcome & goodbye messages and auto-role assignment.',
    icon: 'Zap',
    accent: '#f59e0b',
    source: 'database',
  },
  moderation: {
    label: 'Moderation',
    description: 'Moderation alert routing for mod actions.',
    icon: 'Shield',
    accent: '#f87171',
    source: 'database',
  },
  onboarding: {
    label: 'Onboarding',
    description: 'Member onboarding & welcome screen configuration.',
    icon: 'Compass',
    accent: '#34d399',
    source: 'database',
  },
  pulse_guard: {
    label: 'Pulse Guard',
    description: 'AI moderation detectors, sensitivity & auto-actions.',
    icon: 'ShieldAlert',
    accent: '#ef4444',
    source: 'database',
  },
  tickets: {
    label: 'Tickets',
    description: 'Support ticket panel, types, auto-close & limits.',
    icon: 'LifeBuoy',
    accent: '#34d399',
    source: 'database',
  },
  giveaways: {
    label: 'Giveaways',
    description: 'Active giveaway configuration (snapshot for the record).',
    icon: 'Gift',
    accent: '#ec4899',
    source: 'database',
  },
  events: {
    label: 'Events',
    description: 'Scheduled server events (snapshot for the record).',
    icon: 'CalendarDays',
    accent: '#8b5cf6',
    source: 'discord',
  },
  announcements: {
    label: 'Announcements',
    description: 'Saved & scheduled announcements (snapshot for the record).',
    icon: 'Megaphone',
    accent: '#f59e0b',
    source: 'database',
  },
}

// ── Backup types ───────────────────────────────────────────────────────────────

export const BACKUP_TYPES = ['manual', 'daily', 'weekly'] as const
export type BackupType = (typeof BACKUP_TYPES)[number]

export const BACKUP_TYPE_META: Record<BackupType, { label: string; icon: string; accent: string }> = {
  manual: { label: 'Manual', icon: 'Hand', accent: 'var(--text-2)' },
  daily: { label: 'Daily', icon: 'CalendarClock', accent: '#22d3ee' },
  weekly: { label: 'Weekly', icon: 'CalendarRange', accent: '#8b5cf6' },
}

export const BACKUP_FREQUENCIES = ['daily', 'weekly'] as const
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number]

export const BACKUP_LIMITS = {
  nameMax: 80,
  maxRoles: 100,
  maxChannels: 200,
  /** Hard cap on stored backups per guild (manual + scheduled) to bound storage. */
  maxBackupsPerGuild: 50,
  retentionMin: 1,
  retentionMax: 30,
} as const

export const DEFAULT_RETENTION = 10

/** Recovery-log page size — the Logs tab shows this many, then "Load more". */
export const RECOVERY_LOG_PAGE_SIZE = 25

/** Bumped if the captured envelope shape changes — import/compare checks it. */
export const CURRENT_BACKUP_VERSION = 1

// ── Captured shapes ────────────────────────────────────────────────────────────

/** A role captured for the role-structure section. IDs are intentionally not
 *  stored — additive restore matches/creates by name, so a backup stays portable
 *  and ID-churn-proof. */
export type BackupRole = {
  name: string
  /** Decimal RGB int (0 = no colour). */
  color: number
  hoist: boolean
  mentionable: boolean
  /** Discord permission bitfield as a decimal string. */
  permissions: string
  position: number
}

/** A channel/category captured for the channel-structure section. Parent is the
 *  category *name* (portable); restore re-parents by matching the name. */
export type BackupChannel = {
  name: string
  /** Discord channel-type id (0 text, 2 voice, 4 category, …). */
  type: number
  parent: string | null
  position: number
  topic?: string | null
  nsfw?: boolean
  rate_limit_per_user?: number
  bitrate?: number
  user_limit?: number
  /** Count of permission overwrites (kept for the summary; not re-applied). */
  overwrites?: number
}

/** The captured configuration, keyed by section. Absent key = not captured.
 *  Config payloads are stored loosely (the feature owns the precise shape);
 *  restore merges them straight back into the feature's storage. */
export type BackupSections = {
  roles?: BackupRole[]
  channels?: BackupChannel[]
  automations?: Record<string, unknown>
  moderation?: Record<string, unknown>
  onboarding?: Record<string, unknown>
  pulse_guard?: { enabled?: boolean; sensitivity?: string; settings?: Record<string, unknown> }
  tickets?: Record<string, unknown>
  giveaways?: Array<Record<string, unknown>>
  events?: Array<Record<string, unknown>>
  announcements?: Array<Record<string, unknown>>
}

export type ServerBackup = {
  id: string
  guildId: string
  name: string
  type: BackupType
  version: number
  formatVersion: number
  sections: BackupSections
  sectionKeys: BackupSectionKey[]
  sizeBytes: number
  createdBy: string | null
  createdByName: string | null
  createdAt: string
}

export type BackupSchedule = {
  guildId: string
  enabled: boolean
  frequency: BackupFrequency
  retention: number
  sectionKeys: BackupSectionKey[]
  lastBackupAt: string | null
  nextBackupAt: string | null
}

export const RECOVERY_ACTIONS = [
  'backup_created',
  'restore',
  'backup_deleted',
  'backup_pruned',
  'schedule_updated',
] as const
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number]
export type RecoveryStatus = 'success' | 'failure' | 'partial'

export type RecoveryLogEntry = {
  id: string
  guildId: string
  action: RecoveryAction
  status: RecoveryStatus
  backupId: string | null
  backupName: string | null
  backupType: string | null
  sectionKeys: BackupSectionKey[]
  actorId: string | null
  actorName: string | null
  detail: string | null
  createdAt: string
}

// ── Normalisation (DB row → typed) ────────────────────────────────────────────

function asType(v: unknown): BackupType {
  return BACKUP_TYPES.includes(v as BackupType) ? (v as BackupType) : 'manual'
}

function asSectionKeys(v: unknown): BackupSectionKey[] {
  if (!Array.isArray(v)) return []
  return v.filter((k): k is BackupSectionKey => BACKUP_SECTION_KEYS.includes(k as BackupSectionKey))
}

export function normaliseBackup(row: Record<string, unknown>): ServerBackup {
  const sections = (row.sections as BackupSections | null) ?? {}
  return {
    id: String(row.id),
    guildId: String(row.guild_id ?? ''),
    name: String(row.name ?? 'Untitled backup'),
    type: asType(row.type),
    version: Number(row.version ?? 1),
    formatVersion: Number(row.format_version ?? CURRENT_BACKUP_VERSION),
    sections,
    sectionKeys: asSectionKeys(row.section_keys).length
      ? asSectionKeys(row.section_keys)
      : sectionKeysPresent(sections),
    sizeBytes: Number(row.size_bytes ?? 0),
    createdBy: (row.created_by as string | null) ?? null,
    createdByName: (row.created_by_name as string | null) ?? null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  }
}

export function normaliseSchedule(row: Record<string, unknown> | null, guildId: string): BackupSchedule {
  if (!row) {
    return {
      guildId,
      enabled: false,
      frequency: 'weekly',
      retention: DEFAULT_RETENTION,
      sectionKeys: [...BACKUP_SECTION_KEYS],
      lastBackupAt: null,
      nextBackupAt: null,
    }
  }
  const keys = asSectionKeys(row.section_keys)
  return {
    guildId: String(row.guild_id ?? guildId),
    enabled: row.enabled === true,
    frequency: BACKUP_FREQUENCIES.includes(row.frequency as BackupFrequency)
      ? (row.frequency as BackupFrequency)
      : 'weekly',
    retention: clampRetention(Number(row.retention ?? DEFAULT_RETENTION)),
    sectionKeys: keys.length ? keys : [...BACKUP_SECTION_KEYS],
    lastBackupAt: (row.last_backup_at as string | null) ?? null,
    nextBackupAt: (row.next_backup_at as string | null) ?? null,
  }
}

export function normaliseLog(row: Record<string, unknown>): RecoveryLogEntry {
  const action = RECOVERY_ACTIONS.includes(row.action as RecoveryAction)
    ? (row.action as RecoveryAction)
    : 'restore'
  const status: RecoveryStatus =
    row.status === 'failure' || row.status === 'partial' ? (row.status as RecoveryStatus) : 'success'
  return {
    id: String(row.id),
    guildId: String(row.guild_id ?? ''),
    action,
    status,
    backupId: (row.backup_id as string | null) ?? null,
    backupName: (row.backup_name as string | null) ?? null,
    backupType: (row.backup_type as string | null) ?? null,
    sectionKeys: asSectionKeys(row.section_keys),
    actorId: (row.actor_id as string | null) ?? null,
    actorName: (row.actor_name as string | null) ?? null,
    detail: (row.detail as string | null) ?? null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
  }
}

export function clampRetention(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RETENTION
  return Math.max(BACKUP_LIMITS.retentionMin, Math.min(BACKUP_LIMITS.retentionMax, Math.round(n)))
}

// ── Presence / sizing ──────────────────────────────────────────────────────────

/** Which sections actually carry data in a backup. */
export function sectionKeysPresent(sections: BackupSections): BackupSectionKey[] {
  return BACKUP_SECTION_KEYS.filter((k) => {
    const v = sections[k]
    if (v == null) return false
    if (Array.isArray(v)) return v.length > 0
    return Object.keys(v as Record<string, unknown>).length > 0
  })
}

/** Item count for a section (roles/channels/collections = length; config = key count). */
export function sectionItemCount(key: BackupSectionKey, value: unknown): number {
  if (value == null) return 0
  if (Array.isArray(value)) return value.length
  return Object.keys(value as Record<string, unknown>).length
}

/** Byte size of the serialised sections blob — drives the "backup size" column. */
export function sectionsByteSize(sections: BackupSections): number {
  try {
    // TextEncoder isn't available in every runtime we share this with; fall back
    // to the string length (close enough for a display estimate).
    const json = JSON.stringify(sections)
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length
    return json.length
  } catch {
    return 0
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
}

// ── Per-section human summaries (for cards / previews) ─────────────────────────

function bool(v: unknown): boolean {
  return v === true
}

/** A short, human bullet list describing what a section contains. Pure & best
 *  effort — reads the known keys but never throws on an unexpected shape. */
export function summarizeSection(key: BackupSectionKey, value: unknown): string[] {
  const out: string[] = []
  const v = (value ?? {}) as Record<string, unknown>
  try {
    switch (key) {
      case 'roles': {
        const roles = (value as BackupRole[] | undefined) ?? []
        out.push(`${roles.length} role${roles.length === 1 ? '' : 's'}`)
        const hoisted = roles.filter((r) => r.hoist).length
        if (hoisted) out.push(`${hoisted} shown separately`)
        break
      }
      case 'channels': {
        const channels = (value as BackupChannel[] | undefined) ?? []
        const categories = channels.filter((c) => c.type === 4).length
        out.push(`${channels.length - categories} channel${channels.length - categories === 1 ? '' : 's'}`)
        if (categories) out.push(`${categories} categor${categories === 1 ? 'y' : 'ies'}`)
        break
      }
      case 'automations': {
        const welcome = v.welcome as Record<string, unknown> | undefined
        const goodbye = v.goodbye as Record<string, unknown> | undefined
        const autoRole = v.auto_role as Record<string, unknown> | undefined
        out.push(`Welcome ${bool(welcome?.enabled) ? 'on' : 'off'}`)
        out.push(`Goodbye ${bool(goodbye?.enabled) ? 'on' : 'off'}`)
        out.push(`Auto-role ${bool(autoRole?.enabled) ? 'on' : 'off'}`)
        break
      }
      case 'moderation': {
        const alerts = v.moderation_alerts as Record<string, unknown> | undefined
        out.push(`Mod alerts ${bool(alerts?.enabled) ? 'enabled' : 'disabled'}`)
        break
      }
      case 'onboarding': {
        const ob = (v.onboarding ?? v.member_onboarding) as Record<string, unknown> | undefined
        out.push(`Onboarding ${bool(ob?.enabled) ? 'enabled' : 'configured'}`)
        break
      }
      case 'pulse_guard': {
        out.push(`Pulse Guard ${bool(v.enabled) ? 'enabled' : 'disabled'}`)
        if (v.sensitivity) out.push(`Sensitivity: ${String(v.sensitivity)}`)
        const settings = v.settings as Record<string, unknown> | undefined
        const cats = (settings?.categories as Record<string, { enabled?: boolean }> | undefined) ?? {}
        const active = Object.values(cats).filter((c) => c?.enabled).length
        if (active) out.push(`${active} detectors active`)
        break
      }
      case 'tickets': {
        out.push(`Ticket system ${bool(v.enabled) ? 'enabled' : 'configured'}`)
        const types = (v.ticket_types as unknown[] | undefined) ?? []
        if (types.length) out.push(`${types.length} ticket type${types.length === 1 ? '' : 's'}`)
        break
      }
      case 'giveaways': {
        const list = (value as unknown[] | undefined) ?? []
        out.push(`${list.length} giveaway${list.length === 1 ? '' : 's'}`)
        break
      }
      case 'events': {
        const list = (value as unknown[] | undefined) ?? []
        out.push(`${list.length} scheduled event${list.length === 1 ? '' : 's'}`)
        break
      }
      case 'announcements': {
        const list = (value as unknown[] | undefined) ?? []
        out.push(`${list.length} announcement${list.length === 1 ? '' : 's'}`)
        break
      }
    }
  } catch {
    // Unknown/legacy shape — fall through to the generic line below.
  }
  if (out.length === 0) out.push('Captured')
  return out
}

// ── Diffing (powers Backup Comparison + Restore Preview) ───────────────────────

export type SectionDiff = {
  key: BackupSectionKey
  /** In `base`, missing from `target`. For restore-preview (base=backup,
   *  target=live) these are resources/settings the restore would ADD. */
  added: string[]
  /** In `target`, missing from `base`. For restore-preview these exist live but
   *  aren't in the backup — informational only (additive restore won't delete). */
  removed: string[]
  /** Present in both but differing — restore would UPDATE these. */
  modified: string[]
  /** Items identical in both. */
  unchanged: number
}

export type BackupDiff = {
  sections: SectionDiff[]
  totals: { added: number; removed: number; modified: number }
}

/** Stable JSON for deep-equality that ignores key order. */
function stable(value: unknown): string {
  const seen = new WeakSet()
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v as object)) return null
    seen.add(v as object)
    if (Array.isArray(v)) return v.map(norm)
    const obj = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) out[k] = norm(obj[k])
    return out
  }
  try {
    return JSON.stringify(norm(value))
  } catch {
    return ''
  }
}

function equal(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

/** Diff two keyed maps of items into added/removed/modified label lists. */
function diffKeyed(
  base: Map<string, unknown>,
  target: Map<string, unknown>,
): Omit<SectionDiff, 'key'> {
  const added: string[] = []
  const removed: string[] = []
  const modified: string[] = []
  let unchanged = 0
  for (const [label, val] of base) {
    if (!target.has(label)) added.push(label)
    else if (!equal(val, target.get(label))) modified.push(label)
    else unchanged++
  }
  for (const label of target.keys()) {
    if (!base.has(label)) removed.push(label)
  }
  added.sort()
  removed.sort()
  modified.sort()
  return { added, removed, modified, unchanged }
}

/** How each section's value is keyed for diffing. Collections key by a portable
 *  label; config objects key by their top-level setting names. */
function sectionToMap(key: BackupSectionKey, value: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>()
  if (value == null) return map

  const pushArray = (arr: unknown[], labelFn: (item: Record<string, unknown>, i: number) => string) => {
    arr.forEach((raw, i) => {
      const item = (raw ?? {}) as Record<string, unknown>
      let label = labelFn(item, i)
      // De-dupe identical labels so both survive the diff.
      if (map.has(label)) label = `${label} (${i + 1})`
      map.set(label, item)
    })
  }

  switch (key) {
    case 'roles':
      pushArray(value as unknown[], (r) => String(r.name ?? 'role'))
      break
    case 'channels':
      pushArray(value as unknown[], (c) => {
        const cat = c.type === 4 ? 'category' : 'channel'
        return `${String(c.name ?? cat)} · ${cat}`
      })
      break
    case 'giveaways':
      pushArray(value as unknown[], (g) => String(g.prize ?? g.name ?? g.id ?? 'giveaway'))
      break
    case 'events':
      pushArray(value as unknown[], (e) => String(e.name ?? e.id ?? 'event'))
      break
    case 'announcements':
      pushArray(value as unknown[], (a) => String(a.title ?? a.name ?? a.id ?? 'announcement'))
      break
    default: {
      // Config object sections — each top-level key is an item.
      const obj = value as Record<string, unknown>
      for (const k of Object.keys(obj)) map.set(k, obj[k])
    }
  }
  return map
}

/** Diff two backups' section blobs. Pass the "desired" state as `base` and the
 *  "current" state as `target`:
 *   • Backup comparison: base = older backup, target = newer backup.
 *   • Restore preview:   base = backup,        target = live config snapshot. */
export function diffSections(base: BackupSections, target: BackupSections): BackupDiff {
  const keys = Array.from(
    new Set([...sectionKeysPresent(base), ...sectionKeysPresent(target)]),
  ).sort((a, b) => BACKUP_SECTION_KEYS.indexOf(a) - BACKUP_SECTION_KEYS.indexOf(b))

  const sections: SectionDiff[] = []
  const totals = { added: 0, removed: 0, modified: 0 }
  for (const key of keys) {
    const d = diffKeyed(sectionToMap(key, base[key]), sectionToMap(key, target[key]))
    sections.push({ key, ...d })
    totals.added += d.added.length
    totals.removed += d.removed.length
    totals.modified += d.modified.length
  }
  return { sections, totals }
}

/** True when a diff carries no changes at all (used to short-circuit previews). */
export function diffIsEmpty(diff: BackupDiff): boolean {
  return diff.totals.added === 0 && diff.totals.removed === 0 && diff.totals.modified === 0
}

// ── Import / export ──────────────────────────────────────────────────────────
// A backup exports to a portable JSON envelope so admins can download one, share
// it, and import it into another server — effectively cloning a server's config.
// Mirrors lib/templates.ts (toExport / validateTemplateImport).

/** Bumped if the export envelope shape changes — import checks compatibility. */
export const BACKUP_EXPORT_VERSION = 1

export type BackupExport = {
  pulsifyBackup: typeof BACKUP_EXPORT_VERSION
  name: string
  /** The captured format version (so an importer can reason about the payload). */
  formatVersion: number
  sections: BackupSections
  sectionKeys: BackupSectionKey[]
  /** The server the backup was captured from — shown as provenance on import. */
  sourceGuildName?: string | null
  exportedAt: string
}

export function toBackupExport(b: ServerBackup, sourceGuildName?: string | null): BackupExport {
  return {
    pulsifyBackup: BACKUP_EXPORT_VERSION,
    name: b.name,
    formatVersion: b.formatVersion,
    sections: b.sections,
    sectionKeys: sectionKeysPresent(b.sections),
    sourceGuildName: sourceGuildName ?? null,
    exportedAt: new Date().toISOString(),
  }
}

/** A filename-safe slug for the downloaded JSON. */
export function exportFileName(name: string): string {
  const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '')
  return `${slug || 'backup'}.pulsify-backup.json`
}

export type BackupImportResult =
  | { ok: true; value: { name: string; sections: BackupSections; sourceGuildName: string | null }; warnings: string[] }
  | { ok: false; error: string }

function coerceRoles(val: unknown, warnings: string[]): BackupRole[] | null {
  if (!Array.isArray(val)) {
    warnings.push('Skipped roles — expected a list.')
    return null
  }
  const out: BackupRole[] = []
  for (const r of val as Record<string, unknown>[]) {
    if (!r || typeof r.name !== 'string') continue
    out.push({
      name: String(r.name).slice(0, 100),
      color: Number.isFinite(Number(r.color)) ? Number(r.color) : 0,
      hoist: r.hoist === true,
      mentionable: r.mentionable === true,
      permissions: typeof r.permissions === 'string' ? r.permissions : '0',
      position: Number.isFinite(Number(r.position)) ? Number(r.position) : 0,
    })
  }
  return out.length ? out.slice(0, BACKUP_LIMITS.maxRoles) : null
}

function coerceChannels(val: unknown, warnings: string[]): BackupChannel[] | null {
  if (!Array.isArray(val)) {
    warnings.push('Skipped channels — expected a list.')
    return null
  }
  const out: BackupChannel[] = []
  for (const c of val as Record<string, unknown>[]) {
    if (!c || typeof c.name !== 'string') continue
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined)
    out.push({
      name: String(c.name).slice(0, 100),
      type: Number.isFinite(Number(c.type)) ? Number(c.type) : 0,
      parent: typeof c.parent === 'string' ? c.parent : null,
      position: Number.isFinite(Number(c.position)) ? Number(c.position) : 0,
      topic: typeof c.topic === 'string' ? c.topic : null,
      nsfw: c.nsfw === true ? true : undefined,
      rate_limit_per_user: num(c.rate_limit_per_user),
      bitrate: num(c.bitrate),
      user_limit: num(c.user_limit),
      overwrites: num(c.overwrites),
    })
  }
  return out.length ? out.slice(0, BACKUP_LIMITS.maxChannels) : null
}

/** Validate a parsed JSON object as an importable backup. Tolerant of a bare
 *  `sections` object (no envelope) and of unknown future minor additions. */
export function validateBackupImport(input: unknown): BackupImportResult {
  if (input == null || typeof input !== 'object') {
    return { ok: false, error: 'File is not a JSON object.' }
  }
  const obj = input as Record<string, unknown>
  const warnings: string[] = []

  const version = obj.pulsifyBackup
  if (version != null && Number(version) > BACKUP_EXPORT_VERSION) {
    warnings.push('This file was exported by a newer version of Pulsify — some data may be ignored.')
  }

  const rawSections = (obj.sections ?? obj) as Record<string, unknown>
  const sections: BackupSections = {}
  for (const key of BACKUP_SECTION_KEYS) {
    const val = rawSections[key]
    if (val == null) continue
    if (key === 'roles') {
      const roles = coerceRoles(val, warnings)
      if (roles) sections.roles = roles
    } else if (key === 'channels') {
      const channels = coerceChannels(val, warnings)
      if (channels) sections.channels = channels
    } else if (key === 'giveaways' || key === 'events' || key === 'announcements') {
      if (Array.isArray(val)) {
        const items = (val as unknown[]).filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
        if (items.length) (sections as Record<string, unknown>)[key] = items
      }
    } else if (typeof val === 'object') {
      // Config object sections (automations / moderation / onboarding /
      // pulse_guard / tickets) — kept as-is; the feature owns the shape.
      ;(sections as Record<string, unknown>)[key] = val
    }
  }

  if (sectionKeysPresent(sections).length === 0) {
    return { ok: false, error: 'No recognisable backup sections found in this file.' }
  }

  const name =
    typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim().slice(0, BACKUP_LIMITS.nameMax)
      : 'Imported backup'
  const sourceGuildName = typeof obj.sourceGuildName === 'string' ? obj.sourceGuildName : null

  return { ok: true, value: { name, sections, sourceGuildName }, warnings }
}

// DDoS Protection & Security Monitoring — catalogue + pure helpers (PULSIFY-52).
//
// No JSX / framework / IO imports live here, exactly like lib/polls.ts and
// lib/giveaways.ts: the dashboard and the bot both read/write the
// `security_configs`, `security_events` and `security_mitigations` tables, so
// the detection engine (pattern model, sliding-window evaluation), the
// protection-rule shape, the mitigation-action catalogue and the severity model
// MUST agree between the two. Keep this in sync with pulse-bot/src/security.js
// the same way lib/polls.ts ↔ polls.js are.
//
// The bot owns runtime: it samples activity (commands, interactions, messages,
// joins, ticket/giveaway/application actions), runs `evaluatePattern` against
// each guild's configured rules on a tick, records detected `security_events`,
// applies the configured automatic `security_mitigations`, raises dashboard +
// Discord alerts, and expires temporary mitigations (recovery). The dashboard
// configures the rules, monitors live, and lets admins trigger / clear
// mitigations by hand — the bot enforces them over realtime.

// ── Severity ──────────────────────────────────────────────────────────────────

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical'

export const SEVERITY_META: Record<
  SecuritySeverity,
  { label: string; color: string; bg: string; rank: number }
> = {
  low:      { label: 'Low',      color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', rank: 0 },
  medium:   { label: 'Medium',   color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', rank: 1 },
  high:     { label: 'High',     color: '#f97316', bg: 'rgba(249,115,22,0.12)', rank: 2 },
  critical: { label: 'Critical', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', rank: 3 },
}

export function normaliseSeverity(v: unknown): SecuritySeverity {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'critical' ? v : 'medium'
}

/** Bump severity by `steps` levels, capped at critical. */
export function escalateSeverity(base: SecuritySeverity, steps: number): SecuritySeverity {
  const order: SecuritySeverity[] = ['low', 'medium', 'high', 'critical']
  const idx = Math.min(order.length - 1, Math.max(0, SEVERITY_META[base].rank + steps))
  return order[idx]
}

// ── Patterns (the suspicious behaviours the engine detects) ──────────────────

export type SecurityPattern =
  | 'request_spike'
  | 'command_abuse'
  | 'failed_actions'
  | 'ticket_spam'
  | 'giveaway_spam'
  | 'application_spam'
  | 'api_abuse'
  | 'member_join_burst'
  | 'automated_spam'

export type DetectionScope = 'global' | 'user'

export type PatternMeta = {
  label: string
  /** One-line description of what trips this pattern. */
  description: string
  icon: string
  /** Whether the threshold counts ALL activity (global) or PER-USER. */
  scope: DetectionScope
  /** The Pulsify surface this pattern protects — drives the default mitigation. */
  module: SecurityModule
}

export type SecurityModule =
  | 'commands'
  | 'tickets'
  | 'giveaways'
  | 'applications'
  | 'automations'
  | 'messages'
  | 'members'
  | 'api'

export const MODULE_LABELS: Record<SecurityModule, string> = {
  commands: 'Commands',
  tickets: 'Tickets',
  giveaways: 'Giveaways',
  applications: 'Applications',
  automations: 'Automations',
  messages: 'Messages',
  members: 'Members',
  api: 'API',
}

export const PATTERN_META: Record<SecurityPattern, PatternMeta> = {
  request_spike: {
    label: 'Request spike',
    description: 'A sudden surge of commands and interactions across the server.',
    icon: 'Activity',
    scope: 'global',
    module: 'commands',
  },
  command_abuse: {
    label: 'Excessive command usage',
    description: 'A single member firing commands far faster than normal use.',
    icon: 'TerminalSquare',
    scope: 'user',
    module: 'commands',
  },
  failed_actions: {
    label: 'Repeated failed actions',
    description: 'A member repeatedly hitting blocked or failing actions — often probing.',
    icon: 'XCircle',
    scope: 'user',
    module: 'commands',
  },
  ticket_spam: {
    label: 'Mass ticket creation',
    description: 'A flood of new tickets in a short window.',
    icon: 'LifeBuoy',
    scope: 'global',
    module: 'tickets',
  },
  giveaway_spam: {
    label: 'Mass giveaway joins',
    description: 'A member joining giveaways at an automated rate.',
    icon: 'Gift',
    scope: 'user',
    module: 'giveaways',
  },
  application_spam: {
    label: 'Mass application submissions',
    description: 'A member submitting applications repeatedly.',
    icon: 'FileText',
    scope: 'user',
    module: 'applications',
  },
  api_abuse: {
    label: 'Repeated API abuse',
    description: 'A member hammering bot interactions (buttons/menus) abusively.',
    icon: 'Plug',
    scope: 'user',
    module: 'api',
  },
  member_join_burst: {
    label: 'Member join burst',
    description: 'An unusual burst of members joining at once — a raid signal.',
    icon: 'UserPlus',
    scope: 'global',
    module: 'members',
  },
  automated_spam: {
    label: 'Automated spam behaviour',
    description: 'A member posting messages at a bot-like rate.',
    icon: 'MessageSquareWarning',
    scope: 'user',
    module: 'messages',
  },
}

export const ALL_PATTERNS = Object.keys(PATTERN_META) as SecurityPattern[]

export function normalisePattern(v: unknown): SecurityPattern {
  return ALL_PATTERNS.includes(v as SecurityPattern) ? (v as SecurityPattern) : 'request_spike'
}

// ── Mitigation actions ───────────────────────────────────────────────────────

export type MitigationAction =
  | 'notify'
  | 'increase_cooldown'
  | 'restrict_commands'
  | 'pause_module'
  | 'block_user'
  | 'pause_submissions'
  | 'lockdown'

export type MitigationMeta = {
  label: string
  description: string
  icon: string
  /** Whether this action targets a specific user or the whole module/server. */
  targets: 'user' | 'module' | 'server'
  tone: SecuritySeverity
}

export const MITIGATION_META: Record<MitigationAction, MitigationMeta> = {
  notify: {
    label: 'Notify administrators',
    description: 'Raise a dashboard alert and ping the security channel.',
    icon: 'Bell',
    targets: 'server',
    tone: 'low',
  },
  increase_cooldown: {
    label: 'Increase cooldowns',
    description: 'Temporarily slow the affected module to absorb the spike.',
    icon: 'Timer',
    targets: 'module',
    tone: 'medium',
  },
  restrict_commands: {
    label: 'Restrict command usage',
    description: 'Temporarily limit commands for the offending member.',
    icon: 'ShieldOff',
    targets: 'user',
    tone: 'medium',
  },
  pause_module: {
    label: 'Disable vulnerable feature',
    description: 'Temporarily turn off the targeted module until the spike passes.',
    icon: 'PowerOff',
    targets: 'module',
    tone: 'high',
  },
  block_user: {
    label: 'Block abusive member',
    description: "Temporarily block the member's actions through Pulse.",
    icon: 'UserX',
    targets: 'user',
    tone: 'high',
  },
  pause_submissions: {
    label: 'Pause ticket / application submissions',
    description: 'Temporarily stop new tickets and applications server-wide.',
    icon: 'FileX',
    targets: 'server',
    tone: 'high',
  },
  lockdown: {
    label: 'Enable server lockdown',
    description: 'Block all Pulse-driven actions until an admin lifts it.',
    icon: 'Lock',
    targets: 'server',
    tone: 'critical',
  },
}

export const ALL_MITIGATIONS = Object.keys(MITIGATION_META) as MitigationAction[]

export function normaliseMitigation(v: unknown): MitigationAction | null {
  return ALL_MITIGATIONS.includes(v as MitigationAction) ? (v as MitigationAction) : null
}

export function normaliseMitigations(raw: unknown): MitigationAction[] {
  if (!Array.isArray(raw)) return []
  const out: MitigationAction[] = []
  for (const v of raw) {
    const m = normaliseMitigation(v)
    if (m && !out.includes(m)) out.push(m)
  }
  return out
}

// ── Protection rules ──────────────────────────────────────────────────────────

export type SecurityRule = {
  enabled: boolean
  /** Trip the rule when this many matching events land inside the window. */
  threshold: number
  /** Sliding window the threshold is measured over, in seconds. */
  window_seconds: number
  /** Base severity assigned to a detection (escalates with how far over it is). */
  severity: SecuritySeverity
  /** Automatic mitigations applied when the rule trips. */
  actions: MitigationAction[]
  /** How long auto-applied (temporary) mitigations last, in seconds. 0 = until lifted. */
  mitigation_seconds: number
}

export const RULE_LIMITS = {
  minThreshold: 2,
  maxThreshold: 100_000,
  minWindow: 5,
  maxWindow: 60 * 60, // 1h
  minMitigation: 0,
  maxMitigation: 24 * 60 * 60, // 24h
} as const

export function defaultRule(pattern: SecurityPattern): SecurityRule {
  // Sensible per-pattern starting points — tuned so normal use never trips but
  // an automated flood does. Admins adjust these in the Rules tab.
  switch (pattern) {
    case 'request_spike':
      return { enabled: true, threshold: 120, window_seconds: 30, severity: 'high', actions: ['notify', 'increase_cooldown'], mitigation_seconds: 600 }
    case 'command_abuse':
      return { enabled: true, threshold: 25, window_seconds: 30, severity: 'medium', actions: ['notify', 'restrict_commands'], mitigation_seconds: 300 }
    case 'failed_actions':
      return { enabled: true, threshold: 15, window_seconds: 60, severity: 'medium', actions: ['notify', 'block_user'], mitigation_seconds: 600 }
    case 'ticket_spam':
      return { enabled: true, threshold: 10, window_seconds: 60, severity: 'high', actions: ['notify', 'pause_submissions'], mitigation_seconds: 600 }
    case 'giveaway_spam':
      return { enabled: true, threshold: 20, window_seconds: 60, severity: 'medium', actions: ['notify', 'restrict_commands'], mitigation_seconds: 300 }
    case 'application_spam':
      return { enabled: true, threshold: 8, window_seconds: 120, severity: 'medium', actions: ['notify', 'pause_submissions'], mitigation_seconds: 600 }
    case 'api_abuse':
      return { enabled: true, threshold: 60, window_seconds: 30, severity: 'high', actions: ['notify', 'block_user'], mitigation_seconds: 600 }
    case 'member_join_burst':
      return { enabled: true, threshold: 15, window_seconds: 60, severity: 'high', actions: ['notify'], mitigation_seconds: 0 }
    case 'automated_spam':
      return { enabled: true, threshold: 30, window_seconds: 30, severity: 'medium', actions: ['notify', 'block_user'], mitigation_seconds: 300 }
  }
}

export function defaultRules(): Record<SecurityPattern, SecurityRule> {
  const out = {} as Record<SecurityPattern, SecurityRule>
  for (const p of ALL_PATTERNS) out[p] = defaultRule(p)
  return out
}

export function normaliseRule(pattern: SecurityPattern, raw: unknown): SecurityRule {
  const base = defaultRule(pattern)
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  return {
    enabled: r.enabled === undefined ? base.enabled : Boolean(r.enabled),
    threshold: clampNum(r.threshold, RULE_LIMITS.minThreshold, RULE_LIMITS.maxThreshold, base.threshold),
    window_seconds: clampNum(r.window_seconds, RULE_LIMITS.minWindow, RULE_LIMITS.maxWindow, base.window_seconds),
    severity: normaliseSeverity(r.severity),
    actions: r.actions === undefined ? base.actions : normaliseMitigations(r.actions),
    mitigation_seconds: clampNum(r.mitigation_seconds, RULE_LIMITS.minMitigation, RULE_LIMITS.maxMitigation, base.mitigation_seconds),
  }
}

export function normaliseRules(raw: unknown): Record<SecurityPattern, SecurityRule> {
  const out = {} as Record<SecurityPattern, SecurityRule>
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  for (const p of ALL_PATTERNS) out[p] = normaliseRule(p, r[p])
  return out
}

export function validateRule(rule: SecurityRule): string | null {
  if (rule.threshold < RULE_LIMITS.minThreshold) return `Threshold must be at least ${RULE_LIMITS.minThreshold}.`
  if (rule.window_seconds < RULE_LIMITS.minWindow) return `Window must be at least ${RULE_LIMITS.minWindow}s.`
  return null
}

// ── Auto-lockdown trigger (a meta rule across all detections) ─────────────────

export type LockdownTrigger = {
  /** Auto-lockdown the server when enough events land in the window. */
  enabled: boolean
  /** Number of detected events that triggers a lockdown. */
  event_threshold: number
  window_seconds: number
  /** Only count events at or above this severity toward the lockdown. */
  min_severity: SecuritySeverity
}

export function defaultLockdownTrigger(): LockdownTrigger {
  return { enabled: false, event_threshold: 5, window_seconds: 120, min_severity: 'high' }
}

export function normaliseLockdownTrigger(raw: unknown): LockdownTrigger {
  const base = defaultLockdownTrigger()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  return {
    enabled: Boolean(r.enabled),
    event_threshold: clampNum(r.event_threshold, 2, 1000, base.event_threshold),
    window_seconds: clampNum(r.window_seconds, RULE_LIMITS.minWindow, RULE_LIMITS.maxWindow, base.window_seconds),
    min_severity: normaliseSeverity(r.min_severity),
  }
}

// ── Config (the `security_configs` row) ───────────────────────────────────────

export type SecurityConfig = {
  enabled: boolean
  /** Discord channel that receives security alerts (null = dashboard-only). */
  alert_channel_id: string | null
  rules: Record<SecurityPattern, SecurityRule>
  auto_lockdown: LockdownTrigger
  /** Live lockdown state (set by auto-lockdown or a manual lockdown mitigation). */
  lockdown_active: boolean
  lockdown_reason: string | null
  lockdown_since: string | null
}

export function defaultConfig(): SecurityConfig {
  return {
    enabled: false,
    alert_channel_id: null,
    rules: defaultRules(),
    auto_lockdown: defaultLockdownTrigger(),
    lockdown_active: false,
    lockdown_reason: null,
    lockdown_since: null,
  }
}

export function normaliseConfig(row: Record<string, unknown> | null | undefined): SecurityConfig {
  if (!row) return defaultConfig()
  return {
    enabled: Boolean(row.enabled),
    alert_channel_id: typeof row.alert_channel_id === 'string' && row.alert_channel_id ? row.alert_channel_id : null,
    rules: normaliseRules(row.rules),
    auto_lockdown: normaliseLockdownTrigger(row.auto_lockdown),
    lockdown_active: Boolean(row.lockdown_active),
    lockdown_reason: typeof row.lockdown_reason === 'string' ? row.lockdown_reason : null,
    lockdown_since: typeof row.lockdown_since === 'string' ? row.lockdown_since : null,
  }
}

// ── Detection engine (pure — MIRRORED in pulse-bot/src/security.js) ───────────

/** One observed unit of activity for a pattern. */
export type ActivitySample = { ts: number; userId?: string | null }

export type DetectionResult = {
  triggered: boolean
  /** The count that was measured (global total, or the top user's count). */
  count: number
  threshold: number
  window_seconds: number
  severity: SecuritySeverity
  /** For per-user patterns: the offending member, when one is identified. */
  actorId: string | null
}

/**
 * Evaluate a single pattern's rule against the samples observed so far. Counts
 * samples inside the sliding window: globally for `scope: 'global'` rules, or
 * per-user (taking the worst offender) for `scope: 'user'` rules. Severity
 * escalates one level for every full multiple of the threshold the count
 * reaches, so a 4× flood reads as more severe than a 1× one. Pure: the bot
 * collects the samples and calls this; the dashboard uses the same shape to
 * preview / describe rules.
 */
export function evaluatePattern(
  pattern: SecurityPattern,
  rule: SecurityRule,
  samples: ActivitySample[],
  now: number = Date.now(),
): DetectionResult {
  const meta = PATTERN_META[pattern]
  const cutoff = now - rule.window_seconds * 1000
  const recent = samples.filter((s) => s.ts >= cutoff)

  let count = 0
  let actorId: string | null = null
  if (meta.scope === 'global') {
    count = recent.length
  } else {
    const byUser = new Map<string, number>()
    for (const s of recent) {
      if (!s.userId) continue
      byUser.set(s.userId, (byUser.get(s.userId) ?? 0) + 1)
    }
    for (const [uid, c] of byUser) {
      if (c > count) {
        count = c
        actorId = uid
      }
    }
  }

  const triggered = rule.enabled && count >= rule.threshold
  const over = rule.threshold > 0 ? Math.floor(count / rule.threshold) - 1 : 0
  const severity = triggered ? escalateSeverity(rule.severity, Math.max(0, over)) : rule.severity

  return { triggered, count, threshold: rule.threshold, window_seconds: rule.window_seconds, severity, actorId }
}

// ── Records as passed to the UI ───────────────────────────────────────────────

export type EventStatus = 'open' | 'mitigated' | 'resolved'

export type SecurityEvent = {
  id: string
  guild_id: string
  pattern: SecurityPattern
  module: SecurityModule
  severity: SecuritySeverity
  status: EventStatus
  actor_id: string | null
  actor_name: string | null
  count: number
  threshold: number
  window_seconds: number
  source: 'auto' | 'manual'
  details: Record<string, unknown>
  created_at: string
  resolved_at: string | null
}

export function normaliseEvent(row: Record<string, unknown>): SecurityEvent {
  return {
    id: String(row.id),
    guild_id: String(row.guild_id),
    pattern: normalisePattern(row.pattern),
    module: (MODULE_LABELS[row.module as SecurityModule] ? (row.module as SecurityModule) : PATTERN_META[normalisePattern(row.pattern)].module),
    severity: normaliseSeverity(row.severity),
    status: row.status === 'mitigated' || row.status === 'resolved' ? row.status : 'open',
    actor_id: typeof row.actor_id === 'string' ? row.actor_id : null,
    actor_name: typeof row.actor_name === 'string' ? row.actor_name : null,
    count: clampNum(row.count, 0, Number.MAX_SAFE_INTEGER, 0),
    threshold: clampNum(row.threshold, 0, Number.MAX_SAFE_INTEGER, 0),
    window_seconds: clampNum(row.window_seconds, 0, Number.MAX_SAFE_INTEGER, 0),
    source: row.source === 'manual' ? 'manual' : 'auto',
    details: (row.details && typeof row.details === 'object' ? row.details : {}) as Record<string, unknown>,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    resolved_at: typeof row.resolved_at === 'string' ? row.resolved_at : null,
  }
}

export type SecurityMitigation = {
  id: string
  guild_id: string
  action: MitigationAction
  module: SecurityModule | null
  target_user_id: string | null
  target_user_name: string | null
  reason: string | null
  source: 'rule' | 'manual' | 'lockdown'
  pattern: SecurityPattern | null
  event_id: string | null
  active: boolean
  started_at: string
  expires_at: string | null
  ended_at: string | null
  ended_by: string | null
}

export function normaliseMitigationRow(row: Record<string, unknown>): SecurityMitigation {
  return {
    id: String(row.id),
    guild_id: String(row.guild_id),
    action: normaliseMitigation(row.action) ?? 'notify',
    module: MODULE_LABELS[row.module as SecurityModule] ? (row.module as SecurityModule) : null,
    target_user_id: typeof row.target_user_id === 'string' ? row.target_user_id : null,
    target_user_name: typeof row.target_user_name === 'string' ? row.target_user_name : null,
    reason: typeof row.reason === 'string' ? row.reason : null,
    source: row.source === 'manual' || row.source === 'lockdown' ? row.source : 'rule',
    pattern: row.pattern ? normalisePattern(row.pattern) : null,
    event_id: typeof row.event_id === 'string' ? row.event_id : null,
    active: Boolean(row.active),
    started_at: typeof row.started_at === 'string' ? row.started_at : new Date().toISOString(),
    expires_at: typeof row.expires_at === 'string' ? row.expires_at : null,
    ended_at: typeof row.ended_at === 'string' ? row.ended_at : null,
    ended_by: typeof row.ended_by === 'string' ? row.ended_by : null,
  }
}

// ── Presets (one-click rule profiles) ─────────────────────────────────────────

export type SecurityPreset = {
  id: string
  label: string
  description: string
  icon: string
  /** Multiplier applied to default thresholds — lower = stricter. */
  factor: number
  lockdown: boolean
}

export const SECURITY_PRESETS: SecurityPreset[] = [
  { id: 'relaxed', label: 'Relaxed', description: 'High thresholds — only blatant floods trip. Best for small, trusted servers.', icon: 'ShieldCheck', factor: 2, lockdown: false },
  { id: 'balanced', label: 'Balanced', description: 'The recommended defaults — catches automated abuse without false alarms.', icon: 'Shield', factor: 1, lockdown: false },
  { id: 'strict', label: 'Strict', description: 'Low thresholds + auto-lockdown. Best for large or raid-prone public servers.', icon: 'ShieldAlert', factor: 0.5, lockdown: true },
]

export function applyPreset(preset: SecurityPreset): { rules: Record<SecurityPattern, SecurityRule>; auto_lockdown: LockdownTrigger } {
  const rules = defaultRules()
  for (const p of ALL_PATTERNS) {
    rules[p] = {
      ...rules[p],
      threshold: clampNum(Math.round(rules[p].threshold * preset.factor), RULE_LIMITS.minThreshold, RULE_LIMITS.maxThreshold, rules[p].threshold),
    }
  }
  const auto_lockdown = preset.lockdown
    ? { ...defaultLockdownTrigger(), enabled: true }
    : defaultLockdownTrigger()
  return { rules, auto_lockdown }
}

// ── Analytics (pure, derived from loaded rows) ────────────────────────────────

export type SecurityStats = {
  totalEvents: number
  open: number
  bySeverity: Record<SecuritySeverity, number>
  byModule: { module: SecurityModule; count: number }[]
  /** Distinct offending members across events. */
  suspiciousUsers: number
  /** Mitigations currently in force. */
  activeMitigations: number
  /** Hourly event counts over the last `hours` (oldest → newest). */
  series: { hour: string; count: number; high: number }[]
}

export function computeSecurityStats(
  events: SecurityEvent[],
  mitigations: SecurityMitigation[],
  hours = 24,
): SecurityStats {
  const bySeverity: Record<SecuritySeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 }
  const moduleCounts = new Map<SecurityModule, number>()
  const users = new Set<string>()
  let open = 0

  for (const e of events) {
    bySeverity[e.severity]++
    moduleCounts.set(e.module, (moduleCounts.get(e.module) ?? 0) + 1)
    if (e.actor_id) users.add(e.actor_id)
    if (e.status !== 'resolved') open++
  }

  const byModule = [...moduleCounts.entries()]
    .map(([module, count]) => ({ module, count }))
    .sort((a, b) => b.count - a.count)

  // Hourly series.
  const hourMs = 3_600_000
  const startOfHour = new Date()
  startOfHour.setMinutes(0, 0, 0)
  const buckets = new Map<string, { count: number; high: number }>()
  for (let i = hours - 1; i >= 0; i--) {
    const d = new Date(startOfHour.getTime() - i * hourMs)
    buckets.set(d.toISOString().slice(0, 13), { count: 0, high: 0 })
  }
  for (const e of events) {
    const key = e.created_at.slice(0, 13)
    const b = buckets.get(key)
    if (b) {
      b.count++
      if (e.severity === 'high' || e.severity === 'critical') b.high++
    }
  }
  const series = [...buckets.entries()].map(([hour, v]) => ({ hour, ...v }))

  return {
    totalEvents: events.length,
    open,
    bySeverity,
    byModule,
    suspiciousUsers: users.size,
    activeMitigations: mitigations.filter((m) => m.active).length,
    series,
  }
}

/** Overall protection posture, derived from config + live events. */
export type ProtectionStatus = 'off' | 'protected' | 'elevated' | 'under_attack' | 'lockdown'

export function protectionStatus(config: SecurityConfig, openEvents: SecurityEvent[]): ProtectionStatus {
  if (config.lockdown_active) return 'lockdown'
  if (!config.enabled) return 'off'
  const recentCritical = openEvents.some((e) => e.severity === 'critical')
  const recentHigh = openEvents.filter((e) => e.severity === 'high' || e.severity === 'critical').length
  if (recentCritical || recentHigh >= 3) return 'under_attack'
  if (openEvents.length > 0) return 'elevated'
  return 'protected'
}

export const STATUS_META: Record<
  ProtectionStatus,
  { label: string; color: string; description: string; icon: string }
> = {
  off:          { label: 'Protection off', color: '#94a3b8', description: 'DDoS Protection is not enabled for this server.', icon: 'ShieldOff' },
  protected:    { label: 'Protected', color: '#22c55e', description: 'No suspicious activity — all systems normal.', icon: 'ShieldCheck' },
  elevated:     { label: 'Elevated', color: '#f59e0b', description: 'Some suspicious activity detected — monitoring closely.', icon: 'ShieldAlert' },
  under_attack: { label: 'Under attack', color: '#ef4444', description: 'High-severity abuse detected — mitigations active.', icon: 'Siren' },
  lockdown:     { label: 'Lockdown', color: '#ef4444', description: 'Server is locked down — Pulse actions are blocked.', icon: 'Lock' },
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatWindow(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const min = Math.round(seconds / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  return `${hr}h`
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const dys = Math.floor(hr / 24)
  if (dys < 30) return `${dys}d ago`
  return new Date(iso).toLocaleDateString()
}

/** Human sentence describing a detected event, used in logs + alerts. */
export function describeEvent(e: Pick<SecurityEvent, 'pattern' | 'count' | 'threshold' | 'window_seconds' | 'actor_name' | 'actor_id'>): string {
  const meta = PATTERN_META[e.pattern]
  const who = meta.scope === 'user' ? (e.actor_name ? `${e.actor_name} ` : e.actor_id ? `<@${e.actor_id}> ` : '') : ''
  return `${meta.label}: ${who}${e.count} in ${formatWindow(e.window_seconds)} (limit ${e.threshold}).`
}

// ── Small shared utilities ────────────────────────────────────────────────────

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

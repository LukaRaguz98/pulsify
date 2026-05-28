/**
 * Client-safe constants, types, and pure logic for the workspace / team
 * collaboration system (PULSIFY-28).
 *
 * NO `server-only` here — this is imported from both server components/actions
 * and client components (badges, capability checks for conditionally rendering
 * UI). Server-only auth lives in `lib/workspace-auth.ts`; activity logging in
 * `lib/workspace-activity.ts`.
 *
 * Mirrors the role each existing feature lib plays (lib/giveaways.ts,
 * lib/leveling.ts): shared types + the bits of logic that must stay identical
 * wherever they run.
 */

// ── Roles ────────────────────────────────────────────────────────────────
// Internal Pulsify staff roles — distinct from Discord roles. Ordered most →
// least privileged; index doubles as a quick rank when needed.
export const WORKSPACE_ROLES = ['owner', 'admin', 'moderator', 'analyst', 'support'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

/** Higher = more privileged. Used for "at least this role" comparisons. */
export const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  analyst: 1,
  support: 0,
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  moderator: 'Moderator',
  analyst: 'Analyst',
  support: 'Support Staff',
}

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: 'Full control, including billing, deletion and ownership transfer.',
  admin: 'Manage servers, team members, settings and everything below.',
  moderator: 'Cross-server moderation, incidents, watchlist, notes and tasks.',
  analyst: 'View analytics and activity; contribute notes and tasks.',
  support: 'Handle incidents and tickets; contribute notes, tasks and watchlist.',
}

/**
 * Badge colours per role, tier-shaded with CSS vars / fixed accents so they
 * read consistently in both light and dark schemes (same approach as
 * lib/leveling.ts levelBadge).
 */
export const ROLE_BADGE: Record<WorkspaceRole, { bg: string; color: string; border: string }> = {
  owner:     { bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24', border: 'rgba(251,191,36,0.4)' },
  admin:     { bg: 'var(--p-soft)',          color: 'var(--p-1)', border: 'color-mix(in srgb, var(--p-1) 35%, transparent)' },
  moderator: { bg: 'rgba(96,165,250,0.12)',  color: '#60a5fa', border: 'rgba(96,165,250,0.4)' },
  analyst:   { bg: 'rgba(52,211,153,0.12)',  color: '#34d399', border: 'rgba(52,211,153,0.4)' },
  support:   { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: 'rgba(148,163,184,0.4)' },
}

// ── Capabilities (granular dashboard permissions) ──────────────────────────
export type Capability =
  | 'manageWorkspace'   // edit name / branding / settings
  | 'manageMembers'     // invite, remove, change roles
  | 'manageServers'     // add / remove servers, edit tags
  | 'moderate'          // perform Discord-mutating cross-server actions
  | 'manageWatchlist'   // add / remove watchlist & banned/scam entries
  | 'manageIncidents'   // create / update incidents + comments
  | 'manageNotes'       // create / edit / delete shared notes
  | 'manageTasks'       // create / edit / complete tasks
  | 'viewAnalytics'     // see the cross-server analytics overview
  | 'viewActivity'      // see the activity feed

/**
 * The capability matrix IS the "granular dashboard permissions" requirement.
 * Each role maps to the exact set of things it may do; `can()` is the single
 * gate used by both server actions (lib/workspace-auth) and the UI (to hide
 * controls a member can't use). Owner is implicitly all-powerful but listed
 * explicitly so the matrix is self-documenting.
 */
export const ROLE_CAPABILITIES: Record<WorkspaceRole, Capability[]> = {
  owner: [
    'manageWorkspace', 'manageMembers', 'manageServers', 'moderate',
    'manageWatchlist', 'manageIncidents', 'manageNotes', 'manageTasks',
    'viewAnalytics', 'viewActivity',
  ],
  admin: [
    'manageWorkspace', 'manageMembers', 'manageServers', 'moderate',
    'manageWatchlist', 'manageIncidents', 'manageNotes', 'manageTasks',
    'viewAnalytics', 'viewActivity',
  ],
  moderator: [
    'manageServers', 'moderate', 'manageWatchlist', 'manageIncidents',
    'manageNotes', 'manageTasks', 'viewAnalytics', 'viewActivity',
  ],
  analyst: [
    'manageNotes', 'manageTasks', 'viewAnalytics', 'viewActivity',
  ],
  support: [
    'manageWatchlist', 'manageIncidents', 'manageNotes', 'manageTasks',
    'viewActivity',
  ],
}

export function can(role: WorkspaceRole | null | undefined, capability: Capability): boolean {
  if (!role) return false
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false
}

/** True when `role` is at least as privileged as `min`. */
export function hasRank(role: WorkspaceRole | null | undefined, min: WorkspaceRole): boolean {
  if (!role) return false
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value)
}

/**
 * Roles a member with `actorRole` is allowed to assign / grant to others. You
 * can never grant a role above your own, and only an owner can mint another
 * owner (handled separately as ownership transfer).
 */
export function assignableRoles(actorRole: WorkspaceRole): WorkspaceRole[] {
  const ceiling = actorRole === 'owner' ? ROLE_RANK.admin : ROLE_RANK[actorRole] - 1
  return WORKSPACE_ROLES.filter((r) => r !== 'owner' && ROLE_RANK[r] <= ceiling)
}

// ── Activity feed categories ───────────────────────────────────────────────
// The first eight are the categories `workspace_activity.category` can hold
// (derived from internal actions). `tickets` and `warnings` only ever come
// from MERGED external sources in the activity feed (guild notifications), so
// categoryForAction never emits them — they exist so the feed filter + the
// notification preferences can cover "tickets" and "server warnings" too.
export const ACTIVITY_CATEGORIES = [
  'workspace', 'servers', 'team', 'notes', 'tasks', 'incidents', 'watchlist', 'moderation',
  'tickets', 'warnings',
] as const
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  workspace: 'Workspace',
  servers: 'Servers',
  team: 'Team',
  notes: 'Notes',
  tasks: 'Tasks',
  incidents: 'Incidents',
  watchlist: 'Watchlist',
  moderation: 'Moderation',
  tickets: 'Tickets',
  warnings: 'Server warnings',
}

/** Accent per category — drives the feed dot + filter chip colour. */
export const ACTIVITY_CATEGORY_ACCENT: Record<ActivityCategory, string> = {
  workspace: 'var(--p-1)',
  servers: '#60a5fa',
  team: '#fbbf24',
  notes: '#a78bfa',
  tasks: '#34d399',
  incidents: '#f87171',
  watchlist: '#fb923c',
  moderation: '#f59e0b',
  tickets: '#22d3ee',
  warnings: '#ef4444',
}

/** Derive the feed category from a dotted action verb (`note.created` → notes). */
export function categoryForAction(action: string): ActivityCategory {
  const head = action.split('.')[0]
  const map: Record<string, ActivityCategory> = {
    workspace: 'workspace',
    server: 'servers',
    member: 'team',
    invite: 'team',
    note: 'notes',
    task: 'tasks',
    incident: 'incidents',
    comment: 'incidents',
    watchlist: 'watchlist',
    moderation: 'moderation',
  }
  return map[head] ?? 'workspace'
}

// ── Status / priority / severity vocab (shared by tasks + incidents) ─────────
export const TASK_STATUSES = ['open', 'in_progress', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open', in_progress: 'In progress', done: 'Done',
}

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const INCIDENT_STATUSES = ['open', 'investigating', 'resolved', 'closed'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  open: 'Open', investigating: 'Investigating', resolved: 'Resolved', closed: 'Closed',
}

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]
export const SEVERITY_COLOR: Record<Severity, string> = {
  low: '#34d399', medium: '#fbbf24', high: '#fb923c', critical: '#f87171',
}

export const WATCHLIST_KINDS = ['watch', 'scam', 'banned'] as const
export type WatchlistKind = (typeof WATCHLIST_KINDS)[number]
export const WATCHLIST_KIND_LABELS: Record<WatchlistKind, string> = {
  watch: 'Watching', scam: 'Scam / Phishing', banned: 'Banned',
}

// ── Row types ───────────────────────────────────────────────────────────────
export type Workspace = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  owner_id: string
  settings: WorkspaceSettings
  created_at: string
  updated_at: string
}

export type WorkspaceSettings = {
  accent?: string
}

/** A workspace plus the viewer's role and roster/server counts (picker, switcher). */
export type WorkspaceSummary = Workspace & {
  role: WorkspaceRole
  member_count: number
  server_count: number
}

export type WorkspaceMember = {
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  display_name: string | null
  avatar_url: string | null
  added_by: string | null
  joined_at: string
}

export type WorkspaceServer = {
  workspace_id: string
  guild_id: string
  tags: string[]
  added_by: string | null
  created_at: string
}

/** A workspace server with live Discord name / icon / member count attached. */
export type EnrichedServer = WorkspaceServer & {
  name: string
  icon: string | null
  memberCount: number | null
  /** Whether the Discord guild could be resolved (bot present + reachable). */
  botInstalled: boolean
}

export type WorkspaceInvite = {
  id: string
  workspace_id: string
  code: string
  role: WorkspaceRole
  label: string | null
  created_by: string
  expires_at: string | null
  max_uses: number | null
  uses: number
  revoked: boolean
  created_at: string
}

export type WorkspaceNote = {
  id: string
  workspace_id: string
  guild_id: string | null
  subject_user_id: string | null
  author_id: string
  author_name: string | null
  body: string
  mentions: string[]
  pinned: boolean
  created_at: string
  updated_at: string
}

export type WorkspaceTask = {
  id: string
  workspace_id: string
  guild_id: string | null
  title: string
  description: string | null
  status: TaskStatus
  priority: Priority
  assignee_id: string | null
  created_by: string
  due_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type WorkspaceIncident = {
  id: string
  workspace_id: string
  guild_id: string | null
  title: string
  description: string | null
  status: IncidentStatus
  severity: Severity
  assignee_id: string | null
  created_by: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export type IncidentComment = {
  id: string
  incident_id: string
  author_id: string
  author_name: string | null
  body: string
  mentions: string[]
  created_at: string
}

export type WatchlistEntry = {
  id: string
  workspace_id: string
  user_id: string
  user_name: string | null
  kind: WatchlistKind
  reason: string | null
  severity: Severity
  added_by: string
  added_by_name: string | null
  created_at: string
}

export type WorkspaceActivityRow = {
  id: string
  workspace_id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  category: ActivityCategory
  target_type: string | null
  target_id: string | null
  summary: string | null
  guild_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// ── Pure helpers ─────────────────────────────────────────────────────────────
/** URL-friendly handle from a workspace name. Server appends a random suffix. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace'
}

/**
 * Extract @mentions from a note/comment body and resolve them to member ids.
 * Members are matched on display name or handle (case-insensitive, spaces
 * collapsed). Returns the unique set of matched user_ids. Kept pure so the
 * composer preview and the server action agree on who got mentioned.
 */
export const MENTION_RE = /@([a-z0-9_.\-]{1,32})/gi

export function mentionMatches(needle: string, displayName: string | null): boolean {
  const name = (displayName ?? '').toLowerCase()
  if (!name) return false
  const first = name.split(/\s+/)[0]
  const n = needle.toLowerCase()
  return name === n || first === n || name.startsWith(n)
}

export function parseMentions(
  body: string,
  members: Pick<WorkspaceMember, 'user_id' | 'display_name'>[],
): string[] {
  const tokens = body.match(MENTION_RE) ?? []
  if (tokens.length === 0) return []
  const matched = new Set<string>()
  for (const raw of tokens) {
    const needle = raw.slice(1)
    if (!needle) continue
    for (const m of members) {
      if (mentionMatches(needle, m.display_name)) {
        matched.add(m.user_id)
        break
      }
    }
  }
  return [...matched]
}

/** Deterministic accent for a free-form server tag (stable across renders). */
const TAG_PALETTE = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb923c', '#22d3ee', '#f472b6']
export function tagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_PALETTE[hash % TAG_PALETTE.length]
}

/** Aggregate per-role counts for the overview "staff roles" display. */
export function countRoles(members: Pick<WorkspaceMember, 'role'>[]): Record<WorkspaceRole, number> {
  const counts = { owner: 0, admin: 0, moderator: 0, analyst: 0, support: 0 }
  for (const m of members) if (m.role in counts) counts[m.role]++
  return counts
}

/** Compact relative time ("just now", "5m ago", "3d ago") for feeds + cards. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/** True when an invite can still be redeemed. */
export function isInviteUsable(invite: Pick<WorkspaceInvite, 'revoked' | 'expires_at' | 'max_uses' | 'uses'>): boolean {
  if (invite.revoked) return false
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return false
  if (invite.max_uses != null && invite.uses >= invite.max_uses) return false
  return true
}

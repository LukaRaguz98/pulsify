// Self-Assign Roles — catalogue + pure helpers (PULSIFY-56).
//
// No JSX / framework / IO imports live here: lucide icons are referenced by
// NAME (resolved in the UI layer), exactly like lib/polls.ts and
// lib/temporary-roles.ts. The dashboard and the bot both read/write the
// `self_role_menus` / `self_role_assignments` tables, so the menu model, the
// selection-mode rules, the message rendering and the interaction custom_id
// scheme MUST agree between the two — keep this in sync with
// pulse-bot/src/self-roles.js the same way lib/polls.ts ↔ polls.js are.

// ── Statuses ──────────────────────────────────────────────────────────────────

export type MenuStatus = 'draft' | 'active' | 'disabled' | 'archived'

export const MENU_STATUS_META: Record<
  MenuStatus,
  { label: string; icon: string; color: string; order: number }
> = {
  active:   { label: 'Active',   icon: 'Radio',        color: '#22c55e', order: 0 },
  draft:    { label: 'Draft',    icon: 'PencilLine',   color: '#3b82f6', order: 1 },
  disabled: { label: 'Disabled', icon: 'PauseCircle',  color: '#f59e0b', order: 2 },
  archived: { label: 'Archived', icon: 'Archive',      color: '#94a3b8', order: 3 },
}

export function normaliseStatus(v: unknown): MenuStatus {
  return v === 'draft' || v === 'active' || v === 'disabled' || v === 'archived' ? v : 'draft'
}

/** A menu whose Discord message is (or should be) live and interactive. */
export function isLiveStatus(status: string): boolean {
  return status === 'active'
}

// ── Menu type (the control style) ─────────────────────────────────────────────

export type MenuType = 'buttons' | 'select'

export const MENU_TYPE_META: Record<MenuType, { label: string; icon: string; description: string }> = {
  buttons: { label: 'Buttons',     icon: 'MousePointerClick', description: 'A row of buttons — best for a handful of roles.' },
  select:  { label: 'Select menu', icon: 'ListChecks',        description: 'A dropdown — best for many roles or a tidy list.' },
}

export function normaliseMenuType(v: unknown): MenuType {
  return v === 'select' ? 'select' : 'buttons'
}

// ── Selection mode (how many of the menu's roles a member may hold) ───────────

export type SelectionMode = 'multiple' | 'single'

export const SELECTION_MODE_META: Record<SelectionMode, { label: string; icon: string; description: string }> = {
  multiple: { label: 'Multiple', icon: 'CopyCheck',  description: 'Members can pick any number of these roles.' },
  single:   { label: 'Single',   icon: 'CircleDot',  description: 'Mutually exclusive — picking one removes the others (switch).' },
}

export function normaliseSelectionMode(v: unknown): SelectionMode {
  return v === 'single' ? 'single' : 'multiple'
}

// ── Categories ────────────────────────────────────────────────────────────────

export type MenuCategory =
  | 'game'
  | 'notification'
  | 'platform'
  | 'language'
  | 'region'
  | 'interest'
  | 'color'
  | 'custom'

export const MENU_CATEGORIES: MenuCategory[] = [
  'game',
  'notification',
  'platform',
  'language',
  'region',
  'interest',
  'color',
  'custom',
]

export const CATEGORY_META: Record<
  MenuCategory,
  { label: string; icon: string; color: string; description: string }
> = {
  game:         { label: 'Game roles',         icon: 'Gamepad2', color: '#22c55e', description: 'Roles for the games members play.' },
  notification: { label: 'Notification roles', icon: 'Bell',     color: '#3b82f6', description: 'Opt in or out of pings and announcements.' },
  platform:     { label: 'Platform roles',     icon: 'Monitor',  color: '#a855f7', description: 'PC, console, mobile and the like.' },
  language:     { label: 'Language roles',     icon: 'Languages', color: '#06b6d4', description: 'The languages members speak.' },
  region:       { label: 'Region roles',       icon: 'Globe2',   color: '#f59e0b', description: 'Where members are based.' },
  interest:     { label: 'Interest roles',     icon: 'Heart',    color: '#ec4899', description: 'Hobbies and topics members care about.' },
  color:        { label: 'Color roles',        icon: 'Palette',  color: '#8b5cf6', description: 'Cosmetic name colours.' },
  custom:       { label: 'Custom',             icon: 'Shapes',   color: '#94a3b8', description: 'Anything else you want to offer.' },
}

export function normaliseCategory(v: unknown): MenuCategory {
  return typeof v === 'string' && (MENU_CATEGORIES as string[]).includes(v) ? (v as MenuCategory) : 'custom'
}

// ── Button styles (buttons menu only) ─────────────────────────────────────────

export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger'

/** Discord button style ids — used when rendering the menu message. */
export const BUTTON_STYLE_ID: Record<ButtonStyle, number> = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
}

export const BUTTON_STYLE_META: Record<ButtonStyle, { label: string; swatch: string }> = {
  primary:   { label: 'Blurple', swatch: '#5865f2' },
  secondary: { label: 'Grey',    swatch: '#4e5058' },
  success:   { label: 'Green',   swatch: '#248046' },
  danger:    { label: 'Red',     swatch: '#da373c' },
}

export function normaliseButtonStyle(v: unknown): ButtonStyle {
  return v === 'primary' || v === 'secondary' || v === 'success' || v === 'danger' ? v : 'secondary'
}

// ── Role entries ──────────────────────────────────────────────────────────────

export type SelfRoleEntry = {
  role_id: string
  /** Display label on the button / option. Defaults to the role name. */
  label: string
  /** Optional one-line help shown on the select option / in the message body. */
  description?: string
  /** Unicode char or `<:name:id>` custom emoji. */
  emoji?: string
  /** Button colour (buttons menu only). */
  button_style: ButtonStyle
}

export const SELF_ROLE_LIMITS = {
  maxTitle: 200,
  maxDescription: 1500,
  /** Discord caps a select menu at 25 options and 5 button rows × 5 = 25. */
  maxRoles: 25,
  minRoles: 1,
  maxLabel: 80,
  maxRoleDescription: 100,
  maxRequiredRoles: 10,
  /** Buttons per Discord action row. */
  buttonsPerRow: 5,
} as const

export type RequiredRoleMode = 'any' | 'all'

export function normaliseRequiredRoleMode(v: unknown): RequiredRoleMode {
  return v === 'all' ? 'all' : 'any'
}

export function normaliseRoles(raw: unknown): SelfRoleEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SelfRoleEntry[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const role_id = typeof o.role_id === 'string' ? o.role_id : ''
    if (!role_id || seen.has(role_id)) continue
    seen.add(role_id)
    const label = String(o.label ?? '').slice(0, SELF_ROLE_LIMITS.maxLabel).trim() || role_id
    const description = typeof o.description === 'string' && o.description.trim()
      ? o.description.slice(0, SELF_ROLE_LIMITS.maxRoleDescription).trim()
      : undefined
    const emoji = typeof o.emoji === 'string' && o.emoji.trim() ? o.emoji.trim() : undefined
    out.push({
      role_id,
      label,
      ...(description ? { description } : {}),
      ...(emoji ? { emoji } : {}),
      button_style: normaliseButtonStyle(o.button_style),
    })
    if (out.length >= SELF_ROLE_LIMITS.maxRoles) break
  }
  return out
}

export function normaliseRequiredRoleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string').slice(0, SELF_ROLE_LIMITS.maxRequiredRoles)
}

// ── Menu record (as passed from the API to the client UI) ─────────────────────

export type SelfRoleMenu = {
  id: string
  guild_id: string
  title: string
  description: string | null
  channel_id: string
  message_id: string | null
  menu_type: MenuType
  category: MenuCategory
  selection_mode: SelectionMode
  min_values: number
  max_values: number
  required_role_ids: string[]
  required_role_mode: RequiredRoleMode
  roles: SelfRoleEntry[]
  status: MenuStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export function normaliseMenu(row: Record<string, unknown>): SelfRoleMenu {
  return {
    id: String(row.id),
    guild_id: String(row.guild_id),
    title: typeof row.title === 'string' ? row.title : 'Self roles',
    description: typeof row.description === 'string' ? row.description : null,
    channel_id: typeof row.channel_id === 'string' ? row.channel_id : '',
    message_id: typeof row.message_id === 'string' ? row.message_id : null,
    menu_type: normaliseMenuType(row.menu_type),
    category: normaliseCategory(row.category),
    selection_mode: normaliseSelectionMode(row.selection_mode),
    min_values: clampNum(row.min_values, 0, SELF_ROLE_LIMITS.maxRoles, 0),
    max_values: clampNum(row.max_values, 0, SELF_ROLE_LIMITS.maxRoles, 0),
    required_role_ids: normaliseRequiredRoleIds(row.required_role_ids),
    required_role_mode: normaliseRequiredRoleMode(row.required_role_mode),
    roles: normaliseRoles(row.roles),
    status: normaliseStatus(row.status),
    created_by: (row.created_by as string) ?? null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  }
}

// ── Selection bounds (shared by the message renderer + the bot) ───────────────

/**
 * Resolve the effective select-menu bounds for a menu. Single-selection menus
 * are always max 1; multiple menus honour the configured min/max (0 max = all
 * roles allowed). MIRRORED in pulse-bot/src/self-roles.js.
 */
export function selectionBounds(menu: {
  selection_mode: SelectionMode
  min_values: number
  max_values: number
  roles: { length: number }
}): { min: number; max: number } {
  const count = menu.roles.length || 1
  if (menu.selection_mode === 'single') return { min: Math.min(menu.min_values, 1), max: 1 }
  const max = menu.max_values > 0 ? Math.min(menu.max_values, count) : count
  const min = Math.max(0, Math.min(menu.min_values, max))
  return { min, max }
}

// ── Interaction custom_ids (shared with pulse-bot/src/self-roles.js) ──────────
// The role buttons / select menu carry these ids; the BOT handles them. Keep
// identical to the SR constant in pulse-bot/src/self-roles.js.

export const SR = 'sr'
export const roleButtonId = (menuId: string, roleId: string) => `${SR}:btn:${menuId}:${roleId}`
export const roleSelectId = (menuId: string) => `${SR}:sel:${menuId}`

// ── Message rendering (pure — produces raw Components V2 objects) ──────────────
// Returns the type-17 container the dashboard POSTs and the bot mirrors, so the
// menu looks identical whoever rendered it. MIRRORED in self-roles.js.

const td = (content: string) => ({ type: 10, content })

// Pulse brand violet — the shared accent on every Pulse embed (changelog,
// announcements, polls, giveaways …). Self-role menus use the same colour so
// the chrome is consistent across the bot, not a per-category tint.
const BRAND = 0x8b5cf6

function emojiObj(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined
  const m = /^<a?:(\w+):(\d+)>$/.exec(raw)
  if (m) return { id: m[2], name: m[1], animated: raw.startsWith('<a:') }
  return { name: raw }
}

/** The interactive controls (button rows or a single select menu). */
export function menuControls(menu: SelfRoleMenu): Record<string, unknown>[] {
  if (menu.roles.length === 0) return []
  if (menu.menu_type === 'select') {
    const { min, max } = selectionBounds(menu)
    return [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: roleSelectId(menu.id),
            placeholder: menu.selection_mode === 'single' ? 'Pick a role' : 'Pick your roles',
            min_values: min,
            max_values: Math.max(1, max),
            options: menu.roles.slice(0, 25).map((r) => ({
              label: r.label.slice(0, 100),
              value: r.role_id,
              ...(r.description ? { description: r.description.slice(0, 100) } : {}),
              ...(r.emoji ? { emoji: emojiObj(r.emoji) } : {}),
            })),
          },
        ],
      },
    ]
  }
  // Buttons — chunk into action rows of 5.
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < menu.roles.length; i += SELF_ROLE_LIMITS.buttonsPerRow) {
    const slice = menu.roles.slice(i, i + SELF_ROLE_LIMITS.buttonsPerRow)
    rows.push({
      type: 1,
      components: slice.map((r) => ({
        type: 2,
        style: BUTTON_STYLE_ID[r.button_style],
        label: r.label.slice(0, 80),
        ...(r.emoji ? { emoji: emojiObj(r.emoji) } : {}),
        custom_id: roleButtonId(menu.id, r.role_id),
      })),
    })
  }
  return rows
}

/**
 * The full container for a menu's message. `state` controls the rendering:
 * 'active' shows the interactive controls; 'disabled'/'archived' replace them
 * with a short notice so the message stops accepting input. Pure — the dashboard
 * (TS) and bot (JS) both produce the same object. MIRRORED in self-roles.js.
 */
export function buildMenuContainer(
  menu: SelfRoleMenu,
  state: 'active' | 'disabled' | 'archived' = 'active',
  // The guild's configured embed accent (int). Defaults to the Pulse brand
  // violet when the caller doesn't resolve a per-guild colour.
  accent: number = BRAND,
): Record<string, unknown> {
  const body: Record<string, unknown>[] = [td('**Pulse**'), td(`# ${menu.title}`)]
  if (menu.description) body.push(td(menu.description.slice(0, SELF_ROLE_LIMITS.maxDescription)))

  // A short legend of what each role is, when descriptions are set (buttons
  // can't show a description; the select menu shows them inline).
  if (state === 'active' && menu.menu_type === 'buttons') {
    const described = menu.roles.filter((r) => r.description)
    if (described.length > 0) {
      body.push(td(described.map((r) => `${r.emoji ? `${r.emoji} ` : ''}**${r.label}** — ${r.description}`).join('\n')))
    }
  }

  const hint =
    menu.selection_mode === 'single'
      ? 'Pick one — choosing another switches it.'
      : 'Tap to add or remove a role. Toggle as many as you like.'
  if (state === 'active') body.push(td(`-# ${hint}`))

  body.push({ type: 14, divider: true, spacing: 1 })

  if (state === 'active') {
    for (const row of menuControls(menu)) body.push(row)
    body.push(td('-# Pulse — Self Roles'))
  } else {
    body.push(td(state === 'archived' ? 'This role menu has been archived.' : 'This role menu is currently disabled.'))
    body.push(td(`-# Pulse — Self Roles ${state === 'archived' ? 'archived' : 'disabled'}`))
  }

  return { type: 17, accent_color: accent, components: body }
}

// ── Validation (create / edit) ────────────────────────────────────────────────

export type MenuDraft = {
  title: string
  description: string
  channel_id: string
  menu_type: MenuType
  category: MenuCategory
  selection_mode: SelectionMode
  min_values: number
  max_values: number
  required_role_ids: string[]
  required_role_mode: RequiredRoleMode
  roles: SelfRoleEntry[]
}

export function defaultDraft(): MenuDraft {
  return {
    title: '',
    description: '',
    channel_id: '',
    menu_type: 'buttons',
    category: 'custom',
    selection_mode: 'multiple',
    min_values: 0,
    max_values: 0,
    required_role_ids: [],
    required_role_mode: 'any',
    roles: [],
  }
}

/** Returns an error string if the draft can't be saved/published, else null. */
export function validateDraft(d: MenuDraft): string | null {
  if (!d.title.trim()) return 'Give your role menu a title.'
  if (!d.channel_id) return 'Pick a channel to post the menu in.'
  const roles = normaliseRoles(d.roles)
  if (roles.length < SELF_ROLE_LIMITS.minRoles) return 'Add at least one role to the menu.'
  if (roles.length > SELF_ROLE_LIMITS.maxRoles) return `A menu can offer at most ${SELF_ROLE_LIMITS.maxRoles} roles.`
  if (d.menu_type === 'select' && d.selection_mode === 'multiple') {
    const { min, max } = selectionBounds({ ...d, roles })
    if (min > max) return 'Minimum selections cannot exceed the maximum.'
  }
  return null
}

// ── Presets (built-in category templates that pre-fill the builder) ───────────

export type MenuPreset = {
  id: string
  label: string
  icon: string
  category: MenuCategory
  draft: Partial<MenuDraft>
}

export const MENU_PRESETS: MenuPreset[] = [
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'Bell',
    category: 'notification',
    draft: {
      title: 'Notification roles',
      description: 'Opt in to the pings you care about — toggle any of these on or off.',
      menu_type: 'buttons',
      category: 'notification',
      selection_mode: 'multiple',
    },
  },
  {
    id: 'games',
    label: 'Games',
    icon: 'Gamepad2',
    category: 'game',
    draft: {
      title: 'Game roles',
      description: 'Grab a role for the games you play so others can find you.',
      menu_type: 'select',
      category: 'game',
      selection_mode: 'multiple',
    },
  },
  {
    id: 'platform',
    label: 'Platform',
    icon: 'Monitor',
    category: 'platform',
    draft: {
      title: 'Your platform',
      description: 'Let everyone know where you play.',
      menu_type: 'buttons',
      category: 'platform',
      selection_mode: 'single',
    },
  },
  {
    id: 'colors',
    label: 'Name colours',
    icon: 'Palette',
    category: 'color',
    draft: {
      title: 'Pick your colour',
      description: 'Choose a colour for your name — only one at a time.',
      menu_type: 'select',
      category: 'color',
      selection_mode: 'single',
    },
  },
  {
    id: 'region',
    label: 'Region',
    icon: 'Globe2',
    category: 'region',
    draft: {
      title: 'Where are you?',
      description: 'Pick your region.',
      menu_type: 'select',
      category: 'region',
      selection_mode: 'single',
    },
  },
]

// ── Analytics (pure, derived from the loaded rows) ────────────────────────────

export type AssignmentRow = {
  id: string
  guild_id: string
  menu_id: string | null
  user_id: string
  user_name: string | null
  role_id: string
  role_name: string | null
  action: 'added' | 'removed'
  created_at: string
}

export type RoleUsage = { role_id: string; role_name: string; added: number; removed: number; net: number }

export type SelfRoleStats = {
  totalMenus: number
  activeMenus: number
  draftMenus: number
  totalRoles: number
  /** Total `added` actions across all assignments (gross opt-ins). */
  totalAssignments: number
  /** Distinct members who have ever self-assigned. */
  uniqueMembers: number
  /** Roles ranked by `added` count, descending. */
  mostSelected: RoleUsage[]
  /** Offered roles ranked by `added` count, ascending (surfaces unused roles). */
  leastSelected: RoleUsage[]
  /** Per-day added/removed counts over the last `days` days (oldest → newest). */
  series: { date: string; added: number; removed: number }[]
}

export function computeSelfRoleStats(menus: SelfRoleMenu[], assignments: AssignmentRow[], days = 14): SelfRoleStats {
  let activeMenus = 0
  let draftMenus = 0
  let totalRoles = 0
  // Every role offered across menus, so we can surface offered-but-unused ones.
  const offered = new Map<string, string>()
  for (const m of menus) {
    if (m.status === 'active') activeMenus++
    if (m.status === 'draft') draftMenus++
    totalRoles += m.roles.length
    for (const r of m.roles) if (!offered.has(r.role_id)) offered.set(r.role_id, r.label)
  }

  const usage = new Map<string, RoleUsage>()
  const members = new Set<string>()
  let totalAssignments = 0
  for (const a of assignments) {
    const name = a.role_name || offered.get(a.role_id) || a.role_id
    const u = usage.get(a.role_id) ?? { role_id: a.role_id, role_name: name, added: 0, removed: 0, net: 0 }
    if (!usage.get(a.role_id)?.role_name && name) u.role_name = name
    if (a.action === 'added') {
      u.added++
      totalAssignments++
    } else if (a.action === 'removed') {
      u.removed++
    }
    u.net = u.added - u.removed
    usage.set(a.role_id, u)
    if (a.user_id) members.add(a.user_id)
  }
  // Seed offered roles with zero usage so "least selected" can show them.
  for (const [role_id, label] of offered) {
    if (!usage.has(role_id)) usage.set(role_id, { role_id, role_name: label, added: 0, removed: 0, net: 0 })
  }

  const ranked = [...usage.values()]
  const mostSelected = [...ranked].sort((a, b) => b.added - a.added).slice(0, 5)
  const leastSelected = [...ranked].sort((a, b) => a.added - b.added).slice(0, 5)

  const series: { date: string; added: number; removed: number }[] = []
  const dayMs = 86_400_000
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const buckets = new Map<string, { added: number; removed: number }>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startOfToday.getTime() - i * dayMs)
    buckets.set(d.toISOString().slice(0, 10), { added: 0, removed: 0 })
  }
  for (const a of assignments) {
    const b = buckets.get(a.created_at.slice(0, 10))
    if (b) {
      if (a.action === 'added') b.added++
      else if (a.action === 'removed') b.removed++
    }
  }
  for (const [date, v] of buckets) series.push({ date, ...v })

  return {
    totalMenus: menus.length,
    activeMenus,
    draftMenus,
    totalRoles,
    totalAssignments,
    uniqueMembers: members.size,
    mostSelected,
    leastSelected,
    series,
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const dys = Math.floor(hr / 24)
  if (dys < 30) return `${dys}d ago`
  return new Date(iso).toLocaleDateString()
}

// ── Small shared utilities ────────────────────────────────────────────────────

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

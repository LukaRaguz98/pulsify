// Server Templates (PULSIFY-36) — shared types, the section/category catalog,
// the built-in "official preset" library, and the pure helpers that summarise,
// validate and normalise templates. No server-only or JSX imports live here so
// it can be pulled into client components and server actions alike (icons are
// referenced by lucide name, resolved in the UI — same stance as
// lib/command-palette.ts / lib/automations.ts).
//
// A template is a snapshot of selected configuration *sections* captured from a
// server. The section keys map to where each feature actually stores its config
// (see the apply path in the route's actions.ts):
//   • automations  → guild_settings.settings { welcome, goodbye, auto_role }
//   • moderation   → guild_settings.settings { moderation_alerts }
//   • pulse        → guild_settings.settings { rules, channels_reference }
//   • onboarding   → guild_settings.settings { onboarding }
//   • pulse_guard  → ai_moderation_settings  { enabled, sensitivity, settings }
//   • tickets      → ticket_configs row
//   • roles        → live Discord role structure (created on apply)

// ── Sections ─────────────────────────────────────────────────────────────────

export const TEMPLATE_SECTION_KEYS = [
  'automations',
  'moderation',
  'pulse',
  'onboarding',
  'pulse_guard',
  'tickets',
  'roles',
] as const

export type TemplateSectionKey = (typeof TEMPLATE_SECTION_KEYS)[number]

export const SECTION_META: Record<
  TemplateSectionKey,
  { label: string; description: string; icon: string; accent: string }
> = {
  automations: {
    label: 'Automations',
    description: 'Welcome & goodbye messages and auto-role assignment.',
    icon: 'Zap',
    accent: '#f59e0b',
  },
  moderation: {
    label: 'Moderation',
    description: 'Moderation alert routing for mod actions.',
    icon: 'Shield',
    accent: '#f87171',
  },
  pulse: {
    label: 'Pulse content',
    description: 'Server rules and the channel reference guide.',
    icon: 'Sparkles',
    accent: '#8b5cf6',
  },
  onboarding: {
    label: 'Onboarding',
    description: 'The first-run onboarding welcome screen.',
    icon: 'Compass',
    accent: '#22d3ee',
  },
  pulse_guard: {
    label: 'Pulse Guard',
    description: 'AI moderation detectors, sensitivity & auto-actions.',
    icon: 'ShieldAlert',
    accent: '#ef4444',
  },
  tickets: {
    label: 'Tickets',
    description: 'Support ticket panel, types, auto-close & limits.',
    icon: 'LifeBuoy',
    accent: '#34d399',
  },
  roles: {
    label: 'Role structure',
    description: 'Role names, colours, permissions & display options.',
    icon: 'Users',
    accent: '#a855f7',
  },
}

// ── Categories ───────────────────────────────────────────────────────────────

export const TEMPLATE_CATEGORIES = [
  'gaming',
  'creator',
  'support',
  'startup',
  'community',
  'custom',
] as const

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

export const CATEGORY_META: Record<
  TemplateCategory,
  { label: string; description: string; icon: string; accent: string }
> = {
  gaming: {
    label: 'Gaming community',
    description: 'Clans, squads and game nights.',
    icon: 'Gamepad2',
    accent: '#22d3ee',
  },
  creator: {
    label: 'Creator community',
    description: 'Streamers, artists and their audience.',
    icon: 'Sparkles',
    accent: '#ec4899',
  },
  support: {
    label: 'Support server',
    description: 'Product help desks and ticket-first servers.',
    icon: 'LifeBuoy',
    accent: '#34d399',
  },
  startup: {
    label: 'Startup / product',
    description: 'Early adopters, feedback and announcements.',
    icon: 'Rocket',
    accent: '#f59e0b',
  },
  community: {
    label: 'Large public community',
    description: 'High-traffic public servers that need strong safety.',
    icon: 'Users',
    accent: '#8b5cf6',
  },
  custom: {
    label: 'Custom',
    description: 'Saved from one of your servers.',
    icon: 'LayoutTemplate',
    accent: 'var(--text-2)',
  },
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/** A role captured for the role-structure section. IDs are intentionally not
 *  stored — apply creates roles by name, so a template is portable across
 *  servers. */
export type TemplateRole = {
  name: string
  /** Decimal RGB int (0 = no colour). */
  color: number
  hoist: boolean
  mentionable: boolean
  /** Discord permission bitfield as a decimal string. */
  permissions: string
}

/** The captured configuration, keyed by section. Absent key = not captured.
 *  Section payloads are stored loosely (the feature owns the precise shape);
 *  apply merges them straight back into the feature's storage. */
export type TemplateSections = {
  automations?: Record<string, unknown>
  moderation?: Record<string, unknown>
  pulse?: Record<string, unknown>
  onboarding?: Record<string, unknown>
  pulse_guard?: { enabled?: boolean; sensitivity?: string; settings?: Record<string, unknown> }
  tickets?: Record<string, unknown>
  roles?: TemplateRole[]
}

export type ServerTemplate = {
  id: string
  guildId: string | null
  name: string
  description: string | null
  category: TemplateCategory
  icon: string
  sections: TemplateSections
  authorId: string | null
  authorName: string | null
  usageCount: number
  createdAt: string
  updatedAt: string
  /** True for the in-code official presets (not persisted in the DB). */
  builtin: boolean
}

/** What the create panel collects before capture. */
export type TemplateDraft = {
  name: string
  description: string
  category: TemplateCategory
  icon: string
  /** Sections the user chose to include in the snapshot. */
  sectionKeys: TemplateSectionKey[]
}

export const TEMPLATE_LIMITS = {
  nameMax: 60,
  descriptionMax: 280,
  maxRoles: 60,
} as const

/** Bumped if the export envelope shape changes — import checks compatibility. */
export const TEMPLATE_EXPORT_VERSION = 1

// ── Normalisation ────────────────────────────────────────────────────────────

function asCategory(v: unknown): TemplateCategory {
  return TEMPLATE_CATEGORIES.includes(v as TemplateCategory) ? (v as TemplateCategory) : 'custom'
}

/** Coerce a DB row into a ServerTemplate. */
export function normaliseTemplate(row: Record<string, unknown>): ServerTemplate {
  const sections = (row.sections as TemplateSections | null) ?? {}
  return {
    id: String(row.id),
    guildId: (row.guild_id as string | null) ?? null,
    name: String(row.name ?? 'Untitled template'),
    description: (row.description as string | null) ?? null,
    category: asCategory(row.category),
    icon: String(row.icon ?? 'LayoutTemplate'),
    sections,
    authorId: (row.author_id as string | null) ?? null,
    authorName: (row.author_name as string | null) ?? null,
    usageCount: Number(row.usage_count ?? 0),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    builtin: false,
  }
}

/** Which sections actually carry config in a template. */
export function sectionKeysPresent(sections: TemplateSections): TemplateSectionKey[] {
  return TEMPLATE_SECTION_KEYS.filter((k) => {
    const v = sections[k]
    if (v == null) return false
    if (Array.isArray(v)) return v.length > 0
    return Object.keys(v as Record<string, unknown>).length > 0
  })
}

// ── Per-section human summaries (for the preview / cards) ─────────────────────

function bool(v: unknown): boolean {
  return v === true
}

/** A short, human bullet list describing what a section contains. Pure & best
 *  effort — it reads the known keys but never throws on an unexpected shape. */
export function summarizeSection(key: TemplateSectionKey, value: unknown): string[] {
  const out: string[] = []
  const v = (value ?? {}) as Record<string, unknown>
  try {
    switch (key) {
      case 'automations': {
        const welcome = v.welcome as Record<string, unknown> | undefined
        const goodbye = v.goodbye as Record<string, unknown> | undefined
        const autoRole = v.auto_role as Record<string, unknown> | undefined
        out.push(`Welcome message ${bool(welcome?.enabled) ? 'on' : 'off'}`)
        out.push(`Goodbye message ${bool(goodbye?.enabled) ? 'on' : 'off'}`)
        out.push(`Auto-role ${bool(autoRole?.enabled) ? 'on' : 'off'}`)
        break
      }
      case 'moderation': {
        const alerts = v.moderation_alerts as Record<string, unknown> | undefined
        out.push(`Mod alerts ${bool(alerts?.enabled) ? 'enabled' : 'disabled'}`)
        break
      }
      case 'pulse': {
        const rules = v.rules as Record<string, unknown> | undefined
        const channels = v.channels_reference as Record<string, unknown> | undefined
        if (rules) out.push(`Rules ${bool(rules.enabled) ? 'configured' : 'off'}`)
        if (channels) {
          const structure = (channels.structure as unknown[] | undefined) ?? []
          out.push(`Channel guide (${structure.length} categories)`)
        }
        break
      }
      case 'onboarding': {
        const ob = v.onboarding as Record<string, unknown> | undefined
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
      case 'roles': {
        const roles = (value as TemplateRole[] | undefined) ?? []
        out.push(`${roles.length} role${roles.length === 1 ? '' : 's'}`)
        break
      }
    }
  } catch {
    // Unknown/legacy shape — fall through to the generic line below.
  }
  if (out.length === 0) out.push('Configured')
  return out
}

/** Count of roles in a template (0 if the section is absent). */
export function templateRoleCount(t: ServerTemplate): number {
  return Array.isArray(t.sections.roles) ? t.sections.roles.length : 0
}

// ── Import / export ──────────────────────────────────────────────────────────

export type TemplateExport = {
  pulsifyTemplate: typeof TEMPLATE_EXPORT_VERSION
  name: string
  description: string | null
  category: TemplateCategory
  icon: string
  sections: TemplateSections
  exportedAt: string
}

export function toExport(t: ServerTemplate): TemplateExport {
  return {
    pulsifyTemplate: TEMPLATE_EXPORT_VERSION,
    name: t.name,
    description: t.description,
    category: t.category,
    icon: t.icon,
    sections: t.sections,
    exportedAt: new Date().toISOString(),
  }
}

export type ImportResult =
  | { ok: true; value: { name: string; description: string | null; category: TemplateCategory; icon: string; sections: TemplateSections }; warnings: string[] }
  | { ok: false; error: string }

/** Validate a parsed JSON object as an importable template. Tolerant of a bare
 *  `sections` object (no envelope) and of unknown future minor additions. */
export function validateTemplateImport(input: unknown): ImportResult {
  if (input == null || typeof input !== 'object') {
    return { ok: false, error: 'File is not a JSON object.' }
  }
  const obj = input as Record<string, unknown>
  const warnings: string[] = []

  // Accept either the export envelope or a bare { name?, sections } object.
  const version = obj.pulsifyTemplate
  if (version != null && Number(version) > TEMPLATE_EXPORT_VERSION) {
    warnings.push('This file was exported by a newer version of Pulsify — some settings may be ignored.')
  }

  const rawSections = (obj.sections ?? obj) as Record<string, unknown>
  const sections: TemplateSections = {}
  for (const key of TEMPLATE_SECTION_KEYS) {
    const val = rawSections[key]
    if (val == null) continue
    if (key === 'roles') {
      if (!Array.isArray(val)) {
        warnings.push('Skipped role structure — expected a list of roles.')
        continue
      }
      const roles: TemplateRole[] = []
      for (const r of val as Record<string, unknown>[]) {
        if (!r || typeof r.name !== 'string') continue
        roles.push({
          name: String(r.name).slice(0, 100),
          color: Number.isFinite(Number(r.color)) ? Number(r.color) : 0,
          hoist: r.hoist === true,
          mentionable: r.mentionable === true,
          permissions: typeof r.permissions === 'string' ? r.permissions : '0',
        })
      }
      if (roles.length) sections.roles = roles.slice(0, TEMPLATE_LIMITS.maxRoles)
      continue
    }
    if (typeof val === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(sections as any)[key] = val
    }
  }

  if (sectionKeysPresent(sections).length === 0) {
    return { ok: false, error: 'No recognisable configuration sections found in this file.' }
  }

  const name =
    typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim().slice(0, TEMPLATE_LIMITS.nameMax)
      : 'Imported template'
  const description =
    typeof obj.description === 'string' ? obj.description.slice(0, TEMPLATE_LIMITS.descriptionMax) : null
  const category = asCategory(obj.category)
  const icon = typeof obj.icon === 'string' ? obj.icon : CATEGORY_META[category].icon

  return { ok: true, value: { name, description, category, icon, sections }, warnings }
}

// ── Draft validation ─────────────────────────────────────────────────────────

export function validateDraft(draft: TemplateDraft): string | null {
  if (!draft.name.trim()) return 'Give the template a name.'
  if (draft.name.length > TEMPLATE_LIMITS.nameMax)
    return `Name must be ${TEMPLATE_LIMITS.nameMax} characters or fewer.`
  if (draft.description.length > TEMPLATE_LIMITS.descriptionMax)
    return `Description must be ${TEMPLATE_LIMITS.descriptionMax} characters or fewer.`
  if (draft.sectionKeys.length === 0) return 'Select at least one section to capture.'
  return null
}

// ── Built-in presets ─────────────────────────────────────────────────────────
// Official, in-code templates that ship with the app. They carry no server
// IDs — channel/role references are left blank so they apply cleanly to any
// server (the admin wires them up afterwards). Role structures are created on
// apply. Mirrors the AutomationSettings / AIModerationSettings / ticket_configs
// shapes the apply path writes to.

const guardCategories = (
  overrides: Partial<Record<string, { enabled: boolean; action: string }>> = {},
) => ({
  spam: { enabled: true, action: 'delete' },
  scam: { enabled: true, action: 'delete' },
  phishing: { enabled: true, action: 'delete' },
  toxicity: { enabled: true, action: 'warn' },
  harassment: { enabled: true, action: 'warn' },
  mention_flood: { enabled: true, action: 'timeout' },
  suspicious_invite: { enabled: true, action: 'delete' },
  nsfw: { enabled: true, action: 'flag' },
  ...overrides,
})

const welcomeBlock = (message: string) => ({
  enabled: true,
  channel_id: '',
  message,
  type: 'message' as const,
})

const goodbyeBlock = (message: string) => ({
  enabled: true,
  channel_id: '',
  message,
  type: 'message' as const,
})

const guardSettings = (
  sensitivity: 'low' | 'medium' | 'aggressive',
  categories: ReturnType<typeof guardCategories>,
) => ({
  enabled: true,
  sensitivity,
  settings: {
    enabled: true,
    sensitivity,
    categories,
    whitelisted_user_ids: [],
    whitelisted_role_ids: [],
    ignored_channel_ids: [],
    alert_channel_id: null,
    timeout_minutes: 10,
    realtime_alerts: true,
    embed_color: '#8b5cf6',
  },
})

const role = (
  name: string,
  color: number,
  opts: { hoist?: boolean; mentionable?: boolean; permissions?: string } = {},
): TemplateRole => ({
  name,
  color,
  hoist: opts.hoist ?? false,
  mentionable: opts.mentionable ?? false,
  permissions: opts.permissions ?? '0',
})

type Preset = Omit<ServerTemplate, 'createdAt' | 'updatedAt' | 'usageCount'> & { usageCount?: number }

const PRESETS: Preset[] = [
  {
    id: 'builtin-gaming',
    guildId: null,
    name: 'Gaming Community',
    description: 'Squad up. LFG roles, game-night welcome, and balanced auto-moderation tuned for banter without the toxicity.',
    category: 'gaming',
    icon: 'Gamepad2',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    sections: {
      automations: {
        welcome: welcomeBlock('GG {user} — welcome to {server}! 🎮 Grab your game roles and find a squad.'),
        goodbye: goodbyeBlock('{user} has left the lobby.'),
        auto_role: { enabled: false, role_id: '' },
      },
      moderation: { moderation_alerts: { enabled: true, channel_id: '' } },
      pulse_guard: guardSettings('medium', guardCategories({ toxicity: { enabled: true, action: 'warn' } })),
      roles: [
        role('Admin', 0xe74c3c, { hoist: true }),
        role('Moderator', 0xe67e22, { hoist: true }),
        role('Content Creator', 0x9b59b6, { hoist: true, mentionable: true }),
        role('Veteran', 0xf1c40f, { hoist: true }),
        role('Member', 0x3498db),
        role('LFG', 0x2ecc71, { mentionable: true }),
      ],
    },
  },
  {
    id: 'builtin-creator',
    guildId: null,
    name: 'Creator Community',
    description: 'For streamers and artists: a warm welcome, subscriber/supporter tiers, and announcement-ready roles.',
    category: 'creator',
    icon: 'Sparkles',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    sections: {
      automations: {
        welcome: welcomeBlock('Welcome to {server}, {user}! ✨ Thanks for supporting the work — pick up your roles and say hi.'),
        goodbye: goodbyeBlock('{user} has left.'),
        auto_role: { enabled: false, role_id: '' },
      },
      moderation: { moderation_alerts: { enabled: true, channel_id: '' } },
      pulse: {
        channels_reference: {
          enabled: true,
          structure: [
            { category: 'Start here', channels: ['welcome', 'announcements', 'rules'] },
            { category: 'Community', channels: ['general', 'fan-art', 'clips'] },
            { category: 'Supporters', channels: ['supporter-lounge', 'behind-the-scenes'] },
          ],
        },
      },
      pulse_guard: guardSettings('medium', guardCategories()),
      roles: [
        role('Admin', 0xe74c3c, { hoist: true }),
        role('Moderator', 0xe67e22, { hoist: true }),
        role('Supporter', 0xf1c40f, { hoist: true, mentionable: true }),
        role('Subscriber', 0x9b59b6, { hoist: true }),
        role('Member', 0x3498db),
        role('Announcements', 0x1abc9c, { mentionable: true }),
      ],
    },
  },
  {
    id: 'builtin-support',
    guildId: null,
    name: 'Support Server',
    description: 'Ticket-first help desk: a ready-to-go support panel, staff roles, and a clear channel guide.',
    category: 'support',
    icon: 'LifeBuoy',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    sections: {
      automations: {
        welcome: welcomeBlock('Hi {user}, welcome to {server} support. Open a ticket and our team will help you out. 🎫'),
        goodbye: goodbyeBlock('{user} has left.'),
        auto_role: { enabled: false, role_id: '' },
      },
      moderation: { moderation_alerts: { enabled: true, channel_id: '' } },
      tickets: {
        enabled: true,
        panel: {
          title: 'Need help?',
          description: 'Open a ticket and a member of our team will be with you shortly.',
          button_label: 'Open a ticket',
        },
        ticket_types: [
          { id: 'general', label: 'General help', emoji: '❓', description: 'Questions and general support.' },
          { id: 'billing', label: 'Billing', emoji: '💳', description: 'Payments, refunds and subscriptions.' },
          { id: 'bug', label: 'Bug report', emoji: '🐛', description: 'Something is broken.' },
        ],
        support_role_ids: [],
        naming_format: 'ticket-{number}',
        opening_message: 'Thanks for opening a ticket! Please describe your issue and a staff member will respond soon.',
        auto_close: { enabled: true, inactivity_hours: 48 },
        per_user_limit: 2,
        ping_support: true,
      },
      pulse: {
        channels_reference: {
          enabled: true,
          structure: [
            { category: 'Information', channels: ['welcome', 'announcements', 'faq'] },
            { category: 'Support', channels: ['open-a-ticket', 'community-help'] },
          ],
        },
      },
      pulse_guard: guardSettings('medium', guardCategories()),
      roles: [
        role('Admin', 0xe74c3c, { hoist: true }),
        role('Support Lead', 0xe67e22, { hoist: true }),
        role('Support Staff', 0x3498db, { hoist: true, mentionable: true }),
        role('Member', 0x95a5a6),
      ],
    },
  },
  {
    id: 'builtin-startup',
    guildId: null,
    name: 'Startup / Product Community',
    description: 'Rally early adopters: announcements, feedback channels, beta-tester roles and a tidy onboarding.',
    category: 'startup',
    icon: 'Rocket',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    sections: {
      automations: {
        welcome: welcomeBlock('Welcome aboard, {user}! 🚀 {server} is better with you here — check #announcements and share your feedback.'),
        goodbye: goodbyeBlock('{user} has left.'),
        auto_role: { enabled: false, role_id: '' },
      },
      moderation: { moderation_alerts: { enabled: true, channel_id: '' } },
      pulse: {
        channels_reference: {
          enabled: true,
          structure: [
            { category: 'Start here', channels: ['welcome', 'announcements', 'roadmap'] },
            { category: 'Product', channels: ['feedback', 'feature-requests', 'bug-reports'] },
            { category: 'Community', channels: ['general', 'show-and-tell'] },
          ],
        },
      },
      pulse_guard: guardSettings('medium', guardCategories()),
      roles: [
        role('Founder', 0xe74c3c, { hoist: true }),
        role('Team', 0xe67e22, { hoist: true }),
        role('Beta Tester', 0x9b59b6, { hoist: true, mentionable: true }),
        role('Early Adopter', 0xf1c40f, { hoist: true }),
        role('Member', 0x3498db),
        role('Announcements', 0x1abc9c, { mentionable: true }),
      ],
    },
  },
  {
    id: 'builtin-community',
    guildId: null,
    name: 'Large Public Community',
    description: 'Built for scale: aggressive auto-moderation, a full role hierarchy, onboarding and a support panel.',
    category: 'community',
    icon: 'Users',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    sections: {
      automations: {
        welcome: welcomeBlock('Welcome to {server}, {user}! 🎉 Read the rules, grab your roles, and jump into the conversation.'),
        goodbye: goodbyeBlock('{user} has left the community.'),
        auto_role: { enabled: false, role_id: '' },
      },
      moderation: { moderation_alerts: { enabled: true, channel_id: '' } },
      pulse: {
        rules: {
          enabled: true,
          channel_id: '',
          title: 'Server Rules',
          content: '1. Be respectful.\n2. No spam or self-promotion.\n3. Keep content safe-for-work.\n4. Follow Discord’s Terms of Service.\n5. Listen to the staff team.',
        },
        channels_reference: {
          enabled: true,
          structure: [
            { category: 'Information', channels: ['welcome', 'rules', 'announcements'] },
            { category: 'Community', channels: ['general', 'off-topic', 'media'] },
            { category: 'Voice', channels: ['General VC', 'Music', 'AFK'] },
          ],
        },
      },
      tickets: {
        enabled: true,
        panel: {
          title: 'Contact staff',
          description: 'Open a ticket to reach the moderation team privately.',
          button_label: 'Open a ticket',
        },
        ticket_types: [
          { id: 'help', label: 'General help', emoji: '❓', description: 'Questions about the server.' },
          { id: 'report', label: 'Report a member', emoji: '🚩', description: 'Report rule-breaking.' },
        ],
        support_role_ids: [],
        naming_format: 'ticket-{number}',
        opening_message: 'A staff member will be with you shortly. Please describe what you need.',
        auto_close: { enabled: true, inactivity_hours: 72 },
        per_user_limit: 1,
        ping_support: true,
      },
      pulse_guard: guardSettings('aggressive', guardCategories({ nsfw: { enabled: true, action: 'delete' } })),
      roles: [
        role('Owner', 0xe74c3c, { hoist: true }),
        role('Admin', 0xc0392b, { hoist: true }),
        role('Moderator', 0xe67e22, { hoist: true }),
        role('Helper', 0xf39c12, { hoist: true, mentionable: true }),
        role('Active Member', 0x2ecc71, { hoist: true }),
        role('Member', 0x3498db),
        role('Bots', 0x95a5a6),
        role('Muted', 0x607d8b),
      ],
    },
  },
  {
    id: 'builtin-education',
    guildId: null,
    name: 'Education / Study Community',
    description: 'For study groups and classrooms: subject channels, focused study halls, a tutor help desk and roles for teachers, tutors and students.',
    category: 'community',
    icon: 'GraduationCap',
    authorId: null,
    authorName: 'Pulsify',
    builtin: true,
    sections: {
      automations: {
        welcome: welcomeBlock('Welcome to {server}, {user}! 📚 Grab your subject roles, find a study hall, and ask away — we learn together here.'),
        goodbye: goodbyeBlock('{user} has left the class.'),
        auto_role: { enabled: false, role_id: '' },
      },
      moderation: { moderation_alerts: { enabled: true, channel_id: '' } },
      tickets: {
        enabled: true,
        panel: {
          title: 'Need a hand?',
          description: 'Open a ticket to get help from a tutor or ask a private question.',
          button_label: 'Ask for help',
        },
        ticket_types: [
          { id: 'tutoring', label: 'Tutoring', emoji: '🧑‍🏫', description: 'Get one-on-one help with a topic.' },
          { id: 'homework', label: 'Homework help', emoji: '✏️', description: 'Stuck on an assignment?' },
          { id: 'general', label: 'General question', emoji: '❓', description: 'Anything else.' },
        ],
        support_role_ids: [],
        naming_format: 'help-{number}',
        opening_message: 'Thanks for reaching out! Describe what you’re working on and a tutor will join shortly.',
        auto_close: { enabled: true, inactivity_hours: 48 },
        per_user_limit: 2,
        ping_support: true,
      },
      pulse: {
        rules: {
          enabled: true,
          channel_id: '',
          title: 'Community Guidelines',
          content: '1. Be kind and patient — everyone is learning.\n2. No cheating or sharing exam answers.\n3. Keep channels on-topic.\n4. Give credit and cite your sources.\n5. Respect study-hall focus time.',
        },
        channels_reference: {
          enabled: true,
          structure: [
            { category: 'Start here', channels: ['welcome', 'announcements', 'rules'] },
            { category: 'Subjects', channels: ['math', 'science', 'languages', 'humanities'] },
            { category: 'Study halls', channels: ['Focus Room 1', 'Focus Room 2', 'Group Study'] },
            { category: 'Community', channels: ['general', 'off-topic', 'resources'] },
          ],
        },
      },
      pulse_guard: guardSettings('medium', guardCategories()),
      roles: [
        role('Admin', 0xe74c3c, { hoist: true }),
        role('Moderator', 0xe67e22, { hoist: true }),
        role('Teacher', 0x9b59b6, { hoist: true, mentionable: true }),
        role('Tutor', 0x3498db, { hoist: true, mentionable: true }),
        role('Student', 0x2ecc71, { hoist: true }),
        role('Member', 0x95a5a6),
      ],
    },
  },
]

/** The official preset library, presented as ServerTemplates with stable
 *  timestamps so list ordering is deterministic. */
export const BUILTIN_TEMPLATES: ServerTemplate[] = PRESETS.map((p) => ({
  ...p,
  usageCount: p.usageCount ?? 0,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
}))

export function findBuiltin(id: string): ServerTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id)
}

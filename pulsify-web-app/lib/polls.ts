// Community Polls & Voting — catalogue + pure helpers (PULSIFY-51).
//
// No JSX / framework / IO imports live here: icons are referenced by lucide
// NAME (resolved in the UI layer), exactly like lib/giveaways.ts and
// lib/tickets.ts. The dashboard and the bot both read/write the `polls` /
// `poll_votes` tables, so the poll-type model, restriction evaluation, vote
// weighting, result computation and the interaction custom_id scheme MUST agree
// between the two — keep this in sync with pulse-bot/src/polls.js the same way
// lib/giveaways.ts ↔ giveaways.js are.

// ── Statuses ──────────────────────────────────────────────────────────────────

export type PollStatus = 'scheduled' | 'active' | 'closed' | 'archived'

export const STATUS_META: Record<
  PollStatus,
  { label: string; icon: string; color: string; order: number }
> = {
  active:    { label: 'Active',    icon: 'Radio',         color: '#22c55e', order: 0 },
  scheduled: { label: 'Scheduled', icon: 'CalendarClock', color: '#3b82f6', order: 1 },
  closed:    { label: 'Closed',    icon: 'CheckCircle2',  color: '#a855f7', order: 2 },
  archived:  { label: 'Archived',  icon: 'Archive',       color: '#94a3b8', order: 3 },
}

export function normaliseStatus(v: unknown): PollStatus {
  return v === 'scheduled' || v === 'active' || v === 'closed' || v === 'archived' ? v : 'active'
}

/** A poll that is still open or waiting to open. */
export function isLiveStatus(status: string): boolean {
  return status === 'active' || status === 'scheduled'
}

// ── Poll types ────────────────────────────────────────────────────────────────

export type PollType = 'single' | 'multiple' | 'yes_no' | 'rating' | 'feature'

export const POLL_TYPE_META: Record<
  PollType,
  { label: string; icon: string; description: string; multi: boolean }
> = {
  single:   { label: 'Single choice',   icon: 'CircleDot',   description: 'Voters pick exactly one option.', multi: false },
  multiple: { label: 'Multiple choice', icon: 'ListChecks',  description: 'Voters pick several options.', multi: true },
  yes_no:   { label: 'Yes / No',        icon: 'ToggleLeft',  description: 'A simple yes-or-no decision.', multi: false },
  rating:   { label: 'Rating',          icon: 'Star',        description: 'Voters rate from 1 to N.', multi: false },
  feature:  { label: 'Feature voting',  icon: 'Sparkles',    description: 'Prioritise features — pick the ones you want.', multi: true },
}

export function normalisePollType(v: unknown): PollType {
  return v === 'single' || v === 'multiple' || v === 'yes_no' || v === 'rating' || v === 'feature' ? v : 'single'
}

// ── Options ─────────────────────────────────────────────────────────────────

export type PollOption = { id: string; label: string; emoji?: string }

export const POLL_LIMITS = {
  maxTitle: 200,
  maxDescription: 1500,
  maxOptions: 10,
  minOptions: 2,
  maxOptionLabel: 80,
  maxRequiredRoles: 10,
  ratingMin: 2,
  ratingMax: 10,
  ratingDefault: 5,
  /** Discord caps a select menu at 25 options; we cap polls lower for clarity. */
  maxDurationMinutes: 60 * 24 * 60,
  minDurationMinutes: 1,
  maxMaxChoices: 10,
} as const

/** Yes/No + rating polls generate their options; the rest carry explicit ones. */
export function optionsForType(type: PollType, explicit: PollOption[], ratingScale: number = POLL_LIMITS.ratingDefault): PollOption[] {
  if (type === 'yes_no') {
    return [
      { id: 'yes', label: 'Yes', emoji: '✅' },
      { id: 'no', label: 'No', emoji: '❌' },
    ]
  }
  if (type === 'rating') {
    const scale = clampNum(ratingScale, POLL_LIMITS.ratingMin, POLL_LIMITS.ratingMax, POLL_LIMITS.ratingDefault)
    return Array.from({ length: scale }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }))
  }
  return explicit
}

export function normaliseOptions(raw: unknown): PollOption[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PollOption[] = []
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue
    const r = o as Record<string, unknown>
    const id = typeof r.id === 'string' && r.id ? r.id : slug(String(r.label ?? ''))
    if (!id || seen.has(id)) continue
    const label = String(r.label ?? id).slice(0, POLL_LIMITS.maxOptionLabel)
    if (!label.trim()) continue
    seen.add(id)
    out.push({ id, label, ...(typeof r.emoji === 'string' && r.emoji ? { emoji: r.emoji } : {}) })
    if (out.length >= POLL_LIMITS.maxOptions) break
  }
  return out
}

// ── Voting restrictions ───────────────────────────────────────────────────────
// Evaluated by the bot when a member votes. All fields optional — empty means
// "anyone may vote".

export type RequiredRoleMode = 'any' | 'all'

export type PollRequirements = {
  required_role_ids: string[]
  required_role_mode: RequiredRoleMode
  /** Discord account must be at least this many days old. */
  min_account_age_days: number
  /** Member must be at least this leveling level (member_levels). */
  min_level: number
  /** Member's 0-100 reputation must be at least this. */
  min_reputation: number
}

export function defaultRequirements(): PollRequirements {
  return {
    required_role_ids: [],
    required_role_mode: 'any',
    min_account_age_days: 0,
    min_level: 0,
    min_reputation: 0,
  }
}

export function normaliseRequirements(raw: unknown): PollRequirements {
  const base = defaultRequirements()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  return {
    required_role_ids: toStringArray(r.required_role_ids).slice(0, POLL_LIMITS.maxRequiredRoles),
    required_role_mode: r.required_role_mode === 'all' ? 'all' : 'any',
    min_account_age_days: clampNum(r.min_account_age_days, 0, 3650, 0),
    min_level: clampNum(r.min_level, 0, 1000, 0),
    min_reputation: clampNum(r.min_reputation, 0, 100, 0),
  }
}

export function hasRequirements(req: PollRequirements): boolean {
  return (
    req.required_role_ids.length > 0 ||
    req.min_account_age_days > 0 ||
    req.min_level > 0 ||
    req.min_reputation > 0
  )
}

// Facts the bot resolves about a voter — kept as a plain shape so the rule is
// pure and unit-testable on either side.
export type VoterFacts = {
  roleIds: string[]
  accountCreatedAt: Date
  level: number
  reputation: number
}

export type EligibilityResult = { ok: true } | { ok: false; reason: string }

/**
 * Decide whether a member may vote, given their facts. Pure — the bot resolves
 * the facts and calls this; the dashboard uses the same function to describe
 * restrictions. Returns the FIRST failing reason so the member gets one clear
 * message. MIRRORED in pulse-bot/src/polls.js.
 */
export function checkEligibility(req: PollRequirements, facts: VoterFacts, now: Date = new Date()): EligibilityResult {
  if (req.required_role_ids.length > 0) {
    const held = req.required_role_ids.filter((r) => facts.roleIds.includes(r))
    const ok = req.required_role_mode === 'all' ? held.length === req.required_role_ids.length : held.length > 0
    if (!ok) {
      return {
        ok: false,
        reason:
          req.required_role_mode === 'all'
            ? 'You need all of the required roles to vote in this poll.'
            : 'You need one of the required roles to vote in this poll.',
      }
    }
  }
  if (req.min_account_age_days > 0) {
    const ageDays = daysBetween(facts.accountCreatedAt, now)
    if (ageDays < req.min_account_age_days) {
      return { ok: false, reason: `Your Discord account must be at least ${req.min_account_age_days} day${req.min_account_age_days === 1 ? '' : 's'} old to vote.` }
    }
  }
  if (req.min_level > 0 && facts.level < req.min_level) {
    return { ok: false, reason: `You must be at least level ${req.min_level} in this server to vote.` }
  }
  if (req.min_reputation > 0 && facts.reputation < req.min_reputation) {
    return { ok: false, reason: `You need a reputation of at least ${req.min_reputation} to vote.` }
  }
  return { ok: true }
}

/** Human-readable list of a poll's restrictions, one phrase per active gate. */
export function describeRequirements(req: PollRequirements, resolveRole?: (id: string) => string): string[] {
  const out: string[] = []
  if (req.required_role_ids.length > 0) {
    const mode = req.required_role_mode === 'all' ? 'all' : 'any'
    if (resolveRole) {
      const names = req.required_role_ids.map(resolveRole)
      out.push(names.length === 1 ? `Required role: ${names[0]}` : `Required roles (${mode}): ${names.join(', ')}`)
    } else {
      const n = req.required_role_ids.length
      out.push(n === 1 ? 'Required role' : `Required roles: ${mode} of ${n}`)
    }
  }
  if (req.min_account_age_days > 0) out.push(`Account age: ${req.min_account_age_days}+ ${req.min_account_age_days === 1 ? 'day' : 'days'}`)
  if (req.min_level > 0) out.push(`Level: ${req.min_level}+`)
  if (req.min_reputation > 0) out.push(`Reputation: ${req.min_reputation}+`)
  return out
}

// ── Governance ──────────────────────────────────────────────────────────────

export type WeightBasis = 'reputation' | 'level'

export type PollGovernance = {
  /** Weight votes by the chosen basis instead of one-member-one-vote. */
  weighted: boolean
  /** What drives the weight when `weighted`. */
  weight_basis: WeightBasis
  /** A winning option must reach this share of votes (0-100) to be "approved". 0 = off. */
  approval_threshold: number
  /** Minimum distinct voters for the poll to "count". 0 = off. */
  min_participation: number
}

export function defaultGovernance(): PollGovernance {
  return { weighted: false, weight_basis: 'reputation', approval_threshold: 0, min_participation: 0 }
}

export function normaliseGovernance(raw: unknown): PollGovernance {
  const base = defaultGovernance()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  return {
    weighted: Boolean(r.weighted),
    weight_basis: r.weight_basis === 'level' ? 'level' : 'reputation',
    approval_threshold: clampNum(r.approval_threshold, 0, 100, 0),
    min_participation: clampNum(r.min_participation, 0, 1_000_000, 0),
  }
}

export function hasGovernance(g: PollGovernance): boolean {
  return g.weighted || g.approval_threshold > 0 || g.min_participation > 0
}

/**
 * The weight a single voter's ballot carries. One-member-one-vote (1) unless
 * weighted governance is on, in which case it scales with reputation (0-100) or
 * level. Always ≥1. MIRRORED in pulse-bot/src/polls.js.
 */
export function voteWeight(g: PollGovernance, facts: { level: number; reputation: number }): number {
  if (!g.weighted) return 1
  if (g.weight_basis === 'level') return Math.max(1, 1 + Math.floor((facts.level || 0) / 5))
  return Math.max(1, 1 + Math.floor((facts.reputation || 0) / 20))
}

// ── Results computation (pure) ────────────────────────────────────────────────

export type VoteRow = { user_id: string; option_id: string; weight: number }

export type OptionResult = { id: string; label: string; votes: number; pct: number }

export type PollResults = {
  options: OptionResult[]
  /** Option id(s) with the most weighted votes (ties keep all). */
  winner_ids: string[]
  total_votes: number
  total_voters: number
  /** True when the leading option's share ≥ approval_threshold (or threshold off). */
  approved: boolean
  /** True when distinct voters ≥ min_participation (or off). */
  participation_met: boolean
}

/**
 * Tally weighted votes per option and derive the winner, approval and
 * participation outcomes. Pure — fed the poll's options + governance and the
 * raw vote rows. MIRRORED in pulse-bot/src/polls.js.
 */
export function computeResults(options: PollOption[], governance: PollGovernance, votes: VoteRow[]): PollResults {
  const tally = new Map<string, number>()
  for (const o of options) tally.set(o.id, 0)
  const voters = new Set<string>()
  let totalWeight = 0
  for (const v of votes) {
    const w = Math.max(1, Math.floor(Number(v.weight) || 1))
    if (tally.has(v.option_id)) {
      tally.set(v.option_id, (tally.get(v.option_id) ?? 0) + w)
      totalWeight += w
    }
    if (v.user_id) voters.add(v.user_id)
  }

  const optionResults: OptionResult[] = options.map((o) => {
    const votesFor = tally.get(o.id) ?? 0
    return { id: o.id, label: o.label, votes: votesFor, pct: totalWeight > 0 ? Math.round((votesFor / totalWeight) * 100) : 0 }
  })

  const max = optionResults.reduce((m, o) => Math.max(m, o.votes), 0)
  const winner_ids = max > 0 ? optionResults.filter((o) => o.votes === max).map((o) => o.id) : []
  const leadShare = totalWeight > 0 ? (max / totalWeight) * 100 : 0
  const approved = governance.approval_threshold > 0 ? leadShare >= governance.approval_threshold : max > 0
  const participation_met = governance.min_participation > 0 ? voters.size >= governance.min_participation : true

  return {
    options: optionResults,
    winner_ids,
    total_votes: totalWeight,
    total_voters: voters.size,
    approved,
    participation_met,
  }
}

export function normaliseResults(raw: unknown): PollResults | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.options)) return null
  return {
    options: (r.options as unknown[])
      .map((o) => {
        if (!o || typeof o !== 'object') return null
        const x = o as Record<string, unknown>
        return { id: String(x.id), label: String(x.label ?? x.id), votes: Number(x.votes) || 0, pct: Number(x.pct) || 0 }
      })
      .filter((o): o is OptionResult => o !== null),
    winner_ids: toStringArray(r.winner_ids),
    total_votes: Number(r.total_votes) || 0,
    total_voters: Number(r.total_voters) || 0,
    approved: Boolean(r.approved),
    participation_met: r.participation_met === undefined ? true : Boolean(r.participation_met),
  }
}

// ── Interaction custom_ids (shared with pulse-bot/src/polls.js) ──────────────
// The vote buttons / select menu carry these ids; the BOT handles them. Keep
// identical to the PV constant in pulse-bot/src/polls.js.

export const PV = 'pv'
export const voteButtonId = (pollId: string, optionId: string) => `${PV}:vote:${pollId}:${optionId}`
export const voteSelectId = (pollId: string) => `${PV}:select:${pollId}`

/** Polls with more than this many options use a select menu instead of buttons. */
export const BUTTON_OPTION_LIMIT = 5

/**
 * Resolve whether a poll takes multiple selections and the max picks allowed.
 * Shared by the bot + dashboard so the vote controls render identically.
 */
export function pollControlsMeta(
  type: PollType,
  optionCount: number,
  maxChoices: number,
): { multi: boolean; max: number } {
  const multi = type === 'multiple' || type === 'feature'
  const max = multi ? Math.max(1, Math.min(maxChoices || 1, optionCount)) : 1
  return { multi, max }
}

// ── Poll record (as passed from the server page to the client UI) ─────────────

export type Poll = {
  id: string
  guild_id: string
  title: string
  description: string | null
  poll_type: PollType
  options: PollOption[]
  anonymous: boolean
  allow_change: boolean
  max_choices: number
  channel_id: string
  message_id: string | null
  status: PollStatus
  requirements: PollRequirements
  governance: PollGovernance
  starts_at: string | null
  ends_at: string | null
  vote_count: number
  voter_count: number
  results: PollResults | null
  host_id: string | null
  host_name: string | null
  closed_at: string | null
  created_at: string
}

export type PollVote = {
  id: number
  poll_id: string
  user_id: string
  user_name: string | null
  option_id: string
  weight: number
  voted_at: string
}

export function normalisePoll(row: Record<string, unknown>): Poll {
  const type = normalisePollType(row.poll_type)
  const options = optionsForType(type, normaliseOptions(row.options))
  return {
    id: String(row.id),
    guild_id: String(row.guild_id),
    title: typeof row.title === 'string' ? row.title : 'Poll',
    description: typeof row.description === 'string' ? row.description : null,
    poll_type: type,
    options,
    anonymous: Boolean(row.anonymous),
    allow_change: row.allow_change === undefined ? true : Boolean(row.allow_change),
    max_choices: clampNum(row.max_choices, 1, POLL_LIMITS.maxMaxChoices, 1),
    channel_id: typeof row.channel_id === 'string' ? row.channel_id : '',
    message_id: typeof row.message_id === 'string' ? row.message_id : null,
    status: normaliseStatus(row.status),
    requirements: normaliseRequirements(row.requirements),
    governance: normaliseGovernance(row.governance),
    starts_at: (row.starts_at as string) ?? null,
    ends_at: (row.ends_at as string) ?? null,
    vote_count: clampNum(row.vote_count, 0, Number.MAX_SAFE_INTEGER, 0),
    voter_count: clampNum(row.voter_count, 0, Number.MAX_SAFE_INTEGER, 0),
    results: normaliseResults(row.results),
    host_id: (row.host_id as string) ?? null,
    host_name: (row.host_name as string) ?? null,
    closed_at: (row.closed_at as string) ?? null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
  }
}

// ── Validation (create / edit) ────────────────────────────────────────────────

export type PollDraft = {
  title: string
  description: string
  poll_type: PollType
  options: PollOption[]
  rating_scale: number
  anonymous: boolean
  allow_change: boolean
  max_choices: number
  channel_id: string
  /** Minutes from publish until the poll auto-closes (0 = stays open until closed). */
  duration_minutes: number
  /** Minutes from now until the poll is PUBLISHED (0 = publish immediately). */
  start_delay_minutes: number
  requirements: PollRequirements
  governance: PollGovernance
}

export function defaultDraft(): PollDraft {
  return {
    title: '',
    description: '',
    poll_type: 'single',
    options: [
      { id: 'opt-1', label: '' },
      { id: 'opt-2', label: '' },
    ],
    rating_scale: POLL_LIMITS.ratingDefault,
    anonymous: false,
    allow_change: true,
    max_choices: 1,
    channel_id: '',
    duration_minutes: 60 * 24,
    start_delay_minutes: 0,
    requirements: defaultRequirements(),
    governance: defaultGovernance(),
  }
}

/** Returns an error string if the draft can't be published, else null. */
export function validateDraft(d: PollDraft): string | null {
  if (!d.title.trim()) return 'Give your poll a question.'
  if (!d.channel_id) return 'Pick a channel to post the poll in.'
  const needsOptions = d.poll_type === 'single' || d.poll_type === 'multiple' || d.poll_type === 'feature'
  if (needsOptions) {
    const filled = d.options.filter((o) => o.label.trim())
    if (filled.length < POLL_LIMITS.minOptions) return `Add at least ${POLL_LIMITS.minOptions} options.`
    if (filled.length > POLL_LIMITS.maxOptions) return `A poll can have at most ${POLL_LIMITS.maxOptions} options.`
  }
  if (d.poll_type === 'rating' && (d.rating_scale < POLL_LIMITS.ratingMin || d.rating_scale > POLL_LIMITS.ratingMax)) {
    return `Rating scale must be between ${POLL_LIMITS.ratingMin} and ${POLL_LIMITS.ratingMax}.`
  }
  if (d.duration_minutes < 0 || d.duration_minutes > POLL_LIMITS.maxDurationMinutes) {
    return 'A poll can run for at most 60 days.'
  }
  if ((d.poll_type === 'multiple' || d.poll_type === 'feature') && d.max_choices < 1) {
    return 'Allow at least one selection.'
  }
  return null
}

/** Resolve the option set + max_choices a draft will be stored with. */
export function resolveDraftOptions(d: PollDraft): { options: PollOption[]; max_choices: number } {
  const explicit = normaliseOptions(d.options.filter((o) => o.label.trim()))
  const options = optionsForType(d.poll_type, explicit, d.rating_scale)
  const multi = POLL_TYPE_META[d.poll_type].multi
  const max_choices = multi ? clampNum(d.max_choices, 1, options.length || POLL_LIMITS.maxMaxChoices, options.length) : 1
  return { options, max_choices }
}

// ── Presets (built-in templates that pre-fill the create form) ───────────────

export type PollPreset = {
  id: string
  label: string
  icon: string
  draft: Partial<PollDraft> & { poll_type: PollType }
}

export const POLL_PRESETS: PollPreset[] = [
  {
    id: 'quick',
    label: 'Quick question',
    icon: 'CircleDot',
    draft: {
      poll_type: 'single',
      title: 'Which do you prefer?',
      options: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
        { id: 'c', label: 'Option C' },
      ],
      duration_minutes: 60 * 24,
    },
  },
  {
    id: 'decision',
    label: 'Yes / No decision',
    icon: 'ToggleLeft',
    draft: {
      poll_type: 'yes_no',
      title: 'Should we go ahead with this?',
      description: 'Cast your vote — majority decides.',
      duration_minutes: 60 * 24 * 2,
      governance: { weighted: false, weight_basis: 'reputation', approval_threshold: 60, min_participation: 0 },
    },
  },
  {
    id: 'feature',
    label: 'Feature voting',
    icon: 'Sparkles',
    draft: {
      poll_type: 'feature',
      title: 'What should we build next?',
      description: 'Pick the features you want most — vote for as many as you like.',
      options: [
        { id: 'f1', label: 'Feature one' },
        { id: 'f2', label: 'Feature two' },
        { id: 'f3', label: 'Feature three' },
        { id: 'f4', label: 'Feature four' },
      ],
      max_choices: 2,
      duration_minutes: 60 * 24 * 7,
    },
  },
  {
    id: 'rating',
    label: 'Rating',
    icon: 'Star',
    draft: {
      poll_type: 'rating',
      title: 'How would you rate the last event?',
      rating_scale: 5,
      duration_minutes: 60 * 24 * 3,
    },
  },
  {
    id: 'governance',
    label: 'Governance proposal',
    icon: 'Landmark',
    draft: {
      poll_type: 'yes_no',
      title: 'Community proposal',
      description: 'A formal proposal — reputation-weighted, with an approval threshold.',
      duration_minutes: 60 * 24 * 5,
      governance: { weighted: true, weight_basis: 'reputation', approval_threshold: 66, min_participation: 10 },
      requirements: { required_role_ids: [], required_role_mode: 'any', min_account_age_days: 7, min_level: 0, min_reputation: 0 },
    },
  },
]

// ── Analytics (pure, derived from the loaded rows) ────────────────────────────

export type PollStats = {
  total: number
  active: number
  scheduled: number
  closed: number
  archived: number
  totalVotes: number
  totalVoters: number
  /** Mean voters across polls that have actually run (active + closed). */
  avgVoters: number
  /** Polls with the most voters (top 5). */
  topByVoters: { id: string; title: string; voters: number }[]
  /** Daily poll + vote counts over the last `days` days (oldest → newest). */
  series: { date: string; polls: number; votes: number }[]
  /** Share of closed polls that reached their participation threshold, 0-100. */
  participationRate: number
}

export function computePollStats(polls: Poll[], days = 14): PollStats {
  let active = 0
  let scheduled = 0
  let closed = 0
  let archived = 0
  let totalVotes = 0
  let totalVoters = 0
  let runCount = 0
  let closedMetParticipation = 0

  for (const p of polls) {
    if (p.status === 'active') active++
    else if (p.status === 'scheduled') scheduled++
    else if (p.status === 'closed') closed++
    else if (p.status === 'archived') archived++

    totalVotes += p.vote_count
    totalVoters += p.voter_count
    if (p.status === 'active' || p.status === 'closed') runCount++
    if (p.status === 'closed' && (p.results?.participation_met ?? true)) closedMetParticipation++
  }

  const topByVoters = [...polls]
    .sort((a, b) => b.voter_count - a.voter_count)
    .slice(0, 5)
    .map((p) => ({ id: p.id, title: p.title, voters: p.voter_count }))

  const series: { date: string; polls: number; votes: number }[] = []
  const dayMs = 86_400_000
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const buckets = new Map<string, { polls: number; votes: number }>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(startOfToday.getTime() - i * dayMs)
    buckets.set(d.toISOString().slice(0, 10), { polls: 0, votes: 0 })
  }
  for (const p of polls) {
    const b = buckets.get(p.created_at.slice(0, 10))
    if (b) {
      b.polls++
      b.votes += p.vote_count
    }
  }
  for (const [date, v] of buckets) series.push({ date, ...v })

  return {
    total: polls.length,
    active,
    scheduled,
    closed,
    archived,
    totalVotes,
    totalVoters,
    avgVoters: runCount > 0 ? Math.round(totalVoters / runCount) : 0,
    topByVoters,
    series,
    participationRate: closed > 0 ? Math.round((closedMetParticipation / closed) * 100) : 0,
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000))
  if (totalMin < 60) return `${totalMin}m`
  const totalHr = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (totalHr < 24) return min > 0 ? `${totalHr}h ${min}m` : `${totalHr}h`
  const dys = Math.floor(totalHr / 24)
  const hr = totalHr % 24
  return hr > 0 ? `${dys}d ${hr}h` : `${dys}d`
}

export function formatCountdown(targetIso: string, now: number = Date.now()): string {
  const ms = new Date(targetIso).getTime() - now
  if (ms <= 0) return 'closing now'
  return `in ${formatDuration(ms)}`
}

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

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000)
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

/**
 * Pulse Guard — shared types, defaults, and the message-analysis pipeline.
 *
 * Two-stage detection: cheap deterministic heuristics first (invite links,
 * mention floods, known phishing keywords) and an optional LLM pass for the
 * fuzzier categories (toxicity, harassment, NSFW prose). Heuristics ALWAYS
 * run so the dashboard works even when the AI provider is unconfigured.
 */

export const SENSITIVITY_LEVELS = ['low', 'medium', 'aggressive'] as const
export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number]

/** Threshold at which a category counts as a "violation" for the given level. */
export const SENSITIVITY_THRESHOLDS: Record<Sensitivity, number> = {
  low: 0.85,
  medium: 0.65,
  aggressive: 0.45,
}

/**
 * Spam scored only by the LLM (no structural heuristic evidence) must reach
 * this near-certain bar before it counts as a violation. Spam is fundamentally
 * a repetition / volume / advertising signal, so a small model's "this reads
 * spammy" judgement on a single, normal-looking message — especially in a
 * language it parses poorly — must not be enough to auto-delete. Structural
 * spam (repeated characters, wall-of-caps) still uses the normal threshold.
 */
export const SPAM_LLM_FLOOR = 0.9

export const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  low: 'Low',
  medium: 'Medium',
  aggressive: 'Aggressive',
}

export const SENSITIVITY_DESCRIPTIONS: Record<Sensitivity, string> = {
  low: 'Only acts on high-confidence violations. Fewer false positives.',
  medium: 'Balanced — catches obvious issues without nagging.',
  aggressive: 'Flags anything borderline. Best paired with manual review.',
}

export const CATEGORY_IDS = [
  'spam',
  'scam',
  'phishing',
  'toxicity',
  'harassment',
  'mention_flood',
  'suspicious_invite',
  'nsfw',
] as const
export type CategoryId = (typeof CATEGORY_IDS)[number]

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  spam: 'Spam',
  scam: 'Scam',
  phishing: 'Phishing',
  toxicity: 'Toxicity',
  harassment: 'Harassment',
  mention_flood: 'Excessive mentions',
  suspicious_invite: 'Suspicious invite',
  nsfw: 'NSFW / inappropriate',
}

export const CATEGORY_DESCRIPTIONS: Record<CategoryId, string> = {
  spam: 'Repetitive, low-effort posts and copy-paste flooding.',
  scam: 'Free Nitro, fake giveaways, crypto rug-pulls.',
  phishing: 'Credential-stealing links impersonating Discord, Steam, etc.',
  toxicity: 'Slurs, insults, and aggressive language toward members.',
  harassment: 'Targeted attacks, doxxing threats, repeated unwanted contact.',
  mention_flood: 'Pinging large numbers of users or @everyone abuse.',
  suspicious_invite: 'Invites to unrelated or known bad servers.',
  nsfw: 'Sexual content and other content disallowed in safe-for-work channels.',
}

export const CATEGORY_COLORS: Record<CategoryId, string> = {
  spam: '#60a5fa',
  scam: '#f97316',
  phishing: '#ef4444',
  toxicity: '#a855f7',
  harassment: '#ec4899',
  mention_flood: '#f59e0b',
  suspicious_invite: '#facc15',
  nsfw: '#fb7185',
}

export type AutoAction = 'none' | 'flag' | 'delete' | 'warn' | 'timeout'

export const AUTO_ACTION_LABELS: Record<AutoAction, string> = {
  none: 'No action',
  flag: 'Flag for review',
  delete: 'Delete message',
  warn: 'Warn member',
  timeout: 'Timeout member',
}

export type CategoryConfig = {
  enabled: boolean
  /** What the bot does when this category is flagged above threshold. */
  action: AutoAction
}

export type AIModerationSettings = {
  enabled: boolean
  sensitivity: Sensitivity
  categories: Record<CategoryId, CategoryConfig>
  /** Discord user IDs whose messages are never analysed. */
  whitelisted_user_ids: string[]
  /** Discord role IDs whose holders bypass analysis. */
  whitelisted_role_ids: string[]
  /** Discord channel IDs that are never analysed. */
  ignored_channel_ids: string[]
  /** Channel that receives real-time alerts. */
  alert_channel_id: string | null
  /** Minutes to time members out for when `action = timeout`. */
  timeout_minutes: number
  /** Notify the dashboard activity feed on flagged content. */
  realtime_alerts: boolean
  /**
   * Accent colour for Pulse Guard Discord alerts (hex, e.g. '#8b5cf6'). Used
   * as the V2 Container accent stripe so every guild can match its brand.
   */
  embed_color: string
}

export const DEFAULT_CATEGORY_CONFIG: Record<CategoryId, CategoryConfig> = {
  spam: { enabled: true, action: 'delete' },
  scam: { enabled: true, action: 'delete' },
  phishing: { enabled: true, action: 'delete' },
  toxicity: { enabled: true, action: 'warn' },
  harassment: { enabled: true, action: 'warn' },
  mention_flood: { enabled: true, action: 'timeout' },
  suspicious_invite: { enabled: true, action: 'delete' },
  nsfw: { enabled: true, action: 'flag' },
}

export const DEFAULT_AI_MODERATION_SETTINGS: AIModerationSettings = {
  enabled: false,
  sensitivity: 'medium',
  categories: DEFAULT_CATEGORY_CONFIG,
  whitelisted_user_ids: [],
  whitelisted_role_ids: [],
  ignored_channel_ids: [],
  alert_channel_id: null,
  timeout_minutes: 10,
  realtime_alerts: true,
  embed_color: '#8b5cf6',
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** Coerce a partial settings blob from the DB into a fully-populated value. */
export function normaliseSettings(
  raw: Partial<AIModerationSettings> | null | undefined,
): AIModerationSettings {
  const base = DEFAULT_AI_MODERATION_SETTINGS
  const incoming = raw ?? {}
  return {
    enabled: incoming.enabled ?? base.enabled,
    sensitivity: SENSITIVITY_LEVELS.includes(incoming.sensitivity as Sensitivity)
      ? (incoming.sensitivity as Sensitivity)
      : base.sensitivity,
    categories: Object.fromEntries(
      CATEGORY_IDS.map((id) => {
        const existing = incoming.categories?.[id]
        return [
          id,
          {
            enabled: existing?.enabled ?? base.categories[id].enabled,
            action: existing?.action ?? base.categories[id].action,
          },
        ]
      }),
    ) as Record<CategoryId, CategoryConfig>,
    whitelisted_user_ids: incoming.whitelisted_user_ids ?? [],
    whitelisted_role_ids: incoming.whitelisted_role_ids ?? [],
    ignored_channel_ids: incoming.ignored_channel_ids ?? [],
    alert_channel_id: incoming.alert_channel_id ?? null,
    timeout_minutes: Math.max(1, Math.min(40320, incoming.timeout_minutes ?? base.timeout_minutes)),
    realtime_alerts: incoming.realtime_alerts ?? base.realtime_alerts,
    embed_color:
      typeof incoming.embed_color === 'string' && HEX_COLOR_RE.test(incoming.embed_color)
        ? incoming.embed_color
        : base.embed_color,
  }
}

export type CategoryScore = {
  id: CategoryId
  label: string
  /** 0–1. */
  score: number
}

export type AnalysisVerdict = {
  /** All categories with score > 0, sorted desc. */
  categories: CategoryScore[]
  /** Highest-scoring category — null if nothing tripped. */
  topCategory: CategoryId | null
  /** Score of the top category. */
  confidence: number
  /** low | medium | high — derived from confidence + category. */
  severity: 'low' | 'medium' | 'high'
  /** Short human-readable explanation, blended from heuristic hits + AI reasoning. */
  reasoning: string
  /**
   * Individual deterministic hits that contributed — e.g. "shouting (mostly
   * caps)", "1 invite link". UI can render them as a chip row separate from
   * the AI prose.
   */
  heuristicHits: string[]
  /** Raw AI explanation, if the LLM ran. Null when only heuristics fired. */
  aiReasoning: string | null
  /** Whether `confidence >= threshold[sensitivity]` for the top category. */
  violates: boolean
}

const SCAM_KEYWORDS = [
  'free nitro', 'free discord', 'steam gift', 'steamcommnunity',
  'claim your', 'limited offer', 'crypto airdrop', 'wallet connect',
  'free robux', '100% legit', 'congratulations you won',
]

const PHISHING_KEYWORDS = [
  'verify your account', 'account suspended', 'login required',
  'click here to claim', 'urgent action required',
  'discord-gift', 'discordapp.gift', 'steamcomnunity',
  'discrod.gg', 'discordnitro.gift',
]

const TOXIC_PATTERNS = [
  /\bkys\b/i,
  /\bk[i!1]ll yourself\b/i,
  /\bn[i!1]gg(?:er|a)\b/i,
  /\bf[a@]gg?[o0]t\b/i,
  /\bret[a@]rd(?:ed)?\b/i,
]

const NSFW_KEYWORDS = [
  'onlyfans', 'nudes', 'porn', 'sex chat', 'horny',
  'cp link', 'rule34', 'hentai server',
]

const INVITE_REGEX = /(?:discord\.(?:gg|com\/invite)|discordapp\.com\/invite)\/[a-zA-Z0-9-]+/gi
const LINK_REGEX = /https?:\/\/[^\s]+/gi
const MENTION_REGEX = /<@!?\d+>|@everyone|@here/g
const EXCESSIVE_REPEAT_REGEX = /(.)\1{9,}/

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return Math.round(n * 100) / 100
}

/** Deterministic, regex-driven first pass. Always runs. */
export function heuristicScores(content: string, mentionCount = 0): {
  scores: Partial<Record<CategoryId, number>>
  hits: string[]
} {
  const text = content.toLowerCase()
  const scores: Partial<Record<CategoryId, number>> = {}
  const hits: string[] = []

  // Spam — long repeats / wall-of-caps.
  if (EXCESSIVE_REPEAT_REGEX.test(content)) {
    scores.spam = Math.max(scores.spam ?? 0, 0.7)
    hits.push('repeated characters')
  }
  if (content.length > 40) {
    const upper = (content.match(/[A-Z]/g) ?? []).length
    const ratio = upper / content.length
    if (ratio > 0.6) {
      scores.spam = Math.max(scores.spam ?? 0, 0.55)
      hits.push('shouting (mostly caps)')
    }
  }

  // Mention flood — counts @user / @everyone / @here.
  const inlineMentions = (content.match(MENTION_REGEX) ?? []).length
  const totalMentions = inlineMentions + mentionCount
  if (totalMentions >= 5) {
    scores.mention_flood = Math.max(scores.mention_flood ?? 0, Math.min(1, 0.5 + totalMentions * 0.05))
    hits.push(`${totalMentions} mentions`)
  }
  if (/@everyone|@here/.test(content)) {
    scores.mention_flood = Math.max(scores.mention_flood ?? 0, 0.85)
    hits.push('mass mention')
  }

  // Invite links.
  const invites = content.match(INVITE_REGEX) ?? []
  if (invites.length > 0) {
    scores.suspicious_invite = Math.max(scores.suspicious_invite ?? 0, 0.6 + Math.min(0.3, invites.length * 0.15))
    hits.push(`${invites.length} invite link${invites.length === 1 ? '' : 's'}`)
  }

  // Scam / phishing keyword hits.
  let scamHits = 0
  for (const k of SCAM_KEYWORDS) if (text.includes(k)) scamHits++
  if (scamHits > 0) {
    scores.scam = Math.max(scores.scam ?? 0, Math.min(1, 0.55 + scamHits * 0.15))
    hits.push(`${scamHits} scam keyword${scamHits === 1 ? '' : 's'}`)
  }

  let phishHits = 0
  for (const k of PHISHING_KEYWORDS) if (text.includes(k)) phishHits++
  // Suspicious link impersonating Discord / Steam.
  const links = content.match(LINK_REGEX) ?? []
  for (const l of links) {
    if (/disc[oO]rd[^.]*\.(gift|app|nitro)/i.test(l) && !/^https?:\/\/(www\.)?discord\.(com|gg)\//i.test(l)) {
      phishHits++
    }
  }
  if (phishHits > 0) {
    scores.phishing = Math.max(scores.phishing ?? 0, Math.min(1, 0.6 + phishHits * 0.15))
    hits.push(`${phishHits} phishing signal${phishHits === 1 ? '' : 's'}`)
  }

  // Toxic / harassment — slur and "kill yourself" hits.
  let toxicHits = 0
  for (const p of TOXIC_PATTERNS) if (p.test(content)) toxicHits++
  if (toxicHits > 0) {
    scores.toxicity = Math.max(scores.toxicity ?? 0, Math.min(1, 0.7 + toxicHits * 0.1))
    hits.push('slur / toxic phrase')
  }

  // NSFW keyword sweep.
  let nsfwHits = 0
  for (const k of NSFW_KEYWORDS) if (text.includes(k)) nsfwHits++
  if (nsfwHits > 0) {
    scores.nsfw = Math.max(scores.nsfw ?? 0, Math.min(1, 0.55 + nsfwHits * 0.15))
    hits.push(`${nsfwHits} NSFW keyword${nsfwHits === 1 ? '' : 's'}`)
  }

  return { scores, hits }
}

/**
 * Optional LLM pass. Returns merged scores when the env is configured;
 * silently falls back to the input heuristics when the provider is
 * unavailable. The caller only needs `analyzeContent`.
 */
async function llmScores(
  content: string,
  enabledCategories: CategoryId[],
): Promise<{ scores: Partial<Record<CategoryId, number>>; reasoning?: string } | null> {
  if (!process.env.AI_API_KEY) return null
  if (enabledCategories.length === 0) return null

  const AI_BASE_URL = process.env.AI_BASE_URL ?? 'https://api.groq.com/openai/v1'
  const AI_MODEL = process.env.AI_MODEL ?? 'llama-3.1-8b-instant'

  const systemPrompt = `You are a careful Discord moderation classifier. For one message you assign each requested category a score from 0.0 (clearly does NOT apply) to 1.0 (clearly applies).

Be conservative — the vast majority of chat is harmless and must score near 0.0. Only give a high score when the message itself unambiguously matches the category. When in doubt, score low.

Rules:
- Messages may be in ANY language (English, Croatian, Spanish, slang, etc.). Ordinary conversation, jokes, small talk, gaming/everyday chatter, plans, or venting are NOT violations — score 0.0 even if the text looks odd to you or you can't fully parse it. Do not penalise a message for being in a language you find hard to read.
- Talking ABOUT a topic is not committing it. Mentioning the words "spam", "scam", "phishing", or discussing moderation is NOT itself a violation.
- spam = low-effort repetitive flooding, copy-paste, or unsolicited advertising. A single ordinary sentence is almost never spam — score it 0.0.
- toxicity / harassment require genuine slurs, insults, or attacks aimed at a person — not mild profanity, banter, or strong opinions.
- scam / phishing require an actual deceptive offer or credential-stealing link, not casual mention.

Respond with raw JSON only — no markdown, no extra text.`

  const categoryList = enabledCategories
    .map((id) => `- ${id}: ${CATEGORY_DESCRIPTIONS[id]}`)
    .join('\n')

  const userPrompt = `Score this message for each category (0.0 = does not apply, 1.0 = clearly applies). Default to 0.0 unless the message clearly matches.

Categories:
${categoryList}

Message:
"""${content.slice(0, 2000)}"""

Return JSON only:
{
  "scores": { ${enabledCategories.map((id) => `"${id}": 0.0`).join(', ')} },
  "reasoning": "one short sentence (mention the language if relevant)"
}`

  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 400,
        temperature: 0.2,
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { choices?: { message: { content: string } }[] }
    const raw = data.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as {
      scores?: Partial<Record<CategoryId, number>>
      reasoning?: string
    }
    const cleaned: Partial<Record<CategoryId, number>> = {}
    for (const id of enabledCategories) {
      const v = parsed.scores?.[id]
      if (typeof v === 'number') cleaned[id] = clampScore(v)
    }
    return { scores: cleaned, reasoning: parsed.reasoning }
  } catch {
    return null
  }
}

export type AnalyzeOptions = {
  /** Pre-stripped Discord mentions outside the text, if known. */
  mentionCount?: number
  /** Override sensitivity for this single call (defaults to settings.sensitivity). */
  sensitivity?: Sensitivity
  /** Skip the LLM pass — useful for tests / "fast" mode in the dashboard. */
  heuristicsOnly?: boolean
}

/** Run the full analysis pipeline and return a verdict. */
export async function analyzeContent(
  content: string,
  settings: AIModerationSettings,
  opts: AnalyzeOptions = {},
): Promise<AnalysisVerdict> {
  const sensitivity = opts.sensitivity ?? settings.sensitivity
  const threshold = SENSITIVITY_THRESHOLDS[sensitivity]
  const enabledCategories = CATEGORY_IDS.filter((id) => settings.categories[id]?.enabled)

  const { scores: hScores, hits } = heuristicScores(content, opts.mentionCount)
  let aiReasoning: string | undefined
  const merged: Partial<Record<CategoryId, number>> = { ...hScores }

  if (!opts.heuristicsOnly) {
    // Only ask the LLM about fuzzy categories — heuristics already cover
    // the structural ones (mention floods, invite links) with high recall.
    const fuzzyCategories = enabledCategories.filter((id) =>
      id === 'toxicity' || id === 'harassment' || id === 'scam' || id === 'phishing' || id === 'nsfw' || id === 'spam',
    )
    const ai = await llmScores(content, fuzzyCategories)
    if (ai) {
      aiReasoning = ai.reasoning
      for (const id of fuzzyCategories) {
        const a = ai.scores[id] ?? 0
        const h = merged[id] ?? 0
        merged[id] = clampScore(Math.max(a, h))
      }
    }
  }

  // Drop disabled categories from the final verdict.
  const finalScores: CategoryScore[] = CATEGORY_IDS
    .filter((id) => settings.categories[id]?.enabled)
    .map((id) => ({ id, label: CATEGORY_LABELS[id], score: clampScore(merged[id] ?? 0) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)

  // Spam from the LLM alone is an unreliable single-message signal, so it needs
  // structural evidence (repeated characters / wall-of-caps from the heuristic
  // pass) OR near-certainty before it counts. Everything else uses the plain
  // sensitivity threshold.
  const structuralSpam = (hScores.spam ?? 0) >= 0.5
  const effectiveThreshold = (id: CategoryId): number =>
    id === 'spam' && !structuralSpam ? Math.max(threshold, SPAM_LLM_FLOOR) : threshold

  // The violating category is the highest-scoring one that clears its OWN
  // (possibly raised) threshold — not necessarily the single highest score.
  // This way a dampened spam score can't shadow a genuine toxicity hit, and a
  // borderline spam-only message simply doesn't violate.
  const violatingCategory = finalScores.find((c) => c.score >= effectiveThreshold(c.id)) ?? null
  const violates = violatingCategory !== null

  // Surface the violating category (it drives the action + alert) when there is
  // one; otherwise the closest score, so the dashboard still shows context.
  const top = violatingCategory ?? finalScores[0] ?? null
  const confidence = top?.score ?? 0

  let severity: AnalysisVerdict['severity'] = 'low'
  if (confidence >= 0.85) severity = 'high'
  else if (confidence >= 0.6) severity = 'medium'

  // Severe categories bump the floor — even at 0.5 a phishing link is "high".
  if (top && (top.id === 'phishing' || top.id === 'scam') && confidence >= 0.5) severity = 'high'

  const reasoningParts: string[] = []
  if (hits.length > 0) reasoningParts.push(`Heuristics: ${hits.join(', ')}`)
  if (aiReasoning) reasoningParts.push(`Pulse Guard: ${aiReasoning}`)
  if (reasoningParts.length === 0) {
    reasoningParts.push(top ? `${top.label} likelihood ${Math.round(confidence * 100)}%.` : 'No moderation signals detected.')
  }

  return {
    categories: finalScores,
    topCategory: top?.id ?? null,
    confidence,
    severity,
    reasoning: reasoningParts.join(' · '),
    heuristicHits: hits,
    aiReasoning: aiReasoning ?? null,
    violates,
  }
}

/** Pick the configured action for a given verdict, respecting per-category overrides. */
export function chooseAction(verdict: AnalysisVerdict, settings: AIModerationSettings): AutoAction {
  if (!verdict.violates || !verdict.topCategory) return 'none'
  return settings.categories[verdict.topCategory]?.action ?? 'flag'
}

export const SEVERITY_COLORS: Record<AnalysisVerdict['severity'], string> = {
  low: '#60a5fa',
  medium: '#f59e0b',
  high: '#ef4444',
}

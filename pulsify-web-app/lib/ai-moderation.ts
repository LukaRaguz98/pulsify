/**
 * Pulse Guard — shared types, defaults, and the message-analysis pipeline.
 *
 * Two-stage detection: cheap deterministic heuristics first (invite links,
 * mention floods, malicious-link analysis, known scam/phishing patterns) and an
 * optional LLM pass for the fuzzier categories (toxicity, harassment, NSFW
 * prose, contextual scam). Heuristics ALWAYS run so the dashboard works even
 * when the AI provider is unconfigured.
 *
 * PULSIFY-41 upgrade — every contributing signal is now recorded as a
 * structured `DetectionSignal` (source + category + weight + plain-language
 * label) so the dashboard and Discord alerts can explain *why* a message
 * tripped, a separate confidence band (low/medium/high) is exposed alongside
 * severity, and link/impersonation analysis is materially deeper.
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
  'suspicious_link',
  'impersonation',
  'nsfw',
] as const
export type CategoryId = (typeof CATEGORY_IDS)[number]

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  spam: 'Spam',
  scam: 'Scam',
  phishing: 'Phishing',
  toxicity: 'Toxicity',
  harassment: 'Harassment',
  mention_flood: 'Mass mention abuse',
  suspicious_invite: 'Suspicious invite',
  suspicious_link: 'Suspicious link',
  impersonation: 'Impersonation',
  nsfw: 'NSFW / inappropriate',
}

export const CATEGORY_DESCRIPTIONS: Record<CategoryId, string> = {
  spam: 'Repetitive, low-effort posts and copy-paste flooding.',
  scam: 'Free Nitro, fake giveaways, crypto rug-pulls, money-flip cons.',
  phishing: 'Credential-stealing links impersonating Discord, Steam, etc.',
  toxicity: 'Slurs, insults, and aggressive language toward members.',
  harassment: 'Targeted attacks, doxxing threats, repeated unwanted contact.',
  mention_flood: 'Pinging large numbers of users or @everyone / @here abuse.',
  suspicious_invite: 'Invites to unrelated or known bad servers.',
  suspicious_link: 'Shorteners, lookalike domains, IP links and other risky URLs.',
  impersonation: 'Pretending to be staff, Discord, or an official service.',
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
  suspicious_link: '#eab308',
  impersonation: '#14b8a6',
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
  suspicious_link: { enabled: true, action: 'flag' },
  impersonation: { enabled: true, action: 'delete' },
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

// ── Confidence bands ──────────────────────────────────────────────────────────
// A separate axis from severity. Severity answers "how bad is this category?";
// confidence answers "how sure is Pulse Guard the message matches it?". Mods
// asked for both — a high-severity phishing hit at 50% confidence is a very
// different review than the same hit at 95%.

export type ConfidenceLabel = 'low' | 'medium' | 'high'

export const CONFIDENCE_LABELS: Record<ConfidenceLabel, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
}

export const CONFIDENCE_COLORS: Record<ConfidenceLabel, string> = {
  low: '#94a3b8',
  medium: '#f59e0b',
  high: '#22c55e',
}

/** Map a 0–1 confidence to a low/medium/high band. */
export function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.55) return 'medium'
  return 'low'
}

/**
 * One contributing piece of evidence. The verdict carries the full list so the
 * UI / embed can show the moderator exactly which signals fired and how much
 * each one weighed — the core of the transparency requirement.
 */
export type DetectionSignal = {
  source: 'heuristic' | 'ai'
  category: CategoryId
  /** Plain-language description, e.g. "Lookalike Discord domain (discrod.gg)". */
  label: string
  /** 0–1 contribution this signal made to its category score. */
  weight: number
}

export type AnalysisVerdict = {
  /** All categories with score > 0, sorted desc. */
  categories: CategoryScore[]
  /** Highest-scoring category — null if nothing tripped. */
  topCategory: CategoryId | null
  /** Score of the top category. */
  confidence: number
  /** low | medium | high confidence band derived from `confidence`. */
  confidenceLabel: ConfidenceLabel
  /** low | medium | high severity — derived from confidence + category. */
  severity: 'low' | 'medium' | 'high'
  /** Short human-readable explanation, blended from heuristic hits + AI reasoning. */
  reasoning: string
  /**
   * Individual deterministic hits that contributed — e.g. "shouting (mostly
   * caps)", "1 invite link". UI can render them as a chip row separate from
   * the AI prose. Kept for backward compatibility; `signals` is richer.
   */
  heuristicHits: string[]
  /** Structured, per-category evidence list (heuristic + AI). */
  signals: DetectionSignal[]
  /** Raw AI explanation, if the LLM ran. Null when only heuristics fired. */
  aiReasoning: string | null
  /** Whether `confidence >= threshold[sensitivity]` for the top category. */
  violates: boolean
}

// ── Keyword / pattern banks ────────────────────────────────────────────────────

// Brand → the legitimate domains it should resolve to. Anything that *looks*
// like the brand but isn't on this list is a lookalike (phishing / suspicious).
const PROTECTED_BRANDS: { brand: string; legit: string[] }[] = [
  { brand: 'discord', legit: ['discord.com', 'discord.gg', 'discordapp.com', 'discord.media', 'discordstatus.com'] },
  { brand: 'steam', legit: ['steampowered.com', 'steamcommunity.com', 'store.steampowered.com'] },
  { brand: 'paypal', legit: ['paypal.com', 'paypal.me'] },
  { brand: 'roblox', legit: ['roblox.com'] },
  { brand: 'epicgames', legit: ['epicgames.com'] },
  { brand: 'twitch', legit: ['twitch.tv'] },
]

// Free / abuse-prone TLDs that disproportionately host throwaway phishing.
const SUSPICIOUS_TLDS = new Set([
  'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'click', 'link', 'work',
  'fit', 'rest', 'country', 'kim', 'loan', 'men', 'gdn', 'mom', 'lol', 'cyou',
])

const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd', 'buff.ly',
  'cutt.ly', 'rebrand.ly', 'shorturl.at', 'rb.gy', 'tiny.cc', 'bit.do',
  'discord.click', 'short.gy',
])

// Slur patterns. Word-boundaried to limit false hits. (Self-harm handled
// separately and multilingually by SELF_HARM_PATTERNS.)
const TOXIC_PATTERNS = [
  /\bn[i!1*]gg(?:er|a)s?\b/i,
  /\bf[a@4]gg?[o0]ts?\b/i,
  /\bret[a@4]rd(?:ed|s)?\b/i,
  /\btr[a@4]nn(?:y|ie)\b/i,
]

// Targeted-harassment / threat patterns. These need a target or threat verb so
// they don't fire on generic profanity.
const HARASSMENT_PATTERNS = [
  /\bi(?:'?m| am| will| am going to|'?ll)\s+(?:find|track|hunt|kill|hurt|beat|end)\s+(?:you|u|him|her|them)\b/i,
  /\b(?:i have|i know|i'?ve got)\s+your\s+(?:address|ip|location|home|real name|school)\b/i,
  /\bi(?:'?ll| will)\s+(?:dox|expose|leak)\s+(?:you|u|him|her|them)\b/i,
  /\bgo\s+(?:die|rot|hang)\b/i,
  /\bnobody\s+(?:likes|loves|wants)\s+you\b/i,
]

// Impersonation is a claim of authority *used to manipulate* — not the claim by
// itself. A real admin saying "I'm an admin, how can I help?" is harmless, so we
// only flag heuristically when an authority claim co-occurs with a manipulation
// cue. Bare claims (and any non-English phrasing) are left to the multilingual
// LLM, which keeps the behaviour consistent across languages.
const AUTHORITY_CLAIM_RE =
  /\b(?:i\s*am|i'?m|this\s+is|we\s+are|we'?re)\s+(?:a\s+|an\s+|the\s+)?(?:discord\s+)?(?:official\s+)?(?:staff|admins?|administrators?|moderators?|mod\s*team|support(?:\s*team)?|server\s+owner|owner)\b/i
// Self-identifications that are inherently impersonation-flavoured.
const FAKE_OFFICIAL_RE =
  /\bofficial\s+discord\s+(?:staff|team|support|moderation)\b|\bdiscord\s+(?:trust\s*&?\s*safety|safety\s+team|support\s+team|staff\s+member)\b|\bi(?:'?m| am)\s+(?:from|with|part\s+of)\s+discord\b/i
// The action that turns an authority claim into an attack.
const MANIPULATION_CUE_RE =
  /\b(?:dm\s+me|message\s+me|contact\s+me|add\s+me|send\s+(?:me\s+)?your|give\s+(?:me\s+)?your|verify\s+your|your\s+(?:password|account|login|credentials)|click\s+(?:here|this|the\s+link)|claim\s+your|free\s+nitro|gift\s+card|or\s+(?:you|your\s+account)\s+will\s+be\s+(?:banned|deleted|suspended)|you(?:'?ll| will)\s+be\s+banned)\b/i

const INVITE_REGEX = /(?:discord\.(?:gg|com\/invite)|discordapp\.com\/invite)\/[a-zA-Z0-9-]+/gi
const LINK_REGEX = /https?:\/\/[^\s<>"')]+/gi
const BARE_DOMAIN_REGEX = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi
const MENTION_REGEX = /<@!?\d+>|@everyone|@here/g
const EXCESSIVE_REPEAT_REGEX = /(.)\1{9,}/
// Repeated whole words ("buy buy buy buy", "join join join").
const REPEATED_WORD_REGEX = /\b(\w{2,})\b(?:\s+\1\b){3,}/i
// Discussing-the-topic dampeners so "is this a scam?" / "report phishing" don't
// themselves get flagged as the thing they describe.
const DISCUSSION_DAMPENERS =
  /\b(is this|is that|looks like|report(?:ing|ed)?|beware|be careful|watch out for|avoid|scammer|don'?t click|do not click|fake|warning)\b/i

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return Math.round(n * 100) / 100
}

// ── Multilingual matching ──────────────────────────────────────────────────────
//
// Keyword detection is made language-robust two ways: (1) text is diacritic-
// folded so "grátis" / "gratis" / "besplatnò" all match the same token, and
// (2) matching is word-boundary aware (Unicode), so "free" never fires inside
// "freedom" and "sex" never fires inside "Essex". Structural detectors (links,
// mentions, repeats) are already language-agnostic.

/** Lowercase + strip diacritics (NFD, drop combining marks). */
function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Split normalised text into Unicode letter/number tokens. */
function tokenize(norm: string): Set<string> {
  return new Set(norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean))
}

/** True if any whole-word token is in `set`. */
function hasAnyWord(tokens: Set<string>, set: Set<string>): boolean {
  for (const t of tokens) if (set.has(t)) return true
  return false
}

// ── Multilingual lexicons ──────────────────────────────────────────────────────
// Diacritic-folded, lowercase. Covers EN + the most common Discord languages
// (HR/SR/BS, ES, DE, FR, PT, IT, NL, PL, TR, RU). Not exhaustive — the LLM pass
// handles the long tail; these give a fast, offline, high-precision floor.

// "Free / gifted" trigger words (incl. gift verbs like ES "regalan", DE "geschenkt").
const FREE_OR_GIFT_WORDS = new Set([
  'free', 'freebie', 'gratis', 'gratuit', 'gratuito', 'kostenlos', 'kostenloses', 'kostenlose',
  'besplatno', 'besplatni', 'besplatna', 'darmowe', 'darmowy', 'ucretsiz', 'gratuita', 'grtis',
  'regala', 'regalan', 'regalo', 'geschenkt', 'geschenk', 'cadeau', 'darilo', 'poklon', 'podarok',
  'gift', 'giveaway', 'sorteo', 'gewinnspiel', 'nagrada', 'nagrade', 'premio', 'prize', 'prijz',
])
// Things scams "give away".
const REWARD_WORDS = new Set([
  'nitro', 'robux', 'vbucks', 'vbuck', 'giftcard', 'giftcards', 'steam', 'paysafecard', 'paysafe',
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'airdrop', 'reward', 'rewards', 'prize', 'premio',
  'nagrada', 'dinero', 'geld', 'argent', 'pieniadze',
])
// Urgency / call-to-action words that escalate a free-reward pitch.
const URGENCY_WORDS = new Set([
  'now', 'odmah', 'ahora', 'jetzt', 'maintenant', 'agora', 'subito', 'teraz', 'hemen', 'seychas',
  'hurry', 'quick', 'fast', 'brzo', 'rapido', 'schnell', 'vite', 'limited', 'today', 'danas', 'hoy', 'heute',
])

// Credential / account-verification phishing terms (multi-word, diacritic-folded).
const PHISHING_PHRASES = [
  // EN
  'verify your account', 'account suspended', 'account has been suspended', 'login required',
  'confirm your identity', 'click here to claim', 'urgent action required', 'unusual login',
  'your account will be deleted', 'reactivate your account', 'verify to continue', 'confirm your account',
  // HR/SR/BS
  'verificiraj svoj racun', 'verificiraj racun', 'potvrdi svoj racun', 'racun je suspendiran',
  'racun ce biti obrisan', 'prijava potrebna', 'potvrdi identitet',
  // ES
  'verifica tu cuenta', 'cuenta suspendida', 'confirma tu identidad', 'inicia sesion ahora',
  // DE
  'bestatige dein konto', 'konto gesperrt', 'konto bestatigen', 'melde dich an',
  // FR
  'verifie ton compte', 'compte suspendu', 'confirme ton identite', 'connecte toi',
  // PT
  'verifique sua conta', 'conta suspensa', 'confirme sua identidade',
]

// Single deceptive-claim scam phrases that don't fit the free×reward shape.
const SCAM_PHRASES = [
  // EN
  'connect your wallet', 'seed phrase', 'double your', 'guaranteed profit', 'guaranteed returns',
  'investment opportunity', 'make money fast', 'dm me to claim', 'claim your prize', 'you have been selected',
  'first 100 people', 'first 50 people', 'only a few spots',
  // HR/SR/BS
  'udvostruci svoj', 'zagarantirana zarada', 'povezi novcanik', 'zaradi novac', 'prvih 100', 'prvih 50',
  // ES
  'duplica tu', 'ganancia garantizada', 'conecta tu billetera', 'gana dinero', 'primeros 100', 'primeros 50',
  // DE
  'verdiene geld', 'garantierter gewinn', 'verbinde deine wallet',
  // FR
  'double ton', 'gains garantis', 'connecte ton portefeuille',
  // PT
  'dobre seu', 'lucro garantido', 'conecte sua carteira', 'primeiros 100',
]

// NSFW terms (folded). Short ones are matched as whole words to avoid substrings.
const NSFW_WORDS = new Set([
  'onlyfans', 'nudes', 'porn', 'porno', 'pornography', 'hentai', 'rule34', 'horny',
  'nsfw', 'cp', 'gole', 'golisave', 'sise', 'kurac', 'pornografija', 'desnudos', 'porno',
])
const NSFW_PHRASES = ['sex chat', 'leaked nudes', 'nsfw server', 'hentai server', 'gole slike', 'fotos desnudas']

// Self-harm encouragement — multilingual "kill yourself" family (high-severity,
// very low false-positive risk for these specific imperatives).
const SELF_HARM_PATTERNS = [
  /\bkys\b/i,
  /\bk[i!1*]ll\s+your\s*self\b/i,
  /\bkill\s+urself\b/i,
  /\bubij\s+se\b/i,          // HR/SR/BS
  /\bobjesi\s+se\b/i,        // HR "hang yourself"
  /\bmatate\b/i,             // ES "mátate" (folded)
  /\bsuicidate\b/i,          // ES "suicídate"
  /\btote\s+dich\b/i,        // DE "töte dich" (folded)
  /\bbring\s+dich\s+um\b/i,  // DE
  /\btue\s*-?\s*toi\b/i,     // FR "tue-toi"
  /\bse\s+mate\b/i,          // PT "se mate"
]

// ── Link analysis ──────────────────────────────────────────────────────────────

type LinkFinding = {
  category: 'phishing' | 'suspicious_link'
  weight: number
  label: string
}

/** Strip a hostname down to its registrable-ish form for comparison. */
function hostOf(raw: string): string | null {
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`http://${raw}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function tldOf(host: string): string {
  const parts = host.split('.')
  return parts[parts.length - 1] ?? ''
}

/** Damerau-lite Levenshtein, capped — enough to spot single-char typosquats. */
function editDistance(a: string, b: string): number {
  const al = a.length
  const bl = b.length
  if (Math.abs(al - bl) > 3) return 99
  const dp = Array.from({ length: al + 1 }, (_, i) => i)
  for (let j = 1; j <= bl; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= al; i++) {
      const tmp = dp[i]
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1])
      prev = tmp
    }
  }
  return dp[al]
}

// Common homoglyph / leetspeak swaps used to disguise lookalike domains.
function deHomoglyph(s: string): string {
  return s
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/\$/g, 's')
    .replace(/rn/g, 'm')
}

/**
 * Inspect every URL / bare domain in a message for malicious traits. Returns one
 * finding per problem so each becomes its own signal. Brand-lookalikes and
 * Discord-impersonating links escalate to `phishing`; structural risks
 * (shorteners, IP hosts, bad TLDs, punycode) land in `suspicious_link`.
 */
function analyzeLinks(content: string): LinkFinding[] {
  const findings: LinkFinding[] = []
  const seen = new Set<string>()

  const urls = content.match(LINK_REGEX) ?? []
  // Bare domains only count when they carry a path-ish or known-TLD shape, so we
  // don't treat "node.js" or "3.5" as links. Gather hosts from both sources.
  const bare = (content.match(BARE_DOMAIN_REGEX) ?? []).filter(
    (d) => !urls.some((u) => u.includes(d)),
  )
  const hosts: { host: string; full: string }[] = []
  for (const u of urls) {
    const h = hostOf(u)
    if (h) hosts.push({ host: h, full: u })
  }
  for (const d of bare) {
    const h = hostOf(d)
    if (h && h.includes('.')) hosts.push({ host: h, full: d })
  }

  for (const { host, full } of hosts) {
    if (seen.has(host)) continue
    seen.add(host)

    const tld = tldOf(host)
    const isLegitBrandDomain = PROTECTED_BRANDS.some((b) => b.legit.includes(host))

    // IP-literal host — almost never legitimate in chat.
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      findings.push({ category: 'suspicious_link', weight: 0.75, label: `Raw IP-address link (${host})` })
      continue
    }
    // Punycode / IDN homograph host.
    if (host.includes('xn--')) {
      findings.push({ category: 'phishing', weight: 0.8, label: `Punycode (lookalike) domain (${host})` })
      continue
    }
    // URL shortener — hides the real destination.
    if (URL_SHORTENERS.has(host)) {
      findings.push({ category: 'suspicious_link', weight: 0.6, label: `URL shortener hides the destination (${host})` })
      continue
    }

    if (isLegitBrandDomain) continue

    // Brand lookalike: the host (de-homoglyphed) is one edit away from a brand
    // token but resolves somewhere else. Classic discrod.gg / steamcommunlty.com.
    let flaggedBrand = false
    const hostCore = deHomoglyph(host.split('.').slice(0, -1).join('.'))
    for (const { brand, legit } of PROTECTED_BRANDS) {
      if (legit.includes(host)) { flaggedBrand = true; break }
      // direct brand token present but on a non-legit domain → impersonating link
      const mentionsBrand = host.includes(brand) || hostCore.includes(brand)
      const looksLike = host
        .split('.')
        .some((part) => {
          const d = editDistance(deHomoglyph(part), brand)
          return d > 0 && d <= 2 && Math.abs(part.length - brand.length) <= 2
        })
      if ((mentionsBrand || looksLike) && !legit.includes(host)) {
        findings.push({
          category: 'phishing',
          weight: brand === 'discord' ? 0.85 : 0.75,
          label: `Lookalike ${brand} domain (${host})`,
        })
        flaggedBrand = true
        break
      }
    }
    if (flaggedBrand) continue

    // Discord gift / nitro lure on a non-discord domain.
    if (/disc[o0]rd[^.]*\.(gift|app|nitro)/i.test(full) && !/^https?:\/\/(www\.)?discord\.(com|gg)\//i.test(full)) {
      findings.push({ category: 'phishing', weight: 0.8, label: `Fake Discord gift link (${host})` })
      continue
    }
    // Abuse-prone free TLD.
    if (SUSPICIOUS_TLDS.has(tld)) {
      findings.push({ category: 'suspicious_link', weight: 0.55, label: `Risky top-level domain .${tld} (${host})` })
      continue
    }
    // Credential-harvest path hints.
    if (/\/(?:login|verify|account|secure|wallet|claim|gift|airdrop)\b/i.test(full)) {
      findings.push({ category: 'suspicious_link', weight: 0.45, label: `Credential-style link path (${host})` })
      continue
    }
  }

  return findings
}

// ── Heuristic pass ─────────────────────────────────────────────────────────────

export type HeuristicResult = {
  scores: Partial<Record<CategoryId, number>>
  hits: string[]
  signals: DetectionSignal[]
}

/** Deterministic, regex-driven first pass. Always runs. */
export function heuristicScores(content: string, mentionCount = 0): HeuristicResult {
  const norm = normalizeForMatch(content)
  const tokens = tokenize(norm)
  const scores: Partial<Record<CategoryId, number>> = {}
  const hits: string[] = []
  const signals: DetectionSignal[] = []
  const discussing = DISCUSSION_DAMPENERS.test(content)
  const phraseHits = (phrases: string[]) => phrases.filter((p) => norm.includes(p)).length

  const bump = (id: CategoryId, score: number, hit: string, label: string, source: DetectionSignal['source'] = 'heuristic') => {
    scores[id] = Math.max(scores[id] ?? 0, clampScore(score))
    if (!hits.includes(hit)) hits.push(hit)
    signals.push({ source, category: id, label, weight: clampScore(score) })
  }

  // Spam — long repeats / wall-of-caps / repeated words.
  if (EXCESSIVE_REPEAT_REGEX.test(content)) {
    bump('spam', 0.7, 'repeated characters', 'Long run of repeated characters')
  }
  if (REPEATED_WORD_REGEX.test(content)) {
    bump('spam', 0.6, 'repeated words', 'Same word repeated many times')
  }
  if (content.length > 40) {
    const upper = (content.match(/[A-Z]/g) ?? []).length
    const letters = (content.match(/[A-Za-z]/g) ?? []).length || 1
    const ratio = upper / letters
    if (ratio > 0.7) {
      bump('spam', 0.55, 'shouting (mostly caps)', 'Mostly uppercase (shouting)')
    }
  }

  // Mention flood — counts @user / @everyone / @here.
  const inlineMentions = (content.match(MENTION_REGEX) ?? []).length
  const totalMentions = inlineMentions + mentionCount
  if (totalMentions >= 5) {
    bump('mention_flood', Math.min(1, 0.5 + totalMentions * 0.05), `${totalMentions} mentions`, `${totalMentions} mentions in one message`)
  }
  if (/@everyone|@here/.test(content)) {
    bump('mention_flood', 0.85, 'mass mention', '@everyone / @here ping')
  }

  // Invite links. A single invite is common and often legitimate, so it stays
  // below the medium threshold on its own; multiple invites escalate.
  const invites = content.match(INVITE_REGEX) ?? []
  if (invites.length > 0) {
    const inviteScore = invites.length === 1 ? 0.55 : Math.min(0.9, 0.6 + invites.length * 0.15)
    bump('suspicious_invite', inviteScore, `${invites.length} invite link${invites.length === 1 ? '' : 's'}`, `${invites.length} Discord invite link${invites.length === 1 ? '' : 's'}`)
  }

  // Malicious-link analysis (shorteners, IP hosts, lookalike brands, bad TLDs).
  const linkFindings = analyzeLinks(content)
  for (const f of linkFindings) {
    bump(f.category, f.weight, f.label, f.label)
  }

  // Scam — two language-agnostic shapes:
  //   (a) a "free / gifted" word co-occurring with a reward noun ("nitro gratis",
  //       "besplatni nitro", "te regalan nitro", "kostenloses nitro geschenkt"),
  //   (b) explicit deceptive scam phrases (multilingual bank).
  // Urgency words and a co-present link both escalate. Cautionary discussion
  // ("is this a scam?") halves the score.
  const freeGift = hasAnyWord(tokens, FREE_OR_GIFT_WORDS)
  const reward = hasAnyWord(tokens, REWARD_WORDS)
  const urgency = hasAnyWord(tokens, URGENCY_WORDS)
  const scamPhrase = phraseHits(SCAM_PHRASES)
  let scamRaw = 0
  let scamWhy = ''
  if (freeGift && reward) {
    scamRaw = 0.72 + (urgency ? 0.1 : 0) + (linkFindings.length ? 0.08 : 0)
    scamWhy = 'Free-reward offer (gift word + reward)'
  }
  if (scamPhrase > 0) {
    scamRaw = Math.max(scamRaw, 0.6 + scamPhrase * 0.15)
    scamWhy = scamWhy || `${scamPhrase} scam phrase${scamPhrase === 1 ? '' : 's'}`
  }
  if (scamRaw > 0) {
    const score = discussing ? scamRaw * 0.5 : scamRaw
    bump('scam', score, 'scam pattern', `${scamWhy}${discussing ? ' (cautionary context)' : ''}`)
  }

  // Phishing — credential / account-verification phrases (multilingual).
  const phishHits = phraseHits(PHISHING_PHRASES)
  if (phishHits > 0) {
    const raw = 0.62 + phishHits * 0.15
    const score = discussing ? raw * 0.5 : raw
    bump('phishing', score, `${phishHits} phishing signal${phishHits === 1 ? '' : 's'}`, `${phishHits} credential-phishing phrase${phishHits === 1 ? '' : 's'}`)
  }

  // Impersonation — only when an authority claim is paired with a manipulation
  // cue (DM me / verify your account / give your password / "or you'll be
  // banned"). A bare "I'm an admin, how can I help?" is NOT flagged here; the
  // LLM judges those, so English and other languages stay consistent.
  const authorityClaim = AUTHORITY_CLAIM_RE.test(content)
  const fakeOfficial = FAKE_OFFICIAL_RE.test(content)
  const manipulationCue = MANIPULATION_CUE_RE.test(content)
  if ((authorityClaim || fakeOfficial) && manipulationCue) {
    bump('impersonation', fakeOfficial ? 0.85 : 0.8, 'impersonation attempt', 'Claims authority and tries to manipulate (DM / link / credentials)')
  } else if (fakeOfficial) {
    // "Official Discord staff" style self-ID alone is suspicious but not a hard
    // violation — keep it below the medium threshold for the LLM to corroborate.
    bump('impersonation', 0.5, 'fake-official claim', 'Claims to be official Discord staff')
  }

  // Toxic — slurs (EN) + multilingual self-harm encouragement. "kill yourself"
  // in any supported language is the strongest toxicity signal, so it scores
  // high enough to win over an overlapping harassment hit.
  let toxicHits = 0
  for (const p of TOXIC_PATTERNS) if (p.test(content)) toxicHits++
  let selfHarmHit = false
  for (const p of SELF_HARM_PATTERNS) if (p.test(norm)) { selfHarmHit = true; break }
  if (selfHarmHit) {
    bump('toxicity', 0.9, 'self-harm encouragement', 'Tells someone to kill/harm themselves')
  }
  if (toxicHits > 0) {
    bump('toxicity', Math.min(1, 0.7 + toxicHits * 0.1), 'slur / toxic phrase', `${toxicHits} slur or toxic phrase`)
  }

  // Targeted harassment / threats.
  let harassHits = 0
  for (const p of HARASSMENT_PATTERNS) if (p.test(content)) harassHits++
  if (harassHits > 0) {
    bump('harassment', Math.min(1, 0.72 + harassHits * 0.12), 'threat / targeted attack', 'Threat or targeted attack on a member')
  }

  // NSFW — whole-word terms + phrases (multilingual, diacritic-folded).
  let nsfwHits = 0
  for (const w of NSFW_WORDS) if (tokens.has(w)) nsfwHits++
  nsfwHits += phraseHits(NSFW_PHRASES)
  if (nsfwHits > 0) {
    bump('nsfw', Math.min(1, 0.55 + nsfwHits * 0.15), `${nsfwHits} NSFW keyword${nsfwHits === 1 ? '' : 's'}`, `${nsfwHits} NSFW keyword${nsfwHits === 1 ? '' : 's'}`)
  }

  return { scores, hits, signals }
}

// ── LLM pass ───────────────────────────────────────────────────────────────────

/** Categories the LLM is asked to judge — the fuzzy, context-dependent ones. */
const LLM_CATEGORIES: CategoryId[] = ['toxicity', 'harassment', 'scam', 'phishing', 'nsfw', 'spam', 'impersonation']

/**
 * "Deceptive-offer" categories: the message has to *do* something — run a con,
 * advertise, harvest credentials, impersonate staff. They inherently need real
 * content, so a short message that merely names the topic ("spam", "is this a
 * scam?", "mario me spamao") must not be flagged on the model's word-association
 * alone. Toxicity / harassment / NSFW are deliberately excluded — those can be a
 * single word and still be a genuine violation.
 */
const OFFER_CATEGORIES = new Set<CategoryId>(['spam', 'scam', 'phishing', 'impersonation'])
/** Below this word count (and with no link) an offer category needs a real rule hit. */
const MIN_SUBSTANCE_WORDS = 8

/**
 * Optional LLM pass. Returns merged scores when the env is configured; silently
 * falls back to the input heuristics when the provider is unavailable. Now
 * resilient: a per-call timeout plus a single retry on transient failures so a
 * slow/flaky provider doesn't silently disable AI scoring on the first hiccup.
 */
async function llmScores(
  content: string,
  enabledCategories: CategoryId[],
): Promise<{ scores: Partial<Record<CategoryId, number>>; reasoning?: string; perCategory?: Partial<Record<CategoryId, string>> } | null> {
  if (!process.env.AI_API_KEY) return null
  if (enabledCategories.length === 0) return null

  const AI_BASE_URL = process.env.AI_BASE_URL ?? 'https://api.groq.com/openai/v1'
  const AI_MODEL = process.env.AI_MODEL ?? 'llama-3.1-8b-instant'

  const systemPrompt = `You are a careful, MULTILINGUAL Discord moderation classifier. For one message you assign each requested category a score from 0.0 (clearly does NOT apply) to 1.0 (clearly applies).

Be conservative — the vast majority of chat is harmless and must score near 0.0. Only give a high score when the message itself unambiguously matches the category. When in doubt, score low.

LANGUAGE — this is critical:
- Messages may be in ANY language (English, Croatian, Serbian, Bosnian, Spanish, German, French, Portuguese, Italian, Polish, Turkish, Russian, slang, etc.). Judge the message by its MEANING in its own language, exactly as a fluent native speaker would.
- Apply identical standards across languages: a message that would be a violation in English is equally a violation translated into any other language, and a harmless sentence stays harmless in every language. Never flag a message just because it is in a language you find hard to read, and never excuse a real violation because it is not in English.
- Ordinary conversation, jokes, small talk, gaming/everyday chatter, plans, or venting are NOT violations — score 0.0.

Rules:
- Talking ABOUT a topic is not doing it. Mentioning "spam", "scam", "phishing", quoting someone, or WARNING others about a scam is NOT a violation — score 0.0.
- spam = low-effort repetitive flooding, copy-paste, or unsolicited advertising. A single ordinary sentence is almost never spam.
- toxicity / harassment require genuine slurs, insults, or attacks aimed at a person — not mild profanity, banter, or strong opinions.
- scam / phishing require an actual deceptive offer or credential-stealing attempt, not casual mention.
- impersonation = pretending to be Discord staff, server staff, or an official service to MANIPULATE someone (e.g. "I'm Discord staff, verify your account"). A real admin offering help ("I'm an admin, how can I help?" / "Ja sam admin, kako mogu pomoći?") is NOT impersonation — score 0.0.

Respond with raw JSON only — no markdown, no extra text.`

  const categoryList = enabledCategories
    .map((id) => `- ${id}: ${CATEGORY_DESCRIPTIONS[id]}`)
    .join('\n')

  const jsonShape = (scores: Partial<Record<CategoryId, number>>) =>
    `{ "scores": { ${enabledCategories.map((id) => `"${id}": ${scores[id] ?? 0}`).join(', ')} }, "reasoning": "..." }`

  // Compact multilingual few-shot so a small model calibrates: benign messages
  // in other languages score 0, and a real violation scores high regardless of
  // language. Keeps EN and non-EN consistent.
  const fewShot: { role: 'user' | 'assistant'; content: string }[] = [
    {
      role: 'user',
      content: 'Message:\n"""Zašto mi je jučer Mario spamao u dm?"""',
    },
    {
      role: 'assistant',
      content: jsonShape({}).replace('"..."', '"Croatian: just asking why someone DMed a lot — harmless."'),
    },
    {
      role: 'user',
      content: 'Message:\n"""Ja sam Discord osoblje. Pošalji mi svoju lozinku ili će ti račun biti obrisan."""',
    },
    {
      role: 'assistant',
      content: jsonShape({ impersonation: 0.95, phishing: 0.9 } as Partial<Record<CategoryId, number>>)
        .replace('"..."', '"Croatian: pretends to be Discord staff and demands a password — impersonation + phishing."'),
    },
  ]

  const userPrompt = `Score this message for each category (0.0 = does not apply, 1.0 = clearly applies). Default to 0.0 unless the message clearly matches.

Categories:
${categoryList}

Message:
"""${content.slice(0, 2000)}"""

Return JSON only:
${jsonShape({})}`

  const callOnce = async (): Promise<{ scores: Partial<Record<CategoryId, number>>; reasoning?: string } | null> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
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
            ...fewShot,
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 400,
          temperature: 0.2,
        }),
        signal: controller.signal,
      })
      // 429 / 5xx are worth a retry; other non-OK responses are terminal.
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) throw new Error(`retryable ${res.status}`)
        return null
      }
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
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await callOnce()
  } catch {
    // One retry on a transient error (timeout / 429 / 5xx). A second failure
    // degrades gracefully to heuristics-only.
    try {
      return await callOnce()
    } catch {
      return null
    }
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

  const { scores: hScores, hits, signals } = heuristicScores(content, opts.mentionCount)
  let aiReasoning: string | undefined
  const merged: Partial<Record<CategoryId, number>> = { ...hScores }

  // A short message with no link and no rule hit can't be a con / advert /
  // phish on its own — see OFFER_CATEGORIES. Guards against the model flagging
  // chatter that merely mentions the topic word.
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length
  const hasUrl = /https?:\/\/|discord\.gg\//i.test(content)
  const lowSubstance = wordCount < MIN_SUBSTANCE_WORDS && !hasUrl

  if (!opts.heuristicsOnly) {
    const fuzzyCategories = enabledCategories.filter((id) => LLM_CATEGORIES.includes(id))
    const ai = await llmScores(content, fuzzyCategories)
    if (ai) {
      aiReasoning = ai.reasoning
      for (const id of fuzzyCategories) {
        let a = ai.scores[id] ?? 0
        const h = merged[id] ?? 0
        // Discount a model-only hit on a low-substance message for the offer
        // categories — keep it well below threshold instead of auto-flagging a
        // normal sentence that just contains "spam" / "scam" / etc.
        if (lowSubstance && h === 0 && OFFER_CATEGORIES.has(id)) {
          a = Math.min(a, 0.3)
        }
        merged[id] = clampScore(Math.max(a, h))
        // Record the AI's own contribution as a signal when it materially adds
        // to (or establishes) a category — keeps the evidence list honest about
        // what came from the model vs the rules.
        if (a >= 0.5 && a >= h) {
          signals.push({ source: 'ai', category: id, label: `Pulse Guard model flagged ${CATEGORY_LABELS[id].toLowerCase()}`, weight: clampScore(a) })
        }
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
  if (top && (top.id === 'phishing' || top.id === 'scam' || top.id === 'impersonation') && confidence >= 0.5) {
    severity = 'high'
  }

  // Keep only signals for categories that actually surfaced, strongest first.
  const surfaced = new Set(finalScores.map((c) => c.id))
  const orderedSignals = signals
    .filter((s) => surfaced.has(s.category))
    .sort((a, b) => b.weight - a.weight)

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
    confidenceLabel: confidenceLabel(confidence),
    severity,
    reasoning: reasoningParts.join(' · '),
    heuristicHits: hits,
    signals: orderedSignals,
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

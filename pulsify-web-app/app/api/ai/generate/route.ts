import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { rateLimitMessage } from '@/lib/ai-rate-limit'

const DAILY_LIMIT = 10

// ─── Provider config (swap via env vars, no code changes needed) ─────────────
// Default: Groq (free) — get key at console.groq.com
//
// To switch provider, update .env.local:
//   AI_BASE_URL=https://api.openai.com/v1          (OpenAI)
//   AI_BASE_URL=https://openrouter.ai/api/v1       (OpenRouter — many free models)
//   AI_BASE_URL=https://api.groq.com/openai/v1     (Groq — default)
//
//   AI_MODEL=gpt-4o-mini                           (OpenAI)
//   AI_MODEL=meta-llama/llama-3.1-8b-instruct:free (OpenRouter free tier)
//   AI_MODEL=llama-3.1-8b-instant                  (Groq — default)
// ─────────────────────────────────────────────────────────────────────────────

const AI_BASE_URL = process.env.AI_BASE_URL ?? 'https://api.groq.com/openai/v1'
const AI_MODEL    = process.env.AI_MODEL    ?? 'llama-3.1-8b-instant'

const TONE_DESCRIPTIONS: Record<string, string> = {
  professional: 'Formal, polished, business-appropriate language. No slang.',
  gaming:       'Energetic, enthusiastic. Gamer culture references are welcome.',
  community:    'Warm, inclusive language that emphasises belonging and mutual support.',
  friendly:     'Casual and upbeat. Feel free to use 1-2 emojis in the welcome message.',
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const guildId = new URL(req.url).searchParams.get('guildId')
  if (!guildId) return NextResponse.json({ error: 'Missing guildId' }, { status: 400 })

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('ai_generations')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .gte('created_at', since)

  const used = count ?? 0
  return NextResponse.json({ used, remaining: Math.max(0, DAILY_LIMIT - used), limit: DAILY_LIMIT })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.AI_API_KEY) {
    return NextResponse.json({ error: 'AI provider not configured.' }, { status: 503 })
  }

  const body = await req.json() as {
    guildId: string
    guildName: string
    description: string
    tone: string
    customTone?: string
    language?: string
    serverSize?: 'small' | 'medium' | 'large'
    contentDepth?: 'brief' | 'standard' | 'detailed'
    includeEmojis?: boolean
  }
  const { guildId, guildName, description, tone, customTone = '', language = 'english', serverSize = 'medium', contentDepth = 'standard', includeEmojis = true } = body
  if (!guildId || !description?.trim()) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  // Rate limit check
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('ai_generations')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .gte('created_at', since)

  if ((count ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json({ error: 'Daily generation limit reached. Try again tomorrow.' }, { status: 429 })
  }

  const toneDesc = tone === 'other' && customTone
    ? `Custom style: "${customTone}". Match this vibe closely.`
    : (TONE_DESCRIPTIONS[tone] ?? TONE_DESCRIPTIONS.friendly)

  const SERVER_SIZE_HINTS: Record<string, string> = {
    small:  'Small community (< 100 members) — keep content concise, personal, and welcoming.',
    medium: 'Mid-size server (100–1 000 members) — balanced detail, structured but approachable.',
    large:  'Large community (1 000+ members) — clear structure, comprehensive rules, formal onboarding.',
  }

  const CONTENT_DEPTH_HINTS: Record<string, string> = {
    brief:    'Keep ALL text short and punchy. Welcome: 1-2 sentences. Rules: one short line each. Onboarding: 80-120 words.',
    standard: 'Balanced length. Welcome: 2-3 sentences. Rules: medium detail. Onboarding: 150-250 words.',
    detailed: 'Be comprehensive. Welcome: 2-3 impactful sentences. Rules: include reasoning. Onboarding: 250-350 words with clear steps.',
  }

  const systemPrompt = `You are a Discord server setup assistant. Generate tailored, high-quality content for Discord servers. You must respond with a valid JSON object only — no markdown, no code fences, no explanation, just raw JSON.`

  const userPrompt = `Generate complete server setup content for a Discord server.

Server name: ${guildName}
Server description: ${description}
Tone: ${tone} — ${toneDesc}
Language: Write ALL content in ${language}. Use native phrasing, not a direct translation.
Server size: ${SERVER_SIZE_HINTS[serverSize] ?? SERVER_SIZE_HINTS.medium}
Content depth: ${CONTENT_DEPTH_HINTS[contentDepth] ?? CONTENT_DEPTH_HINTS.standard}
Emojis: ${includeEmojis ? 'Include relevant emojis naturally throughout the content.' : 'Do NOT use any emojis — plain text only.'}

Respond with this exact JSON structure and nothing else:
{
  "welcome_message": "2-3 sentence welcome. Use {user} for the member name and {server} for the server name.",
  "rules": ["Rule text", "Rule text", "Rule text", "Rule text", "Rule text", "Rule text"],
  "rule_titles": ["Short title", "Short title", "Short title", "Short title", "Short title", "Short title"],
  "onboarding": "Structured onboarding guide with 3-4 sections. Each section starts with a **bold header** (Discord markdown), followed by 1-2 sentences. Separate sections with a blank line.",
  "channels": [
    { "category": "CATEGORY NAME", "channels": ["channel-name", "channel-name"] }
  ]
}

Requirements:
- welcome_message: 2-3 sentences, must include {user} and {server} placeholders
- rules: exactly 6 rules, each starting with a verb, no numbering prefix
- rule_titles: exactly 6 entries, one per rule in the same order — a 1-3 word heading naming what the rule is about (e.g. "Be respectful", "No spam"). Never "Rule 1"
- onboarding: 3-4 sections with **bold headers** (Discord markdown), blank line between sections, 150-250 words total
- channels: 3-5 categories, 2-5 channels each, lowercase hyphenated names, no # prefix`

  const aiRes = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' }, // supported by Groq, OpenAI, OpenRouter
      max_tokens: 2048,
      temperature: 0.7,
    }),
  })

  if (!aiRes.ok) {
    if (aiRes.status === 429) {
      return NextResponse.json({ error: rateLimitMessage() }, { status: 429 })
    }
    const err = await aiRes.json().catch(() => ({})) as { error?: { message?: string } }
    return NextResponse.json(
      { error: err.error?.message ?? 'AI generation failed.' },
      { status: 500 }
    )
  }

  const aiData = await aiRes.json() as { choices: { message: { content: string } }[] }
  const rawText = aiData.choices?.[0]?.message?.content ?? ''

  let result
  try {
    result = JSON.parse(rawText) as {
      welcome_message: string
      rules: string[]
      /** Parallel to `rules` — the per-rule headings the Server Rules editor
       *  uses in its one-embed-per-rule layout. Optional: a model that skips
       *  it just leaves those headings blank. */
      rule_titles?: string[]
      onboarding: string
      channels: { category: string; channels: string[] }[]
    }
  } catch {
    return NextResponse.json({ error: 'AI returned an invalid response. Please try again.' }, { status: 500 })
  }

  await supabase.from('ai_generations').insert({
    guild_id: guildId,
    server_description: description,
    tone,
    welcome_message: result.welcome_message,
    rules: result.rules,
    onboarding: result.onboarding,
    channels: result.channels,
  })

  const newUsed = (count ?? 0) + 1
  return NextResponse.json({
    result,
    used: newUsed,
    remaining: Math.max(0, DAILY_LIMIT - newUsed),
    limit: DAILY_LIMIT,
  })
}
